import { useState, useEffect } from 'react';
import { FiEdit2, FiSave, FiX, FiBarChart2 } from 'react-icons/fi';
import Toast from '../../../components/Toast';
import AuroraConfirmModal from '../../../components/AuroraConfirmModal';
import { useApiFetch } from '../../../hooks/useApiFetch';
import '../styles/parameters.css';

// ── Parameter definitions ────────────────────────────────────────────────────
const SECTIONS = [
  {
    title: 'Tiempos de Cosecha',
    params: [
      { key: 'diasSiembraICosecha', label: 'Días desde siembra hasta I Cosecha', unit: 'días', default: 400, min: 1, step: 1 },
      { key: 'diasForzaICosecha',   label: 'Días desde forza hasta I Cosecha',   unit: 'días', default: 150, min: 1, step: 1 },
      { key: 'diasChapeaIICosecha',  label: 'Días desde chapea hasta II Cosecha',  unit: 'días', default: 365, min: 1, step: 1 },
      { key: 'diasForzaIICosecha',   label: 'Días desde forza hasta II Cosecha',   unit: 'días', default: 150, min: 1, step: 1 },
      { key: 'diasChapeaIIICosecha', label: 'Días desde chapea hasta III Cosecha', unit: 'días', default: 365, min: 1, step: 1 },
      { key: 'diasForzaIIICosecha',  label: 'Días desde forza hasta III Cosecha',  unit: 'días', default: 150, min: 1, step: 1 },
    ],
  },
  {
    title: 'Producción',
    params: [
      { key: 'plantasPorHa',    label: 'Plantas por Ha.',              unit: 'plantas', default: 65000,  min: 1,   step: 1    },
      { key: 'kgPorCaja',        label: 'Kg/Caja',                             unit: 'kg', default: 12,  min: 0, step: 0.1  },
      { key: 'kgPorPlanta',      label: 'Kg estimados por planta - I Cosecha',  unit: 'kg', default: 1.8, min: 0, step: 0.01 },
      { key: 'kgPorPlantaII',   label: 'Kg estimados por planta - II Cosecha', unit: 'kg', default: 1.6, min: 0, step: 0.01 },
      { key: 'kgPorPlantaIII',  label: 'Kg estimados por planta - III Cosecha',unit: 'kg', default: 1.5, min: 0, step: 0.01 },
      { key: 'rechazoICosecha',       label: 'Rechazo estimado — I Cosecha',        unit: '%', default: 10, min: 0, step: 0.1 },
      { key: 'rechazoIICosecha',      label: 'Rechazo estimado — II Cosecha',       unit: '%', default: 20, min: 0, step: 0.1 },
      { key: 'rechazoIIICosecha',     label: 'Rechazo estimado — III Cosecha',      unit: '%', default: 20, min: 0, step: 0.1 },
      { key: 'mortalidadICosecha',    label: 'Mortalidad en primera cosecha',       unit: '%', default: 2,  min: 0, step: 0.1 },
      { key: 'mortalidadIICosecha',   label: 'Mortalidad en segunda cosecha',       unit: '%', default: 10, min: 0, step: 0.1 },
      { key: 'mortalidadIIICosecha',  label: 'Mortalidad en tercera cosecha',       unit: '%', default: 20, min: 0, step: 0.1 },
    ],
  },
];

const ALL_PARAMS = SECTIONS.flatMap(s => s.params);
const DEFAULTS   = Object.fromEntries(ALL_PARAMS.map(p => [p.key, p.default]));

function fromApi(data) {
  return Object.fromEntries(ALL_PARAMS.map(p => [p.key, data[p.key] ?? p.default]));
}

// ── Unlock confirmation modal ─────────────────────────────────────────────────
function UnlockModal({ onConfirm, onCancel }) {
  const [checked, setChecked] = useState(false);
  return (
    <AuroraConfirmModal
      title="Editar parámetros del sistema"
      body={(
        <>
          Modificar estos valores afectará los cálculos de <strong>fechas estimadas de cosecha</strong>,
          <strong> Kg estimados</strong> y <strong>KPIs</strong> en toda la plataforma,
          incluyendo grupos y registros existentes.
        </>
      )}
      confirmLabel="Continuar"
      confirmDisabled={!checked}
      onConfirm={onConfirm}
      onCancel={onCancel}
    >
      <div className="param-modal-gate">
        <label className="aur-toggle">
          <input
            type="checkbox"
            checked={checked}
            onChange={e => setChecked(e.target.checked)}
          />
          <span className="aur-toggle-track"><span className="aur-toggle-thumb" /></span>
          <span className="aur-toggle-label">Entiendo las implicaciones y deseo continuar</span>
        </label>
      </div>
    </AuroraConfirmModal>
  );
}

// ── Save confirmation modal ──────────────────────────────────────────────────
function SaveModal({ saved, draft, loading, onConfirm, onCancel }) {
  const changes = ALL_PARAMS.filter(p => Number(saved[p.key]) !== Number(draft[p.key]));
  return (
    <AuroraConfirmModal
      title="Confirmar cambios"
      icon={<FiSave size={16} />}
      size="wide"
      body={changes.length === 0
        ? 'No hay cambios respecto a los valores actuales.'
        : 'Se guardarán los siguientes cambios:'}
      confirmLabel="Guardar"
      loading={loading}
      loadingLabel="Guardando..."
      onConfirm={onConfirm}
      onCancel={onCancel}
    >
      {changes.length > 0 && (
        <div className="param-diff-wrap">
          <table className="aur-table param-diff-table">
            <thead>
              <tr><th>Parámetro</th><th>Anterior</th><th>Nuevo</th></tr>
            </thead>
            <tbody>
              {changes.map(p => (
                <tr key={p.key}>
                  <td>{p.label}</td>
                  <td className="param-diff-old">{saved[p.key]} {p.unit}</td>
                  <td className="param-diff-new aur-td-strong">{draft[p.key]} {p.unit}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AuroraConfirmModal>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────
function Parameters() {
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
    <>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      {modal === 'unlock' && <UnlockModal onConfirm={handleUnlockConfirm} onCancel={() => setModal(null)} />}
      {modal === 'save'   && <SaveModal saved={saved} draft={draft} loading={loading} onConfirm={handleSaveConfirm} onCancel={() => setModal(null)} />}

      <div className="aur-sheet">
        <header className="aur-sheet-header">
          <div className="aur-sheet-header-text">
            <h2 className="aur-sheet-title">Parámetros del sistema</h2>
            <p className="aur-sheet-subtitle">
              Valores de referencia que alimentan los cálculos de cosecha, Kg estimados y KPIs en toda la plataforma.
            </p>
          </div>
          <div className="aur-sheet-header-actions">
            {editMode ? (
              <>
                <button type="button" className="aur-btn-text" onClick={handleCancel}>
                  <FiX size={14} /> Cancelar
                </button>
                <button type="button" className="aur-btn-pill aur-btn-pill--sm" onClick={() => setModal('save')}>
                  <FiSave size={14} /> Guardar
                </button>
              </>
            ) : (
              <button type="button" className="aur-btn-pill aur-btn-pill--sm" onClick={() => setModal('unlock')}>
                <FiEdit2 size={14} /> Editar parámetros
              </button>
            )}
          </div>
        </header>

        <section className="aur-section">
          <div className="aur-section-header">
            <h3>KPI</h3>
          </div>
          <div className="aur-list">
            <div className="aur-row">
              <span className="aur-row-label"><FiBarChart2 size={13} /> Indicadores</span>
              <span className="param-kpi-placeholder">Próximamente — indicadores clave de rendimiento.</span>
            </div>
          </div>
        </section>

        {SECTIONS.map((section, sIdx) => (
          <section key={section.title} className="aur-section">
            <div className="aur-section-header">
              <span className="aur-section-num">{String(sIdx + 2).padStart(2, '0')}</span>
              <h3>{section.title}</h3>
              <span className="aur-section-count">{section.params.length}</span>
            </div>
            <div className="aur-list">
              {section.params.map(p => (
                <div key={p.key} className="aur-row">
                  <span className="aur-row-label">{p.label}</span>
                  {editMode ? (
                    <input
                      className="aur-input aur-input--num"
                      type="number"
                      min={p.min}
                      step={p.step}
                      name={p.key}
                      value={draft[p.key]}
                      onChange={handleChange}
                    />
                  ) : (
                    <span className="param-row-value">
                      <span className="param-row-num">{saved[p.key]}</span>
                      <span className="param-row-unit">{p.unit}</span>
                    </span>
                  )}
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}

export default Parameters;
