import { useState, useRef } from 'react';
import {
  FiPlus, FiTrash2, FiChevronUp, FiChevronDown, FiMove, FiLock,
  FiFlag,
} from 'react-icons/fi';
import AuroraConfirmModal from '../../../components/AuroraConfirmModal';
import TemplatePreview from './TemplatePreview';
import {
  TIPO_OPTIONS,
  DEFAULT_CAMPOS as DEFAULT_CAMPOS_FALLBACK,
  MAX_NOMBRE_CAMPO,
  emptyCampo,
} from '../lib/templateShared';

function CamposEditor({
  campos,
  onChange,
  disabled,
  errors = {},
  defaultCampos = DEFAULT_CAMPOS_FALLBACK,
}) {
  const dragIdx = useRef(null);
  const [dragOverIdx, setDragOverIdx] = useState(null);
  const [confirmRemoveIdx, setConfirmRemoveIdx] = useState(null);

  const addCampo = () => onChange([...campos, emptyCampo()]);
  const doRemoveCampo = (i) => onChange(campos.filter((_, idx) => idx !== i));
  const requestRemoveCampo = (i) => {
    // Sólo confirma si el campo ya tiene nombre (datos perdibles).
    if ((campos[i]?.nombre || '').trim()) setConfirmRemoveIdx(i);
    else doRemoveCampo(i);
  };
  const updateCampo = (i, key, val) =>
    onChange(campos.map((c, idx) => idx === i ? { ...c, [key]: val } : c));

  // Fallback de reorden para entornos sin drag-and-drop (touch / mobile)
  const moveCampo = (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= campos.length) return;
    const next = [...campos];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };

  const handleDragStart = (e, i) => {
    dragIdx.current = i;
    e.dataTransfer.effectAllowed = 'move';
  };
  const handleDragEnter = (i) => {
    if (dragIdx.current !== null && dragIdx.current !== i) setDragOverIdx(i);
  };
  const handleDragOver = (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; };
  const handleDrop = (e, i) => {
    e.preventDefault();
    const from = dragIdx.current;
    dragIdx.current = null;
    setDragOverIdx(null);
    if (from === null || from === i) return;
    const reordered = [...campos];
    const [moved] = reordered.splice(from, 1);
    reordered.splice(i, 0, moved);
    onChange(reordered);
  };
  const handleDragEnd = () => { dragIdx.current = null; setDragOverIdx(null); };

  return (
    <>
      <section className="aur-section">
        <div className="aur-section-header">
          <span className="aur-section-num" aria-hidden="true"><FiFlag size={12} /></span>
          <h3>Campos predeterminados</h3>
          <span className="aur-section-count">{defaultCampos.length}</span>
        </div>
        <p className="tpl-campos-hint">
          Estos campos vienen siempre en todo registro de muestreo y no se pueden editar.
        </p>
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
          <span className="aur-section-count">{campos.length}</span>
        </div>
        {campos.length > 0 && (
          <ul className="tpl-campos-list">
            {campos.map((campo, i) => {
              const len = (campo.nombre || '').length;
              const warn = len > MAX_NOMBRE_CAMPO * 0.85;
              const error = errors[i];
              return (
                <li
                  key={i}
                  className={`tpl-campo-card${dragOverIdx === i ? ' is-dragover' : ''}${error ? ' has-error' : ''}`}
                  draggable={!disabled}
                  onDragStart={e => handleDragStart(e, i)}
                  onDragEnter={() => handleDragEnter(i)}
                  onDragOver={handleDragOver}
                  onDrop={e => handleDrop(e, i)}
                  onDragEnd={handleDragEnd}
                >
                  <div className="tpl-campo-row">
                    <span className="tpl-campo-handle" title="Arrastrar para reordenar">
                      <FiMove size={13} />
                    </span>
                    <div className="tpl-input-with-counter">
                      <input
                        className={`aur-input tpl-campo-name${error ? ' aur-input--error' : ''}`}
                        value={campo.nombre}
                        onChange={e => updateCampo(i, 'nombre', e.target.value)}
                        placeholder="Nombre del campo"
                        maxLength={MAX_NOMBRE_CAMPO}
                        disabled={disabled}
                        aria-label="Nombre del campo"
                        aria-invalid={!!error}
                        aria-describedby={error ? `tpl-campo-err-${i}` : undefined}
                      />
                      <span className={`tpl-char-counter${warn ? ' tpl-char-counter--warn' : ''}`}>
                        {len}/{MAX_NOMBRE_CAMPO}
                      </span>
                    </div>
                    <select
                      className="aur-chip"
                      value={campo.tipo}
                      onChange={e => updateCampo(i, 'tipo', e.target.value)}
                      disabled={disabled}
                      aria-label="Tipo"
                    >
                      {TIPO_OPTIONS.map(o => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="aur-icon-btn aur-icon-btn--sm"
                      onClick={() => moveCampo(i, -1)}
                      disabled={disabled || i === 0}
                      title="Subir"
                      aria-label="Subir campo"
                    >
                      <FiChevronUp size={13} />
                    </button>
                    <button
                      type="button"
                      className="aur-icon-btn aur-icon-btn--sm"
                      onClick={() => moveCampo(i, 1)}
                      disabled={disabled || i === campos.length - 1}
                      title="Bajar"
                      aria-label="Bajar campo"
                    >
                      <FiChevronDown size={13} />
                    </button>
                    <button
                      type="button"
                      className="aur-icon-btn aur-icon-btn--sm aur-icon-btn--danger"
                      onClick={() => requestRemoveCampo(i)}
                      disabled={disabled}
                      title="Eliminar campo"
                    >
                      <FiTrash2 size={13} />
                    </button>
                  </div>
                  {error && (
                    <span
                      id={`tpl-campo-err-${i}`}
                      className="aur-field-error tpl-campo-error"
                    >
                      {error}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <button
          type="button"
          className="pkg-add-activity"
          onClick={addCampo}
          disabled={disabled}
        >
          <FiPlus size={14} /> Agregar campo
        </button>
      </section>

      <TemplatePreview campos={campos} defaultCampos={defaultCampos} />

      {confirmRemoveIdx !== null && (
        <AuroraConfirmModal
          danger
          title="Eliminar campo"
          body={`¿Eliminar el campo "${(campos[confirmRemoveIdx]?.nombre || '').trim()}"? Perderás su configuración.`}
          confirmLabel="Eliminar"
          onConfirm={() => { doRemoveCampo(confirmRemoveIdx); setConfirmRemoveIdx(null); }}
          onCancel={() => setConfirmRemoveIdx(null)}
        />
      )}
    </>
  );
}

export default CamposEditor;
