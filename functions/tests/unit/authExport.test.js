/**
 * Unit: Firebase Auth export for disaster recovery (lib/authExport.js).
 *
 * What is protected:
 *   1. The document matches the `firebase auth:import` schema — field names
 *      are the contract that makes the export restorable, not just readable.
 *   2. Password hashes survive the mapping (otherwise a restore resets every
 *      password) and empty fields are omitted, not serialized as null.
 *   3. Pagination walks every page of listUsers.
 *   4. The object name is stable per day (idempotent reruns) and lands under
 *      the `auth/` prefix the bucket lifecycle rule is scoped to.
 */

jest.mock('../../lib/firebase', () => ({
  admin: { auth: jest.fn(), storage: jest.fn() },
}));

const {
  toImportRecord,
  buildAuthExport,
  exportObjectName,
  listAllUsers,
  exportAuthUsers,
  AUTH_EXPORT_PREFIX,
} = require('../../lib/authExport');

const NOW = new Date('2026-08-22T10:00:00.000Z');

function userRecord(overrides = {}) {
  return {
    uid: 'uid-1',
    email: 'ana@example.com',
    emailVerified: true,
    displayName: 'Ana',
    disabled: false,
    passwordHash: 'aGFzaA==',
    passwordSalt: 'c2FsdA==',
    customClaims: { fincaId: 'f1' },
    metadata: {
      creationTime: 'Sat, 01 Aug 2026 12:00:00 GMT',
      lastSignInTime: 'Fri, 21 Aug 2026 12:00:00 GMT',
    },
    providerData: [
      { providerId: 'password', uid: 'ana@example.com', email: 'ana@example.com' },
      { providerId: 'google.com', uid: '1234', email: 'ana@example.com', displayName: 'Ana', photoURL: 'https://p/x.png' },
    ],
    ...overrides,
  };
}

describe('toImportRecord', () => {
  test('maps to the auth:import schema, keeping password hash and salt', () => {
    const rec = toImportRecord(userRecord());
    expect(rec).toMatchObject({
      localId: 'uid-1',
      email: 'ana@example.com',
      emailVerified: true,
      displayName: 'Ana',
      disabled: false,
      passwordHash: 'aGFzaA==',
      salt: 'c2FsdA==',
      customAttributes: JSON.stringify({ fincaId: 'f1' }),
      createdAt: String(Date.parse('Sat, 01 Aug 2026 12:00:00 GMT')),
      lastSignedInAt: String(Date.parse('Fri, 21 Aug 2026 12:00:00 GMT')),
    });
    expect(rec.providerUserInfo).toEqual([
      { providerId: 'password', rawId: 'ana@example.com', email: 'ana@example.com', displayName: undefined, photoUrl: undefined },
      { providerId: 'google.com', rawId: '1234', email: 'ana@example.com', displayName: 'Ana', photoUrl: 'https://p/x.png' },
    ]);
  });

  test('omits empty fields instead of serializing nulls', () => {
    const rec = toImportRecord(userRecord({
      passwordHash: undefined, passwordSalt: undefined, customClaims: {}, metadata: {}, providerData: [],
      displayName: '', phoneNumber: undefined,
    }));
    const json = JSON.parse(JSON.stringify(rec));
    expect(json).not.toHaveProperty('passwordHash');
    expect(json).not.toHaveProperty('salt');
    expect(json).not.toHaveProperty('customAttributes');
    expect(json).not.toHaveProperty('createdAt');
    expect(json).not.toHaveProperty('displayName');
    expect(json.providerUserInfo).toEqual([]);
  });
});

describe('buildAuthExport / exportObjectName', () => {
  test('document carries timestamp, count and mapped users', () => {
    const doc = buildAuthExport([userRecord(), userRecord({ uid: 'uid-2' })], NOW);
    expect(doc.exportedAt).toBe('2026-08-22T10:00:00.000Z');
    expect(doc.userCount).toBe(2);
    expect(doc.users.map((u) => u.localId)).toEqual(['uid-1', 'uid-2']);
  });

  test('object name is per-day under the auth/ prefix', () => {
    expect(exportObjectName(NOW)).toBe(`${AUTH_EXPORT_PREFIX}auth-users-2026-08-22.json`);
    expect(exportObjectName(new Date('2026-08-22T23:59:59Z'))).toBe(exportObjectName(NOW));
  });
});

describe('listAllUsers', () => {
  test('walks every page until no pageToken', async () => {
    const listUsers = jest.fn()
      .mockResolvedValueOnce({ users: [userRecord({ uid: 'a' })], pageToken: 't1' })
      .mockResolvedValueOnce({ users: [userRecord({ uid: 'b' })], pageToken: 't2' })
      .mockResolvedValueOnce({ users: [userRecord({ uid: 'c' })], pageToken: undefined });
    const users = await listAllUsers({ listUsers });
    expect(users.map((u) => u.uid)).toEqual(['a', 'b', 'c']);
    expect(listUsers).toHaveBeenCalledTimes(3);
    expect(listUsers).toHaveBeenNthCalledWith(2, 1000, 't1');
  });
});

describe('exportAuthUsers', () => {
  test('writes the JSON document to the bucket and reports the object', async () => {
    const save = jest.fn().mockResolvedValue();
    const file = jest.fn(() => ({ save }));
    const bucket = { name: 'aurora-7dc9b-firestore-backups', file };
    const auth = { listUsers: jest.fn().mockResolvedValue({ users: [userRecord()], pageToken: undefined }) };

    const result = await exportAuthUsers({ auth, bucket, now: NOW });

    expect(file).toHaveBeenCalledWith('auth/auth-users-2026-08-22.json');
    const [body, opts] = save.mock.calls[0];
    expect(opts.contentType).toBe('application/json');
    const parsed = JSON.parse(body);
    expect(parsed.userCount).toBe(1);
    expect(parsed.users[0].passwordHash).toBe('aGFzaA==');
    expect(result).toEqual({
      object: 'gs://aurora-7dc9b-firestore-backups/auth/auth-users-2026-08-22.json',
      userCount: 1,
    });
  });
});
