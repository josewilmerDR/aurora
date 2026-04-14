const { Router } = require('express');
const { db, admin, Timestamp, FieldValue, FieldPath, STORAGE_BUCKET } = require('../lib/firebase');
const { getAnthropicClient } = require('../lib/clients');
const { authenticate } = require('../lib/middleware');
const { pick, verifyOwnership } = require('../lib/helpers');

const router = Router();

// ─────────────────────────────────────────────────────────────────────────────
// API ENDPOINTS: MONITOREO
// ─────────────────────────────────────────────────────────────────────────────


// ── Tipos de Monitoreo ────────────────────────────────────────────────────────
const TIPOS_CAMPO_VALIDOS = ['texto', 'numero', 'fecha'];
const MAX_NOMBRE_PLANTILLA = 60;
const MAX_NOMBRE_CAMPO = 40;
const MAX_CAMPOS_PERSONALIZADOS = 50;

const sanitizeCampos = (campos) => {
  if (!Array.isArray(campos)) return { ok: true, value: [] };
  if (campos.length > MAX_CAMPOS_PERSONALIZADOS) {
    return { ok: false, message: `Máximo ${MAX_CAMPOS_PERSONALIZADOS} campos personalizados.` };
  }
  const out = [];
  for (const c of campos) {
    if (!c || typeof c !== 'object') {
      return { ok: false, message: 'Formato de campos inválido.' };
    }
    const nombre = typeof c.nombre === 'string' ? c.nombre.trim() : '';
    if (!nombre) return { ok: false, message: 'Todos los campos deben tener nombre.' };
    if (nombre.length > MAX_NOMBRE_CAMPO) {
      return { ok: false, message: `Nombre de campo excede ${MAX_NOMBRE_CAMPO} caracteres.` };
    }
    if (!TIPOS_CAMPO_VALIDOS.includes(c.tipo)) {
      return { ok: false, message: 'Tipo de campo inválido.' };
    }
    out.push({ nombre, tipo: c.tipo });
  }
  return { ok: true, value: out };
};

const sanitizeNombre = (nombre) => {
  if (typeof nombre !== 'string') return { ok: false, message: 'El nombre es obligatorio.' };
  const trimmed = nombre.trim();
  if (!trimmed) return { ok: false, message: 'El nombre es obligatorio.' };
  if (trimmed.length > MAX_NOMBRE_PLANTILLA) {
    return { ok: false, message: `El nombre excede ${MAX_NOMBRE_PLANTILLA} caracteres.` };
  }
  return { ok: true, value: trimmed };
};

router.get('/api/monitoreo/tipos', authenticate, async (req, res) => {
  try {
    const snap = await db.collection('tipos_monitoreo').where('fincaId', '==', req.fincaId).get();
    res.status(200).json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  } catch (error) {
    res.status(500).json({ message: 'Error al obtener tipos de monitoreo.' });
  }
});

router.post('/api/monitoreo/tipos', authenticate, async (req, res) => {
  try {
    const nombreRes = sanitizeNombre(req.body?.nombre);
    if (!nombreRes.ok) return res.status(400).json({ message: nombreRes.message });
    const camposRes = sanitizeCampos(req.body?.campos);
    if (!camposRes.ok) return res.status(400).json({ message: camposRes.message });
    const ref = await db.collection('tipos_monitoreo').add({
      nombre: nombreRes.value,
      activo: true,
      fincaId: req.fincaId,
      campos: camposRes.value,
    });
    res.status(201).json({ id: ref.id });
  } catch (error) {
    res.status(500).json({ message: 'Error al crear tipo.' });
  }
});

router.get('/api/monitoreo/tipos/:id', authenticate, async (req, res) => {
  try {
    const ownership = await verifyOwnership('tipos_monitoreo', req.params.id, req.fincaId);
    if (!ownership.ok) return res.status(ownership.status).json({ message: ownership.message });
    res.status(200).json({ id: req.params.id, ...ownership.doc.data() });
  } catch (error) {
    res.status(500).json({ message: 'Error al obtener la plantilla.' });
  }
});

router.put('/api/monitoreo/tipos/:id', authenticate, async (req, res) => {
  try {
    const ownership = await verifyOwnership('tipos_monitoreo', req.params.id, req.fincaId);
    if (!ownership.ok) return res.status(ownership.status).json({ message: ownership.message });

    const update = {};
    if (req.body?.nombre !== undefined) {
      const nombreRes = sanitizeNombre(req.body.nombre);
      if (!nombreRes.ok) return res.status(400).json({ message: nombreRes.message });
      update.nombre = nombreRes.value;
    }
    if (req.body?.campos !== undefined) {
      const camposRes = sanitizeCampos(req.body.campos);
      if (!camposRes.ok) return res.status(400).json({ message: camposRes.message });
      update.campos = camposRes.value;
    }
    if (req.body?.activo !== undefined) {
      update.activo = !!req.body.activo;
    }
    if (Object.keys(update).length === 0) {
      return res.status(400).json({ message: 'Sin cambios.' });
    }
    await db.collection('tipos_monitoreo').doc(req.params.id).update(update);
    res.status(200).json({ message: 'Tipo actualizado.' });
  } catch (error) {
    res.status(500).json({ message: 'Error al actualizar tipo.' });
  }
});

router.delete('/api/monitoreo/tipos/:id', authenticate, async (req, res) => {
  try {
    const ownership = await verifyOwnership('tipos_monitoreo', req.params.id, req.fincaId);
    if (!ownership.ok) return res.status(ownership.status).json({ message: ownership.message });
    await db.collection('tipos_monitoreo').doc(req.params.id).delete();
    res.status(200).json({ message: 'Tipo eliminado.' });
  } catch (error) {
    res.status(500).json({ message: 'Error al eliminar tipo.' });
  }
});

// ── Paquetes de Muestreos ─────────────────────────────────────────────────────
router.get('/api/monitoreo/paquetes', authenticate, async (req, res) => {
  try {
    const snap = await db.collection('monitoreo_paquetes').where('fincaId', '==', req.fincaId).get();
    res.status(200).json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  } catch (error) {
    res.status(500).json({ message: 'Error al obtener paquetes de muestreo.' });
  }
});

router.get('/api/monitoreo/paquetes/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const ownership = await verifyOwnership('monitoreo_paquetes', id, req.fincaId);
    if (!ownership.ok) return res.status(ownership.status).json({ message: ownership.message });
    res.status(200).json({ id, ...ownership.doc.data() });
  } catch (error) {
    res.status(500).json({ message: 'Error al obtener el paquete de muestreo.' });
  }
});

router.post('/api/monitoreo/paquetes', authenticate, async (req, res) => {
  try {
    const { nombrePaquete } = req.body;
    if (!nombrePaquete) return res.status(400).json({ message: 'nombrePaquete es requerido.' });
    const pkg = { ...pick(req.body, ['nombrePaquete', 'descripcion', 'tecnicoResponsable', 'activities']), fincaId: req.fincaId };
    const docRef = await db.collection('monitoreo_paquetes').add(pkg);
    res.status(201).json({ id: docRef.id, ...pkg });
  } catch (error) {
    res.status(500).json({ message: 'Error al crear paquete de muestreo.' });
  }
});

router.put('/api/monitoreo/paquetes/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const ownership = await verifyOwnership('monitoreo_paquetes', id, req.fincaId);
    if (!ownership.ok) return res.status(ownership.status).json({ message: ownership.message });
    const pkgData = pick(req.body, ['nombrePaquete', 'descripcion', 'tecnicoResponsable', 'activities']);
    await db.collection('monitoreo_paquetes').doc(id).update(pkgData);
    res.status(200).json({ id, ...pkgData });
  } catch (error) {
    res.status(500).json({ message: 'Error al actualizar paquete de muestreo.' });
  }
});

router.delete('/api/monitoreo/paquetes/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const ownership = await verifyOwnership('monitoreo_paquetes', id, req.fincaId);
    if (!ownership.ok) return res.status(ownership.status).json({ message: ownership.message });
    await db.collection('monitoreo_paquetes').doc(id).delete();
    res.status(200).json({ message: 'Paquete de muestreo eliminado.' });
  } catch (error) {
    res.status(500).json({ message: 'Error al eliminar paquete de muestreo.' });
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
    res.status(500).json({ message: 'Error al obtener órdenes de muestreo.' });
  }
});

router.delete('/api/muestreos/ordenes/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const ownership = await verifyOwnership('scheduled_tasks', id, req.fincaId);
    if (!ownership.ok) return res.status(ownership.status).json({ message: ownership.message });
    const task = ownership.doc.data();
    if (task.type !== 'MUESTREO') {
      return res.status(400).json({ message: 'Esta tarea no es una orden de muestreo.' });
    }
    await db.collection('scheduled_tasks').doc(id).delete();
    res.status(200).json({ message: 'Orden de muestreo eliminada.' });
  } catch (error) {
    console.error('Error deleting muestreo orden:', error);
    res.status(500).json({ message: 'Error al eliminar la orden de muestreo.' });
  }
});

router.patch('/api/muestreos/ordenes/:id/complete', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const ownership = await verifyOwnership('scheduled_tasks', id, req.fincaId);
    if (!ownership.ok) return res.status(ownership.status).json({ message: ownership.message });
    const task = ownership.doc.data();
    if (task.type !== 'MUESTREO') {
      return res.status(400).json({ message: 'Esta tarea no es una orden de muestreo.' });
    }
    const update = {
      status: 'completed_by_user',
      completadoEn: FieldValue.serverTimestamp(),
    };
    let formularioData = null;
    if (req.body?.formularioData) {
      const { registros } = req.body.formularioData;
      if (Array.isArray(registros) && registros.length > 0) {
        formularioData = { registros };
        update.formularioData = formularioData;
      }
    }
    await db.collection('scheduled_tasks').doc(id).update(update);

    // ── Crear registro en monitoreos para que aparezca en Historial ──────────
    try {
      const {
        fechaCarga,
        muestreadorId: bodyMuestreadorId,
        muestreadorNombre: bodyMuestreadorNombre,
        supervisorId: bodySupervisorId,
        supervisorNombre: bodySupervisorNombre,
        observaciones: bodyObservaciones,
        scanImageBase64,
        scanImageMediaType,
      } = req.body || {};

      // Muestreador = usuario actual que registra. Si no viene del body, lo resolvemos por email.
      let muestreadorId = bodyMuestreadorId || '';
      let muestreadorNombre = bodyMuestreadorNombre || '';
      if (!muestreadorId && req.userEmail) {
        const userSnap = await db.collection('users')
          .where('fincaId', '==', req.fincaId)
          .where('email', '==', req.userEmail)
          .limit(1)
          .get();
        if (!userSnap.empty) {
          muestreadorId = userSnap.docs[0].id;
          muestreadorNombre = userSnap.docs[0].data().nombre;
        }
      }

      const supervisorId = bodySupervisorId || '';
      const supervisorNombre = bodySupervisorNombre || '';

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

      // Subir imagen de escaneo a Firebase Storage si se proporcionó
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

    res.status(200).json({ message: 'Orden marcada como hecha.' });
  } catch (error) {
    console.error('Error completing muestreo orden:', error);
    res.status(500).json({ message: 'Error al completar la orden de muestreo.' });
  }
});

router.post('/api/muestreos/escanear-formulario', authenticate, async (req, res) => {
  try {
    const { imageBase64, mediaType, campos } = req.body;
    if (!imageBase64 || !mediaType) {
      return res.status(400).json({ message: 'Se requiere imageBase64 y mediaType.' });
    }
    const MEDIA_TYPES_VALIDOS = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!MEDIA_TYPES_VALIDOS.includes(mediaType)) {
      return res.status(400).json({ message: 'Tipo de imagen no soportado. Use jpeg, png, gif o webp.' });
    }
    if (!Array.isArray(campos) || campos.length === 0) {
      return res.status(400).json({ message: 'Se requiere la lista de campos de la plantilla.' });
    }

    const client = getAnthropicClient();

    const camposDesc = campos.map(c => `"${c.nombre}"${c.unidad ? ` (${c.unidad})` : ''}`).join(', ');
    const exampleRow = JSON.stringify(Object.fromEntries(campos.map(c => [c.nombre, ''])));
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
      return res.status(422).json({ message: 'La IA no pudo interpretar el formulario. Intenta con una imagen más clara.' });
    }

    // Accept both a single object (wrap it) and an array of objects
    const rows = Array.isArray(parsed) ? parsed : (typeof parsed === 'object' && parsed !== null ? [parsed] : null);
    if (!rows) {
      return res.status(422).json({ message: 'La respuesta de la IA no tiene el formato esperado.' });
    }

    // Normalize: only defined campo keys, values as strings
    const registros = rows.map(row => {
      const normalized = {};
      for (const campo of campos) {
        const val = row[campo.nombre];
        normalized[campo.nombre] = (val === null || val === undefined) ? '' : String(val);
      }
      return normalized;
    });

    res.status(200).json({ registros });
  } catch (error) {
    console.error('Error escaneando formulario de muestreo:', error);
    res.status(500).json({ message: 'Error al procesar la imagen con IA.' });
  }
});

// ── Registros de Monitoreo ────────────────────────────────────────────────────
router.get('/api/monitoreo', authenticate, async (req, res) => {
  try {
    const { loteId, tipoId, desde, hasta } = req.query;
    let query = db.collection('monitoreos').where('fincaId', '==', req.fincaId);
    if (loteId) query = query.where('loteId', '==', loteId);
    if (desde)  query = query.where('fecha', '>=', Timestamp.fromDate(new Date(desde)));
    if (hasta)  query = query.where('fecha', '<=', Timestamp.fromDate(new Date(hasta)));
    const snap = await query.orderBy('fecha', 'desc').limit(200).get();
    let data = snap.docs.map(d => {
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
    res.status(500).json({ message: 'Error al obtener monitoreos.' });
  }
});

router.post('/api/monitoreo', authenticate, async (req, res) => {
  try {
    const { loteId, loteNombre, tipoId, tipoNombre, bloque, fecha, responsableId, responsableNombre, datos, observaciones } = req.body;
    if (!loteId || !tipoId || !fecha)
      return res.status(400).json({ message: 'Lote, tipo y fecha son obligatorios.' });
    const ref = await db.collection('monitoreos').add({
      fincaId: req.fincaId,
      loteId, loteNombre: loteNombre || '',
      tipoId, tipoNombre: tipoNombre || '',
      bloque: bloque || '',
      fecha: Timestamp.fromDate(new Date(fecha + 'T12:00:00')),
      responsableId: responsableId || '',
      responsableNombre: responsableNombre || '',
      datos: datos || {},
      observaciones: observaciones || '',
      createdAt: Timestamp.now(),
    });
    res.status(201).json({ id: ref.id });
  } catch (error) {
    res.status(500).json({ message: 'Error al registrar monitoreo.' });
  }
});

router.get('/api/monitoreo/:id', authenticate, async (req, res) => {
  try {
    const doc = await db.collection('monitoreos').doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ message: 'No encontrado.' });
    res.status(200).json({ id: doc.id, ...doc.data(), fecha: doc.data().fecha.toDate().toISOString() });
  } catch (error) {
    res.status(500).json({ message: 'Error al obtener monitoreo.' });
  }
});

// Elimina un registro individual del array formularioData.registros.
// Si era el último, elimina el documento completo.
router.delete('/api/monitoreo/:id/registros/:regIdx', authenticate, async (req, res) => {
  try {
    const { id, regIdx } = req.params;
    const idx = parseInt(regIdx, 10);
    const doc = await db.collection('monitoreos').doc(id).get();
    if (!doc.exists) return res.status(404).json({ message: 'Monitoreo no encontrado.' });
    if (doc.data().fincaId !== req.fincaId) return res.status(403).json({ message: 'Acceso denegado.' });

    const registros = doc.data().formularioData?.registros;
    if (!Array.isArray(registros) || registros.length <= 1) {
      await db.collection('monitoreos').doc(id).delete();
      return res.status(200).json({ deleted: 'monitoreo' });
    }
    const updated = registros.filter((_, i) => i !== idx);
    await db.collection('monitoreos').doc(id).update({ 'formularioData.registros': updated });
    return res.status(200).json({ deleted: 'registro', registros: updated });
  } catch (error) {
    console.error('Error eliminando registro individual:', error);
    res.status(500).json({ message: 'Error al eliminar el registro.' });
  }
});

router.delete('/api/monitoreo/:id', authenticate, async (req, res) => {
  try {
    await db.collection('monitoreos').doc(req.params.id).delete();
    res.status(200).json({ message: 'Monitoreo eliminado.' });
  } catch (error) {
    res.status(500).json({ message: 'Error al eliminar monitoreo.' });
  }
});

module.exports = router;
