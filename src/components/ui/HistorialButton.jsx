import { Link } from 'react-router-dom';
import { FiClock } from 'react-icons/fi';

/**
 * HistorialButton — botón secundario default para "ir al historial".
 *
 * Pieza estándar (como .aur-btn-pill lo es para acciones primarias). Hereda
 * de .aur-chip --ghost y comparte min-width con FilterButton para alineación
 * visual en headers con ambos. En mobile (≤640px) colapsa a solo-ícono.
 *
 * Renderiza un react-router <Link>; si en algún caso se necesita un <a>
 * externo o un <button> con onClick, ese caso se construye ad-hoc — este
 * componente cubre la navegación interna que es el 99% de los usos.
 *
 * Props:
 *   - to       string · destino del Link (requerido)
 *   - label    string · texto del botón (default "Historial")
 *   - children Node   · alternativa a `label`
 *   - resto    pasa al <Link> (aria-*, state, etc.)
 */
export default function HistorialButton({
  to,
  label = 'Historial',
  children,
  className = '',
  ...rest
}) {
  return (
    <Link
      to={to}
      className={`aur-chip aur-chip--ghost aur-btn-historial${className ? ' ' + className : ''}`}
      aria-label="Historial"
      {...rest}
    >
      <FiClock size={12} />
      <span className="aur-btn-historial-label">{children ?? label}</span>
    </Link>
  );
}
