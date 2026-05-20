import { Children, cloneElement, isValidElement, useId } from 'react';

// AuroraField + thin input wrappers — unifica el patrón
// "label + input + counter + error" reescrito en ~40 archivos con tres
// clases distintas para el borde de error (aur-input--error, fld-error-input,
// ep-field-error) y aria mal conectado.
//
// El wrapper inyecta automáticamente al control hijo (vía cloneElement):
//   - id (autogenerado con useId si no se pasa htmlFor)
//   - aria-invalid si hay error
//   - aria-describedby apuntando al texto de error o hint
//   - clase aur-input--error si hay error
//
// API:
//   <AuroraField
//     label="Nombre"
//     htmlFor="nombre"            // opcional; si no, useId
//     required                    // muestra " *" tras el label
//     hint="Ej. Postforza"        // texto explicativo (se oculta si hay error)
//     error={errors.nombre}       // string | undefined
//     counter={{ value, max }}    // contador opcional, color por umbral
//     layout="stack"              // 'stack' (label arriba) | 'row' (label izq)
//     className=""
//   >
//     <TextInput value={...} onChange={...} maxLength={64} />
//   </AuroraField>

export default function AuroraField({
  label,
  htmlFor,
  required = false,
  hint,
  error,
  counter,
  layout = 'stack',
  className = '',
  children,
}) {
  const generatedId = useId();
  const fieldId = htmlFor || `aur-field-${generatedId}`;
  const errorId = `${fieldId}-err`;
  const hintId  = `${fieldId}-hint`;

  // Buscamos el primer elemento React válido entre los children (el control).
  // Si no hay (caso raro: solo texto/null), renderizamos children tal cual.
  const child = Children.toArray(children).find(isValidElement);
  const enhancedChild = child
    ? cloneElement(child, {
        id: child.props.id || fieldId,
        'aria-invalid': error ? true : child.props['aria-invalid'],
        'aria-describedby': [
          error ? errorId : null,
          hint && !error ? hintId : null,
          child.props['aria-describedby'],
        ].filter(Boolean).join(' ') || undefined,
        className: child.props.className
          ? `${child.props.className}${error ? ' aur-input--error' : ''}`
          : (error ? 'aur-input--error' : undefined),
      })
    : children;

  const counterEl = counter ? (
    <FieldCounter value={counter.value} max={counter.max} />
  ) : null;

  const errorEl = error ? (
    <span id={errorId} className="aur-field-error">{error}</span>
  ) : null;

  const hintEl = (!error && hint) ? (
    <span id={hintId} className="aur-field-hint">{hint}</span>
  ) : null;

  if (layout === 'row') {
    return (
      <div className={`aur-row${(error || counter) ? ' aur-row--multiline' : ''}${className ? ' ' + className : ''}`}>
        {label && (
          <label className="aur-row-label" htmlFor={fieldId}>
            {label}{required && <span aria-hidden="true"> *</span>}
          </label>
        )}
        <div className="aur-row-content">
          {counterEl ? (
            <div className="aur-field-control-wrap">
              {enhancedChild}
              {counterEl}
            </div>
          ) : enhancedChild}
          {errorEl}
          {hintEl}
        </div>
      </div>
    );
  }

  return (
    <div className={`aur-field${className ? ' ' + className : ''}`}>
      {label && (
        <label className="aur-field-label" htmlFor={fieldId}>
          {label}{required && <span aria-hidden="true"> *</span>}
        </label>
      )}
      {counterEl ? (
        <div className="aur-field-control-wrap">
          {enhancedChild}
          {counterEl}
        </div>
      ) : enhancedChild}
      {errorEl}
      {hintEl}
    </div>
  );
}

function FieldCounter({ value, max }) {
  const safeMax = Number(max) || 0;
  const safeVal = Number(value) || 0;
  const ratio = safeMax > 0 ? safeVal / safeMax : 0;
  const variant = ratio >= 1 ? ' aur-field-counter--danger'
    : ratio >= 0.85 ? ' aur-field-counter--warn' : '';
  return (
    <span className={`aur-field-counter${variant}`} aria-live="polite">
      {safeVal}/{safeMax}
    </span>
  );
}

// ── Input wrappers ────────────────────────────────────────────────────────
// Thin wrappers que aplican las clases canónicas .aur-input/.aur-textarea/
// .aur-select. Cuando viven dentro de <AuroraField>, la accesibilidad y la
// clase de error se inyectan automáticamente vía cloneElement.

export function TextInput({ variant, className, ...props }) {
  const variantCls = variant === 'num' ? ' aur-input--num'
    : variant === 'readonly' ? ' aur-input--readonly' : '';
  return (
    <input
      type="text"
      {...props}
      className={`aur-input${variantCls}${className ? ' ' + className : ''}`}
    />
  );
}

export function Textarea({ className, rows = 3, ...props }) {
  return (
    <textarea
      rows={rows}
      {...props}
      className={`aur-textarea${className ? ' ' + className : ''}`}
    />
  );
}

export function Select({ className, children, ...props }) {
  return (
    <select
      {...props}
      className={`aur-select${className ? ' ' + className : ''}`}
    >
      {children}
    </select>
  );
}

export function DateInput({ className, ...props }) {
  return (
    <input
      type="date"
      {...props}
      className={`aur-input${className ? ' ' + className : ''}`}
    />
  );
}

export function NumberInput({ className, ...props }) {
  return (
    <input
      type="number"
      {...props}
      className={`aur-input aur-input--num${className ? ' ' + className : ''}`}
    />
  );
}
