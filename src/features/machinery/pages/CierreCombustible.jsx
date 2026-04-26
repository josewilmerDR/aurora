import { useState, useEffect } from 'react';
import { FiDroplet, FiPlay, FiCheck, FiChevronDown, FiChevronUp, FiAlertTriangle } from 'react-icons/fi';
import Toast from '../../../components/Toast';
import AuroraConfirmModal from '../../../components/AuroraConfirmModal';
import { useApiFetch } from '../../../hooks/useApiFetch';
import '../styles/machinery.css';

const fmt  = (n) => (n ?? 0).toLocaleString('es-CR', { maximumFractionDigits: 0 });
const fmtD = (n, d = 2) => (n ?? 0).toLocaleString('es-CR', { minimumFractionDigits: d, maximumFractionDigits: d });

// Convención: variación positiva (gastamos más de lo estimado) = magenta;
// negativa (ahorramos) = verde.
const VAR_CLASS = (v) => v > 0 ? 'machinery-cierre-var-pos' : v < 0 ? 'machinery-cierre-var-neg' : '';

function MaquinaCard({ m, expanded, onToggle }) {
  return (
    <div className="machinery-cierre-card">
      <button type="button" className="machinery-cierre-card-header" onClick={onToggle}>
        <span className="machinery-cierre-card-name">{m.maquinaNombre}</span>
        <span className="machinery-cierre-card-badges">
          <span className="machinery-cierre-badge">{fmtD(m.litros, 1)} L</span>
          <span className="machinery-cierre-badge">{fmtD(m.totalHoras, 1)} h</span>
          {m.tasaReal !== null && (
            <span className="machinery-cierre-badge machinery-cierre-badge--accent">{fmtD(m.tasaReal, 2)} L/H</span>
          )}
          <span className={`machinery-cierre-badge machinery-cierre-badge--var ${VAR_CLASS(m.variacion)}`}>
            {m.variacion >= 0 ? '+' : ''}₡{fmt(m.variacion)}
          </span>
        </span>
        {expanded ? <FiChevronUp size={14} /> : <FiChevronDown size={14} />}
      </button>

      <div className="machinery-cierre-stats">
        <div className="machinery-cierre-stat">
          <span className="machinery-cierre-stat-label">Costo real</span>
          <span className="machinery-cierre-stat-val">₡{fmt(m.costoReal)}</span>
        </div>
        <div className="machinery-cierre-stat">
          <span className="machinery-cierre-stat-label">Estimado</span>
          <span className="machinery-cierre-stat-val">₡{fmt(m.costoEstimado)}</span>
        </div>
        <div className="machinery-cierre-stat">
          <span className="machinery-cierre-stat-label">Variación</span>
          <span className={`machinery-cierre-stat-val ${VAR_CLASS(m.variacion)}`}>
            {m.variacion >= 0 ? '+' : ''}₡{fmt(m.variacion)}
          </span>
        </div>
        {m.precioMedio > 0 && (
          <div className="machinery-cierre-stat">
            <span className="machinery-cierre-stat-label">Precio medio</span>
            <span className="machinery-cierre-stat-val">₡{fmt(m.precioMedio)}/L</span>
          </div>
        )}
      </div>

      {expanded && (
        <div className="machinery-cierre-detail-wrap">
          <table className="aur-table machinery-cierre-detail-table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Lote</th>
                <th>Labor</th>
                <th style={{ textAlign: 'right' }}>Horas</th>
                <th style={{ textAlign: 'right' }}>%</th>
                <th style={{ textAlign: 'right' }}>Estimado</th>
                <th style={{ textAlign: 'right' }}>Real</th>
                <th style={{ textAlign: 'right' }}>Ajuste</th>
              </tr>
            </thead>
            <tbody>
              {m.detalles.map((d, i) => (
                <tr key={i}>
                  <td>{d.fecha}</td>
                  <td>{d.loteNombre || <span className="machinery-td-empty">—</span>}</td>
                  <td>{d.labor      || <span className="machinery-td-empty">—</span>}</td>
                  <td className="machinery-td-num">{fmtD(d.horas, 1)}</td>
                  <td className="machinery-td-num">{fmtD(d.pct, 1)}%</td>
                  <td className="machinery-td-num">₡{fmt(d.costoEstimado)}</td>
                  <td className="machinery-td-num"><strong>₡{fmt(d.costoReal)}</strong></td>
                  <td className={`machinery-td-num ${VAR_CLASS(d.ajuste)}`}>
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

  const now       = new Date();
  const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const [anio,     setAnio]     = useState(String(prevMonth.getFullYear()));
  const [mes,      setMes]      = useState(String(prevMonth.getMonth() + 1).padStart(2, '0'));
  const [bodegas,  setBodegas]  = useState([]);
  const [bodegaId, setBodegaId] = useState(() => localStorage.getItem('aurora_fuel_bodegaId') || '');

  // Preview / execution
  const [preview,   setPreview]   = useState(null);
  const [loading,   setLoading]   = useState(false);
  const [executing, setExecuting] = useState(false);
  const [confirm,   setConfirm]   = useState(false);
  const [expanded,  setExpanded]  = useState({});

  // Historial
  const [historial,   setHistorial]   = useState([]);
  const [loadingHist, setLoadingHist] = useState(true);

  const [toast, setToast] = useState(null);
  const showToast = (message, type = 'success') => setToast({ message, type });

  const periodo = `${anio}-${mes}`;

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
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Limpiar preview al cambiar periodo/bodega
  useEffect(() => { setPreview(null); }, [periodo, bodegaId]);

  const handleBodegaChange = (e) => {
    const id = e.target.value;
    setBodegaId(id);
    if (id) localStorage.setItem('aurora_fuel_bodegaId', id);
  };

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
      apiFetch('/api/cierres-combustible').then(r => r.json()).then(d => setHistorial(Array.isArray(d) ? d : []));
    } catch {
      showToast('Error de conexión.', 'error');
    } finally {
      setExecuting(false);
    }
  };

  const totalVariacion = preview?.maquinas?.reduce((s, m) => s + m.variacion, 0) ?? 0;
  const totalHorimetros = preview?.maquinas?.reduce((s, m) => s + m.detalles.length, 0) ?? 0;

  return (
    <div className="machinery-page">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {confirm && (
        <AuroraConfirmModal
          title={`Ejecutar cierre ${periodo}`}
          body={`Se actualizarán ${totalHorimetros} registros de horímetro con el costo real de combustible. Esta acción no se puede deshacer fácilmente.`}
          confirmLabel="Ejecutar cierre"
          onConfirm={handleExecute}
          onCancel={() => setConfirm(false)}
        />
      )}

      <div className="aur-sheet">
        <header className="aur-sheet-header">
          <div className="aur-sheet-header-text">
            <h1 className="aur-sheet-title">
              <FiDroplet size={20} style={{ verticalAlign: -3, marginRight: 8 }} />
              Cierre mensual de combustible
            </h1>
            <p className="aur-sheet-subtitle">
              Compara costo estimado vs real por máquina y ajusta los horímetros del periodo.
            </p>
          </div>
        </header>

        <section className="aur-section">
          <div className="aur-section-header">
            <span className="aur-section-num">01</span>
            <h3 className="aur-section-title">Periodo</h3>
          </div>
          <div className="aur-list">
            <div className="aur-row">
              <label className="aur-row-label" htmlFor="cc-anio">Año</label>
              <select id="cc-anio" className="aur-select" value={anio} onChange={e => setAnio(e.target.value)}>
                {[0, 1, 2].map(i => {
                  const y = String(now.getFullYear() - i);
                  return <option key={y} value={y}>{y}</option>;
                })}
              </select>
            </div>
            <div className="aur-row">
              <label className="aur-row-label" htmlFor="cc-mes">Mes</label>
              <select id="cc-mes" className="aur-select" value={mes} onChange={e => setMes(e.target.value)}>
                {['01','02','03','04','05','06','07','08','09','10','11','12'].map(m => (
                  <option key={m} value={m}>
                    {new Date(2000, Number(m) - 1, 1).toLocaleString('es-ES', { month: 'long' })}
                  </option>
                ))}
              </select>
            </div>
            <div className="aur-row">
              <label className="aur-row-label" htmlFor="cc-bodega">Bodega de combustible</label>
              <select id="cc-bodega" className="aur-select" value={bodegaId} onChange={handleBodegaChange}>
                <option value="">— Seleccionar —</option>
                {bodegas.map(b => <option key={b.id} value={b.id}>{b.nombre}</option>)}
              </select>
            </div>
            <div className="aur-row aur-row--action">
              <label className="aur-row-label">Vista previa</label>
              <div className="aur-row-content">
                <button
                  type="button"
                  className="aur-btn-pill aur-btn-pill--sm"
                  onClick={handlePreview}
                  disabled={loading || !bodegaId}
                >
                  {loading ? 'Calculando…' : 'Calcular cierre'}
                </button>
              </div>
            </div>
          </div>
        </section>

        {preview && (
          <section className="aur-section">
            <div className="aur-section-header">
              <span className="aur-section-num">02</span>
              <h3 className="aur-section-title">Resumen del cierre</h3>
              <span className="aur-section-count">{periodo}</span>
            </div>

            <div className="machinery-cierre-summary">
              <span>
                {preview.maquinas.length} máquina{preview.maquinas.length !== 1 ? 's' : ''} · variación total:{' '}
                <strong className={VAR_CLASS(totalVariacion)}>
                  {totalVariacion >= 0 ? '+' : ''}₡{fmt(totalVariacion)}
                </strong>
              </span>
              {totalVariacion === 0 && (
                <span className="machinery-cierre-summary-ok">
                  <FiCheck size={13} /> Estimado = Real, sin ajuste necesario
                </span>
              )}
            </div>

            <div className="machinery-cierre-list">
              {preview.maquinas.map(m => (
                <MaquinaCard
                  key={m.maquinaId}
                  m={m}
                  expanded={!!expanded[m.maquinaId]}
                  onToggle={() => setExpanded(p => ({ ...p, [m.maquinaId]: !p[m.maquinaId] }))}
                />
              ))}
            </div>

            <div className="machinery-cierre-execute">
              <div className="machinery-cierre-warning">
                <FiAlertTriangle size={14} />
                <span>
                  Ejecutar el cierre actualiza el costo real en cada horímetro del periodo.
                  No se puede deshacer automáticamente.
                </span>
              </div>
              <button
                type="button"
                className="aur-btn-pill"
                onClick={() => setConfirm(true)}
                disabled={executing}
              >
                <FiPlay size={14} /> {executing ? 'Ejecutando…' : `Ejecutar cierre ${periodo}`}
              </button>
            </div>
          </section>
        )}

        <section className="aur-section">
          <div className="aur-section-header">
            <span className="aur-section-num">{preview ? '03' : '02'}</span>
            <h3 className="aur-section-title">Cierres ejecutados</h3>
            {!loadingHist && historial.length > 0 && (
              <span className="aur-section-count">{historial.length}</span>
            )}
          </div>

          {loadingHist ? (
            <div className="aur-page-loading" />
          ) : historial.length === 0 ? (
            <div className="machinery-empty">
              <FiDroplet size={36} />
              <p className="machinery-empty-text">No hay cierres registrados aún.</p>
              <p className="machinery-empty-sub">Ejecuta tu primer cierre desde la sección de arriba.</p>
            </div>
          ) : (
            <div className="aur-table-wrap">
              <table className="aur-table">
                <thead>
                  <tr>
                    <th>Periodo</th>
                    <th>Bodega</th>
                    <th style={{ textAlign: 'right' }}>Máquinas</th>
                    <th style={{ textAlign: 'right' }}>Horímetros</th>
                    <th style={{ textAlign: 'right' }}>Variación total</th>
                    <th>Ejecutado</th>
                  </tr>
                </thead>
                <tbody>
                  {historial.map(c => {
                    const varTotal = (c.maquinas || []).reduce((s, m) => s + m.variacion, 0);
                    const nHorim   = (c.maquinas || []).reduce((s, m) => s + (m.detalles?.length || 0), 0);
                    return (
                      <tr key={c.id}>
                        <td><strong>{c.periodo}</strong></td>
                        <td>{c.bodegaNombre}</td>
                        <td className="machinery-td-num">{c.maquinas?.length ?? 0}</td>
                        <td className="machinery-td-num">{nHorim}</td>
                        <td className={`machinery-td-num ${VAR_CLASS(varTotal)}`}>
                          {varTotal >= 0 ? '+' : ''}₡{fmt(varTotal)}
                        </td>
                        <td>
                          {c.creadoEn ? new Date(c.creadoEn).toLocaleDateString('es-CR') : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
