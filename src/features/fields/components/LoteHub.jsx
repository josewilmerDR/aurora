import { Fragment, useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
  FiArrowLeft, FiEye, FiEdit, FiTrash2,
  FiCalendar, FiLayers, FiPackage,
  FiX, FiSliders,
  FiAlertTriangle, FiCheckCircle, FiArrowRight,
} from 'react-icons/fi';
import EmptyState from '../../../components/ui/EmptyState';
import AuroraFilterPopover from '../../../components/AuroraFilterPopover';
import BloqueSortTh from './BloqueSortTh';
import LotePreviewModal from './LotePreviewModal';
import { formatDate } from '../lib/lotes-helpers';
import useBloqueTable from '../hooks/useBloqueTable';

const LOTE_BLOQUE_COLS = [
  { id: 'grupo',    label: 'Grupo'    },
  { id: 'bloque',   label: 'Bloque'   },
  { id: 'ha',       label: 'Ha.',     filterType: 'number' },
  { id: 'plantas',  label: 'Plantas', filterType: 'number' },
  { id: 'material', label: 'Material' },
];

/**
 * LoteHub — panel central del lote seleccionado.
 *
 * Encapsula todo lo que el usuario ve cuando hay un lote elegido: header
 * de acciones, pills de metadata, panel de cobertura de aplicaciones, y la
 * tabla de bloques con su estado completo vía `useBloqueTable`.
 *
 * El paquete técnico ya no se asigna a nivel lote (eso vivía como pill
 * clickeable acá y rompía el modelo de grupo→paquete duplicando tareas).
 * En su lugar, este hub muestra un panel de cobertura que detecta bloques
 * sin agrupar y grupos sin paquete técnico activo, y dirige al usuario a
 * /grupos con deep-link state para crear el grupo o asignar el paquete.
 *
 * Props:
 *   - lote          object  · el lote activo (parent ya filtra cuando es null)
 *   - siembras      array   · pasadas a useBloqueTable + panel de cobertura
 *   - grupos        array   · pasadas a useBloqueTable + panel de cobertura
 *   - packages      array   · resuelve grupo.paqueteId → nombre del paquete
 *                              en la sección "Paquetes activos" del panel
 *   - empresaConfig object  · branding para el documento del preview/PDF
 *   - onBack        fn      · cerrar el hub ("Todos los lotes")
 *   - onEdit        fn(lote) · abrir el modal de editar lote
 *   - onDelete      fn(lote) · abrir el flujo de eliminar (con su guardia)
 *   - onPreviewError fn     · invocado si la generación del PDF falla — el
 *                              parent decide cómo notificar (toast hoy)
 *
 * El state del preview (`previewLote`) vive acá porque el botón "ojo" que
 * lo abre, los datos que muestra (tableRows) y el modal que lo renderiza
 * son todos internos del hub. No hay razón para que el parent lo conozca.
 */
export default function LoteHub({
  lote,
  siembras,
  grupos,
  packages,
  empresaConfig,
  onBack,
  onEdit,
  onDelete,
  onPreviewError,
}) {
  const navigate = useNavigate();
  const {
    tableRows,
    groupedRows, totalHa, totalPlantas,
    sorts, setSorts,
    colFilters, setColFilter, clearColFilters, hasActiveFilters,
    filterPop, setFilterPop,
    hiddenCols, toggleHiddenCol, resetHiddenCols,
    colMenu, openColMenu, closeColMenu,
  } = useBloqueTable({ selectedLote: lote, siembras, grupos });

  const [previewLote, setPreviewLote] = useState(null);

  // ── Cobertura de aplicaciones del lote ─────────────────────────────────────
  // El paquete técnico ya no se asigna a nivel lote — vive en el grupo. Acá
  // resumimos en qué estado está la cobertura del lote: bloques sin agrupar,
  // grupos sin paquete, y paquetes activos. La info viaja vía deep-link al
  // hub de Grupos cuando el usuario quiere actuar.
  const coverage = useMemo(() => {
    // Bloques físicos del lote consolidados, conservando los siembraIds
    // (varias siembras pueden compartir un (lote, bloque) cuando hay
    // materiales/captures parciales).
    const blockMap = new Map();
    for (const s of siembras) {
      if (s.loteId !== lote.id) continue;
      const key = s.bloque || 'Sin bloque';
      if (!blockMap.has(key)) blockMap.set(key, { bloque: key, siembraIds: [] });
      blockMap.get(key).siembraIds.push(s.id);
    }
    const blocks = [...blockMap.values()];

    // Resolver bloque → grupo cruzando grupo.bloques[] (que son siembraIds)
    // contra las siembras del lote. Un mismo bloque solo puede vivir en un
    // grupo a la vez (regla del módulo), así que el primer match gana.
    const blockToGroup = new Map();
    for (const g of grupos) {
      for (const sid of (g.bloques || [])) {
        const siembra = siembras.find(x => x.id === sid);
        if (!siembra || siembra.loteId !== lote.id) continue;
        const key = siembra.bloque || 'Sin bloque';
        if (!blockToGroup.has(key)) blockToGroup.set(key, g);
      }
    }

    const ungroupedBlocks = blocks.filter(b => !blockToGroup.has(b.bloque));
    const ungroupedSiembraIds = ungroupedBlocks.flatMap(b => b.siembraIds);

    const linkedGroups = [];
    const seen = new Set();
    for (const b of blocks) {
      const g = blockToGroup.get(b.bloque);
      if (g && !seen.has(g.id)) { seen.add(g.id); linkedGroups.push(g); }
    }
    const groupsWithoutPackage = linkedGroups.filter(g => !g.paqueteId);
    const groupsWithPackage = linkedGroups
      .filter(g => g.paqueteId)
      .map(g => ({ ...g, package: packages.find(p => p.id === g.paqueteId) }));

    return {
      hasSiembras: blocks.length > 0,
      ungroupedBlocks,
      ungroupedSiembraIds,
      groupsWithoutPackage,
      groupsWithPackage,
    };
  }, [lote, siembras, grupos, packages]);

  const hasCoverageIssues = coverage.ungroupedBlocks.length > 0 || coverage.groupsWithoutPackage.length > 0;
  const allCovered = coverage.hasSiembras && !hasCoverageIssues && coverage.groupsWithPackage.length > 0;

  const handleCreateGroupWithUngrouped = () => {
    navigate('/grupos', {
      state: {
        preloadSiembraIds: coverage.ungroupedSiembraIds,
        preloadLoteCode: lote.codigoLote,
      },
    });
  };

  const handleAssignPackageToGroup = (grupoId) => {
    navigate('/grupos', { state: { selectGrupoId: grupoId } });
  };

  // Bundle compartido por las 5 cabeceras sortables. La identidad del
  // objeto cambia cada render, pero BloqueSortTh no está memoizado (ver
  // PR de audit #8) — el bundle existe para legibilidad.
  const sortThProps = { sorts, setSorts, colFilters, filterPop, setFilterPop };

  return (
    <div className="lote-hub">
      <button className="lote-hub-back" onClick={onBack}>
        <FiArrowLeft size={13} /> Todos los lotes
      </button>

      <div className="hub-header">
        <div className="hub-title-block">
          <h2 className="hub-lote-code">{lote.codigoLote}</h2>
          {lote.nombreLote && lote.nombreLote !== lote.codigoLote && (
            <span className="hub-lote-name">{lote.nombreLote}</span>
          )}
        </div>
        <div className="hub-header-actions">
          <button onClick={() => setPreviewLote(lote)} className="aur-icon-btn" title="Vista previa / PDF">
            <FiEye size={16} />
          </button>
          <button onClick={() => onEdit(lote)} className="aur-icon-btn" title="Editar lote">
            <FiEdit size={16} />
          </button>
          <button onClick={() => onDelete(lote)} className="aur-icon-btn aur-icon-btn--danger" title="Eliminar lote">
            <FiTrash2 size={16} />
          </button>
        </div>
      </div>

      <div className="hub-info-pills">
        <span className="aur-badge">
          <FiCalendar size={13} />
          Siembra: {formatDate(lote.fechaCreacion)}
        </span>
        {lote.hectareas > 0 && (
          <span className="aur-badge aur-badge--green">
            <FiLayers size={13} />
            {lote.hectareas} ha
          </span>
        )}
      </div>

      {/* Panel de cobertura: solo aparece cuando hay siembras registradas.
         Antes acá vivía la pill "Asignar paquete técnico", que escribía
         lote.paqueteId y generaba tareas a nivel lote en paralelo a las
         del grupo → duplicación silenciosa. Ahora el paquete vive en el
         grupo y este panel resume el estado de cobertura del lote. */}
      {coverage.hasSiembras && (
        <div className="lote-coverage">
          {coverage.ungroupedBlocks.length > 0 && (
            <div className="lote-coverage-card lote-coverage-card--warn">
              <div className="lote-coverage-card-head">
                <FiAlertTriangle size={14} />
                <span>
                  <strong>{coverage.ungroupedBlocks.length}</strong>{' '}
                  {coverage.ungroupedBlocks.length === 1 ? 'bloque sin agrupar' : 'bloques sin agrupar'}
                </span>
              </div>
              <div className="lote-coverage-card-body">
                {coverage.ungroupedBlocks.map(b => b.bloque).join(', ')}
              </div>
              <button
                type="button"
                className="aur-btn-pill aur-btn-pill--sm"
                onClick={handleCreateGroupWithUngrouped}
              >
                Crear grupo con {coverage.ungroupedBlocks.length === 1 ? 'este bloque' : 'estos bloques'}
                <FiArrowRight size={12} />
              </button>
            </div>
          )}

          {coverage.groupsWithoutPackage.map(g => (
            <div key={g.id} className="lote-coverage-card lote-coverage-card--warn">
              <div className="lote-coverage-card-head">
                <FiAlertTriangle size={14} />
                <span>
                  Grupo <strong>{g.nombreGrupo}</strong> sin paquete técnico
                </span>
              </div>
              <button
                type="button"
                className="aur-btn-pill aur-btn-pill--sm"
                onClick={() => handleAssignPackageToGroup(g.id)}
              >
                Asignar paquete <FiArrowRight size={12} />
              </button>
            </div>
          ))}

          {allCovered && (
            <div className="lote-coverage-card lote-coverage-card--ok">
              <div className="lote-coverage-card-head">
                <FiCheckCircle size={14} />
                <span>Todos los bloques están agrupados y con paquete técnico activo.</span>
              </div>
              <div className="lote-coverage-card-body">
                {coverage.groupsWithPackage.map(g => (
                  <button
                    key={g.id}
                    type="button"
                    className="aur-badge aur-badge--blue lote-coverage-pill"
                    onClick={() => handleAssignPackageToGroup(g.id)}
                    title={`Abrir ${g.nombreGrupo} en Grupos`}
                  >
                    <FiPackage size={11} />
                    {g.nombreGrupo} — {g.package?.nombrePaquete || 'paquete'}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="grupo-hub-bloques-header">
        <p className="grupo-hub-bloques-title">Bloques</p>
        {hasActiveFilters && (
          <button className="aur-btn-text" onClick={clearColFilters}>
            <FiX size={11} /> Limpiar filtros
          </button>
        )}
      </div>

      {groupedRows.length === 0 ? (
        <EmptyState
          variant="compact"
          icon={FiLayers}
          title="No hay registros de siembra para este lote"
          subtitle="Cuando registres una siembra para este lote aparecerán aquí los bloques sembrados."
        />
      ) : (
        <div className="aur-table-wrap">
          <table className="aur-table grupo-hub-table">
            <thead>
              <tr>
                {!hiddenCols.has('grupo')    && <BloqueSortTh {...sortThProps} field="grupo">Grupo</BloqueSortTh>}
                {!hiddenCols.has('bloque')   && <BloqueSortTh {...sortThProps} field="bloque">Bloque</BloqueSortTh>}
                {!hiddenCols.has('ha')       && <BloqueSortTh {...sortThProps} field="ha" filterType="number">Ha.</BloqueSortTh>}
                {!hiddenCols.has('plantas')  && <BloqueSortTh {...sortThProps} field="plantas" filterType="number">Plantas</BloqueSortTh>}
                {!hiddenCols.has('material') && <BloqueSortTh {...sortThProps} field="material">Material</BloqueSortTh>}
                <th className="aur-th-col-menu">
                  <button
                    className={`aur-col-menu-trigger${hiddenCols.size > 0 ? ' is-active' : ''}`}
                    onClick={openColMenu}
                    title="Personalizar columnas visibles"
                  >
                    <FiSliders size={12} />
                    {hiddenCols.size > 0 && <span className="aur-col-hidden-badge">{hiddenCols.size}</span>}
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {groupedRows.map(({ grupo, rows, totalHa: gTotalHa, totalPlantas: gTotalPlantas }) => (
                <Fragment key={grupo}>
                  {rows.map(b => (
                    <tr key={b.id}>
                      {!hiddenCols.has('grupo')    && <td>{b.grupo}</td>}
                      {!hiddenCols.has('bloque')   && <td>{b.bloque}</td>}
                      {!hiddenCols.has('ha')       && <td className="aur-td-num">{b.ha ? b.ha.toFixed(4) : '—'}</td>}
                      {!hiddenCols.has('plantas')  && <td className="aur-td-num">{b.plantas?.toLocaleString() ?? '—'}</td>}
                      {!hiddenCols.has('material') && <td>{b.material || '—'}</td>}
                      <td />
                    </tr>
                  ))}
                  <tr className="lote-subtotal-row">
                    {!hiddenCols.has('grupo')    && <td className="lote-subtotal-label">{grupo}</td>}
                    {!hiddenCols.has('bloque')   && <td />}
                    {!hiddenCols.has('ha')       && <td className="aur-td-num">{gTotalHa.toFixed(4)}</td>}
                    {!hiddenCols.has('plantas')  && <td className="aur-td-num">{gTotalPlantas.toLocaleString()}</td>}
                    {!hiddenCols.has('material') && <td />}
                    <td />
                  </tr>
                </Fragment>
              ))}
            </tbody>
            {groupedRows.length > 0 && (
              <tfoot>
                <tr>
                  {!hiddenCols.has('grupo')    && <td><strong>Totales</strong></td>}
                  {!hiddenCols.has('bloque')   && <td />}
                  {!hiddenCols.has('ha')       && <td className="aur-td-num"><strong>{totalHa.toFixed(4)}</strong></td>}
                  {!hiddenCols.has('plantas')  && <td className="aur-td-num"><strong>{totalPlantas.toLocaleString()}</strong></td>}
                  {!hiddenCols.has('material') && <td />}
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
            filterType="number"
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
            {LOTE_BLOQUE_COLS.map(col => (
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

      {previewLote && (
        <LotePreviewModal
          lote={previewLote}
          loteTableRows={tableRows}
          packages={packages}
          empresaConfig={empresaConfig}
          onClose={() => setPreviewLote(null)}
          onShareError={onPreviewError}
        />
      )}
    </div>
  );
}
