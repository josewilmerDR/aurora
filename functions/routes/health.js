// GET /api/_health — probe de salud para uptime checks y verificación de
// deploys/cutover. Público por definición: fuera de App Check (está en
// PUBLIC_PATHS de lib/appcheck.js), sin autenticación, y el payload son
// exactamente cuatro campos — status, db, time, revision. Todo lo demás
// queda afuera a propósito.
//
// SIN rate limit, a propósito: el limitador hace una transacción de
// Firestore por request — más caro que lo que pretende proteger — y
// encima falla en abierto. Un probe cada 60s son ~1.4k reads/día.
//
// `db` reporta el databaseId al que el backend está apuntado (ver
// FIRESTORE_DATABASE_ID en lib/firebase.js): es la verificación barata de
// que un repunte post-restore quedó bien (docs/firestore-backups.md) y de
// que no estamos escribiendo en la base (default) vacía.
//
// OJO: un _health verde NO prueba que la app funcione — está fuera de App
// Check a propósito. Ver docs/health-endpoint.md (content matcher del
// uptime check y el modo de fallo del cutover).

const { Router } = require('express');
const { db } = require('../lib/firebase');

const router = Router();

router.get('/api/_health', async (req, res) => {
  let reachable = false;
  try {
    // Lectura mínima contra la base nombrada: colección vacía → 0 docs,
    // pero el roundtrip prueba conectividad y permisos del runtime.
    await db.collection('_health').limit(1).get();
    reachable = true;
  } catch (err) {
    console.error('[health] Firestore unreachable:', err.message);
  }
  res.status(reachable ? 200 : 503).json({
    status: reachable ? 'ok' : 'degraded',
    db: reachable ? db.databaseId : 'error',
    time: new Date().toISOString(),
    revision: process.env.K_REVISION || 'unknown',
  });
});

module.exports = router;
