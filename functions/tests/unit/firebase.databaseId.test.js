/**
 * Unit: selección de base de datos en lib/firebase.js.
 *
 * Guardia del fallo silencioso que motiva el `|| 'auroradatabase'`:
 * getFirestore(app, undefined) NO lanza — devuelve un handle a la base
 * '(default)', que existe y está vacía, y el backend arranca "sano"
 * respondiendo 200 con listas vacías. Si alguien deja el env a secas
 * (process.env.FIRESTORE_DATABASE_ID sin fallback) o rompe el literal,
 * estos tests fallan.
 *
 * Cada caso re-importa lib/firebase con registro de módulos limpio para que
 * admin.initializeApp() corra sobre un firebase-admin fresco.
 */

describe('lib/firebase — databaseId', () => {
  const ORIGINAL = process.env.FIRESTORE_DATABASE_ID;

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.FIRESTORE_DATABASE_ID;
    else process.env.FIRESTORE_DATABASE_ID = ORIGINAL;
  });

  function loadDb() {
    let db;
    jest.isolateModules(() => {
      ({ db } = require('../../lib/firebase'));
    });
    return db;
  }

  test('sin env apunta a auroradatabase, nunca a (default)', () => {
    delete process.env.FIRESTORE_DATABASE_ID;
    expect(loadDb().databaseId).toBe('auroradatabase');
  });

  test('FIRESTORE_DATABASE_ID repunta a otra base (flujo de restore)', () => {
    process.env.FIRESTORE_DATABASE_ID = 'auroradatabase-restored';
    expect(loadDb().databaseId).toBe('auroradatabase-restored');
  });

  test('env vacío cae al literal — un "" colado no manda a (default)', () => {
    process.env.FIRESTORE_DATABASE_ID = '';
    expect(loadDb().databaseId).toBe('auroradatabase');
  });
});
