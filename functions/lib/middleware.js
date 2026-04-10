const { admin, db } = require('./firebase');

// --- MIDDLEWARE DE AUTENTICACIÓN ---
// Verifica el Firebase ID Token y la membresía del usuario en la finca indicada.
const authenticate = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  const fincaId = req.headers['x-finca-id'];

  if (!authHeader?.startsWith('Bearer ') || !fincaId) {
    return res.status(401).json({ message: 'No autorizado.' });
  }

  try {
    const token = authHeader.split('Bearer ')[1];
    const decoded = await admin.auth().verifyIdToken(token);
    const uid = decoded.uid;

    // Verificar membresía en la finca solicitada
    const membershipSnap = await db.collection('memberships')
      .where('uid', '==', uid)
      .where('fincaId', '==', fincaId)
      .limit(1)
      .get();

    if (membershipSnap.empty) {
      return res.status(403).json({ message: 'No tienes acceso a esta organización.' });
    }

    req.uid = uid;
    req.userEmail = decoded.email || '';
    req.fincaId = fincaId;
    req.userRole = membershipSnap.docs[0].data().rol;
    next();
  } catch (error) {
    console.error('[AUTH] Token inválido:', error.message);
    return res.status(401).json({ message: 'Sesión inválida. Inicia sesión de nuevo.' });
  }
};

// Middleware solo de token (sin verificar finca) — para endpoints de auth
const authenticateOnly = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'No autorizado.' });
  }
  try {
    const token = authHeader.split('Bearer ')[1];
    const decoded = await admin.auth().verifyIdToken(token);
    req.uid = decoded.uid;
    req.userEmail = decoded.email;
    next();
  } catch {
    return res.status(401).json({ message: 'Sesión inválida.' });
  }
};

module.exports = { authenticate, authenticateOnly };
