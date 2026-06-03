// Mapeo estado de planilla → UI, compartido por el editor y el historial.
// Antes vivía triplicado (ESTADO_LABELS en FixedPayroll, cadena inline en sus
// filas, y estadoBadge propio en FixedPayrollHistory) y el editor no manejaba
// el legacy 'pagado', así que un doc viejo caía al badge genérico en una vista
// y al correcto en la otra.

export const ESTADO_LABELS = {
  pendiente: 'Pendiente',
  aprobada:  'Aprobada',
  pagada:    'Pagada',
  pagado:    'Pagada', // legacy
};

// Badge de estado. Única fuente de verdad para el color/label en ambas vistas.
export function estadoBadge(estado) {
  if (estado === 'pendiente') return <span className="planilla-badge planilla-badge--pendiente">Pendiente</span>;
  if (estado === 'aprobada')  return <span className="planilla-badge planilla-badge--aprobada">Aprobada</span>;
  if (estado === 'pagada' || estado === 'pagado') return <span className="planilla-badge planilla-badge--pagada">Pagada</span>;
  return <span className="planilla-badge planilla-badge--otro">{estado || '—'}</span>;
}
