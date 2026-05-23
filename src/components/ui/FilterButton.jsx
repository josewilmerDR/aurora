import { FiFilter } from 'react-icons/fi';

/**
 * FilterButton — botón secundario default para "abrir filtros".
 *
 * Pieza estándar (como .aur-btn-pill lo es para acciones primarias). Hereda
 * de .aur-chip --ghost y comparte min-width con HistorialButton para que en
 * un header con ambos queden alineados visualmente. En mobile (≤640px)
 * colapsa a solo-ícono.
 *
 * Props:
 *   - active   bool  · pinta el dot indicador cuando hay filtros aplicados
 *   - onClick  fn    · handler del click (usualmente abre un modal)
 *   - label    string · texto del botón (default "Filtro")
 *   - children Node  · alternativa a `label` si se necesita markup custom
 *   - resto    pasa al <button> (aria-*, disabled, etc.)
 */
export default function FilterButton({
  active = false,
  onClick,
  label = 'Filtro',
  children,
  className = '',
  ...rest
}) {
  return (
    <button
      type="button"
      className={`aur-chip aur-chip--ghost aur-btn-filter${className ? ' ' + className : ''}`}
      onClick={onClick}
      aria-label="Filtrar"
      aria-haspopup="dialog"
      {...rest}
    >
      <FiFilter size={12} />
      <span className="aur-btn-filter-label">{children ?? label}</span>
      {active && <span className="aur-btn-filter-dot" aria-hidden="true" />}
    </button>
  );
}
