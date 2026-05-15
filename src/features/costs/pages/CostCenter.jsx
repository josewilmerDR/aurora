import { useState, useEffect, useCallback, useMemo } from 'react';
import { FiCamera, FiTrash2, FiEye, FiColumns, FiPlus } from 'react-icons/fi';
import { useApiFetch } from '../../../hooks/useApiFetch';
import AuroraConfirmModal from '../../../components/AuroraConfirmModal';
import AuroraSkeleton from '../../../components/ui/AuroraSkeleton';
import RoiTable from '../../finance/components/RoiTable';
import CostTable from '../components/CostTable';
import SnapshotModal from '../components/SnapshotModal';
import IndirectoForm from '../components/IndirectoForm';
import { fmt, fmtKg } from '../lib/format';
import '../styles/cost-center.css';

const TABS = [
  { id: 'general',      label: 'General' },
  { id: 'lote',         label: 'Por Lote' },
  { id: 'grupo',        label: 'Por Grupo' },
  { id: 'bloque',       label: 'Por Bloque' },
  { id: 'rentabilidad', label: 'Rentabilidad' },
];

const CATEGORIAS_INDIRECTO = [
  { value: 'mantenimiento', label: 'Mantenimiento' },
  { value: 'administrativo', label: 'Administrativo' },
  { value: 'otro', label: 'Otro' },
];

const catLabel = (val) => CATEGORIAS_INDIRECTO.find(c => c.value === val)?.label || val;

function getDefaultRange() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  return { desde: `${y}-${m}-01`, hasta: `${y}-${m}-${String(new Date(y, now.getMonth() + 1, 0).getDate()).padStart(2, '0')}` };
}

const tabNameLabel = (tab) =>
  tab === 'general' ? 'Finca'
  : tab === 'lote' ? 'Lote'
  : tab === 'grupo' ? 'Grupo'
  : 'Bloque';

// ═══════════════════════════════════════════════════════════════════════
// Main component
// ═══════════════════════════════════════════════════════════════════════
export default function CostCenter() {
  const apiFetch = useApiFetch();

  // Date range
  const defaultRange = useMemo(getDefaultRange, []);
  const [desde, setDesde] = useState(defaultRange.desde);
  const [hasta, setHasta] = useState(defaultRange.hasta);

  // Live data
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  // Tabs
  const [tab, setTab] = useState('general');

  // Indirectos
  const [indirectos, setIndirectos] = useState([]);

  // Indirecto delete confirmation
  const [confirmDeleteIndirecto, setConfirmDeleteIndirecto] = useState(null);
  const [deletingIndirecto, setDeletingIndirecto] = useState(false);

  // Snapshots
  const [snapshots, setSnapshots] = useState([]);
  const [showSnapModal, setShowSnapModal] = useState(false);
  const [savingSnap, setSavingSnap] = useState(false);
  const [viewSnap, setViewSnap] = useState(null);
  const [compareSnaps, setCompareSnaps] = useState([]);
  const [confirmDeleteSnap, setConfirmDeleteSnap] = useState(null);
  const [deletingSnap, setDeletingSnap] = useState(false);

  // ── Fetch live data ───────────────────────────────────────────────
  const fetchLive = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch(`/api/costos/live?desde=${desde}&hasta=${hasta}`);
      if (res.ok) setData(await res.json());
    } catch (e) { console.error(e); }
    setLoading(false);
  }, [apiFetch, desde, hasta]);

  const fetchIndirectos = useCallback(async () => {
    try {
      const res = await apiFetch('/api/costos/indirectos');
      if (res.ok) setIndirectos(await res.json());
    } catch (e) { console.error(e); }
  }, [apiFetch]);

  const fetchSnapshots = useCallback(async () => {
    try {
      const res = await apiFetch('/api/costos/snapshots');
      if (res.ok) setSnapshots(await res.json());
    } catch (e) { console.error(e); }
  }, [apiFetch]);

  useEffect(() => { fetchLive(); }, [fetchLive]);
  useEffect(() => { fetchIndirectos(); fetchSnapshots(); }, [fetchIndirectos, fetchSnapshots]);

  // ── Indirectos CRUD ───────────────────────────────────────────────
  // IndirectoForm le pasa el body ya parseado y se limpia solo si el submit
  // resuelve sin throw. Por eso tiramos en caso de !res.ok.
  const addIndirecto = async (body) => {
    const res = await apiFetch('/api/costos/indirectos', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error('Failed to create indirecto');
    fetchIndirectos();
    fetchLive();
  };

  const deleteIndirecto = async () => {
    if (!confirmDeleteIndirecto) return;
    setDeletingIndirecto(true);
    try {
      const res = await apiFetch(`/api/costos/indirectos/${confirmDeleteIndirecto.id}`, { method: 'DELETE' });
      if (res.ok) {
        setConfirmDeleteIndirecto(null);
        fetchIndirectos();
        fetchLive();
      }
    } finally {
      setDeletingIndirecto(false);
    }
  };

  // ── Snapshot CRUD ─────────────────────────────────────────────────
  const saveSnapshot = async (nombre, tipo) => {
    if (!data) return;
    setSavingSnap(true);
    try {
      const res = await apiFetch('/api/costos/snapshots', {
        method: 'POST',
        body: JSON.stringify({ nombre, tipo, rangoFechas: data.rangoFechas, resumen: data.resumen, porLote: data.porLote, porGrupo: data.porGrupo, porBloque: data.porBloque }),
      });
      if (res.ok) { setShowSnapModal(false); fetchSnapshots(); }
    } finally {
      setSavingSnap(false);
    }
  };

  const deleteSnapshot = async () => {
    if (!confirmDeleteSnap) return;
    setDeletingSnap(true);
    try {
      const id = confirmDeleteSnap.id;
      const res = await apiFetch(`/api/costos/snapshots/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setSnapshots(s => s.filter(x => x.id !== id));
        setCompareSnaps(c => c.filter(x => x.id !== id));
        if (viewSnap?.id === id) setViewSnap(null);
        setConfirmDeleteSnap(null);
      }
    } finally {
      setDeletingSnap(false);
    }
  };

  const viewSnapshot = async (id) => {
    const res = await apiFetch(`/api/costos/snapshots/${id}`);
    if (res.ok) setViewSnap(await res.json());
  };

  const toggleCompare = async (snap) => {
    if (compareSnaps.find(c => c.id === snap.id)) {
      setCompareSnaps(c => c.filter(x => x.id !== snap.id));
      return;
    }
    if (compareSnaps.length >= 2) return;
    const res = await apiFetch(`/api/costos/snapshots/${snap.id}`);
    if (res.ok) {
      const data = await res.json();
      setCompareSnaps(c => [...c, data]);
    }
  };

  // ── Tab rows ──────────────────────────────────────────────────────
  const tabRows = useMemo(() => {
    if (!data) return [];
    switch (tab) {
      case 'general': return [{
        displayName: 'Finca (Total)',
        desglose: { combustible: data.resumen.combustible, planilla: data.resumen.planilla, insumos: data.resumen.insumos, depreciacion: data.resumen.depreciacion, indirectos: data.resumen.indirectos },
        costoTotal: data.resumen.costoTotal, kg: data.resumen.kgTotal, costoPorKg: data.resumen.costoPorKg,
      }];
      case 'lote': return data.porLote.map(r => ({ ...r, displayName: r.nombre }));
      case 'grupo': return data.porGrupo.map(r => ({ ...r, displayName: `${r.loteNombre} / ${r.grupo}` }));
      case 'bloque': return data.porBloque.map(r => ({ ...r, displayName: `${r.loteNombre} / ${r.bloque}` }));
      default: return [];
    }
  }, [data, tab]);

  const r = data?.resumen;

  // ── Indirectos filtered by date range ─────────────────────────────
  const indirectosFiltrados = useMemo(() =>
    indirectos.filter(i => i.fecha >= desde && i.fecha <= hasta),
    [indirectos, desde, hasta]
  );

  return (
    <div className="aur-sheet">
      <header className="aur-sheet-header">
        <div className="aur-sheet-header-text">
          <h1 className="aur-sheet-title">Centro de Costos</h1>
          <p className="aur-sheet-subtitle">
            Análisis de costos directos e indirectos por lote, grupo y bloque · ROI integrado.
          </p>
        </div>
      </header>

      {/* ── Date range toolbar ───────────────────────────────────────── */}
      <div className="cost-toolbar">
        <label className="cost-toolbar-label">Desde</label>
        <input
          type="date"
          className="aur-input cost-toolbar-input"
          value={desde}
          onChange={e => setDesde(e.target.value)}
        />
        <label className="cost-toolbar-label">Hasta</label>
        <input
          type="date"
          className="aur-input cost-toolbar-input"
          value={hasta}
          onChange={e => setHasta(e.target.value)}
        />
      </div>

      {/* ── Desglose legend — siempre visible como referencia ──────────── */}
      <div className="cost-legend">
        <span className="cost-legend-item"><span className="cost-legend-swatch cost-bar-comb" /> Combustible</span>
        <span className="cost-legend-item"><span className="cost-legend-swatch cost-bar-plan" /> Planilla</span>
        <span className="cost-legend-item"><span className="cost-legend-swatch cost-bar-ins" /> Insumos</span>
        <span className="cost-legend-item"><span className="cost-legend-swatch cost-bar-dep" /> Depreciación</span>
        <span className="cost-legend-item"><span className="cost-legend-swatch cost-bar-ind" /> Indirectos</span>
      </div>

      {loading && (
        <div className="cost-loading-skeleton">
          <AuroraSkeleton variant="row" count={5} label="Calculando costos…" />
        </div>
      )}

      {!loading && r && (
        <>
          {/* ── KPI cards ───────────────────────────────────────────── */}
          <div className="cost-kpis">
            <div className="cost-kpi">
              <span className="cost-kpi-label">Costo Total</span>
              <span className="cost-kpi-value">{fmt(r.costoTotal)}</span>
            </div>
            <div className="cost-kpi">
              <span className="cost-kpi-label">Kg Totales</span>
              <span className="cost-kpi-value">{fmtKg(r.kgTotal)}</span>
            </div>
            <div className="cost-kpi cost-kpi--accent">
              <span className="cost-kpi-label">Costo / Kg</span>
              <span className="cost-kpi-value">{r.costoPorKg != null ? fmt(r.costoPorKg) : '—'}</span>
            </div>
            <div className="cost-kpi">
              <span className="cost-kpi-label">% Indirectos</span>
              <span className="cost-kpi-value">{r.costoTotal > 0 ? `${((r.indirectos / r.costoTotal) * 100).toFixed(1)}%` : '—'}</span>
            </div>
          </div>

          {/* ── Tabs (segmented control en desktop, select en mobile) ──── */}
          <div className="cost-tabs cost-tabs--desktop" role="tablist">
            {TABS.map(t => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                className={`cost-tabs-btn${tab === t.id ? ' is-active' : ''}`}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="cost-tabs-mobile">
            <label className="cost-tabs-mobile-label" htmlFor="cost-tab-select">Vista:</label>
            <select
              id="cost-tab-select"
              className="aur-select cost-tabs-mobile-select"
              value={tab}
              onChange={e => setTab(e.target.value)}
            >
              {TABS.map(t => (
                <option key={t.id} value={t.id}>{t.label}</option>
              ))}
            </select>
          </div>

          {tab === 'rentabilidad' ? (
            <RoiTable desde={desde} hasta={hasta} />
          ) : (
            <CostTable rows={tabRows} nameLabel={tabNameLabel(tab)} />
          )}
        </>
      )}

      {/* ── Costos Indirectos section ────────────────────────────────── */}
      <section className="aur-section">
        <div className="aur-section-header">
          <span className="aur-section-num"><FiPlus size={14} /></span>
          <h3 className="aur-section-title">Costos indirectos manuales</h3>
          {indirectosFiltrados.length > 0 && (
            <span className="aur-section-count">{indirectosFiltrados.length}</span>
          )}
        </div>

        <IndirectoForm categorias={CATEGORIAS_INDIRECTO} onSubmit={addIndirecto} />

        {indirectosFiltrados.length > 0 && (
          <div className="aur-list">
            {indirectosFiltrados.map(item => (
              <div key={item.id} className="aur-row cost-ind-row">
                <span className="cost-ind-fecha">{item.fecha}</span>
                <span className="aur-badge aur-badge--green">{catLabel(item.categoria)}</span>
                <span className="cost-ind-desc">{item.descripcion || '—'}</span>
                <span className="cost-ind-monto">{fmt(item.monto)}</span>
                <button
                  type="button"
                  className="aur-icon-btn aur-icon-btn--sm aur-icon-btn--danger aur-touch-target"
                  onClick={() => setConfirmDeleteIndirecto({ id: item.id, fecha: item.fecha, categoria: item.categoria, monto: item.monto })}
                  title="Eliminar"
                >
                  <FiTrash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Snapshots section ────────────────────────────────────────── */}
      <section className="aur-section">
        <div className="aur-section-header">
          <span className="aur-section-num"><FiCamera size={14} /></span>
          <h3 className="aur-section-title">Historial de snapshots</h3>
          {snapshots.length > 0 && (
            <span className="aur-section-count">{snapshots.length}</span>
          )}
          {/* CTA contextual: vive donde el usuario espera la acción
              ("guardar un snapshot del estado actual"), no en el header
              global de la página. */}
          <div className="aur-section-actions">
            <button
              type="button"
              className="aur-btn-pill aur-btn-pill--sm"
              onClick={() => setShowSnapModal(true)}
              disabled={!data}
              title={!data ? 'Esperá a que carguen los costos' : undefined}
            >
              <FiCamera size={14} /> Guardar snapshot actual
            </button>
          </div>
        </div>

        {snapshots.length === 0 && (
          <div className="cost-empty">
            Aún no hay snapshots guardados. Tomá uno para comparar este período con cierres futuros.
          </div>
        )}
        {snapshots.length > 0 && (
          <div className="aur-list">
            {snapshots.map(s => {
              const isSelected = !!compareSnaps.find(c => c.id === s.id);
              return (
                <div key={s.id} className={`aur-row cost-snap-row${isSelected ? ' is-selected' : ''}`}>
                  <span className="cost-snap-name">{s.nombre}</span>
                  <span className="cost-snap-dates">{s.rangoFechas?.desde} → {s.rangoFechas?.hasta}</span>
                  <span className="cost-snap-cost">
                    {fmt(s.resumen?.costoTotal)}
                    <span className="cost-snap-cost-sep">·</span>
                    {s.resumen?.costoPorKg != null ? `${fmt(s.resumen.costoPorKg)}/kg` : '—/kg'}
                  </span>
                  <div className="cost-snap-actions">
                    <button
                      type="button"
                      className="aur-icon-btn aur-icon-btn--sm aur-touch-target"
                      onClick={() => viewSnapshot(s.id)}
                      title="Ver detalle"
                    >
                      <FiEye size={13} />
                    </button>
                    <button
                      type="button"
                      className={`aur-icon-btn aur-icon-btn--sm aur-touch-target${isSelected ? ' aur-icon-btn--success' : ''}`}
                      onClick={() => toggleCompare(s)}
                      title={isSelected ? 'Quitar de comparación' : 'Comparar'}
                    >
                      <FiColumns size={13} />
                    </button>
                    <button
                      type="button"
                      className="aur-icon-btn aur-icon-btn--sm aur-icon-btn--danger aur-touch-target"
                      onClick={() => setConfirmDeleteSnap({ id: s.id, nombre: s.nombre })}
                      title="Eliminar"
                    >
                      <FiTrash2 size={13} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* View snapshot detail */}
        {viewSnap && (
          <section className="aur-section cost-snap-detail">
            <div className="aur-section-header">
              <span className="aur-section-num"><FiEye size={14} /></span>
              <h3 className="aur-section-title">Detalle · {viewSnap.nombre}</h3>
              <div className="aur-section-actions">
                <button type="button" className="aur-btn-text" onClick={() => setViewSnap(null)}>
                  Cerrar
                </button>
              </div>
            </div>
            <div className="cost-kpis">
              <div className="cost-kpi"><span className="cost-kpi-label">Costo Total</span><span className="cost-kpi-value">{fmt(viewSnap.resumen?.costoTotal)}</span></div>
              <div className="cost-kpi"><span className="cost-kpi-label">Kg Totales</span><span className="cost-kpi-value">{fmtKg(viewSnap.resumen?.kgTotal)}</span></div>
              <div className="cost-kpi cost-kpi--accent"><span className="cost-kpi-label">Costo/Kg</span><span className="cost-kpi-value">{fmt(viewSnap.resumen?.costoPorKg)}</span></div>
            </div>
            <CostTable
              rows={(viewSnap.porLote || []).map(r => ({ ...r, displayName: r.nombre }))}
              nameLabel="Lote"
              showColumnToggle={false}
            />
          </section>
        )}

        {/* Compare two snapshots side by side */}
        {compareSnaps.length === 2 && (
          <div className="cost-compare">
            {compareSnaps.map(s => (
              <div key={s.id} className="cost-compare-col">
                <div className="cost-compare-title">
                  <span className="cost-compare-name">{s.nombre}</span>
                  <span className="cost-compare-range">{s.rangoFechas?.desde} → {s.rangoFechas?.hasta}</span>
                </div>
                <div className="cost-kpis cost-kpis--compact">
                  <div className="cost-kpi"><span className="cost-kpi-label">Costo Total</span><span className="cost-kpi-value">{fmt(s.resumen?.costoTotal)}</span></div>
                  <div className="cost-kpi"><span className="cost-kpi-label">Kg</span><span className="cost-kpi-value">{fmtKg(s.resumen?.kgTotal)}</span></div>
                  <div className="cost-kpi cost-kpi--accent"><span className="cost-kpi-label">Costo/Kg</span><span className="cost-kpi-value">{fmt(s.resumen?.costoPorKg)}</span></div>
                </div>
                <CostTable
                  rows={(s.porLote || []).map(r => ({ ...r, displayName: r.nombre }))}
                  nameLabel="Lote"
                  showColumnToggle={false}
                />
              </div>
            ))}
          </div>
        )}
        {compareSnaps.length === 1 && (
          <div className="cost-empty">Selecciona un segundo snapshot para comparar.</div>
        )}
      </section>

      {/* ── Snapshot Modal ───────────────────────────────────────────── */}
      {showSnapModal && (
        <SnapshotModal
          onClose={() => setShowSnapModal(false)}
          onSave={saveSnapshot}
          saving={savingSnap}
        />
      )}

      {/* ── Confirm delete indirecto ─────────────────────────────────── */}
      {confirmDeleteIndirecto && (
        <AuroraConfirmModal
          danger
          title="Eliminar costo indirecto"
          body={`¿Eliminar el costo indirecto del ${confirmDeleteIndirecto.fecha} (${catLabel(confirmDeleteIndirecto.categoria)} · ${fmt(confirmDeleteIndirecto.monto)})? Esta acción no se puede deshacer.`}
          confirmLabel="Eliminar"
          onConfirm={deleteIndirecto}
          onCancel={() => setConfirmDeleteIndirecto(null)}
          loading={deletingIndirecto}
        />
      )}

      {/* ── Confirm delete snapshot ──────────────────────────────────── */}
      {confirmDeleteSnap && (
        <AuroraConfirmModal
          danger
          title="Eliminar snapshot"
          body={`¿Eliminar el snapshot "${confirmDeleteSnap.nombre}"? Esta acción no se puede deshacer.`}
          confirmLabel="Eliminar"
          onConfirm={deleteSnapshot}
          onCancel={() => setConfirmDeleteSnap(null)}
          loading={deletingSnap}
        />
      )}
    </div>
  );
}
