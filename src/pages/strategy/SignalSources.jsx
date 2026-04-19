import { useState, useEffect, useCallback } from 'react';
import { FiRadio, FiPlus, FiEdit2, FiTrash2, FiCheck, FiX, FiPlay, FiCloudOff, FiCloud } from 'react-icons/fi';
import Toast from '../../components/Toast';
import ConfirmModal from '../../components/ConfirmModal';
import { useApiFetch } from '../../hooks/useApiFetch';
import './strategy.css';

const SIGNAL_TYPE_LABELS = {
  weather: 'Clima',
  commodity_price: 'Precio de commodity',
  fertilizer_price: 'Precio de fertilizante',
};

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

  return (
    <div className="page-container">
      <div className="page-header">
        <h2><FiRadio /> Fuentes de Señales Externas</h2>
      </div>

      <p className="strategy-empty" style={{ padding: 0, textAlign: 'left', marginBottom: 14 }}>
        Configura fuentes externas (clima, precios) que alimentan al recomendador y disparan alertas cuando cruzan umbrales.
        El cron corre cada hora; cada fuente respeta su propio intervalo.
      </p>

      <div className="temporadas-header-actions">
        <button
          className="primary-button"
          onClick={toggleKillSwitch}
          title={killSwitchEnabled ? 'Pausar todas las ingestas' : 'Reanudar todas las ingestas'}
        >
          {killSwitchEnabled ? <FiCloud /> : <FiCloudOff />}
          {killSwitchEnabled ? 'Señales activadas' : 'Señales pausadas'}
        </button>
        <button className="primary-button" onClick={() => setForm(emptyForm())}>
          <FiPlus /> Nueva fuente
        </button>
      </div>

      {form && (
        <div className="temporada-card" style={{ gridTemplateColumns: '1fr', marginBottom: 14 }}>
          <div>
            <div className="strategy-filters">
              <div className="strategy-field" style={{ minWidth: 220 }}>
                <label>Nombre</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={e => setForm({ ...form, name: e.target.value })}
                  placeholder="Clima Santa Cruz"
                />
              </div>
              <div className="strategy-field">
                <label>Tipo</label>
                <select
                  value={form.signalType}
                  disabled={!!form.id}
                  onChange={e => setForm({ ...form, signalType: e.target.value })}
                >
                  {Object.entries(SIGNAL_TYPE_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </div>
              <div className="strategy-field">
                <label>Proveedor</label>
                <select
                  value={form.provider}
                  disabled={!!form.id}
                  onChange={e => setForm({ ...form, provider: e.target.value })}
                >
                  {providers
                    .filter(p => p.signalTypes.includes(form.signalType))
                    .map(p => <option key={p.id} value={p.id}>{p.id}</option>)}
                </select>
              </div>
              <div className="strategy-field">
                <label>Intervalo (días)</label>
                <input
                  type="number"
                  min={1}
                  max={90}
                  value={form.ingestIntervalDays}
                  onChange={e => setForm({ ...form, ingestIntervalDays: e.target.value })}
                />
              </div>
              <div className="strategy-field">
                <label>Activa</label>
                <select
                  value={form.enabled ? '1' : '0'}
                  onChange={e => setForm({ ...form, enabled: e.target.value === '1' })}
                >
                  <option value="1">Sí</option>
                  <option value="0">No</option>
                </select>
              </div>
            </div>

            {form.provider === 'openweathermap' && (
              <div className="strategy-filters" style={{ marginTop: 8 }}>
                <div className="strategy-field">
                  <label>Latitud</label>
                  <input
                    type="number" step="any"
                    value={form.config.lat}
                    onChange={e => setForm({ ...form, config: { ...form.config, lat: e.target.value } })}
                  />
                </div>
                <div className="strategy-field">
                  <label>Longitud</label>
                  <input
                    type="number" step="any"
                    value={form.config.lon}
                    onChange={e => setForm({ ...form, config: { ...form.config, lon: e.target.value } })}
                  />
                </div>
                <div className="strategy-field" style={{ flex: '1 1 200px' }}>
                  <label>Ciudad (etiqueta)</label>
                  <input
                    type="text"
                    value={form.config.city || ''}
                    onChange={e => setForm({ ...form, config: { ...form.config, city: e.target.value } })}
                  />
                </div>
              </div>
            )}

            <div className="strategy-filters" style={{ marginTop: 8 }}>
              {form.signalType === 'weather' ? (
                <>
                  <div className="strategy-field">
                    <label>Umbral lluvia (mm/24h)</label>
                    <input
                      type="number" min={0}
                      value={form.alertThresholds.rainfallMm24h ?? ''}
                      onChange={e => setForm({ ...form, alertThresholds: { ...form.alertThresholds, rainfallMm24h: e.target.value === '' ? undefined : Number(e.target.value) } })}
                    />
                  </div>
                  <div className="strategy-field">
                    <label>Umbral temp. mínima (°C)</label>
                    <input
                      type="number" step="any"
                      value={form.alertThresholds.tempMinC ?? ''}
                      onChange={e => setForm({ ...form, alertThresholds: { ...form.alertThresholds, tempMinC: e.target.value === '' ? undefined : Number(e.target.value) } })}
                    />
                  </div>
                  <div className="strategy-field">
                    <label>Umbral temp. máxima (°C)</label>
                    <input
                      type="number" step="any"
                      value={form.alertThresholds.tempMaxC ?? ''}
                      onChange={e => setForm({ ...form, alertThresholds: { ...form.alertThresholds, tempMaxC: e.target.value === '' ? undefined : Number(e.target.value) } })}
                    />
                  </div>
                </>
              ) : (
                <>
                  <div className="strategy-field">
                    <label>Umbral caída precio (%)</label>
                    <input
                      type="number" min={0}
                      value={form.alertThresholds.dropPct ?? ''}
                      onChange={e => setForm({ ...form, alertThresholds: { ...form.alertThresholds, dropPct: e.target.value === '' ? undefined : Number(e.target.value) } })}
                    />
                  </div>
                  <div className="strategy-field">
                    <label>Umbral subida precio (%)</label>
                    <input
                      type="number" min={0}
                      value={form.alertThresholds.risePct ?? ''}
                      onChange={e => setForm({ ...form, alertThresholds: { ...form.alertThresholds, risePct: e.target.value === '' ? undefined : Number(e.target.value) } })}
                    />
                  </div>
                </>
              )}
            </div>

            <div className="temporadas-header-actions" style={{ marginTop: 8, marginBottom: 0 }}>
              <button className="primary-button" onClick={handleSave} disabled={saving}>
                <FiCheck /> {saving ? 'Guardando…' : 'Guardar'}
              </button>
              <button className="primary-button" onClick={() => setForm(null)}>
                <FiX /> Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="strategy-empty">Cargando…</div>
      ) : sources.length === 0 ? (
        <div className="strategy-empty">
          No hay fuentes configuradas. Crea una para empezar a recibir señales.
        </div>
      ) : (
        <div className="temporadas-list">
          {sources.map(s => (
            <div key={s.id} className={`temporada-card ${!s.enabled ? 'temporada-card--archived' : ''}`}>
              <div>
                <div className="temporada-card-header">
                  <span className="temporada-name">{s.name}</span>
                  <span className="temporada-badge temporada-badge--manual">
                    {SIGNAL_TYPE_LABELS[s.signalType] || s.signalType}
                  </span>
                  <span className="temporada-badge temporada-badge--auto">{s.provider}</span>
                  {!s.enabled && <span className="temporada-badge temporada-badge--archived">Desactivada</span>}
                </div>
                <div className="temporada-range">
                  Intervalo: {s.ingestIntervalDays} día(s) · Última: {fmtTs(s.lastSuccessfulFetchAt)}
                  {s.consecutiveFailures > 0 && ` · ${s.consecutiveFailures} fallo(s) consecutivo(s)`}
                </div>
                {s.lastError && (
                  <div className="temporada-meta" style={{ color: '#ff8080' }}>
                    Último error: {s.lastError}
                  </div>
                )}
              </div>
              <div className="temporada-actions">
                {s.provider !== 'manual' && (
                  <button
                    className="primary-button"
                    disabled={triggering === s.id || !killSwitchEnabled}
                    onClick={() => triggerIngest(s)}
                    title={killSwitchEnabled ? 'Refrescar ahora' : 'Señales pausadas'}
                  >
                    <FiPlay />
                  </button>
                )}
                <button
                  className="primary-button"
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
                  <FiEdit2 />
                </button>
                <button className="primary-button" onClick={() => setConfirmDelete(s)}>
                  <FiTrash2 />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {toast && <Toast {...toast} onClose={() => setToast(null)} />}
      {confirmDelete && (
        <ConfirmModal
          title="Eliminar fuente"
          message={`Se eliminará "${confirmDelete.name}" y sus próximas ingestas. Las observaciones ya registradas quedan en el historial.`}
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
