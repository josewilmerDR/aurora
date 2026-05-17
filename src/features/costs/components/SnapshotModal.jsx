import { useState } from 'react';
import { FiCamera } from 'react-icons/fi';
import AuroraConfirmModal from '../../../components/AuroraConfirmModal';

/**
 * Modal de captura para guardar un snapshot del estado actual de costos.
 *
 * Pide nombre + tipo. El select "tipo" tiene 2 opciones (Manual / Mensual)
 * cuyo significado no es obvio sin contexto, así que el `<label>` lleva un
 * hint inline y cada `<option>` se acompaña de una línea de descripción
 * arriba (no se puede agregar tooltip a `<option>` de forma fiable cross-
 * browser). El usuario nuevo entiende qué está eligiendo sin tener que
 * abrir documentación.
 *
 * Props:
 *   - onClose  fn   · cierra el modal sin guardar
 *   - onSave   fn   · (nombre, tipo) → Promise. El padre decide qué hacer.
 *   - saving   bool · deshabilita botones y backdrop mientras está en flight
 */

const TIPO_DESCRIPCIONES = {
  manual:  'Manual: copia puntual del estado actual. La tomás cuando querés.',
  mensual: 'Mensual: marcala como cierre del mes para reportes históricos.',
};

export default function SnapshotModal({ onClose, onSave, saving }) {
  const [nombre, setNombre] = useState('');
  const [tipo, setTipo] = useState('manual');

  return (
    <AuroraConfirmModal
      title="Guardar snapshot"
      icon={<FiCamera size={16} />}
      iconVariant="neutral"
      confirmLabel="Guardar"
      loadingLabel="Guardando…"
      loading={saving}
      confirmDisabled={!nombre.trim()}
      onConfirm={() => onSave(nombre.trim(), tipo)}
      onCancel={onClose}
    >
      <div className="aur-field">
        <label className="aur-field-label" htmlFor="snap-nombre">Nombre</label>
        <input
          id="snap-nombre"
          className="aur-input"
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          placeholder="Ej: Cierre Marzo 2026"
          autoFocus
        />
      </div>
      <div className="aur-field">
        <label className="aur-field-label" htmlFor="snap-tipo">Tipo</label>
        <select
          id="snap-tipo"
          className="aur-select"
          value={tipo}
          onChange={(e) => setTipo(e.target.value)}
        >
          <option value="manual">Manual</option>
          <option value="mensual">Mensual</option>
        </select>
        <p className="aur-field-hint">{TIPO_DESCRIPCIONES[tipo]}</p>
      </div>
    </AuroraConfirmModal>
  );
}
