const { Router } = require('express');
const { db, Timestamp } = require('../lib/firebase');
const { authenticate } = require('../lib/middleware');
const { pick, verifyOwnership } = require('../lib/helpers');
const { getAnthropicClient } = require('../lib/clients');

const router = Router();

// --- API ENDPOINTS: HORÍMETRO ---
router.get('/api/horimetro', authenticate, async (req, res) => {
  try {
    const snapshot = await db.collection('horimetro')
      .where('fincaId', '==', req.fincaId)
      .get();
    const records = snapshot.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
    res.status(200).json(records);
  } catch (error) {
    console.error('Error al obtener horímetro:', error);
    res.status(500).json({ message: 'Error al obtener los registros.' });
  }
});

router.post('/api/horimetro', authenticate, async (req, res) => {
  try {
    const allowed = [
      'fecha', 'tractorId', 'tractorNombre', 'implementoId', 'implemento',
      'horimetroInicial', 'horimetroFinal',
      'loteId', 'loteNombre', 'grupo', 'bloques', 'labor',
      'horaInicio', 'horaFinal', 'diaSiguiente', 'operarioId', 'operarioNombre',
      'combustible',
    ];
    const data = pick(req.body, allowed);
    if (!data.fecha || !data.tractorId) {
      return res.status(400).json({ message: 'Fecha y tractor son obligatorios.' });
    }
    // Validar fecha: formato YYYY-MM-DD y no futura
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data.fecha)) {
      return res.status(400).json({ message: 'Formato de fecha inválido.' });
    }
    const today = new Date().toISOString().slice(0, 10);
    if (data.fecha > today) {
      return res.status(400).json({ message: 'La fecha no puede ser futura.' });
    }
    // Validar horímetros: numéricos, no negativos, máximo razonable
    if (data.horimetroInicial !== undefined && data.horimetroInicial !== '') {
      const v = parseFloat(data.horimetroInicial);
      if (isNaN(v) || v < 0 || v > 99999) return res.status(400).json({ message: 'Horímetro inicial fuera de rango.' });
      data.horimetroInicial = v;
    }
    if (data.horimetroFinal !== undefined && data.horimetroFinal !== '') {
      const v = parseFloat(data.horimetroFinal);
      if (isNaN(v) || v < 0 || v > 99999) return res.status(400).json({ message: 'Horímetro final fuera de rango.' });
      data.horimetroFinal = v;
    }
    // Validar horas: formato HH:MM
    const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/;
    if (data.horaInicio && !timeRe.test(data.horaInicio)) {
      return res.status(400).json({ message: 'Formato de hora de inicio inválido.' });
    }
    if (data.horaFinal && !timeRe.test(data.horaFinal)) {
      return res.status(400).json({ message: 'Formato de hora final inválido.' });
    }
    // Validar bloques: debe ser array
    if (data.bloques !== undefined && !Array.isArray(data.bloques)) {
      data.bloques = [];
    }
    // Sanitizar diaSiguiente a booleano
    if (data.diaSiguiente !== undefined) data.diaSiguiente = !!data.diaSiguiente;
    // Truncar strings largos (max 200 chars)
    ['tractorNombre', 'implemento', 'loteNombre', 'grupo', 'labor', 'operarioNombre'].forEach(f => {
      if (typeof data[f] === 'string' && data[f].length > 200) data[f] = data[f].slice(0, 200);
    });
    // Normalizar combustible: sólo guardar si tiene al menos costoEstimado
    if (data.combustible && typeof data.combustible === 'object') {
      const c = data.combustible;
      data.combustible = {
        bodegaId:        c.bodegaId        || null,
        tasaLH:          c.tasaLH          ?? null,
        precioUnitario:  c.precioUnitario  ?? null,
        litrosEstimados: c.litrosEstimados ?? null,
        costoEstimado:   c.costoEstimado   ?? null,
        costoReal:       null,
        ajuste:          null,
        cierrePeriodo:   null,
      };
    } else {
      delete data.combustible;
    }
    const ref = await db.collection('horimetro').add({
      ...data,
      fincaId: req.fincaId,
      creadoEn: Timestamp.now(),
    });
    res.status(201).json({ id: ref.id, ...data });
  } catch (error) {
    console.error('Error al crear horímetro:', error);
    res.status(500).json({ message: 'Error al guardar el registro.' });
  }
});

router.put('/api/horimetro/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const ownership = await verifyOwnership('horimetro', id, req.fincaId);
    if (!ownership.ok) return res.status(ownership.status).json({ message: ownership.message });
    const allowed = [
      'fecha', 'tractorId', 'tractorNombre', 'implementoId', 'implemento',
      'horimetroInicial', 'horimetroFinal',
      'loteId', 'loteNombre', 'grupo', 'bloques', 'labor',
      'horaInicio', 'horaFinal', 'diaSiguiente', 'operarioId', 'operarioNombre',
      'combustible',
    ];
    const data = pick(req.body, allowed);
    // Validar fecha si se envía
    if (data.fecha) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(data.fecha)) {
        return res.status(400).json({ message: 'Formato de fecha inválido.' });
      }
      const today = new Date().toISOString().slice(0, 10);
      if (data.fecha > today) {
        return res.status(400).json({ message: 'La fecha no puede ser futura.' });
      }
    }
    // Validar horímetros
    if (data.horimetroInicial !== undefined && data.horimetroInicial !== '') {
      const v = parseFloat(data.horimetroInicial);
      if (isNaN(v) || v < 0 || v > 99999) return res.status(400).json({ message: 'Horímetro inicial fuera de rango.' });
      data.horimetroInicial = v;
    }
    if (data.horimetroFinal !== undefined && data.horimetroFinal !== '') {
      const v = parseFloat(data.horimetroFinal);
      if (isNaN(v) || v < 0 || v > 99999) return res.status(400).json({ message: 'Horímetro final fuera de rango.' });
      data.horimetroFinal = v;
    }
    // Validar horas
    const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/;
    if (data.horaInicio && !timeRe.test(data.horaInicio)) {
      return res.status(400).json({ message: 'Formato de hora de inicio inválido.' });
    }
    if (data.horaFinal && !timeRe.test(data.horaFinal)) {
      return res.status(400).json({ message: 'Formato de hora final inválido.' });
    }
    if (data.bloques !== undefined && !Array.isArray(data.bloques)) data.bloques = [];
    if (data.diaSiguiente !== undefined) data.diaSiguiente = !!data.diaSiguiente;
    ['tractorNombre', 'implemento', 'loteNombre', 'grupo', 'labor', 'operarioNombre'].forEach(f => {
      if (typeof data[f] === 'string' && data[f].length > 200) data[f] = data[f].slice(0, 200);
    });
    // En edición: actualizar sólo los campos estimados, preservar costoReal/ajuste/cierrePeriodo
    if (data.combustible && typeof data.combustible === 'object') {
      const existing = (await db.collection('horimetro').doc(id).get()).data()?.combustible || {};
      const c = data.combustible;
      data.combustible = {
        bodegaId:        c.bodegaId        || existing.bodegaId        || null,
        tasaLH:          c.tasaLH          ?? existing.tasaLH          ?? null,
        precioUnitario:  c.precioUnitario  ?? existing.precioUnitario  ?? null,
        litrosEstimados: c.litrosEstimados ?? existing.litrosEstimados ?? null,
        costoEstimado:   c.costoEstimado   ?? existing.costoEstimado   ?? null,
        costoReal:       existing.costoReal       ?? null,
        ajuste:          existing.ajuste          ?? null,
        cierrePeriodo:   existing.cierrePeriodo   ?? null,
      };
    } else {
      delete data.combustible;
    }
    await db.collection('horimetro').doc(id).update({ ...data, actualizadoEn: Timestamp.now() });
    res.status(200).json({ id, ...data });
  } catch (error) {
    console.error('Error al actualizar horímetro:', error);
    res.status(500).json({ message: 'Error al actualizar el registro.' });
  }
});

router.delete('/api/horimetro/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const ownership = await verifyOwnership('horimetro', id, req.fincaId);
    if (!ownership.ok) return res.status(ownership.status).json({ message: ownership.message });
    await db.collection('horimetro').doc(id).delete();
    res.status(200).json({ message: 'Registro eliminado.' });
  } catch (error) {
    console.error('Error al eliminar horímetro:', error);
    res.status(500).json({ message: 'Error al eliminar el registro.' });
  }
});

router.post('/api/horimetro/escanear', authenticate, async (req, res) => {
  try {
    const { imageBase64, mediaType } = req.body;
    if (!imageBase64 || !mediaType) return res.status(400).json({ message: 'Imagen requerida.' });
    // Limitar tamaño de imagen (~5MB base64 ≈ 3.75MB binario)
    if (typeof imageBase64 !== 'string' || imageBase64.length > 5 * 1024 * 1024) {
      return res.status(400).json({ message: 'Imagen demasiado grande (máx ~4MB).' });
    }
    const allowedMedia = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowedMedia.includes(mediaType)) {
      return res.status(400).json({ message: 'Tipo de imagen no soportado.' });
    }

    const anthropicClient = getAnthropicClient();

    const [maqSnap, lotesSnap, gruposSnap, siembrasSnap, laboresSnap, usersSnap] = await Promise.all([
      db.collection('maquinaria').where('fincaId', '==', req.fincaId).get(),
      db.collection('lotes').where('fincaId', '==', req.fincaId).get(),
      db.collection('grupos').where('fincaId', '==', req.fincaId).get(),
      db.collection('siembras').where('fincaId', '==', req.fincaId).get(),
      db.collection('labores').where('fincaId', '==', req.fincaId).get(),
      db.collection('users').where('fincaId', '==', req.fincaId).get(),
    ]);

    const maq = maqSnap.docs.map(d => ({ id: d.id, ...pick(d.data(), ['idMaquina', 'codigo', 'descripcion', 'tipo']) }));
    const tractores  = maq.filter(m => /tractor|otra maquinaria/i.test(m.tipo));
    const implementos = maq.filter(m => /implemento/i.test(m.tipo));
    const lotes = lotesSnap.docs.map(d => ({ id: d.id, nombreLote: d.data().nombreLote || '', codigoLote: d.data().codigoLote || '' }));
    const siembraMap = {};
    siembrasSnap.docs.forEach(d => { siembraMap[d.id] = { loteNombre: d.data().loteNombre || '' }; });
    const grupos = gruposSnap.docs.map(d => {
      const g = d.data();
      const lotesGrupo = [...new Set((g.bloques || []).map(bid => siembraMap[bid]?.loteNombre).filter(Boolean))];
      return { id: d.id, nombreGrupo: g.nombreGrupo || '', lotes: lotesGrupo };
    });
    const labores   = laboresSnap.docs.map(d => ({ id: d.id, codigo: d.data().codigo || '', descripcion: d.data().descripcion || '' }));
    const operarios = usersSnap.docs.map(d => ({ id: d.id, nombre: d.data().nombre || '' }));
    const today = new Date().toISOString().slice(0, 10);

    const prompt = `Eres un asistente agrícola. Analiza este formulario físico de registro de horímetro de maquinaria.

TRACTORES:
${tractores.map(t => `ID:"${t.id}"|Código:"${t.codigo}"|IDActivo:"${t.idMaquina}"|Nombre:"${t.descripcion}"`).join('\n') || '(ninguno)'}

IMPLEMENTOS:
${implementos.map(t => `ID:"${t.id}"|Código:"${t.codigo}"|IDActivo:"${t.idMaquina}"|Nombre:"${t.descripcion}"`).join('\n') || '(ninguno)'}

LOTES:
${lotes.map(l => `ID:"${l.id}"|Código:"${l.codigoLote}"|Nombre:"${l.nombreLote}"`).join('\n') || '(ninguno)'}

GRUPOS:
${grupos.map(g => `ID:"${g.id}"|Nombre:"${g.nombreGrupo}"|Lotes:[${g.lotes.join(',')}]`).join('\n') || '(ninguno)'}

LABORES:
${labores.map(l => `ID:"${l.id}"|Código:"${l.codigo}"|Desc:"${l.descripcion}"`).join('\n') || '(ninguno)'}

OPERARIOS:
${operarios.map(u => `ID:"${u.id}"|Nombre:"${u.nombre}"`).join('\n') || '(ninguno)'}

Extrae cada fila del formulario y devuelve un arreglo JSON con este formato exacto:
[
  {
    "fecha": "YYYY-MM-DD (busca la fecha en el encabezado; si no aparece usa ${today})",
    "tractorId": "ID del tractor del catálogo o null",
    "tractorNombre": "nombre del tractor tal como aparece o del catálogo si coincide",
    "implemento": "nombre del implemento del catálogo si coincide, o texto del formulario, o cadena vacía",
    "horimetroInicial": número o null,
    "horimetroFinal": número o null,
    "loteId": "ID del lote si coincide, o null",
    "loteNombre": "nombre del lote tal como aparece",
    "grupo": "nombreGrupo del catálogo si coincide, o texto del formulario, o cadena vacía",
    "bloques": [],
    "labor": "descripción de la labor del catálogo si coincide, o texto del formulario, o cadena vacía",
    "horaInicio": "HH:MM en 24h, o cadena vacía",
    "horaFinal": "HH:MM en 24h, o cadena vacía",
    "operarioId": "ID del operario si coincide, o null",
    "operarioNombre": "nombre del operario tal como aparece"
  }
]
Reglas:
1. Cada fila del formulario es un objeto separado en el arreglo.
2. horimetroInicial y horimetroFinal deben ser números (float), no cadenas. Usa null si no aparece.
3. Horas en formato 24h: "5am"→"05:00", "2pm"→"14:00".
4. Si hay una fecha común en el encabezado, aplícala a todas las filas.
5. Resuelve tractor, lote, grupo, labor y operario usando coincidencia aproximada con los catálogos.
6. Devuelve SOLO el arreglo JSON, sin texto adicional ni bloques de código.`;

    const response = await anthropicClient.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
        { type: 'text', text: prompt },
      ] }],
    });

    const rawText = response.content[0].text.trim();
    const jsonText = rawText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
    const filas = JSON.parse(jsonText);
    res.json({ filas });
  } catch (error) {
    console.error('Error escaneando horímetro:', error);
    res.status(500).json({ message: 'Error al procesar la imagen.' });
  }
});

module.exports = router;
