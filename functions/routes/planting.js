const { Router } = require('express');
const { db, Timestamp, FieldValue } = require('../lib/firebase');
const { getAnthropicClient } = require('../lib/clients');
const { authenticate } = require('../lib/middleware');
const { sendApiError, ERROR_CODES } = require('../lib/errors');
const { rateLimit } = require('../lib/rateLimit');

const router = Router();

// ─────────────────────────────────────────────────────────────────────────────
// API ENDPOINTS: SIEMBRA
// ─────────────────────────────────────────────────────────────────────────────

// ── Sowing materials ─────────────────────────────────────────────────────────
router.get('/api/materiales-siembra', authenticate, async (req, res) => {
  try {
    const snap = await db.collection('materiales_siembra').where('fincaId', '==', req.fincaId).orderBy('nombre').get();
    res.status(200).json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  } catch (error) {
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch materials.', 500);
  }
});

router.post('/api/materiales-siembra', authenticate, async (req, res) => {
  try {
    const { nombre, rangoPesos, variedad } = req.body;
    if (!nombre || typeof nombre !== 'string' || !nombre.trim()) return sendApiError(res, ERROR_CODES.MISSING_REQUIRED_FIELDS, 'Name is required.', 400);
    if (nombre.length > 32) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, 'Name too long.', 400);
    const ref = await db.collection('materiales_siembra').add({
      nombre: nombre.trim(), rangoPesos: (rangoPesos || '').slice(0, 32), variedad: (variedad || '').slice(0, 32),
      fincaId: req.fincaId, createdAt: Timestamp.now(),
    });
    res.status(201).json({ id: ref.id });
  } catch (error) {
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to create material.', 500);
  }
});

router.put('/api/materiales-siembra/:id', authenticate, async (req, res) => {
  try {
    const { nombre, rangoPesos, variedad } = req.body;
    if (!nombre || typeof nombre !== 'string' || !nombre.trim()) return sendApiError(res, ERROR_CODES.MISSING_REQUIRED_FIELDS, 'Name is required.', 400);
    if (nombre.length > 32) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, 'Name too long.', 400);
    const doc = await db.collection('materiales_siembra').doc(req.params.id).get();
    if (!doc.exists || doc.data().fincaId !== req.fincaId) return sendApiError(res, ERROR_CODES.NOT_FOUND, 'Material not found.', 404);
    await doc.ref.update({ nombre: nombre.trim(), rangoPesos: (rangoPesos || '').slice(0, 32), variedad: (variedad || '').slice(0, 32) });
    res.status(200).json({ ok: true });
  } catch (error) {
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to update material.', 500);
  }
});

router.delete('/api/materiales-siembra/:id', authenticate, async (req, res) => {
  try {
    const doc = await db.collection('materiales_siembra').doc(req.params.id).get();
    if (!doc.exists || doc.data().fincaId !== req.fincaId) return sendApiError(res, ERROR_CODES.NOT_FOUND, 'Material not found.', 404);
    await doc.ref.delete();
    res.status(200).json({ ok: true });
  } catch (error) {
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to delete material.', 500);
  }
});

// ── Scan sowing form with AI ─────────────────────────────────────────────────
router.post('/api/siembras/escanear', authenticate, rateLimit('siembras_scan', 'ai_medium'), async (req, res) => {
  try {
    const { imageBase64, mediaType } = req.body;
    if (!imageBase64 || !mediaType) {
      return sendApiError(res, ERROR_CODES.MISSING_REQUIRED_FIELDS, 'imageBase64 and mediaType are required.', 400);
    }

    const [lotesSnap, matsSnap] = await Promise.all([
      db.collection('lotes').where('fincaId', '==', req.fincaId).get(),
      db.collection('materiales_siembra').where('fincaId', '==', req.fincaId).get(),
    ]);

    const lotes = lotesSnap.docs.map(d => ({ id: d.id, nombre: d.data().nombreLote }));
    const materiales = matsSnap.docs.map(d => ({
      id: d.id,
      nombre: d.data().nombre,
      rangoPesos: d.data().rangoPesos || '',
      variedad: d.data().variedad || '',
    }));

    const client = getAnthropicClient();

    const lotesTexto = lotes.length
      ? lotes.map(l => `- ID: "${l.id}" | Nombre: "${l.nombre}"`).join('\n')
      : '(sin lotes registrados)';
    const matsTexto = materiales.length
      ? materiales.map(m => `- ID: "${m.id}" | Nombre: "${m.nombre}" | RangoPesos: "${m.rangoPesos}" | Variedad: "${m.variedad}"`).join('\n')
      : '(sin materiales registrados)';

    const prompt = `Eres un asistente agrícola. Analiza este formulario físico de registro de siembra de piña.

Lotes registrados en el sistema:
${lotesTexto}

Materiales de siembra registrados:
${matsTexto}

Extrae cada fila de siembra del formulario y devuelve un arreglo JSON con este formato exacto:
[
  {
    "loteId": "ID del lote si el nombre coincide con el catálogo, o null si no hay coincidencia",
    "loteNombre": "nombre del lote tal como aparece en el formulario",
    "bloque": "identificador del bloque (letra, número o combinación), o cadena vacía si no aparece",
    "plantas": 15000,
    "densidad": 65000,
    "materialId": "ID del material si el nombre coincide con el catálogo, o null si no hay coincidencia",
    "materialNombre": "nombre del material tal como aparece en el formulario, o cadena vacía",
    "rangoPesos": "rango de pesos si aparece en el formulario, o cadena vacía",
    "variedad": "variedad si aparece en el formulario, o cadena vacía"
  }
]

Reglas:
1. Si el nombre del lote coincide (o es muy similar) con uno del catálogo, usa su ID; si no hay coincidencia, deja loteId como null.
2. Si el nombre del material coincide con uno del catálogo, usa su ID; si no, deja materialId como null.
3. Si no aparece densidad en el formulario, usa 65000 como valor por defecto.
4. plantas y densidad deben ser números enteros, no cadenas.
5. Devuelve SOLO el arreglo JSON, sin texto adicional ni bloques de código.`;

    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
          { type: 'text', text: prompt },
        ],
      }],
    });

    const rawText = response.content[0].text.trim();
    const jsonText = rawText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();

    let filas;
    try {
      filas = JSON.parse(jsonText);
    } catch {
      console.error('Claude returned unparseable text:', rawText);
      return res.status(422).json({ code: ERROR_CODES.INTERNAL_ERROR, message: 'AI could not interpret the form. Try a clearer image.', raw: rawText });
    }

    res.json({ filas, lotes, materiales });
  } catch (error) {
    console.error('Error scanning siembra:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to process image with AI.', 500);
  }
});

// ── Bloques disponibles para asignar a un grupo ─────────────────────────────
// Returns all closed siembras enriched with their current grupo membership
// and the application state of that grupo. Used by the form de creación/edición
// de grupo to power the tiered picker (libres → fuera de aplicación → en
// aplicación activa).
router.get('/api/siembras/disponibles', authenticate, async (req, res) => {
  try {
    const [siembrasSnap, gruposSnap, tasksSnap] = await Promise.all([
      db.collection('siembras')
        .where('fincaId', '==', req.fincaId)
        .where('cerrado', '==', true)
        .get(),
      db.collection('grupos')
        .where('fincaId', '==', req.fincaId)
        .get(),
      db.collection('scheduled_tasks')
        .where('fincaId', '==', req.fincaId)
        .where('type', '==', 'REMINDER_DUE_DAY')
        .get(),
    ]);

    // grupoId → { id, nombreGrupo, paqueteId, etapa, cosecha }
    const grupos = new Map();
    // siembraId → grupoId
    const siembraToGrupo = new Map();
    for (const d of gruposSnap.docs) {
      const data = d.data();
      grupos.set(d.id, {
        id: d.id,
        nombreGrupo: data.nombreGrupo || '',
        paqueteId: data.paqueteId || '',
        etapa: data.etapa || '',
        cosecha: data.cosecha || '',
      });
      const blocks = Array.isArray(data.bloques) ? data.bloques : [];
      for (const sid of blocks) siembraToGrupo.set(sid, d.id);
    }

    // grupoId → { total, completed }
    const grupoTaskStats = new Map();
    for (const d of tasksSnap.docs) {
      const data = d.data();
      const gid = data.grupoId;
      if (!gid) continue;
      if (!grupoTaskStats.has(gid)) grupoTaskStats.set(gid, { total: 0, completed: 0 });
      const stats = grupoTaskStats.get(gid);
      stats.total++;
      if (data.status === 'completed_by_user' || data.status === 'skipped') stats.completed++;
    }

    // grupoId → { estado, aplicacionesCompletadas, aplicacionesTotales }
    const grupoState = new Map();
    for (const [gid, g] of grupos) {
      if (!g.paqueteId) {
        grupoState.set(gid, { estado: 'fuera_aplicacion', aplicacionesCompletadas: 0, aplicacionesTotales: 0 });
        continue;
      }
      const stats = grupoTaskStats.get(gid) || { total: 0, completed: 0 };
      const estado = stats.total > 0 && stats.completed >= stats.total
        ? 'fuera_aplicacion'
        : stats.total === 0
          ? 'fuera_aplicacion'
          : 'en_aplicacion';
      grupoState.set(gid, { estado, aplicacionesCompletadas: stats.completed, aplicacionesTotales: stats.total });
    }

    const data = siembrasSnap.docs.map(d => {
      const raw = d.data();
      const grupoId = siembraToGrupo.get(d.id) || null;
      const grupo = grupoId ? grupos.get(grupoId) : null;
      const state = grupoId ? grupoState.get(grupoId) : null;
      return {
        id: d.id,
        loteId: raw.loteId,
        loteNombre: raw.loteNombre || '',
        bloque: raw.bloque || '',
        plantas: raw.plantas || 0,
        densidad: raw.densidad || 0,
        areaCalculada: raw.areaCalculada || 0,
        materialId: raw.materialId || '',
        materialNombre: raw.materialNombre || '',
        variedad: raw.variedad || '',
        rangoPesos: raw.rangoPesos || '',
        cerrado: raw.cerrado === true,
        fecha: raw.fecha?.toDate?.()?.toISOString() ?? null,
        fechaCierre: raw.fechaCierre?.toDate?.()?.toISOString() ?? null,
        estado: grupoId ? state.estado : 'libre',
        grupoActualId: grupoId,
        grupoActualNombre: grupo?.nombreGrupo || null,
        grupoActualEtapa: grupo?.etapa || null,
        grupoActualCosecha: grupo?.cosecha || null,
        aplicacionesCompletadas: state ? state.aplicacionesCompletadas : null,
        aplicacionesTotales: state ? state.aplicacionesTotales : null,
      };
    });

    res.status(200).json(data);
  } catch (error) {
    console.error('Error fetching siembras disponibles:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch available bloques.', 500);
  }
});

// ── Siembra records ──────────────────────────────────────────────────────────
router.get('/api/siembras', authenticate, async (req, res) => {
  try {
    const { loteId, desde, hasta } = req.query;
    let query = db.collection('siembras').where('fincaId', '==', req.fincaId);
    if (loteId) query = query.where('loteId', '==', loteId);
    if (desde)  query = query.where('fecha', '>=', Timestamp.fromDate(new Date(desde)));
    if (hasta)  query = query.where('fecha', '<=', Timestamp.fromDate(new Date(hasta)));
    const snap = await query.orderBy('fecha', 'desc').limit(300).get();
    const data = snap.docs.map(d => {
      const raw = d.data();
      return { id: d.id, ...raw, fecha: raw.fecha.toDate().toISOString(), fechaCierre: raw.fechaCierre ? raw.fechaCierre.toDate().toISOString() : null };
    });
    res.status(200).json(data);
  } catch (error) {
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch siembras.', 500);
  }
});

router.post('/api/siembras', authenticate, async (req, res) => {
  try {
    const { loteId, loteNombre, bloque, plantas, densidad, materialId, materialNombre, rangoPesos, variedad, cerrado, fecha, responsableId, responsableNombre } = req.body;
    if (!loteId || !fecha) return sendApiError(res, ERROR_CODES.MISSING_REQUIRED_FIELDS, 'Lote and fecha are required.', 400);

    const plantCount = parseInt(plantas) || 0;
    const density = parseFloat(densidad) || 0;
    if (plantCount < 0 || plantCount > 199999) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, 'Plants out of valid range.', 400);
    if (density < 0 || density > 199999) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, 'Density out of valid range.', 400);
    if (typeof bloque === 'string' && bloque.length > 4) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, 'Block too long.', 400);
    if (typeof loteNombre === 'string' && loteNombre.length > 200) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, 'Lote name too long.', 400);
    const areaCalculada = density > 0 ? parseFloat((plantCount / density).toFixed(4)) : 0;
    const isClosed = cerrado === true || cerrado === 'true';
    const inputFechaCierre = req.body.fechaCierre;
    const fechaCierre = isClosed
      ? (inputFechaCierre && String(inputFechaCierre).trim()
          ? Timestamp.fromDate(new Date(String(inputFechaCierre).trim() + 'T12:00:00'))
          : Timestamp.now())
      : null;

    const bloqueNorm = (bloque || '').slice(0, 4);
    const ref = await db.collection('siembras').add({
      fincaId: req.fincaId,
      loteId, loteNombre: loteNombre || '',
      bloque: bloqueNorm,
      plantas: plantCount, densidad: density,
      areaCalculada,
      materialId: materialId || '',
      materialNombre: materialNombre || '',
      rangoPesos: rangoPesos || '',
      variedad: variedad || '',
      cerrado: isClosed,
      ...(fechaCierre && { fechaCierre }),
      fecha: Timestamp.fromDate(new Date(fecha + 'T12:00:00')),
      responsableId: responsableId || '',
      responsableNombre: responsableNombre || '',
      createdAt: Timestamp.now(),
    });

    if (isClosed) {
      const siblingsSnap = await db.collection('siembras')
        .where('fincaId', '==', req.fincaId)
        .where('loteId', '==', loteId)
        .where('bloque', '==', bloqueNorm)
        .get();
      const batch = db.batch();
      siblingsSnap.docs.forEach(d => {
        if (d.id !== ref.id) batch.update(d.ref, { cerrado: true, fechaCierre });
      });
      await batch.commit();
    }

    res.status(201).json({ id: ref.id, areaCalculada });
  } catch (error) {
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to register siembra.', 500);
  }
});

router.put('/api/siembras/:id', authenticate, async (req, res) => {
  try {
    const ALLOWED = ['fecha', 'loteId', 'loteNombre', 'bloque', 'plantas', 'densidad', 'materialId', 'materialNombre', 'rangoPesos', 'variedad', 'cerrado'];
    const updates = {};
    for (const key of ALLOWED) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }
    if (updates.plantas !== undefined) {
      updates.plantas = parseInt(updates.plantas) || 0;
      if (updates.plantas < 0 || updates.plantas > 199999) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, 'Plants out of valid range.', 400);
    }
    if (updates.densidad !== undefined) {
      updates.densidad = parseFloat(updates.densidad) || 0;
      if (updates.densidad < 0 || updates.densidad > 199999) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, 'Density out of valid range.', 400);
    }
    if (typeof updates.bloque === 'string' && updates.bloque.length > 4) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, 'Block too long.', 400);
    if (typeof updates.loteNombre === 'string' && updates.loteNombre.length > 200) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, 'Lote name too long.', 400);
    if (updates.fecha) updates.fecha = Timestamp.fromDate(new Date(updates.fecha));

    const needsDoc = updates.plantas !== undefined || updates.densidad !== undefined || updates.cerrado !== undefined;
    const doc = await db.collection('siembras').doc(req.params.id).get();
    if (!doc.exists || doc.data().fincaId !== req.fincaId) return sendApiError(res, ERROR_CODES.NOT_FOUND, 'Record not found.', 404);
    if (needsDoc) {
      const current = doc.data();

      if (updates.plantas !== undefined || updates.densidad !== undefined) {
        const plantCount = parseInt(updates.plantas ?? current.plantas) || 0;
        const density = parseFloat(updates.densidad ?? current.densidad) || 0;
        updates.areaCalculada = density > 0 ? parseFloat((plantCount / density).toFixed(4)) : 0;
      }

      if (updates.cerrado !== undefined) {
        const fechaCierreUpdate = updates.cerrado === true ? Timestamp.now() : FieldValue.delete();
        const siblingsSnap = await db.collection('siembras')
          .where('fincaId', '==', current.fincaId)
          .where('loteId', '==', current.loteId)
          .where('bloque', '==', current.bloque)
          .get();
        const batch = db.batch();
        const thisId = req.params.id;
        siblingsSnap.docs.forEach(d => {
          const sibUpdates = d.id === thisId
            ? { ...updates, fechaCierre: fechaCierreUpdate }
            : { cerrado: updates.cerrado, fechaCierre: fechaCierreUpdate };
          batch.update(d.ref, sibUpdates);
        });
        await batch.commit();
        return res.status(200).json({ ok: true });
      }
    }

    await db.collection('siembras').doc(req.params.id).update(updates);
    res.status(200).json({ ok: true });
  } catch (error) {
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to update siembra.', 500);
  }
});

router.delete('/api/siembras/:id', authenticate, async (req, res) => {
  try {
    const doc = await db.collection('siembras').doc(req.params.id).get();
    if (!doc.exists || doc.data().fincaId !== req.fincaId) return sendApiError(res, ERROR_CODES.NOT_FOUND, 'Record not found.', 404);
    await doc.ref.delete();
    res.status(200).json({ ok: true });
  } catch (error) {
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to delete siembra.', 500);
  }
});

module.exports = router;
