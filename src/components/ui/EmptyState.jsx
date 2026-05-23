import { FiInbox } from 'react-icons/fi';
import './EmptyState.css';

/**
 * EmptyState — vacío consistente para tablas, listas y paneles.
 *
 * Reemplaza los `<p className="empty-state">No hay…</p>` ad-hoc que viven en
 * 30+ páginas con look ligeramente distinto (algunas solo texto, otras con
 * título y subtítulo, otras dentro de .harvest-page .empty-state). La idea es
 * que un usuario nuevo perciba el mismo lenguaje visual cuando un widget
 * todavía no tiene datos.
 *
 * Props:
 *   - title     string · línea principal ("No hay tareas archivadas")
 *   - subtitle  string · línea secundaria opcional con contexto/CTA verbal
 *   - icon      Comp   · icono react-icons (default: FiInbox)
 *   - action    Node   · botón/enlace opcional debajo del subtítulo
 *   - variant   string · 'default' (sección) | 'compact' (dentro de cards/tablas)
 *   - className string · clase extra opcional para overrides puntuales
 *
 * Ejemplos:
 *   <EmptyState title="No hay tareas en esta categoría." />
 *
 *   <EmptyState
 *     icon={FiUsers}
 *     title="No hay trabajadores registrados"
 *     subtitle="Crea el primero desde la Ficha del Trabajador."
 *     action={<button className="aur-btn-pill" onClick={...}>Crear trabajador</button>}
 *   />
 */
export default function EmptyState({
  title,
  subtitle,
  icon: Icon = FiInbox,
  action,
  variant = 'default',
  className = '',
}) {
  const wrapperClass = `aur-empty aur-empty--${variant}${className ? ' ' + className : ''}`;
  return (
    <div className={wrapperClass}>
      {Icon && (
        <div className="aur-empty-icon" aria-hidden="true">
          <Icon />
        </div>
      )}
      {title && <div className="aur-empty-title">{title}</div>}
      {subtitle && <div className="aur-empty-subtitle">{subtitle}</div>}
      {action && <div className="aur-empty-action">{action}</div>}
    </div>
  );
}
