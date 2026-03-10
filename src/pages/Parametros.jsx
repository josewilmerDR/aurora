import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { FiEdit2, FiSave, FiX, FiAlertTriangle } from 'react-icons/fi';
import Toast from '../components/Toast';
import { useApiFetch } from '../hooks/useApiFetch';
import './Parametros.css';

// ── Definición de parámetros ──────────────────────────────────────────────────
const SECTIONS = [
  {
    title: 'Tiempos de Cosecha',
    params: [
      { key: 'diasSiembraICosecha', label: 'Días desde siembra hasta I Cosecha', unit: 'días', default: 400, min: 1, step: 1 },
      { key: 'diasForzaICosecha',   label: 'Días desde forza hasta I Cosecha',   unit: 'días', default: 150, min: 1, step: 1 },
      { key: 'diasChapeaIICosecha', label: 'Días desde chapea hasta II Cosecha', unit: 'días', default: 215, min: 1, step: 1 },
      { key: 'diasForzaIICosecha',  label: 'Días desde forza hasta II Cosecha',  unit: 'días', default: 150, min: 1, step: 1 },
    ],
  },
  {
    title: 'Producción',
    params: [
      { key: 'plantasPorHa',    label: 'Plantas por Ha.',              unit: 'plantas', default: 65000,  min: 1,   step: 1    },
      { key: 'kgPorPlanta',     label: 'Kg estimados por planta',      unit: 'kg',      default: 1.6,    min: 0,   step: 0.01 },
      { key: 'kgPorHa',        label: 'Kg estimados por Ha.',          unit: 'kg',      default: 104000, min: 1,   step: 1    },
      { key: 'rechazoICosecha', label: 'Rechazo estimado — I Cosecha', unit: '%',       default: 10,     min: 0,   step: 0.1  },
      { key: 'rechazoIICosecha',label: 'Rechazo estimado — II Cosecha',unit: '%',       default: 20,     min: 0,   step: 0.1  },
    ],
  },
];

const ALL_PARAMS = SECTIONS.flatMap(s => s.params);
const DEFAULTS   = Object.fromEntries(ALL_PARAMS.map(p => [p.key, p.default]));

function fromApi(data) {
  return Object.fromEntries(ALL_PARAMS.map(p => [p.key, data[p.key] ?? p.default]));
}

// ── Modal de desbloqueo ───────────────────────────────────────────────────────
function UnlockModal({ onConfirm, onCancel }) {
  const [checked, setChecked] = useState(false);
  return createPortal(
    <div className="param-modal-backdrop">
      <div className="param-modal">
        <div className="param-modal-header">
          <FiAlertTriangle size={18} className="param-modal-icon-warn" />
          <span>Editar parámetros del sistema</span>
        </div>
        <p className="param-modal-body">
          Modificar estos valores afectará los cálculos de <strong>fechas estimadas de cosecha</strong>,
          <strong> Kg estimados</strong> y <strong>KPIs</strong> en toda la plataforma,
          incluyendo grupos y registros existentes.
        </p>
        <label className="param-modal-check">
          <input type="checkbox" checked={checked} onChange={e => setChecked(e.target.checked)} />
          Entiendo las implicaciones y deseo continuar
        </label>
        <div className="param-modal-actions">
          <button className="btn btn-secondary" onClick={onCancel}>Cancelar</button>
          <button className="btn btn-primary" disabled={!checked} onClick={onConfirm}>
            Continuar
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ── Modal de confirmación de guardado ─────────────────────────────────────────
function SaveModal({ saved, draft, loading, onConfirm, onCancel }) {
  const changes = ALL_PARAMS.filter(p => Number(saved[p.key]) !== Number(draft[p.key]));
  return createPortal(
    <div className="param-modal-backdrop">
      <div className="param-modal param-modal--save">
        <div className="param-modal-header">
          <FiSave size={16} />
          <span>Confirmar cambios</span>
        </div>
        {changes.length === 0 ? (
          <p className="param-modal-body">No hay cambios respecto a los valores actuales.</p>
        ) : (
          <>
            <p className="param-modal-body">Se guardarán los siguientes cambios:</p>
            <table className="param-diff-table">
              <thead>
                <tr><th>Parámetro</th><th>Anterior</th><th>Nuevo</th></tr>
              </thead>
              <tbody>
                {changes.map(p => (
                  <tr key={p.key}>
                    <td>{p.label}</td>
                    <td className="param-diff-old">{saved[p.key]} {p.unit}</td>
                    <td className="param-diff-new">{draft[p.key]} {p.unit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
        <div className="param-modal-actions">
          <button className="btn btn-secondary" onClick={onCancel} disabled={loading}>Cancelar</button>
          <button className="btn btn-primary" onClick={onConfirm} disabled={loading}>
            {loading ? 'Guardando...' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ── Página principal ──────────────────────────────────────────────────────────
function Parametros() {
  const apiFetch = useApiFetch();
  const [saved,       setSaved]       = useState(DEFAULTS);
  const [draft,       setDraft]       = useState(DEFAULTS);
  const [editMode,    setEditMode]    = useState(false);
  const [modal,       setModal]       = useState(null); // 'unlock' | 'save'
  const [loading,     setLoading]     = useState(false);
  const [toast,       setToast]       = useState(null);
  const showToast = (message, type = 'success') => setToast({ message, type });

  useEffect(() => {
    apiFetch('/api/config')
      .then(r => r.json())
      .then(data => { const vals = fromApi(data); setSaved(vals); setDraft(vals); })
      .catch(console.error);
  }, []);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setDraft(prev => ({ ...prev, [name]: value }));
  };

  const handleUnlockConfirm = () => { setModal(null); setEditMode(true); };
  const handleCancel        = () => { setDraft({ ...saved }); setEditMode(false); setModal(null); };

  const handleSaveConfirm = async () => {
    setLoading(true);
    try {
      const res = await apiFetch('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      });
      if (!res.ok) throw new Error();
      const updated = fromApi(await res.json());
      setSaved(updated);
      setDraft(updated);
      setEditMode(false);
      setModal(null);
      showToast('Parámetros guardados correctamente.');
    } catch {
      showToast('Error al guardar los parámetros.', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="param-page-layout">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      {modal === 'unlock' && <UnlockModal onConfirm={handleUnlockConfirm} onCancel={() => setModal(null)} />}
      {modal === 'save'   && <SaveModal saved={saved} draft={draft} loading={loading} onConfirm={handleSaveConfirm} onCancel={() => setModal(null)} />}

      {/* ── Izquierda: KPI ── */}
      <div className="form-card param-kpi-card">
        <p className="form-section-title">KPI</p>
        <p className="param-kpi-placeholder">Próximamente — indicadores clave de rendimiento.</p>
      </div>

      {/* ── Derecha: Parámetros ── */}
      <div className="form-card param-list-card">

        <div className="param-list-header">
          {editMode ? (
            <>
              <button className="btn btn-secondary btn-sm" onClick={handleCancel}>
                <FiX size={14} /> Cancelar
              </button>
              <button className="btn btn-primary btn-sm" onClick={() => setModal('save')}>
                <FiSave size={14} /> Guardar
              </button>
            </>
          ) : (
            <button className="btn btn-secondary btn-sm" onClick={() => setModal('unlock')}>
              <FiEdit2 size={14} /> Editar parámetros
            </button>
          )}
        </div>

        {SECTIONS.map(section => (
          <div key={section.title}>
            <p className="param-list-section">{section.title}</p>
            <ul className="param-list">
              {section.params.map(p => (
                <li key={p.key} className="param-list-row">
                  <span className="param-list-label">{p.label}</span>
                  {editMode ? (
                    <input
                      className="param-list-input"
                      type="number" min={p.min} step={p.step}
                      name={p.key} value={draft[p.key]}
                      onChange={handleChange}
                    />
                  ) : (
                    <span className="param-list-value">
                      {saved[p.key]} <span className="param-list-unit">{p.unit}</span>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}

      </div>
    </div>
  );
}

export default Parametros;
