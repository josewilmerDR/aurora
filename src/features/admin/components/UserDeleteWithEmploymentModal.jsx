import { useMemo, useState } from 'react';
import AuroraConfirmModal from '../../../components/AuroraConfirmModal';

// Modal usado cuando se intenta "eliminar" desde UserManagement a una persona
// que también está registrada como empleado (o lo fue alguna vez). Combina
// dos acciones en un mismo flujo:
//
//   1. Revocar acceso al sistema (default, sin typing).
//   2. Rescindir además el contrato laboral (opcional, requiere tipear el
//      nombre completo como confirmación de la acción destructiva).
//
// onConfirm recibe { rescindirContrato, motivo, fechaSalida } — el padre
// decide qué endpoints invocar según el estado real del usuario y esos flags.
const TODAY_ISO = () => new Date().toISOString().slice(0, 10);

export default function UserDeleteWithEmploymentModal({
  user,
  loading = false,
  onCancel,
  onConfirm,
}) {
  const [rescindirContrato, setRescindirContrato] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [fechaSalida, setFechaSalida] = useState(TODAY_ISO());
  const [nombreTyped, setNombreTyped] = useState('');

  const expected = (user?.nombre || '').trim();
  const matches = useMemo(
    () => expected.length > 0 && nombreTyped.trim().toLowerCase() === expected.toLowerCase(),
    [nombreTyped, expected],
  );

  const confirmDisabled = rescindirContrato && !matches;
  const confirmLabel = rescindirContrato
    ? 'Quitar acceso y rescindir contrato'
    : 'Quitar acceso al sistema';

  const handleConfirm = () => {
    onConfirm?.({
      rescindirContrato,
      motivo: motivo.trim(),
      fechaSalida,
    });
  };

  return (
    <AuroraConfirmModal
      danger
      size="wide"
      title="Esta persona también es empleado"
      body={
        <>
          <strong>{user?.nombre || 'La persona'}</strong> está registrada como empleado
          en la finca. Por defecto sólo se le quitará el acceso al sistema; seguirá listada
          como empleado en planilla.
        </>
      }
      confirmLabel={confirmLabel}
      confirmDisabled={confirmDisabled}
      loading={loading}
      loadingLabel="Procesando…"
      onConfirm={handleConfirm}
      onCancel={onCancel}
    >
      <div className="usr-delete-employment">
        <label className="usr-delete-toggle">
          <input
            type="checkbox"
            checked={rescindirContrato}
            onChange={(e) => setRescindirContrato(e.target.checked)}
            disabled={loading}
          />
          <span>Rescindir también el contrato laboral (despedir)</span>
        </label>

        {rescindirContrato && (
          <div className="usr-delete-rescision">
            <div className="usr-delete-row">
              <label className="usr-delete-label" htmlFor="usr-del-motivo">
                Motivo (opcional)
              </label>
              <input
                id="usr-del-motivo"
                className="aur-input"
                type="text"
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                maxLength={200}
                placeholder="Ej: renuncia voluntaria, fin de contrato, despido…"
                disabled={loading}
              />
            </div>

            <div className="usr-delete-row">
              <label className="usr-delete-label" htmlFor="usr-del-fecha">
                Fecha de salida
              </label>
              <input
                id="usr-del-fecha"
                className="aur-input"
                type="date"
                value={fechaSalida}
                onChange={(e) => setFechaSalida(e.target.value)}
                max={TODAY_ISO()}
                disabled={loading}
              />
            </div>

            <div className="usr-delete-row">
              <label className="usr-delete-label" htmlFor="usr-del-nombre">
                Para confirmar, escribe el nombre completo:
              </label>
              <input
                id="usr-del-nombre"
                className={`aur-input${nombreTyped && !matches ? ' aur-input--error' : ''}`}
                type="text"
                value={nombreTyped}
                onChange={(e) => setNombreTyped(e.target.value)}
                placeholder={expected}
                autoComplete="off"
                disabled={loading}
              />
              <span className="usr-delete-hint">
                Debe coincidir con: <strong>{expected}</strong>
              </span>
            </div>
          </div>
        )}
      </div>
    </AuroraConfirmModal>
  );
}
