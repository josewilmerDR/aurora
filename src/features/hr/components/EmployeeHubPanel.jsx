import { FiArrowLeft, FiEdit, FiUserX, FiMail, FiPhone, FiKey, FiClock } from 'react-icons/fi';
import { ROLE_LABELS } from '../../../contexts/UserContext';
import { DIAS_SEMANA, calcHorasSemanales, getInitials, formatFechaSalida } from '../lib/employeeProfileShared';

// Panel de detalle (solo lectura) del empleado seleccionado. Renderiza
// secciones condicionalmente según los datos disponibles en la ficha.
export default function EmployeeHubPanel({
  selectedUser,
  fichaForm,
  allUsers,
  onBack,
  onEdit,
  onRequestTerminate,
}) {
  if (!selectedUser) return null;

  const encargado = allUsers.find(u => u.id === fichaForm.encargadoId);
  const tieneLaboral = fichaForm.puesto || fichaForm.departamento || fichaForm.fechaIngreso
    || fichaForm.salarioBase || fichaForm.precioHora || encargado;
  const tieneHorario = DIAS_SEMANA.some(d => fichaForm.horarioSemanal?.[d.key]?.activo);
  const tieneContacto = fichaForm.direccion || fichaForm.contactoEmergencia || fichaForm.telefonoEmergencia;

  // Faceta "usuario del sistema" del empleado. Sólo mostramos el badge
  // adicional cuando es relevante para distinguir del caso "default".
  const isSystemUser = selectedUser.tieneAcceso === true;
  const isActiveEmployee = selectedUser.empleadoPlanilla === true;
  const wasEmployee = !isActiveEmployee && selectedUser.tuvoEmpleo === true;
  const fechaSalida = formatFechaSalida(selectedUser.fechaSalidaPlanilla);
  const motivoSalida = typeof selectedUser.motivoSalidaPlanilla === 'string'
    ? selectedUser.motivoSalidaPlanilla
    : '';

  return (
    <div className="lote-hub">
      <button className="lote-hub-back" onClick={onBack}>
        <FiArrowLeft size={13} /> Todos los empleados
      </button>

      <div className="hub-header">
        <div className="ficha-hub-identity">
          <div className="ficha-avatar">{getInitials(selectedUser.nombre)}</div>
          <div>
            <h2 className="hub-lote-code">{selectedUser.nombre}</h2>
            {isSystemUser ? (
              <span className={`role-badge role-badge--${selectedUser.rol || 'trabajador'}`}>
                <FiKey size={10} /> {ROLE_LABELS[selectedUser.rol] || 'Trabajador'}
              </span>
            ) : (
              <span className="role-badge role-badge--ninguno" title="Esta persona no tiene acceso al sistema">
                Sólo empleado
              </span>
            )}
          </div>
        </div>
        <div className="hub-header-actions">
          <button onClick={onEdit} className="aur-btn-text">
            <FiEdit size={15} /> Editar
          </button>
          {isActiveEmployee && (
            <button
              onClick={() => onRequestTerminate(selectedUser)}
              className="aur-btn-pill aur-btn-pill--danger"
            >
              <FiUserX size={15} /> Rescindir
            </button>
          )}
        </div>
      </div>

      {wasEmployee && (
        <div className="hub-info-pills">
          <span
            className="aur-badge aur-badge--gray"
            title={
              motivoSalida
                ? `Contrato rescindido el ${fechaSalida || 's/f'} — ${motivoSalida}`
                : `Contrato rescindido el ${fechaSalida || 's/f'}`
            }
          >
            <FiClock size={11} /> Ex-empleado{fechaSalida && <> · {fechaSalida}</>}
          </span>
        </div>
      )}

      <div className="hub-info-pills">
        {selectedUser.email    && <span className="hub-pill"><FiMail  size={13} />{selectedUser.email}</span>}
        {selectedUser.telefono && <span className="hub-pill"><FiPhone size={13} />{selectedUser.telefono}</span>}
        {fichaForm.cedula      && <span className="hub-pill hub-pill-muted">CI: {fichaForm.cedula}</span>}
      </div>

      {tieneLaboral && (
        <div className="ficha-hub-section">
          <p className="ficha-hub-section-title">Información Laboral</p>
          <div className="ficha-hub-grid">
            {fichaForm.puesto       && <div className="ficha-hub-item"><span className="ficha-hub-label">Puesto</span><span className="ficha-hub-value">{fichaForm.puesto}</span></div>}
            {fichaForm.departamento && <div className="ficha-hub-item"><span className="ficha-hub-label">Departamento</span><span className="ficha-hub-value">{fichaForm.departamento}</span></div>}
            {fichaForm.fechaIngreso && <div className="ficha-hub-item"><span className="ficha-hub-label">Ingreso</span><span className="ficha-hub-value">{fichaForm.fechaIngreso}</span></div>}
            {fichaForm.tipoContrato && fichaForm.tipoContrato !== 'permanente' && (
              <div className="ficha-hub-item"><span className="ficha-hub-label">Contrato</span><span className="ficha-hub-value">{fichaForm.tipoContrato}</span></div>
            )}
            {fichaForm.salarioBase  && <div className="ficha-hub-item"><span className="ficha-hub-label">Salario Base</span><span className="ficha-hub-value">₡{Number(fichaForm.salarioBase).toLocaleString('es-CR')}</span></div>}
            {fichaForm.precioHora   && <div className="ficha-hub-item"><span className="ficha-hub-label">Precio/Hora</span><span className="ficha-hub-value">₡{Number(fichaForm.precioHora).toLocaleString('es-CR')}</span></div>}
            {encargado              && <div className="ficha-hub-item"><span className="ficha-hub-label">Encargado</span><span className="ficha-hub-value">{encargado.nombre}</span></div>}
          </div>
        </div>
      )}

      {tieneHorario && (
        <div className="ficha-hub-section">
          <p className="ficha-hub-section-title">Horario Semanal</p>
          <div className="ficha-hub-horario">
            {DIAS_SEMANA.map(({ key, letra }) => {
              const dia = fichaForm.horarioSemanal?.[key];
              return (
                <div key={key} className={`ficha-hub-dia${dia?.activo ? ' ficha-hub-dia--activo' : ''}`}>
                  <span className="ficha-hub-dia-letra">{letra}</span>
                  {dia?.activo && <span className="ficha-hub-dia-horas">{dia.inicio}–{dia.fin}</span>}
                </div>
              );
            })}
          </div>
          {(() => {
            const t = calcHorasSemanales(fichaForm.horarioSemanal);
            return t > 0 ? <p className="ficha-hub-total">{t % 1 === 0 ? t : t.toFixed(1)} h/semana</p> : null;
          })()}
        </div>
      )}

      {tieneContacto && (
        <div className="ficha-hub-section">
          <p className="ficha-hub-section-title">Contacto de Emergencia</p>
          <div className="ficha-hub-grid">
            {fichaForm.direccion         && <div className="ficha-hub-item ficha-hub-item--full"><span className="ficha-hub-label">Dirección</span><span className="ficha-hub-value">{fichaForm.direccion}</span></div>}
            {fichaForm.contactoEmergencia && <div className="ficha-hub-item"><span className="ficha-hub-label">Contacto</span><span className="ficha-hub-value">{fichaForm.contactoEmergencia}</span></div>}
            {fichaForm.telefonoEmergencia && <div className="ficha-hub-item"><span className="ficha-hub-label">Teléfono</span><span className="ficha-hub-value">{fichaForm.telefonoEmergencia}</span></div>}
          </div>
        </div>
      )}

      {fichaForm.notas && (
        <div className="ficha-hub-section">
          <p className="ficha-hub-section-title">Notas</p>
          <p className="ficha-hub-notas">{fichaForm.notas}</p>
        </div>
      )}
    </div>
  );
}
