const { Router } = require('express');
const { db, Timestamp } = require('../lib/firebase');
const { authenticateOnly, authenticate } = require('../lib/middleware');
const { sendApiError, ERROR_CODES } = require('../lib/errors');

const router = Router();

// --- API ENDPOINTS: AUTH / MULTI-TENANT ---

// GET /api/auth/memberships — list the authenticated user's fincas
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
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch memberships.', 500);
  }
});

// GET /api/auth/me — user profile in the active finca
router.get('/api/auth/me', authenticate, async (req, res) => {
  try {
    const snap = await db.collection('memberships')
      .where('uid', '==', req.uid)
      .where('fincaId', '==', req.fincaId)
      .limit(1)
      .get();
    if (snap.empty) {
      return sendApiError(res, ERROR_CODES.NOT_FOUND, 'Membership profile not found.', 404);
    }
    const membership = snap.docs[0].data();
    const fincaDoc = await db.collection('fincas').doc(req.fincaId).get();

    // Find the user's doc ID in the users collection (by email)
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
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch user profile.', 500);
  }
});

// POST /api/auth/register-finca — create a new finca and its initial admin
router.post('/api/auth/register-finca', authenticateOnly, async (req, res) => {
  try {
    const { fincaNombre, nombreAdmin } = req.body;
    if (!fincaNombre || !nombreAdmin) {
      return sendApiError(res, ERROR_CODES.MISSING_REQUIRED_FIELDS, 'fincaNombre and nombreAdmin are required.', 400);
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
    res.status(201).json({ fincaId: fincaRef.id, code: 'FINCA_CREATED' });
  } catch (error) {
    console.error('[AUTH] Error creating finca:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to create organization.', 500);
  }
});

// POST /api/auth/claim-invitations — link the user to fincas where they were added by email
router.post('/api/auth/claim-invitations', authenticateOnly, async (req, res) => {
  try {
    const { uid, userEmail } = req;
    if (!userEmail) {
      return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, 'No email found in token.', 400);
    }

    // Find user records that match this email
    const usersSnap = await db.collection('users').where('email', '==', userEmail).get();
    if (usersSnap.empty) return res.status(200).json({ memberships: [] });

    const batch = db.batch();
    const newMemberships = [];

    for (const userDoc of usersSnap.docs) {
      const userData = userDoc.data();
      const { fincaId, nombre, rol, telefono } = userData;
      if (!fincaId) continue;

      // Check if a membership already exists for this uid + finca
      const existingSnap = await db.collection('memberships')
        .where('uid', '==', uid)
        .where('fincaId', '==', fincaId)
        .limit(1)
        .get();

      if (!existingSnap.empty) {
        newMemberships.push({ id: existingSnap.docs[0].id, ...existingSnap.docs[0].data() });
        continue;
      }

      // Fetch finca name
      const fincaDoc = await db.collection('fincas').doc(fincaId).get();
      const fincaNombre = fincaDoc.exists ? fincaDoc.data().nombre : fincaId;

      // Create the membership
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

      // Update the user doc with the uid for future reference
      batch.update(userDoc.ref, { uid });

      newMemberships.push({ id: membershipRef.id, ...membershipData });
    }

    if (newMemberships.length > 0) await batch.commit();
    res.status(200).json({ memberships: newMemberships });
  } catch (error) {
    console.error('[AUTH] Error claiming invitations:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to claim invitations.', 500);
  }
});

module.exports = router;
