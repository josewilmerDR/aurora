// GET /api/siembras/disponibles — returns all closed siembras enriched
// with their current grupo membership and the application state of that
// grupo. Used by the form de creación/edición de grupo to power the
// tiered picker (libres → fuera de aplicación → en aplicación activa).

const { Router } = require('express');
const { db } = require('../../lib/firebase');
const { authenticate } = require('../../lib/middleware');
const { sendApiError, ERROR_CODES } = require('../../lib/errors');

const router = Router();

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

module.exports = router;
