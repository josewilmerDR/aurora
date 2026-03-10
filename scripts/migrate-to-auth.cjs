/**
 * SCRIPT DE MIGRACIÓN — Ejecutar una sola vez contra producción
 *
 * Qué hace:
 *   1. Crea el documento fincas/finca_aurora_test
 *   2. Lee todos los usuarios de la colección `users` (fincaId = finca_aurora_test)
 *   3. Crea una cuenta Firebase Auth por cada usuario (email + contraseña temporal)
 *   4. Crea el documento `memberships/` correspondiente
 *
 * Es idempotente: si algo ya existe, lo salta sin error.
 *
 * Pasos antes de ejecutar:
 *   1. Firebase Console → Project Settings → Service Accounts → Generate new private key
 *      Guarda el archivo como scripts/service-account.json (NO lo subas a git)
 *   2. node scripts/migrate-to-auth.js
 *
 * Después de ejecutar:
 *   - Todos los usuarios tendrán contraseña temporal: Aurora2024!
 *   - Pídeles que la cambien en su primer inicio de sesión
 */

const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

// ─── CONFIGURACIÓN ────────────────────────────────────────────────────────────
const FINCA_ID     = 'finca_aurora_test';
const FINCA_NOMBRE = 'Aurora';           // Cambia esto al nombre real de la finca
const TEMP_PASSWORD = 'Aurora2024!';     // Contraseña temporal para usuarios migrados
// ──────────────────────────────────────────────────────────────────────────────

const serviceAccountPath = path.resolve(__dirname, 'service-account.json');

if (!fs.existsSync(serviceAccountPath)) {
  console.error('\n❌  No se encontró scripts/service-account.json');
  console.error('   Descárgalo en: Firebase Console → Project Settings → Service Accounts → Generate new private key\n');
  process.exit(1);
}

const serviceAccount = require(serviceAccountPath);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();
db.settings({ databaseId: 'auroradatabase' });

// ─── MIGRACIÓN ────────────────────────────────────────────────────────────────

async function migrate() {
  console.log('\n🚀  Iniciando migración hacia Firebase Auth + multi-tenant...\n');

  // PASO 1: Crear documento de finca
  const fincaRef = db.collection('fincas').doc(FINCA_ID);
  const fincaDoc = await fincaRef.get();

  if (!fincaDoc.exists) {
    await fincaRef.set({
      nombre: FINCA_NOMBRE,
      plan: 'basic',
      creadoEn: admin.firestore.Timestamp.now(),
    });
    console.log(`✅  Finca creada: fincas/${FINCA_ID}`);
  } else {
    console.log(`⏭️   Finca ya existe: fincas/${FINCA_ID}`);
  }

  // PASO 2: Leer usuarios existentes
  const usuariosSnap = await db.collection('users')
    .where('fincaId', '==', FINCA_ID)
    .get();

  console.log(`\n📋  Usuarios encontrados: ${usuariosSnap.size}\n`);

  let creados = 0;
  let saltados = 0;
  let errores = 0;

  for (const userDoc of usuariosSnap.docs) {
    const { nombre, email, telefono, rol } = userDoc.data();

    if (!email) {
      console.warn(`⚠️   "${nombre}" no tiene email → saltando`);
      saltados++;
      continue;
    }

    let uid;

    // PASO 3: Crear cuenta Firebase Auth
    try {
      const authUser = await admin.auth().createUser({
        email,
        password: TEMP_PASSWORD,
        displayName: nombre,
      });
      uid = authUser.uid;
      console.log(`✅  Auth creado:    ${email}`);
    } catch (err) {
      if (err.code === 'auth/email-already-exists') {
        const existing = await admin.auth().getUserByEmail(email);
        uid = existing.uid;
        console.log(`⏭️   Auth ya existe: ${email}`);
      } else {
        console.error(`❌  Error en Auth para ${email}: ${err.message}`);
        errores++;
        continue;
      }
    }

    // PASO 4: Crear membership si no existe
    const existingSnap = await db.collection('memberships')
      .where('uid', '==', uid)
      .where('fincaId', '==', FINCA_ID)
      .limit(1)
      .get();

    if (existingSnap.empty) {
      await db.collection('memberships').add({
        uid,
        fincaId: FINCA_ID,
        fincaNombre: FINCA_NOMBRE,
        email,
        nombre,
        telefono: telefono || '',
        rol: rol || 'trabajador',
        creadoEn: admin.firestore.Timestamp.now(),
      });
      console.log(`   ↳ Membership creada: ${nombre} (${rol || 'trabajador'})`);
      creados++;
    } else {
      console.log(`   ↳ Membership ya existe: ${nombre}`);
      saltados++;
    }
  }

  console.log('\n─────────────────────────────────────────');
  console.log(`✅  Creados:  ${creados}`);
  console.log(`⏭️   Saltados: ${saltados}`);
  if (errores > 0) console.log(`❌  Errores:  ${errores}`);
  console.log('─────────────────────────────────────────');
  console.log('\n🎉  Migración completada!');
  console.log(`\n🔑  Contraseña temporal de todos los usuarios: "${TEMP_PASSWORD}"`);
  console.log('   Pídeles que la cambien al iniciar sesión por primera vez.\n');
}

migrate().catch(console.error).finally(() => process.exit());
