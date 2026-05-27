import { useState } from 'react';
import { FiPlus } from 'react-icons/fi';
import AuroraConfirmModal from '../../../components/AuroraConfirmModal';

/**
 * NuevoCatalogModal — diálogo para agregar un nuevo valor al catálogo de
 * cosechas o etapas desde dentro del form de grupo. Cuando el usuario
 * selecciona "＋ Nueva cosecha" / "＋ Nueva etapa" en el dropdown del
 * form, este modal aparece, captura el nombre y lo agrega al catálogo
 * local del padre.
 *
 * Extraído de GrupoManagement.jsx como parte del refactor del #12 (12c).
 *
 * Props:
 *   - field      string · 'cosecha' | 'etapa' — controla copy y placeholder
 *   - onConfirm  fn(s)  · invocado con el nombre trimmed cuando se acepta
 *                          (vía botón "Agregar" o Enter en el input)
 *   - onCancel   fn     · invocado al cancelar (también backdrop / Escape,
 *                          gestionados por AuroraConfirmModal)
 */
export default function NuevoCatalogModal({ field, onConfirm, onCancel }) {
  const [nombre, setNombre] = useState('');
  const label       = field === 'cosecha' ? 'cosecha' : 'etapa';
  const placeholder = field === 'cosecha' ? 'Ej. Cosecha I 2024' : 'Ej. Desarrollo';

  return (
    <AuroraConfirmModal
      title={`Nueva ${label}`}
      icon={<FiPlus size={16} />}
      iconVariant="neutral"
      confirmLabel="Agregar"
      confirmDisabled={!nombre.trim()}
      onConfirm={() => onConfirm(nombre.trim())}
      onCancel={onCancel}
    >
      <div className="aur-field">
        <label className="aur-field-label" htmlFor="catalog-nombre">
          Nombre
        </label>
        <input
          id="catalog-nombre"
          className="aur-input"
          placeholder={placeholder}
          value={nombre}
          onChange={e => setNombre(e.target.value)}
          maxLength={32}
          autoFocus
          onKeyDown={e => { if (e.key === 'Enter' && nombre.trim()) onConfirm(nombre.trim()); }}
        />
      </div>
    </AuroraConfirmModal>
  );
}
