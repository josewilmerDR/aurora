import { useState, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { FiCamera, FiTrash2, FiEye, FiColumns, FiPlus } from 'react-icons/fi';
import { useApiFetch } from '../hooks/useApiFetch';
import './CentroCostos.css';

const TABS = [
  { id: 'general', label: 'General' },
  { id: 'lote',    label: 'Por Lote' },
  { id: 'grupo',   label: 'Por Grupo' },
  { id: 'bloque',  label: 'Por Bloque' },
];

const CATEGORIAS_INDIRECTO = [
  { value: 'mantenimiento', label: 'Mantenimiento' },
  { value: 'administrativo', label: 'Administrativo' },
  { value: 'otro', label: 'Otro' },
];

const fmt = n => n != null ? n.toLocaleString('es-CR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—';
const fmtKg = n => n != null ? n.toLocaleString('es-CR', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) : '—';

function getDefaultRange() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  return { desde: `${y}-${m}-01`, hasta: `${y}-${m}-${String(new Date(y, now.getMonth() + 1, 0).getDate()).padStart(2, '0')}` };
}

// ── Mini stacked bar ────────────────────────────────────────────────
function DesgloseBar({ desglose }) {
  const { combustible = 0, planilla = 0, insumos = 0, depreciacion = 0, indirectos = 0 } = desglose || {};
  const total = combustible + planilla + insumos + depreciacion + indirectos;
  if (total <= 0) return null;
  const pct = v => `${((v / total) * 100).toFixed(1)}%`;
  return (
    <div className="cc-desglose-bar">
      {combustible > 0 && <div className="cc-bar-comb" style={{ width: pct(combustible) }} title={`Combustible: ${fmt(combustible)}`} />}
      {planilla > 0    && <div className="cc-bar-plan" style={{ width: pct(planilla) }}    title={`Planilla: ${fmt(planilla)}`} />}
      {insumos > 0     && <div className="cc-bar-ins"  style={{ width: pct(insumos) }}     title={`Insumos: ${fmt(insumos)}`} />}
      {depreciacion > 0 && <div className="cc-bar-dep" style={{ width: pct(depreciacion) }} title={`Depreciación: ${fmt(depreciacion)}`} />}
      {indirectos > 0  && <div className="cc-bar-ind"  style={{ width: pct(indirectos) }}  title={`Indirectos: ${fmt(indirectos)}`} />}
    </div>
  );
}

// ── Cost table for any tab ──────────────────────────────────────────
function CostTable({ rows, nameLabel }) {
  if (!rows || rows.length === 0) return <div className="cc-empty">Sin datos para el rango seleccionado.</div>;
  return (
    <div className="cc-table-wrap">
      <table className="cc-table">
        <thead>
          <tr>
            <th>{nameLabel}</th>
            <th className="cc-th-num">Combustible</th>
            <th className="cc-th-num">Planilla</th>
            <th className="cc-th-num">Insumos</th>
            <th className="cc-th-num">Deprec.</th>
            <th className="cc-th-num">Indirectos</th>
            <th className="cc-th-num">Total</th>
            <th className="cc-th-num">Kg</th>
            <th className="cc-th-num">Costo/Kg</th>
            <th>Composición</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td className="cc-td-name">{r.displayName}</td>
              <td className="cc-td-num">{fmt(r.desglose?.combustible)}</td>
              <td className="cc-td-num">{fmt(r.desglose?.planilla)}</td>
              <td className="cc-td-num">{fmt(r.desglose?.insumos)}</td>
              <td className="cc-td-num">{fmt(r.desglose?.depreciacion)}</td>
              <td className="cc-td-num">{fmt(r.desglose?.indirectos)}</td>
              <td className="cc-td-num" style={{ fontWeight: 600 }}>{fmt(r.costoTotal)}</td>
              <td className="cc-td-num">{fmtKg(r.kg)}</td>
              <td className="cc-td-num cc-td-costkg">{r.costoPorKg != null ? fmt(r.costoPorKg) : '—'}</td>
              <td><DesgloseBar desglose={r.desglose} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Snapshot save modal ─────────────────────────────────────────────
function SnapshotModal({ onClose, onSave }) {
  const [nombre, setNombre] = useState('');
  const [tipo, setTipo] = useState('manual');
  return createPortal(
    <div className="cc-modal-overlay" onClick={onClose}>
      <div className="cc-modal" onClick={e => e.stopPropagation()}>
        <h3>Guardar Snapshot</h3>
        <div className="cc-ind-form">
          <div className="cc-field">
            <label>Nombre</label>
            <input value={nombre} onChange={e => setNombre(e.target.value)} placeholder="Ej: Cierre Marzo 2026" />
          </div>
          <div className="cc-field">
            <label>Tipo</label>
            <select value={tipo} onChange={e => setTipo(e.target.value)}>
              <option value="manual">Manual</option>
              <option value="mensual">Mensual</option>
            </select>
          </div>
        </div>
        <div className="cc-modal-actions">
          <button className="cc-btn cc-btn--secondary" onClick={onClose}>Cancelar</button>
          <button className="cc-btn cc-btn--primary" disabled={!nombre.trim()} onClick={() => onSave(nombre.trim(), tipo)}>Guardar</button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Main component
// ═══════════════════════════════════════════════════════════════════════
export default function CentroCostos() {
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
  const [indForm, setIndForm] = useState({ fecha: '', categoria: 'mantenimiento', descripcion: '', monto: '' });

  // Snapshots
  const [snapshots, setSnapshots] = useState([]);
  const [showSnapModal, setShowSnapModal] = useState(false);
  const [viewSnap, setViewSnap] = useState(null);
  const [compareSnaps, setCompareSnaps] = useState([]);

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
  const addIndirecto = async () => {
    const { fecha, categoria, descripcion, monto } = indForm;
    if (!fecha || !monto) return;
    const res = await apiFetch('/api/costos/indirectos', {
      method: 'POST',
      body: JSON.stringify({ fecha, categoria, descripcion, monto: parseFloat(monto) }),
    });
    if (res.ok) {
      setIndForm({ fecha: '', categoria: 'mantenimiento', descripcion: '', monto: '' });
      fetchIndirectos();
      fetchLive();
    }
  };

  const deleteIndirecto = async (id) => {
    const res = await apiFetch(`/api/costos/indirectos/${id}`, { method: 'DELETE' });
    if (res.ok) { fetchIndirectos(); fetchLive(); }
  };

  // ── Snapshot CRUD ─────────────────────────────────────────────────
  const saveSnapshot = async (nombre, tipo) => {
    if (!data) return;
    const res = await apiFetch('/api/costos/snapshots', {
      method: 'POST',
      body: JSON.stringify({ nombre, tipo, rangoFechas: data.rangoFechas, resumen: data.resumen, porLote: data.porLote, porGrupo: data.porGrupo, porBloque: data.porBloque }),
    });
    if (res.ok) { setShowSnapModal(false); fetchSnapshots(); }
  };

  const deleteSnapshot = async (id) => {
    const res = await apiFetch(`/api/costos/snapshots/${id}`, { method: 'DELETE' });
    if (res.ok) { setSnapshots(s => s.filter(x => x.id !== id)); setCompareSnaps(c => c.filter(x => x.id !== id)); }
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
    <div className="page-container">
      <h1 className="page-title">Centro de Costos</h1>

      {/* ── Date range ──────────────────────────────────────────────── */}
      <div className="cc-toolbar">
        <label>Desde</label>
        <input type="date" value={desde} onChange={e => setDesde(e.target.value)} />
        <label>Hasta</label>
        <input type="date" value={hasta} onChange={e => setHasta(e.target.value)} />
        <button className="cc-btn cc-btn--primary" onClick={fetchLive} disabled={loading}>
          {loading ? 'Calculando...' : 'Actualizar'}
        </button>
        <div className="cc-toolbar-spacer" />
        <button className="cc-btn cc-btn--secondary" onClick={() => setShowSnapModal(true)} disabled={!data}>
          <FiCamera style={{ marginRight: 6 }} /> Snapshot
        </button>
      </div>

      {loading && <div className="cc-loading">Calculando costos...</div>}

      {!loading && r && (
        <>
          {/* ── KPI cards ───────────────────────────────────────────── */}
          <div className="cc-kpis">
            <div className="cc-kpi">
              <span className="cc-kpi-label">Costo Total</span>
              <span className="cc-kpi-value">{fmt(r.costoTotal)}</span>
            </div>
            <div className="cc-kpi">
              <span className="cc-kpi-label">Kg Totales</span>
              <span className="cc-kpi-value">{fmtKg(r.kgTotal)}</span>
            </div>
            <div className="cc-kpi cc-kpi--highlight">
              <span className="cc-kpi-label">Costo / Kg</span>
              <span className="cc-kpi-value">{r.costoPorKg != null ? fmt(r.costoPorKg) : '—'}</span>
            </div>
            <div className="cc-kpi">
              <span className="cc-kpi-label">% Indirectos</span>
              <span className="cc-kpi-value">{r.costoTotal > 0 ? `${((r.indirectos / r.costoTotal) * 100).toFixed(1)}%` : '—'}</span>
            </div>
          </div>

          {/* ── Desglose legend ──────────────────────────────────────── */}
          <div style={{ display: 'flex', gap: 16, marginBottom: 14, fontSize: '0.78rem', flexWrap: 'wrap' }}>
            <span><span className="cc-bar-comb" style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, marginRight: 4 }} /> Combustible</span>
            <span><span className="cc-bar-plan" style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, marginRight: 4 }} /> Planilla</span>
            <span><span className="cc-bar-ins" style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, marginRight: 4 }} /> Insumos</span>
            <span><span className="cc-bar-dep" style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, marginRight: 4 }} /> Depreciación</span>
            <span><span className="cc-bar-ind" style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, marginRight: 4 }} /> Indirectos</span>
          </div>

          {/* ── Tabs ─────────────────────────────────────────────────── */}
          <div className="cc-tabs">
            {TABS.map(t => (
              <button key={t.id} className={`cc-tab${tab === t.id ? ' cc-tab--active' : ''}`} onClick={() => setTab(t.id)}>
                {t.label}
              </button>
            ))}
          </div>

          <CostTable rows={tabRows} nameLabel={tab === 'general' ? 'Finca' : tab === 'lote' ? 'Lote' : tab === 'grupo' ? 'Grupo' : 'Bloque'} />
        </>
      )}

      {/* ── Costos Indirectos section ────────────────────────────────── */}
      <div className="cc-section">
        <div className="cc-section-title">
          <FiPlus /> Costos Indirectos Manuales
        </div>
        <div className="cc-ind-form">
          <div className="cc-field">
            <label>Fecha</label>
            <input type="date" value={indForm.fecha} onChange={e => setIndForm(f => ({ ...f, fecha: e.target.value }))} />
          </div>
          <div className="cc-field">
            <label>Categoría</label>
            <select value={indForm.categoria} onChange={e => setIndForm(f => ({ ...f, categoria: e.target.value }))}>
              {CATEGORIAS_INDIRECTO.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>
          <div className="cc-field">
            <label>Descripción</label>
            <input value={indForm.descripcion} onChange={e => setIndForm(f => ({ ...f, descripcion: e.target.value }))} placeholder="Opcional" />
          </div>
          <div className="cc-field">
            <label>Monto</label>
            <input type="number" value={indForm.monto} onChange={e => setIndForm(f => ({ ...f, monto: e.target.value }))} placeholder="0.00" />
          </div>
          <button className="cc-btn cc-btn--primary" onClick={addIndirecto} disabled={!indForm.fecha || !indForm.monto}>Agregar</button>
        </div>

        {indirectosFiltrados.length > 0 && (
          <div className="cc-ind-list">
            {indirectosFiltrados.map(item => (
              <div key={item.id} className="cc-ind-item">
                <span style={{ color: '#8ab4d8', fontSize: '0.8rem' }}>{item.fecha}</span>
                <span className="cc-ind-item-cat">{item.categoria}</span>
                <span>{item.descripcion}</span>
                <span className="cc-ind-item-monto">{fmt(item.monto)}</span>
                <button onClick={() => deleteIndirecto(item.id)} title="Eliminar"><FiTrash2 /></button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Snapshots section ────────────────────────────────────────── */}
      <div className="cc-section">
        <div className="cc-section-title">
          <FiCamera /> Historial de Snapshots
        </div>

        {snapshots.length === 0 && <div className="cc-empty">No hay snapshots guardados.</div>}
        {snapshots.length > 0 && (
          <div className="cc-snap-list">
            {snapshots.map(s => (
              <div key={s.id} className={`cc-snap-item${compareSnaps.find(c => c.id === s.id) ? ' cc-snap-item--selected' : ''}`}>
                <span className="cc-snap-name">{s.nombre}</span>
                <span className="cc-snap-dates">{s.rangoFechas?.desde} → {s.rangoFechas?.hasta}</span>
                <span className="cc-snap-cost">{fmt(s.resumen?.costoTotal)} | {s.resumen?.costoPorKg != null ? `${fmt(s.resumen.costoPorKg)}/kg` : '—/kg'}</span>
                <div className="cc-snap-actions">
                  <button onClick={() => viewSnapshot(s.id)} title="Ver detalle"><FiEye /></button>
                  <button onClick={() => toggleCompare(s)} title="Comparar"><FiColumns /></button>
                  <button onClick={() => deleteSnapshot(s.id)} title="Eliminar"><FiTrash2 /></button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* View snapshot detail */}
        {viewSnap && (
          <div className="cc-section" style={{ marginTop: 16 }}>
            <div className="cc-section-title">
              Detalle: {viewSnap.nombre}
              <button className="cc-btn cc-btn--secondary" style={{ marginLeft: 'auto', fontSize: '0.8rem' }} onClick={() => setViewSnap(null)}>Cerrar</button>
            </div>
            <div className="cc-kpis">
              <div className="cc-kpi"><span className="cc-kpi-label">Costo Total</span><span className="cc-kpi-value">{fmt(viewSnap.resumen?.costoTotal)}</span></div>
              <div className="cc-kpi"><span className="cc-kpi-label">Kg Totales</span><span className="cc-kpi-value">{fmtKg(viewSnap.resumen?.kgTotal)}</span></div>
              <div className="cc-kpi cc-kpi--highlight"><span className="cc-kpi-label">Costo/Kg</span><span className="cc-kpi-value">{fmt(viewSnap.resumen?.costoPorKg)}</span></div>
            </div>
            <CostTable rows={(viewSnap.porLote || []).map(r => ({ ...r, displayName: r.nombre }))} nameLabel="Lote" />
          </div>
        )}

        {/* Compare two snapshots side by side */}
        {compareSnaps.length === 2 && (
          <div className="cc-compare">
            {compareSnaps.map(s => (
              <div key={s.id} className="cc-compare-col">
                <div className="cc-compare-title">{s.nombre} ({s.rangoFechas?.desde} → {s.rangoFechas?.hasta})</div>
                <div className="cc-kpis" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
                  <div className="cc-kpi"><span className="cc-kpi-label">Costo Total</span><span className="cc-kpi-value" style={{ fontSize: '1.1rem' }}>{fmt(s.resumen?.costoTotal)}</span></div>
                  <div className="cc-kpi"><span className="cc-kpi-label">Kg</span><span className="cc-kpi-value" style={{ fontSize: '1.1rem' }}>{fmtKg(s.resumen?.kgTotal)}</span></div>
                  <div className="cc-kpi cc-kpi--highlight"><span className="cc-kpi-label">Costo/Kg</span><span className="cc-kpi-value" style={{ fontSize: '1.1rem' }}>{fmt(s.resumen?.costoPorKg)}</span></div>
                </div>
                <CostTable rows={(s.porLote || []).map(r => ({ ...r, displayName: r.nombre }))} nameLabel="Lote" />
              </div>
            ))}
          </div>
        )}
        {compareSnaps.length === 1 && (
          <div className="cc-empty">Selecciona un segundo snapshot para comparar.</div>
        )}
      </div>

      {/* ── Snapshot Modal ───────────────────────────────────────────── */}
      {showSnapModal && <SnapshotModal onClose={() => setShowSnapModal(false)} onSave={saveSnapshot} />}
    </div>
  );
}
