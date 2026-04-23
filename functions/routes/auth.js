const { Router } = require('express');
const { db, Timestamp } = require('../lib/firebase');
const { authenticateOnly, authenticate } = require('../lib/middleware');
const { sendApiError, ERROR_CODES } = require('../lib/errors');
const { ROLE_LEVELS_BE } = require('../lib/helpers');
const { MODULE_PREFIXES } = require('../lib/moduleMap');

const router = Router();

// --- CONSTRAINTS ---

// Cap fincas a single user can own. Prevents storage/cost abuse from a stolen
// or trial account creating an unbounded number of organizations.
const MAX_FINCAS_PER_USER = 10;

// Cap how many user docs we will iterate when claiming invitations. Prevents
// amplified load if, by bug or malice, the users collection grows N rows for
// a single email.
const MAX_USER_DOCS_PER_CLAIM = 50;

// Whitelist of roles accepted when a membership is materialized from a users
// doc during invitation claim. Anything outside this set is downgraded to
// 'trabajador' (the safest default). Kept in sync with ROLE_LEVELS_BE.
const VALID_ROLES = new Set(Object.keys(ROLE_LEVELS_BE));

// Whitelist of sidebar module ids for the optional `restrictedTo` field.
// Unknown ids are silently dropped during claim.
const VALID_MODULE_IDS = new Set(Object.keys(MODULE_PREFIXES));

// Deterministic membership ID: one membership per (uid, fincaId). Makes
// concurrent claims idempotent — the second write hits the same doc.
function membershipDocId(uid, fincaId) {
  return `${uid}__${fincaId}`;
}

// Length-bounded string with trim. Returns null if the value is not a string
// or becomes empty after trimming (so callers can reject missing fields).
function cleanString(value, { maxLength }) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  return trimmed.slice(0, maxLength);
}

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
    console.error('[AUTH] /me error:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch user profile.', 500);
  }
});

// POST /api/auth/register-finca — create a new finca and its initial admin
router.post('/api/auth/register-finca', authenticateOnly, async (req, res) => {
  try {
    const fincaNombre = cleanString(req.body?.fincaNombre, { maxLength: 120 });
    const nombreAdmin = cleanString(req.body?.nombreAdmin, { maxLength: 80 });
    if (!fincaNombre || !nombreAdmin) {
      return sendApiError(res, ERROR_CODES.MISSING_REQUIRED_FIELDS, 'fincaNombre and nombreAdmin are required (non-empty strings).', 400);
    }

    // Per-user cap on owned fincas. Ownership is tracked by fincas.adminUid,
    // which matches the uid that created the org. A user can still be member
    // of many fincas they did not create — that is a different limit.
    const ownedSnap = await db.collection('fincas')
      .where('adminUid', '==', req.uid)
      .limit(MAX_FINCAS_PER_USER + 1)
      .get();
    if (ownedSnap.size >= MAX_FINCAS_PER_USER) {
      return sendApiError(
        res,
        ERROR_CODES.VALIDATION_FAILED,
        `Maximum of ${MAX_FINCAS_PER_USER} organizations per user reached.`,
        429,
      );
    }

    const fincaRef = db.collection('fincas').doc();
    const batch = db.batch();
    batch.set(fincaRef, {
      nombre: fincaNombre,
      adminUid: req.uid,
      plan: 'basic',
      creadoEn: Timestamp.now(),
    });
    const membershipRef = db.collection('memberships').doc(membershipDocId(req.uid, fincaRef.id));
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

    // Find user records that match this email. Limit caps amplification if
    // the users collection somehow ends up with many matches.
    const usersSnap = await db.collection('users')
      .where('email', '==', userEmail)
      .limit(MAX_USER_DOCS_PER_CLAIM)
      .get();
    if (usersSnap.empty) return res.status(200).json({ memberships: [] });

    const batch = db.batch();
    const newMemberships = [];

    for (const userDoc of usersSnap.docs) {
      const userData = userDoc.data();
      const { fincaId, nombre, rol, telefono } = userData;
      if (!fincaId) continue;

      // Check for existing membership by query first, to stay compatible with
      // pre-existing auto-id memberships. Only new memberships are created
      // with a deterministic id (uid__fincaId) so concurrent claims cannot
      // materialize duplicates.
      const existingSnap = await db.collection('memberships')
        .where('uid', '==', uid)
        .where('fincaId', '==', fincaId)
        .limit(1)
        .get();
      if (!existingSnap.empty) {
        newMemberships.push({ id: existingSnap.docs[0].id, ...existingSnap.docs[0].data() });
        continue;
      }

      const membershipId = membershipDocId(uid, fincaId);
      const membershipRef = db.collection('memberships').doc(membershipId);

      // Fetch finca name
      const fincaDoc = await db.collection('fincas').doc(fincaId).get();
      const fincaNombre = fincaDoc.exists ? fincaDoc.data().nombre : fincaId;

      // Whitelist-validate the role materialized from the users doc. Anything
      // outside ROLE_LEVELS_BE is downgraded to the safest default. Without
      // this, a bug elsewhere that writes an arbitrary string into users.rol
      // would propagate into memberships.
      const safeRol = typeof rol === 'string' && VALID_ROLES.has(rol) ? rol : 'trabajador';

      // Copy the module-restriction list (if any) from the users doc, but
      // scrub it against the module whitelist so a corrupted users row cannot
      // inject unknown ids into the membership.
      const rawRestricted = Array.isArray(userData.restrictedTo) ? userData.restrictedTo : [];
      const safeRestricted = [...new Set(
        rawRestricted.filter(v => typeof v === 'string' && VALID_MODULE_IDS.has(v))
      )].sort();

      const membershipData = {
        uid,
        fincaId,
        fincaNombre,
        email: userEmail,
        nombre: nombre || '',
        telefono: telefono || '',
        rol: safeRol,
        restrictedTo: safeRestricted,
        creadoEn: Timestamp.now(),
      };
      batch.set(membershipRef, membershipData);

      // Update the user doc with the uid for future reference
      batch.update(userDoc.ref, { uid });

      newMemberships.push({ id: membershipId, ...membershipData });
    }

    if (newMemberships.length > 0) await batch.commit();
    res.status(200).json({ memberships: newMemberships });
  } catch (error) {
    console.error('[AUTH] Error claiming invitations:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to claim invitations.', 500);
  }
});

module.exports = router;
