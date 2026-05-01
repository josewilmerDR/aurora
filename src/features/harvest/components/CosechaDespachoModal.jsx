import { useState, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { FiPlusCircle } from 'react-icons/fi';
import Toast from '../../../components/Toast';
import AuroraCombobox from '../../../components/AuroraCombobox';
import BuyerSelector from '../../finance/components/BuyerSelector';
import HarvestBoletasSelect from './HarvestBoletasSelect';
import { useUser } from '../../../contexts/UserContext';

// ── Validation constants ─────────────────────────────────────────────────────
const MAX_OPERARIO   = 48;
const MAX_PLACA      = 12;
const MAX_NOTA       = 288;
const MAX_CANTIDAD   = 32768;

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

  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const emptyForm = useCallback(() => ({
    fecha:                today,
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
  }), [currentUser, today]);

  const [form, setForm] = useState(() => emptyForm());

  useEffect(() => {
    if (prereqs) return;
    let alive = true;
    Promise.all([
      apiFetch('/api/lotes').then(r => r.json()),
      apiFetch('/api/users').then(r => r.json()),
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

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm(prev => {
      const next = { ...prev, [name]: value };
      if (name === 'loteId') {
        const l = lotes.find(x => x.id === value);
        next.loteNombre = l ? l.nombreLote : '';
        next.boletas = [];
      }
      return next;
    });
  };

  const unidadLabel = useCallback(
    (u) => u ? [u.nombre, u.descripcion].filter(Boolean).join(' — ') : '',
    [],
  );

  const handleUnidadChange = (id) => {
    const u = unidades.find(x => x.id === id);
    setForm(prev => ({ ...prev, unidadId: id, unidad: u ? u.nombre : '' }));
  };

  const makeUserHandler = (idField, nameField) => (id) => {
    const u = usuarios.find(x => x.id === id);
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

  const handleBoletasChange = (boletas) => {
    const suma = boletas.reduce((acc, b) => acc + (parseFloat(b.cantidad) || 0), 0);
    setForm(prev => ({
      ...prev,
      boletas,
      cantidad: suma > 0 ? String(suma) : '',
    }));
  };

  const handleSubmit = async (e) => {
    e?.preventDefault?.();
    if (saving) return;
    if (!form.fecha || !form.loteId || !form.cantidad) {
      showToast('Fecha, lote y cantidad son obligatorios.', 'error');
      return;
    }
    if (!form.buyerId) {
      showToast('El comprador es obligatorio.', 'error');
      return;
    }
    if (form.fecha > today) {
      showToast('La fecha no puede ser futura.', 'error');
      return;
    }
    const cantNum = parseFloat(form.cantidad);
    if (isNaN(cantNum) || cantNum < 0 || cantNum > MAX_CANTIDAD) {
      showToast(`Cantidad debe estar entre 0 y ${MAX_CANTIDAD}.`, 'error');
      return;
    }
    if (form.operarioCamionNombre.length > MAX_OPERARIO) {
      showToast(`Operario: máx. ${MAX_OPERARIO} caracteres.`, 'error');
      return;
    }
    if (form.placaCamion.length > MAX_PLACA) {
      showToast(`Placa: máx. ${MAX_PLACA} caracteres.`, 'error');
      return;
    }
    if (form.nota.length > MAX_NOTA) {
      showToast(`Observaciones: máx. ${MAX_NOTA} caracteres.`, 'error');
      return;
    }
    setSaving(true);
    try {
      const res = await apiFetch('/api/cosecha/despachos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error();
      onSuccess?.();
      onClose?.();
    } catch {
      showToast('Error al guardar.', 'error');
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
                <div className="aur-row">
                  <label className="aur-row-label" htmlFor="cd-fecha">Fecha</label>
                  <input
                    id="cd-fecha"
                    type="date"
                    name="fecha"
                    className="aur-input"
                    value={form.fecha}
                    onChange={handleChange}
                    max={today}
                    required
                  />
                </div>
                <div className="aur-row">
                  <label className="aur-row-label" htmlFor="cd-lote">Lote</label>
                  <select
                    id="cd-lote"
                    name="loteId"
                    className="aur-select"
                    value={form.loteId}
                    onChange={handleChange}
                    required
                  >
                    <option value="">— Seleccionar —</option>
                    {lotes.map(l => <option key={l.id} value={l.id}>{l.nombreLote}</option>)}
                  </select>
                </div>
                <div className="aur-row">
                  <label className="aur-row-label" htmlFor="cd-buyer">Comprador</label>
                  <BuyerSelector
                    value={form.buyerId}
                    onChange={(v) => setForm(prev => ({ ...prev, buyerId: v }))}
                    required
                    className="aur-select"
                  />
                </div>
              </div>
            </section>

            <section className="aur-section">
              <div className="aur-section-header">
                <h3 className="aur-section-title">Camión</h3>
              </div>
              <div className="aur-list">
                <div className="aur-row">
                  <label className="aur-row-label" htmlFor="cd-operario">Operario de camión</label>
                  <input
                    id="cd-operario"
                    type="text"
                    name="operarioCamionNombre"
                    className="aur-input"
                    value={form.operarioCamionNombre}
                    onChange={handleChange}
                    placeholder="Nombre del chofer…"
                    maxLength={MAX_OPERARIO}
                  />
                </div>
                <div className="aur-row">
                  <label className="aur-row-label" htmlFor="cd-placa">Placa</label>
                  <input
                    id="cd-placa"
                    type="text"
                    name="placaCamion"
                    className="aur-input"
                    value={form.placaCamion}
                    onChange={handleChange}
                    placeholder="Ej. ABC-123"
                    maxLength={MAX_PLACA}
                  />
                </div>
              </div>
            </section>

            <section className="aur-section">
              <div className="aur-section-header">
                <h3 className="aur-section-title">Boletas de cosecha</h3>
                <span className="aur-section-count">{form.boletas.length}</span>
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
                <div className="aur-row">
                  <label className="aur-row-label" htmlFor="cd-cantidad">Cantidad</label>
                  <input
                    id="cd-cantidad"
                    type="number"
                    name="cantidad"
                    className="aur-input aur-input--num"
                    min="0"
                    max={MAX_CANTIDAD}
                    step="any"
                    value={form.cantidad}
                    onChange={handleChange}
                    placeholder="0"
                    required
                  />
                </div>
                <div className="aur-row">
                  <label className="aur-row-label">Unidad</label>
                  <AuroraCombobox
                    value={form.unidadId}
                    onChange={handleUnidadChange}
                    items={unidades}
                    labelFn={unidadLabel}
                    placeholder="Buscar unidad…"
                  />
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
                    items={usuarios}
                    labelKey="nombre"
                    placeholder="Buscar despachador…"
                  />
                </div>
                <div className="aur-row">
                  <label className="aur-row-label">Encargado de cosecha</label>
                  <AuroraCombobox
                    value={form.encargadoId}
                    onChange={handleEncargado}
                    items={usuarios}
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
                    className="aur-textarea"
                    value={form.nota}
                    onChange={handleChange}
                    placeholder="Observaciones adicionales…"
                    rows={2}
                    maxLength={MAX_NOTA}
                  />
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
