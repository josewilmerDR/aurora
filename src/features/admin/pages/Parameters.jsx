import { useState, useEffect, useCallback } from 'react';
import { FiEdit2, FiSave, FiX, FiInfo, FiAlertTriangle } from 'react-icons/fi';
import Toast from '../../../components/Toast';
import AuroraConfirmModal from '../../../components/AuroraConfirmModal';
import EmptyState from '../../../components/ui/EmptyState';
import { useApiFetch } from '../../../hooks/useApiFetch';
import '../styles/parameters.css';

// ── Parameter definitions ────────────────────────────────────────────────────
const SECTIONS = [
  {
    title: 'Tiempos de Cosecha',
    // Estos días sólo alimentan el cálculo de fechas estimadas en las cédulas
    // (cedulas-helpers / field-records). Las proyecciones por grupo usan los
    // días de desarrollo de Ajustes de cuenta, por eso lo aclaramos en la UI.
    note: 'Estos días alimentan las fechas estimadas de cosecha en las cédulas. Las proyecciones por grupo usan los días de desarrollo configurados en Ajustes de cuenta.',
    params: [
      { key: 'diasSiembraICosecha', label: 'Días desde siembra hasta I Cosecha', unit: 'días', default: 400, min: 1, step: 1 },
      { key: 'diasForzaICosecha',   label: 'Días desde forza hasta I Cosecha',   unit: 'días', default: 150, min: 1, step: 1 },
      // default alineado con el fallback real del cálculo (cedulas-helpers.js,
      // field-records/{apply,create}.js usan 215). Antes la UI mostraba 365 y
      // el cálculo usaba 215 → el admin leía un número y el sistema usaba otro.
      { key: 'diasChapeaIICosecha',  label: 'Días desde chapea hasta II Cosecha',  unit: 'días', default: 215, min: 1, step: 1 },
      { key: 'diasForzaIICosecha',   label: 'Días desde forza hasta II Cosecha',   unit: 'días', default: 150, min: 1, step: 1 },
      // Nota: las cosechas III+ (caña hasta 5, piña extendida tras valoración)
      // todavía no tienen consumo en los cálculos de cédulas/proyección, así que
      // no exponemos días editables que no moverían nada. Reintroducir cuando
      // exista el modelo multi-cosecha robusto.
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
      { key: 'rechazoICosecha',       label: 'Rechazo estimado — I Cosecha',        unit: '%', default: 10, min: 0, max: 100, step: 0.1 },
      { key: 'rechazoIICosecha',      label: 'Rechazo estimado — II Cosecha',       unit: '%', default: 20, min: 0, max: 100, step: 0.1 },
      { key: 'rechazoIIICosecha',     label: 'Rechazo estimado — III Cosecha',      unit: '%', default: 20, min: 0, max: 100, step: 0.1 },
      { key: 'mortalidadICosecha',    label: 'Mortalidad en primera cosecha',       unit: '%', default: 2,  min: 0, max: 100, step: 0.1 },
      { key: 'mortalidadIICosecha',   label: 'Mortalidad en segunda cosecha',       unit: '%', default: 10, min: 0, max: 100, step: 0.1 },
      { key: 'mortalidadIIICosecha',  label: 'Mortalidad en tercera cosecha',       unit: '%', default: 20, min: 0, max: 100, step: 0.1 },
    ],
  },
];

const ALL_PARAMS = SECTIONS.flatMap(s => s.params);
const DEFAULTS   = Object.fromEntries(ALL_PARAMS.map(p => [p.key, p.default]));

function fromApi(data) {
  return Object.fromEntries(ALL_PARAMS.map(p => [p.key, data[p.key] ?? p.default]));
}

// Formato con separador de miles local (es-CR), consistente con el resto de la
// app. Si el valor no es numérico lo devuelve crudo para no romper el render.
function formatValue(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString('es-CR') : value;
}

// Devuelve los params cuyo valor en el draft es inválido: vacío, no numérico, o
// fuera del rango [min, max]. El backend hace Number() y convertiría '' en 0,
// así que validamos en cliente antes de guardar para no envenenar las
// proyecciones (p.ej. mortalidad > 100% daría Kg negativos).
function getInvalidParams(draft) {
  return ALL_PARAMS.filter(p => {
    const raw = draft[p.key];
    if (raw === '' || raw === null || raw === undefined) return true;
    const n = Number(raw);
    if (!Number.isFinite(n)) return true;
    if (p.min != null && n < p.min) return true;
    if (p.max != null && n > p.max) return true;
    return false;
  });
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
      iconVariant="neutral"
      size="wide"
      body={changes.length === 0
        ? 'No hay cambios respecto a los valores actuales.'
        : 'Se guardarán los siguientes cambios:'}
      confirmLabel="Guardar"
      confirmDisabled={changes.length === 0}
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
                  <td className="param-diff-old">{formatValue(saved[p.key])} {p.unit}</td>
                  <td className="param-diff-new aur-td-strong">{formatValue(draft[p.key])} {p.unit}</td>
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
  const [loading,     setLoading]     = useState(true);  // carga inicial
  const [loadError,   setLoadError]   = useState(false);
  const [saving,      setSaving]      = useState(false);  // guardado en curso
  const [invalidKeys, setInvalidKeys] = useState([]);
  const [toast,       setToast]       = useState(null);
  const showToast = (message, type = 'success') => setToast({ message, type });

  const loadConfig = useCallback(() => {
    setLoading(true);
    setLoadError(false);
    return apiFetch('/api/config')
      .then(r => { if (!r.ok) throw new Error('config load failed'); return r.json(); })
      .then(data => { const vals = fromApi(data); setSaved(vals); setDraft(vals); })
      .catch(() => {
        setLoadError(true);
        showToast('Error al cargar los parámetros.', 'error');
      })
      .finally(() => setLoading(false));
  }, [apiFetch]);

  useEffect(() => { loadConfig(); }, [loadConfig]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setDraft(prev => ({ ...prev, [name]: value }));
    // limpiar la marca de error en cuanto el usuario edita el campo
    setInvalidKeys(prev => (prev.includes(name) ? prev.filter(k => k !== name) : prev));
  };

  const handleUnlockConfirm = () => { setModal(null); setEditMode(true); };
  const handleCancel        = () => {
    setDraft({ ...saved });
    setEditMode(false);
    setModal(null);
    setInvalidKeys([]);
  };

  // Valida antes de abrir el diff: si hay valores vacíos/inválidos los marca en
  // rojo y avisa, sin abrir el modal de confirmación.
  const handleSaveClick = () => {
    const invalid = getInvalidParams(draft);
    if (invalid.length > 0) {
      setInvalidKeys(invalid.map(p => p.key));
      showToast('Hay valores vacíos o inválidos (marcados en rojo). Corregilos antes de guardar.', 'error');
      return;
    }
    setInvalidKeys([]);
    setModal('save');
  };

  const handleSaveConfirm = async () => {
    // Re-chequeo defensivo (el draft no debería cambiar con el modal abierto).
    const invalid = getInvalidParams(draft);
    if (invalid.length > 0) {
      setInvalidKeys(invalid.map(p => p.key));
      setModal(null);
      showToast('Hay valores vacíos o inválidos (marcados en rojo). Corregilos antes de guardar.', 'error');
      return;
    }
    setSaving(true);
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
      setInvalidKeys([]);
      showToast('Parámetros guardados correctamente.');
    } catch {
      showToast('Error al guardar los parámetros.', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      {modal === 'unlock' && <UnlockModal onConfirm={handleUnlockConfirm} onCancel={() => setModal(null)} />}
      {modal === 'save'   && <SaveModal saved={saved} draft={draft} loading={saving} onConfirm={handleSaveConfirm} onCancel={() => setModal(null)} />}

      <div className="aur-sheet">
        <header className="aur-sheet-header">
          <div className="aur-sheet-header-text">
            <h2 className="aur-sheet-title">Parámetros del sistema</h2>
            <p className="aur-sheet-subtitle">
              Valores de referencia que alimentan los cálculos de cosecha, Kg estimados y KPIs en toda la plataforma.
            </p>
          </div>
          {!loading && !loadError && (
            <div className="aur-sheet-header-actions">
              {editMode ? (
                <>
                  <button type="button" className="aur-btn-text" onClick={handleCancel}>
                    <FiX size={14} /> Cancelar
                  </button>
                  <button type="button" className="aur-btn-pill aur-btn-pill--sm" onClick={handleSaveClick}>
                    <FiSave size={14} /> Guardar
                  </button>
                </>
              ) : (
                <button type="button" className="aur-btn-pill aur-btn-pill--sm" onClick={() => setModal('unlock')}>
                  <FiEdit2 size={14} /> Editar parámetros
                </button>
              )}
            </div>
          )}
        </header>

        {loading ? (
          <div className="aur-page-loading" />
        ) : loadError ? (
          <EmptyState
            icon={FiAlertTriangle}
            title="No se pudieron cargar los parámetros"
            subtitle="Revisá tu conexión o tus permisos e intentá de nuevo."
            action={(
              <button type="button" className="aur-btn-pill aur-btn-pill--sm" onClick={loadConfig}>
                Reintentar
              </button>
            )}
          />
        ) : (
          <>
            {SECTIONS.map((section, sIdx) => (
              <section key={section.title} className="aur-section">
                <div className="aur-section-header">
                  <span className="aur-section-num">{String(sIdx + 1).padStart(2, '0')}</span>
                  <h3>{section.title}</h3>
                  <span className="aur-section-count">{section.params.length}</span>
                </div>
                {section.note && (
                  <div className="aur-banner aur-banner--info param-section-note">
                    <FiInfo size={14} />
                    <span>{section.note}</span>
                  </div>
                )}
                <div className="aur-list">
                  {section.params.map(p => {
                    const isInvalid = invalidKeys.includes(p.key);
                    const inputId = `param-${p.key}`;
                    return (
                      <div key={p.key} className="aur-row">
                        <label className="aur-row-label" htmlFor={inputId}>{p.label}</label>
                        {editMode ? (
                          <input
                            id={inputId}
                            className={`aur-input aur-input--num${isInvalid ? ' aur-input--error' : ''}`}
                            type="number"
                            min={p.min}
                            max={p.max}
                            step={p.step}
                            name={p.key}
                            value={draft[p.key]}
                            onChange={handleChange}
                            aria-invalid={isInvalid || undefined}
                          />
                        ) : (
                          <span className="param-row-value">
                            <span className="param-row-num">{formatValue(saved[p.key])}</span>
                            <span className="param-row-unit">{p.unit}</span>
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
          </>
        )}
      </div>
    </>
  );
}

export default Parameters;
