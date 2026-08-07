// Unit: cascada de identidad y saneo de logo (src/lib/empresa.js).
import { describe, test, expect } from 'vitest';
import { sanitizeLogoUrl, empresaInitials, resolveEmpresa } from '../empresa';

describe('sanitizeLogoUrl — default-deny', () => {
  test('acepta https, http loopback (emulador) y data:image', () => {
    expect(sanitizeLogoUrl('https://firebasestorage.googleapis.com/x/logo.png'))
      .toBe('https://firebasestorage.googleapis.com/x/logo.png');
    expect(sanitizeLogoUrl('http://127.0.0.1:9199/v0/b/x/o/logo.png')).toMatch(/^http:/);
    expect(sanitizeLogoUrl('http://localhost:9199/logo.png')).toMatch(/^http:/);
    expect(sanitizeLogoUrl('data:image/png;base64,AAAA')).toMatch(/^data:image/);
  });

  test('rechaza esquemas peligrosos, http remoto y basura', () => {
    for (const bad of [
      'javascript:alert(1)',
      'data:text/html;base64,AAAA',
      'file:///etc/passwd',
      'http://evil.com/pixel.gif',
      '//evil.com/x.png',
      'logo.png',
      '',
      null,
      undefined,
      42,
    ]) {
      expect(sanitizeLogoUrl(bad)).toBe('');
    }
  });
});

describe('empresaInitials', () => {
  test('deriva máx 2 iniciales en mayúsculas', () => {
    expect(empresaInitials('Hacienda El Roble')).toBe('HR');
    expect(empresaInitials('monocultivo')).toBe('MO');
  });
  test('sin nombre no inventa marca', () => {
    expect(empresaInitials('')).toBe('—');
    expect(empresaInitials(undefined)).toBe('—');
  });
});

describe('resolveEmpresa — cascada de identidad', () => {
  test('nombreEmpresa configurado manda y no marca missingIdentity', () => {
    const e = resolveEmpresa({ nombreEmpresa: 'Hacienda El Roble S.A.' }, 'Org Fallback');
    expect(e.nombre).toBe('Hacienda El Roble S.A.');
    expect(e.missingIdentity).toBe(false);
  });

  test('sin nombreEmpresa cae al nombre de la organización y marca missingIdentity', () => {
    const e = resolveEmpresa({}, 'Cooperativa La Loma');
    expect(e.nombre).toBe('Cooperativa La Loma');
    expect(e.missingIdentity).toBe(true);
  });

  test('nombreEmpresa de solo espacios cuenta como ausente', () => {
    const e = resolveEmpresa({ nombreEmpresa: '   ' }, 'Org');
    expect(e.nombre).toBe('Org');
    expect(e.missingIdentity).toBe(true);
  });

  test('config null/undefined no revienta y sanea el logo', () => {
    expect(resolveEmpresa(null, 'Org').nombre).toBe('Org');
    expect(resolveEmpresa(undefined, '').nombre).toBe('');
    expect(resolveEmpresa({ logoUrl: 'javascript:alert(1)' }, 'Org').logoUrl).toBe('');
    expect(resolveEmpresa({ logoUrl: 'https://x.com/l.png' }, 'Org').logoUrl).toBe('https://x.com/l.png');
  });

  test('el nombre nunca es el literal del inquilino de pruebas', () => {
    const e = resolveEmpresa({}, '');
    expect(e.nombre).toBe('');
    expect(JSON.stringify(e)).not.toMatch(/Finca\s+Aurora/);
  });
});
