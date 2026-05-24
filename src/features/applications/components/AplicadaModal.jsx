import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { FaTractor } from 'react-icons/fa';
import { FiAlertTriangle, FiCheckCircle } from 'react-icons/fi';
import AuroraTimePicker from '../../../components/AuroraTimePicker';
import UserCombo from './UserCombo';
import { nowTimeStr, CONDICIONES_TIEMPO } from '../lib/cedulas-helpers';

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

  const [formError, setFormError] = useState('');

  useEffect(() => {
    if (!navigator.geolocation) return;
    let cancelled = false;
    setFetchingWeather(true);
    navigator.geolocation.getCurrentPosition(
      async ({ coords: { latitude, longitude } }) => {
        try {
          const r = await fetch(
            `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,relative_humidity_2m&timezone=auto`
          );
          const d = await r.json();
          if (cancelled) return;
          // Seed solo si el campo sigue vacío. open-meteo puede tardar 5-8s y
          // el usuario suele tipear el valor del termohigrómetro del aplicador
          // mientras esperamos — sobreescribirlo silenciosamente altera un dato
          // de auditoría regulatoria. Setter funcional para no race con un
          // teclazo simultáneo entre el read del state y el set.
          if (d.current?.temperature_2m != null) {
            setTemperatura(prev => prev || String(d.current.temperature_2m));
          }
          if (d.current?.relative_humidity_2m != null) {
            setHumedadRelativa(prev => prev || String(d.current.relative_humidity_2m));
          }
        } catch { /* sin internet o API no disponible — el usuario llena manualmente */ }
        if (!cancelled) setFetchingWeather(false);
      },
      () => { if (!cancelled) setFetchingWeather(false); },
      { timeout: 8000 }
    );
    return () => { cancelled = true; };
  }, []);

  const handleConfirm = () => {
    setFormError('');
    if (sobrante && !sobranteLoteId) {
      setFormError('Seleccione el lote donde fue depositado el sobrante.');
      return;
    }
    if (horaInicio && horaFinal && horaInicio >= horaFinal) {
      setFormError('La hora de inicio debe ser menor que la hora final.');
      return;
    }
    let tempNum = null;
    if (temperatura !== '' && temperatura != null) {
      tempNum = Number(temperatura);
      if (!Number.isFinite(tempNum) || tempNum < -60 || tempNum > 70) {
        setFormError('Temperatura fuera de rango (-60 a 70 °C).');
        return;
      }
    }
    let humNum = null;
    if (humedadRelativa !== '' && humedadRelativa != null) {
      humNum = Number(humedadRelativa);
      if (!Number.isFinite(humNum) || humNum < 0 || humNum > 100) {
        setFormError('Humedad relativa fuera de rango (0 a 100 %).');
        return;
      }
    }
    if (observacionesAplicacion.length > 500) {
      setFormError('Las observaciones no pueden exceder 500 caracteres.');
      return;
    }
    // El nombre tipeado es la fuente de verdad para el documento auditable. El
    // *UserId companion viaja en paralelo para que el backend lo persista
    // cuando agreguemos el campo a la schema — hoy lo ignora (lee solo lo que
    // extrae con sanitizeStr), así que es un no-op en este release.
    const trimmedOperario   = (operario        || '').trim().slice(0, 200);
    const trimmedFinca      = (encargadoFinca  || '').trim().slice(0, 200);
    const trimmedBodega     = (encargadoBodega || '').trim().slice(0, 200);
    const trimmedSup        = (supAplicaciones || '').trim().slice(0, 200);
    onConfirm({
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
  };

  return createPortal(
    <div className="aur-modal-backdrop" onPointerDown={onClose}>
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
              <div className="aur-row">
                <label className="aur-row-label" htmlFor="apl-sobrante-lote">Lote del sobrante</label>
                <select
                  id="apl-sobrante-lote"
                  className="aur-select"
                  value={sobranteLoteId}
                  onChange={e => setSobranteLoteId(e.target.value)}
                >
                  <option value="">— Seleccionar lote —</option>
                  {lotes.map(l => <option key={l.id} value={l.id}>{l.nombreLote}</option>)}
                </select>
              </div>
            )}

            <div className="aur-row">
              <label className="aur-row-label" htmlFor="apl-tiempo">Condiciones del tiempo</label>
              <select
                id="apl-tiempo"
                className="aur-select"
                value={condicionesTiempo}
                onChange={e => setCondicionesTiempo(e.target.value)}
              >
                <option value="">— Seleccionar —</option>
                {CONDICIONES_TIEMPO.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>

            <div className="aur-row">
              <label className="aur-row-label" htmlFor="apl-temp">
                Temperatura (°C){fetchingWeather ? ' · obteniendo…' : ''}
              </label>
              <input
                id="apl-temp"
                type="number"
                step="0.1"
                min="-60"
                max="70"
                className="aur-input aur-input--num"
                value={temperatura}
                onChange={e => setTemperatura(e.target.value)}
                placeholder="—"
              />
            </div>

            <div className="aur-row">
              <label className="aur-row-label" htmlFor="apl-hum">
                Humedad relativa (%){fetchingWeather ? ' · obteniendo…' : ''}
              </label>
              <input
                id="apl-hum"
                type="number"
                step="1"
                min="0"
                max="100"
                className="aur-input aur-input--num"
                value={humedadRelativa}
                onChange={e => setHumedadRelativa(e.target.value)}
                placeholder="—"
              />
            </div>

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

            <div className="aur-row">
              <label className="aur-row-label" htmlFor="apl-metodo">Método de aplicación</label>
              <input
                id="apl-metodo"
                type="text"
                maxLength={200}
                className="aur-input"
                value={metodoAplicacion}
                onChange={e => setMetodoAplicacion(e.target.value)}
                placeholder="Ej. Spray Boom, Drench…"
              />
            </div>

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
                <span className="aur-field-hint"> · {observacionesAplicacion.length}/500</span>
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
          <button type="button" className="aur-btn-text" onClick={onClose}>Cancelar</button>
          <button type="button" className="aur-btn-pill" onClick={handleConfirm}>
            <FiCheckCircle size={14} /> Confirmar
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
