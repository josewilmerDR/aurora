// Unit puro: proyección de lista de planilla por unidad (reads.js).
//
// Regresión H2 (auditoría dominio HR): GET /api/hr/planilla-unidad devolvía el
// doc completo (`...d.data()`), filtrando `history[]` (con byEmail), `createdBy`
// y `updatedBy` (emails de auditoría) a cualquier encargado. La proyección debe
// emitir SOLO la whitelist que la UI consume.

const {
  projectPlanillaUnidadList,
  PLANILLA_UNIDAD_LIST_FIELDS,
} = require('../../routes/hr/payroll-unit/reads');

function tsLike(iso) {
  return { toDate: () => new Date(iso) };
}

describe('projectPlanillaUnidadList (H2)', () => {
  const fullDoc = {
    fincaId: 'f1',
    encargadoId: 'enc1',
    encargadoNombre: 'Encargado Uno',
    consecutivo: 'PU-00001',
    estado: 'aprobada',
    segmentos: [{ id: 's1', labor: 'corta' }],
    trabajadores: [{ trabajadorId: 't1', precioHora: 1500, total: 3000 }],
    totalGeneral: 3000,
    observaciones: 'nota',
    snapshotCreado: true,
    fecha: tsLike('2026-05-10T12:00:00Z'),
    createdAt: tsLike('2026-05-09T08:00:00Z'),
    // Campos sensibles que NO deben salir:
    history: [{ at: new Date(), byEmail: 'auditor@example.com', action: 'created:borrador' }],
    createdBy: { userId: 'u1', email: 'creador@example.com' },
    updatedBy: { userId: 'u2', email: 'editor@example.com' },
  };

  test('emite los campos de la whitelist con fechas ISO', () => {
    const out = projectPlanillaUnidadList('doc1', fullDoc);
    expect(out.id).toBe('doc1');
    expect(out.encargadoNombre).toBe('Encargado Uno');
    expect(out.totalGeneral).toBe(3000);
    expect(out.trabajadores[0].precioHora).toBe(1500); // el dueño/supervisor sí lo ve
    expect(out.fecha).toBe('2026-05-10T12:00:00.000Z');
    expect(out.createdAt).toBe('2026-05-09T08:00:00.000Z');
  });

  test('NO filtra emails de auditoría (history / createdBy / updatedBy)', () => {
    const out = projectPlanillaUnidadList('doc1', fullDoc);
    expect(out.history).toBeUndefined();
    expect(out.createdBy).toBeUndefined();
    expect(out.updatedBy).toBeUndefined();
    // Defensa extra: ningún email del doc aparece en el JSON serializado.
    expect(JSON.stringify(out)).not.toContain('@example.com');
  });

  test('las únicas claves son id + whitelist + fecha/createdAt', () => {
    const out = projectPlanillaUnidadList('doc1', fullDoc);
    const allowed = new Set(['id', ...PLANILLA_UNIDAD_LIST_FIELDS, 'fecha', 'createdAt']);
    for (const k of Object.keys(out)) expect(allowed.has(k)).toBe(true);
  });

  test('fechas ausentes → null sin lanzar', () => {
    const out = projectPlanillaUnidadList('doc2', { estado: 'borrador' });
    expect(out.fecha).toBeNull();
    expect(out.createdAt).toBeNull();
  });
});
