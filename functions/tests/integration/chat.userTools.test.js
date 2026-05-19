/**
 * Integration: chat tool implementations for users (crear/editar empleado).
 *
 * The chat tools write directly to Firestore — they don't go through the HTTP
 * routes — so they need their own coverage for the invariants we replicated
 * inline in toolImpls.js (tieneAcceso ↔ rol/email, tuvoEmpleo monotonicity,
 * fechaSalidaPlanilla bookkeeping, membership cleanup on revoke-access).
 *
 * Requires the Firestore emulator running. Run via:
 *   cd functions && npm run test:emulator -- --testPathPattern=chat.userTools
 */

jest.mock('../../lib/clients', () => ({
  getTwilioClient: jest.fn(),
  getAnthropicClient: jest.fn(),
}));

const { db } = require('../../lib/firebase');
const {
  chatToolCrearEmpleado,
  chatToolEditarEmpleado,
} = require('../../routes/chat/toolImpls');
const { uniqueFincaId } = require('../helpers');

// The shared cleanupFinca helper doesn't cover users/memberships, so we have
// a focused cleanup that drops exactly the docs each test creates.
async function cleanupUsersFinca(fincaId) {
  for (const col of ['users', 'memberships']) {
    const snap = await db.collection(col).where('fincaId', '==', fincaId).get();
    const batch = db.batch();
    snap.docs.forEach(d => batch.delete(d.ref));
    if (!snap.empty) await batch.commit();
  }
}

describe('chatToolCrearEmpleado', () => {
  const fincas = [];
  afterAll(async () => Promise.all(fincas.map(cleanupUsersFinca)));

  test('rejects orphan creation (no facets set)', async () => {
    const fincaId = uniqueFincaId('chat_orphan');
    fincas.push(fincaId);
    const result = await chatToolCrearEmpleado({ nombre: 'Sin facetas' }, fincaId);
    expect(result.error).toMatch(/usuario del sistema.*planilla/i);
  });

  test('creates a payroll-only person with no email and rol=ninguno', async () => {
    const fincaId = uniqueFincaId('chat_payroll_only');
    fincas.push(fincaId);
    const result = await chatToolCrearEmpleado(
      { nombre: 'Carmen Solís', empleadoPlanilla: true },
      fincaId,
    );
    expect(result.ok).toBe(true);
    const doc = await db.collection('users').doc(result.id).get();
    const data = doc.data();
    expect(data.empleadoPlanilla).toBe(true);
    expect(data.tieneAcceso).toBe(false);
    expect(data.tuvoEmpleo).toBe(true); // monotonic seed
    expect(data.rol).toBe('ninguno');
    expect(data.email).toBe('');
  });

  test('rejects tieneAcceso=true without email or rol', async () => {
    const fincaId = uniqueFincaId('chat_no_email');
    fincas.push(fincaId);
    const r1 = await chatToolCrearEmpleado(
      { nombre: 'Sin email', tieneAcceso: true, rol: 'trabajador' },
      fincaId,
    );
    expect(r1.error).toMatch(/email/i);
    const r2 = await chatToolCrearEmpleado(
      { nombre: 'Sin rol', tieneAcceso: true, email: 'sinrol@finca.com' },
      fincaId,
    );
    expect(r2.error).toMatch(/rol/i);
  });

  test('rejects duplicate email within the same finca', async () => {
    const fincaId = uniqueFincaId('chat_dup_email');
    fincas.push(fincaId);
    await chatToolCrearEmpleado(
      { nombre: 'Original', email: 'dup@finca.com', tieneAcceso: true, rol: 'trabajador' },
      fincaId,
    );
    const result = await chatToolCrearEmpleado(
      { nombre: 'Dupe', email: 'dup@finca.com', tieneAcceso: true, rol: 'encargado' },
      fincaId,
    );
    expect(result.error).toMatch(/ya existe/i);
  });

  test('seeds tuvoEmpleo=false when only tieneAcceso is true', async () => {
    const fincaId = uniqueFincaId('chat_user_only');
    fincas.push(fincaId);
    const result = await chatToolCrearEmpleado(
      { nombre: 'Solo usuario', email: 'user@finca.com', tieneAcceso: true, rol: 'rrhh' },
      fincaId,
    );
    expect(result.ok).toBe(true);
    const doc = await db.collection('users').doc(result.id).get();
    expect(doc.data().tuvoEmpleo).toBe(false);
    expect(doc.data().empleadoPlanilla).toBe(false);
    expect(doc.data().rol).toBe('rrhh');
  });
});

describe('chatToolEditarEmpleado', () => {
  const fincas = [];
  afterAll(async () => Promise.all(fincas.map(cleanupUsersFinca)));

  // Reusable seed: a person with both facets active, with an email that lets
  // us also test membership cleanup on revoke-access.
  async function seedFullPerson(fincaId) {
    const result = await chatToolCrearEmpleado(
      { nombre: 'Diego Pérez', email: 'diego@finca.com', tieneAcceso: true, rol: 'trabajador', empleadoPlanilla: true },
      fincaId,
    );
    // Seed a membership doc that the revoke-access path should clean up.
    await db.collection('memberships').add({
      uid: 'fake-uid-diego',
      fincaId,
      email: 'diego@finca.com',
      rol: 'trabajador',
    });
    return result.id;
  }

  test('rescinding planilla stamps fechaSalidaPlanilla and keeps tuvoEmpleo=true', async () => {
    const fincaId = uniqueFincaId('chat_revoke_planilla');
    fincas.push(fincaId);
    const id = await seedFullPerson(fincaId);

    const result = await chatToolEditarEmpleado({ empleadoId: id, empleadoPlanilla: false }, fincaId);
    expect(result.ok).toBe(true);
    const doc = await db.collection('users').doc(id).get();
    const data = doc.data();
    expect(data.empleadoPlanilla).toBe(false);
    expect(data.tuvoEmpleo).toBe(true);
    expect(data.fechaSalidaPlanilla).toBeDefined();
  });

  test('rehiring an ex-employee clears fechaSalidaPlanilla', async () => {
    const fincaId = uniqueFincaId('chat_rehire');
    fincas.push(fincaId);
    const id = await seedFullPerson(fincaId);

    await chatToolEditarEmpleado({ empleadoId: id, empleadoPlanilla: false }, fincaId);
    await chatToolEditarEmpleado({ empleadoId: id, empleadoPlanilla: true }, fincaId);

    const doc = await db.collection('users').doc(id).get();
    const data = doc.data();
    expect(data.empleadoPlanilla).toBe(true);
    expect(data.tuvoEmpleo).toBe(true);
    // FieldValue.delete() removes the property entirely.
    expect(data.fechaSalidaPlanilla).toBeUndefined();
    expect(data.motivoSalidaPlanilla).toBeUndefined();
  });

  test('revoking access drops the matching membership', async () => {
    const fincaId = uniqueFincaId('chat_revoke_access');
    fincas.push(fincaId);
    const id = await seedFullPerson(fincaId);

    const before = await db.collection('memberships')
      .where('fincaId', '==', fincaId).where('email', '==', 'diego@finca.com').get();
    expect(before.size).toBe(1);

    const result = await chatToolEditarEmpleado({ empleadoId: id, tieneAcceso: false }, fincaId);
    expect(result.ok).toBe(true);

    const after = await db.collection('memberships')
      .where('fincaId', '==', fincaId).where('email', '==', 'diego@finca.com').get();
    expect(after.empty).toBe(true);

    const doc = await db.collection('users').doc(id).get();
    expect(doc.data().tieneAcceso).toBe(false);
    expect(doc.data().rol).toBe('ninguno');
    expect(doc.data().restrictedTo).toEqual([]);
  });

  test('rejects edits that would produce orphan state', async () => {
    const fincaId = uniqueFincaId('chat_orphan_edit');
    fincas.push(fincaId);
    // Seed someone who is only a system user (no planilla).
    const r = await chatToolCrearEmpleado(
      { nombre: 'Solo usuario', email: 'solo@finca.com', tieneAcceso: true, rol: 'trabajador' },
      fincaId,
    );
    // Revoking the only facet they have should be refused.
    const result = await chatToolEditarEmpleado({ empleadoId: r.id, tieneAcceso: false }, fincaId);
    expect(result.error).toMatch(/sin acceso.*sin planilla/i);
  });

  test('rejects duplicate email when changing it to one already in use', async () => {
    const fincaId = uniqueFincaId('chat_dup_email_edit');
    fincas.push(fincaId);
    await chatToolCrearEmpleado(
      { nombre: 'A', email: 'a@finca.com', tieneAcceso: true, rol: 'trabajador' },
      fincaId,
    );
    const b = await chatToolCrearEmpleado(
      { nombre: 'B', email: 'b@finca.com', tieneAcceso: true, rol: 'trabajador' },
      fincaId,
    );
    const result = await chatToolEditarEmpleado({ empleadoId: b.id, email: 'a@finca.com' }, fincaId);
    expect(result.error).toMatch(/ya existe/i);
  });

  test('changing only telefono leaves facets and rol untouched', async () => {
    const fincaId = uniqueFincaId('chat_only_phone');
    fincas.push(fincaId);
    const id = await seedFullPerson(fincaId);
    const result = await chatToolEditarEmpleado({ empleadoId: id, telefono: '8888-0000' }, fincaId);
    expect(result.ok).toBe(true);
    const doc = await db.collection('users').doc(id).get();
    const data = doc.data();
    expect(data.telefono).toBe('8888-0000');
    expect(data.tieneAcceso).toBe(true);
    expect(data.empleadoPlanilla).toBe(true);
    expect(data.rol).toBe('trabajador');
  });
});
