const { Router } = require('express');
const { db, admin, Timestamp, FieldValue, FieldPath, STORAGE_BUCKET } = require('../lib/firebase');
const { getAnthropicClient } = require('../lib/clients');
const { authenticate } = require('../lib/middleware');
const { verifyOwnership } = require('../lib/helpers');
const { sendApiError, ERROR_CODES } = require('../lib/errors');
const { rateLimit } = require('../lib/rateLimit');

const router = Router();

// ─────────────────────────────────────────────────────────────────────────────
// API ENDPOINTS: MONITOREO
// ─────────────────────────────────────────────────────────────────────────────


// ── Monitoring Types ──────────────────────────────────────────────────────────
const VALID_FIELD_TYPES = ['texto', 'numero', 'fecha'];
const MAX_NOMBRE_PLANTILLA = 60;
const MAX_NOMBRE_CAMPO = 40;
const MAX_CAMPOS_PERSONALIZADOS = 50;

const sanitizeCampos = (campos) => {
  if (!Array.isArray(campos)) return { ok: true, value: [] };
  if (campos.length > MAX_CAMPOS_PERSONALIZADOS) {
    return { ok: false, message: `Max ${MAX_CAMPOS_PERSONALIZADOS} custom fields.` };
  }
  const out = [];
  for (const c of campos) {
    if (!c || typeof c !== 'object') {
      return { ok: false, message: 'Invalid fields format.' };
    }
    const nombre = typeof c.nombre === 'string' ? c.nombre.trim() : '';
    if (!nombre) return { ok: false, message: 'All fields must have a name.' };
    if (nombre.length > MAX_NOMBRE_CAMPO) {
      return { ok: false, message: `Field name exceeds ${MAX_NOMBRE_CAMPO} characters.` };
    }
    if (!VALID_FIELD_TYPES.includes(c.tipo)) {
      return { ok: false, message: 'Invalid field type.' };
    }
    out.push({ nombre, tipo: c.tipo });
  }
  return { ok: true, value: out };
};

const sanitizeNombre = (nombre) => {
  if (typeof nombre !== 'string') return { ok: false, message: 'Name is required.' };
  const trimmed = nombre.trim();
  if (!trimmed) return { ok: false, message: 'Name is required.' };
  if (trimmed.length > MAX_NOMBRE_PLANTILLA) {
    return { ok: false, message: `Name exceeds ${MAX_NOMBRE_PLANTILLA} characters.` };
  }
  return { ok: true, value: trimmed };
};

router.get('/api/monitoreo/tipos', authenticate, async (req, res) => {
  try {
    const snap = await db.collection('tipos_monitoreo').where('fincaId', '==', req.fincaId).get();
    res.status(200).json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  } catch (error) {
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch monitoreo types.', 500);
  }
});

router.post('/api/monitoreo/tipos', authenticate, async (req, res) => {
  try {
    const nombreRes = sanitizeNombre(req.body?.nombre);
    if (!nombreRes.ok) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, nombreRes.message, 400);
    const camposRes = sanitizeCampos(req.body?.campos);
    if (!camposRes.ok) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, camposRes.message, 400);
    const ref = await db.collection('tipos_monitoreo').add({
      nombre: nombreRes.value,
      activo: true,
      fincaId: req.fincaId,
      campos: camposRes.value,
    });
    res.status(201).json({ id: ref.id });
  } catch (error) {
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to create type.', 500);
  }
});

router.get('/api/monitoreo/tipos/:id', authenticate, async (req, res) => {
  try {
    const ownership = await verifyOwnership('tipos_monitoreo', req.params.id, req.fincaId);
    if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);
    res.status(200).json({ id: req.params.id, ...ownership.doc.data() });
  } catch (error) {
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch template.', 500);
  }
});

router.put('/api/monitoreo/tipos/:id', authenticate, async (req, res) => {
  try {
    const ownership = await verifyOwnership('tipos_monitoreo', req.params.id, req.fincaId);
    if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);

    const update = {};
    if (req.body?.nombre !== undefined) {
      const nombreRes = sanitizeNombre(req.body.nombre);
      if (!nombreRes.ok) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, nombreRes.message, 400);
      update.nombre = nombreRes.value;
    }
    if (req.body?.campos !== undefined) {
      const camposRes = sanitizeCampos(req.body.campos);
      if (!camposRes.ok) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, camposRes.message, 400);
      update.campos = camposRes.value;
    }
    if (req.body?.activo !== undefined) {
      update.activo = !!req.body.activo;
    }
    if (Object.keys(update).length === 0) {
      return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, 'No changes.', 400);
    }
    await db.collection('tipos_monitoreo').doc(req.params.id).update(update);
    res.status(200).json({ ok: true });
  } catch (error) {
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to update type.', 500);
  }
});

router.delete('/api/monitoreo/tipos/:id', authenticate, async (req, res) => {
  try {
    const ownership = await verifyOwnership('tipos_monitoreo', req.params.id, req.fincaId);
    if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);
    await db.collection('tipos_monitoreo').doc(req.params.id).delete();
    res.status(200).json({ ok: true });
  } catch (error) {
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to delete type.', 500);
  }
});

// ── Paquetes de Muestreos ─────────────────────────────────────────────────────
const MAX_NOMBRE_PAQUETE = 40;
const MAX_DESCRIPCION = 500;
const MAX_TECNICO = 80;
const MAX_ACTIVITY_NAME = 80;
const MAX_ACTIVITY_RESPONSABLE_ID = 80;
const MAX_ACTIVITIES = 100;
const MAX_FORMULARIOS_X_ACTIVITY = 20;
const MAX_TIPO_ID = 40;
const MAX_TIPO_NOMBRE = 60;
const MAX_DAY = 9999;

const sanitizePaquete = (body) => {
  if (!body || typeof body !== 'object') return { ok: false, message: 'Body inválido.' };

  const nombre = typeof body.nombrePaquete === 'string' ? body.nombrePaquete.trim() : '';
  if (!nombre) return { ok: false, message: 'nombrePaquete es requerido.' };
  if (nombre.length > MAX_NOMBRE_PAQUETE) {
    return { ok: false, message: `nombrePaquete excede ${MAX_NOMBRE_PAQUETE} caracteres.` };
  }

  const descripcion = body.descripcion == null ? '' : String(body.descripcion);
  if (descripcion.length > MAX_DESCRIPCION) {
    return { ok: false, message: `descripcion excede ${MAX_DESCRIPCION} caracteres.` };
  }

  const tecnico = body.tecnicoResponsable == null ? '' : String(body.tecnicoResponsable);
  if (tecnico.length > MAX_TECNICO) {
    return { ok: false, message: `tecnicoResponsable excede ${MAX_TECNICO} caracteres.` };
  }

  const rawActivities = Array.isArray(body.activities) ? body.activities : [];
  if (rawActivities.length > MAX_ACTIVITIES) {
    return { ok: false, message: `Máximo ${MAX_ACTIVITIES} actividades.` };
  }

  const activities = [];
  for (const a of rawActivities) {
    if (!a || typeof a !== 'object') return { ok: false, message: 'Actividad inválida.' };
    const dayNum = Number(a.day);
    if (!Number.isInteger(dayNum) || dayNum < 0 || dayNum > MAX_DAY) {
      return { ok: false, message: 'El día de actividad debe ser un entero entre 0 y 9999.' };
    }
    const name = typeof a.name === 'string' ? a.name.trim() : '';
    if (!name) return { ok: false, message: 'Toda actividad debe tener nombre.' };
    if (name.length > MAX_ACTIVITY_NAME) {
      return { ok: false, message: `Nombre de actividad excede ${MAX_ACTIVITY_NAME} caracteres.` };
    }
    const responsableId = typeof a.responsableId === 'string' ? a.responsableId.slice(0, MAX_ACTIVITY_RESPONSABLE_ID) : '';

    const rawForms = Array.isArray(a.formularios) ? a.formularios : [];
    if (rawForms.length > MAX_FORMULARIOS_X_ACTIVITY) {
      return { ok: false, message: `Máximo ${MAX_FORMULARIOS_X_ACTIVITY} plantillas por actividad.` };
    }
    const seenTipos = new Set();
    const formularios = [];
    for (const f of rawForms) {
      if (!f || typeof f !== 'object') continue;
      const tipoId = typeof f.tipoId === 'string' ? f.tipoId.slice(0, MAX_TIPO_ID) : '';
      if (!tipoId || seenTipos.has(tipoId)) continue;
      const tipoNombre = typeof f.tipoNombre === 'string' ? f.tipoNombre.slice(0, MAX_TIPO_NOMBRE) : '';
      seenTipos.add(tipoId);
      formularios.push({ tipoId, tipoNombre });
    }

    activities.push({ day: dayNum, name, responsableId, formularios });
  }

  return {
    ok: true,
    value: { nombrePaquete: nombre, descripcion, tecnicoResponsable: tecnico, activities },
  };
};

router.get('/api/monitoreo/paquetes', authenticate, async (req, res) => {
  try {
    const snap = await db.collection('monitoreo_paquetes').where('fincaId', '==', req.fincaId).get();
    res.status(200).json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  } catch (error) {
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch monitoring packages.', 500);
  }
});

router.get('/api/monitoreo/paquetes/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const ownership = await verifyOwnership('monitoreo_paquetes', id, req.fincaId);
    if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);
    res.status(200).json({ id, ...ownership.doc.data() });
  } catch (error) {
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch monitoring package.', 500);
  }
});

router.post('/api/monitoreo/paquetes', authenticate, async (req, res) => {
  try {
    const parsed = sanitizePaquete(req.body);
    if (!parsed.ok) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, parsed.message, 400);
    const pkg = { ...parsed.value, fincaId: req.fincaId };
    const docRef = await db.collection('monitoreo_paquetes').add(pkg);
    res.status(201).json({ id: docRef.id, ...pkg });
  } catch (error) {
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to create monitoring package.', 500);
  }
});

router.put('/api/monitoreo/paquetes/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const ownership = await verifyOwnership('monitoreo_paquetes', id, req.fincaId);
    if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);
    const parsed = sanitizePaquete(req.body);
    if (!parsed.ok) return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, parsed.message, 400);
    await db.collection('monitoreo_paquetes').doc(id).update(parsed.value);
    res.status(200).json({ id, ...parsed.value });
  } catch (error) {
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to update monitoring package.', 500);
  }
});

router.delete('/api/monitoreo/paquetes/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const ownership = await verifyOwnership('monitoreo_paquetes', id, req.fincaId);
    if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);
    await db.collection('monitoreo_paquetes').doc(id).delete();
    res.status(200).json({ ok: true });
  } catch (error) {
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to delete monitoring package.', 500);
  }
});

// ── Órdenes de Muestreo ───────────────────────────────────────────────────────
router.get('/api/muestreos/ordenes', authenticate, async (req, res) => {
  try {
    const snap = await db.collection('scheduled_tasks')
      .where('fincaId', '==', req.fincaId)
      .where('type', '==', 'MUESTREO')
      .get();

    if (snap.empty) return res.status(200).json([]);

    const tasks = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    const grupoIds = [...new Set(tasks.map(t => t.grupoId).filter(Boolean))];
    const responsableIds = [...new Set(tasks.map(t => t.activity?.responsableId).filter(Boolean))];

    const [grupoDocs, userDocs] = await Promise.all([
      grupoIds.length > 0 ? Promise.all(grupoIds.map(id => db.collection('grupos').doc(id).get())) : Promise.resolve([]),
      responsableIds.length > 0 ? Promise.all(responsableIds.map(id => db.collection('users').doc(id).get())) : Promise.resolve([]),
    ]);

    const grupoMap = {};
    grupoDocs.forEach(d => { if (d.exists) grupoMap[d.id] = d.data(); });
    const userMap = {};
    userDocs.forEach(d => { if (d.exists) userMap[d.id] = d.data(); });

    // Recolectar bloqueIds de todos los grupos para resolver lotes
    const allBloqueIds = [...new Set(Object.values(grupoMap).flatMap(g => g.bloques || []))];
    const siembraMap = {};
    if (allBloqueIds.length > 0) {
      for (let i = 0; i < allBloqueIds.length; i += 10) {
        const chunk = allBloqueIds.slice(i, i + 10);
        const s = await db.collection('siembras').where(FieldPath.documentId(), 'in', chunk).get();
        s.docs.forEach(d => { siembraMap[d.id] = d.data(); });
      }
    }

    const loteIds = [...new Set(Object.values(siembraMap).map(s => s.loteId).filter(Boolean))];
    const loteMap = {};
    if (loteIds.length > 0) {
      for (let i = 0; i < loteIds.length; i += 10) {
        const chunk = loteIds.slice(i, i + 10);
        const l = await db.collection('lotes').where(FieldPath.documentId(), 'in', chunk).get();
        l.docs.forEach(d => { loteMap[d.id] = d.data(); });
      }
    }

    const enriched = tasks.map(task => {
      const grupo = grupoMap[task.grupoId];
      const responsable = userMap[task.activity?.responsableId];
      const bloques = grupo?.bloques || [];
      const loteNombre = [...new Set(
        bloques.map(bId => siembraMap[bId]?.loteId).filter(Boolean).map(lId => loteMap[lId]?.nombreLote).filter(Boolean)
      )].join(', ') || '—';

      return {
        id: task.id,
        fechaProgramada: task.executeAt?.toDate?.()?.toISOString() ?? null,
        grupoId: task.grupoId,
        grupoNombre: grupo?.nombreGrupo || '—',
        loteNombre,
        responsableNombre: responsable?.nombre || '—',
        tipoMuestreo: task.activity?.name || '—',
        nota: task.nota || '',
        status: task.status,
        paqueteMuestreoId: task.paqueteMuestreoId || '',
      };
    });

    enriched.sort((a, b) => new Date(a.fechaProgramada) - new Date(b.fechaProgramada));
    res.status(200).json(enriched);
  } catch (error) {
    console.error('Error fetching muestreo ordenes:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch monitoring orders.', 500);
  }
});

router.delete('/api/muestreos/ordenes/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const ownership = await verifyOwnership('scheduled_tasks', id, req.fincaId);
    if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);
    const task = ownership.doc.data();
    if (task.type !== 'MUESTREO') {
      return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, 'This task is not a monitoring order.', 400);
    }
    await db.collection('scheduled_tasks').doc(id).delete();
    res.status(200).json({ ok: true });
  } catch (error) {
    console.error('Error deleting muestreo orden:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to delete monitoring order.', 500);
  }
});

const MEDIA_TYPES_IMG = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const MAX_OBSERVACIONES = 2000;
const MAX_REGISTROS_ROWS = 500;
const MAX_REGISTRO_VALUE = 500;
const MAX_SCAN_IMAGE_BASE64 = 8 * 1024 * 1024; // ~6MB de imagen binaria
const DATE_ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

router.patch('/api/muestreos/ordenes/:id/complete', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const ownership = await verifyOwnership('scheduled_tasks', id, req.fincaId);
    if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);
    const task = ownership.doc.data();
    if (task.type !== 'MUESTREO') {
      return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, 'This task is not a monitoring order.', 400);
    }

    const body = req.body || {};
    const {
      fechaCarga,
      observaciones: bodyObservaciones,
      scanImageBase64,
      scanImageMediaType,
    } = body;

    // Validaciones tempranas
    if (fechaCarga !== undefined && fechaCarga !== '' && !DATE_ISO_RE.test(fechaCarga)) {
      return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'Invalid fechaCarga format (YYYY-MM-DD).', 400);
    }
    if (bodyObservaciones !== undefined && typeof bodyObservaciones !== 'string') {
      return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'Observations must be a string.', 400);
    }
    if (typeof bodyObservaciones === 'string' && bodyObservaciones.length > MAX_OBSERVACIONES) {
      return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, `Observations exceed ${MAX_OBSERVACIONES} characters.`, 400);
    }
    if (scanImageBase64 !== undefined && scanImageBase64 !== null) {
      if (typeof scanImageBase64 !== 'string') {
        return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'Invalid scanImageBase64.', 400);
      }
      if (scanImageBase64.length > MAX_SCAN_IMAGE_BASE64) {
        return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, 'Scan image exceeds max size.', 413);
      }
      if (scanImageMediaType && !MEDIA_TYPES_IMG.includes(scanImageMediaType)) {
        return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'Unsupported image type.', 400);
      }
    }

    const update = {
      status: 'completed_by_user',
      completadoEn: FieldValue.serverTimestamp(),
    };
    let formularioData = null;
    if (body.formularioData) {
      const { registros } = body.formularioData;
      if (!Array.isArray(registros)) {
        return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'formularioData.registros must be an array.', 400);
      }
      if (registros.length > MAX_REGISTROS_ROWS) {
        return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, `Maximum ${MAX_REGISTROS_ROWS} rows.`, 400);
      }
      if (registros.length > 0) {
        const cleanRows = [];
        for (const row of registros) {
          if (!row || typeof row !== 'object' || Array.isArray(row)) {
            return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'Each record must be an object.', 400);
          }
          const cleanRow = {};
          for (const [k, v] of Object.entries(row)) {
            if (typeof k !== 'string' || k.length > 80) continue;
            const str = v == null ? '' : String(v);
            if (str.length > MAX_REGISTRO_VALUE) {
              return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, `Value exceeds ${MAX_REGISTRO_VALUE} characters.`, 400);
            }
            cleanRow[k] = str;
          }
          cleanRows.push(cleanRow);
        }
        formularioData = { registros: cleanRows };
        update.formularioData = formularioData;
      }
    }
    await db.collection('scheduled_tasks').doc(id).update(update);

    // ── Crear registro en monitoreos para que aparezca en Historial ──────────
    try {
      // Muestreador = usuario autenticado. Nunca se acepta del body (anti-spoofing).
      let muestreadorId = '';
      let muestreadorNombre = '';
      if (req.userEmail) {
        const userSnap = await db.collection('users')
          .where('fincaId', '==', req.fincaId)
          .where('email', '==', req.userEmail)
          .limit(1)
          .get();
        if (!userSnap.empty) {
          muestreadorId = userSnap.docs[0].id;
          muestreadorNombre = userSnap.docs[0].data().nombre || '';
        }
      }

      // Supervisor: aceptamos el id del body pero verificamos que pertenezca a la finca.
      let supervisorId = '';
      let supervisorNombre = '';
      if (body.supervisorId && typeof body.supervisorId === 'string') {
        const supDoc = await db.collection('users').doc(body.supervisorId).get();
        if (supDoc.exists && supDoc.data().fincaId === req.fincaId) {
          supervisorId = supDoc.id;
          supervisorNombre = supDoc.data().nombre || '';
        }
      }

      const grupoDoc = task.grupoId
        ? await db.collection('grupos').doc(task.grupoId).get()
        : null;
      const grupo = grupoDoc?.exists ? grupoDoc.data() : null;

      let loteNombre = '';
      let loteId = '';
      if (grupo?.bloques?.length > 0) {
        const bloqueChunk = grupo.bloques.slice(0, 10);
        const siembrasSnap = await db.collection('siembras')
          .where(FieldPath.documentId(), 'in', bloqueChunk).get();
        const loteIds = [...new Set(siembrasSnap.docs.map(d => d.data().loteId).filter(Boolean))];
        if (loteIds.length > 0) {
          loteId = loteIds[0];
          const loteDocs = await Promise.all(loteIds.slice(0, 10).map(lid => db.collection('lotes').doc(lid).get()));
          loteNombre = loteDocs.filter(d => d.exists).map(d => d.data().nombreLote).join(', ');
        }
      }

      // F. Carga: viene del formulario o se usa la fecha actual del servidor
      let createdAt = Timestamp.now();
      if (fechaCarga) {
        const d = new Date(fechaCarga + 'T12:00:00Z');
        if (!isNaN(d.getTime())) createdAt = Timestamp.fromDate(d);
      }

      const observaciones = bodyObservaciones !== undefined ? bodyObservaciones : (task.nota || '');

      // Upload scan image to Firebase Storage if provided
      let scanImageUrl = null;
      if (scanImageBase64) {
        try {
          const { randomUUID } = require('crypto');
          const bucket = admin.storage().bucket(STORAGE_BUCKET);
          const token = randomUUID();
          const filePath = `muestreos/${req.fincaId}/${id}/scan_${Date.now()}.jpg`;
          const file = bucket.file(filePath);
          await file.save(Buffer.from(scanImageBase64, 'base64'), {
            contentType: scanImageMediaType || 'image/jpeg',
            metadata: { firebaseStorageDownloadTokens: token },
          });
          const emulatorHost = process.env.FIREBASE_STORAGE_EMULATOR_HOST;
          const storageBase = emulatorHost
            ? `http://${emulatorHost}/v0/b/${STORAGE_BUCKET}/o`
            : `https://firebasestorage.googleapis.com/v0/b/${STORAGE_BUCKET}/o`;
          scanImageUrl = `${storageBase}/${encodeURIComponent(filePath)}?alt=media&token=${token}`;
        } catch (imgErr) {
          console.error('Error al subir imagen de escaneo:', imgErr);
        }
      }

      await db.collection('monitoreos').add({
        fincaId: req.fincaId,
        loteId,
        loteNombre,
        tipoId: task.paqueteMuestreoId || '',
        tipoNombre: task.activity?.name || '',
        plantillaIds: (task.activity?.formularios || []).map(f => f.tipoId).filter(Boolean),
        bloque: grupo?.nombreGrupo || '',
        fecha: task.executeAt || Timestamp.now(),
        responsableId: muestreadorId,
        responsableNombre: muestreadorNombre,
        supervisorId,
        supervisorNombre,
        datos: {},
        formularioData: formularioData || null,
        observaciones,
        scanImageUrl,
        source: 'muestreo',
        ordenId: id,
        createdAt,
      });
    } catch (enrichErr) {
      console.error('Error creating monitoreo record from muestreo:', enrichErr);
    }

    res.status(200).json({ ok: true });
  } catch (error) {
    console.error('Error completing muestreo orden:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to complete monitoring order.', 500);
  }
});

router.post('/api/muestreos/escanear-formulario', authenticate, rateLimit('monitoreo_scan', 'ai_medium'), async (req, res) => {
  try {
    const { imageBase64, mediaType, campos } = req.body || {};
    if (!imageBase64 || !mediaType) {
      return sendApiError(res, ERROR_CODES.MISSING_REQUIRED_FIELDS, 'imageBase64 and mediaType are required.', 400);
    }
    if (typeof imageBase64 !== 'string' || imageBase64.length > MAX_SCAN_IMAGE_BASE64) {
      return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, 'Image exceeds max size.', 413);
    }
    if (!MEDIA_TYPES_IMG.includes(mediaType)) {
      return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'Unsupported image type. Use jpeg, png, gif or webp.', 400);
    }
    if (!Array.isArray(campos) || campos.length === 0) {
      return sendApiError(res, ERROR_CODES.MISSING_REQUIRED_FIELDS, 'Template field list is required.', 400);
    }
    if (campos.length > 100) {
      return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, 'Too many fields.', 400);
    }
    // Sanitization against prompt injection: only alphanumeric names + spaces + common punctuation,
    // truncados a 40 chars (alineado con MAX_NOMBRE_CAMPO).
    const sanitizeForPrompt = (s) => String(s ?? '').replace(/[^\p{L}\p{N} _\-./%()]/gu, '').slice(0, 40);
    const camposSan = campos.map(c => ({
      nombre: sanitizeForPrompt(c?.nombre),
      unidad: c?.unidad ? sanitizeForPrompt(c.unidad) : '',
    })).filter(c => c.nombre);
    if (camposSan.length === 0) {
      return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'Invalid field names.', 400);
    }

    const client = getAnthropicClient();

    const camposDesc = camposSan.map(c => `"${c.nombre}"${c.unidad ? ` (${c.unidad})` : ''}`).join(', ');
    const exampleRow = JSON.stringify(Object.fromEntries(camposSan.map(c => [c.nombre, ''])));
    const prompt = `Eres un asistente de muestreo agrícola. Se te proporciona la imagen de un formulario de campo rellenado a mano por un técnico de campo.

Los únicos campos que debes extraer son (ignora cualquier otro texto, encabezados o campos generales del formulario como lote, fecha, responsable, etc.):
${camposDesc}

El formulario de datos puede tener UNA o VARIAS filas (una por punto de muestreo, bloque u observación).

Instrucciones:
- Devuelve un array JSON donde cada elemento es un objeto con los nombres de campo EXACTOS indicados arriba como claves.
- Si el formulario tiene N filas de datos, devuelve N objetos en el array.
- Usa string para todos los valores. Si no puedes leer un valor o la celda está vacía, usa "".
- Devuelve SOLO el array JSON, sin texto adicional, sin markdown, sin bloques de código.

Ejemplo de respuesta con 2 filas: [${exampleRow}, ${exampleRow}]`;

    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
            { type: 'text', text: prompt },
          ],
        },
      ],
    });

    const rawText = response.content[0].text.trim();
    const jsonText = rawText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      console.error('Claude devolvió texto no parseable:', rawText);
      return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'AI could not interpret the form. Try a clearer image.', 422);
    }

    // Accept both a single object (wrap it) and an array of objects
    const rows = Array.isArray(parsed) ? parsed : (typeof parsed === 'object' && parsed !== null ? [parsed] : null);
    if (!rows) {
      return sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'AI response has unexpected format.', 422);
    }

    // Normalize: only defined campo keys (sanitizadas), values como strings recortados.
    const registros = rows.map(row => {
      const normalized = {};
      for (const campo of camposSan) {
        const val = row[campo.nombre];
        const str = (val === null || val === undefined) ? '' : String(val);
        normalized[campo.nombre] = str.slice(0, MAX_REGISTRO_VALUE);
      }
      return normalized;
    });

    res.status(200).json({ registros });
  } catch (error) {
    console.error('Error escaneando formulario de muestreo:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to process image with AI.', 500);
  }
});

// ── Registros de Monitoreo ────────────────────────────────────────────────────
const MAX_MONITOREO_STR = 200;
const MAX_MONITOREO_OBS = 2000;

const parseIsoDate = (s) => {
  if (!s || !DATE_ISO_RE.test(s)) return null;
  const d = new Date(s + 'T12:00:00Z');
  return isNaN(d.getTime()) ? null : d;
};

router.get('/api/monitoreo', authenticate, async (req, res) => {
  try {
    const { loteId, desde, hasta } = req.query;
    if (desde !== undefined && desde !== '' && !DATE_ISO_RE.test(desde)) {
      return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'Invalid "desde" format (YYYY-MM-DD).', 400);
    }
    if (hasta !== undefined && hasta !== '' && !DATE_ISO_RE.test(hasta)) {
      return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'Invalid "hasta" format (YYYY-MM-DD).', 400);
    }

    let query = db.collection('monitoreos').where('fincaId', '==', req.fincaId);
    if (loteId && typeof loteId === 'string') query = query.where('loteId', '==', loteId.slice(0, 80));
    if (desde) {
      const d = parseIsoDate(desde);
      if (d) query = query.where('fecha', '>=', Timestamp.fromDate(d));
    }
    if (hasta) {
      const d = parseIsoDate(hasta);
      if (d) query = query.where('fecha', '<=', Timestamp.fromDate(d));
    }
    const snap = await query.orderBy('fecha', 'desc').limit(200).get();
    const data = snap.docs.map(d => {
      const doc = d.data();
      return {
        id: d.id,
        ...doc,
        fecha: doc.fecha?.toDate?.()?.toISOString() ?? null,
        createdAt: doc.createdAt?.toDate?.()?.toISOString() ?? null,
      };
    });

    res.status(200).json(data);
  } catch (error) {
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch monitoring records.', 500);
  }
});

router.post('/api/monitoreo', authenticate, async (req, res) => {
  try {
    const body = req.body || {};
    const loteId = typeof body.loteId === 'string' ? body.loteId.trim() : '';
    const tipoId = typeof body.tipoId === 'string' ? body.tipoId.trim() : '';
    const fecha = body.fecha;
    if (!loteId || !tipoId || !fecha) {
      return sendApiError(res, ERROR_CODES.MISSING_REQUIRED_FIELDS, 'Lote, type and date are required.', 400);
    }
    if (!DATE_ISO_RE.test(fecha)) {
      return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'Invalid date format (YYYY-MM-DD).', 400);
    }
    const fechaDate = parseIsoDate(fecha);
    if (!fechaDate) return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'Invalid date.', 400);

    // Verifica que el lote pertenezca a la finca del usuario.
    const loteOwn = await verifyOwnership('lotes', loteId, req.fincaId);
    if (!loteOwn.ok) return res.status(loteOwn.status).json({ message: loteOwn.message });

    const trimStr = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
    const observaciones = trimStr(body.observaciones, MAX_MONITOREO_OBS);
    const ref = await db.collection('monitoreos').add({
      fincaId: req.fincaId,
      loteId,
      loteNombre: trimStr(body.loteNombre, MAX_MONITOREO_STR),
      tipoId: tipoId.slice(0, MAX_MONITOREO_STR),
      tipoNombre: trimStr(body.tipoNombre, MAX_MONITOREO_STR),
      bloque: trimStr(body.bloque, MAX_MONITOREO_STR),
      fecha: Timestamp.fromDate(fechaDate),
      responsableId: trimStr(body.responsableId, MAX_MONITOREO_STR),
      responsableNombre: trimStr(body.responsableNombre, MAX_MONITOREO_STR),
      datos: (body.datos && typeof body.datos === 'object' && !Array.isArray(body.datos)) ? body.datos : {},
      observaciones,
      createdAt: Timestamp.now(),
    });
    res.status(201).json({ id: ref.id });
  } catch (error) {
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to register monitoring record.', 500);
  }
});

router.get('/api/monitoreo/:id', authenticate, async (req, res) => {
  try {
    const ownership = await verifyOwnership('monitoreos', req.params.id, req.fincaId);
    if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);
    const data = ownership.doc.data();
    res.status(200).json({
      id: req.params.id,
      ...data,
      fecha: data.fecha?.toDate?.()?.toISOString() ?? null,
      createdAt: data.createdAt?.toDate?.()?.toISOString() ?? null,
    });
  } catch (error) {
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch monitoring record.', 500);
  }
});

// Elimina un registro individual del array formularioData.registros.
// If it was the only one, deletes the entire document.
router.delete('/api/monitoreo/:id/registros/:regIdx', authenticate, async (req, res) => {
  try {
    const { id, regIdx } = req.params;
    const idx = Number.parseInt(regIdx, 10);
    if (!Number.isInteger(idx) || idx < 0) {
      return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'Invalid record index.', 400);
    }
    const ownership = await verifyOwnership('monitoreos', id, req.fincaId);
    if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);

    const registros = ownership.doc.data().formularioData?.registros;
    if (!Array.isArray(registros) || registros.length <= 1) {
      await db.collection('monitoreos').doc(id).delete();
      return res.status(200).json({ deleted: 'monitoreo' });
    }
    if (idx >= registros.length) {
      return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'Index out of range.', 400);
    }
    const updated = registros.filter((_, i) => i !== idx);
    await db.collection('monitoreos').doc(id).update({ 'formularioData.registros': updated });
    return res.status(200).json({ deleted: 'registro', registros: updated });
  } catch (error) {
    console.error('Error eliminando registro individual:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to delete record.', 500);
  }
});

router.delete('/api/monitoreo/:id', authenticate, async (req, res) => {
  try {
    const ownership = await verifyOwnership('monitoreos', req.params.id, req.fincaId);
    if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);
    await db.collection('monitoreos').doc(req.params.id).delete();
    res.status(200).json({ ok: true });
  } catch (error) {
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to delete monitoring record.', 500);
  }
});

module.exports = router;
