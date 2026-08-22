const { functions } = require('../lib/firebase');
const { exportAuthUsers } = require('../lib/authExport');

// --- SCHEDULED FUNCTION: DAILY FIREBASE AUTH EXPORT ---
// Runs every day at 04:00 America/Costa_Rica (after the managed Firestore
// backup, which lands around 02:00–03:00 local). Writes the full user list,
// password hashes included, to the private backups bucket so a Firestore
// restore can be paired with matching Auth users (docs/firestore-backups.md
// §2.4 item 1). Idempotent per day: same object name, overwritten.
//
// The function's service account needs roles/storage.objectCreator on the
// bucket and the default Editor grant already covers listUsers with hashes.
module.exports = functions.scheduler.onSchedule(
  {
    schedule: '0 4 * * *',
    timeZone: 'America/Costa_Rica',
    retryCount: 2,
    memory: '256MiB',
    timeoutSeconds: 300,
  },
  async () => {
    const result = await exportAuthUsers();
    console.log(`[AUTH-EXPORT] wrote ${result.userCount} users to ${result.object}`);
    return null;
  },
);
