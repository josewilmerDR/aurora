import { useState, useRef } from 'react';
import { useBlurValidation } from '../../../hooks/useBlurValidation';

// Validación a nivel de campo, single source of truth para los dos formularios
// que crean una organización: el step-2 de Register y la página
// /nueva-organizacion. Antes vivía duplicada en Register y NewOrganization no
// validaba nada (solo `required` HTML) — el form se desincronizaba.
export function validateFincaStep(form) {
  const errs = {};
  if (!(form.fincaNombre || '').trim()) errs.fincaNombre = 'Ingresa el nombre de tu organización.';
  if (!(form.nombreAdmin || '').trim()) errs.nombreAdmin = 'Ingresa tu nombre.';
  return errs;
}

/**
 * Formulario compartido para crear una organización (nombre de la org + nombre
 * del admin). Es presentacional: el padre orquesta la creación vía `onSubmit`,
 * que recibe los valores YA trimmeados. El padre controla `submitting` (para
 * mantener el estado de carga incluso después de un submit exitoso, mientras
 * navega) y `error` (mensaje de página ya traducido al español).
 *
 * Maneja por su cuenta: validación on-blur, ARIA de error, trim, doble-submit
 * y el autofocus del primer campo.
 */
export default function FincaForm({
  onSubmit,
  submitting = false,
  error = '',
  onDirty,
  submitLabel = 'Crear organización',
  submittingLabel = 'Creando organización...',
}) {
  const [fincaNombre, setFincaNombre] = useState('');
  const [nombreAdmin, setNombreAdmin] = useState('');
  const { fieldErrors, blurField, clearField, validateAll, inputClass } = useBlurValidation(validateFincaStep);
  // Lock síncrono anti doble-submit. El prop `submitting` no se actualiza entre
  // dos clics en el mismo tick, así que dos disparos rápidos podían pasar ambos
  // el guard y emitir dos requests. El ref bloquea en el primer clic. El backend
  // ya dedupea register-finca (idempotencia transaccional), pero esto evita el
  // request redundante en origen.
  const inFlightRef = useRef(false);

  const form = { fincaNombre, nombreAdmin };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (submitting || inFlightRef.current) return;
    const trimmed = { fincaNombre: fincaNombre.trim(), nombreAdmin: nombreAdmin.trim() };
    if (!validateAll(trimmed)) return;
    inFlightRef.current = true;
    try {
      onSubmit(trimmed);
    } finally {
      // onSubmit es async pero no lo esperamos aquí; el padre controla `submitting`
      // para el resto del ciclo. Liberamos el lock en el próximo tick para cubrir
      // solo la ráfaga de clics sincrónicos sin quedar trabados si onSubmit lanza
      // de forma síncrona.
      setTimeout(() => { inFlightRef.current = false; }, 0);
    }
  };

  const handleChange = (setter, field) => (e) => {
    setter(e.target.value);
    clearField(field);
    onDirty?.(); // permite al padre limpiar el error de página al corregir
  };

  return (
    <form onSubmit={handleSubmit} className="auth-form" noValidate aria-busy={submitting}>
      <div className="aur-field">
        <label htmlFor="finca-nombre" className="aur-field-label">Nombre de tu organización</label>
        <input
          id="finca-nombre"
          type="text"
          className={inputClass('fincaNombre')}
          value={fincaNombre}
          onChange={handleChange(setFincaNombre, 'fincaNombre')}
          onBlur={() => blurField('fincaNombre', form)}
          placeholder="Ej: Hacienda El Sol"
          maxLength={120}
          disabled={submitting}
          autoFocus
          aria-invalid={!!fieldErrors.fincaNombre}
          aria-describedby={fieldErrors.fincaNombre ? 'finca-nombre-error' : undefined}
          required
        />
        {fieldErrors.fincaNombre && (
          <span id="finca-nombre-error" className="aur-field-error">{fieldErrors.fincaNombre}</span>
        )}
      </div>
      <div className="aur-field">
        <label htmlFor="nombre-admin" className="aur-field-label">Tu nombre</label>
        <input
          id="nombre-admin"
          type="text"
          className={inputClass('nombreAdmin')}
          value={nombreAdmin}
          onChange={handleChange(setNombreAdmin, 'nombreAdmin')}
          onBlur={() => blurField('nombreAdmin', form)}
          placeholder="Ej: Carlos Mendoza"
          maxLength={80}
          disabled={submitting}
          aria-invalid={!!fieldErrors.nombreAdmin}
          aria-describedby={fieldErrors.nombreAdmin ? 'nombre-admin-error' : undefined}
          required
        />
        {fieldErrors.nombreAdmin && (
          <span id="nombre-admin-error" className="aur-field-error">{fieldErrors.nombreAdmin}</span>
        )}
      </div>
      {error && <p className="auth-error" role="alert">{error}</p>}
      <button
        type="submit"
        className="aur-btn-pill auth-btn-submit"
        disabled={submitting || !fincaNombre.trim() || !nombreAdmin.trim()}
      >
        {submitting ? submittingLabel : submitLabel}
      </button>
    </form>
  );
}
