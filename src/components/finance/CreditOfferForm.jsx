import { useState, useEffect } from 'react';
import { FiSave, FiX } from 'react-icons/fi';

// Para "ofertas personales" un banco típicamente cotiza un monto, plazo y tasa
// específicos. El backend guarda rangos (min/max) — acá presentamos un solo
// valor por campo y replicamos min=max al enviar.

const EMPTY = {
  id: null,
  providerName: '',
  providerType: 'banco',
  tipo: 'agricola',
  esquemaAmortizacion: 'cuota_fija',
  moneda: 'USD',
  monto: '',
  plazoMeses: '',
  aprPct: '',
  activo: true,
  descripcion: '',
};

function toForm(doc) {
  if (!doc) return EMPTY;
  const aprDecimal = Number(doc.aprMin ?? doc.aprMax ?? 0);
  return {
    id: doc.id || null,
    providerName: doc.providerName || '',
    providerType: doc.providerType || 'banco',
    tipo: doc.tipo || 'agricola',
    esquemaAmortizacion: doc.esquemaAmortizacion || 'cuota_fija',
    moneda: doc.moneda || 'USD',
    monto: doc.monedaMin != null ? String(doc.monedaMin) : '',
    plazoMeses: doc.plazoMesesMin != null ? String(doc.plazoMesesMin) : '',
    aprPct: Number.isFinite(aprDecimal) ? String(+(aprDecimal * 100).toFixed(2)) : '',
    activo: doc.activo !== false,
    descripcion: doc.descripcion || '',
  };
}

function CreditOfferForm({ initial, onSubmit, onCancel, saving }) {
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState(null);

  useEffect(() => { setForm(toForm(initial)); setError(null); }, [initial]);

  const update = (field) => (e) => {
    const val = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setForm(prev => ({ ...prev, [field]: val }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    setError(null);

    const monto = Number(form.monto);
    const plazo = Number(form.plazoMeses);
    const aprPct = Number(form.aprPct);

    if (!form.providerName.trim()) { setError('Ingresá el nombre del proveedor.'); return; }
    if (!Number.isFinite(monto) || monto <= 0) { setError('Monto debe ser mayor a 0.'); return; }
    if (!Number.isInteger(plazo) || plazo < 1 || plazo > 60) { setError('Plazo debe ser un entero entre 1 y 60 meses.'); return; }
    if (!Number.isFinite(aprPct) || aprPct < 0 || aprPct > 80) { setError('Tasa (APR) debe estar entre 0 y 80 %.'); return; }

    const apr = +(aprPct / 100).toFixed(6);
    const payload = {
      id: form.id,
      providerName: form.providerName.trim(),
      providerType: form.providerType,
      tipo: form.tipo,
      esquemaAmortizacion: form.esquemaAmortizacion,
      moneda: form.moneda,
      monedaMin: monto,
      monedaMax: monto,
      plazoMesesMin: plazo,
      plazoMesesMax: plazo,
      aprMin: apr,
      aprMax: apr,
      activo: form.activo,
      descripcion: form.descripcion.trim() || null,
      fuente: 'manual',
    };
    onSubmit(payload);
  };

  return (
    <form className="lote-form-card" onSubmit={handleSubmit}>
      <div className="finance-form-grid">
        <div className="finance-field finance-field-full">
          <label>Proveedor *</label>
          <input
            type="text"
            value={form.providerName}
            onChange={update('providerName')}
            placeholder="Ej: Banco Nacional, Coopenae…"
            required
          />
        </div>

        <div className="finance-field">
          <label>Tipo de proveedor</label>
          <select value={form.providerType} onChange={update('providerType')}>
            <option value="banco">Banco</option>
            <option value="cooperativa">Cooperativa</option>
            <option value="microfinanciera">Microfinanciera</option>
            <option value="fintech">Fintech</option>
          </select>
        </div>

        <div className="finance-field">
          <label>Tipo de crédito</label>
          <select value={form.tipo} onChange={update('tipo')}>
            <option value="agricola">Agrícola</option>
            <option value="capital_trabajo">Capital de trabajo</option>
            <option value="leasing">Leasing</option>
            <option value="rotativo">Rotativo</option>
          </select>
        </div>

        <div className="finance-field">
          <label>Monto ofertado *</label>
          <input
            type="number"
            min="1"
            step="0.01"
            value={form.monto}
            onChange={update('monto')}
            required
          />
        </div>

        <div className="finance-field">
          <label>Moneda</label>
          <select value={form.moneda} onChange={update('moneda')}>
            <option value="USD">USD</option>
            <option value="CRC">CRC</option>
          </select>
        </div>

        <div className="finance-field">
          <label>Plazo (meses) *</label>
          <input
            type="number"
            min="1"
            max="60"
            step="1"
            value={form.plazoMeses}
            onChange={update('plazoMeses')}
            required
          />
        </div>

        <div className="finance-field">
          <label>Tasa APR (%) *</label>
          <input
            type="number"
            min="0"
            max="80"
            step="0.01"
            value={form.aprPct}
            onChange={update('aprPct')}
            placeholder="Ej: 14.5"
            required
          />
        </div>

        <div className="finance-field">
          <label>Esquema de amortización</label>
          <select value={form.esquemaAmortizacion} onChange={update('esquemaAmortizacion')}>
            <option value="cuota_fija">Cuota fija (francés)</option>
            <option value="amortizacion_constante">Amortización constante</option>
            <option value="bullet">Bullet (capital al vencimiento)</option>
          </select>
        </div>

        <div className="finance-field">
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 18 }}>
            <input type="checkbox" checked={form.activo} onChange={update('activo')} />
            <span>Oferta activa (disponible para simular)</span>
          </label>
        </div>

        <div className="finance-field finance-field-full">
          <label>Notas</label>
          <textarea
            rows="3"
            value={form.descripcion}
            onChange={update('descripcion')}
            placeholder="Condiciones específicas, requisitos, fecha de cotización…"
          />
        </div>
      </div>

      {error && (
        <div className="finance-empty" style={{ color: 'var(--aurora-magenta)', marginTop: 10 }}>
          {error}
        </div>
      )}

      <div className="lote-form-actions">
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={saving}>
          <FiX /> Cancelar
        </button>
        <button type="submit" className="btn-primary" disabled={saving}>
          <FiSave /> {saving ? 'Guardando…' : 'Guardar oferta'}
        </button>
      </div>
    </form>
  );
}

export default CreditOfferForm;
