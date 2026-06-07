/**
 * Unit (puro, sin DB): conciliación de líneas de OC ↔ recepción.
 * Cubre H8 — la lógica antes divergía entre intake/receipts/anular.
 */

const { reconcileReceive, reconcileRevert, computeEstado } = require('../../lib/inventory/ocReconcile');

describe('reconcileReceive', () => {
  test('acumula lo recibido sobre lo previo, match por productoId', () => {
    const oc = [{ productoId: 'p1', cantidad: 10, cantidadRecibida: 3 }];
    const rec = [{ productoId: 'p1', cantidadRecibida: 4 }];
    expect(reconcileReceive(oc, rec)[0].cantidadRecibida).toBe(7);
  });

  test('consume-once: dos líneas OC homónimas no se emparejan a la misma recepción', () => {
    const oc = [
      { productoId: 'p1', cantidad: 5, cantidadRecibida: 0 },
      { productoId: 'p1', cantidad: 5, cantidadRecibida: 0 },
    ];
    const rec = [{ productoId: 'p1', cantidadRecibida: 5 }];
    const out = reconcileReceive(oc, rec);
    expect(out[0].cantidadRecibida).toBe(5);
    expect(out[1].cantidadRecibida).toBe(0); // segunda línea no recibe doble
  });

  test('fallback por nombre solo cuando la línea OC no tiene productoId', () => {
    const oc = [{ nombreComercial: 'Urea', cantidad: 2, cantidadRecibida: 0 }];
    const rec = [{ nombreComercial: 'urea', cantidadRecibida: 2 }];
    expect(reconcileReceive(oc, rec)[0].cantidadRecibida).toBe(2);
  });

  test('no muta las líneas de entrada', () => {
    const oc = [{ productoId: 'p1', cantidad: 10, cantidadRecibida: 1 }];
    reconcileReceive(oc, [{ productoId: 'p1', cantidadRecibida: 2 }]);
    expect(oc[0].cantidadRecibida).toBe(1);
  });
});

describe('reconcileRevert', () => {
  test('revierte lo recibido sin bajar de 0', () => {
    const oc = [{ productoId: 'p1', cantidad: 10, cantidadRecibida: 4 }];
    const rec = [{ productoId: 'p1', cantidadRecibida: 10 }];
    expect(reconcileRevert(oc, rec)[0].cantidadRecibida).toBe(0);
  });

  test('líneas sin match quedan intactas', () => {
    const oc = [{ productoId: 'p2', cantidad: 5, cantidadRecibida: 5 }];
    expect(reconcileRevert(oc, [{ productoId: 'p1', cantidadRecibida: 1 }])[0].cantidadRecibida).toBe(5);
  });
});

describe('computeEstado', () => {
  test('pendiente cuando nada recibido', () => {
    expect(computeEstado([{ cantidad: 10, cantidadRecibida: 0 }])).toBe('pendiente');
  });
  test('recibida cuando toda línea con cantidad>0 está cubierta', () => {
    expect(computeEstado([{ cantidad: 10, cantidadRecibida: 10 }])).toBe('recibida');
  });
  test('recibida_parcialmente cuando hay algo pero no todo', () => {
    expect(computeEstado([
      { cantidad: 10, cantidadRecibida: 10 },
      { cantidad: 10, cantidadRecibida: 3 },
    ])).toBe('recibida_parcialmente');
  });
  test('líneas con cantidad 0 no impiden el cierre', () => {
    expect(computeEstado([
      { cantidad: 0, cantidadRecibida: 0 },
      { cantidad: 5, cantidadRecibida: 5 },
    ])).toBe('recibida');
  });
});
