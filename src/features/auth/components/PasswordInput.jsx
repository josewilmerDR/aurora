import { useState } from 'react';
import { FiEye, FiEyeOff } from 'react-icons/fi';

export default function PasswordInput({
  id,
  value,
  onChange,
  onBlur,
  className = 'aur-input',
  placeholder,
  autoComplete = 'current-password',
  autoFocus = false,
  disabled = false,
  required = false,
  'aria-invalid': ariaInvalid,
  'aria-describedby': ariaDescribedBy,
}) {
  const [show, setShow] = useState(false);
  const [capsLock, setCapsLock] = useState(false);

  // Caps Lock activado es la causa #1 de "contraseña incorrecta" en desktop;
  // avisamos antes de que el usuario queme intentos hasta el too-many-requests.
  const checkCapsLock = (e) => {
    if (typeof e.getModifierState === 'function') {
      setCapsLock(e.getModifierState('CapsLock'));
    }
  };

  return (
    <>
      <div className="auth-input-wrap">
        <input
          id={id}
          type={show ? 'text' : 'password'}
          className={className}
          value={value}
          onChange={onChange}
          onBlur={onBlur}
          onKeyUp={checkCapsLock}
          onKeyDown={checkCapsLock}
          placeholder={placeholder}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          disabled={disabled}
          required={required}
          aria-invalid={ariaInvalid}
          aria-describedby={ariaDescribedBy}
        />
        <button
          type="button"
          className="auth-input-action"
          onClick={() => setShow((v) => !v)}
          disabled={disabled}
          aria-label={show ? 'Ocultar contraseña' : 'Mostrar contraseña'}
        >
          {show ? <FiEyeOff size={16} /> : <FiEye size={16} />}
        </button>
      </div>
      {capsLock && (
        <span className="auth-capslock-hint" role="status">
          Bloq Mayús está activado
        </span>
      )}
    </>
  );
}
