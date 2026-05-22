// Helpers compartidos por los handlers del dominio planting (siembras +
// materiales). Aquí viven constantes de validación, coercion utilities y
// queries reutilizadas (responsable lookup, canonical record serialization).

const { db } = require('../../lib/firebase');

// Field length limits for siembra string fields. Mirrored from the frontend UI
// constraints; enforced server-side to prevent storage abuse via direct API
// calls that bypass the UI.
const STR_LIMITS = {
  bloque: 4,
  loteNombre: 200,
  materialNombre: 200,
  variedad: 120,
  rangoPesos: 64,
  responsableNombre: 200,
};

const isValidISODate = (s) => {
  if (typeof s !== 'string' || s.length < 8 || s.length > 32) return false;
  const d = new Date(s);
  return !Number.isNaN(d.getTime());
};

// Coerce raw densidadDefault to a clean number in [0, 199999]; 0 means "not configured".
function coerceDensidadDefault(raw) {
  if (raw === undefined || raw === null || raw === '') return 0;
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n < 0 || n > 199999) return null;
  return n;
}

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
  STR_LIMITS,
  isValidISODate,
  coerceDensidadDefault,
  getResponsableFromUid,
  readSiembra,
};
