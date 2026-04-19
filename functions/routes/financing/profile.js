// Handlers for `/api/financing/profile/...` — Fase 5.1.
//
// Endpoints:
//   GET  /api/financing/profile/live
//   POST /api/financing/profile/snapshot
//   GET  /api/financing/profile/snapshots
//   GET  /api/financing/profile/snapshots/:id
//   GET  /api/financing/profile/snapshots/:id/export?format=json|html

const { db, FieldValue } = require('../../lib/firebase');
const { sendApiError, ERROR_CODES } = require('../../lib/errors');
const { hasMinRoleBE, verifyOwnership } = require('../../lib/helpers');
const { buildFinancialProfile } = require('../../lib/financing/financialProfileBuilder');
const { toHtml, toJson } = require('../../lib/financing/profileExporter');

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidISODate(s) {
  if (typeof s !== 'string' || !ISO_DATE_RE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

// ─── Live profile ─────────────────────────────────────────────────────────

async function getLiveProfile(req, res) {
  try {
    if (!hasMinRoleBE(req.userRole, 'supervisor')) {
      return sendApiError(res, ERROR_CODES.INSUFFICIENT_ROLE, 'Requires supervisor role or above.', 403);
    }

    const asOf = req.query.asOf;
    if (asOf && !isValidISODate(asOf)) {
      return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'asOf must be YYYY-MM-DD.', 400);
    }

    const profile = await buildFinancialProfile(req.fincaId, { asOf });
    res.json({ ...profile, snapshotId: null, isLive: true });
  } catch (error) {
    console.error('[FINANCING] live profile failed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to build live financial profile.', 500);
  }
}

// ─── Snapshot create ──────────────────────────────────────────────────────

async function createSnapshot(req, res) {
  try {
    if (!hasMinRoleBE(req.userRole, 'administrador')) {
      return sendApiError(res, ERROR_CODES.INSUFFICIENT_ROLE, 'Only administrador can create snapshots.', 403);
    }

    const asOf = req.body?.asOf;
    if (asOf && !isValidISODate(asOf)) {
      return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'asOf must be YYYY-MM-DD.', 400);
    }

    const profile = await buildFinancialProfile(req.fincaId, { asOf });

    const docRef = await db.collection('financial_profile_snapshots').add({
      fincaId: req.fincaId,
      generatedBy: req.uid,
      generatedByEmail: req.userEmail || '',
      generatedByRole: req.userRole,
      generatedAt: FieldValue.serverTimestamp(),
      asOf: profile.asOf,
      historyRange: profile.historyRange,
      projectionRange: profile.projectionRange,
      balanceSheet: profile.balanceSheet,
      incomeStatement: profile.incomeStatement,
      cashFlow: profile.cashFlow,
      inputsHash: profile.inputsHash,
      sourceCounts: profile.sourceCounts,
    });

    res.status(201).json({ id: docRef.id, ...profile });
  } catch (error) {
    console.error('[FINANCING] snapshot create failed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to create financial snapshot.', 500);
  }
}

// ─── Snapshot list ────────────────────────────────────────────────────────

async function listSnapshots(req, res) {
  try {
    if (!hasMinRoleBE(req.userRole, 'supervisor')) {
      return sendApiError(res, ERROR_CODES.INSUFFICIENT_ROLE, 'Requires supervisor role or above.', 403);
    }

    const snap = await db.collection('financial_profile_snapshots')
      .where('fincaId', '==', req.fincaId)
      .orderBy('generatedAt', 'desc')
      .limit(50)
      .get();

    const rows = snap.docs.map(d => {
      const data = d.data();
      return {
        id: d.id,
        asOf: data.asOf,
        generatedAt: data.generatedAt?.toDate?.()?.toISOString?.() || null,
        generatedByEmail: data.generatedByEmail || '',
        inputsHash: data.inputsHash,
        totalAssets: data.balanceSheet?.assets?.totalAssets ?? 0,
        totalEquity: data.balanceSheet?.equity?.totalEquity ?? 0,
        revenue: data.incomeStatement?.revenue?.amount ?? 0,
        netMargin: data.incomeStatement?.netMargin ?? 0,
      };
    });

    res.json(rows);
  } catch (error) {
    console.error('[FINANCING] snapshot list failed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to list financial snapshots.', 500);
  }
}

// ─── Snapshot detail ──────────────────────────────────────────────────────

async function getSnapshot(req, res) {
  try {
    if (!hasMinRoleBE(req.userRole, 'supervisor')) {
      return sendApiError(res, ERROR_CODES.INSUFFICIENT_ROLE, 'Requires supervisor role or above.', 403);
    }

    const ownership = await verifyOwnership('financial_profile_snapshots', req.params.id, req.fincaId);
    if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);

    const data = ownership.doc.data();
    res.json({
      id: ownership.doc.id,
      ...data,
      generatedAt: data.generatedAt?.toDate?.()?.toISOString?.() || null,
    });
  } catch (error) {
    console.error('[FINANCING] snapshot get failed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to fetch snapshot.', 500);
  }
}

// ─── Snapshot export ──────────────────────────────────────────────────────

async function exportSnapshot(req, res) {
  try {
    if (!hasMinRoleBE(req.userRole, 'administrador')) {
      return sendApiError(res, ERROR_CODES.INSUFFICIENT_ROLE, 'Only administrador can export snapshots.', 403);
    }

    const ownership = await verifyOwnership('financial_profile_snapshots', req.params.id, req.fincaId);
    if (!ownership.ok) return sendApiError(res, ownership.code, ownership.message, ownership.status);

    const format = (req.query.format || 'json').toLowerCase();
    if (!['json', 'html'].includes(format)) {
      return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'Format must be "json" or "html".', 400);
    }

    const data = ownership.doc.data();
    const profile = {
      fincaId: data.fincaId,
      asOf: data.asOf,
      historyRange: data.historyRange,
      projectionRange: data.projectionRange,
      balanceSheet: data.balanceSheet,
      incomeStatement: data.incomeStatement,
      cashFlow: data.cashFlow,
      inputsHash: data.inputsHash,
      sourceCounts: data.sourceCounts,
    };
    const meta = {
      snapshotId: ownership.doc.id,
      generatedAt: data.generatedAt?.toDate?.()?.toISOString?.() || null,
      generatedByEmail: data.generatedByEmail || '',
    };

    if (format === 'html') {
      res.set('Content-Type', 'text/html; charset=utf-8');
      res.set('Content-Disposition', `inline; filename="financial_profile_${data.asOf}.html"`);
      return res.send(toHtml(profile, meta));
    }

    res.set('Content-Type', 'application/json; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="financial_profile_${data.asOf}.json"`);
    res.send(toJson(profile, meta));
  } catch (error) {
    console.error('[FINANCING] snapshot export failed:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to export snapshot.', 500);
  }
}

module.exports = {
  getLiveProfile,
  createSnapshot,
  listSnapshots,
  getSnapshot,
  exportSnapshot,
};
