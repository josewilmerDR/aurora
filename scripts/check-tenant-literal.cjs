#!/usr/bin/env node
/**
 * Guard estático: el literal "Finca Aurora" no puede volver al código de
 * producto. Era el fallback hardcodeado de identidad de inquilino en nueve
 * documentos imprimibles — un cliente imprimiendo una OC o planilla con el
 * nombre de otra empresa. La identidad sale ahora de la cascada
 * nombreEmpresa → organización (src/lib/empresa.js + useEmpresaConfig).
 *
 * Allowlist explícita (revisada a mano — cada entrada es texto de EJEMPLO
 * visible como placeholder, no identidad del inquilino):
 *   - account-settings.js  → placeholder "Ej: Finca Aurora S.A."
 *   - InitialSetup.jsx     → fila de ejemplo del CSV de maquinaria
 *   - MaquinariaList.jsx   → placeholder "Ej. Finca Aurora"
 *
 * NO extender el patrón a "Aurora" a secas: el pie "Documento generado por
 * Sistema Aurora" identifica al software emisor y es correcto — no tocarlo
 * ni reportarlo.
 *
 * Mismo estilo que check-routes-loc.cjs: cero deps, corre en CI.
 */

const fs = require('fs');
const path = require('path');

const LITERAL = /Finca Aurora/;

const SCAN_DIRS = ['src', 'functions/routes', 'functions/lib'];
const SCAN_EXT = new Set(['.js', '.jsx']);

const ALLOWLIST = new Set([
  'src/features/account/lib/account-settings.js',
  'src/features/admin/pages/InitialSetup.jsx',
  'src/features/machinery/pages/MaquinariaList.jsx',
]);

const repoRoot = path.resolve(__dirname, '..');

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '__tests__') continue;
    // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (entry.isFile() && SCAN_EXT.has(path.extname(p))) out.push(p);
  }
  return out;
}

const offenders = [];
const staleAllowlist = new Set(ALLOWLIST);

for (const dir of SCAN_DIRS) {
  for (const abs of walk(path.join(repoRoot, dir))) {
    const rel = path.relative(repoRoot, abs).replace(/\\/g, '/');
    const lines = fs.readFileSync(abs, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (!LITERAL.test(line)) return;
      if (ALLOWLIST.has(rel)) { staleAllowlist.delete(rel); return; }
      offenders.push(`${rel}:${i + 1}: ${line.trim().slice(0, 120)}`);
    });
  }
}

let failed = false;

if (offenders.length > 0) {
  failed = true;
  console.error('✖ Literal de inquilino "Finca Aurora" fuera de la allowlist:\n');
  offenders.forEach(o => console.error(`  ${o}`));
  console.error(
    '\nLa identidad del documento debe salir de la cascada nombreEmpresa → organización' +
    '\n(src/lib/empresa.js + useEmpresaConfig/useEmpresaIdentity + DocBrand). Si es un' +
    '\nplaceholder de ejemplo legítimo, agregalo a la allowlist de scripts/check-tenant-literal.cjs.'
  );
}

for (const rel of staleAllowlist) {
  failed = true;
  console.error(`✖ Entrada de allowlist sin ocurrencias (quitar de la lista): ${rel}`);
}

if (failed) process.exit(1);
console.log('✓ Sin literales de inquilino fuera de la allowlist.');
