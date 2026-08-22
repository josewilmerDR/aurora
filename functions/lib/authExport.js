// Firebase Auth (Identity Platform) export for disaster recovery.
//
// A Firestore restore alone is not a recovery: memberships point at Auth
// UIDs, and Auth lives outside Firestore. Without a recent export of the
// users, nobody can log in after a rebuild (docs/firestore-backups.md §2.4).
//
// The export is a JSON document compatible with `firebase auth:import`
// (same field names as `firebase auth:export --format json`), written to the
// private backups bucket. Password hashes are included — they are what makes
// the import a real restore instead of a "reset every password" event — so
// the bucket MUST stay private (uniform access + public-access prevention;
// lifecycle deletes objects after AUTH_EXPORT_RETENTION_DAYS).

const { admin } = require('./firebase');

const BACKUPS_BUCKET = 'aurora-7dc9b-firestore-backups';
const AUTH_EXPORT_PREFIX = 'auth/';
const AUTH_EXPORT_RETENTION_DAYS = 30; // enforced by the bucket lifecycle rule
const PAGE_SIZE = 1000; // Admin SDK maximum per listUsers page

// Shape one Admin SDK UserRecord into the auth:import schema. Pure.
function toImportRecord(user) {
  return {
    localId: user.uid,
    email: user.email || undefined,
    emailVerified: Boolean(user.emailVerified),
    displayName: user.displayName || undefined,
    phoneNumber: user.phoneNumber || undefined,
    photoUrl: user.photoURL || undefined,
    disabled: Boolean(user.disabled),
    passwordHash: user.passwordHash || undefined,
    salt: user.passwordSalt || undefined,
    customAttributes: user.customClaims && Object.keys(user.customClaims).length
      ? JSON.stringify(user.customClaims)
      : undefined,
    createdAt: user.metadata?.creationTime
      ? String(Date.parse(user.metadata.creationTime))
      : undefined,
    lastSignedInAt: user.metadata?.lastSignInTime
      ? String(Date.parse(user.metadata.lastSignInTime))
      : undefined,
    providerUserInfo: (user.providerData || []).map((p) => ({
      providerId: p.providerId,
      rawId: p.uid,
      email: p.email || undefined,
      displayName: p.displayName || undefined,
      photoUrl: p.photoURL || undefined,
    })),
  };
}

// Build the whole export document. Pure — `users` is an array of UserRecords.
function buildAuthExport(users, now = new Date()) {
  return {
    exportedAt: now.toISOString(),
    project: 'aurora-7dc9b',
    userCount: users.length,
    users: users.map(toImportRecord),
  };
}

// Object name per day: `auth/auth-users-YYYY-MM-DD.json`. Re-running the job
// the same day overwrites the same object instead of piling up copies.
function exportObjectName(now = new Date()) {
  return `${AUTH_EXPORT_PREFIX}auth-users-${now.toISOString().slice(0, 10)}.json`;
}

// Page through every user. Injected `auth` so tests do not need Identity
// Platform; defaults to the real Admin SDK.
async function listAllUsers(auth = admin.auth()) {
  const users = [];
  let pageToken;
  do {
    const page = await auth.listUsers(PAGE_SIZE, pageToken);
    users.push(...page.users);
    pageToken = page.pageToken;
  } while (pageToken);
  return users;
}

// Orchestrator used by the cron. Returns what was written for logging.
async function exportAuthUsers({
  auth = admin.auth(),
  bucket = admin.storage().bucket(BACKUPS_BUCKET),
  now = new Date(),
} = {}) {
  const users = await listAllUsers(auth);
  const doc = buildAuthExport(users, now);
  const name = exportObjectName(now);
  await bucket.file(name).save(JSON.stringify(doc), {
    contentType: 'application/json',
    resumable: false,
    metadata: { metadata: { userCount: String(users.length) } },
  });
  return { object: `gs://${bucket.name}/${name}`, userCount: users.length };
}

module.exports = {
  BACKUPS_BUCKET,
  AUTH_EXPORT_PREFIX,
  AUTH_EXPORT_RETENTION_DAYS,
  toImportRecord,
  buildAuthExport,
  exportObjectName,
  listAllUsers,
  exportAuthUsers,
};
