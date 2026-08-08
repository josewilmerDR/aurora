/**
 * Unit: resolveAppUrl en lib/firebase.js.
 *
 * APP_URL se interpola cruda en el cuerpo de las notificaciones push salientes
 * (helpers.js → sendNotificationWithLink), así que el resolver no puede ser
 * un passthrough del env: exige https sin credenciales/query/fragmento,
 * normaliza el slash final, y ante cualquier valor inválido cae al default
 * en vez de contaminar cada mensaje enviado.
 *
 * OJO al elegir valores válidos en los casos de abajo: tienen que ser
 * DISTINTOS de DEFAULT. Si coinciden, un resolver que ignorara el argumento y
 * devolviera siempre el default pasaría el test igual.
 */

const { resolveAppUrl } = require('../../lib/firebase');

const DEFAULT = 'https://aurora.comunplace.com';

describe('resolveAppUrl', () => {
  let warnSpy;
  beforeEach(() => { warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {}); });
  afterEach(() => { warnSpy.mockRestore(); });

  test('sin valor (undefined, null, vacío, espacios) → default, sin warning', () => {
    for (const v of [undefined, null, '', '   ']) {
      expect(resolveAppUrl(v)).toBe(DEFAULT);
    }
    expect(warnSpy).not.toHaveBeenCalled();
  });

  test('https válida se acepta y se normaliza el slash final', () => {
    expect(resolveAppUrl('https://otro.ejemplo.com')).toBe('https://otro.ejemplo.com');
    expect(resolveAppUrl('https://otro.ejemplo.com/')).toBe('https://otro.ejemplo.com');
    expect(resolveAppUrl('  https://otro.ejemplo.com/  ')).toBe('https://otro.ejemplo.com');
  });

  test('subpath se preserva sin slash final', () => {
    expect(resolveAppUrl('https://comunplace.com/aurora/')).toBe('https://comunplace.com/aurora');
  });

  test('esquema no-https → default con warning', () => {
    for (const v of ['http://aurora.comunplace.com', 'ftp://x.com', 'javascript:alert(1)']) {
      expect(resolveAppUrl(v)).toBe(DEFAULT);
    }
    expect(warnSpy).toHaveBeenCalledTimes(3);
  });

  test('basura no parseable → default con warning', () => {
    expect(resolveAppUrl('no es una url')).toBe(DEFAULT);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  test('query, fragmento o credenciales → default (no se interpolan en mensajes)', () => {
    for (const v of [
      'https://x.com/?q=1',
      'https://x.com/#frag',
      'https://user:pass@x.com',
    ]) {
      expect(resolveAppUrl(v)).toBe(DEFAULT);
    }
    expect(warnSpy).toHaveBeenCalledTimes(3);
  });

  test('el módulo resuelve APP_URL desde process.env.APP_URL', () => {
    const original = process.env.APP_URL;
    process.env.APP_URL = 'https://otro.ejemplo.com/';
    try {
      let mod;
      jest.isolateModules(() => { mod = require('../../lib/firebase'); });
      expect(mod.APP_URL).toBe('https://otro.ejemplo.com');
    } finally {
      if (original === undefined) delete process.env.APP_URL;
      else process.env.APP_URL = original;
    }
  });
});
