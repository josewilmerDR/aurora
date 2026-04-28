import { useState, useEffect, useCallback } from 'react';
import {
  FiRadio, FiPlus, FiEdit2, FiTrash2, FiCheck, FiX, FiPlay,
  FiPower, FiList, FiSliders,
} from 'react-icons/fi';
import Toast from '../../../components/Toast';
import AuroraConfirmModal from '../../../components/AuroraConfirmModal';
import { useApiFetch } from '../../../hooks/useApiFetch';
import '../styles/strategy.css';

const SIGNAL_TYPE_LABELS = {
  weather: 'Clima',
  commodity_price: 'Precio de commodity',
  fertilizer_price: 'Precio de fertilizante',
};

// Tipo de señal = categoría informativa (azul); proveedor = origen del dato (violeta).
const SIGNAL_TYPE_VARIANT = 'aur-badge--blue';
const PROVIDER_VARIANT = 'aur-badge--violet';

function emptyForm() {
  return {
    id: null,
    name: '',
    signalType: 'weather',
    provider: 'openweathermap',
    enabled: true,
    ingestIntervalDays: 1,
    // Config OWM por defecto (Santa Cruz, Costa Rica).
    config: { lat: '', lon: '', city: '' },
    alertThresholds: { rainfallMm24h: 50, tempMinC: -1, tempMaxC: 40, dropPct: 10, risePct: 15 },
    notas: '',
  };
}

function fmtTs(ts) {
  if (!ts) return '—';
  if (ts._seconds != null) return new Date(ts._seconds * 1000).toLocaleString();
  return '—';
}

function SignalSources() {
  const apiFetch = useApiFetch();
  const [sources, setSources] = useState([]);
  const [providers, setProviders] = useState([]);
  const [killSwitchEnabled, setKillSwitchEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [triggering, setTriggering] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [sRes, pRes, cRes] = await Promise.all([
        apiFetch('/api/signals/sources'),
        apiFetch('/api/signals/providers'),
        apiFetch('/api/signals/config'),
      ]);
      const [sData, pData, cData] = await Promise.all([sRes.json(), pRes.json(), cRes.json()]);
      setSources(Array.isArray(sData) ? sData : []);
      setProviders(Array.isArray(pData) ? pData : []);
      setKillSwitchEnabled(cData?.external_signals_enabled !== false);
    } catch (e) {
      setToast({ type: 'error', message: 'No se pudieron cargar las fuentes.' });
    } finally {
      setLoading(false);
    }
  }, [apiFetch]);

  useEffect(() => { load(); }, [load]);

  const toggleKillSwitch = async () => {
    try {
      const res = await apiFetch('/api/signals/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ external_signals_enabled: !killSwitchEnabled }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || 'config update failed');
      setKillSwitchEnabled(data.external_signals_enabled);
      setToast({
        type: 'success',
        message: data.external_signals_enabled ? 'Señales externas activadas.' : 'Señales externas pausadas.',
      });
    } catch (e) {
      setToast({ type: 'error', message: e.message || 'No se pudo cambiar el estado.' });
    }
  };

  const handleSave = async () => {
    if (!form.name?.trim()) {
      setToast({ type: 'error', message: 'El nombre es requerido.' });
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        signalType: form.signalType,
        provider: form.provider,
        enabled: !!form.enabled,
        ingestIntervalDays: Math.max(1, Math.min(90, Number(form.ingestIntervalDays) || 1)),
        config: parseConfig(form.provider, form.config),
        alertThresholds: parseThresholds(form.signalType, form.alertThresholds),
        notas: form.notas || null,
      };
      const url = form.id ? `/api/signals/sources/${form.id}` : '/api/signals/sources';
      const method = form.id ? 'PUT' : 'POST';
      // En edición no enviamos signalType/provider (son fijos).
      if (form.id) {
        delete payload.signalType;
        delete payload.provider;
      }
      const res = await apiFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || 'save failed');
      setForm(null);
      load();
      setToast({ type: 'success', message: form.id ? 'Fuente actualizada.' : 'Fuente creada.' });
    } catch (e) {
      setToast({ type: 'error', message: e.message || 'No se pudo guardar.' });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    setConfirmDelete(null);
    try {
      const res = await apiFetch(`/api/signals/sources/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || 'delete failed');
      load();
      setToast({ type: 'success', message: 'Fuente eliminada.' });
    } catch (e) {
      setToast({ type: 'error', message: e.message || 'No se pudo eliminar.' });
    }
  };

  const triggerIngest = async (src) => {
    setTriggering(src.id);
    try {
      const res = await apiFetch(`/api/signals/sources/${src.id}/trigger`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || data?.error || 'trigger failed');
      setToast({
        type: data.ok ? 'success' : 'error',
        message: data.ok
          ? `Ingestado${data.dedup ? ' (dedup)' : ''}${data.alerts?.length ? ` — ${data.alerts.length} alerta(s)` : ''}.`
          : `Fallo: ${data.message || data.error}`,
      });
      load();
    } catch (e) {
      setToast({ type: 'error', message: e.message || 'No se pudo refrescar.' });
    } finally {
      setTriggering(null);
    }
  };

  const isEditing = !!form?.id;

  return (
    <div className="aur-sheet">
      <header className="aur-sheet-header">
        <div className="aur-sheet-header-text">
          <h2 className="aur-sheet-title"><FiRadio /> Fuentes de Señales Externas</h2>
          <p className="aur-sheet-subtitle">
            Configura fuentes externas (clima, precios) que alimentan al recomendador y disparan alertas cuando
            cruzan umbrales. El cron corre cada hora; cada fuente respeta su propio intervalo.
          </p>
        </div>
        {!form && (
          <div className="aur-sheet-header-actions">
            <button
              type="button"
              className="aur-btn-pill aur-btn-pill--sm"
              onClick={() => setForm(emptyForm())}
            >
              <FiPlus size={14} /> Nueva fuente
            </button>
          </div>
        )}
      </header>

      <section className="aur-section">
        <div className="aur-section-header">
          <span className="aur-section-num"><FiPower size={14} /></span>
          <h3 className="aur-section-title">Estado del sistema</h3>
        </div>
        <div className="aur-list">
          <div className="aur-row aur-row--multiline">
            <span className="aur-row-label">Señales externas</span>
            <div className="strategy-toggle-control">
              <label className="aur-toggle">
                <input
                  type="checkbox"
                  checked={killSwitchEnabled}
                  onChange={toggleKillSwitch}
                />
                <span className="aur-toggle-track"><span className="aur-toggle-thumb" /></span>
                <span className="aur-toggle-label">
                  {killSwitchEnabled ? 'Activadas' : 'Pausadas'}
                </span>
              </label>
              <p className="aur-field-hint">
                Pausar detiene todas las ingestas (cron + manuales). Las observaciones ya registradas no se
                modifican.
              </p>
            </div>
          </div>
        </div>
      </section>

      {form && (
        <section className="aur-section">
          <div className="aur-section-header">
            <span className="aur-section-num"><FiSliders size={14} /></span>
            <h3 className="aur-section-title">{isEditing ? 'Editar fuente' : 'Nueva fuente'}</h3>
            <div className="aur-section-actions">
              <button
                type="button"
                className="aur-icon-btn aur-icon-btn--sm"
                onClick={() => setForm(null)}
                title="Cancelar"
              >
                <FiX size={14} />
              </button>
            </div>
          </div>

          <div className="aur-list">
            <div className="aur-row aur-row--multiline">
              <label className="aur-row-label" htmlFor="ss-nombre">Nombre</label>
              <div className="aur-field">
                <input
                  id="ss-nombre"
                  type="text"
                  className="aur-input"
                  value={form.name}
                  onChange={e => setForm({ ...form, name: e.target.value })}
                  placeholder="Clima Santa Cruz"
                />
              </div>
            </div>
            <div className="aur-row aur-row--multiline">
              <label className="aur-row-label" htmlFor="ss-tipo">Tipo</label>
              <div className="aur-field">
                <select
                  id="ss-tipo"
                  className="aur-select"
                  value={form.signalType}
                  disabled={isEditing}
                  onChange={e => setForm({ ...form, signalType: e.target.value })}
                >
                  {Object.entries(SIGNAL_TYPE_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
                {isEditing && <p className="aur-field-hint">No editable después de crear.</p>}
              </div>
            </div>
            <div className="aur-row aur-row--multiline">
              <label className="aur-row-label" htmlFor="ss-provider">Proveedor</label>
              <div className="aur-field">
                <select
                  id="ss-provider"
                  className="aur-select"
                  value={form.provider}
                  disabled={isEditing}
                  onChange={e => setForm({ ...form, provider: e.target.value })}
                >
                  {providers
                    .filter(p => p.signalTypes.includes(form.signalType))
                    .map(p => <option key={p.id} value={p.id}>{p.id}</option>)}
                </select>
              </div>
            </div>
            <div className="aur-row aur-row--multiline">
              <label className="aur-row-label" htmlFor="ss-intervalo">Intervalo (días)</label>
              <div className="aur-field">
                <input
                  id="ss-intervalo"
                  type="number"
                  min={1}
                  max={90}
                  className="aur-input aur-input--num"
                  value={form.ingestIntervalDays}
                  onChange={e => setForm({ ...form, ingestIntervalDays: e.target.value })}
                />
              </div>
            </div>
            <div className="aur-row aur-row--multiline">
              <span className="aur-row-label">Activa</span>
              <div className="strategy-toggle-control">
                <label className="aur-toggle">
                  <input
                    type="checkbox"
                    checked={!!form.enabled}
                    onChange={e => setForm({ ...form, enabled: e.target.checked })}
                  />
                  <span className="aur-toggle-track"><span className="aur-toggle-thumb" /></span>
                  <span className="aur-toggle-label">{form.enabled ? 'Sí' : 'No'}</span>
                </label>
              </div>
            </div>

            {form.provider === 'openweathermap' && (
              <>
                <div className="aur-row aur-row--multiline">
                  <label className="aur-row-label" htmlFor="ss-lat">Latitud</label>
                  <div className="aur-field">
                    <input
                      id="ss-lat"
                      type="number"
                      step="any"
                      className="aur-input aur-input--num"
                      value={form.config.lat}
                      onChange={e => setForm({ ...form, config: { ...form.config, lat: e.target.value } })}
                    />
                  </div>
                </div>
                <div className="aur-row aur-row--multiline">
                  <label className="aur-row-label" htmlFor="ss-lon">Longitud</label>
                  <div className="aur-field">
                    <input
                      id="ss-lon"
                      type="number"
                      step="any"
                      className="aur-input aur-input--num"
                      value={form.config.lon}
                      onChange={e => setForm({ ...form, config: { ...form.config, lon: e.target.value } })}
                    />
                  </div>
                </div>
                <div className="aur-row aur-row--multiline">
                  <label className="aur-row-label" htmlFor="ss-ciudad">Ciudad (etiqueta)</label>
                  <div className="aur-field">
                    <input
                      id="ss-ciudad"
                      type="text"
                      className="aur-input"
                      value={form.config.city || ''}
                      onChange={e => setForm({ ...form, config: { ...form.config, city: e.target.value } })}
                    />
                  </div>
                </div>
              </>
            )}

            {form.signalType === 'weather' ? (
              <>
                <div className="aur-row aur-row--multiline">
                  <label className="aur-row-label" htmlFor="ss-rain">Umbral lluvia (mm/24h)</label>
                  <div className="aur-field">
                    <input
                      id="ss-rain"
                      type="number"
                      min={0}
                      className="aur-input aur-input--num"
                      value={form.alertThresholds.rainfallMm24h ?? ''}
                      onChange={e => setForm({
                        ...form,
                        alertThresholds: {
                          ...form.alertThresholds,
                          rainfallMm24h: e.target.value === '' ? undefined : Number(e.target.value),
                        },
                      })}
                    />
                  </div>
                </div>
                <div className="aur-row aur-row--multiline">
                  <label className="aur-row-label" htmlFor="ss-tmin">Umbral temp. mínima (°C)</label>
                  <div className="aur-field">
                    <input
                      id="ss-tmin"
                      type="number"
                      step="any"
                      className="aur-input aur-input--num"
                      value={form.alertThresholds.tempMinC ?? ''}
                      onChange={e => setForm({
                        ...form,
                        alertThresholds: {
                          ...form.alertThresholds,
                          tempMinC: e.target.value === '' ? undefined : Number(e.target.value),
                        },
                      })}
                    />
                  </div>
                </div>
                <div className="aur-row aur-row--multiline">
                  <label className="aur-row-label" htmlFor="ss-tmax">Umbral temp. máxima (°C)</label>
                  <div className="aur-field">
                    <input
                      id="ss-tmax"
                      type="number"
                      step="any"
                      className="aur-input aur-input--num"
                      value={form.alertThresholds.tempMaxC ?? ''}
                      onChange={e => setForm({
                        ...form,
                        alertThresholds: {
                          ...form.alertThresholds,
                          tempMaxC: e.target.value === '' ? undefined : Number(e.target.value),
                        },
                      })}
                    />
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="aur-row aur-row--multiline">
                  <label className="aur-row-label" htmlFor="ss-drop">Umbral caída precio (%)</label>
                  <div className="aur-field">
                    <input
                      id="ss-drop"
                      type="number"
                      min={0}
                      className="aur-input aur-input--num"
                      value={form.alertThresholds.dropPct ?? ''}
                      onChange={e => setForm({
                        ...form,
                        alertThresholds: {
                          ...form.alertThresholds,
                          dropPct: e.target.value === '' ? undefined : Number(e.target.value),
                        },
                      })}
                    />
                  </div>
                </div>
                <div className="aur-row aur-row--multiline">
                  <label className="aur-row-label" htmlFor="ss-rise">Umbral subida precio (%)</label>
                  <div className="aur-field">
                    <input
                      id="ss-rise"
                      type="number"
                      min={0}
                      className="aur-input aur-input--num"
                      value={form.alertThresholds.risePct ?? ''}
                      onChange={e => setForm({
                        ...form,
                        alertThresholds: {
                          ...form.alertThresholds,
                          risePct: e.target.value === '' ? undefined : Number(e.target.value),
                        },
                      })}
                    />
                  </div>
                </div>
              </>
            )}
          </div>

          <div className="aur-form-actions">
            <button
              type="button"
              className="aur-btn-text"
              onClick={() => setForm(null)}
              disabled={saving}
            >
              Cancelar
            </button>
            <button
              type="button"
              className="aur-btn-pill aur-btn-pill--sm"
              onClick={handleSave}
              disabled={saving}
            >
              <FiCheck size={14} /> {saving ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        </section>
      )}

      <section className="aur-section">
        <div className="aur-section-header">
          <span className="aur-section-num"><FiList size={14} /></span>
          <h3 className="aur-section-title">Fuentes configuradas</h3>
          {sources.length > 0 && <span className="aur-section-count">{sources.length}</span>}
        </div>

        {loading ? (
          <p className="strategy-empty">Cargando…</p>
        ) : sources.length === 0 ? (
          <p className="strategy-empty">
            No hay fuentes configuradas. Crea una para empezar a recibir señales.
          </p>
        ) : (
          <div className="aur-list">
            {sources.map(s => {
              const disabled = !s.enabled;
              return (
                <div
                  key={s.id}
                  className={`aur-row strategy-item-row${disabled ? ' is-archived' : ''}`}
                >
                  <div className="strategy-item-info">
                    <div className="strategy-item-head">
                      <span className="strategy-item-title">{s.name}</span>
                      <span className={`aur-badge ${SIGNAL_TYPE_VARIANT}`}>
                        {SIGNAL_TYPE_LABELS[s.signalType] || s.signalType}
                      </span>
                      <span className={`aur-badge ${PROVIDER_VARIANT}`}>{s.provider}</span>
                      {disabled && <span className="aur-badge aur-badge--gray">Desactivada</span>}
                    </div>
                    <div className="strategy-item-sub">
                      Intervalo: {s.ingestIntervalDays} día(s) · Última: {fmtTs(s.lastSuccessfulFetchAt)}
                      {s.consecutiveFailures > 0 && ` · ${s.consecutiveFailures} fallo(s) consecutivo(s)`}
                    </div>
                    {s.lastError && (
                      <div className="strategy-item-meta strategy-num--neg">
                        Último error: {s.lastError}
                      </div>
                    )}
                  </div>
                  <div className="strategy-item-actions">
                    {s.provider !== 'manual' && (
                      <button
                        type="button"
                        className="aur-icon-btn aur-icon-btn--sm"
                        disabled={triggering === s.id || !killSwitchEnabled}
                        onClick={() => triggerIngest(s)}
                        title={killSwitchEnabled ? 'Refrescar ahora' : 'Señales pausadas'}
                      >
                        <FiPlay size={14} />
                      </button>
                    )}
                    <button
                      type="button"
                      className="aur-icon-btn aur-icon-btn--sm"
                      title="Editar"
                      onClick={() => setForm({
                        id: s.id,
                        name: s.name,
                        signalType: s.signalType,
                        provider: s.provider,
                        enabled: s.enabled !== false,
                        ingestIntervalDays: s.ingestIntervalDays || 1,
                        config: s.config || {},
                        alertThresholds: s.alertThresholds || {},
                        notas: s.notas || '',
                      })}
                    >
                      <FiEdit2 size={14} />
                    </button>
                    <button
                      type="button"
                      className="aur-icon-btn aur-icon-btn--sm aur-icon-btn--danger"
                      title="Eliminar"
                      onClick={() => setConfirmDelete(s)}
                    >
                      <FiTrash2 size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {toast && <Toast {...toast} onClose={() => setToast(null)} />}
      {confirmDelete && (
        <AuroraConfirmModal
          danger
          title="Eliminar fuente"
          body={`Se eliminará "${confirmDelete.name}" y sus próximas ingestas. Las observaciones ya registradas quedan en el historial.`}
          confirmLabel="Eliminar"
          onConfirm={() => handleDelete(confirmDelete.id)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}

// Normalización de config antes de enviar.
function parseConfig(provider, raw) {
  const out = {};
  if (provider === 'openweathermap') {
    if (raw.lat !== '' && raw.lat !== undefined) out.lat = Number(raw.lat);
    if (raw.lon !== '' && raw.lon !== undefined) out.lon = Number(raw.lon);
    if (raw.city) out.city = String(raw.city).slice(0, 128);
  }
  return out;
}

function parseThresholds(signalType, raw) {
  const out = {};
  if (signalType === 'weather') {
    for (const k of ['rainfallMm24h', 'tempMinC', 'tempMaxC']) {
      if (Number.isFinite(Number(raw[k]))) out[k] = Number(raw[k]);
    }
  } else {
    for (const k of ['dropPct', 'risePct']) {
      if (Number.isFinite(Number(raw[k]))) out[k] = Number(raw[k]);
    }
  }
  return out;
}

export default SignalSources;
