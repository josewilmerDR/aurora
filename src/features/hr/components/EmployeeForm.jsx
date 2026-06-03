import { FiSave, FiX, FiKey, FiChevronDown } from 'react-icons/fi';
import { ROLE_LABELS } from '../../../contexts/UserContext';
import {
  DIAS_SEMANA, LIMITS, SALARIO_MAX, calcHorasSemanales, todayLocalISO,
} from '../lib/employeeProfileShared';

// Formulario de empleado: agrupa "Información Personal" (cuenta) +
// "Información Laboral" + "Horario Semanal" + "Información de Contacto"
// + "Notas". State, handlers y submit son del padre (EmployeeProfile);
// este componente sólo renderiza la UI y delega los eventos.
export default function EmployeeForm({
  userForm,
  fichaForm,
  errors,
  isEditing,
  selectedUser,
  saving,
  encargados,
  formRef,
  laboralCollapsed, setLaboralCollapsed,
  horarioCollapsed, setHorarioCollapsed,
  contactoCollapsed, setContactoCollapsed,
  notasCollapsed, setNotasCollapsed,
  horarioDefault, setHorarioDefault,
  onUserChange,
  onFichaChange,
  onHorarioChange,
  onAplicarHorarioLV,
  onSubmit,
  onCancel,
}) {
  const tieneAcceso = userForm.tieneAcceso === true;

  // aria-describedby sólo apunta al id del error cuando existe — así el lector
  // de pantalla lee el mensaje concreto del campo al enfocarlo, no sólo el
  // toast genérico "Revisa los campos marcados".
  const errId = (name) => (errors[name] ? `ef-${name}-error` : undefined);

  // Toggle is rendered as a synthetic change event so the parent's existing
  // onUserChange handler can stay agnostic of the new flag. Setting access
  // off also clears email/rol on the next handler invocation? No — we leave
  // the values in state so toggling back on restores them; only the validator
  // and the submit payload care about the flag's current state.
  const onToggleAcceso = (e) => {
    onUserChange({ target: { name: 'tieneAcceso', value: e.target.checked } });
    if (e.target.checked && (!userForm.rol || userForm.rol === 'ninguno')) {
      onUserChange({ target: { name: 'rol', value: 'trabajador' } });
    }
    if (!e.target.checked) {
      onUserChange({ target: { name: 'rol', value: 'ninguno' } });
    }
  };

  return (
    <div className="form-card form-card--ficha-edit">
      <h2>{isEditing ? `Editando: ${selectedUser?.nombre || ''}` : 'Nuevo Empleado'}</h2>
      <form onSubmit={onSubmit} noValidate ref={formRef} className="lote-form" style={{ marginTop: 16 }}>

        <p className="form-section-title">Información Personal</p>
        <div className="form-grid">
          <div className={`form-control${errors.nombre ? ' form-control--error' : ''}`}>
            <label htmlFor="ef-nombre">Nombre Completo</label>
            <input id="ef-nombre" name="nombre" value={userForm.nombre} onChange={onUserChange} required maxLength={LIMITS.nombre} placeholder="Nombre completo" aria-invalid={!!errors.nombre} aria-describedby={errId('nombre')} />
            {errors.nombre && <span id="ef-nombre-error" className="form-control-error" role="alert">{errors.nombre}</span>}
          </div>
          <div className={`form-control${errors.cedula ? ' form-control--error' : ''}`}>
            <label htmlFor="ef-cedula">Cédula / Identificación</label>
            <input id="ef-cedula" name="cedula" value={fichaForm.cedula} onChange={onFichaChange} maxLength={LIMITS.cedula} placeholder="1-1234-5678" aria-invalid={!!errors.cedula} aria-describedby={errId('cedula')} />
            {errors.cedula && <span id="ef-cedula-error" className="form-control-error" role="alert">{errors.cedula}</span>}
          </div>
          <div className={`form-control${errors.telefono ? ' form-control--error' : ''}`}>
            <label htmlFor="ef-telefono">Teléfono</label>
            <input id="ef-telefono" name="telefono" value={userForm.telefono} onChange={onUserChange} maxLength={LIMITS.telefono} inputMode="tel" placeholder="8888-8888" aria-invalid={!!errors.telefono} aria-describedby={errId('telefono')} />
            {errors.telefono && <span id="ef-telefono-error" className="form-control-error" role="alert">{errors.telefono}</span>}
          </div>
        </div>

        {/* "Acceso al sistema" — faceta opt-in. Si está OFF se crea sólo como
            empleado de planilla; si está ON aparecen email + rol obligatorios
            y el doc además queda como usuario del sistema. */}
        <div className="emp-acceso-toggle-row">
          <label className="emp-acceso-toggle">
            <input
              type="checkbox"
              checked={tieneAcceso}
              onChange={onToggleAcceso}
            />
            <span className="emp-acceso-toggle-label">
              <FiKey size={13} /> Esta persona también es usuario del sistema
            </span>
          </label>
          <span className="emp-acceso-toggle-hint">
            {tieneAcceso
              ? 'Podrá iniciar sesión y usar la app. Requiere email y rol.'
              : 'Sólo aparecerá en planilla y registros HR. No tendrá acceso a la app.'}
          </span>
        </div>

        {tieneAcceso && (
          <div className="form-grid emp-acceso-fields">
            <div className={`form-control${errors.email ? ' form-control--error' : ''}`}>
              <label htmlFor="ef-email">Email</label>
              <input id="ef-email" name="email" type="email" value={userForm.email} onChange={onUserChange} required maxLength={LIMITS.email} placeholder="correo@ejemplo.com" aria-invalid={!!errors.email} aria-describedby={errId('email')} />
              {errors.email && <span id="ef-email-error" className="form-control-error" role="alert">{errors.email}</span>}
            </div>
            <div className={`form-control${errors.rol ? ' form-control--error' : ''}`}>
              <label htmlFor="ef-rol">Rol en el sistema</label>
              <select id="ef-rol" name="rol" value={userForm.rol === 'ninguno' ? 'trabajador' : userForm.rol} onChange={onUserChange} aria-invalid={!!errors.rol} aria-describedby={errId('rol')}>
                <option value="trabajador">Trabajador</option>
                <option value="encargado">Encargado</option>
                <option value="supervisor">Supervisor</option>
                <option value="rrhh">RR.HH.</option>
                <option value="administrador">Administrador</option>
              </select>
              {errors.rol && <span id="ef-rol-error" className="form-control-error" role="alert">{errors.rol}</span>}
            </div>
          </div>
        )}

        <button type="button" className="form-section-title collapsible-section-header" onClick={() => setLaboralCollapsed(v => !v)} aria-expanded={!laboralCollapsed} aria-controls="ef-sec-laboral">
          <span>Información Laboral</span>
          <span className={`collapsible-chevron${laboralCollapsed ? '' : ' collapsible-chevron--open'}`}><FiChevronDown size={16} /></span>
        </button>
        <div id="ef-sec-laboral" className={laboralCollapsed ? 'collapsible-content--hidden' : ''}>
          <div className="form-grid">
            <div className={`form-control${errors.puesto ? ' form-control--error' : ''}`}>
              <label htmlFor="ef-puesto">Puesto</label>
              <input id="ef-puesto" name="puesto" value={fichaForm.puesto} onChange={onFichaChange} maxLength={LIMITS.puesto} placeholder="Ej: Operario de campo" aria-invalid={!!errors.puesto} aria-describedby={errId('puesto')} />
              {errors.puesto && <span id="ef-puesto-error" className="form-control-error" role="alert">{errors.puesto}</span>}
            </div>
            <div className={`form-control${errors.departamento ? ' form-control--error' : ''}`}>
              <label htmlFor="ef-departamento">Departamento</label>
              <input id="ef-departamento" name="departamento" value={fichaForm.departamento} onChange={onFichaChange} maxLength={LIMITS.departamento} placeholder="Ej: Producción" aria-invalid={!!errors.departamento} aria-describedby={errId('departamento')} />
              {errors.departamento && <span id="ef-departamento-error" className="form-control-error" role="alert">{errors.departamento}</span>}
            </div>
            <div className={`form-control${errors.fechaIngreso ? ' form-control--error' : ''}`}>
              <label htmlFor="ef-fechaIngreso">Fecha de Ingreso</label>
              <input id="ef-fechaIngreso" name="fechaIngreso" type="date" value={fichaForm.fechaIngreso} onChange={onFichaChange} max={todayLocalISO()} aria-invalid={!!errors.fechaIngreso} aria-describedby={errId('fechaIngreso')} />
              {errors.fechaIngreso && <span id="ef-fechaIngreso-error" className="form-control-error" role="alert">{errors.fechaIngreso}</span>}
            </div>
            <div className={`form-control${errors.tipoContrato ? ' form-control--error' : ''}`}>
              <label htmlFor="ef-tipoContrato">Tipo de Contrato</label>
              <select id="ef-tipoContrato" name="tipoContrato" value={fichaForm.tipoContrato} onChange={onFichaChange} aria-invalid={!!errors.tipoContrato} aria-describedby={errId('tipoContrato')}>
                <option value="permanente">Permanente</option>
                <option value="temporal">Temporal</option>
                <option value="por_obra">Por obra</option>
              </select>
              {errors.tipoContrato && <span id="ef-tipoContrato-error" className="form-control-error" role="alert">{errors.tipoContrato}</span>}
            </div>
            <div className={`form-control${errors.salarioBase ? ' form-control--error' : ''}`}>
              <label htmlFor="ef-salarioBase">Salario Base (₡)</label>
              <input id="ef-salarioBase" name="salarioBase" type="number" min="0" max={SALARIO_MAX} step="any" inputMode="decimal" value={fichaForm.salarioBase} onChange={onFichaChange} placeholder="0" aria-invalid={!!errors.salarioBase} aria-describedby={errId('salarioBase')} />
              {errors.salarioBase && <span id="ef-salarioBase-error" className="form-control-error" role="alert">{errors.salarioBase}</span>}
            </div>
            <div className={`form-control${errors.precioHora ? ' form-control--error' : ''}`}>
              <label htmlFor="ef-precioHora">Precio por Hora (₡)</label>
              <input id="ef-precioHora" name="precioHora" type="number" min="0" max={SALARIO_MAX} step="any" inputMode="decimal" value={fichaForm.precioHora} onChange={onFichaChange} placeholder="0" aria-invalid={!!errors.precioHora} aria-describedby={errId('precioHora')} />
              {errors.precioHora && <span id="ef-precioHora-error" className="form-control-error" role="alert">{errors.precioHora}</span>}
            </div>
            <div className="form-control">
              <label htmlFor="ef-encargadoId">Encargado / Supervisor directo</label>
              <select id="ef-encargadoId" name="encargadoId" value={fichaForm.encargadoId} onChange={onFichaChange}>
                <option value="">— Sin asignar —</option>
                {encargados.map(e => (
                  <option key={e.id} value={e.id}>{e.nombre} ({ROLE_LABELS[e.rol] || e.rol})</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <button type="button" className="form-section-title collapsible-section-header" onClick={() => setHorarioCollapsed(v => !v)} aria-expanded={!horarioCollapsed} aria-controls="ef-sec-horario">
          <span>Horario Semanal</span>
          <span className={`collapsible-chevron${horarioCollapsed ? '' : ' collapsible-chevron--open'}`}><FiChevronDown size={16} /></span>
        </button>
        <div id="ef-sec-horario" className={`horario-grid${horarioCollapsed ? ' horario-grid--hidden' : ''}`}>
          <div className="horario-quickfill">
            <div className="horario-quickfill-inputs">
              <label htmlFor="ef-horario-inicio">Entrada</label>
              <input id="ef-horario-inicio" type="time" value={horarioDefault.inicio} onChange={e => setHorarioDefault(p => ({ ...p, inicio: e.target.value }))} className="horario-time-input" />
              <label htmlFor="ef-horario-fin">Salida</label>
              <input id="ef-horario-fin" type="time" value={horarioDefault.fin} onChange={e => setHorarioDefault(p => ({ ...p, fin: e.target.value }))} className="horario-time-input" />
            </div>
            <button type="button" className="btn-aplicar-lv" onClick={onAplicarHorarioLV}>Aplicar L–S</button>
          </div>
          <div className="horario-grid-header">
            <span>Labora</span><span>Entrada</span><span>Salida</span>
          </div>
          {DIAS_SEMANA.map(({ key, letra, label }) => {
            const dia = fichaForm.horarioSemanal?.[key] || { activo: false, inicio: '', fin: '' };
            const errKey = `horario_${key}`;
            const hasErr = !!errors[errKey];
            return (
              <div key={key} className={`horario-row${dia.activo ? '' : ' horario-row--inactivo'}${hasErr ? ' horario-row--error' : ''}`}>
                <label className="horario-toggle">
                  <input type="checkbox" checked={dia.activo} onChange={e => onHorarioChange(key, 'activo', e.target.checked)} aria-label={`${label}: laborable`} />
                  <span className="horario-toggle-track"><span className="horario-dia-letra">{letra}</span></span>
                </label>
                <div className="horario-times">
                  <input type="time" value={dia.inicio} disabled={!dia.activo} onChange={e => onHorarioChange(key, 'inicio', e.target.value)} className="horario-time-input" aria-label={`${label}: entrada`} />
                  <input type="time" value={dia.fin}    disabled={!dia.activo} onChange={e => onHorarioChange(key, 'fin',   e.target.value)} className="horario-time-input" aria-label={`${label}: salida`} />
                </div>
                {hasErr && <span className="form-control-error horario-row-error" role="alert">{errors[errKey]}</span>}
              </div>
            );
          })}
          <div className="horario-total-row">
            <span>Total semanal</span>
            <strong>{(() => { const t = calcHorasSemanales(fichaForm.horarioSemanal); return t > 0 ? `${t % 1 === 0 ? t : t.toFixed(1)} horas/semana` : '—'; })()}</strong>
          </div>
        </div>

        <button type="button" className="form-section-title collapsible-section-header" onClick={() => setContactoCollapsed(v => !v)} aria-expanded={!contactoCollapsed} aria-controls="ef-sec-contacto">
          <span>Información de Contacto</span>
          <span className={`collapsible-chevron${contactoCollapsed ? '' : ' collapsible-chevron--open'}`}><FiChevronDown size={16} /></span>
        </button>
        <div id="ef-sec-contacto" className={contactoCollapsed ? 'collapsible-content--hidden' : ''}>
          <div className="form-grid">
            <div className={`form-control${errors.direccion ? ' form-control--error' : ''}`}>
              <label htmlFor="ef-direccion">Dirección</label>
              <input id="ef-direccion" name="direccion" value={fichaForm.direccion} onChange={onFichaChange} maxLength={LIMITS.direccion} placeholder="Dirección de residencia" aria-invalid={!!errors.direccion} aria-describedby={errId('direccion')} />
              {errors.direccion && <span id="ef-direccion-error" className="form-control-error" role="alert">{errors.direccion}</span>}
            </div>
            <div className={`form-control${errors.contactoEmergencia ? ' form-control--error' : ''}`}>
              <label htmlFor="ef-contactoEmergencia">Contacto de Emergencia</label>
              <input id="ef-contactoEmergencia" name="contactoEmergencia" value={fichaForm.contactoEmergencia} onChange={onFichaChange} maxLength={LIMITS.contactoEmergencia} placeholder="Nombre" aria-invalid={!!errors.contactoEmergencia} aria-describedby={errId('contactoEmergencia')} />
              {errors.contactoEmergencia && <span id="ef-contactoEmergencia-error" className="form-control-error" role="alert">{errors.contactoEmergencia}</span>}
            </div>
            <div className={`form-control${errors.telefonoEmergencia ? ' form-control--error' : ''}`}>
              <label htmlFor="ef-telefonoEmergencia">Teléfono Emergencia</label>
              <input id="ef-telefonoEmergencia" name="telefonoEmergencia" value={fichaForm.telefonoEmergencia} onChange={onFichaChange} maxLength={LIMITS.telefonoEmergencia} inputMode="tel" placeholder="8888-8888" aria-invalid={!!errors.telefonoEmergencia} aria-describedby={errId('telefonoEmergencia')} />
              {errors.telefonoEmergencia && <span id="ef-telefonoEmergencia-error" className="form-control-error" role="alert">{errors.telefonoEmergencia}</span>}
            </div>
          </div>
        </div>

        <button type="button" className="form-section-title collapsible-section-header" onClick={() => setNotasCollapsed(v => !v)} aria-expanded={!notasCollapsed} aria-controls="ef-sec-notas">
          <span>Notas</span>
          <span className={`collapsible-chevron${notasCollapsed ? '' : ' collapsible-chevron--open'}`}><FiChevronDown size={16} /></span>
        </button>
        <div id="ef-sec-notas" className={notasCollapsed ? 'collapsible-content--hidden' : ''}>
          <div className={`form-control${errors.notas ? ' form-control--error' : ''}`}>
            <textarea id="ef-notas" name="notas" value={fichaForm.notas} onChange={onFichaChange} maxLength={LIMITS.notas} placeholder="Observaciones generales del trabajador..." aria-invalid={!!errors.notas} aria-describedby={errId('notas')} aria-label="Notas" />
            <span className="form-control-hint">{(fichaForm.notas || '').length}/{LIMITS.notas}</span>
            {errors.notas && <span id="ef-notas-error" className="form-control-error" role="alert">{errors.notas}</span>}
          </div>
        </div>

        <div className="form-actions">
          <button type="button" className="aur-btn-text" onClick={onCancel}>
            <FiX /> Cancelar
          </button>
          <button type="submit" className="aur-btn-pill" disabled={saving}>
            <FiSave />
            {saving ? 'Guardando...' : isEditing ? 'Guardar Cambios' : 'Crear Empleado'}
          </button>
        </div>
      </form>
    </div>
  );
}
