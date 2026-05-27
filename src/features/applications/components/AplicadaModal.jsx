import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { FaTractor } from 'react-icons/fa';
import { FiAlertTriangle, FiCheckCircle, FiInfo } from 'react-icons/fi';
import AuroraTimePicker from '../../../components/AuroraTimePicker';
import AuroraField, { TextInput, NumberInput, Select } from '../../../components/AuroraField';
import UserCombo from './UserCombo';
import { nowTimeStr, CONDICIONES_TIEMPO } from '../lib/cedulas-helpers';
import { useEscapeClose } from '../../../hooks/useEscapeClose';
import { useApiFetch } from '../../../hooks/useApiFetch';

// ── Modal Aplicada en Campo ───────────────────────────────────────────────────
// Confirma la transición en_transito → aplicada_en_campo de una cédula. El
// usuario completa condiciones del tiempo (con seed de open-meteo si hay
// permiso de geolocation), horas, operario/encargados/regente vía UserCombo
// y observaciones — todo se persiste en el documento auditable de la cédula.
//
// Extraído de CedulasAplicacion.jsx (Fase 2 del refactor del punto #7 del
// audit UX/UI). El modal ya era autónomo (recibe lotes, users, currentUser,
// prefill, onClose, onConfirm) → mudanza limpia sin tocar lógica.
export default function AplicadaModal({ lotes, users, currentUser, prefill, onClose, onConfirm }) {
  const apiFetch = useApiFetch();
  const [sobrante,          setSobrante]          = useState(false);
  const [sobranteLoteId,    setSobranteLoteId]    = useState('');
  const [condicionesTiempo, setCondicionesTiempo] = useState('');
  const [temperatura,       setTemperatura]       = useState('');
  const [humedadRelativa,   setHumedadRelativa]   = useState('');
  const [horaInicio,        setHoraInicio]        = useState('');
  const [horaFinal,         setHoraFinal]         = useState(() => nowTimeStr());
  // Pares nombre + userId: el nombre es lo que se guarda hoy en el documento
  // auditable; el userId queda registrado al elegir del directorio y se envía
  // al backend para futura reconciliación (hoy lo ignora, no rompe nada).
  // El operario default sale del usuario actual cuando confirma él mismo —
  // currentUser.userId resuelve al doc de la colección `users` (no el uid
  // de Firebase Auth, que es distinto). Si null, queda como texto libre.
  const [operario,          setOperario]          = useState(() => currentUser?.nombre || '');
  const [operarioUserId,    setOperarioUserId]    = useState(() => currentUser?.userId || null);
  const [metodoAplicacion,  setMetodoAplicacion]  = useState(() => prefill?.metodoAplicacion || '');
  const [encargadoFinca,    setEncargadoFinca]    = useState(() => prefill?.encargadoFinca || '');
  const [encargadoFincaUserId,    setEncargadoFincaUserId]    = useState(() => prefill?.encargadoFincaUserId || null);
  const [encargadoBodega,   setEncargadoBodega]   = useState(() => prefill?.encargadoBodega || '');
  const [encargadoBodegaUserId,   setEncargadoBodegaUserId]   = useState(() => prefill?.encargadoBodegaUserId || null);
  const [supAplicaciones,   setSupAplicaciones]   = useState(() => prefill?.supAplicaciones || '');
  const [supAplicacionesUserId,   setSupAplicacionesUserId]   = useState(() => prefill?.supAplicacionesUserId || null);
  const [observacionesAplicacion, setObservacionesAplicacion] = useState('');
  const [fetchingWeather,   setFetchingWeather]   = useState(false);
  // Mensaje informativo cuando el seed automático de temp/humedad falla. Es
  // un hint, NO un error de validación — el usuario puede igual confirmar
  // llenando manualmente. Diferenciado por causa para que la acción sugerida
  // sea accionable (activar permiso vs. reintentar vs. nada que hacer).
  const [weatherHint,       setWeatherHint]       = useState('');

  // formError = error cross-field (sobrante sin lote, hora-rango invertida).
  // Single-field errors viven inline al lado del input para que el usuario
  // sepa CUÁL está mal sin tener que leer arriba. Punto #16 audit.
  const [formError, setFormError] = useState('');
  const [tempError, setTempError] = useState('');
  const [humError,  setHumError]  = useState('');

  // Double-submit guard: el padre cierra el modal al recibir onConfirm
  // (setAplicadaModal(null)), pero un doble-tap rápido en mobile dispara
  // dos clicks antes del unmount → dos POSTs en vuelo. El segundo cae con
  // 409 (cédula ya no en_transito) pero genera ruido + un toast confuso.
  // Mismo patrón que MezclaListaModal: ref sincronizable para la guarda
  // (setState es async), state para el disabled del botón.
  const submittingRef = useRef(false);
  const [submitting, setSubmitting] = useState(false);

  // ESC bloqueado durante submit (mismo gate que el backdrop) para evitar
  // que el usuario cierre el modal mientras la mutación está en vuelo.
  useEscapeClose(submitting ? null : onClose); // Punto #28 audit.

  useEffect(() => {
    if (!navigator.geolocation) {
      // Contexto inseguro (HTTP no-localhost) o browser viejo. No hay acción
      // que el usuario pueda tomar desde el modal — solo avisarle.
      setWeatherHint('Tu navegador no permite obtener la ubicación. Llená temperatura y humedad manualmente.');
      return;
    }
    let cancelled = false;
    setFetchingWeather(true);
    navigator.geolocation.getCurrentPosition(
      async ({ coords: { latitude, longitude } }) => {
        try {
          const r = await apiFetch(`/api/weather/current?lat=${latitude}&lon=${longitude}`);
          if (!r.ok) throw new Error('weather fetch failed');
          const d = await r.json();
          if (cancelled) return;
          // Seed solo si el campo sigue vacío. La API puede tardar varios segundos
          // y el usuario suele tipear el valor del termohigrómetro del aplicador
          // mientras esperamos — sobreescribirlo silenciosamente altera un dato
          // de auditoría regulatoria. Setter funcional para no race con un
          // teclazo simultáneo entre el read del state y el set.
          if (d.temperature != null) {
            setTemperatura(prev => prev || String(d.temperature));
          }
          if (d.humidity != null) {
            setHumedadRelativa(prev => prev || String(d.humidity));
          }
        } catch {
          // Open-Meteo caído, upstream 502, o sin conexión. El usuario llena
          // manualmente — solo le decimos que el autocompletado no funcionó
          // por si estaba esperando los valores.
          if (!cancelled) setWeatherHint('No se pudo consultar el clima ahora. Llená temperatura y humedad manualmente.');
        }
        if (!cancelled) setFetchingWeather(false);
      },
      (err) => {
        if (cancelled) return;
        setFetchingWeather(false);
        // PositionError.code: 1=PERMISSION_DENIED, 2=POSITION_UNAVAILABLE, 3=TIMEOUT.
        // Diferenciamos solo el caso accionable (permiso bloqueado) para que el
        // usuario sepa que activando la ubicación recupera el seed automático.
        // El resto cae al mensaje genérico — los caracteres del modal son
        // limitados y "GPS sin señal" vs "tardó 8s" tienen la misma acción.
        if (err?.code === 1) {
          setWeatherHint('Activá los permisos de ubicación del navegador para autocompletar temperatura y humedad.');
        } else {
          setWeatherHint('No se pudo obtener tu ubicación. Llená temperatura y humedad manualmente.');
        }
      },
      { timeout: 8000 }
    );
    return () => { cancelled = true; };
  }, []);

  // Validadores single-field reutilizables: handleConfirm + onBlur usan los
  // mismos para que el mensaje sea idéntico esté donde esté. String vacío
  // = sin error, así un truthy check sirve igual que un .has().
  const validateTemp = (v) => {
    if (v === '' || v == null) return '';
    const n = Number(v);
    return Number.isFinite(n) && n >= -60 && n <= 70
      ? '' : 'Temperatura fuera de rango (-60 a 70 °C).';
  };
  const validateHum = (v) => {
    if (v === '' || v == null) return '';
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 && n <= 100
      ? '' : 'Humedad relativa fuera de rango (0 a 100 %).';
  };

  // Scroll + focus al primer field con error: el usuario puede estar en el
  // bottom del modal cuando clickea Confirmar, sin ver dónde está el problema.
  const focusFieldById = (id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.focus({ preventScroll: true });
  };

  const handleConfirm = async () => {
    if (submittingRef.current) return;
    setFormError('');
    // Cross-field primero: el banner global sigue siendo el lugar correcto
    // para errores que involucran más de un campo.
    if (sobrante && !sobranteLoteId) {
      setFormError('Seleccione el lote donde fue depositado el sobrante.');
      return;
    }
    if (horaInicio && horaFinal && horaInicio >= horaFinal) {
      setFormError('La hora de inicio debe ser menor que la hora final.');
      return;
    }
    // Single-field: validamos de nuevo en confirm como red de seguridad (el
    // usuario puede haber tipeado y clickeado sin blur), y mostramos el
    // error inline al lado del campo + scroll-focus al primero invalido.
    const tErr = validateTemp(temperatura);
    const hErr = validateHum(humedadRelativa);
    setTempError(tErr);
    setHumError(hErr);
    if (tErr) { focusFieldById('apl-temp'); return; }
    if (hErr) { focusFieldById('apl-hum');  return; }
    // observacionesAplicacion ya está capped a 500 en onChange (slice), así
    // que el chequeo de overflow legacy era dead code — eliminado.
    const tempNum = temperatura      !== '' && temperatura      != null ? Number(temperatura)      : null;
    const humNum  = humedadRelativa  !== '' && humedadRelativa  != null ? Number(humedadRelativa)  : null;
    // El nombre tipeado es la fuente de verdad para el documento auditable. El
    // *UserId companion viaja en paralelo para que el backend lo persista
    // cuando agreguemos el campo a la schema — hoy lo ignora (lee solo lo que
    // extrae con sanitizeStr), así que es un no-op en este release.
    const trimmedOperario   = (operario        || '').trim().slice(0, 200);
    const trimmedFinca      = (encargadoFinca  || '').trim().slice(0, 200);
    const trimmedBodega     = (encargadoBodega || '').trim().slice(0, 200);
    const trimmedSup        = (supAplicaciones || '').trim().slice(0, 200);
    submittingRef.current = true;
    setSubmitting(true);
    // No envolvemos en try/catch: el padre (submitAplicada) no lanza, maneja
    // errores con showError y cierra el modal síncronamente con
    // setAplicadaModal(null). El finally con reset del ref sigue siendo útil
    // si en el futuro el padre llega a propagar, para no dejar la guarda
    // colgada y bloquear retries.
    try {
      await onConfirm({
        sobrante,
        sobranteLoteId:     sobrante ? sobranteLoteId   : null,
        sobranteLoteNombre: sobrante ? (lotes.find(l => l.id === sobranteLoteId)?.nombreLote || null) : null,
        condicionesTiempo:  condicionesTiempo || null,
        temperatura:        tempNum,
        humedadRelativa:    humNum,
        horaInicio:         horaInicio  || null,
        horaFinal:          horaFinal   || null,
        operario:                trimmedOperario || null,
        operarioUserId:          trimmedOperario ? (operarioUserId || null) : null,
        metodoAplicacion:        (metodoAplicacion || '').trim().slice(0, 200) || null,
        encargadoFinca:          trimmedFinca || null,
        encargadoFincaUserId:    trimmedFinca ? (encargadoFincaUserId || null) : null,
        encargadoBodega:         trimmedBodega || null,
        encargadoBodegaUserId:   trimmedBodega ? (encargadoBodegaUserId || null) : null,
        supAplicaciones:         trimmedSup || null,
        supAplicacionesUserId:   trimmedSup ? (supAplicacionesUserId || null) : null,
        observacionesAplicacion: (observacionesAplicacion || '').trim().slice(0, 500) || null,
      });
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  return createPortal(
    <div className="aur-modal-backdrop" onPointerDown={submitting ? undefined : onClose}>
      <div className="aur-modal aur-modal--lg" onPointerDown={e => e.stopPropagation()}>
        <div className="aur-modal-header">
          <span className="aur-modal-icon">
            <FaTractor size={14} />
          </span>
          <span className="aur-modal-title">Confirmar aplicación en campo</span>
        </div>

        <div className="aur-modal-content">
          {formError && (
            <div className="aur-banner aur-banner--danger">
              <FiAlertTriangle size={14} />
              <span>{formError}</span>
            </div>
          )}

          <div className="aur-list">
            <div className="aur-row">
              <span className="aur-row-label">¿Hubo sobrante de mezcla?</span>
              <label className="aur-toggle">
                <input
                  type="checkbox"
                  checked={sobrante}
                  onChange={e => setSobrante(e.target.checked)}
                />
                <span className="aur-toggle-track">
                  <span className="aur-toggle-thumb" />
                </span>
                <span className="aur-toggle-label">{sobrante ? 'Sí' : 'No'}</span>
              </label>
            </div>

            {sobrante && (
              <AuroraField layout="row" htmlFor="apl-sobrante-lote" label="Lote del sobrante">
                <Select
                  value={sobranteLoteId}
                  onChange={e => setSobranteLoteId(e.target.value)}
                >
                  <option value="">— Seleccionar lote —</option>
                  {lotes.map(l => <option key={l.id} value={l.id}>{l.nombreLote}</option>)}
                </Select>
              </AuroraField>
            )}

            <AuroraField layout="row" htmlFor="apl-tiempo" label="Condiciones del tiempo">
              <Select
                value={condicionesTiempo}
                onChange={e => setCondicionesTiempo(e.target.value)}
              >
                <option value="">— Seleccionar —</option>
                {CONDICIONES_TIEMPO.map(c => <option key={c} value={c}>{c}</option>)}
              </Select>
            </AuroraField>

            {weatherHint && !fetchingWeather && (
              <div className="aur-banner aur-banner--info" role="status" aria-live="polite">
                <FiInfo size={14} />
                <span>{weatherHint}</span>
              </div>
            )}

            <AuroraField
              layout="row"
              htmlFor="apl-temp"
              label={<>Temperatura (°C){fetchingWeather ? ' · obteniendo…' : ''}</>}
              error={tempError}
            >
              <NumberInput
                step="0.1"
                min="-60"
                max="70"
                value={temperatura}
                onChange={e => {
                  setTemperatura(e.target.value);
                  if (tempError) setTempError('');
                }}
                onBlur={() => setTempError(validateTemp(temperatura))}
                placeholder="—"
              />
            </AuroraField>

            <AuroraField
              layout="row"
              htmlFor="apl-hum"
              label={<>Humedad relativa (%){fetchingWeather ? ' · obteniendo…' : ''}</>}
              error={humError}
            >
              <NumberInput
                step="1"
                min="0"
                max="100"
                value={humedadRelativa}
                onChange={e => {
                  setHumedadRelativa(e.target.value);
                  if (humError) setHumError('');
                }}
                onBlur={() => setHumError(validateHum(humedadRelativa))}
                placeholder="—"
              />
            </AuroraField>

            <div className="aur-row">
              <label className="aur-row-label" htmlFor="apl-h-inicio">Hora inicio</label>
              <AuroraTimePicker
                id="apl-h-inicio"
                value={horaInicio}
                onChange={setHoraInicio}
              />
            </div>

            <div className="aur-row">
              <label className="aur-row-label" htmlFor="apl-h-fin">Hora final</label>
              <div>
                <AuroraTimePicker
                  id="apl-h-fin"
                  value={horaFinal}
                  onChange={setHoraFinal}
                  min={horaInicio || undefined}
                  hasError={!!horaInicio && !!horaFinal && horaFinal <= horaInicio}
                />
                {!!horaInicio && !!horaFinal && horaFinal <= horaInicio && (
                  <span className="aur-field-error">La hora final debe ser mayor que la inicial</span>
                )}
              </div>
            </div>

            <div className="aur-row">
              <label className="aur-row-label" htmlFor="apl-operario">Operario</label>
              <UserCombo
                id="apl-operario"
                value={operario}
                userId={operarioUserId}
                users={users}
                onChange={(name, uid) => { setOperario(name); setOperarioUserId(uid); }}
                placeholder="Nombre del operario"
              />
            </div>

            <AuroraField layout="row" htmlFor="apl-metodo" label="Método de aplicación">
              <TextInput
                maxLength={200}
                value={metodoAplicacion}
                onChange={e => setMetodoAplicacion(e.target.value)}
                placeholder="Ej. Spray Boom, Drench…"
              />
            </AuroraField>

            <div className="aur-row">
              <label className="aur-row-label" htmlFor="apl-finca">Encargado de finca</label>
              <UserCombo
                id="apl-finca"
                value={encargadoFinca}
                userId={encargadoFincaUserId}
                users={users}
                onChange={(name, uid) => { setEncargadoFinca(name); setEncargadoFincaUserId(uid); }}
                placeholder="Nombre del encargado de finca"
              />
            </div>

            <div className="aur-row">
              <label className="aur-row-label" htmlFor="apl-bodega">Encargado de bodega</label>
              <UserCombo
                id="apl-bodega"
                value={encargadoBodega}
                userId={encargadoBodegaUserId}
                users={users}
                onChange={(name, uid) => { setEncargadoBodega(name); setEncargadoBodegaUserId(uid); }}
                placeholder="Nombre del encargado de bodega"
              />
            </div>

            <div className="aur-row">
              <label className="aur-row-label" htmlFor="apl-sup">Sup. aplicaciones / Regente</label>
              <UserCombo
                id="apl-sup"
                value={supAplicaciones}
                userId={supAplicacionesUserId}
                users={users}
                onChange={(name, uid) => { setSupAplicaciones(name); setSupAplicacionesUserId(uid); }}
                placeholder="Nombre del supervisor o regente"
              />
            </div>

            <div className="aur-row aur-row--multiline">
              <label className="aur-row-label" htmlFor="apl-obs">
                Observaciones (opcional)
                {/* Cuenta sube en tiempo real; cuando llega al cap se pinta
                    como error para señalizar al usuario que el slice() en
                    onChange ya está cortando texto adicional. Sin esto el
                    paste de un párrafo largo se truncaba silenciosamente. */}
                <span className={`aur-field-hint${observacionesAplicacion.length >= 500 ? ' is-at-limit' : ''}`}>
                  {' · '}{observacionesAplicacion.length}/500
                </span>
              </label>
              <textarea
                id="apl-obs"
                className="aur-textarea"
                value={observacionesAplicacion}
                onChange={e => setObservacionesAplicacion(e.target.value.slice(0, 500))}
                rows={3}
                placeholder="Ej. viento inesperado en el último bloque, se pausó 15 min. Novedades, incidentes, o cualquier detalle relevante para el auditor."
              />
            </div>
          </div>
        </div>

        <div className="aur-modal-actions">
          <button type="button" className="aur-btn-text" onClick={onClose} disabled={submitting}>Cancelar</button>
          <button type="button" className="aur-btn-pill" onClick={handleConfirm} disabled={submitting}>
            <FiCheckCircle size={14} /> {submitting ? 'Registrando…' : 'Confirmar'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
