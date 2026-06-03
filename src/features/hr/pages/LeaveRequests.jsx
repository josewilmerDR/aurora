import { useState, useEffect, useMemo, useRef } from 'react';
import '../styles/hr.css';
import '../styles/leave-calendar.css';
import { FiPlus, FiTrash2, FiCheck, FiX, FiClock, FiList, FiCalendar, FiRotateCcw } from 'react-icons/fi';
import EmptyState from '../../../components/ui/EmptyState';
import AuroraConfirmModal from '../../../components/AuroraConfirmModal';
import { useApiFetch } from '../../../hooks/useApiFetch';
import { useToast } from '../../../contexts/ToastContext';
import { useUser, hasMinRole } from '../../../contexts/UserContext';
import LeaveCalendar from '../components/LeaveCalendar';
import { useBlurValidation } from '../../../hooks/useBlurValidation';
import { todayLocal } from '../lib/dateHelpers';
import {
  TIPOS,
  tipoLabel,
  estadoLabel,
  calcDias,
  calcHoras,
  validateLeave,
  MOTIVO_MAX,
} from '../lib/leaveHelpers';
import { translateApiError } from '../../../lib/errorMessages';

const MESES = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];
const HIGHLIGHT_MS = 2500;

async function parseError(res, fallback) {
  try {
    return translateApiError(await res.json(), fallback);
  } catch {
    return fallback;
  }
}

function LeaveRequests() {
  const apiFetch = useApiFetch();
  const toast = useToast();
  const { currentUser } = useUser();
  const userRole = currentUser?.rol || 'trabajador';
  const canApprove = hasMinRole(userRole, 'supervisor');
  const canDelete  = hasMinRole(userRole, 'encargado');

  const today = todayLocal();
  const [permisos, setPermisos] = useState([]);
  const [users, setUsers] = useState([]);
  const [mes, setMes] = useState(today.slice(5, 7));
  const [anio, setAnio] = useState(today.slice(0, 4));
  const [filtroTrabajador, setFiltroTrabajador] = useState('');
  const [view, setView] = useState('lista'); // 'lista' | 'calendario'
  const [initialLoading, setInitialLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  // Ids con una acción (aprobar/rechazar/revertir/eliminar) en vuelo. Set para
  // permitir acciones concurrentes en filas distintas sin un lock global.
  const [pendingIds, setPendingIds] = useState(() => new Set());
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [highlightId, setHighlightId] = useState(null);
  const highlightTimer = useRef(null);
  const { fieldErrors, blurField, clearField, validateAll, inputClass } = useBlurValidation(validateLeave);

  const addPending = (id) => setPendingIds(prev => new Set(prev).add(id));
  const removePending = (id) => setPendingIds(prev => {
    const next = new Set(prev);
    next.delete(id);
    return next;
  });

  const flashRow = (id) => {
    setHighlightId(id);
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
    highlightTimer.current = setTimeout(() => setHighlightId(null), HIGHLIGHT_MS);
  };
  useEffect(() => () => { if (highlightTimer.current) clearTimeout(highlightTimer.current); }, []);

  // Años disponibles en el filtro, derivados del año actual (no hardcodeados).
  const years = useMemo(() => {
    const y = Number(today.slice(0, 4));
    return [y - 2, y - 1, y, y + 1];
  }, [today]);

  const [esParcial, setEsParcial] = useState(false);
  const [form, setForm] = useState({
    trabajadorId: '',
    tipo: 'permiso_con_goce',
    fechaInicio: today,
    fechaFin:    today,
    horaInicio:  '08:00',
    horaFin:     '12:00',
    motivo: '',
  });

  const fetchPermisos = async () => {
    try {
      const r = await apiFetch('/api/hr/permisos');
      if (!r.ok) throw new Error();
      const data = await r.json();
      setPermisos(Array.isArray(data) ? data : []);
    } catch {
      toast.error('Error al cargar permisos.');
    }
  };

  useEffect(() => {
    (async () => {
      try {
        const r = await apiFetch('/api/users/lite');
        if (!r.ok) throw new Error();
        const data = await r.json();
        setUsers(Array.isArray(data) ? data : []);
      } catch {
        toast.error('Error al cargar trabajadores.');
      }
      await fetchPermisos();
      setInitialLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tipoInfo = TIPOS.find(t => t.value === form.tipo);
  const dias  = calcDias(form.fechaInicio, form.fechaFin);
  const horas = calcHoras(form.horaInicio, form.horaFin);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm(prev => ({ ...prev, [name]: value }));
    clearField(name);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitting) return;
    if (!validateAll(form, esParcial)) return;

    const worker = users.find(u => u.id === form.trabajadorId);
    const conGoce = TIPOS.find(t => t.value === form.tipo)?.conGoce ?? true;
    const payload = {
      trabajadorId: form.trabajadorId,
      trabajadorNombre: worker?.nombre || '',
      tipo: form.tipo,
      fechaInicio: form.fechaInicio,
      motivo: form.motivo.trim().slice(0, MOTIVO_MAX),
      conGoce,
      esParcial,
      ...(esParcial
        ? { fechaFin: form.fechaInicio, dias: 0, horas, horaInicio: form.horaInicio, horaFin: form.horaFin }
        : { fechaFin: form.fechaFin, dias, horas: 0, horaInicio: null, horaFin: null }),
    };

    setSubmitting(true);
    try {
      const res = await apiFetch('/api/hr/permisos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        toast.error(await parseError(res, 'Error al registrar permiso.'));
        return;
      }
      // Saltar el filtro al mes/año del permiso recién creado para que el
      // usuario lo vea (evita "registrado" pero invisible → duplicados).
      const nuevoMes  = form.fechaInicio.slice(5, 7);
      const nuevoAnio = form.fechaInicio.slice(0, 4);
      await fetchPermisos();
      setMes(nuevoMes);
      setAnio(nuevoAnio);
      setForm(prev => ({ ...prev, trabajadorId: '', motivo: '' }));
      toast.success('Permiso registrado.');
    } catch {
      toast.error('Error al registrar permiso.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleEstado = async (id, estado) => {
    if (pendingIds.has(id)) return;
    addPending(id);
    try {
      const res = await apiFetch(`/api/hr/permisos/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ estado }),
      });
      if (!res.ok) {
        toast.error(await parseError(res, 'Error al actualizar permiso.'));
        return;
      }
      await fetchPermisos();
      flashRow(id);
      toast.success(`Permiso ${estadoLabel(estado).toLowerCase()}.`);
    } catch {
      toast.error('Error al actualizar permiso.');
    } finally {
      removePending(id);
    }
  };

  const handleDelete = async (id) => {
    if (pendingIds.has(id)) return;
    addPending(id);
    try {
      const res = await apiFetch(`/api/hr/permisos/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        toast.error(await parseError(res, 'Error al eliminar.'));
        return;
      }
      await fetchPermisos();
      toast.success('Permiso eliminado.');
    } catch {
      toast.error('Error al eliminar.');
    } finally {
      removePending(id);
    }
  };

  const toggleParcial = () => setEsParcial(v => !v);

  const visibles = useMemo(() => permisos.filter(p => {
    if (!p.fechaInicio) return false;
    const fecha = new Date(p.fechaInicio);
    if (Number.isNaN(fecha.getTime())) return false;
    const mMatch = String(fecha.getMonth() + 1).padStart(2, '0') === mes;
    const yMatch = String(fecha.getFullYear()) === anio;
    const wMatch = !filtroTrabajador || p.trabajadorId === filtroTrabajador;
    return mMatch && yMatch && wMatch;
  }), [permisos, mes, anio, filtroTrabajador]);

  const stats = useMemo(() => visibles.reduce((acc, p) => {
    if (p.estado === 'pendiente') acc.pendiente++;
    if (p.estado === 'aprobado') {
      acc.aprobado++;
      if (!p.conGoce) acc.sinGoce++;
    }
    if (p.estado === 'rechazado') acc.rechazado++;
    return acc;
  }, { pendiente: 0, aprobado: 0, rechazado: 0, sinGoce: 0 }), [visibles]);

  // Datos concretos del permiso a eliminar para el modal de confirmación.
  const deleteDetail = useMemo(() => {
    if (!confirmDelete) return '';
    const p = confirmDelete;
    const tl = tipoLabel(p.tipo);
    if (p.esParcial) {
      return `${tl} · ${p.fechaInicio?.slice(0, 10) || ''} ${p.horaInicio || ''}–${p.horaFin || ''}`;
    }
    const ini = p.fechaInicio?.slice(0, 10) || '';
    const fin = p.fechaFin?.slice(0, 10) || ini;
    return `${tl} · ${ini} → ${fin} (${p.dias} ${p.dias === 1 ? 'día' : 'días'})`;
  }, [confirmDelete]);

  const filtroActivo = !!filtroTrabajador;

  return (
    <div className="lote-management-layout">
      {/* ── Formulario ── */}
      <div className="form-card">
        <h2>Registrar Permiso o Ausencia</h2>
        <form onSubmit={handleSubmit} className="lote-form">

          <div className="hr-parcial-toggle">
            <button
              type="button"
              className="hr-toggle-label"
              role="switch"
              aria-checked={esParcial}
              onClick={toggleParcial}
            >
              <span className={`hr-toggle-switch ${esParcial ? 'hr-toggle-switch--on' : ''}`}>
                <span className="hr-toggle-knob" />
              </span>
              <FiClock size={14} aria-hidden="true" />
              Permiso por horas (parcial)
            </button>
          </div>

          <div className="form-grid">
            <div className="form-control">
              <label htmlFor="lr-trabajador">Trabajador</label>
              <select
                id="lr-trabajador"
                name="trabajadorId"
                value={form.trabajadorId}
                onChange={handleChange}
                onBlur={() => blurField('trabajadorId', form, esParcial)}
                className={inputClass('trabajadorId', 'aur-select')}
                aria-invalid={!!fieldErrors.trabajadorId}
                aria-describedby={fieldErrors.trabajadorId ? 'lr-trabajador-err' : undefined}
                required
              >
                <option value="">-- Seleccionar --</option>
                {users.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
              </select>
              {fieldErrors.trabajadorId && <span id="lr-trabajador-err" role="alert" className="aur-field-error">{fieldErrors.trabajadorId}</span>}
            </div>
            <div className="form-control">
              <label htmlFor="lr-tipo">Tipo de permiso</label>
              <select id="lr-tipo" name="tipo" value={form.tipo} onChange={handleChange} className="aur-select">
                {TIPOS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div className="form-control">
              <label htmlFor="lr-fechaInicio">{esParcial ? 'Fecha' : 'Fecha inicio'}</label>
              <input
                id="lr-fechaInicio"
                type="date" name="fechaInicio" value={form.fechaInicio}
                onChange={handleChange}
                onBlur={() => blurField('fechaInicio', form, esParcial)}
                className={inputClass('fechaInicio')}
                aria-invalid={!!fieldErrors.fechaInicio}
                aria-describedby={fieldErrors.fechaInicio ? 'lr-fechaInicio-err' : undefined}
                required
              />
              {fieldErrors.fechaInicio && <span id="lr-fechaInicio-err" role="alert" className="aur-field-error">{fieldErrors.fechaInicio}</span>}
            </div>

            {esParcial ? (
              <>
                <div className="form-control">
                  <label htmlFor="lr-horaInicio">Hora inicio</label>
                  <input id="lr-horaInicio" type="time" name="horaInicio" value={form.horaInicio} onChange={handleChange} className="aur-input" required />
                </div>
                <div className="form-control">
                  <label htmlFor="lr-horaFin">Hora fin</label>
                  <input
                    id="lr-horaFin"
                    type="time" name="horaFin" value={form.horaFin}
                    onChange={handleChange}
                    onBlur={() => blurField('horaFin', form, esParcial)}
                    className={inputClass('horaFin')}
                    aria-invalid={!!fieldErrors.horaFin}
                    aria-describedby={fieldErrors.horaFin ? 'lr-horaFin-err' : undefined}
                    required
                  />
                  {fieldErrors.horaFin && <span id="lr-horaFin-err" role="alert" className="aur-field-error">{fieldErrors.horaFin}</span>}
                </div>
              </>
            ) : (
              <div className="form-control">
                <label htmlFor="lr-fechaFin">Fecha fin</label>
                <input
                  id="lr-fechaFin"
                  type="date" name="fechaFin" value={form.fechaFin}
                  min={form.fechaInicio} onChange={handleChange}
                  onBlur={() => blurField('fechaFin', form, esParcial)}
                  className={inputClass('fechaFin')}
                  aria-invalid={!!fieldErrors.fechaFin}
                  aria-describedby={fieldErrors.fechaFin ? 'lr-fechaFin-err' : undefined}
                  required
                />
                {fieldErrors.fechaFin && <span id="lr-fechaFin-err" role="alert" className="aur-field-error">{fieldErrors.fechaFin}</span>}
              </div>
            )}

            <div className="form-control">
              <label htmlFor="lr-motivo">Motivo (opcional)</label>
              <textarea
                id="lr-motivo"
                name="motivo" value={form.motivo}
                rows={2}
                onChange={handleChange}
                onBlur={() => blurField('motivo', form, esParcial)}
                className={inputClass('motivo')}
                placeholder="Descripción breve..."
                maxLength={MOTIVO_MAX}
                aria-invalid={!!fieldErrors.motivo}
                aria-describedby={fieldErrors.motivo ? 'lr-motivo-err' : undefined}
              />
              <div className="hr-char-counter">{form.motivo.length}/{MOTIVO_MAX}</div>
              {fieldErrors.motivo && <span id="lr-motivo-err" role="alert" className="aur-field-error">{fieldErrors.motivo}</span>}
            </div>
          </div>

          <div className="hr-permiso-preview">
            {esParcial ? (
              <span>
                <FiClock size={13} style={{ marginRight: 4 }} aria-hidden="true" />
                <strong>{horas}</strong> {horas === 1 ? 'hora' : 'horas'}
              </span>
            ) : (
              <span><strong>{dias}</strong> {dias === 1 ? 'día' : 'días'} calendario</span>
            )}
            <span className={`hr-goce-badge hr-goce-badge--${tipoInfo?.conGoce ? 'con' : 'sin'}`}>
              {tipoInfo?.conGoce ? 'Con goce de salario' : 'Sin goce de salario'}
            </span>
          </div>

          <div className="form-actions">
            <button type="submit" className="aur-btn-pill" disabled={submitting}>
              <FiPlus /> {submitting ? 'Registrando…' : 'Registrar'}
            </button>
          </div>
        </form>
      </div>

      {/* ── Lista ── */}
      <div className="list-card">
        <h2>Permisos Registrados</h2>

        <div className="hr-filters">
          <select className="aur-select" value={mes} onChange={e => setMes(e.target.value)} aria-label="Mes">
            {MESES.map(m => (
              <option key={m} value={m}>
                {new Date(2000, Number(m) - 1).toLocaleString('es-ES', { month: 'long' })}
              </option>
            ))}
          </select>
          <select className="aur-select" value={anio} onChange={e => setAnio(e.target.value)} aria-label="Año">
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <select className="aur-select" value={filtroTrabajador} onChange={e => setFiltroTrabajador(e.target.value)} aria-label="Trabajador">
            <option value="">Todos los trabajadores</option>
            {users.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
          </select>
        </div>

        <div className="hr-stats">
          <div className="hr-stat-card">
            <div className="hr-stat-value">{stats.pendiente}</div>
            <div className="hr-stat-label">Pendientes</div>
          </div>
          <div className="hr-stat-card">
            <div className="hr-stat-value">{stats.aprobado}</div>
            <div className="hr-stat-label">Aprobados</div>
          </div>
          <div className="hr-stat-card">
            <div className="hr-stat-value">{stats.rechazado}</div>
            <div className="hr-stat-label">Rechazados</div>
          </div>
          <div className="hr-stat-card">
            <div className="hr-stat-value hr-stat-value--danger">{stats.sinGoce}</div>
            <div className="hr-stat-label">Sin goce aprobados</div>
          </div>
        </div>

        <div className="leave-view-toggle" role="tablist" aria-label="Vista">
          <button
            type="button"
            role="tab"
            aria-selected={view === 'lista'}
            className={`leave-view-tab${view === 'lista' ? ' is-active' : ''}`}
            onClick={() => setView('lista')}
          >
            <FiList size={13} aria-hidden="true" /> Lista
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === 'calendario'}
            className={`leave-view-tab${view === 'calendario' ? ' is-active' : ''}`}
            onClick={() => setView('calendario')}
          >
            <FiCalendar size={13} aria-hidden="true" /> Calendario
          </button>
        </div>

        {initialLoading ? (
          <p className="empty-state" aria-live="polite">Cargando permisos…</p>
        ) : view === 'calendario' ? (
          <LeaveCalendar
            permisos={visibles}
            mes={mes}
            anio={anio}
            onMesChange={setMes}
            onAnioChange={setAnio}
            canApprove={canApprove}
            canDelete={canDelete}
            pendingIds={pendingIds}
            onApprove={(id) => handleEstado(id, 'aprobado')}
            onReject={(id) => handleEstado(id, 'rechazado')}
            onRevert={(id) => handleEstado(id, 'pendiente')}
            onDelete={(id) => {
              const p = permisos.find(x => x.id === id);
              if (p) setConfirmDelete(p);
            }}
          />
        ) : visibles.length === 0 ? (
          <EmptyState
            icon={FiCalendar}
            title="Sin permisos para este período."
            subtitle={filtroActivo ? 'Probá otro mes o quitá el filtro de trabajador.' : 'Registrá uno con el formulario de arriba.'}
          />
        ) : (
          <ul className="info-list">
            {visibles.map(p => {
              const conGoce   = p.conGoce !== false;
              let duracion = '';
              if (p.esParcial) {
                duracion = `${p.horaInicio || ''} – ${p.horaFin || ''} (${p.horas} ${p.horas === 1 ? 'hora' : 'horas'})`;
              } else if (p.fechaInicio && p.fechaFin) {
                const inicio = new Date(p.fechaInicio).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
                const fin    = new Date(p.fechaFin).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
                duracion = `${inicio} → ${fin} (${p.dias} ${p.dias === 1 ? 'día' : 'días'})`;
              }
              const fecha = p.fechaInicio
                ? new Date(p.fechaInicio).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })
                : '';
              const busy = pendingIds.has(p.id);
              return (
                <li key={p.id} className={highlightId === p.id ? 'hr-row-flash' : undefined}>
                  <div>
                    <div className="item-main-text">
                      {p.trabajadorNombre}
                      {p.esParcial && (
                        <span className="status-badge hr-badge-parcial">
                          <FiClock size={10} style={{ marginRight: 3 }} aria-hidden="true" />parcial
                        </span>
                      )}
                      <span className={`status-badge status-badge--${p.estado}`}>{estadoLabel(p.estado)}</span>
                      <span className={`hr-goce-badge hr-goce-badge--${conGoce ? 'con' : 'sin'}`}>
                        {conGoce ? 'con goce' : 'sin goce'}
                      </span>
                    </div>
                    <div className="item-sub-text">
                      {tipoLabel(p.tipo)} · {p.esParcial ? fecha + ' · ' : ''}{duracion}
                      {p.motivo && ` · ${p.motivo}`}
                    </div>
                  </div>
                  <div className="lote-actions">
                    {canApprove && p.estado === 'pendiente' && (
                      <>
                        <button
                          onClick={() => handleEstado(p.id, 'aprobado')}
                          disabled={busy}
                          className="aur-icon-btn aur-icon-btn--success" title="Aprobar"
                        >
                          <FiCheck size={16} />
                        </button>
                        <button
                          onClick={() => handleEstado(p.id, 'rechazado')}
                          disabled={busy}
                          className="aur-icon-btn aur-icon-btn--danger" title="Rechazar"
                        >
                          <FiX size={16} />
                        </button>
                      </>
                    )}
                    {canApprove && p.estado !== 'pendiente' && (
                      <button
                        onClick={() => handleEstado(p.id, 'pendiente')}
                        disabled={busy}
                        className="aur-icon-btn" title="Revertir a pendiente"
                      >
                        <FiRotateCcw size={15} />
                      </button>
                    )}
                    {canDelete && (
                      <button
                        onClick={() => setConfirmDelete(p)}
                        disabled={busy}
                        className="aur-icon-btn aur-icon-btn--danger" title="Eliminar"
                      >
                        <FiTrash2 size={18} />
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {confirmDelete && (
        <AuroraConfirmModal
          danger
          title="Eliminar permiso"
          body={`¿Eliminar el permiso de ${confirmDelete.trabajadorNombre || 'este trabajador'}? Esta acción no se puede deshacer.`}
          confirmLabel="Eliminar"
          onConfirm={() => { handleDelete(confirmDelete.id); setConfirmDelete(null); }}
          onCancel={() => setConfirmDelete(null)}
        >
          <p className="hr-confirm-detail">{deleteDetail}</p>
        </AuroraConfirmModal>
      )}
    </div>
  );
}

export default LeaveRequests;
