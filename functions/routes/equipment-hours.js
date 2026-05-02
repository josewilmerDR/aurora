const { Router } = require('express');
const { db, Timestamp } = require('../lib/firebase');
const { authenticate } = require('../lib/middleware');
const { pick, verifyOwnership } = require('../lib/helpers');
const { getAnthropicClient } = require('../lib/clients');
const { sendApiError, ERROR_CODES } = require('../lib/errors');
const { rateLimit } = require('../lib/rateLimit');

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
    console.error('Error fetching horímetro:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch records.', 500);
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
      return sendApiError(res, ERROR_CODES.MISSING_REQUIRED_FIELDS, 'fecha and tractorId are required.', 400);
    }
    // Validate date: YYYY-MM-DD format and not in the future
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data.fecha)) {
      return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'Invalid date format.', 400);
    }
    const today = new Date().toISOString().slice(0, 10);
    if (data.fecha > today) {
      return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, 'Date cannot be in the future.', 400);
    }
    // Validate horimeter values: numeric, non-negative, reasonable max
    if (data.horimetroInicial !== undefined && data.horimetroInicial !== '') {
      const v = parseFloat(data.horimetroInicial);
      if (isNaN(v) || v < 0 || v > 99999) return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'Initial horimeter out of range.', 400);
      data.horimetroInicial = v;
    }
    if (data.horimetroFinal !== undefined && data.horimetroFinal !== '') {
      const v = parseFloat(data.horimetroFinal);
      if (isNaN(v) || v < 0 || v > 99999) return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'Final horimeter out of range.', 400);
      data.horimetroFinal = v;
    }
    // Validate times: HH:MM format
    const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/;
    if (data.horaInicio && !timeRe.test(data.horaInicio)) {
      return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'Invalid start time format.', 400);
    }
    if (data.horaFinal && !timeRe.test(data.horaFinal)) {
      return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'Invalid end time format.', 400);
    }
    // Validate bloques: must be an array
    if (data.bloques !== undefined && !Array.isArray(data.bloques)) {
      data.bloques = [];
    }
    // Sanitize diaSiguiente to boolean
    if (data.diaSiguiente !== undefined) data.diaSiguiente = !!data.diaSiguiente;
    // Truncate long strings (max 200 chars)
    ['tractorNombre', 'implemento', 'loteNombre', 'grupo', 'labor', 'operarioNombre'].forEach(f => {
      if (typeof data[f] === 'string' && data[f].length > 200) data[f] = data[f].slice(0, 200);
    });
    // Normalize combustible: only store if at least costoEstimado is present
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
    console.error('Error creating horímetro:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to save record.', 500);
  }
});

router.put('/api/horimetro/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const ownership = await verifyOwnership('horimetro', id, req.fincaId);
    if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);
    const allowed = [
      'fecha', 'tractorId', 'tractorNombre', 'implementoId', 'implemento',
      'horimetroInicial', 'horimetroFinal',
      'loteId', 'loteNombre', 'grupo', 'bloques', 'labor',
      'horaInicio', 'horaFinal', 'diaSiguiente', 'operarioId', 'operarioNombre',
      'combustible',
    ];
    const data = pick(req.body, allowed);
    // Validate date if provided
    if (data.fecha) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(data.fecha)) {
        return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'Invalid date format.', 400);
      }
      const today = new Date().toISOString().slice(0, 10);
      if (data.fecha > today) {
        return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, 'Date cannot be in the future.', 400);
      }
    }
    // Validate horimeter values
    if (data.horimetroInicial !== undefined && data.horimetroInicial !== '') {
      const v = parseFloat(data.horimetroInicial);
      if (isNaN(v) || v < 0 || v > 99999) return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'Initial horimeter out of range.', 400);
      data.horimetroInicial = v;
    }
    if (data.horimetroFinal !== undefined && data.horimetroFinal !== '') {
      const v = parseFloat(data.horimetroFinal);
      if (isNaN(v) || v < 0 || v > 99999) return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'Final horimeter out of range.', 400);
      data.horimetroFinal = v;
    }
    // Validate times
    const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/;
    if (data.horaInicio && !timeRe.test(data.horaInicio)) {
      return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'Invalid start time format.', 400);
    }
    if (data.horaFinal && !timeRe.test(data.horaFinal)) {
      return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'Invalid end time format.', 400);
    }
    if (data.bloques !== undefined && !Array.isArray(data.bloques)) data.bloques = [];
    if (data.diaSiguiente !== undefined) data.diaSiguiente = !!data.diaSiguiente;
    ['tractorNombre', 'implemento', 'loteNombre', 'grupo', 'labor', 'operarioNombre'].forEach(f => {
      if (typeof data[f] === 'string' && data[f].length > 200) data[f] = data[f].slice(0, 200);
    });
    // On edit: update only the estimated fields, preserve costoReal/ajuste/cierrePeriodo
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
    console.error('Error updating horímetro:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to update record.', 500);
  }
});

router.delete('/api/horimetro/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const ownership = await verifyOwnership('horimetro', id, req.fincaId);
    if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);
    await db.collection('horimetro').doc(id).delete();
    res.status(200).json({ ok: true });
  } catch (error) {
    console.error('Error deleting horímetro:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to delete record.', 500);
  }
});

router.post('/api/horimetro/escanear', authenticate, rateLimit('horimetro_scan', 'ai_medium'), async (req, res) => {
  try {
    const { imageBase64, mediaType } = req.body;
    if (!imageBase64 || !mediaType) return sendApiError(res, ERROR_CODES.MISSING_REQUIRED_FIELDS, 'Image is required.', 400);
    // Limit image size (~5MB base64 ≈ 3.75MB binary)
    if (typeof imageBase64 !== 'string' || imageBase64.length > 5 * 1024 * 1024) {
      return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, 'Image too large (max ~4MB).', 400);
    }
    const allowedMedia = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowedMedia.includes(mediaType)) {
      return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'Unsupported image type.', 400);
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

    const maq = maqSnap.docs.map(d => ({ id: d.id, ...pick(d.data(), ['codigo', 'descripcion', 'tipo']) }));
    // Pool de matching con fallback: si el filtro por `tipo` produce al menos
    // un activo, lo usamos (caso "implementos bien tageados") — eso evita que
    // un tractor con código parecido al implemento gane el match. Si el filtro
    // queda vacío (caso "tractores sin tipo"), caemos a la lista completa para
    // que el matching siga funcionando aunque el admin no haya llenado el
    // campo `tipo`.
    const filteredTractores   = maq.filter(m => /tractor|otra maquinaria/i.test(m.tipo));
    const filteredImplementos = maq.filter(m => /implemento/i.test(m.tipo));
    const tractores   = filteredTractores.length   > 0 ? filteredTractores   : maq;
    const implementos = filteredImplementos.length > 0 ? filteredImplementos : maq;
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

    // ── Two-pass: la IA solo transcribe texto plano de cada celda; el matching
    // contra catálogo lo hace el backend con estrategias en cascada. Esto evita
    // que descripciones con seriales/modelos ("JD 6015J - ee35105") confundan a
    // Claude cuando el operario solo escribió el código corto ("5-10").
    const prompt = `Eres un asistente agrícola que transcribe formularios físicos de registro de horímetro.

NO intentes hacer matching contra ningún catálogo. Solo transcribe el texto que aparece en cada celda, EXACTAMENTE como está escrito. El sistema hará el matching después.

Devuelve un arreglo JSON con una entrada por cada fila del formulario, en este formato:
[
  {
    "fecha": "YYYY-MM-DD (busca la fecha en el encabezado; si no aparece usa ${today})",
    "tractor": "texto literal de la celda 'tractor' o 'activo' (puede ser un código corto como '5-10', un nombre completo, una placa, o cualquier cosa que esté escrita)",
    "implemento": "texto literal de la celda 'implemento' (igual, puede ser código o nombre)",
    "horimetroInicial": número o null,
    "horimetroFinal": número o null,
    "lote": "texto literal de la celda 'lote'",
    "grupo": "texto literal de la celda 'grupo'",
    "labor": "texto literal de la celda 'labor' (puede ser código o descripción)",
    "horaInicio": "HH:MM en 24h, o cadena vacía",
    "horaFinal": "HH:MM en 24h, o cadena vacía",
    "operario": "texto literal de la celda 'operario' o 'responsable'"
  }
]

Reglas:
1. Cada fila del formulario es un objeto separado en el arreglo.
2. horimetroInicial y horimetroFinal deben ser números (float), no cadenas. Usa null si no aparece.
3. Horas en formato 24h: "5am"→"05:00", "2pm"→"14:00".
4. Si hay una fecha común en el encabezado, aplícala a todas las filas.
5. Para los campos de texto (tractor, implemento, lote, grupo, labor, operario): transcribe LITERALMENTE lo escrito, sin interpretarlo, sin completarlo, sin "corregirlo". Si el operario escribió "5-10", devuelve "5-10". Si escribió "tractor rojo", devuelve "tractor rojo". Si la celda está vacía, devuelve cadena vacía.
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
    const rawFilas = JSON.parse(jsonText);

    // ── Backend matching: cascada de estrategias por campo ─────────────────
    // 1. Exact match sobre cualquier campo del catálogo (codigo, descripcion, ...)
    // 2. Prefix match (catálogo empieza con input, o input empieza con catálogo)
    // 3. Token-contains (todos los tokens del input están en el catálogo)
    // 4. Fuzzy (Levenshtein) — best score arriba del threshold
    const norm = (s) => (s == null ? '' : String(s)).trim().toLowerCase();
    const tokens = (s) => norm(s).split(/[\s\-–—_/.,;|]+/).filter(Boolean);

    const levenshtein = (a, b) => {
      if (a === b) return 0;
      if (!a.length) return b.length;
      if (!b.length) return a.length;
      const m = Array.from({ length: b.length + 1 }, (_, i) => [i]);
      for (let j = 0; j <= a.length; j++) m[0][j] = j;
      for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
          m[i][j] = b[i - 1] === a[j - 1]
            ? m[i - 1][j - 1]
            : Math.min(m[i - 1][j - 1] + 1, m[i][j - 1] + 1, m[i - 1][j] + 1);
        }
      }
      return m[b.length][a.length];
    };
    const similarity = (a, b) => {
      const max = Math.max(a.length, b.length);
      return max === 0 ? 1 : 1 - levenshtein(a, b) / max;
    };

    // bestMatch ejecuta la cascada. fields = lista de campos del item (en orden
    // de prioridad) contra los que se intentará match. Devuelve {item, score, strategy}
    // o null si nada arriba del threshold (default 0.78).
    const bestMatch = (input, items, fields, threshold = 0.78) => {
      const q = norm(input);
      if (!q || !items.length) return null;

      // 1. Exact
      for (const f of fields) {
        const hit = items.find(i => norm(i[f]) === q);
        if (hit) return { item: hit, score: 1, strategy: `exact:${f}` };
      }
      // 2. Prefix
      for (const f of fields) {
        const hit = items.find(i => {
          const v = norm(i[f]);
          return v && (v.startsWith(q) || q.startsWith(v));
        });
        if (hit) return { item: hit, score: 0.95, strategy: `prefix:${f}` };
      }
      // 3. Token-contains: todos los tokens del input aparecen como tokens del catálogo
      const qTokens = tokens(input);
      if (qTokens.length) {
        for (const f of fields) {
          const hit = items.find(i => {
            const vTokens = tokens(i[f]);
            return vTokens.length && qTokens.every(t => vTokens.includes(t));
          });
          if (hit) return { item: hit, score: 0.9, strategy: `tokens:${f}` };
        }
      }
      // 4. Fuzzy: best score sobre todos los campos
      let best = null;
      for (const item of items) {
        for (const f of fields) {
          const v = norm(item[f]);
          if (!v) continue;
          const s = similarity(q, v);
          if (s >= threshold && (!best || s > best.score)) {
            best = { item, score: s, strategy: `fuzzy:${f}` };
          }
        }
      }
      return best;
    };

    const filas = (Array.isArray(rawFilas) ? rawFilas : []).map(f => {
      const out = {
        fecha: f.fecha || today,
        tractorId: null,
        tractorNombre: f.tractor || '',
        implementoId: null,
        implemento: f.implemento || '',
        horimetroInicial: f.horimetroInicial ?? null,
        horimetroFinal:   f.horimetroFinal ?? null,
        loteId: null,
        loteNombre: f.lote || '',
        grupo: f.grupo || '',
        bloques: [],
        labor: f.labor || '',
        horaInicio: f.horaInicio || '',
        horaFinal:  f.horaFinal  || '',
        operarioId: null,
        operarioNombre: f.operario || '',
      };

      // Tractor: priorizar codigo (códigos cortos como "5-10"), después descripcion
      const tractorM = bestMatch(f.tractor, tractores, ['codigo', 'descripcion']);
      if (tractorM) { out.tractorId = tractorM.item.id; out.tractorNombre = tractorM.item.descripcion; }

      // Implemento
      const implM = bestMatch(f.implemento, implementos, ['codigo', 'descripcion']);
      if (implM) { out.implementoId = implM.item.id; out.implemento = implM.item.descripcion; }

      // Lote
      const loteM = bestMatch(f.lote, lotes, ['codigoLote', 'nombreLote']);
      if (loteM) { out.loteId = loteM.item.id; out.loteNombre = loteM.item.nombreLote; }

      // Grupo (no tiene código, solo nombre)
      const grupoM = bestMatch(f.grupo, grupos, ['nombreGrupo']);
      if (grupoM) out.grupo = grupoM.item.nombreGrupo;

      // Labor: el form guarda la descripción (no el ID)
      const laborM = bestMatch(f.labor, labores, ['codigo', 'descripcion']);
      if (laborM) out.labor = laborM.item.descripcion;

      // Operario
      const opM = bestMatch(f.operario, operarios, ['nombre']);
      if (opM) { out.operarioId = opM.item.id; out.operarioNombre = opM.item.nombre; }

      return out;
    });

    res.json({ filas });
  } catch (error) {
    console.error('Error scanning horímetro:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to process image.', 500);
  }
});

module.exports = router;
