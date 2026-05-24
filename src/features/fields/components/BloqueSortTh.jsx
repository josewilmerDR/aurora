import { FiFilter } from 'react-icons/fi';

/**
 * BloqueSortTh — header de columna con sort por click + ícono de filtro.
 *
 * Estaba inline dentro de LoteManagement, lo que hacía que React lo tratara
 * como un componente nuevo cada render. Resultado: los 5 <th> se desmontaban
 * y remontaban en cada keystroke del filtro, y el input del popover perdía
 * el foco. Extraído a archivo propio para que la identidad del componente
 * sea estable.
 *
 * Props:
 *   - field         string  · id de la columna (también usado como key del filtro)
 *   - children      Node    · etiqueta visible
 *   - filterType    string  · 'text' | 'number' — define el popover correcto
 *   - sorts         Array   · [{ field, dir }] — leemos sorts[0] (single-field sort)
 *   - setSorts      fn      · setState del array de sorts
 *   - colFilters    object  · mapa { field: { type, value | from, to } }
 *   - filterPop     object  · { field, ... } | null — el popover abierto (uno solo)
 *   - setFilterPop  fn      · setState del popover
 */
export default function BloqueSortTh({
  field,
  children,
  filterType = 'text',
  sorts,
  setSorts,
  colFilters,
  filterPop,
  setFilterPop,
}) {
  const active = sorts[0].field === field;
  const dir    = active ? sorts[0].dir : null;
  const f      = colFilters[field];
  const hasFilter = f
    ? (f.type === 'range' ? !!(f.from?.trim() || f.to?.trim()) : !!f.value?.trim())
    : false;

  const toggleSort = () => {
    setSorts(prev => {
      const next = [...prev];
      next[0] = next[0].field === field
        ? { field, dir: next[0].dir === 'asc' ? 'desc' : 'asc' }
        : { field, dir: 'asc' };
      return next;
    });
  };

  // Click en el embudo: toggle el popover. Si ya está abierto sobre este
  // mismo campo, cierra; si no, calcula la posición del <th> y abre.
  const handleFunnelClick = (e) => {
    e.stopPropagation();
    if (filterPop?.field === field) { setFilterPop(null); return; }
    const th = e.currentTarget.closest('th') ?? e.currentTarget;
    const rect = th.getBoundingClientRect();
    setFilterPop({ field, x: rect.left, y: rect.bottom + 4, filterType });
  };

  // Tooltip dinámico — el <th> es clickable pero el affordance no es
  // obvio. Decir explícitamente qué pasa al click reduce la fricción del
  // primer encuentro con la tabla, sobre todo en mobile donde no hay
  // estado de hover que sugiera interacción.
  const sortTitle = active
    ? `Ordenado ${dir === 'asc' ? 'ascendente' : 'descendente'} · clic para invertir`
    : 'Clic para ordenar por esta columna';

  return (
    <th
      className={`aur-th-sortable${active ? ' is-sorted' : ''}${hasFilter ? ' has-filter' : ''}`}
      title={sortTitle}
      onClick={toggleSort}
    >
      <span className="aur-th-content">
        {children}
        <span className="aur-th-arrow">{active ? (dir === 'asc' ? '↑' : '↓') : '↕'}</span>
        <span
          className={`aur-th-funnel${hasFilter ? ' is-active' : ''}`}
          title="Filtrar columna"
          onClick={handleFunnelClick}
        >
          <FiFilter size={10} />
        </span>
      </span>
    </th>
  );
}
