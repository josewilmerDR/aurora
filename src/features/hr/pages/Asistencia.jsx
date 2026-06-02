import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { FiCheck, FiX, FiCalendar, FiSave, FiUsers } from 'react-icons/fi';
import Toast from '../../../components/Toast';
import EmptyState from '../../../components/ui/EmptyState';
import AuroraConfirmModal from '../../../components/AuroraConfirmModal';
import { useApiFetch } from '../../../hooks/useApiFetch';
import { markDraftActive, clearDraftActive } from '../../../hooks/useDraft';
import { todayLocal, dateNDaysAgo } from '../lib/dateHelpers';
import '../styles/hr.css';
import '../styles/asistencia.css';

// Estados deben coincidir con la enum del backend (functions/routes/hr/fichas.js).
const ESTADOS = [
  { value: 'presente',    label: 'Presente'    },
  { value: 'ausente',     label: 'Ausente'     },
  { value: 'vacaciones',  label: 'Vacaciones'  },
  { value: 'incapacidad', label: 'Incapacidad' },
  { value: 'permiso',     label: 'Permiso'     },
];

const NOTAS_MAX = 500;
// Tope inferior del date picker. Permite corregir registros recientes (períodos
// de nómina pasados) sin habilitar navegación a fechas arbitrariamente viejas.
const MIN_DIAS_ATRAS = 365;
// Clave del badge de borrador para el guard de navegación del Sidebar (item
// '/hr/asistencia' lleva el mismo draftKey).
const DRAFT_FORM_KEY = 'asistencia';

// Firma normalizada de los tres mapas — solo entradas con contenido — para
// comparar contra el snapshot hidratado y detectar cambios sin guardar.
const signature = (estados, horas, notas) => {
  const out = {};
  Object.keys(estados).forEach(id => {
    if (estados[id]) out[id] = `${estados[id]}|${horas[id] || 0}|${notas[id] || ''}`;
  });
  return JSON.stringify(out);
};

export default function Asistencia() {
  const apiFetch = useApiFetch();

  const [fecha, setFecha] = useState(todayLocal());
  const [users, setUsers] = useState([]);
  const [usersError, setUsersError] = useState(false);
  // Tres mapas userId -> valor, separados para que tipear notas no recompute
  // counts ni pise las horas extra cargadas (ver #15/#22 del audit).
  const [estados, setEstados] = useState({}); // userId -> estado
  const [horas, setHoras]     = useState({}); // userId -> number
  const [notas, setNotas]     = useState({}); // userId -> string
  const [initialLoading, setInitialLoading] = useState(true);
  const [refetching, setRefetching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [pendingDate, setPendingDate] = useState(null); // confirmación de cambio de fecha
  const [confirmSave, setConfirmSave] = useState(null);  // { nuevos, actualizados, sinMarcar }

  // Snapshot de lo hidratado desde el backend para esta fecha: sirve para
  // detectar "sucio", contar lo ya registrado y distinguir nuevos vs updates.
  const baselineRef = useRef('');
  const baselineEstadosRef = useRef({});
  // Última fecha solicitada — descarta respuestas de fetch que llegan tarde.
  const reqFechaRef = useRef(fecha);

  const showToast = (message, type = 'success') => setToast({ message, type });

  // ── Carga de trabajadores ────────────────────────────────────────────────
  useEffect(() => {
    apiFetch('/api/users/lite')
      .then(r => {
        if (!r.ok) throw new Error();
        return r.json();
      })
      .then(data => {
        const sorted = (Array.isArray(data) ? data : [])
          .slice()
          .sort((a, b) => (a.nombre || '').localeCompare(b.nombre || '', 'es'));
        setUsers(sorted);
        setUsersError(false);
      })
      .catch(() => {
        setUsers([]);
        setUsersError(true);
        showToast('Error al cargar trabajadores.', 'error');
      });
  }, [apiFetch]);

  // ── Hidratación de asistencia por fecha ───────────────────────────────────
  // La query mensual del backend (mes/anio) trae más de lo necesario, así que
  // filtro el día exacto del lado del cliente. Descarto respuestas obsoletas
  // si el usuario cambió de fecha mientras un request lento estaba en vuelo.
  useEffect(() => {
    reqFechaRef.current = fecha;
    const reqFecha = fecha;
    setRefetching(true);
    const [y, m] = fecha.split('-').map(Number);
    apiFetch(`/api/hr/asistencia?mes=${m}&anio=${y}`)
      .then(r => r.json())
      .then(data => {
        if (reqFechaRef.current !== reqFecha) return; // respuesta tardía: descartar
        const e = {}, h = {}, n = {};
        (Array.isArray(data) ? data : []).forEach(rec => {
          const recDate = (rec.fecha || '').slice(0, 10);
          if (recDate === reqFecha && rec.trabajadorId) {
            e[rec.trabajadorId] = rec.estado || '';
            h[rec.trabajadorId] = Number(rec.horasExtra) || 0;
            n[rec.trabajadorId] = rec.notas || '';
          }
        });
        setEstados(e); setHoras(h); setNotas(n);
        baselineRef.current = signature(e, h, n);
        baselineEstadosRef.current = e;
      })
      .catch(() => {
        if (reqFechaRef.current !== reqFecha) return;
        setEstados({}); setHoras({}); setNotas({});
        baselineRef.current = signature({}, {}, {});
        baselineEstadosRef.current = {};
        showToast('Error al cargar la asistencia de la fecha.', 'error');
      })
      .finally(() => {
        if (reqFechaRef.current !== reqFecha) return;
        setInitialLoading(false);
        setRefetching(false);
      });
  }, [fecha, apiFetch]);

  const setEstado = (userId, estado) => {
    // Preserva horas/notas cargadas aunque el estado deje de ser "presente":
    // si el usuario vuelve a presente no pierde lo tipeado (#15).
    setEstados(prev => ({ ...prev, [userId]: estado }));
  };

  const setHora = (userId, val) => {
    // Clamp 0–24 y redondeo al step de media hora que ofrece el input (#13).
    const n = Math.max(0, Math.min(24, Math.round((Number(val) || 0) * 2) / 2));
    setHoras(prev => ({ ...prev, [userId]: n }));
  };

  const setNota = (userId, val) => {
    setNotas(prev => ({ ...prev, [userId]: String(val).slice(0, NOTAS_MAX) }));
  };

  const markAllPresent = () => {
    // Solo completa los que NO tienen estado: respeta ausentes/vacaciones ya
    // marcados (antes los pisaba a presente — ver #2 del audit).
    setEstados(prev => {
      const next = { ...prev };
      users.forEach(u => { if (!next[u.id]) next[u.id] = 'presente'; });
      return next;
    });
  };

  const clearAll = () => { setEstados({}); setHoras({}); setNotas({}); };

  const counts = useMemo(() => {
    const c = { presente: 0, ausente: 0, vacaciones: 0, incapacidad: 0, permiso: 0, total: 0 };
    Object.values(estados).forEach(estado => {
      if (!estado) return;
      if (c[estado] !== undefined) c[estado]++;
      c.total++;
    });
    return c;
  }, [estados]);

  // Cantidad ya registrada en el backend para esta fecha (del snapshot).
  const registeredCount = useMemo(
    () => Object.values(baselineEstadosRef.current).filter(Boolean).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fecha, initialLoading, refetching],
  );

  const currentSig = signature(estados, horas, notas);
  const isDirty = currentSig !== baselineRef.current;

  // Badge de borrador para el guard de navegación del Sidebar (#21).
  useEffect(() => {
    if (isDirty) markDraftActive(DRAFT_FORM_KEY);
    else clearDraftActive(DRAFT_FORM_KEY);
  }, [isDirty]);

  // Limpia el badge al desmontar.
  useEffect(() => () => clearDraftActive(DRAFT_FORM_KEY), []);

  // ── Cambio de fecha con guarda de cambios sin guardar (#1) ────────────────
  const requestDateChange = (nuevaFecha) => {
    if (isDirty) setPendingDate(nuevaFecha);
    else setFecha(nuevaFecha);
  };
  const confirmDateChange = () => { setFecha(pendingDate); setPendingDate(null); };

  // Navegación por flechas dentro del segmented control (#6).
  const handleEstadoKey = (e, userId, idx) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const dir = e.key === 'ArrowRight' ? 1 : -1;
    const nextIdx = (idx + dir + ESTADOS.length) % ESTADOS.length;
    setEstado(userId, ESTADOS[nextIdx].value);
    const grupo = e.currentTarget.parentElement;
    grupo?.querySelectorAll('.asist-estado-btn')[nextIdx]?.focus();
  };

  const buildRegistros = useCallback(() => (
    Object.entries(estados)
      .filter(([, estado]) => estado)
      .map(([trabajadorId, estado]) => ({
        trabajadorId,
        estado,
        // Solo "presente" lleva horas extra; otros estados las descartan al enviar.
        horasExtra: estado === 'presente' ? (horas[trabajadorId] || 0) : 0,
        notas: notas[trabajadorId] || '',
      }))
  ), [estados, horas, notas]);

  // ── Guardado con confirmación de impacto (#3) ─────────────────────────────
  const requestSave = () => {
    const registros = buildRegistros();
    if (registros.length === 0) {
      showToast('Marcá al menos un trabajador antes de guardar.', 'error');
      return;
    }
    const base = baselineEstadosRef.current;
    const actualizados = registros.filter(r => base[r.trabajadorId]).length;
    setConfirmSave({
      registros,
      nuevos: registros.length - actualizados,
      actualizados,
      sinMarcar: users.length - registros.length,
    });
  };

  const doSave = async () => {
    const registros = confirmSave?.registros || [];
    setSaving(true);
    try {
      const res = await apiFetch('/api/hr/asistencia/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fecha, registros }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.message || 'Error al guardar.');
      }
      const data = await res.json();
      // El form guardado pasa a ser el nuevo baseline (#1: ya no está sucio).
      baselineRef.current = currentSig;
      baselineEstadosRef.current = { ...estados };
      const sinMarcar = users.length - data.saved;
      showToast(
        `Asistencia guardada — ${data.saved} de ${users.length} registrados` +
        (sinMarcar > 0 ? ` · ${sinMarcar} sin marcar.` : '.'),
      );
    } catch (err) {
      showToast(err.message || 'Error al guardar.', 'error');
    } finally {
      setSaving(false);
      setConfirmSave(null);
    }
  };

  return (
    <div className="asist-page">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      <header className="asist-header">
        <h1>Asistencia diaria</h1>
        <p className="asist-subtitle">
          Registrá la cuadrilla del día completo en una sola pantalla.
        </p>
      </header>

      <section className="asist-controls">
        <label className="asist-fecha-label">
          <FiCalendar size={14} aria-hidden="true" />
          <span>Fecha</span>
          <input
            type="date"
            value={fecha}
            onChange={e => requestDateChange(e.target.value)}
            min={dateNDaysAgo(MIN_DIAS_ATRAS)}
            max={todayLocal()}
          />
        </label>
        {registeredCount > 0 && (
          <span className="asist-registered-badge" title="Registros ya guardados para esta fecha">
            <FiCheck size={12} aria-hidden="true" /> {registeredCount} ya registrado{registeredCount === 1 ? '' : 's'}
          </span>
        )}
        <div className="asist-bulk-actions">
          <button type="button" onClick={markAllPresent} className="asist-bulk-btn">
            <FiCheck size={13} aria-hidden="true" /> Marcar faltantes presentes
          </button>
          <button type="button" onClick={clearAll} className="asist-bulk-btn">
            <FiX size={13} aria-hidden="true" /> Limpiar
          </button>
        </div>
      </section>

      <section className="hr-stats asist-stats">
        <div className="hr-stat-card">
          <div className="hr-stat-value">{users.length}</div>
          <div className="hr-stat-label"><FiUsers size={11} aria-hidden="true" /> Trabajadores</div>
        </div>
        <div className="hr-stat-card">
          <div className="hr-stat-value">{counts.presente}</div>
          <div className="hr-stat-label">Presentes</div>
        </div>
        <div className="hr-stat-card">
          <div className="hr-stat-value">{counts.ausente}</div>
          <div className="hr-stat-label">Ausentes</div>
        </div>
        <div className="hr-stat-card">
          <div className="hr-stat-value">{counts.vacaciones + counts.incapacidad + counts.permiso}</div>
          <div className="hr-stat-label">Permisos / Vac. / Inc.</div>
        </div>
      </section>

      {initialLoading ? (
        <div className="aur-page-loading" aria-live="polite" aria-busy="true" />
      ) : usersError ? (
        <EmptyState
          icon={FiUsers}
          title="No pudimos cargar los trabajadores"
          subtitle="Revisá tu conexión y volvé a intentar."
        />
      ) : users.length === 0 ? (
        <EmptyState
          icon={FiUsers}
          title="No hay trabajadores registrados"
          subtitle="Crea la primera ficha desde Recursos Humanos → Ficha del Trabajador."
        />
      ) : (
        <div className={`asist-grid${refetching ? ' is-refetching' : ''}`}>
          {users.map(u => {
            const estado = estados[u.id] || '';
            return (
              <div key={u.id} className={`asist-row asist-row--${estado || 'empty'}`}>
                <div className="asist-name" title={u.nombre || u.id}>{u.nombre || u.id}</div>
                <div className="asist-estados" role="radiogroup" aria-label={`Estado de ${u.nombre || u.id}`}>
                  {ESTADOS.map((e, idx) => {
                    const active = estado === e.value;
                    return (
                      <button
                        key={e.value}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        tabIndex={active || (!estado && idx === 0) ? 0 : -1}
                        onClick={() => setEstado(u.id, e.value)}
                        onKeyDown={ev => handleEstadoKey(ev, u.id, idx)}
                        className={`asist-estado-btn asist-estado-btn--${e.value}${active ? ' is-active' : ''}`}
                      >
                        {active && <FiCheck size={12} aria-hidden="true" className="asist-estado-check" />}
                        {e.label}
                      </button>
                    );
                  })}
                </div>
                {estado === 'presente' && (
                  <label className="asist-horas">
                    <span>Horas extra</span>
                    <input
                      type="number"
                      min={0}
                      max={24}
                      step={0.5}
                      value={horas[u.id] || 0}
                      onChange={e => setHora(u.id, e.target.value)}
                      className="aur-input--num"
                    />
                  </label>
                )}
                <input
                  type="text"
                  placeholder="Notas (opcional)"
                  value={notas[u.id] || ''}
                  onChange={e => setNota(u.id, e.target.value)}
                  maxLength={NOTAS_MAX}
                  className="asist-notas-input"
                  aria-label={`Notas de ${u.nombre || u.id}`}
                />
              </div>
            );
          })}
        </div>
      )}

      <div className="asist-save-bar">
        <div className="asist-save-bar-inner">
          {isDirty && <span className="asist-dirty-hint">Cambios sin guardar</span>}
          <button
            type="button"
            onClick={requestSave}
            disabled={saving || counts.total === 0}
            title={counts.total === 0 ? 'Marcá al menos un trabajador para guardar' : undefined}
            className="aur-btn-pill"
          >
            <FiSave size={14} aria-hidden="true" /> {saving ? 'Guardando…' : `Guardar (${counts.total})`}
          </button>
        </div>
      </div>

      {pendingDate && (
        <AuroraConfirmModal
          title="Cambiar de fecha"
          body="Hay cambios sin guardar en esta fecha. Si cambiás de día se descartan. ¿Continuar?"
          confirmLabel="Descartar y cambiar"
          cancelLabel="Seguir editando"
          danger
          onConfirm={confirmDateChange}
          onCancel={() => setPendingDate(null)}
        />
      )}

      {confirmSave && (
        <AuroraConfirmModal
          title="Guardar asistencia"
          body={`Fecha ${fecha}. Reenviar esta fecha sobreescribe los registros previos.`}
          confirmLabel="Guardar"
          loading={saving}
          loadingLabel="Guardando…"
          onConfirm={doSave}
          onCancel={() => setConfirmSave(null)}
        >
          <ul className="asist-confirm-summary">
            <li><strong>{confirmSave.nuevos}</strong> nuevo{confirmSave.nuevos === 1 ? '' : 's'}</li>
            <li><strong>{confirmSave.actualizados}</strong> se actualizará{confirmSave.actualizados === 1 ? '' : 'n'} (ya existían)</li>
            {confirmSave.sinMarcar > 0 && (
              <li className="asist-confirm-warn"><strong>{confirmSave.sinMarcar}</strong> sin marcar (no se registran)</li>
            )}
          </ul>
        </AuroraConfirmModal>
      )}
    </div>
  );
}
