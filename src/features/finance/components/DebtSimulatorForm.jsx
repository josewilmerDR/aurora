import { useState, useEffect, useMemo } from 'react';
import { FiPlay, FiX, FiChevronDown, FiChevronRight } from 'react-icons/fi';
import { formatMoney } from '../../../lib/formatMoney';

// Form del simulador de deuda. La oferta define amount/plazo/APR (min=max en
// nuestra UI de ofertas personales) — acá el usuario solo aporta el useCase,
// que es lo que realmente hace útil la simulación.

const USECASE_TIPOS = [
  { value: 'compra_insumos',  label: 'Compra de insumos',   hint: 'Fertilizantes, plaguicidas, etc.' },
  { value: 'siembra',         label: 'Siembra',             hint: 'Expansión de hectáreas o renovación.' },
  { value: 'infraestructura', label: 'Infraestructura',     hint: 'Riego, galpón, maquinaria fija.' },
  { value: 'liquidez',        label: 'Liquidez operativa',  hint: 'Capital de trabajo sin retorno directo.' },
];

const RETURN_KINDS = [
  { value: 'linear',          label: 'Retorno lineal',        hint: 'Ingreso adicional constante desde el mes 0.' },
  { value: 'delayed_revenue', label: 'Retorno diferido',      hint: 'Ingreso adicional que arranca en un mes futuro.' },
  { value: 'cost_reduction',  label: 'Reducción de costo',    hint: 'Ahorro mensual en costos operativos.' },
  { value: 'none',            label: 'Sin retorno directo',   hint: 'Capital de trabajo / emergencia. La simulación solo verá el costo del crédito.' },
];

const EMPTY = {
  snapshotId: '',
  creditProductId: '',
  useCaseTipo: 'compra_insumos',
  useCaseDetalle: '',
  returnKind: 'linear',
  monthlyIncrease: '',
  monthlyCostReduction: '',
  startMonth: '0',
  horizonteMeses: 12,
  nTrials: 500,
  seed: 1,
};

function DebtSimulatorForm({ snapshots, offers, onSubmit, onCancel, submitting }) {
  const [form, setForm] = useState(EMPTY);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    setForm(prev => ({
      ...prev,
      snapshotId: prev.snapshotId || snapshots[0]?.id || '',
      creditProductId: prev.creditProductId || offers[0]?.id || '',
    }));
  }, [snapshots, offers]);

  const selectedOffer = useMemo(
    () => offers.find(o => o.id === form.creditProductId) || null,
    [offers, form.creditProductId],
  );

  const update = (field) => (e) => {
    setForm(prev => ({ ...prev, [field]: e.target.value }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    setError(null);

    if (!form.snapshotId) { setError('Seleccioná un snapshot financiero.'); return; }
    if (!form.creditProductId) { setError('Seleccioná una oferta de crédito.'); return; }
    if (!selectedOffer) { setError('La oferta seleccionada no existe.'); return; }

    const expectedReturnModel = { kind: form.returnKind };
    if (form.returnKind === 'linear') {
      const v = Number(form.monthlyIncrease);
      if (!Number.isFinite(v) || v <= 0) { setError('Ingreso mensual esperado debe ser > 0.'); return; }
      expectedReturnModel.monthlyIncrease = v;
      expectedReturnModel.startMonth = 0;
    } else if (form.returnKind === 'delayed_revenue') {
      const v = Number(form.monthlyIncrease);
      const s = Number(form.startMonth);
      if (!Number.isFinite(v) || v <= 0) { setError('Ingreso mensual esperado debe ser > 0.'); return; }
      if (!Number.isInteger(s) || s < 0 || s >= Number(form.horizonteMeses)) {
        setError('Mes de inicio debe estar entre 0 y el horizonte.'); return;
      }
      expectedReturnModel.monthlyIncrease = v;
      expectedReturnModel.startMonth = s;
    } else if (form.returnKind === 'cost_reduction') {
      const v = Number(form.monthlyCostReduction);
      if (!Number.isFinite(v) || v <= 0) { setError('Reducción mensual esperada debe ser > 0.'); return; }
      expectedReturnModel.monthlyCostReduction = v;
      expectedReturnModel.startMonth = 0;
    }

    const payload = {
      snapshotId: form.snapshotId,
      creditProductId: form.creditProductId,
      amount: Number(selectedOffer.monedaMin),
      plazoMeses: Number(selectedOffer.plazoMesesMin),
      apr: Number(selectedOffer.aprMin),
      useCase: {
        tipo: form.useCaseTipo,
        detalle: form.useCaseDetalle.trim() || null,
        expectedReturnModel,
      },
      horizonteMeses: Number(form.horizonteMeses) || 12,
      nTrials: Number(form.nTrials) || 500,
      seed: Number(form.seed) || 1,
    };
    onSubmit(payload);
  };

  const useCaseHint = USECASE_TIPOS.find(t => t.value === form.useCaseTipo)?.hint;

  return (
    <form onSubmit={handleSubmit} noValidate>
      <section className="aur-section">
        <div className="aur-section-header">
          <span className="aur-section-num">01</span>
          <h3 className="aur-section-title">Insumos</h3>
        </div>
        <div className="aur-list">
          <div className="aur-row">
            <label className="aur-row-label" htmlFor="ds-snapshot">Snapshot financiero</label>
            <select
              id="ds-snapshot"
              className="aur-select"
              value={form.snapshotId}
              onChange={update('snapshotId')}
              required
              disabled={!snapshots.length}
            >
              {!snapshots.length && <option value="">No hay snapshots — creá uno primero</option>}
              {snapshots.map(s => (
                <option key={s.id} value={s.id}>
                  {s.asOf} — margen {(Number(s.netMargin) * 100).toFixed(1)}%
                </option>
              ))}
            </select>
          </div>
          <div className="aur-row">
            <label className="aur-row-label" htmlFor="ds-offer">Oferta de crédito</label>
            <select
              id="ds-offer"
              className="aur-select"
              value={form.creditProductId}
              onChange={update('creditProductId')}
              required
              disabled={!offers.length}
            >
              {!offers.length && <option value="">No hay ofertas activas — registrá una primero</option>}
              {offers.map(o => (
                <option key={o.id} value={o.id}>
                  {o.providerName} — {formatMoney(o.monedaMin, o.moneda, { decimals: 0 })} · {o.plazoMesesMin}m · {(Number(o.aprMin) * 100).toFixed(1)}%
                </option>
              ))}
            </select>
          </div>
        </div>
        {selectedOffer && (
          <div className="debt-sim-offer-summary">
            <div>
              <span className="debt-sim-offer-label">Monto</span>
              <strong>{formatMoney(selectedOffer.monedaMin, selectedOffer.moneda, { decimals: 0 })}</strong>
            </div>
            <div>
              <span className="debt-sim-offer-label">Plazo</span>
              <strong>{selectedOffer.plazoMesesMin} meses</strong>
            </div>
            <div>
              <span className="debt-sim-offer-label">APR</span>
              <strong>{(Number(selectedOffer.aprMin) * 100).toFixed(2)}%</strong>
            </div>
            <div>
              <span className="debt-sim-offer-label">Esquema</span>
              <strong>{selectedOffer.esquemaAmortizacion}</strong>
            </div>
          </div>
        )}
      </section>

      <section className="aur-section">
        <div className="aur-section-header">
          <span className="aur-section-num">02</span>
          <h3 className="aur-section-title">Destino y retorno</h3>
        </div>
        <div className="aur-list">
          <div className="aur-row aur-row--multiline">
            <label className="aur-row-label" htmlFor="ds-usecase">Destino del crédito</label>
            <select
              id="ds-usecase"
              className="aur-select"
              value={form.useCaseTipo}
              onChange={update('useCaseTipo')}
            >
              {USECASE_TIPOS.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
            {useCaseHint && <span className="aur-field-hint">{useCaseHint}</span>}
          </div>
          <div className="aur-row">
            <label className="aur-row-label" htmlFor="ds-detalle">Detalle (opcional)</label>
            <input
              id="ds-detalle"
              type="text"
              className="aur-input"
              value={form.useCaseDetalle}
              onChange={update('useCaseDetalle')}
              placeholder="Ej: Expansión de 10 ha de chile dulce en lote norte."
            />
          </div>
        </div>

        <div className="aur-row aur-row--multiline">
          <span className="aur-row-label">Modelo de retorno esperado</span>
          <div className="debt-sim-radio-group" role="radiogroup" aria-label="Modelo de retorno esperado">
            {RETURN_KINDS.map(r => (
              <label
                key={r.value}
                className={`debt-sim-radio${form.returnKind === r.value ? ' debt-sim-radio--active' : ''}`}
              >
                <input
                  type="radio"
                  name="returnKind"
                  value={r.value}
                  checked={form.returnKind === r.value}
                  onChange={update('returnKind')}
                />
                <div>
                  <strong>{r.label}</strong>
                  <span>{r.hint}</span>
                </div>
              </label>
            ))}
          </div>
        </div>

        {(form.returnKind === 'linear' || form.returnKind === 'delayed_revenue') && (
          <div className="aur-list">
            <div className="aur-row">
              <label className="aur-row-label" htmlFor="ds-monthly">
                Ingreso adicional mensual ({selectedOffer?.moneda || 'USD'})
              </label>
              <input
                id="ds-monthly"
                type="number"
                className="aur-input aur-input--num"
                min="0"
                step="0.01"
                value={form.monthlyIncrease}
                onChange={update('monthlyIncrease')}
                required
              />
            </div>
          </div>
        )}

        {form.returnKind === 'delayed_revenue' && (
          <div className="aur-list">
            <div className="aur-row aur-row--multiline">
              <label className="aur-row-label" htmlFor="ds-startmonth">Mes en que arranca el retorno</label>
              <input
                id="ds-startmonth"
                type="number"
                className="aur-input aur-input--num"
                min="0"
                max={Number(form.horizonteMeses) - 1}
                step="1"
                value={form.startMonth}
                onChange={update('startMonth')}
                required
              />
              <span className="aur-field-hint">0 = este mes. Ej: una siembra que rinde a los 4 meses → 4.</span>
            </div>
          </div>
        )}

        {form.returnKind === 'cost_reduction' && (
          <div className="aur-list">
            <div className="aur-row">
              <label className="aur-row-label" htmlFor="ds-costred">
                Reducción mensual de costo ({selectedOffer?.moneda || 'USD'})
              </label>
              <input
                id="ds-costred"
                type="number"
                className="aur-input aur-input--num"
                min="0"
                step="0.01"
                value={form.monthlyCostReduction}
                onChange={update('monthlyCostReduction')}
                required
              />
            </div>
          </div>
        )}
      </section>

      <section className="aur-section">
        <div className="aur-section-header">
          <span className="aur-section-num">03</span>
          <h3 className="aur-section-title">Parámetros avanzados</h3>
          <button
            type="button"
            className="aur-btn-text"
            onClick={() => setAdvancedOpen(v => !v)}
            aria-expanded={advancedOpen}
          >
            {advancedOpen ? <FiChevronDown size={14} /> : <FiChevronRight size={14} />}
            {advancedOpen ? 'Ocultar' : 'Mostrar'}
          </button>
        </div>
        {advancedOpen && (
          <div className="aur-list">
            <div className="aur-row">
              <label className="aur-row-label" htmlFor="ds-horizon">Horizonte (meses)</label>
              <input
                id="ds-horizon"
                type="number"
                className="aur-input aur-input--num"
                min="1"
                max="36"
                step="1"
                value={form.horizonteMeses}
                onChange={update('horizonteMeses')}
              />
            </div>
            <div className="aur-row">
              <label className="aur-row-label" htmlFor="ds-trials">N° de corridas Monte Carlo</label>
              <input
                id="ds-trials"
                type="number"
                className="aur-input aur-input--num"
                min="100"
                max="5000"
                step="100"
                value={form.nTrials}
                onChange={update('nTrials')}
              />
            </div>
            <div className="aur-row aur-row--multiline">
              <label className="aur-row-label" htmlFor="ds-seed">Semilla</label>
              <input
                id="ds-seed"
                type="number"
                className="aur-input aur-input--num"
                min="1"
                step="1"
                value={form.seed}
                onChange={update('seed')}
              />
              <span className="aur-field-hint">Misma semilla = resultados reproducibles.</span>
            </div>
          </div>
        )}
      </section>

      {error && (
        <div className="aur-row aur-row--multiline">
          <span className="aur-field-error">{error}</span>
        </div>
      )}

      <div className="aur-form-actions">
        <button type="button" className="aur-btn-text" onClick={onCancel} disabled={submitting}>
          <FiX /> Cancelar
        </button>
        <button
          type="submit"
          className="aur-btn-pill"
          disabled={submitting || !snapshots.length || !offers.length}
        >
          <FiPlay /> {submitting ? 'Corriendo Monte Carlo…' : 'Simular'}
        </button>
      </div>
    </form>
  );
}

export default DebtSimulatorForm;
