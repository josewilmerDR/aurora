import { useState } from 'react';
import { FiClock, FiCheckCircle } from 'react-icons/fi';
import AuroraConfirmModal from '../../../components/AuroraConfirmModal';
import { useApiFetch } from '../../../hooks/useApiFetch';

// Tipos válidos en el backend (functions/routes/hr/fichas.js → PERMISO_TIPOS).
// Solo `permiso_sin_goce` descuenta de la planilla; los demás se registran
// como trazabilidad sin impacto en el cálculo.
const TIPOS = [
  { value: 'permiso_sin_goce', label: 'Permiso sin goce (descuenta)', conGoce: false },
  { value: 'permiso_con_goce', label: 'Permiso con goce',             conGoce: true  },
  { value: 'vacaciones',       label: 'Vacaciones',                   conGoce: true  },
  { value: 'enfermedad',       label: 'Enfermedad',                   conGoce: true  },
  { value: 'licencia',         label: 'Licencia',                     conGoce: true  },
];

const MOTIVO_MAX = 500;

function calcDias(inicio, fin) {
  if (!inicio || !fin) return 1;
  const ms = new Date(fin) - new Date(inicio);
  if (!Number.isFinite(ms)) return 1;
  return Math.max(1, Math.round(ms / 86400000) + 1);
}

function calcHoras(hi, hf) {
  if (!hi || !hf) return 0;
  const [h1, m1] = hi.split(':').map(Number);
  const [h2, m2] = hf.split(':').map(Number);
  return Math.max(0, Math.round(((h2 * 60 + m2) - (h1 * 60 + m1)) / 60 * 10) / 10);
}

/**
 * Modal en-página para registrar un permiso/ausencia desde la planilla fija.
 *
 * Usa los endpoints existentes `/api/hr/permisos` (POST → pendiente) y, si
 * `autoApprove` es true, `PUT /api/hr/permisos/:id` (estado: aprobado). De
 * esta forma no se duplica lógica ni se rompe la trazabilidad — el descuento
 * en planilla sigue derivándose de `hr_permisos` como cualquier otro caso.
 *
 * Props:
 *   - trabajador     {id, nombre}
 *   - defaultFecha   'YYYY-MM-DD' — día a pre-seleccionar
 *   - periodoInicio  'YYYY-MM-DD' — límite inferior para inputs date
 *   - periodoFin     'YYYY-MM-DD' — límite superior para inputs date
 *   - autoApprove    bool — si el usuario actual puede aprobar
 *   - onSuccess      (result) => void — { autoApproved: bool }
 *   - onCancel       () => void
 *   - showToast      (msg, type?) => void
 */
export default function RegisterPermisoModal({
  trabajador,
  defaultFecha,
  periodoInicio,
  periodoFin,
  autoApprove,
  onSuccess,
  onCancel,
  showToast,
}) {
  const apiFetch = useApiFetch();
  const [tipo, setTipo]             = useState('permiso_sin_goce');
  const [esParcial, setEsParcial]   = useState(false);
  const [fInicio, setFInicio]       = useState(defaultFecha);
  const [fFin, setFFin]             = useState(defaultFecha);
  const [horaInicio, setHoraInicio] = useState('08:00');
  const [horaFin, setHoraFin]       = useState('12:00');
  const [motivo, setMotivo]         = useState('');
  const [submitting, setSubmitting] = useState(false);

  const dias  = calcDias(fInicio, fFin);
  const horas = calcHoras(horaInicio, horaFin);

  const validate = () => {
    if (!fInicio) return 'Seleccione una fecha.';
    if (fInicio < periodoInicio || fInicio > periodoFin) {
      return 'La fecha debe estar dentro del período de la planilla.';
    }
    if (esParcial) {
      if (horas <= 0) return 'La hora fin debe ser posterior a la hora inicio.';
      if (horas > 24) return 'Las horas no pueden exceder 24.';
    } else {
      if (!fFin) return 'Seleccione la fecha fin.';
      if (fFin < fInicio) return 'La fecha fin no puede ser anterior a la inicial.';
      if (fFin > periodoFin) return 'La fecha fin debe estar dentro del período.';
      if (dias > 365) return 'El rango no puede exceder 365 días.';
    }
    if (motivo.length > MOTIVO_MAX) return `El motivo no puede exceder ${MOTIVO_MAX} caracteres.`;
    return null;
  };

  const handleConfirm = async () => {
    const err = validate();
    if (err) { showToast(err, 'error'); return; }
    const tipoCfg = TIPOS.find(t => t.value === tipo);
    const payload = {
      trabajadorId: trabajador.id,
      trabajadorNombre: trabajador.nombre || '',
      tipo,
      fechaInicio: fInicio,
      motivo: motivo.trim(),
      conGoce: tipoCfg?.conGoce ?? true,
      esParcial,
      ...(esParcial
        ? { fechaFin: fInicio, dias: 0, horas, horaInicio, horaFin }
        : { fechaFin: fFin, dias, horas: 0, horaInicio: null, horaFin: null }),
    };

    setSubmitting(true);
    try {
      const res = await apiFetch('/api/hr/permisos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) { showToast('Error al registrar el permiso.', 'error'); return; }
      const { id } = await res.json();

      let autoApproved = false;
      if (autoApprove) {
        const r2 = await apiFetch(`/api/hr/permisos/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ estado: 'aprobado' }),
        });
        autoApproved = r2.ok;
        if (!r2.ok) {
          showToast('Permiso creado, pero no se pudo aprobar automáticamente.', 'error');
        }
      }

      onSuccess({ autoApproved });
    } catch {
      showToast('Error al registrar el permiso.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuroraConfirmModal
      size="wide"
      title={`Registrar permiso — ${trabajador.nombre}`}
      body={autoApprove
        ? 'Se registrará y aprobará el permiso. Aplicará inmediatamente al cálculo de esta planilla.'
        : 'Se registrará como pendiente. Aplicará a la planilla cuando un supervisor lo apruebe.'}
      confirmLabel={autoApprove ? 'Registrar y aprobar' : 'Registrar como pendiente'}
      icon={<FiCheckCircle size={16} />}
      loading={submitting}
      onConfirm={handleConfirm}
      onCancel={onCancel}
    >
      <div className="planilla-permiso-form">
        <div className="form-control">
          <label>Tipo</label>
          <select value={tipo} onChange={e => setTipo(e.target.value)}>
            {TIPOS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>

        <label className="planilla-permiso-toggle">
          <input type="checkbox" checked={esParcial} onChange={e => setEsParcial(e.target.checked)} />
          <FiClock size={13} /> Solo unas horas de un día
        </label>

        <div className="planilla-permiso-row">
          <div className="form-control">
            <label>{esParcial ? 'Fecha' : 'Fecha inicio'}</label>
            <input
              type="date"
              value={fInicio}
              min={periodoInicio}
              max={periodoFin}
              onChange={e => setFInicio(e.target.value)}
            />
          </div>
          {!esParcial ? (
            <div className="form-control">
              <label>Fecha fin</label>
              <input
                type="date"
                value={fFin}
                min={fInicio || periodoInicio}
                max={periodoFin}
                onChange={e => setFFin(e.target.value)}
              />
            </div>
          ) : (
            <>
              <div className="form-control">
                <label>Hora inicio</label>
                <input type="time" value={horaInicio} onChange={e => setHoraInicio(e.target.value)} />
              </div>
              <div className="form-control">
                <label>Hora fin</label>
                <input type="time" value={horaFin} onChange={e => setHoraFin(e.target.value)} />
              </div>
            </>
          )}
        </div>

        <div className="form-control">
          <label>Motivo (opcional)</label>
          <input
            type="text"
            value={motivo}
            maxLength={MOTIVO_MAX}
            placeholder="Ej.: autorizado por el encargado de cuadrilla"
            onChange={e => setMotivo(e.target.value)}
          />
        </div>
      </div>
    </AuroraConfirmModal>
  );
}
