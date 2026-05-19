import { FiEye } from 'react-icons/fi';
import { DEFAULT_CAMPOS as DEFAULT_CAMPOS_FALLBACK } from '../lib/templateShared';

const EXAMPLE_TEXTO_BY_NAME = {
  'Muestreador': 'Juan Pérez',
  'Supervisor':  'María Rojas',
  'Lote':        'Lote A-3',
  'Grupo':       'G-1',
  'Notas':       'Sin novedad',
};

const EXAMPLE_FECHA_BY_NAME = {
  'F. Programada': '2026-05-18',
  'F. Muestreo':   '2026-05-20',
};

function previewValue(campo) {
  if (campo.tipo === 'fecha')  return EXAMPLE_FECHA_BY_NAME[campo.nombre] || '2026-05-18';
  if (campo.tipo === 'numero') return '12.5';
  return EXAMPLE_TEXTO_BY_NAME[campo.nombre] || 'Ejemplo';
}

/**
 * TemplatePreview — sección "Vista previa del registro" compartida entre
 * CamposEditor (modo edit/new) y TemplateDetail (modo lectura). Renderiza
 * un formulario read-only con valores de ejemplo realistas para que el
 * usuario vea cómo se verá el form al momento de hacer un muestreo.
 */
function TemplatePreview({ campos = [], defaultCampos = DEFAULT_CAMPOS_FALLBACK }) {
  const all = [...defaultCampos, ...campos];
  return (
    <section className="aur-section">
      <div className="aur-section-header">
        <span className="aur-section-num" aria-hidden="true"><FiEye size={12} /></span>
        <h3>Vista previa del registro</h3>
        <span className="aur-section-count">{all.length}</span>
      </div>
      <p className="tpl-campos-hint">Así se verá el formulario al registrar un muestreo.</p>
      <div className="tpl-form-preview">
        {all.map((c, i) => {
          const isDefault = i < defaultCampos.length;
          const inputType = c.tipo === 'numero' ? 'number' : c.tipo === 'fecha' ? 'date' : 'text';
          const hasName = !!(c.nombre || '').trim();
          return (
            <div key={i} className={`tpl-form-preview-field${isDefault ? ' tpl-form-preview-field--default' : ''}`}>
              <label className="tpl-form-preview-label">
                {hasName ? c.nombre : <em>Sin nombre</em>}
              </label>
              <input
                className="aur-input tpl-form-preview-input"
                type={inputType}
                readOnly
                tabIndex={-1}
                value={hasName ? previewValue(c) : ''}
                placeholder={hasName ? '' : '—'}
              />
            </div>
          );
        })}
      </div>
    </section>
  );
}

export default TemplatePreview;
