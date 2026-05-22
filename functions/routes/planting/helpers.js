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
};
