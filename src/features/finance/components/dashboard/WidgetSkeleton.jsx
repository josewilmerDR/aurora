import AuroraSkeleton from '../../../../components/ui/AuroraSkeleton';

/**
 * WidgetSkeleton — shimmer del cuerpo de un fin-widget mientras se carga.
 *
 * El widget contenedor (.aur-section) ya provee borde, padding, header y
 * CTA row. Este componente sólo reemplaza la zona del contenido: 4 líneas
 * stacked que aproximan el espacio donde luego van primary value + stats.
 * Preservar el header significa que el usuario sigue viendo la identidad
 * del widget ("Caja", "Presupuesto", "Rentabilidad", etc.) durante la
 * carga, en lugar de un texto genérico "Cargando…".
 *
 * Uso:
 *   {loading && <WidgetSkeleton label="Cargando saldo de caja…" />}
 *
 * El label se usa como aria-label para lectores de pantalla — siempre
 * pasarlo con contexto del widget para que la navegación con screen
 * reader sea informativa.
 */
export default function WidgetSkeleton({ label = 'Cargando contenido del widget…' }) {
  return (
    <div className="fin-widget-skeleton">
      <AuroraSkeleton variant="text" count={4} label={label} />
    </div>
  );
}
