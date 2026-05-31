// Helpers de runtime para los handlers del dominio planting. Validación de
// payloads vive en schemas.js (Zod); aquí solo viven utilities que requieren
// Firestore (lookups, serialización canónica).

const { db } = require('../../lib/firebase');

// Resolve the canonical (id, nombre) of the responsable from the auth uid,
// scoped to the finca. Returns empty strings if no users row exists for
// this membership (e.g., legacy member without a users doc). Used to derive
// responsable* fields in POST /api/siembras from req.uid instead of trusting
// values supplied by the client body.
async function getResponsableFromUid(uid, fincaId) {
  if (!uid || !fincaId) return { id: '', nombre: '' };
  const snap = await db.collection('users')
    .where('uid', '==', uid)
    .where('fincaId', '==', fincaId)
    .limit(1)
    .get();
  if (snap.empty) return { id: '', nombre: '' };
  return { id: snap.docs[0].id, nombre: snap.docs[0].data().nombre || '' };
}

// FK guard: returns true if the siembra is currently a bloque in any grupo of
// the finca. Used before deleting a siembra so we never leave a dangling
// siembraId inside grupos.bloques[] (mirrors the lote/material FK guards in
// plots.js / materiales.js). Scoped to the finca — only same-finca grupos are
// scanned. Uses the (fincaId, bloques array-contains) composite index; falls
// back to a full-finca grupos scan if the index isn't live yet, same defensive
// posture as findBlockOrigins in groups.js.
async function isSiembraInGrupo(fincaId, siembraId) {
  if (!fincaId || !siembraId) return false;
  try {
    const snap = await db.collection('grupos')
      .where('fincaId', '==', fincaId)
      .where('bloques', 'array-contains', siembraId)
      .limit(1)
      .get();
    return !snap.empty;
  } catch (err) {
    console.warn('[isSiembraInGrupo] array-contains failed, falling back to full scan:', err?.message || err);
    const snap = await db.collection('grupos').where('fincaId', '==', fincaId).get();
    return snap.docs.some(d => Array.isArray(d.data().bloques) && d.data().bloques.includes(siembraId));
  }
}

// Returns the canonical, serialized siembra record (timestamps → ISO strings)
// so PUT can hand the client back the authoritative post-update state and the
// UI doesn't have to blind-merge form input.
async function readSiembra(id) {
  const snap = await db.collection('siembras').doc(id).get();
  if (!snap.exists) return null;
  const raw = snap.data();
  return {
    id: snap.id,
    ...raw,
    fecha: raw.fecha?.toDate ? raw.fecha.toDate().toISOString() : raw.fecha ?? null,
    fechaCierre: raw.fechaCierre?.toDate ? raw.fechaCierre.toDate().toISOString() : (raw.fechaCierre ?? null),
    createdAt: raw.createdAt?.toDate ? raw.createdAt.toDate().toISOString() : (raw.createdAt ?? null),
  };
}

module.exports = {
  getResponsableFromUid,
  readSiembra,
  isSiembraInGrupo,
};
