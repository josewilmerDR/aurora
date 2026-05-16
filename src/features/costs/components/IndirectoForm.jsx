import { useState } from 'react';
import { FiPlus } from 'react-icons/fi';

/**
 * Form de quick-add para costos indirectos (mantenimiento, administrativo,
 * otro). Captura `fecha`, `categoria`, `descripcion` (opcional) y `monto`
 * en una sola fila inline: el orden coincide con el de las filas del
 * listado (fecha → categoría → descripción → monto → acción) para que el
 * usuario asocie input y resultado de un vistazo.
 *
 * Props:
 *   - categorias  array · [{ value, label }, …] de categorías permitidas
 *   - onSubmit    fn    · (data) => Promise|void. Recibe { fecha, categoria,
 *                         descripcion, monto } con monto ya parseado a Number.
 *                         Si la promesa resuelve OK, el form se limpia.
 */

const INITIAL = { fecha: '', categoria: '', descripcion: '', monto: '' };

export default function IndirectoForm({ categorias, onSubmit }) {
  const [form, setForm] = useState(() => ({
    ...INITIAL,
    categoria: categorias[0]?.value || '',
  }));
  const [submitting, setSubmitting] = useState(false);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const canSubmit = !!form.fecha && !!form.monto && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await onSubmit({
        fecha: form.fecha,
        categoria: form.categoria,
        descripcion: form.descripcion,
        monto: parseFloat(form.monto),
      });
      setForm({ ...INITIAL, categoria: categorias[0]?.value || '' });
    } catch {
      // El padre decide cómo notificar el error; acá sólo dejamos los datos
      // del form intactos para que el usuario pueda reintentar sin re-tipear.
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="cost-ind-form">
      <div className="aur-field">
        <label className="aur-field-label" htmlFor="ind-fecha">Fecha</label>
        <input
          id="ind-fecha"
          type="date"
          className="aur-input"
          value={form.fecha}
          onChange={(e) => set('fecha', e.target.value)}
        />
      </div>
      <div className="aur-field">
        <label className="aur-field-label" htmlFor="ind-categoria">Categoría</label>
        <select
          id="ind-categoria"
          className="aur-select"
          value={form.categoria}
          onChange={(e) => set('categoria', e.target.value)}
        >
          {categorias.map((c) => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </select>
      </div>
      <div className="aur-field cost-ind-form-desc">
        <label className="aur-field-label" htmlFor="ind-desc">
          Descripción <span className="aur-field-label-hint">(opcional)</span>
        </label>
        <input
          id="ind-desc"
          className="aur-input"
          value={form.descripcion}
          onChange={(e) => set('descripcion', e.target.value)}
          placeholder="Ej: Cambio de aceite tractor 02"
        />
      </div>
      <div className="aur-field">
        <label className="aur-field-label" htmlFor="ind-monto">Monto</label>
        <input
          id="ind-monto"
          type="number"
          className="aur-input aur-input--num"
          value={form.monto}
          onChange={(e) => set('monto', e.target.value)}
          placeholder="0.00"
        />
      </div>
      <button
        type="button"
        className="aur-btn-pill aur-btn-pill--sm cost-ind-form-submit"
        onClick={handleSubmit}
        disabled={!canSubmit}
      >
        <FiPlus size={14} /> {submitting ? 'Agregando…' : 'Agregar'}
      </button>
    </div>
  );
}
