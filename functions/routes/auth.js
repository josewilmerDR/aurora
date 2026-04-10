const { Router } = require('express');
const { db, Timestamp } = require('../lib/firebase');
const { authenticateOnly, authenticate } = require('../lib/middleware');

const router = Router();

// --- API ENDPOINTS: AUTH / MULTI-TENANT ---

// GET /api/auth/memberships — lista las fincas del usuario autenticado
router.get('/api/auth/memberships', authenticateOnly, async (req, res) => {
  try {
    const snap = await db.collection('memberships')
      .where('uid', '==', req.uid)
      .get();
    const memberships = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    if (memberships.length > 0) {
      const fincaIds = [...new Set(memberships.map(m => m.fincaId))];
      const fincaDocs = await Promise.all(fincaIds.map(id => db.collection('fincas').doc(id).get()));
      const ownerMap = {};
      fincaDocs.forEach(doc => { if (doc.exists) ownerMap[doc.id] = doc.data().adminUid; });
      const enriched = memberships.map(m => ({ ...m, isOwner: ownerMap[m.fincaId] === req.uid }));
      return res.status(200).json({ memberships: enriched });
    }

    res.status(200).json({ memberships });
  } catch (error) {
    console.error('[AUTH] Error fetching memberships:', error);
    res.status(500).json({ message: 'Error al obtener las organizaciones.' });
  }
});

// GET /api/auth/me — perfil del usuario en la finca activa
router.get('/api/auth/me', authenticate, async (req, res) => {
  try {
    const snap = await db.collection('memberships')
      .where('uid', '==', req.uid)
      .where('fincaId', '==', req.fincaId)
      .limit(1)
      .get();
    if (snap.empty) return res.status(404).json({ message: 'Perfil no encontrado.' });
    const membership = snap.docs[0].data();
    const fincaDoc = await db.collection('fincas').doc(req.fincaId).get();

    // Buscar el doc ID del usuario en la colección users (por email)
    let userId = null;
    if (req.userEmail) {
      const userSnap = await db.collection('users')
        .where('fincaId', '==', req.fincaId)
        .where('email', '==', req.userEmail)
        .limit(1)
        .get();
      if (!userSnap.empty) userId = userSnap.docs[0].id;
    }

    res.status(200).json({
      uid: req.uid,
      userId,
      ...membership,
      fincaNombre: fincaDoc.exists ? fincaDoc.data().nombre : '',
    });
  } catch (error) {
    res.status(500).json({ message: 'Error al obtener el perfil.' });
  }
});

// POST /api/auth/register-finca — crea una nueva finca y el admin inicial
router.post('/api/auth/register-finca', authenticateOnly, async (req, res) => {
  try {
    const { fincaNombre, nombreAdmin } = req.body;
    if (!fincaNombre || !nombreAdmin) {
      return res.status(400).json({ message: 'fincaNombre y nombreAdmin son requeridos.' });
    }
    const fincaRef = db.collection('fincas').doc();
    const batch = db.batch();
    batch.set(fincaRef, {
      nombre: fincaNombre,
      adminUid: req.uid,
      plan: 'basic',
      creadoEn: Timestamp.now(),
    });
    const membershipRef = db.collection('memberships').doc();
    batch.set(membershipRef, {
      uid: req.uid,
      fincaId: fincaRef.id,
      fincaNombre,
      email: req.userEmail || '',
      nombre: nombreAdmin,
      telefono: '',
      rol: 'administrador',
      creadoEn: Timestamp.now(),
    });
    await batch.commit();
    res.status(201).json({ fincaId: fincaRef.id, message: 'Organización creada exitosamente.' });
  } catch (error) {
    console.error('[AUTH] Error creating finca:', error);
    res.status(500).json({ message: 'Error al crear la organización.' });
  }
});

// POST /api/auth/claim-invitations — vincula al usuario con las fincas donde fue agregado por email
router.post('/api/auth/claim-invitations', authenticateOnly, async (req, res) => {
  try {
    const { uid, userEmail } = req;
    if (!userEmail) return res.status(400).json({ message: 'No se encontró email en el token.' });

    // Buscar registros en 'users' que coincidan con este email
    const usersSnap = await db.collection('users').where('email', '==', userEmail).get();
    if (usersSnap.empty) return res.status(200).json({ memberships: [] });

    const batch = db.batch();
    const newMemberships = [];

    for (const userDoc of usersSnap.docs) {
      const userData = userDoc.data();
      const { fincaId, nombre, rol, telefono } = userData;
      if (!fincaId) continue;

      // Verificar si ya existe una membresía para este uid + finca
      const existingSnap = await db.collection('memberships')
        .where('uid', '==', uid)
        .where('fincaId', '==', fincaId)
        .limit(1)
        .get();

      if (!existingSnap.empty) {
        newMemberships.push({ id: existingSnap.docs[0].id, ...existingSnap.docs[0].data() });
        continue;
      }

      // Obtener el nombre de la finca
      const fincaDoc = await db.collection('fincas').doc(fincaId).get();
      const fincaNombre = fincaDoc.exists ? fincaDoc.data().nombre : fincaId;

      // Crear la membresía
      const membershipRef = db.collection('memberships').doc();
      const membershipData = {
        uid,
        fincaId,
        fincaNombre,
        email: userEmail,
        nombre: nombre || '',
        telefono: telefono || '',
        rol: rol || 'trabajador',
        creadoEn: Timestamp.now(),
      };
      batch.set(membershipRef, membershipData);

      // Actualizar el doc de usuario con el uid para futuras referencias
      batch.update(userDoc.ref, { uid });

      newMemberships.push({ id: membershipRef.id, ...membershipData });
    }

    if (newMemberships.length > 0) await batch.commit();
    res.status(200).json({ memberships: newMemberships });
  } catch (error) {
    console.error('[AUTH] Error claiming invitations:', error);
    res.status(500).json({ message: 'Error al reclamar invitaciones.' });
  }
});

module.exports = router;
