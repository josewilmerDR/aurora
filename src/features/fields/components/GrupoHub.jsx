import { createPortal } from 'react-dom';
import {
  FiArrowLeft, FiEye, FiEdit, FiTrash2,
  FiCalendar, FiLayers, FiPackage, FiX, FiSliders, FiFilter,
} from 'react-icons/fi';
import AuroraFilterPopover from '../../../components/AuroraFilterPopover';
import EmptyState from '../../../components/ui/EmptyState';
import BloqueSortTh from './BloqueSortTh';
import { formatDateLong, formatHa } from '../lib/lotes-helpers';
import { calcFechaCosecha } from '../lib/grupo-bloques-helpers';
import useGrupoBloqueTable from '../hooks/useGrupoBloqueTable';

const BLOQUE_COLS = [
  { id: 'loteNombre', label: 'Lote'     },
  { id: 'bloque',     label: 'Bloque'   },
  { id: 'ha',         label: 'Ha.',     filterType: 'number' },
  { id: 'plantas',    label: 'Plantas', filterType: 'number' },
  { id: 'material',   label: 'Material' },
  { id: 'kg',         label: 'Kg Est.', filterType: 'number' },
];

/**
 * GrupoHub — panel central del grupo seleccionado.
 *
 * Extraído de GrupoManagement.jsx como parte del refactor del #12 (12b).
 * Encapsula todo lo que el usuario ve cuando hay un grupo elegido: back
 * button, header de acciones (preview / edit / delete), pills de metadata
 * (fecha, cosecha, etapa, conteo de bloques, paquetes, fecha estimada
 * de cosecha) y la tabla de bloques con su estado completo vía
 * useGrupoBloqueTable.
 *
 * Props:
 *   - grupo              object · grupo activo (parent ya filtra cuando es null)
 *   - siembrasById       Map    · índice id → siembra (parent lo memoiza)
 *   - packages           array  · resuelve grupo.paqueteId → nombre del paquete
 *                                  + marca como archivado si corresponde
 *   - monitoreoPackages  array  · idem para paqueteMuestreoId
 *   - empresaConfig      object · días por etapa/cosecha para calcFechaCosecha
 *   - onBack             fn     · cerrar el hub ("Todos los grupos")
 *   - onEdit             fn(g)  · abrir el form de editar grupo
 *   - onDelete           fn(g)  · abrir el flujo de eliminar (con guardia)
 *   - onPreview          fn(g)  · abrir el modal de vista previa / PDF
 */
export default function GrupoHub({
  grupo,
  siembrasById,
  packages,
  monitoreoPackages,
  empresaConfig,
  onBack,
  onEdit,
  onDelete,
  onPreview,
  // True mientras el delete-check del padre está en vuelo. Deshabilita
  // el botón Trash para evitar dobles disparos cuando la red está lenta
  // (~500ms entre el click y el modal aparecer).
  checkingDelete = false,
}) {
  const {
    selectedBloques,
    sortedRows,
    filtTotalHa, filtTotalPlantas, filtTotalKg,
    sorts, setSorts,
    colFilters, setColFilter, clearColFilters, hasActiveFilters,
    filterPop, setFilterPop,
    hiddenCols, toggleHiddenCol, resetHiddenCols,
    colMenu, openColMenu, closeColMenu,
  } = useGrupoBloqueTable({ selectedGrupo: grupo, siembrasById, empresaConfig });

  const fechaCosecha = calcFechaCosecha(grupo, empresaConfig);
  // Si /api/config falló al cargar (reloadAll usa allSettled — fallos
  // silenciosos por diseño), empresaConfig queda en su valor inicial {}
  // y calcFechaCosecha cae a los defaults 150/215/250 sin avisar. El
  // backend devuelve {id, fincaId, updatedAt, ...} cuando el doc existe;
  // {} para fincas sin config seteado o si el fetch reventó. Usamos
  // `.id` como discriminador: false → marcamos el badge como atenuado
  // con tooltip para que el usuario sepa que el dato es ballpark, no
  // dato calibrado para esta finca.
  const configLoaded = !!empresaConfig?.id;

  const grupoPkg      = grupo.paqueteId ? packages.find(p => p.id === grupo.paqueteId) : null;
  const isArchivedPkg = !!(grupoPkg && grupoPkg.archivedAt);
  const grupoPkgName  = grupoPkg?.nombrePaquete || '—';
  const monitoreoPkg  = grupo.paqueteMuestreoId ? monitoreoPackages.find(p => p.id === grupo.paqueteMuestreoId) : null;
  const monitoreoPkgName = monitoreoPkg?.nombrePaquete || '—';

  // Bundle compartido por las 6 cabeceras sortables. Mismo pattern que
  // LoteHub.sortThProps.
  const sortThProps = { sorts, setSorts, colFilters, filterPop, setFilterPop };

  return (
    <div className="grupo-hub">
      <button className="grupo-hub-back" onClick={onBack}>
        <FiArrowLeft size={13} /> Todos los grupos
      </button>
      <div className="hub-header">
        <div className="hub-title-block">
          <h2 className="hub-lote-code">{grupo.nombreGrupo}</h2>
        </div>
        {/* En mobile chico (<480px) los 3 botones quedan como íconos
           (los aria-labels los identifican para screen readers). De
           ahí en adelante mostramos la etiqueta visual al lado del
           ícono — sin esto, en touch el usuario tenía que adivinar
           cuál era el rojo de "eliminar" sin más feedback que el
           glyph + color. */}
        <div className="hub-header-actions">
          <button onClick={() => onPreview(grupo)} className="aur-icon-btn hub-action-btn" title="Vista previa / PDF" aria-label="Vista previa / PDF del grupo">
            <FiEye size={16} aria-hidden="true" />
            <span className="hub-action-label">Vista previa</span>
          </button>
          <button onClick={() => onEdit(grupo)} className="aur-icon-btn hub-action-btn" title="Editar" aria-label="Editar grupo">
            <FiEdit size={16} aria-hidden="true" />
            <span className="hub-action-label">Editar</span>
          </button>
          <button
            onClick={() => onDelete(grupo)}
            className="aur-icon-btn aur-icon-btn--danger hub-action-btn"
            title="Eliminar"
            aria-label="Eliminar grupo"
            disabled={checkingDelete}
            aria-busy={checkingDelete}
          >
            <FiTrash2 size={16} aria-hidden="true" />
            <span className="hub-action-label">{checkingDelete ? 'Verificando…' : 'Eliminar'}</span>
          </button>
        </div>
      </div>

      <div className="hub-info-pills">
        <span className="aur-badge">
          <FiCalendar size={13} />
          {formatDateLong(grupo.fechaCreacion)}
        </span>
        {grupo.cosecha && <span className="aur-badge aur-badge--violet">{grupo.cosecha}</span>}
        {grupo.etapa   && <span className="aur-badge aur-badge--blue">{grupo.etapa}</span>}
        {selectedBloques.length > 0 && (
          <span className="aur-badge aur-badge--green">
            <FiLayers size={13} />
            {selectedBloques.length} bloque(s)
          </span>
        )}
        {grupo.paqueteId && (
          <span
            className={`aur-badge${isArchivedPkg ? ' aur-badge--archived' : ''}`}
            title={isArchivedPkg ? 'El paquete técnico asignado a este grupo está archivado.' : undefined}
          >
            <FiPackage size={13} />
            {grupoPkgName}
            {isArchivedPkg && <span className="aur-badge-archived-tag">archivado</span>}
          </span>
        )}
        {grupo.paqueteMuestreoId && (
          <span className="aur-badge">
            <FiPackage size={13} />
            {monitoreoPkgName}
          </span>
        )}
        {fechaCosecha && (
          <span
            className={`aur-badge aur-badge--yellow${!configLoaded ? ' aur-badge--archived' : ''}`}
            title={!configLoaded
              ? 'Configuración no cargada — fecha estimada con valores por defecto (150/215/250 días). Ajustá los parámetros de cultivo en /config para una proyección calibrada.'
              : undefined}
          >
            Cosecha est.: {formatDateLong(fechaCosecha)}
          </span>
        )}
      </div>

      <div className="grupo-hub-bloques-header">
        <p className="grupo-hub-bloques-title">Bloques</p>
        {hasActiveFilters && (
          <button className="aur-btn-text" onClick={clearColFilters}>
            <FiX size={11} /> Limpiar filtros
          </button>
        )}
      </div>
      {selectedBloques.length === 0 ? (
        <p className="empty-state">Este grupo no tiene bloques asignados.</p>
      ) : sortedRows.length === 0 ? (
        // Filtros activos pero ningún bloque coincide. Sin este estado el
        // usuario percibe la tabla como "rota" — headers + tfoot ausentes
        // y cero filas. La acción del EmptyState dispara el mismo clear
        // que el botón del header, duplicado a propósito para que esté al
        // alcance sin tener que rastrear con la vista.
        <EmptyState
          variant="compact"
          icon={FiFilter}
          title="Ningún bloque coincide con los filtros"
          subtitle="Ajustá o limpiá los filtros aplicados para volver a ver los bloques del grupo."
          action={
            <button className="aur-btn-pill" onClick={clearColFilters}>
              <FiX size={11} aria-hidden="true" /> Limpiar filtros
            </button>
          }
        />
      ) : (
        <div className="aur-table-wrap">
          <table className="aur-table grupo-hub-table">
            <thead>
              <tr>
                {!hiddenCols.has('loteNombre') && <BloqueSortTh {...sortThProps} field="loteNombre">Lote</BloqueSortTh>}
                {!hiddenCols.has('bloque')     && <BloqueSortTh {...sortThProps} field="bloque">Bloque</BloqueSortTh>}
                {!hiddenCols.has('ha')         && <BloqueSortTh {...sortThProps} field="ha" filterType="number">Ha.</BloqueSortTh>}
                {!hiddenCols.has('plantas')    && <BloqueSortTh {...sortThProps} field="plantas" filterType="number">Plantas</BloqueSortTh>}
                {!hiddenCols.has('material')   && <BloqueSortTh {...sortThProps} field="material">Material</BloqueSortTh>}
                {!hiddenCols.has('kg')         && <BloqueSortTh {...sortThProps} field="kg" filterType="number">Kg Est.</BloqueSortTh>}
                <th className="aur-th-col-menu">
                  <button
                    className={`aur-col-menu-trigger${hiddenCols.size > 0 ? ' is-active' : ''}`}
                    onClick={openColMenu}
                    title="Personalizar columnas visibles"
                    aria-label="Personalizar columnas visibles"
                    aria-haspopup="menu"
                    aria-expanded={!!colMenu}
                  >
                    <FiSliders size={12} aria-hidden="true" />
                    {hiddenCols.size > 0 && <span className="aur-col-hidden-badge">{hiddenCols.size}</span>}
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map(b => (
                <tr key={b.id}>
                  {!hiddenCols.has('loteNombre') && <td>{b.loteNombre || '—'}</td>}
                  {!hiddenCols.has('bloque')     && <td>{b.bloque || '—'}</td>}
                  {!hiddenCols.has('ha')         && <td className="aur-td-num">{formatHa(b.ha)}</td>}
                  {!hiddenCols.has('plantas')    && <td className="aur-td-num">{b.plantas?.toLocaleString() ?? '—'}</td>}
                  {!hiddenCols.has('material')   && <td>{b.material || '—'}</td>}
                  {!hiddenCols.has('kg')         && <td className="aur-td-num">{b.kg ? b.kg.toLocaleString('es-CR', { maximumFractionDigits: 0 }) : '—'}</td>}
                  <td />
                </tr>
              ))}
            </tbody>
            {sortedRows.length > 0 && (
              <tfoot>
                <tr>
                  {!hiddenCols.has('loteNombre') && <td><strong>Totales</strong></td>}
                  {!hiddenCols.has('bloque')     && <td />}
                  {!hiddenCols.has('ha')         && <td className="aur-td-num"><strong>{formatHa(filtTotalHa)}</strong></td>}
                  {!hiddenCols.has('plantas')    && <td className="aur-td-num"><strong>{filtTotalPlantas.toLocaleString()}</strong></td>}
                  {!hiddenCols.has('material')   && <td />}
                  {!hiddenCols.has('kg')         && <td className="aur-td-num"><strong>{filtTotalKg.toLocaleString('es-CR', { maximumFractionDigits: 0 })}</strong></td>}
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}

      {/* Popover de filtro por columna — fixed position vía portal interno
         de AuroraFilterPopover. Se rendea fuera de la tabla porque flota. */}
      {filterPop && (
        filterPop.filterType !== 'text' ? (
          <AuroraFilterPopover
            x={filterPop.x}
            y={filterPop.y}
            filterType={filterPop.filterType}
            fromValue={colFilters[filterPop.field]?.from || ''}
            toValue={colFilters[filterPop.field]?.to || ''}
            onFromChange={(from) => setColFilter(filterPop.field, { type: 'range', from, to: colFilters[filterPop.field]?.to || '' })}
            onToChange={(to) => setColFilter(filterPop.field, { type: 'range', from: colFilters[filterPop.field]?.from || '', to })}
            onClear={() => setColFilter(filterPop.field, null)}
            onClose={() => setFilterPop(null)}
          />
        ) : (
          <AuroraFilterPopover
            x={filterPop.x}
            y={filterPop.y}
            filterType="text"
            textValue={colFilters[filterPop.field]?.value || ''}
            onTextChange={(value) => setColFilter(filterPop.field, { type: 'text', value })}
            onClear={() => setColFilter(filterPop.field, null)}
            onClose={() => setFilterPop(null)}
          />
        )
      )}

      {/* Menú de columnas visibles — portal a body porque debe escapar
         del overflow de la tabla. */}
      {colMenu && createPortal(
        <>
          <div className="aur-filter-backdrop" onClick={closeColMenu} />
          <div className="aur-col-menu" style={{ left: colMenu.x, top: colMenu.y }}>
            <div className="aur-col-menu-title">Columnas visibles</div>
            {BLOQUE_COLS.map(col => (
              <label key={col.id} className="aur-col-menu-item">
                <input
                  type="checkbox"
                  checked={!hiddenCols.has(col.id)}
                  onChange={() => toggleHiddenCol(col.id)}
                />
                <span>{col.label}</span>
              </label>
            ))}
            {hiddenCols.size > 0 && (
              <button className="aur-col-menu-reset" onClick={() => { resetHiddenCols(); closeColMenu(); }}>
                Mostrar todas
              </button>
            )}
          </div>
        </>,
        document.body
      )}
    </div>
  );
}
