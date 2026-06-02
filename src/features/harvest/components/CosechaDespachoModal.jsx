import { useState, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { FiPlusCircle } from 'react-icons/fi';
import Toast from '../../../components/Toast';
import AuroraCombobox from '../../../components/AuroraCombobox';
import BuyerSelector from '../../finance/components/BuyerSelector';
import HarvestBoletasSelect from './HarvestBoletasSelect';
import { useUser } from '../../../contexts/UserContext';
import { translateApiError } from '../../../lib/errorMessages';
import { useEscapeClose } from '../../../hooks/useEscapeClose';
import { useBlurValidation } from '../../../hooks/useBlurValidation';
import { useDraft } from '../../../hooks/useDraft';
import { todayISO, isValidISODate } from '../lib/dates';

// ── Validation constants ─────────────────────────────────────────────────────
const MAX_OPERARIO   = 48;
const MAX_PLACA      = 12;
const MAX_NOTA       = 288;
const MAX_CANTIDAD   = 32768;

// Validación agregada (no secuencial): devuelve TODOS los errores de una, para
// pintarlos inline bajo cada campo vía useBlurValidation. Punto #6 audit.
function validate(form) {
  const errors = {};
  if (!form.fecha) {
    errors.fecha = 'La fecha es requerida.';
  } else if (!isValidISODate(form.fecha)) {
    errors.fecha = 'Fecha inválida.';
  } else if (form.fecha > todayISO()) {
    errors.fecha = 'No puede ser posterior al día actual.';
  }
  if (!form.loteId) errors.loteId = 'El lote es requerido.';
  if (!form.buyerId) errors.buyerId = 'El comprador es requerido.';
  const cant = Number(form.cantidad);
  if (!form.cantidad || !Number.isFinite(cant) || cant <= 0 || cant > MAX_CANTIDAD) {
    errors.cantidad = `Debe ser mayor a 0 y máx. ${MAX_CANTIDAD}.`;
  }
  if (!form.unidadId) errors.unidad = 'La unidad es requerida.';
  if ((form.operarioCamionNombre || '').length > MAX_OPERARIO) {
    errors.operarioCamionNombre = `Máx. ${MAX_OPERARIO} caracteres.`;
  }
  if ((form.placaCamion || '').length > MAX_PLACA) {
    errors.placaCamion = `Máx. ${MAX_PLACA} caracteres.`;
  }
  if ((form.nota || '').length > MAX_NOTA) {
    errors.nota = `Máx. ${MAX_NOTA} caracteres.`;
  }
  return errors;
}

const makeEmptyForm = (currentUser) => ({
  fecha:                todayISO(),
  loteId:               '',
  loteNombre:           '',
  buyerId:              '',
  operarioCamionNombre: '',
  placaCamion:          '',
  cantidad:             '',
  unidadId:             '',
  unidad:               '',
  boletas:              [],
  despachadorId:        currentUser?.id     || '',
  despachadorNombre:    currentUser?.nombre || '',
  encargadoId:          '',
  encargadoNombre:      '',
  nota:                 '',
});

export default function CosechaDespachoModal({
  apiFetch,
  prereqs,
  existingDespachos = [],
  onSuccess,
  onClose,
}) {
  const { currentUser } = useUser();

  // Si el padre prefetcheó los catálogos, los usamos directo (modal instantáneo).
  // Si no, caemos al fetch interno y mostramos skeleton.
  const [lotes, setLotes]                       = useState(() => prereqs?.lotes            || []);
  const [usuarios, setUsuarios]                 = useState(() => prereqs?.usuarios         || []);
  const [unidades, setUnidades]                 = useState(() => prereqs?.unidades         || []);
  const [registrosCosecha, setRegistrosCosecha] = useState(() => prereqs?.registrosCosecha || []);
  const [loading, setLoading]                   = useState(() => !prereqs);

  const [saving, setSaving] = useState(false);
  const [toast,  setToast]  = useState(null);
  const showToast = (msg, type = 'success') => setToast({ message: msg, type });

  // Borrador persistido: el form tiene 6 secciones y un click fuera lo cierra;
  // sin esto se perdía todo. Punto #8 audit.
  const [form, setForm, clearDraft] = useDraft('cosecha-despacho-nuevo', () => makeEmptyForm(currentUser));
  const { fieldErrors, blurField, clearField, validateAll, inputClass } = useBlurValidation(validate);

  // ESC cierra el modal (salvo durante un guardado en vuelo). Punto #4 audit.
  useEscapeClose(saving ? null : onClose);

  useEffect(() => {
    if (prereqs) return;
    let alive = true;
    Promise.all([
      apiFetch('/api/lotes').then(r => r.json()),
      apiFetch('/api/users/lite').then(r => r.json()),
      apiFetch('/api/unidades-medida').then(r => r.json()),
      apiFetch('/api/cosecha/registros').then(r => r.json()),
    ]).then(([lotesData, usersData, unidadesData, registrosData]) => {
      if (!alive) return;
      setLotes(Array.isArray(lotesData) ? lotesData : []);
      setUsuarios(Array.isArray(usersData) ? usersData.filter(u => u.empleadoPlanilla) : []);
      setUnidades(Array.isArray(unidadesData) ? unidadesData : []);
      setRegistrosCosecha(Array.isArray(registrosData) ? registrosData : []);
    }).catch(() => {})
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Lista de responsables: usuarios de planilla + el usuario actual aunque no
  // sea de planilla (un admin puede despachar). Sin esto, el despachador
  // pre-seteado quedaba con id sin item → combobox vacío. Punto #23 audit.
  const responsables = useMemo(() => {
    if (!currentUser?.id || usuarios.some(u => u.id === currentUser.id)) return usuarios;
    return [{ id: currentUser.id, nombre: currentUser.nombre || 'Yo' }, ...usuarios];
  }, [usuarios, currentUser]);

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm(prev => {
      const next = { ...prev, [name]: value };
      if (name === 'loteId') {
        const l = lotes.find(x => x.id === value);
        next.loteNombre = l ? l.nombreLote : '';
        next.boletas = [];
        next.cantidad = '';
      }
      return next;
    });
    clearField(name);
  };

  const unidadLabel = useCallback(
    (u) => u ? [u.nombre, u.descripcion].filter(Boolean).join(' — ') : '',
    [],
  );

  const handleUnidadChange = (id) => {
    const u = unidades.find(x => x.id === id);
    setForm(prev => ({ ...prev, unidadId: id, unidad: u ? u.nombre : '' }));
    clearField('unidad');
  };

  const makeUserHandler = (idField, nameField) => (id) => {
    const u = responsables.find(x => x.id === id);
    setForm(prev => ({ ...prev, [idField]: id, [nameField]: u ? u.nombre : '' }));
  };

  const handleDespachador = makeUserHandler('despachadorId', 'despachadorNombre');
  const handleEncargado   = makeUserHandler('encargadoId',   'encargadoNombre');

  const usedBoletaIds = useMemo(
    () => new Set(
      existingDespachos
        .filter(d => d.estado !== 'anulado')
        .flatMap(d => (d.boletas || []).map(b => b.id)),
    ),
    [existingDespachos],
  );

  // Suma de las boletas seleccionadas: alimenta la cantidad (derivada) y se
  // muestra en el header de la sección para que el usuario no tenga que bajar
  // a "Cantidad despachada" a verificar. Puntos #21 y #22 audit.
  const boletasSuma = useMemo(
    () => form.boletas.reduce((acc, b) => acc + (parseFloat(b.cantidad) || 0), 0),
    [form.boletas],
  );
  const hasBoletas = form.boletas.length > 0;

  const handleBoletasChange = (boletas) => {
    const suma = boletas.reduce((acc, b) => acc + (parseFloat(b.cantidad) || 0), 0);
    setForm(prev => ({
      ...prev,
      boletas,
      // Cuando hay boletas, la cantidad es derivada (no editable a mano) para
      // que nunca diverja de la suma de las boletas que componen el despacho.
      cantidad: suma > 0 ? String(suma) : (boletas.length ? '' : prev.cantidad),
    }));
    if (suma > 0) clearField('cantidad');
  };

  const handleSubmit = async (e) => {
    e?.preventDefault?.();
    if (saving) return;
    if (!validateAll(form)) return;
    setSaving(true);
    try {
      const res = await apiFetch('/api/cosecha/despachos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(translateApiError(body, 'Error al guardar.'));
      }
      const created = await res.json().catch(() => ({}));
      clearDraft();
      onSuccess?.(created);
      onClose?.();
    } catch (err) {
      showToast(err.message || 'Error al guardar.', 'error');
      setSaving(false);
    }
  };

  return createPortal(
    <div className="aur-modal-backdrop" onPointerDown={() => { if (!saving) onClose?.(); }}>
      <div className="aur-modal aur-modal--xl" onPointerDown={(e) => e.stopPropagation()}>
        {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

        <div className="aur-modal-header">
          <span className="aur-modal-icon">
            <FiPlusCircle size={16} />
          </span>
          <span className="aur-modal-title">Nuevo despacho</span>
        </div>

        {loading ? (
          <div className="aur-modal-content">
            <div className="aur-page-loading" />
          </div>
        ) : (
          <form className="aur-modal-content" onSubmit={handleSubmit} noValidate>
            <section className="aur-section">
              <div className="aur-section-header">
                <h3 className="aur-section-title">Fecha y comprador</h3>
              </div>
              <div className="aur-list">
                <div className="aur-row aur-row--multiline">
                  <label className="aur-row-label" htmlFor="cd-fecha">Fecha</label>
                  <input
                    id="cd-fecha"
                    type="date"
                    name="fecha"
                    className={inputClass('fecha')}
                    value={form.fecha}
                    onChange={handleChange}
                    onBlur={() => blurField('fecha', form)}
                    max={todayISO()}
                    required
                  />
                  {fieldErrors.fecha && <span className="aur-field-error">{fieldErrors.fecha}</span>}
                </div>
                <div className="aur-row aur-row--multiline">
                  <label className="aur-row-label" htmlFor="cd-lote">Lote</label>
                  <select
                    id="cd-lote"
                    name="loteId"
                    className={inputClass('loteId', 'aur-select')}
                    value={form.loteId}
                    onChange={handleChange}
                    onBlur={() => blurField('loteId', form)}
                    required
                  >
                    <option value="">— Seleccionar —</option>
                    {lotes.map(l => <option key={l.id} value={l.id}>{l.nombreLote}</option>)}
                  </select>
                  {fieldErrors.loteId && <span className="aur-field-error">{fieldErrors.loteId}</span>}
                </div>
                <div className="aur-row aur-row--multiline">
                  <label className="aur-row-label" htmlFor="cd-buyer">Comprador</label>
                  <BuyerSelector
                    value={form.buyerId}
                    onChange={(v) => { setForm(prev => ({ ...prev, buyerId: v })); clearField('buyerId'); }}
                    required
                    className={inputClass('buyerId', 'aur-select')}
                  />
                  {fieldErrors.buyerId && <span className="aur-field-error">{fieldErrors.buyerId}</span>}
                </div>
              </div>
            </section>

            <section className="aur-section">
              <div className="aur-section-header">
                <h3 className="aur-section-title">Camión</h3>
              </div>
              <div className="aur-list">
                <div className="aur-row aur-row--multiline">
                  <label className="aur-row-label" htmlFor="cd-operario">Chofer</label>
                  <input
                    id="cd-operario"
                    type="text"
                    name="operarioCamionNombre"
                    className={inputClass('operarioCamionNombre')}
                    value={form.operarioCamionNombre}
                    onChange={handleChange}
                    onBlur={() => blurField('operarioCamionNombre', form)}
                    placeholder="Nombre del chofer…"
                    maxLength={MAX_OPERARIO}
                  />
                  {fieldErrors.operarioCamionNombre && <span className="aur-field-error">{fieldErrors.operarioCamionNombre}</span>}
                </div>
                <div className="aur-row aur-row--multiline">
                  <label className="aur-row-label" htmlFor="cd-placa">Placa</label>
                  <input
                    id="cd-placa"
                    type="text"
                    name="placaCamion"
                    className={inputClass('placaCamion')}
                    value={form.placaCamion}
                    onChange={handleChange}
                    onBlur={() => blurField('placaCamion', form)}
                    placeholder="Ej. ABC-123"
                    maxLength={MAX_PLACA}
                  />
                  {fieldErrors.placaCamion && <span className="aur-field-error">{fieldErrors.placaCamion}</span>}
                </div>
              </div>
            </section>

            <section className="aur-section">
              <div className="aur-section-header">
                <h3 className="aur-section-title">Boletas de cosecha</h3>
                <span className="aur-section-count">{form.boletas.length}</span>
                {boletasSuma > 0 && (
                  <span className="harvest-section-hint">
                    suma {boletasSuma.toLocaleString('es-ES')}{form.unidad ? ` ${form.unidad}` : ''}
                  </span>
                )}
              </div>
              <HarvestBoletasSelect
                registros={registrosCosecha}
                usedIds={usedBoletaIds}
                selected={form.boletas}
                onChange={handleBoletasChange}
              />
            </section>

            <section className="aur-section">
              <div className="aur-section-header">
                <h3 className="aur-section-title">Cantidad despachada</h3>
              </div>
              <div className="aur-list">
                <div className="aur-row aur-row--multiline">
                  <label className="aur-row-label" htmlFor="cd-cantidad">Cantidad</label>
                  <input
                    id="cd-cantidad"
                    type="number"
                    name="cantidad"
                    className={inputClass('cantidad', 'aur-input aur-input--num')}
                    min="0"
                    max={MAX_CANTIDAD}
                    step="any"
                    value={form.cantidad}
                    onChange={handleChange}
                    onBlur={() => blurField('cantidad', form)}
                    placeholder="0"
                    readOnly={hasBoletas}
                    title={hasBoletas ? 'Calculada a partir de las boletas seleccionadas' : undefined}
                    required
                  />
                  {hasBoletas
                    ? <span className="aur-field-hint">Derivada de las boletas seleccionadas.</span>
                    : fieldErrors.cantidad && <span className="aur-field-error">{fieldErrors.cantidad}</span>}
                </div>
                <div className="aur-row aur-row--multiline">
                  <label className="aur-row-label">Unidad</label>
                  <AuroraCombobox
                    value={form.unidadId}
                    onChange={handleUnidadChange}
                    items={unidades}
                    labelFn={unidadLabel}
                    placeholder="Buscar unidad…"
                  />
                  {fieldErrors.unidad && <span className="aur-field-error">{fieldErrors.unidad}</span>}
                </div>
              </div>
            </section>

            <section className="aur-section">
              <div className="aur-section-header">
                <h3 className="aur-section-title">Responsables</h3>
              </div>
              <div className="aur-list">
                <div className="aur-row">
                  <label className="aur-row-label">Despachador</label>
                  <AuroraCombobox
                    value={form.despachadorId}
                    onChange={handleDespachador}
                    items={responsables}
                    labelKey="nombre"
                    placeholder="Buscar despachador…"
                  />
                </div>
                <div className="aur-row">
                  <label className="aur-row-label">Encargado de cosecha</label>
                  <AuroraCombobox
                    value={form.encargadoId}
                    onChange={handleEncargado}
                    items={responsables}
                    labelKey="nombre"
                    placeholder="Buscar encargado…"
                  />
                </div>
              </div>
            </section>

            <section className="aur-section">
              <div className="aur-section-header">
                <h3 className="aur-section-title">Observaciones</h3>
              </div>
              <div className="aur-list">
                <div className="aur-row aur-row--multiline">
                  <label className="aur-row-label" htmlFor="cd-nota">Nota</label>
                  <textarea
                    id="cd-nota"
                    name="nota"
                    className={inputClass('nota', 'aur-textarea')}
                    value={form.nota}
                    onChange={handleChange}
                    onBlur={() => blurField('nota', form)}
                    placeholder="Observaciones adicionales…"
                    rows={2}
                    maxLength={MAX_NOTA}
                  />
                  {fieldErrors.nota && <span className="aur-field-error">{fieldErrors.nota}</span>}
                </div>
              </div>
            </section>
          </form>
        )}

        <div className="aur-modal-actions">
          <button
            type="button"
            className="aur-btn-text"
            onClick={onClose}
            disabled={saving}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="aur-btn-pill"
            onClick={handleSubmit}
            disabled={saving || loading}
          >
            <FiPlusCircle size={14} />
            {saving ? 'Guardando…' : 'Registrar despacho'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
