/**
 * migrate-users-tieneAcceso.js — Backfills the User/Employee split.
 *
 * Adds the new facet flags to every `users` doc so the new backend (which
 * treats `users` as a "persona" registry with two independent facets) can
 * filter and gate correctly:
 *
 *   tieneAcceso = (rol exists && rol !== 'ninguno')
 *               OR doc appears as a non-empty membership target (defensive).
 *   tuvoEmpleo  = (empleadoPlanilla === true)
 *               OR doc id appears as trabajadorId/userId in any HR collection.
 *
 * Idempotent: skips docs that already have BOTH flags set. Re-running after a
 * partial run completes the unfinished work without overwriting.
 *
 * USAGE
 *   # Against the local emulator
 *   set FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 && node functions/scripts/migrate-users-tieneAcceso.js
 *
 *   # Against production (uses ADC — make sure you're authenticated as an
 *   # account with write access to the auroradatabase Firestore)
 *   node functions/scripts/migrate-users-tieneAcceso.js --prod
 *
 * Dry-run (recommended first pass):
 *   node functions/scripts/migrate-users-tieneAcceso.js --dry-run
 *
 * Logs a summary at the end:
 *   - docs scanned
 *   - docs already migrated (skipped)
 *   - docs updated (and what flags were set)
 *   - orphan warnings (tieneAcceso=false && empleadoPlanilla=false) — these
 *     are NOT auto-deleted; review manually.
 */

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has('--dry-run');
const PROD = args.has('--prod');

if (!PROD) {
  process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
}

const admin = require('firebase-admin');
const { getFirestore } = require('firebase-admin/firestore');

admin.initializeApp({ projectId: 'aurora-7dc9b' });
const db = getFirestore(admin.app(), 'auroradatabase');

// HR collections whose presence proves a user was once an employee. Each
// entry lists the foreign-key field on that collection that points back at
// the users doc. hr_fichas uses the document id directly as the FK.
const HR_FK_COLLECTIONS = [
  { name: 'hr_asistencia', field: 'trabajadorId' },
  { name: 'hr_permisos', field: 'trabajadorId' },
  { name: 'hr_payroll_runs', field: 'trabajadorId' },
  { name: 'hr_payroll_fixed', field: 'trabajadorId' },
  { name: 'hr_payroll_unit_entries', field: 'trabajadorId' },
];

async function collectHrFootprints() {
  // One pass over each HR collection, projecting just the FK field. Yields a
  // Set of user ids that have at least one HR record anywhere.
  const ids = new Set();

  const fichasSnap = await db.collection('hr_fichas').get();
  fichasSnap.docs.forEach(d => ids.add(d.id));

  for (const { name, field } of HR_FK_COLLECTIONS) {
    try {
      const snap = await db.collection(name).select(field).get();
      snap.docs.forEach(d => {
        const v = d.data()?.[field];
        if (typeof v === 'string' && v) ids.add(v);
      });
    } catch (err) {
      // Some collections may not exist yet in fresh envs — that's fine.
      if (err?.code !== 5) console.warn(`[hr-scan] ${name}: ${err?.message || err}`);
    }
  }

  return ids;
}

async function main() {
  console.log(`[migrate] mode=${DRY_RUN ? 'DRY-RUN' : 'WRITE'} target=${PROD ? 'PROD' : 'EMULATOR'}`);

  console.log('[migrate] scanning HR collections for foot prints...');
  const hrIds = await collectHrFootprints();
  console.log(`[migrate] found ${hrIds.size} users with HR footprint`);

  const usersSnap = await db.collection('users').get();
  console.log(`[migrate] scanning ${usersSnap.size} user docs`);

  let scanned = 0, skipped = 0, updated = 0, orphans = 0;
  const orphanList = [];
  const updates = []; // [{ id, before, after }]

  for (const doc of usersSnap.docs) {
    scanned++;
    const data = doc.data();
    const hasAccessFlag = typeof data.tieneAcceso === 'boolean';
    const hasTuvoEmpleo = typeof data.tuvoEmpleo === 'boolean';

    // Compute target flags.
    // tieneAcceso: derive from rol. The 'ninguno' sentinel was already in use
    // to mean "no system access", so we honor it. An undefined or empty rol
    // is treated as legacy-with-access (the prior behavior) only if the doc
    // has an email — otherwise it's payroll-only.
    const rol = typeof data.rol === 'string' ? data.rol : '';
    const hasEmail = typeof data.email === 'string' && data.email.trim().length > 0;
    let targetTieneAcceso;
    if (hasAccessFlag) {
      targetTieneAcceso = data.tieneAcceso === true;
    } else if (rol && rol !== 'ninguno') {
      targetTieneAcceso = true;
    } else if (!rol && hasEmail) {
      // Legacy doc without an explicit rol but with an email — most likely
      // a real user from before the rol field was mandatory. Mark for access.
      targetTieneAcceso = true;
    } else {
      targetTieneAcceso = false;
    }

    const targetEmpleado = data.empleadoPlanilla === true;
    const targetTuvoEmpleo = hasTuvoEmpleo
      ? (data.tuvoEmpleo === true) || targetEmpleado || hrIds.has(doc.id)
      : targetEmpleado || hrIds.has(doc.id);

    // Decide if anything actually needs to change.
    const needsAccess = !hasAccessFlag || data.tieneAcceso !== targetTieneAcceso;
    const needsTuvoEmpleo = !hasTuvoEmpleo || data.tuvoEmpleo !== targetTuvoEmpleo;
    // Force rol='ninguno' if access was just denied — keeps the doc internally consistent.
    const needsRolNormalization = !targetTieneAcceso && rol && rol !== 'ninguno';

    if (!needsAccess && !needsTuvoEmpleo && !needsRolNormalization) {
      skipped++;
      continue;
    }

    const patch = {};
    if (needsAccess) patch.tieneAcceso = targetTieneAcceso;
    if (needsTuvoEmpleo) patch.tuvoEmpleo = targetTuvoEmpleo;
    if (needsRolNormalization) patch.rol = 'ninguno';

    updates.push({ id: doc.id, email: data.email || '(no email)', patch });

    if (!targetTieneAcceso && !targetEmpleado && !targetTuvoEmpleo) {
      orphans++;
      orphanList.push({ id: doc.id, nombre: data.nombre || '', email: data.email || '' });
    }

    if (!DRY_RUN) {
      await doc.ref.update(patch);
    }
    updated++;
  }

  console.log('\n──────── SUMMARY ────────');
  console.log(`scanned:  ${scanned}`);
  console.log(`skipped:  ${skipped}  (already migrated)`);
  console.log(`updated:  ${updated}${DRY_RUN ? ' (DRY-RUN, no writes)' : ''}`);
  console.log(`orphans:  ${orphans}  (no access AND no planilla AND no HR history)`);

  if (updates.length && updates.length <= 50) {
    console.log('\nUpdates:');
    for (const u of updates) {
      console.log(`  ${u.id}  ${u.email}  →  ${JSON.stringify(u.patch)}`);
    }
  } else if (updates.length) {
    console.log(`\n(${updates.length} updates — sample of first 20)`);
    for (const u of updates.slice(0, 20)) {
      console.log(`  ${u.id}  ${u.email}  →  ${JSON.stringify(u.patch)}`);
    }
  }

  if (orphanList.length) {
    console.log('\nOrphan docs (review manually — script does NOT delete them):');
    for (const o of orphanList) {
      console.log(`  ${o.id}  "${o.nombre}"  ${o.email}`);
    }
  }
  console.log('─────────────────────────');
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('[migrate] FATAL', err);
    process.exit(1);
  });
