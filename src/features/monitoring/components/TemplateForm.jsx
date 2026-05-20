import { useMemo, useState } from 'react';
import { FiPlus } from 'react-icons/fi';
import AuroraFormModal from '../../../components/AuroraFormModal';
import AuroraField, { TextInput } from '../../../components/AuroraField';
import CamposEditor from './CamposEditor';
import {
  MAX_NOMBRE_PLANTILLA,
  validatePayload,
  hasValidationErrors,
} from '../lib/templateShared';

function TemplateForm({ nuevoTipo, onChange, onCancel, onSave, defaultCampos }) {
  const [submitAttempted, setSubmitAttempted] = useState(false);

  const errors = useMemo(
    () => validatePayload(nuevoTipo.nombre, nuevoTipo.campos),
    [nuevoTipo.nombre, nuevoTipo.campos]
  );
  const hasErrors = hasValidationErrors(errors);
  const showNombreError = submitAttempted && errors.nombre;
  // Errores por campo sólo después del primer intento de guardar.
  const camposErrors = submitAttempted ? errors.campos : {};

  const handleSubmit = () => {
    if (hasErrors) { setSubmitAttempted(true); return; }
    onSave();
  };

  return (
    <AuroraFormModal
      title="Nueva plantilla de muestreo"
      icon={<FiPlus size={16} />}
      size="lg"
      className="tpl-form-modal"
      onClose={onCancel}
      onSubmit={handleSubmit}
      submitLabel="Crear plantilla"
    >
      <div className="aur-list">
        <AuroraField
          label="Nombre"
          htmlFor="tpl-nombre"
          layout="row"
          error={showNombreError ? errors.nombre : undefined}
          counter={{ value: (nuevoTipo.nombre || '').length, max: MAX_NOMBRE_PLANTILLA }}
        >
          <TextInput
            value={nuevoTipo.nombre}
            onChange={e => onChange(prev => ({ ...prev, nombre: e.target.value }))}
            placeholder="Ej: Muestreo de pH"
            maxLength={MAX_NOMBRE_PLANTILLA}
            autoFocus
          />
        </AuroraField>
      </div>

      <CamposEditor
        campos={nuevoTipo.campos}
        onChange={campos => onChange(prev => ({ ...prev, campos }))}
        errors={camposErrors}
        defaultCampos={defaultCampos}
      />
    </AuroraFormModal>
  );
}

export default TemplateForm;
