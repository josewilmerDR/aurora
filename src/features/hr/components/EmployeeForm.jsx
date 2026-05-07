import { FiSave, FiX } from 'react-icons/fi';
import { ROLE_LABELS } from '../../../contexts/UserContext';
import {
  DIAS_SEMANA, LIMITS, SALARIO_MAX, calcHorasSemanales,
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
  return (
    <div className="form-card form-card--ficha-edit">
      <h2>{isEditing ? `Editando: ${selectedUser?.nombre || ''}` : 'Nuevo Empleado'}</h2>
      <form onSubmit={onSubmit} noValidate ref={formRef} className="lote-form" style={{ marginTop: 16 }}>

        <p className="form-section-title">Información Personal</p>
        <div className="form-grid">
          <div className={`form-control${errors.nombre ? ' form-control--error' : ''}`}>
            <label>Nombre Completo</label>
            <input name="nombre" value={userForm.nombre} onChange={onUserChange} required maxLength={LIMITS.nombre} placeholder="Nombre completo" aria-invalid={!!errors.nombre} />
            {errors.nombre && <span className="form-control-error">{errors.nombre}</span>}
          </div>
          <div className={`form-control${errors.email ? ' form-control--error' : ''}`}>
            <label>Email</label>
            <input name="email" type="email" value={userForm.email} onChange={onUserChange} required maxLength={LIMITS.email} placeholder="correo@ejemplo.com" aria-invalid={!!errors.email} />
            {errors.email && <span className="form-control-error">{errors.email}</span>}
          </div>
          <div className={`form-control${errors.telefono ? ' form-control--error' : ''}`}>
            <label>Teléfono</label>
            <input name="telefono" value={userForm.telefono} onChange={onUserChange} maxLength={LIMITS.telefono} inputMode="tel" placeholder="8888-8888" aria-invalid={!!errors.telefono} />
            {errors.telefono && <span className="form-control-error">{errors.telefono}</span>}
          </div>
          <div className={`form-control${errors.rol ? ' form-control--error' : ''}`}>
            <label>Rol en el sistema</label>
            <select name="rol" value={userForm.rol} onChange={onUserChange}>
              <option value="ninguno">Ninguno (sin acceso al sistema)</option>
              <option value="trabajador">Trabajador</option>
              <option value="encargado">Encargado</option>
              <option value="supervisor">Supervisor</option>
              <option value="administrador">Administrador</option>
            </select>
            {errors.rol && <span className="form-control-error">{errors.rol}</span>}
          </div>
          <div className={`form-control${errors.cedula ? ' form-control--error' : ''}`}>
            <label>Cédula / Identificación</label>
            <input name="cedula" value={fichaForm.cedula} onChange={onFichaChange} maxLength={LIMITS.cedula} placeholder="1-1234-5678" aria-invalid={!!errors.cedula} />
            {errors.cedula && <span className="form-control-error">{errors.cedula}</span>}
          </div>
        </div>

        <button type="button" className="form-section-title collapsible-section-header" onClick={() => setLaboralCollapsed(v => !v)}>
          <span>Información Laboral</span>
          <span className={`collapsible-chevron${laboralCollapsed ? '' : ' collapsible-chevron--open'}`}>▾</span>
        </button>
        <div className={laboralCollapsed ? 'collapsible-content--hidden' : ''}>
          <div className="form-grid">
            <div className={`form-control${errors.puesto ? ' form-control--error' : ''}`}>
              <label>Puesto</label>
              <input name="puesto" value={fichaForm.puesto} onChange={onFichaChange} maxLength={LIMITS.puesto} placeholder="Ej: Operario de campo" aria-invalid={!!errors.puesto} />
              {errors.puesto && <span className="form-control-error">{errors.puesto}</span>}
            </div>
            <div className={`form-control${errors.departamento ? ' form-control--error' : ''}`}>
              <label>Departamento</label>
              <input name="departamento" value={fichaForm.departamento} onChange={onFichaChange} maxLength={LIMITS.departamento} placeholder="Ej: Producción" aria-invalid={!!errors.departamento} />
              {errors.departamento && <span className="form-control-error">{errors.departamento}</span>}
            </div>
            <div className={`form-control${errors.fechaIngreso ? ' form-control--error' : ''}`}>
              <label>Fecha de Ingreso</label>
              <input name="fechaIngreso" type="date" value={fichaForm.fechaIngreso} onChange={onFichaChange} max={new Date().toISOString().slice(0, 10)} aria-invalid={!!errors.fechaIngreso} />
              {errors.fechaIngreso && <span className="form-control-error">{errors.fechaIngreso}</span>}
            </div>
            <div className={`form-control${errors.tipoContrato ? ' form-control--error' : ''}`}>
              <label>Tipo de Contrato</label>
              <select name="tipoContrato" value={fichaForm.tipoContrato} onChange={onFichaChange}>
                <option value="permanente">Permanente</option>
                <option value="temporal">Temporal</option>
                <option value="por_obra">Por obra</option>
              </select>
              {errors.tipoContrato && <span className="form-control-error">{errors.tipoContrato}</span>}
            </div>
            <div className={`form-control${errors.salarioBase ? ' form-control--error' : ''}`}>
              <label>Salario Base (₡)</label>
              <input name="salarioBase" type="number" min="0" max={SALARIO_MAX} step="any" inputMode="decimal" value={fichaForm.salarioBase} onChange={onFichaChange} placeholder="0" aria-invalid={!!errors.salarioBase} />
              {errors.salarioBase && <span className="form-control-error">{errors.salarioBase}</span>}
            </div>
            <div className={`form-control${errors.precioHora ? ' form-control--error' : ''}`}>
              <label>Precio por Hora (₡)</label>
              <input name="precioHora" type="number" min="0" max={SALARIO_MAX} step="any" inputMode="decimal" value={fichaForm.precioHora} onChange={onFichaChange} placeholder="0" aria-invalid={!!errors.precioHora} />
              {errors.precioHora && <span className="form-control-error">{errors.precioHora}</span>}
            </div>
            <div className="form-control">
              <label>Encargado / Supervisor directo</label>
              <select name="encargadoId" value={fichaForm.encargadoId} onChange={onFichaChange}>
                <option value="">— Sin asignar —</option>
                {encargados.map(e => (
                  <option key={e.id} value={e.id}>{e.nombre} ({ROLE_LABELS[e.rol] || e.rol})</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <button type="button" className="form-section-title collapsible-section-header" onClick={() => setHorarioCollapsed(v => !v)}>
          <span>Horario Semanal</span>
          <span className={`collapsible-chevron${horarioCollapsed ? '' : ' collapsible-chevron--open'}`}>▾</span>
        </button>
        <div className={`horario-grid${horarioCollapsed ? ' horario-grid--hidden' : ''}`}>
          <div className="horario-quickfill">
            <div className="horario-quickfill-inputs">
              <label>Entrada</label>
              <input type="time" value={horarioDefault.inicio} onChange={e => setHorarioDefault(p => ({ ...p, inicio: e.target.value }))} className="horario-time-input" />
              <label>Salida</label>
              <input type="time" value={horarioDefault.fin} onChange={e => setHorarioDefault(p => ({ ...p, fin: e.target.value }))} className="horario-time-input" />
            </div>
            <button type="button" className="btn-aplicar-lv" onClick={onAplicarHorarioLV}>Aplicar L–S</button>
          </div>
          <div className="horario-grid-header">
            <span>Labora</span><span>Entrada</span><span>Salida</span>
          </div>
          {DIAS_SEMANA.map(({ key, letra }) => {
            const dia = fichaForm.horarioSemanal?.[key] || { activo: false, inicio: '', fin: '' };
            const errKey = `horario_${key}`;
            const hasErr = !!errors[errKey];
            return (
              <div key={key} className={`horario-row${dia.activo ? '' : ' horario-row--inactivo'}${hasErr ? ' horario-row--error' : ''}`}>
                <label className="horario-toggle">
                  <input type="checkbox" checked={dia.activo} onChange={e => onHorarioChange(key, 'activo', e.target.checked)} />
                  <span className="horario-toggle-track"><span className="horario-dia-letra">{letra}</span></span>
                </label>
                <div className="horario-times">
                  <input type="time" value={dia.inicio} disabled={!dia.activo} onChange={e => onHorarioChange(key, 'inicio', e.target.value)} className="horario-time-input" />
                  <input type="time" value={dia.fin}    disabled={!dia.activo} onChange={e => onHorarioChange(key, 'fin',   e.target.value)} className="horario-time-input" />
                </div>
                {hasErr && <span className="form-control-error horario-row-error">{errors[errKey]}</span>}
              </div>
            );
          })}
          <div className="horario-total-row">
            <span>Total semanal</span>
            <strong>{(() => { const t = calcHorasSemanales(fichaForm.horarioSemanal); return t > 0 ? `${t % 1 === 0 ? t : t.toFixed(1)} horas/semana` : '—'; })()}</strong>
          </div>
        </div>

        <button type="button" className="form-section-title collapsible-section-header" onClick={() => setContactoCollapsed(v => !v)}>
          <span>Información de Contacto</span>
          <span className={`collapsible-chevron${contactoCollapsed ? '' : ' collapsible-chevron--open'}`}>▾</span>
        </button>
        <div className={contactoCollapsed ? 'collapsible-content--hidden' : ''}>
          <div className="form-grid">
            <div className={`form-control${errors.direccion ? ' form-control--error' : ''}`}>
              <label>Dirección</label>
              <input name="direccion" value={fichaForm.direccion} onChange={onFichaChange} maxLength={LIMITS.direccion} placeholder="Dirección de residencia" aria-invalid={!!errors.direccion} />
              {errors.direccion && <span className="form-control-error">{errors.direccion}</span>}
            </div>
            <div className={`form-control${errors.contactoEmergencia ? ' form-control--error' : ''}`}>
              <label>Contacto de Emergencia</label>
              <input name="contactoEmergencia" value={fichaForm.contactoEmergencia} onChange={onFichaChange} maxLength={LIMITS.contactoEmergencia} placeholder="Nombre" aria-invalid={!!errors.contactoEmergencia} />
              {errors.contactoEmergencia && <span className="form-control-error">{errors.contactoEmergencia}</span>}
            </div>
            <div className={`form-control${errors.telefonoEmergencia ? ' form-control--error' : ''}`}>
              <label>Teléfono Emergencia</label>
              <input name="telefonoEmergencia" value={fichaForm.telefonoEmergencia} onChange={onFichaChange} maxLength={LIMITS.telefonoEmergencia} inputMode="tel" placeholder="8888-8888" aria-invalid={!!errors.telefonoEmergencia} />
              {errors.telefonoEmergencia && <span className="form-control-error">{errors.telefonoEmergencia}</span>}
            </div>
          </div>
        </div>

        <button type="button" className="form-section-title collapsible-section-header" onClick={() => setNotasCollapsed(v => !v)}>
          <span>Notas</span>
          <span className={`collapsible-chevron${notasCollapsed ? '' : ' collapsible-chevron--open'}`}>▾</span>
        </button>
        <div className={notasCollapsed ? 'collapsible-content--hidden' : ''}>
          <div className={`form-control${errors.notas ? ' form-control--error' : ''}`}>
            <textarea name="notas" value={fichaForm.notas} onChange={onFichaChange} maxLength={LIMITS.notas} placeholder="Observaciones generales del trabajador..." aria-invalid={!!errors.notas} />
            <span className="form-control-hint">{(fichaForm.notas || '').length}/{LIMITS.notas}</span>
            {errors.notas && <span className="form-control-error">{errors.notas}</span>}
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
