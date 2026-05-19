import { useEffect, useMemo, useState } from 'react';
import {
  FiArrowLeft, FiCheck, FiX, FiToggleLeft, FiToggleRight,
  FiEdit2, FiTrash2, FiLock, FiFlag, FiPlus, FiCopy,
} from 'react-icons/fi';
import CamposEditor from './CamposEditor';
import TemplatePreview from './TemplatePreview';
import {
  DEFAULT_CAMPOS as DEFAULT_CAMPOS_FALLBACK,
  MAX_NOMBRE_PLANTILLA,
  validatePayload,
  hasValidationErrors,
} from '../lib/templateShared';

function TemplateDetail({
  tipo,
  isEditing,
  editData,
  onChangeEditData,
  onBack,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onToggleActivo,
  onRequestDelete,
  onDuplicate,
  defaultCampos = DEFAULT_CAMPOS_FALLBACK,
}) {
  const [submitAttempted, setSubmitAttempted] = useState(false);

  // Reset del flag cada vez que entramos o salimos del modo edición —
  // si el usuario vuelve a editar, los errores parten en blanco.
  useEffect(() => { setSubmitAttempted(false); }, [isEditing]);

  const errors = useMemo(() => {
    if (!isEditing || !editData) return null;
    return validatePayload(editData.nombre, editData.campos);
  }, [isEditing, editData]);

  const hasErrors = errors ? hasValidationErrors(errors) : false;
  const showNombreError = submitAttempted && errors?.nombre;
  const camposErrors = submitAttempted && errors ? errors.campos : {};

  const handleSave = () => {
    if (hasErrors) { setSubmitAttempted(true); return; }
    onSaveEdit();
  };

  return (
    <div className="lote-hub">
      <button className="lote-hub-back" onClick={onBack}>
        <FiArrowLeft size={13} /> Todas las plantillas
      </button>

      <div className="hub-header">
        <div className="hub-title-block">
          {isEditing ? (
            <div className="tpl-edit-name-block">
              <div className="tpl-input-with-counter tpl-input-with-counter--wide">
                <input
                  className={`tipo-nombre-input${showNombreError ? ' aur-input--error' : ''}`}
                  value={editData.nombre}
                  onChange={e => onChangeEditData(prev => ({ ...prev, nombre: e.target.value }))}
                  maxLength={MAX_NOMBRE_PLANTILLA}
                  aria-label="Nombre de la plantilla"
                  aria-invalid={!!showNombreError}
                  aria-describedby={showNombreError ? 'tpl-edit-nombre-err' : undefined}
                />
                <span
                  className={`tpl-char-counter${editData.nombre.length > MAX_NOMBRE_PLANTILLA * 0.85 ? ' tpl-char-counter--warn' : ''}`}
                >
                  {editData.nombre.length}/{MAX_NOMBRE_PLANTILLA}
                </span>
              </div>
              {showNombreError && (
                <span id="tpl-edit-nombre-err" className="aur-field-error tpl-row-error">
                  {errors.nombre}
                </span>
              )}
            </div>
          ) : (
            <>
              <h2 className="hub-lote-code">{tipo.nombre}</h2>
              {!tipo.activo && (
                <span
                  className="label-optional"
                  title="No aparece al adjuntar plantillas a paquetes nuevos"
                >
                  (inactiva)
                </span>
              )}
            </>
          )}
        </div>
        <div className="hub-header-actions">
          {isEditing ? (
            <>
              <button
                className="aur-icon-btn aur-icon-btn--sm aur-icon-btn--success"
                onClick={handleSave}
                title="Guardar"
              >
                <FiCheck size={16} />
              </button>
              <button className="aur-icon-btn aur-icon-btn--sm" onClick={onCancelEdit} title="Cancelar"><FiX size={16} /></button>
            </>
          ) : (
            <>
              <button
                className="aur-icon-btn aur-icon-btn--sm"
                onClick={onToggleActivo}
                title={tipo.activo
                  ? 'Desactivar: dejará de aparecer al adjuntar plantillas a paquetes. Los registros existentes no se borran.'
                  : 'Activar: la plantilla volverá a estar disponible para nuevos paquetes.'}
              >
                {tipo.activo
                  ? <FiToggleRight size={18} className="tpl-toggle-active" />
                  : <FiToggleLeft size={18} />}
              </button>
              <button className="aur-icon-btn aur-icon-btn--sm" onClick={onStartEdit} title="Editar"><FiEdit2 size={15} /></button>
              {onDuplicate && (
                <button
                  className="aur-icon-btn aur-icon-btn--sm"
                  onClick={onDuplicate}
                  title="Duplicar: crea una plantilla nueva copiando el nombre y los campos de ésta."
                  aria-label="Duplicar plantilla"
                >
                  <FiCopy size={15} />
                </button>
              )}
              <button className="aur-icon-btn aur-icon-btn--sm aur-icon-btn--danger" onClick={onRequestDelete} title="Eliminar"><FiTrash2 size={15} /></button>
            </>
          )}
        </div>
      </div>

      {isEditing ? (
        <CamposEditor
          campos={editData.campos}
          onChange={campos => onChangeEditData(prev => ({ ...prev, campos }))}
          errors={camposErrors}
          defaultCampos={defaultCampos}
        />
      ) : (
        <div className="tpl-preview">
          <section className="aur-section">
            <div className="aur-section-header">
              <span className="aur-section-num" aria-hidden="true"><FiFlag size={12} /></span>
              <h3>Campos predeterminados</h3>
              <span className="aur-section-count">{defaultCampos.length}</span>
            </div>
            <div className="tpl-chips">
              {defaultCampos.map((c, i) => (
                <span
                  key={`def-${i}`}
                  className="aur-badge aur-badge--gray"
                  title="Campo predeterminado del sistema"
                >
                  <FiLock size={10} /> {c.nombre}
                </span>
              ))}
            </div>
          </section>
          <section className="aur-section">
            <div className="aur-section-header">
              <span className="aur-section-num" aria-hidden="true"><FiPlus size={12} /></span>
              <h3>Campos personalizados</h3>
              <span className="aur-section-count">{(tipo.campos || []).length}</span>
            </div>
            {(tipo.campos || []).length === 0 ? (
              <div className="tpl-empty">Sin campos adicionales</div>
            ) : (
              <div className="tpl-chips">
                {tipo.campos.map((c, i) => (
                  <span key={i} className="aur-badge aur-badge--magenta">
                    {c.nombre}
                  </span>
                ))}
              </div>
            )}
          </section>
          <TemplatePreview campos={tipo.campos || []} defaultCampos={defaultCampos} />
        </div>
      )}
    </div>
  );
}

export default TemplateDetail;
