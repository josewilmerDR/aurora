#!/usr/bin/env node
// Fail-fast guard for monoliths in functions/routes/.
//
// Standard (docs/code-standards.md §1) targets <500 LOC per route file. This
// script prevents *new* files from regressing into monoliths. Files that are
// already over budget are listed in ALLOWLIST_OVER_500 below — each entry
// must reference the follow-up that will split it. New entries are NOT
// accepted in PRs; CI fails instead, forcing the author to split or to
// explicitly justify the exception.
//
// Run:
//   node scripts/check-routes-loc.cjs
//   exit 0 = all good; exit 1 = at least one un-allowlisted offender.

const fs = require('fs');
const path = require('path');

const MAX_LOC = 500;

// Pre-existing files that exceed MAX_LOC. Each entry MUST be tied to a
// follow-up. Do not add to this list without explicit team agreement.
const ALLOWLIST_OVER_500 = new Map([
  // F5 follow-up: split per-mode (nivel1/nivel2/nivel3) into separate files.
  ['functions/routes/autopilot/analyze.js',          'F5 follow-up — split per nivel'],
  // F8 follow-up — legacy monoliths still pending the same mechanical split
  // applied to hr/, autopilot/, chat/.
  ['functions/routes/field-records.js',              'F8 follow-up — legacy cedulas monolith'],
  ['functions/routes/procurement-invoices.js',       'F8 follow-up — legacy compras monolith'],
  ['functions/routes/monitoring.js',                 'F8 follow-up — legacy monitoreo monolith'],
  ['functions/routes/strategy.js',                   'F8 follow-up — strategy module split'],
  ['functions/routes/products.js',                   'F8 follow-up — legacy productos monolith'],
  ['functions/routes/hr/payroll-unit.js',            'F8 follow-up — payroll-unit secondary split'],
]);

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (entry.isFile() && p.endsWith('.js')) out.push(p);
  }
  return out;
}

const repoRoot = path.resolve(__dirname, '..');
const routesDir = path.join(repoRoot, 'functions', 'routes');
const files = walk(routesDir);

const offenders = [];
const staleAllowlist = [];

for (const abs of files) {
  const rel = path.relative(repoRoot, abs).replace(/\\/g, '/');
  const loc = fs.readFileSync(abs, 'utf8').split('\n').length;
  const allowed = ALLOWLIST_OVER_500.has(rel);

  if (loc > MAX_LOC && !allowed) {
    offenders.push({ rel, loc });
  } else if (loc <= MAX_LOC && allowed) {
    // The file got smaller — allowlist entry is now stale and should be removed.
    staleAllowlist.push({ rel, loc });
  }
}

if (offenders.length > 0) {
  console.error(`✗ Found ${offenders.length} route file(s) over ${MAX_LOC} LOC:`);
  for (const f of offenders) {
    console.error(`    ${f.rel}: ${f.loc} LOC`);
  }
  console.error('');
  console.error('Options:');
  console.error('  - Split the file (preferred — see docs/code-standards.md §1).');
  console.error(`  - If splitting is impractical for this PR, add the path to`);
  console.error(`    ALLOWLIST_OVER_500 in scripts/check-routes-loc.cjs with`);
  console.error(`    a clear follow-up reference (e.g., "F8 follow-up — ...").`);
  process.exit(1);
}

if (staleAllowlist.length > 0) {
  console.error(`✗ ${staleAllowlist.length} allowlist entry(ies) are now under ${MAX_LOC} LOC and should be removed:`);
  for (const f of staleAllowlist) {
    console.error(`    ${f.rel}: ${f.loc} LOC`);
  }
  console.error('Remove these from ALLOWLIST_OVER_500 in scripts/check-routes-loc.cjs.');
  process.exit(1);
}

console.log(`✓ All ${files.length} route files comply with the <${MAX_LOC} LOC budget`);
console.log(`  (${ALLOWLIST_OVER_500.size} grandfathered exception(s) tracked in allowlist).`);
