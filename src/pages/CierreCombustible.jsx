import { useState, useEffect } from 'react';
import { FiDroplet, FiPlay, FiCheck, FiChevronDown, FiChevronUp, FiAlertTriangle } from 'react-icons/fi';
import Toast from '../components/Toast';
import ConfirmModal from '../components/ConfirmModal';
import { useApiFetch } from '../hooks/useApiFetch';
import './CierreCombustible.css';

const fmt  = (n) => (n ?? 0).toLocaleString('es-CR', { maximumFractionDigits: 0 });
const fmtD = (n, d = 2) => (n ?? 0).toLocaleString('es-CR', { minimumFractionDigits: d, maximumFractionDigits: d });

const VAR_CLASS = (v) => v > 0 ? 'cc-var-pos' : v < 0 ? 'cc-var-neg' : '';

function MaquinaCard({ m, expanded, onToggle }) {
  return (
    <div className="cc-maquina-card">
      <button className="cc-maquina-header" onClick={onToggle}>
        <span className="cc-maquina-nombre">{m.maquinaNombre}</span>
        <span className="cc-maquina-badges">
          <span className="cc-badge">{fmtD(m.litros, 1)} L</span>
          <span className="cc-badge">{fmtD(m.totalHoras, 1)} h</span>
          {m.tasaReal !== null && <span className="cc-badge cc-badge-rate">{fmtD(m.tasaReal, 2)} L/H</span>}
          <span className={`cc-badge cc-badge-var ${VAR_CLASS(m.variacion)}`}>
            {m.variacion >= 0 ? '+' : ''}₡{fmt(m.variacion)}
          </span>
        </span>
        {expanded ? <FiChevronUp size={14} /> : <FiChevronDown size={14} />}
      </button>

      {/* Resumen de la máquina */}
      <div className="cc-maquina-resumen">
        <div className="cc-resumen-item">
          <span className="cc-resumen-label">Costo real</span>
          <span className="cc-resumen-val">₡{fmt(m.costoReal)}</span>
        </div>
        <div className="cc-resumen-item">
          <span className="cc-resumen-label">Estimado</span>
          <span className="cc-resumen-val">₡{fmt(m.costoEstimado)}</span>
        </div>
        <div className="cc-resumen-item">
          <span className="cc-resumen-label">Variación</span>
          <span className={`cc-resumen-val ${VAR_CLASS(m.variacion)}`}>
            {m.variacion >= 0 ? '+' : ''}₡{fmt(m.variacion)}
          </span>
        </div>
        {m.precioMedio > 0 && (
          <div className="cc-resumen-item">
            <span className="cc-resumen-label">Precio medio</span>
            <span className="cc-resumen-val">₡{fmt(m.precioMedio)}/L</span>
          </div>
        )}
      </div>

      {/* Tabla de horímetros */}
      {expanded && (
        <div className="cc-detalles-wrap">
          <table className="cc-detalles-table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Lote</th>
                <th>Labor</th>
                <th className="cc-td-num">Horas</th>
                <th className="cc-td-num">%</th>
                <th className="cc-td-num">Estimado</th>
                <th className="cc-td-num">Real</th>
                <th className="cc-td-num">Ajuste</th>
              </tr>
            </thead>
            <tbody>
              {m.detalles.map((d, i) => (
                <tr key={i}>
                  <td>{d.fecha}</td>
                  <td>{d.loteNombre || <span className="cc-td-empty">—</span>}</td>
                  <td>{d.labor      || <span className="cc-td-empty">—</span>}</td>
                  <td className="cc-td-num">{fmtD(d.horas, 1)}</td>
                  <td className="cc-td-num cc-td-pct">{fmtD(d.pct, 1)}%</td>
                  <td className="cc-td-num">₡{fmt(d.costoEstimado)}</td>
                  <td className="cc-td-num cc-td-real">₡{fmt(d.costoReal)}</td>
                  <td className={`cc-td-num ${VAR_CLASS(d.ajuste)}`}>
                    {d.ajuste >= 0 ? '+' : ''}₡{fmt(d.ajuste)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function CierreCombustible() {
  const apiFetch = useApiFetch();

  // Selector
  const now       = new Date();
  const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const [anio,     setAnio]     = useState(String(prevMonth.getFullYear()));
  const [mes,      setMes]      = useState(String(prevMonth.getMonth() + 1).padStart(2, '0'));
  const [bodegas,  setBodegas]  = useState([]);
  const [bodegaId, setBodegaId] = useState(() => localStorage.getItem('aurora_fuel_bodegaId') || '');

  // Preview / execution
  const [preview,   setPreview]   = useState(null);   // preview result
  const [loading,   setLoading]   = useState(false);
  const [executing, setExecuting] = useState(false);
  const [confirm,   setConfirm]   = useState(false);
  const [expanded,  setExpanded]  = useState({});      // { [maquinaId]: bool }

  // Historial
  const [historial, setHistorial] = useState([]);
  const [loadingHist, setLoadingHist] = useState(true);

  const [toast, setToast] = useState(null);
  const showToast = (message, type = 'success') => setToast({ message, type });

  const periodo = `${anio}-${mes}`;

  // Cargar bodegas y historial al montar
  useEffect(() => {
    apiFetch('/api/bodegas')
      .then(r => r.json())
      .then(data => setBodegas(Array.isArray(data) ? data.filter(b => b.tipo !== 'agroquimicos') : []))
      .catch(() => {});

    apiFetch('/api/cierres-combustible')
      .then(r => r.json())
      .then(data => setHistorial(Array.isArray(data) ? data : []))
      .catch(() => {})
      .finally(() => setLoadingHist(false));
  }, []);

  // Limpiar preview al cambiar periodo/bodega
  useEffect(() => { setPreview(null); }, [periodo, bodegaId]);

  const handlePreview = async () => {
    if (!bodegaId) { showToast('Seleccione una bodega de combustible.', 'error'); return; }
    setLoading(true);
    setPreview(null);
    setExpanded({});
    try {
      const res  = await apiFetch('/api/cierres-combustible', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ periodo, bodegaId, preview: true }),
      });
      const data = await res.json();
      if (!res.ok) { showToast(data.message || 'Error al calcular la vista previa.', 'error'); return; }
      setPreview(data);
      // Expand the first machine by default
      if (data.maquinas?.length) setExpanded({ [data.maquinas[0].maquinaId]: true });
    } catch {
      showToast('Error de conexión.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleExecute = async () => {
    setExecuting(true);
    setConfirm(false);
    try {
      const res  = await apiFetch('/api/cierres-combustible', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ periodo, bodegaId, preview: false }),
      });
      const data = await res.json();
      if (!res.ok) { showToast(data.message || 'Error al ejecutar el cierre.', 'error'); return; }
      showToast(`Cierre ${periodo} ejecutado. ${preview?.maquinas?.length ?? 0} máquina(s) procesada(s).`);
      setPreview(null);
      // Refrescar historial
      apiFetch('/api/cierres-combustible').then(r => r.json()).then(d => setHistorial(Array.isArray(d) ? d : []));
    } catch {
      showToast('Error de conexión.', 'error');
    } finally {
      setExecuting(false);
    }
  };

  const totalVariacion = preview?.maquinas?.reduce((s, m) => s + m.variacion, 0) ?? 0;

  return (
    <>
    <div className="cc-wrap">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      {confirm && (
        <ConfirmModal
          title={`Ejecutar cierre ${periodo}`}
          message={`Se actualizarán ${preview?.maquinas?.reduce((s, m) => s + m.detalles.length, 0) ?? 0} registros de horímetro con el costo real de combustible. Esta acción no se puede deshacer fácilmente.`}
          confirmLabel="Ejecutar cierre"
          onConfirm={handleExecute}
          onCancel={() => setConfirm(false)}
        />
      )}

      {/* ── Encabezado ── */}
      <div className="cc-toolbar">
        <h1 className="cc-title">
          <FiDroplet size={18} /> Cierre Mensual de Combustible
        </h1>
      </div>

      {/* ── Selector ── */}
      <div className="cc-selector-card">
        <div className="cc-selector-row">
          <div className="cc-field">
            <label>Año</label>
            <select value={anio} onChange={e => setAnio(e.target.value)}>
              {[0, 1, 2].map(i => {
                const y = String(now.getFullYear() - i);
                return <option key={y} value={y}>{y}</option>;
              })}
            </select>
          </div>
          <div className="cc-field">
            <label>Mes</label>
            <select value={mes} onChange={e => setMes(e.target.value)}>
              {['01','02','03','04','05','06','07','08','09','10','11','12'].map(m => (
                <option key={m} value={m}>
                  {new Date(2000, Number(m) - 1, 1).toLocaleString('es-ES', { month: 'long' })}
                </option>
              ))}
            </select>
          </div>
          <div className="cc-field cc-field--wide">
            <label>Bodega de combustible</label>
            <select value={bodegaId} onChange={e => { setBodegaId(e.target.value); localStorage.setItem('aurora_fuel_bodegaId', e.target.value); }}>
              <option value="">— Seleccionar —</option>
              {bodegas.map(b => <option key={b.id} value={b.id}>{b.nombre}</option>)}
            </select>
          </div>
          <button className="btn btn-secondary cc-btn-preview" onClick={handlePreview} disabled={loading || !bodegaId}>
            {loading ? 'Calculando…' : 'Vista previa'}
          </button>
        </div>
      </div>

      {/* ── Preview ── */}
      {preview && (
        <div className="cc-preview-section">
          <div className="cc-preview-header">
            <span className="cc-preview-periodo">{periodo}</span>
            <span className="cc-preview-summary">
              {preview.maquinas.length} máquina{preview.maquinas.length !== 1 ? 's' : ''} ·
              Variación total:&nbsp;
              <span className={VAR_CLASS(totalVariacion)}>
                {totalVariacion >= 0 ? '+' : ''}₡{fmt(totalVariacion)}
              </span>
            </span>
            {totalVariacion === 0 && (
              <span className="cc-preview-cero">
                <FiCheck size={13} /> Estimado = Real, sin ajuste necesario
              </span>
            )}
          </div>

          {preview.maquinas.map(m => (
            <MaquinaCard
              key={m.maquinaId}
              m={m}
              expanded={!!expanded[m.maquinaId]}
              onToggle={() => setExpanded(p => ({ ...p, [m.maquinaId]: !p[m.maquinaId] }))}
            />
          ))}

          <div className="cc-execute-bar">
            <div className="cc-execute-warning">
              <FiAlertTriangle size={14} />
              <span>Ejecutar el cierre actualiza el costo real en cada horímetro del periodo. No se puede deshacer automáticamente.</span>
            </div>
            <button
              className="btn btn-primary cc-btn-execute"
              onClick={() => setConfirm(true)}
              disabled={executing}
            >
              <FiPlay size={14} /> {executing ? 'Ejecutando…' : `Ejecutar cierre ${periodo}`}
            </button>
          </div>
        </div>
      )}

      {/* ── Historial ── */}
      <section className="cc-historial-section">
        <h2 className="cc-section-title">Cierres ejecutados</h2>
        {loadingHist ? (
          <p className="cc-empty">Cargando…</p>
        ) : historial.length === 0 ? (
          <p className="cc-empty">No hay cierres registrados aún.</p>
        ) : (
          <table className="cc-hist-table">
            <thead>
              <tr>
                <th>Periodo</th>
                <th>Bodega</th>
                <th className="cc-td-num">Máquinas</th>
                <th className="cc-td-num">Horímetros</th>
                <th className="cc-td-num">Variación total</th>
                <th>Ejecutado</th>
              </tr>
            </thead>
            <tbody>
              {historial.map(c => {
                const varTotal = (c.maquinas || []).reduce((s, m) => s + m.variacion, 0);
                const nHorim   = (c.maquinas || []).reduce((s, m) => s + (m.detalles?.length || 0), 0);
                return (
                  <tr key={c.id}>
                    <td className="cc-hist-periodo">{c.periodo}</td>
                    <td>{c.bodegaNombre}</td>
                    <td className="cc-td-num">{c.maquinas?.length ?? 0}</td>
                    <td className="cc-td-num">{nHorim}</td>
                    <td className={`cc-td-num ${VAR_CLASS(varTotal)}`}>
                      {varTotal >= 0 ? '+' : ''}₡{fmt(varTotal)}
                    </td>
                    <td className="cc-hist-fecha">
                      {c.creadoEn ? new Date(c.creadoEn).toLocaleDateString('es-CR') : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
    </>
  );
}
