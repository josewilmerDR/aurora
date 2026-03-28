import { useState } from 'react';
import { useApiFetch } from '../hooks/useApiFetch';

const TIPOS = ['Herbicida', 'Fungicida', 'Insecticida', 'Fertilizante', 'Regulador de crecimiento', 'Otro'];
const MONEDAS = ['USD', 'CRC', 'EUR'];

function EditProductoModal({ producto, onClose, onSaved }) {
  const apiFetch = useApiFetch();
  const [form, setForm] = useState({
    idProducto:        producto.idProducto        ?? '',
    nombreComercial:   producto.nombreComercial    ?? '',
    ingredienteActivo: producto.ingredienteActivo  ?? '',
    tipo:              producto.tipo               ?? '',
    plagaQueControla:  producto.plagaQueControla   ?? '',
    periodoReingreso:  producto.periodoReingreso   ?? '',
    periodoACosecha:   producto.periodoACosecha    ?? '',
    cantidadPorHa:     producto.cantidadPorHa      ?? '',
    unidad:            producto.unidad             ?? '',
    stockMinimo:       producto.stockMinimo        ?? '',
    precioUnitario:    producto.precioUnitario      ?? '',
    moneda:                producto.moneda                ?? 'USD',
    tipoCambio:            producto.tipoCambio            ?? 1,
    iva:                   producto.iva                   ?? 0,
    proveedor:             producto.proveedor             ?? '',
    registroFitosanitario: producto.registroFitosanitario ?? '',
    observacion:           producto.observacion           ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const set = (field, value) => setForm(prev => ({ ...prev, [field]: value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.nombreComercial.trim()) {
      setError('El nombre comercial es obligatorio.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/productos/${producto.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          periodoReingreso: form.periodoReingreso !== '' ? Number(form.periodoReingreso) : 0,
          periodoACosecha:  form.periodoACosecha  !== '' ? Number(form.periodoACosecha)  : 0,
          cantidadPorHa:    form.cantidadPorHa    !== '' ? Number(form.cantidadPorHa)    : 0,
          stockMinimo:      form.stockMinimo      !== '' ? Number(form.stockMinimo)      : 0,
          precioUnitario:   form.precioUnitario   !== '' ? Number(form.precioUnitario)   : 0,
          tipoCambio:       form.tipoCambio       !== '' ? Number(form.tipoCambio)       : 1,
          iva:              form.iva              !== '' ? Number(form.iva)              : 0,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Error al guardar');
      onSaved();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content edit-producto-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Editar producto</h2>
          <button className="modal-close-btn" onClick={onClose}>✕</button>
        </div>

        <form className="edit-producto-form" onSubmit={handleSubmit}>
          {/* Identificación */}
          <div className="ep-section-title">Identificación</div>
          <div className="ep-grid">
            <div className="ep-field">
              <label>ID Producto</label>
              <input value={form.idProducto} onChange={e => set('idProducto', e.target.value)} placeholder="Ej: AGR-001" />
            </div>
            <div className="ep-field ep-field-wide">
              <label>Nombre Comercial <span className="toma-required">*</span></label>
              <input value={form.nombreComercial} onChange={e => set('nombreComercial', e.target.value)} placeholder="Nombre del producto" required />
            </div>
            <div className="ep-field ep-field-wide">
              <label>Ingrediente Activo</label>
              <input value={form.ingredienteActivo} onChange={e => set('ingredienteActivo', e.target.value)} placeholder="Ej: Glifosato 48%" />
            </div>
            <div className="ep-field">
              <label>Tipo</label>
              <select value={form.tipo} onChange={e => set('tipo', e.target.value)}>
                <option value="">— Seleccionar —</option>
                {TIPOS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="ep-field ep-field-wide">
              <label>Proveedor</label>
              <input value={form.proveedor} onChange={e => set('proveedor', e.target.value)} placeholder="Nombre del proveedor" />
            </div>
            <div className="ep-field">
              <label>No. Registro Fitosanitario</label>
              <input value={form.registroFitosanitario} onChange={e => set('registroFitosanitario', e.target.value)} placeholder="Ej. B-0123" />
            </div>
            <div className="ep-field ep-field-wide">
              <label>Observación</label>
              <input value={form.observacion} onChange={e => set('observacion', e.target.value)} placeholder="Notas sobre el producto" />
            </div>
          </div>

          {/* Uso agronómico */}
          <div className="ep-section-title">Uso agronómico</div>
          <div className="ep-grid">
            <div className="ep-field ep-field-wide">
              <label>Plaga / Enfermedad que controla</label>
              <input value={form.plagaQueControla} onChange={e => set('plagaQueControla', e.target.value)} placeholder="Ej: Botrytis, maleza hoja ancha…" />
            </div>
            <div className="ep-field">
              <label>Dosis por Ha</label>
              <input type="number" min="0" step="0.01" value={form.cantidadPorHa} onChange={e => set('cantidadPorHa', e.target.value)} placeholder="0" />
            </div>
            <div className="ep-field">
              <label>Unidad</label>
              <input value={form.unidad} onChange={e => set('unidad', e.target.value)} placeholder="Ej: L, kg, cc" />
            </div>
            <div className="ep-field">
              <label>Período reingreso (h)</label>
              <input type="number" min="0" step="1" value={form.periodoReingreso} onChange={e => set('periodoReingreso', e.target.value)} placeholder="0" />
            </div>
            <div className="ep-field">
              <label>Período a cosecha (días)</label>
              <input type="number" min="0" step="1" value={form.periodoACosecha} onChange={e => set('periodoACosecha', e.target.value)} placeholder="0" />
            </div>
          </div>

          {/* Inventario y costo */}
          <div className="ep-section-title">Inventario y costo</div>
          <div className="ep-grid">
            <div className="ep-field">
              <label>Stock mínimo</label>
              <input type="number" min="0" step="0.01" value={form.stockMinimo} onChange={e => set('stockMinimo', e.target.value)} placeholder="0" />
            </div>
            <div className="ep-field">
              <label>Precio unitario</label>
              <input type="number" min="0" step="0.01" value={form.precioUnitario} onChange={e => set('precioUnitario', e.target.value)} placeholder="0.00" />
            </div>
            <div className="ep-field">
              <label>Moneda</label>
              <select value={form.moneda} onChange={e => set('moneda', e.target.value)}>
                {MONEDAS.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div className="ep-field">
              <label>Tipo de cambio</label>
              <input type="number" min="0" step="0.01" value={form.tipoCambio} onChange={e => set('tipoCambio', e.target.value)} placeholder="1" />
            </div>
            <div className="ep-field">
              <label>IVA (%)</label>
              <input type="number" min="0" step="0.01" value={form.iva} onChange={e => set('iva', e.target.value)} placeholder="0" />
            </div>
          </div>

          {error && <p className="toma-error">{error}</p>}

          <div className="toma-fisica-footer">
            <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>
              Cancelar
            </button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'Guardando…' : 'Guardar cambios'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default EditProductoModal;
