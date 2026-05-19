import { useMemo, useState } from 'react';
import AuroraConfirmModal from '../../../components/AuroraConfirmModal';

// Modal de rescisión de contrato — disparado desde el hub de EmployeeProfile.
// Espejo del UserDeleteWithEmploymentModal pero invertido: aquí siempre se
// rescinde el contrato (acción primaria), y opcionalmente se le quita
// también el acceso al sistema. La acción nunca borra registros HR ni el
// doc users (lo veda el backend cuando tuvoEmpleo=true).
const TODAY_ISO = () => new Date().toISOString().slice(0, 10);

export default function EmployeeTerminationModal({
  user,
  loading = false,
  onCancel,
  onConfirm,
}) {
  const [motivo, setMotivo] = useState('');
  const [fechaSalida, setFechaSalida] = useState(TODAY_ISO());
  const [tambienQuitarAcceso, setTambienQuitarAcceso] = useState(false);
  const [nombreTyped, setNombreTyped] = useState('');

  const expected = (user?.nombre || '').trim();
  const matches = useMemo(
    () => expected.length > 0 && nombreTyped.trim().toLowerCase() === expected.toLowerCase(),
    [nombreTyped, expected],
  );
  const tieneAcceso = user?.tieneAcceso === true;

  const handleConfirm = () => {
    onConfirm?.({
      motivo: motivo.trim(),
      fechaSalida,
      tambienQuitarAcceso: tieneAcceso && tambienQuitarAcceso,
    });
  };

  const confirmLabel = tieneAcceso && tambienQuitarAcceso
    ? 'Rescindir contrato y quitar acceso'
    : 'Rescindir contrato';

  return (
    <AuroraConfirmModal
      danger
      size="wide"
      title="Rescindir contrato laboral"
      body={
        <>
          Vas a rescindir el contrato de <strong>{user?.nombre || 'la persona'}</strong>.
          Los registros laborales (asistencia, permisos, planillas previas) se
          conservan para auditoría y cumplimiento legal.
        </>
      }
      confirmLabel={confirmLabel}
      confirmDisabled={!matches}
      loading={loading}
      loadingLabel="Procesando…"
      onConfirm={handleConfirm}
      onCancel={onCancel}
    >
      <div className="emp-term-modal">
        <div className="emp-term-row">
          <label className="emp-term-label" htmlFor="emp-term-motivo">
            Motivo (opcional)
          </label>
          <input
            id="emp-term-motivo"
            className="aur-input"
            type="text"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            maxLength={200}
            placeholder="Ej: renuncia voluntaria, fin de contrato, despido…"
            disabled={loading}
          />
        </div>

        <div className="emp-term-row">
          <label className="emp-term-label" htmlFor="emp-term-fecha">
            Fecha de salida
          </label>
          <input
            id="emp-term-fecha"
            className="aur-input"
            type="date"
            value={fechaSalida}
            onChange={(e) => setFechaSalida(e.target.value)}
            max={TODAY_ISO()}
            disabled={loading}
          />
        </div>

        {tieneAcceso && (
          <label className="emp-term-toggle">
            <input
              type="checkbox"
              checked={tambienQuitarAcceso}
              onChange={(e) => setTambienQuitarAcceso(e.target.checked)}
              disabled={loading}
            />
            <span>Quitar también el acceso al sistema</span>
          </label>
        )}

        <div className="emp-term-row">
          <label className="emp-term-label" htmlFor="emp-term-nombre">
            Para confirmar, escribe el nombre completo:
          </label>
          <input
            id="emp-term-nombre"
            className={`aur-input${nombreTyped && !matches ? ' aur-input--error' : ''}`}
            type="text"
            value={nombreTyped}
            onChange={(e) => setNombreTyped(e.target.value)}
            placeholder={expected}
            autoComplete="off"
            disabled={loading}
          />
          <span className="emp-term-hint">
            Debe coincidir con: <strong>{expected}</strong>
          </span>
        </div>
      </div>
    </AuroraConfirmModal>
  );
}
