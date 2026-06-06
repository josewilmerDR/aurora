/**
 * Integration: agregación de costos de planilla por unidad (periodCosts.js).
 *
 * Regresión H1 (auditoría dominio HR): `hr_planilla_unidad_historial` guarda
 * 1 doc por fila (trabajador × segmento) y DENORMALIZA `totalGeneral` (el total
 * de toda la planilla) en cada fila. El consumidor de costos debe sumar
 * `subtotal` (valor monetario de la fila), no `totalGeneral` por fila — eso
 * multiplicaba el costo directo de planilla por (nº trabajadores × nº segmentos)
 * y corrompía ROI / budget / proyección del CEO.
 *
 * Requiere el emulador de Firestore (127.0.0.1:8080). Se aísla por fincaId único
 * y limpia su colección al final.
 */

const { db, Timestamp } = require('../../lib/firebase');
const { uniqueFincaId } = require('../helpers');
const { computePeriodCosts } = require('../../lib/finance/periodCosts');

// Materializa un snapshot realista: una planilla con `workers × segmentos` filas,
// cada una con su `subtotal` y el MISMO `totalGeneral` denormalizado.
async function seedHistorialPlanilla(fincaId, { fecha, subtotalPorFila, workers, segmentos }) {
  const totalGeneral = subtotalPorFila * workers * segmentos;
  const fechaTs = Timestamp.fromDate(new Date(fecha + 'T12:00:00'));
  const batch = db.batch();
  for (let w = 0; w < workers; w++) {
    for (let s = 0; s < segmentos; s++) {
      const ref = db.collection('hr_planilla_unidad_historial').doc();
      batch.set(ref, {
        fincaId,
        planillaId: 'PL_TEST',
        fecha: fechaTs,
        subtotal: subtotalPorFila,
        totalGeneral, // denormalizado: igual en todas las filas
      });
    }
  }
  await batch.commit();
  return totalGeneral;
}

async function cleanup(fincaId) {
  const snap = await db.collection('hr_planilla_unidad_historial').where('fincaId', '==', fincaId).get();
  if (snap.empty) return;
  const batch = db.batch();
  snap.docs.forEach(d => batch.delete(d.ref));
  await batch.commit();
}

describe('computePeriodCosts — planilla_directa (regresión H1)', () => {
  const fincas = [];
  afterAll(async () => { await Promise.all(fincas.map(cleanup)); });

  test('suma subtotales por fila; no infla por totalGeneral denormalizado', async () => {
    const fincaId = uniqueFincaId('h1_periodcosts'); fincas.push(fincaId);
    // 4 trabajadores × 3 segmentos = 12 filas, subtotal 250 c/u → total real 3000.
    const totalReal = await seedHistorialPlanilla(fincaId, {
      fecha: '2026-05-10', subtotalPorFila: 250, workers: 4, segmentos: 3,
    });
    expect(totalReal).toBe(3000);

    const totals = await computePeriodCosts(fincaId, { from: '2026-05-01', to: '2026-05-31' });

    // Antes del fix: 12 filas × 3000 = 36 000 (inflado 12×). Correcto: 12 × 250.
    expect(totals.planilla_directa).toBe(3000);
  });

  test('excluye filas fuera del rango de fechas', async () => {
    const fincaId = uniqueFincaId('h1_periodcosts_range'); fincas.push(fincaId);
    await seedHistorialPlanilla(fincaId, { fecha: '2026-05-10', subtotalPorFila: 100, workers: 2, segmentos: 1 }); // dentro
    await seedHistorialPlanilla(fincaId, { fecha: '2026-07-10', subtotalPorFila: 100, workers: 2, segmentos: 1 }); // fuera

    const totals = await computePeriodCosts(fincaId, { from: '2026-05-01', to: '2026-05-31' });
    expect(totals.planilla_directa).toBe(200); // solo las 2 filas de mayo
  });
});
