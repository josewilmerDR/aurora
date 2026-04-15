const { Router } = require('express');
const { db, Timestamp } = require('../lib/firebase');
const { authenticate } = require('../lib/middleware');
const { verifyOwnership } = require('../lib/helpers');

const router = Router();

const TIPOS_VALIDOS = new Set([
  'CARRETA DE SEMILLA',
  'CARRETA DE COSECHA',
  'IMPLEMENTO',
  'MAQUINARIA DE APLICACIONES',
  'MAQUINARIA DE PREPARACIÓN DE TERRENO',
  'MONTACARGA',
  'MOTOCICLETA',
  'TRACTOR DE LLANTAS',
  'VEHÍCULO CARGA LIVIANA',
  'OTRO MAQUINARIA DE CAMPO',
]);

const MAX_ID       = 50;
const MAX_CODIGO   = 50;
const MAX_DESC     = 200;
const MAX_UBIC     = 150;
const MAX_OBS      = 2000;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

const floatInRange = (v, min, max) => {
  if (v === null || v === undefined || v === '') return null;
  const n = parseFloat(v);
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return n;
};

const intInRange = (v, min, max) => {
  if (v === null || v === undefined || v === '') return null;
  const n = parseInt(v, 10);
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return n;
};

const validDate = (v) => {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s) return '';
  if (!DATE_RE.test(s)) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : s;
};

function buildMaquinariaDoc(body) {
  const descripcion = str(body.descripcion, MAX_DESC);
  if (!descripcion) return { error: 'La descripción es obligatoria.' };

  const tipoRaw = typeof body.tipo === 'string' ? body.tipo.trim() : '';
  const tipo = tipoRaw && TIPOS_VALIDOS.has(tipoRaw) ? tipoRaw : '';

  const fecha = validDate(body.fechaRevisionResidual);
  if (fecha === null) return { error: 'Fecha de revisión residual inválida.' };

  return {
    data: {
      idMaquina:             str(body.idMaquina, MAX_ID),
      codigo:                str(body.codigo, MAX_CODIGO),
      descripcion,
      tipo,
      ubicacion:             str(body.ubicacion, MAX_UBIC),
      observacion:           str(body.observacion, MAX_OBS),
      capacidad:             floatInRange(body.capacidad, 0, 1e6),
      valorAdquisicion:      floatInRange(body.valorAdquisicion, 0, 1e12),
      valorResidual:         floatInRange(body.valorResidual, 0, 1e12),
      vidaUtilHoras:         intInRange(body.vidaUtilHoras, 0, 1e6),
      fechaRevisionResidual: fecha,
    },
  };
}

// --- API ENDPOINTS: MAQUINARIA ---
router.get('/api/maquinaria', authenticate, async (req, res) => {
  try {
    const snapshot = await db.collection('maquinaria')
      .where('fincaId', '==', req.fincaId)
      .get();
    const items = snapshot.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.descripcion || '').localeCompare(b.descripcion || ''));
    res.json(items);
  } catch (error) {
    res.status(500).json({ message: 'Error al obtener maquinaria.' });
  }
});

router.post('/api/maquinaria', authenticate, async (req, res) => {
  try {
    const { error, data } = buildMaquinariaDoc(req.body);
    if (error) return res.status(400).json({ message: error });

    // Upsert: if idMaquina is provided and already exists for this finca, update it
    if (data.idMaquina) {
      const existing = await db.collection('maquinaria')
        .where('fincaId', '==', req.fincaId)
        .where('idMaquina', '==', data.idMaquina)
        .limit(1).get();
      if (!existing.empty) {
        const doc = existing.docs[0];
        await doc.ref.update({ ...data, actualizadoEn: Timestamp.now() });
        return res.status(200).json({ id: doc.id, merged: true });
      }
    }
    const doc = await db.collection('maquinaria').add({
      ...data,
      fincaId: req.fincaId,
      creadoEn: Timestamp.now(),
    });
    res.status(201).json({ id: doc.id, merged: false });
  } catch (error) {
    res.status(500).json({ message: 'Error al crear maquinaria.' });
  }
});

router.put('/api/maquinaria/:id', authenticate, async (req, res) => {
  try {
    const ownership = await verifyOwnership('maquinaria', req.params.id, req.fincaId);
    if (!ownership.ok) return res.status(ownership.status).json({ message: ownership.message });

    const { error, data } = buildMaquinariaDoc(req.body);
    if (error) return res.status(400).json({ message: error });

    await db.collection('maquinaria').doc(req.params.id).update({
      ...data,
      actualizadoEn: Timestamp.now(),
    });
    res.json({ message: 'Actualizado.' });
  } catch (error) {
    res.status(500).json({ message: 'Error al actualizar maquinaria.' });
  }
});

router.delete('/api/maquinaria/:id', authenticate, async (req, res) => {
  try {
    const ownership = await verifyOwnership('maquinaria', req.params.id, req.fincaId);
    if (!ownership.ok) return res.status(ownership.status).json({ message: ownership.message });
    await db.collection('maquinaria').doc(req.params.id).delete();
    res.json({ message: 'Eliminado.' });
  } catch (error) {
    res.status(500).json({ message: 'Error al eliminar maquinaria.' });
  }
});

// ── Tasas de combustible por máquina ─────────────────────────────────────────
// GET /api/maquinaria/tasas-combustible?bodegaId=xxx&dias=30
// Devuelve un objeto keyed por maquinaId con:
//   { litros, horas, tasaLH, precioUnitario, costoEstimadoPorHora }
// tasaLH = null si no hay horas registradas en el periodo.
// precioUnitario = costo ponderado real del periodo (totalSalida/litros),
//   o costo ponderado actual del ítem si no hubo movimientos.
router.get('/api/maquinaria/tasas-combustible', authenticate, async (req, res) => {
  try {
    const bodegaId = typeof req.query.bodegaId === 'string' ? req.query.bodegaId.trim().slice(0, 128) : '';
    const dias = Math.min(Math.max(parseInt(req.query.dias, 10) || 30, 1), 90);

    const cutoff     = new Date(Date.now() - dias * 24 * 60 * 60 * 1000);
    const cutoffDate = cutoff.toISOString().slice(0, 10); // "YYYY-MM-DD"
    const cutoffTs   = Timestamp.fromDate(cutoff);

    // ── 1. Precio actual del combustible ──────────────────────────────────────
    // costo ponderado = item.total / item.stockActual  (costo promedio móvil)
    let precioActual = 0;
    if (bodegaId) {
      const bodegaCheck = await verifyOwnership('bodegas', bodegaId, req.fincaId);
      if (!bodegaCheck.ok) return res.status(bodegaCheck.status).json({ message: bodegaCheck.message });

      const itemsSnap = await db.collection('bodega_items')
        .where('bodegaId', '==', bodegaId)
        .get();
      let totalCosto = 0, totalStock = 0;
      itemsSnap.docs.forEach(d => {
        const { stockActual = 0, total = 0 } = d.data();
        if (stockActual > 0 && total > 0) { totalCosto += total; totalStock += stockActual; }
      });
      precioActual = totalStock > 0 ? totalCosto / totalStock : 0;
    }

    // ── 2. Salidas de combustible en el periodo, agrupadas por activoId ───────
    const litrosPorActivo = {}; // { [activoId]: { litros, costo } }
    if (bodegaId) {
      const movsSnap = await db.collection('bodega_movimientos')
        .where('bodegaId',  '==', bodegaId)
        .where('tipo',      '==', 'salida')
        .where('timestamp', '>=', cutoffTs)
        .get();
      movsSnap.docs.forEach(d => {
        const { activoId, cantidad = 0, totalSalida = 0 } = d.data();
        if (!activoId) return;
        if (!litrosPorActivo[activoId]) litrosPorActivo[activoId] = { litros: 0, costo: 0 };
        litrosPorActivo[activoId].litros += cantidad;
        litrosPorActivo[activoId].costo  += totalSalida;
      });
    }

    // ── 3. Horas de horímetro en el periodo, agrupadas por tractorId ──────────
    const horasPorTractor = {}; // { [tractorId]: horas }
    const horimSnap = await db.collection('horimetro')
      .where('fincaId', '==', req.fincaId)
      .where('fecha',   '>=', cutoffDate)
      .get();
    horimSnap.docs.forEach(d => {
      const { tractorId, horimetroInicial, horimetroFinal } = d.data();
      if (!tractorId) return;
      const hi = parseFloat(horimetroInicial);
      const hf = parseFloat(horimetroFinal);
      if (!isNaN(hi) && !isNaN(hf) && hf > hi) {
        horasPorTractor[tractorId] = (horasPorTractor[tractorId] || 0) + (hf - hi);
      }
    });

    // ── 4. Combinar: una entrada por cada maquinaId con actividad ─────────────
    const allIds = new Set([...Object.keys(litrosPorActivo), ...Object.keys(horasPorTractor)]);
    const tasas = {};
    allIds.forEach(id => {
      const litros = litrosPorActivo[id]?.litros || 0;
      const costo  = litrosPorActivo[id]?.costo  || 0;
      const horas  = horasPorTractor[id] || 0;
      const tasaLH = horas > 0 ? litros / horas : null;
      // Precio: costo real del periodo si hubo movimientos, sino precio actual del ítem
      const precio = litros > 0 && costo > 0 ? costo / litros : precioActual;
      tasas[id] = {
        litros:               parseFloat(litros.toFixed(2)),
        horas:                parseFloat(horas.toFixed(1)),
        tasaLH:               tasaLH !== null ? parseFloat(tasaLH.toFixed(3)) : null,
        precioUnitario:       parseFloat(precio.toFixed(2)),
        costoEstimadoPorHora: tasaLH !== null ? parseFloat((tasaLH * precio).toFixed(2)) : null,
      };
    });

    res.json({ tasas, dias, bodegaId: bodegaId || null });
  } catch (error) {
    console.error('[tasas-combustible GET]', error);
    res.status(500).json({ message: 'Error al calcular tasas de combustible.' });
  }
});

module.exports = router;
