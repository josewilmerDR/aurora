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
    <form onSubmit={handleSubmit} noValidate>
      <section className="aur-section">
        <div className="aur-section-header">
          <span className="aur-section-num">01</span>
          <h3 className="aur-section-title">Proveedor</h3>
        </div>
        <div className="aur-list">
          <div className="aur-row">
            <label className="aur-row-label" htmlFor="co-provider">Proveedor</label>
            <input
              id="co-provider"
              type="text"
              className="aur-input"
              value={form.providerName}
              onChange={update('providerName')}
              placeholder="Ej: Banco Nacional, Coopenae…"
              required
            />
          </div>
          <div className="aur-row">
            <label className="aur-row-label" htmlFor="co-providertype">Tipo de proveedor</label>
            <select
              id="co-providertype"
              className="aur-select"
              value={form.providerType}
              onChange={update('providerType')}
            >
              <option value="banco">Banco</option>
              <option value="cooperativa">Cooperativa</option>
              <option value="microfinanciera">Microfinanciera</option>
              <option value="fintech">Fintech</option>
            </select>
          </div>
          <div className="aur-row">
            <label className="aur-row-label" htmlFor="co-tipo">Tipo de crédito</label>
            <select
              id="co-tipo"
              className="aur-select"
              value={form.tipo}
              onChange={update('tipo')}
            >
              <option value="agricola">Agrícola</option>
              <option value="capital_trabajo">Capital de trabajo</option>
              <option value="leasing">Leasing</option>
              <option value="rotativo">Rotativo</option>
            </select>
          </div>
        </div>
      </section>

      <section className="aur-section">
        <div className="aur-section-header">
          <span className="aur-section-num">02</span>
          <h3 className="aur-section-title">Términos</h3>
        </div>
        <div className="aur-list">
          <div className="aur-row">
            <label className="aur-row-label" htmlFor="co-monto">Monto ofertado</label>
            <input
              id="co-monto"
              type="number"
              className="aur-input aur-input--num"
              min="1"
              step="0.01"
              value={form.monto}
              onChange={update('monto')}
              required
            />
          </div>
          <div className="aur-row">
            <label className="aur-row-label" htmlFor="co-moneda">Moneda</label>
            <select
              id="co-moneda"
              className="aur-select"
              value={form.moneda}
              onChange={update('moneda')}
            >
              <option value="USD">USD</option>
              <option value="CRC">CRC</option>
            </select>
          </div>
          <div className="aur-row">
            <label className="aur-row-label" htmlFor="co-plazo">Plazo (meses)</label>
            <input
              id="co-plazo"
              type="number"
              className="aur-input aur-input--num"
              min="1"
              max="60"
              step="1"
              value={form.plazoMeses}
              onChange={update('plazoMeses')}
              required
            />
          </div>
          <div className="aur-row">
            <label className="aur-row-label" htmlFor="co-apr">Tasa APR (%)</label>
            <input
              id="co-apr"
              type="number"
              className="aur-input aur-input--num"
              min="0"
              max="80"
              step="0.01"
              value={form.aprPct}
              onChange={update('aprPct')}
              placeholder="Ej: 14.5"
              required
            />
          </div>
          <div className="aur-row">
            <label className="aur-row-label" htmlFor="co-esquema">Esquema de amortización</label>
            <select
              id="co-esquema"
              className="aur-select"
              value={form.esquemaAmortizacion}
              onChange={update('esquemaAmortizacion')}
            >
              <option value="cuota_fija">Cuota fija (francés)</option>
              <option value="amortizacion_constante">Amortización constante</option>
              <option value="bullet">Bullet (capital al vencimiento)</option>
            </select>
          </div>
        </div>
      </section>

      <section className="aur-section">
        <div className="aur-section-header">
          <span className="aur-section-num">03</span>
          <h3 className="aur-section-title">Disponibilidad y notas</h3>
        </div>
        <div className="aur-list">
          <div className="aur-row">
            <span className="aur-row-label">Oferta activa</span>
            <label className="aur-toggle">
              <input
                type="checkbox"
                checked={form.activo}
                onChange={update('activo')}
              />
              <span className="aur-toggle-track">
                <span className="aur-toggle-thumb" />
              </span>
              <span className="aur-toggle-label">
                {form.activo ? 'Disponible para simular' : 'Inactiva'}
              </span>
            </label>
          </div>
          <div className="aur-row aur-row--multiline">
            <label className="aur-row-label" htmlFor="co-descripcion">Notas</label>
            <textarea
              id="co-descripcion"
              className="aur-textarea"
              rows="3"
              value={form.descripcion}
              onChange={update('descripcion')}
              placeholder="Condiciones específicas, requisitos, fecha de cotización…"
            />
          </div>
        </div>
      </section>

      {error && (
        <div className="aur-row aur-row--multiline">
          <span className="aur-field-error">{error}</span>
        </div>
      )}

      <div className="aur-form-actions">
        <button type="button" className="aur-btn-text" onClick={onCancel} disabled={saving}>
          <FiX /> Cancelar
        </button>
        <button type="submit" className="aur-btn-pill" disabled={saving}>
          <FiSave /> {saving ? 'Guardando…' : 'Guardar oferta'}
        </button>
      </div>
    </form>
  );
}

export default CreditOfferForm;
