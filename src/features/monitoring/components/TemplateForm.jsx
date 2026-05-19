import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { FiPlus, FiX } from 'react-icons/fi';
import CamposEditor from './CamposEditor';
import {
  MAX_NOMBRE_PLANTILLA,
  validatePayload,
  hasValidationErrors,
} from '../lib/templateShared';

function TemplateForm({ nuevoTipo, onChange, onCancel, onSave, defaultCampos }) {
  const [submitAttempted, setSubmitAttempted] = useState(false);

  const len = (nuevoTipo.nombre || '').length;
  const warn = len > MAX_NOMBRE_PLANTILLA * 0.85;

  const errors = useMemo(
    () => validatePayload(nuevoTipo.nombre, nuevoTipo.campos),
    [nuevoTipo.nombre, nuevoTipo.campos]
  );
  const hasErrors = hasValidationErrors(errors);
  const showNombreError = submitAttempted && errors.nombre;
  // Errores por campo sólo después del primer intento de guardar.
  const camposErrors = submitAttempted ? errors.campos : {};

  const handleSave = () => {
    if (hasErrors) { setSubmitAttempted(true); return; }
    onSave();
  };

  return createPortal(
    <div className="aur-modal-backdrop" onPointerDown={onCancel}>
      <div
        className="aur-modal aur-modal--lg tpl-form-modal"
        onPointerDown={e => e.stopPropagation()}
      >
        <div className="aur-modal-header">
          <span className="aur-modal-icon"><FiPlus size={16} /></span>
          <h2 className="aur-modal-title">Nueva plantilla de muestreo</h2>
          <button
            type="button"
            className="aur-icon-btn aur-icon-btn--sm aur-modal-close"
            onClick={onCancel}
            aria-label="Cerrar"
            title="Cerrar"
          >
            <FiX size={16} />
          </button>
        </div>

        <div className="aur-modal-content">
          <div className="aur-list">
            <div className="aur-row">
              <label className="aur-row-label" htmlFor="tpl-nombre">Nombre</label>
              <div className="tpl-input-with-counter">
                <input
                  id="tpl-nombre"
                  className={`aur-input${showNombreError ? ' aur-input--error' : ''}`}
                  value={nuevoTipo.nombre}
                  onChange={e => onChange(prev => ({ ...prev, nombre: e.target.value }))}
                  placeholder="Ej: Muestreo de pH"
                  maxLength={MAX_NOMBRE_PLANTILLA}
                  autoFocus
                  aria-invalid={!!showNombreError}
                  aria-describedby={showNombreError ? 'tpl-nombre-err' : undefined}
                />
                <span className={`tpl-char-counter${warn ? ' tpl-char-counter--warn' : ''}`}>
                  {len}/{MAX_NOMBRE_PLANTILLA}
                </span>
              </div>
              {showNombreError && (
                <span id="tpl-nombre-err" className="aur-field-error tpl-row-error">
                  {errors.nombre}
                </span>
              )}
            </div>
          </div>

          <CamposEditor
            campos={nuevoTipo.campos}
            onChange={campos => onChange(prev => ({ ...prev, campos }))}
            errors={camposErrors}
            defaultCampos={defaultCampos}
          />
        </div>

        <div className="aur-modal-actions">
          <button type="button" className="aur-btn-text" onClick={onCancel}>Cancelar</button>
          <button type="button" className="aur-btn-pill" onClick={handleSave}>
            Crear plantilla
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

export default TemplateForm;
