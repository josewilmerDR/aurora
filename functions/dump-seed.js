/**
 * dump-seed.js — Exporta el estado actual del emulador y sobreescribe seed.js.
 *
 * USO (con el emulador corriendo):
 *   node functions/dump-seed.js
 *
 * Colecciones exportadas: users, productos, packages, lotes, cedulas,
 *                         maquinaria, calibraciones
 * Colecciones omitidas:   scheduled_tasks (se regeneran al crear lotes),
 *                         movimientos (log de transacciones),
 *                         cedula_counters (contadores auto-gestionados)
 */

process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';

const admin = require('firebase-admin');
const { getFirestore } = require('firebase-admin/firestore');
const fs = require('fs');
const path = require('path');

admin.initializeApp({ projectId: 'aurora-7dc9b' });
const db = getFirestore(admin.app(), 'auroradatabase');

const FINCA_ID = 'finca_aurora_test';

// ─── SERIALIZACIÓN ────────────────────────────────────────────────────────────

// Marca los Timestamps de Firestore con un prefijo para luego regenerar el código
function normalizeTimestamps(obj) {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'object' && typeof obj.toDate === 'function') {
    return '__TS__' + obj.toDate().toISOString();
  }
  if (Array.isArray(obj)) return obj.map(normalizeTimestamps);
  if (typeof obj === 'object') {
    return Object.fromEntries(
      Object.entries(obj).map(([k, v]) => [k, normalizeTimestamps(v)])
    );
  }
  return obj;
}

// Convierte un valor JS a código fuente JS legible
function jsLiteral(value, depth = 0) {
  const pad   = '  '.repeat(depth);
  const inner = '  '.repeat(depth + 1);

  if (value === null || value === undefined) return 'null';
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  if (typeof value === 'string') {
    if (value.startsWith('__TS__')) {
      return `Timestamp.fromDate(new Date(${JSON.stringify(value.slice(6))}))`;
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    if (!value.length) return '[]';
    return `[\n${value.map(v => inner + jsLiteral(v, depth + 1)).join(',\n')},\n${pad}]`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value);
    if (!entries.length) return '{}';
    const lines = entries.map(([k, v]) => `${inner}${k}: ${jsLiteral(v, depth + 1)}`);
    return `{\n${lines.join(',\n')},\n${pad}}`;
  }
  return String(value);
}

// Genera el bloque  const NOMBRE = [...];
function collectionBlock(varName, docs) {
  if (!docs.length) return `const ${varName} = [];`;
  const items = docs.map(({ id, ...data }) => {
    const lines = Object.entries(data)
      .map(([k, v]) => `    ${k}: ${jsLiteral(v, 2)}`)
      .join(',\n');
    return `  {\n    id: ${JSON.stringify(id)},\n${lines},\n  }`;
  });
  return `const ${varName} = [\n${items.join(',\n')},\n];`;
}

// ─── LECTURA DEL EMULADOR ─────────────────────────────────────────────────────

async function fetchByFinca(collection) {
  const snap = await db.collection(collection).where('fincaId', '==', FINCA_ID).get();
  return snap.docs.map(d => ({ id: d.id, ...normalizeTimestamps(d.data()) }));
}

// ─── GENERACIÓN DE seed.js ────────────────────────────────────────────────────

function buildSeedFile({ users, productos, packages, lotes, cedulas, maquinaria, calibraciones, today }) {
  return `/**
 * seed.js — Pobla el emulador de Firebase con datos para Aurora.
 * Generado con dump-seed.js el ${today}.
 *
 * USO (con el emulador corriendo):
 *   node functions/seed.js
 */

process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';

const admin = require('firebase-admin');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');

admin.initializeApp({ projectId: 'aurora-7dc9b' });
const db = getFirestore(admin.app(), 'auroradatabase');
const auth = getAuth();

const FINCA_ID = 'finca_aurora_test';
const ADMIN_EMAIL = 'admin@aurora.test';
const ADMIN_PASSWORD = 'admin123';
const ADMIN_NOMBRE = 'Admin Aurora';

${collectionBlock('USUARIOS', users)}

${collectionBlock('PRODUCTOS', productos)}

${collectionBlock('PAQUETES', packages)}

${collectionBlock('LOTES', lotes)}

${collectionBlock('CEDULAS', cedulas)}

${collectionBlock('MAQUINARIA', maquinaria)}

${collectionBlock('CALIBRACIONES', calibraciones)}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

async function upsertAuthUser() {
  try {
    const existing = await auth.getUserByEmail(ADMIN_EMAIL);
    console.log(\`  ✓ Usuario Auth ya existe: \${existing.uid}\`);
    return existing.uid;
  } catch (e) {
    if (e.code === 'auth/user-not-found') {
      const u = await auth.createUser({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD, displayName: ADMIN_NOMBRE });
      console.log(\`  ✓ Usuario Auth creado: \${u.uid}\`);
      return u.uid;
    }
    throw e;
  }
}

async function upsert(collection, id, data) {
  await db.collection(collection).doc(id).set(data);
  console.log(\`  ✓ \${collection}/\${id}\`);
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function seed() {
  console.log('\\n🌱 Iniciando seed del emulador Aurora...\\n');

  console.log('1. Usuario admin (Auth)...');
  const adminUid = await upsertAuthUser();

  console.log('\\n2. Finca...');
  await upsert('fincas', FINCA_ID, {
    nombre: 'Finca Aurora (Test)',
    adminUid,
    plan: 'basic',
    creadoEn: Timestamp.now(),
  });

  console.log('\\n3. Membership admin...');
  await upsert('memberships', \`membership_\${adminUid}_\${FINCA_ID}\`, {
    uid: adminUid,
    fincaId: FINCA_ID,
    fincaNombre: 'Finca Aurora (Test)',
    email: ADMIN_EMAIL,
    nombre: ADMIN_NOMBRE,
    telefono: '+50688000000',
    rol: 'administrador',
    creadoEn: Timestamp.now(),
  });

  console.log('\\n4. Usuarios...');
  for (const { id, ...data } of USUARIOS) await upsert('users', id, data);

  console.log('\\n5. Productos...');
  for (const { id, ...data } of PRODUCTOS) await upsert('productos', id, data);

  console.log('\\n6. Paquetes...');
  for (const { id, ...data } of PAQUETES) await upsert('packages', id, data);

  console.log('\\n7. Lotes...');
  for (const { id, ...data } of LOTES) await upsert('lotes', id, data);

  console.log('\\n8. Cédulas...');
  for (const { id, ...data } of CEDULAS) await upsert('cedulas', id, data);

  console.log('\\n9. Maquinaria...');
  for (const { id, ...data } of MAQUINARIA) await upsert('maquinaria', id, data);

  console.log('\\n10. Calibraciones...');
  for (const { id, ...data } of CALIBRACIONES) await upsert('calibraciones', id, data);

  console.log('\\n✅ Seed completado.');
  console.log(\`   Admin: \${ADMIN_EMAIL} / \${ADMIN_PASSWORD}\\n\`);
  console.log('   ⚠️  Las scheduled_tasks no se restauraron.');
  console.log('      Si necesitas tareas activas, recrea los lotes desde la UI.\\n');
  process.exit(0);
}

seed().catch(err => {
  console.error('\\n❌ Error en seed:', err.message);
  process.exit(1);
});
`;
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n📦 Leyendo estado actual del emulador...\n');

  const [users, productos, packages, lotes, cedulas, maquinaria, calibraciones] =
    await Promise.all([
      fetchByFinca('users'),
      fetchByFinca('productos'),
      fetchByFinca('packages'),
      fetchByFinca('lotes'),
      fetchByFinca('cedulas'),
      fetchByFinca('maquinaria'),
      fetchByFinca('calibraciones'),
    ]);

  const counts = { users, productos, packages, lotes, cedulas, maquinaria, calibraciones };
  for (const [name, docs] of Object.entries(counts)) {
    console.log(`  ${name.padEnd(14)}: ${docs.length} doc(s)`);
  }
  console.log(`  ${'scheduled_tasks'.padEnd(14)}: omitidas`);
  console.log(`  ${'movimientos'.padEnd(14)}: omitidas`);

  const today = new Date().toISOString().slice(0, 10);
  const output = buildSeedFile({ users, productos, packages, lotes, cedulas, maquinaria, calibraciones, today });

  const outputPath = path.join(__dirname, 'seed.js');
  fs.writeFileSync(outputPath, output, 'utf8');

  console.log(`\n✅ seed.js actualizado (${today})`);
  console.log(`   Ruta: ${outputPath}\n`);
  process.exit(0);
}

main().catch(err => {
  console.error('\n❌ Error:', err.message);
  console.error('   ¿Está el emulador corriendo? (firebase emulators:start)\n');
  process.exit(1);
});
