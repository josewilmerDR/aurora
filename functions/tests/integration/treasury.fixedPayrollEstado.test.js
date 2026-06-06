/**
 * Integration: proyección de planilla fija en tesorería (treasurySources.fetchFixedPayrollOutflows).
 *
 * Regresión H7 (auditoría dominio HR): la proyección tomaba la planilla fija MÁS
 * RECIENTE por periodoInicio sin filtrar estado, así que un borrador/pendiente
 * recién creado secuestraba la proyección de caja como obligación mensual. El fix
 * solo considera planillas comprometidas (aprobada/pagada).
 *
 * Requiere el emulador de Firestore. Aislado por fincaId único.
 */

const { db, Timestamp } = require('../../lib/firebase');
const { uniqueFincaId } = require('../helpers');
const { fetchFixedPayrollOutflows } = require('../../lib/finance/treasurySources');

async function seedPlanillaFija(fincaId, { estado, periodoInicio, totalGeneral }) {
  await db.collection('hr_planilla_fijo').add({
    fincaId,
    estado,
    totalGeneral,
    periodoInicio: Timestamp.fromDate(new Date(periodoInicio + 'T12:00:00Z')),
    periodoFin: Timestamp.fromDate(new Date(periodoInicio + 'T12:00:00Z')),
  });
}
async function cleanup(fincaId) {
  const snap = await db.collection('hr_planilla_fijo').where('fincaId', '==', fincaId).get();
  if (snap.empty) return;
  const batch = db.batch();
  snap.docs.forEach(d => batch.delete(d.ref));
  await batch.commit();
}

const HORIZON = { fromISO: '2026-05-01', toISO: '2026-08-31' };

describe('fetchFixedPayrollOutflows — filtra por estado (H7)', () => {
  const fincas = [];
  afterAll(async () => { await Promise.all(fincas.map(cleanup)); });

  test('un borrador más reciente NO secuestra la proyección; usa la aprobada', async () => {
    const fincaId = uniqueFincaId('h7_borrador'); fincas.push(fincaId);
    await seedPlanillaFija(fincaId, { estado: 'aprobada', periodoInicio: '2026-04-15', totalGeneral: 1000 });
    await seedPlanillaFija(fincaId, { estado: 'borrador',  periodoInicio: '2026-05-20', totalGeneral: 999999 });

    const events = await fetchFixedPayrollOutflows(fincaId, HORIZON);

    expect(events.length).toBeGreaterThan(0);
    expect(events.every(e => e.amount === 1000)).toBe(true); // nunca 999999
  });

  test('solo borradores/pendientes → sin eventos', async () => {
    const fincaId = uniqueFincaId('h7_solo_borrador'); fincas.push(fincaId);
    await seedPlanillaFija(fincaId, { estado: 'borrador',  periodoInicio: '2026-05-10', totalGeneral: 500 });
    await seedPlanillaFija(fincaId, { estado: 'pendiente', periodoInicio: '2026-05-12', totalGeneral: 700 });

    const events = await fetchFixedPayrollOutflows(fincaId, HORIZON);
    expect(events).toEqual([]);
  });

  test('una pagada sí se proyecta', async () => {
    const fincaId = uniqueFincaId('h7_pagada'); fincas.push(fincaId);
    await seedPlanillaFija(fincaId, { estado: 'pagada', periodoInicio: '2026-05-10', totalGeneral: 1234 });

    const events = await fetchFixedPayrollOutflows(fincaId, HORIZON);
    expect(events.length).toBeGreaterThan(0);
    expect(events.every(e => e.amount === 1234)).toBe(true);
  });
});
