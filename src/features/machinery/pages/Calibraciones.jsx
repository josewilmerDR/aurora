import { useState, useEffect, useRef } from 'react';
import { FiDroplet, FiEdit, FiTrash2, FiPlus, FiX, FiCheck } from 'react-icons/fi';
import Toast from '../../../components/Toast';
import AuroraConfirmModal from '../../../components/AuroraConfirmModal';
import AuroraCombobox from '../../../components/AuroraCombobox';
import AuroraDataTable from '../../../components/AuroraDataTable';
import { useApiFetch } from '../../../hooks/useApiFetch';
import '../styles/machinery.css';

const today = () => new Date().toISOString().split('T')[0];

// ── Draft persistence ──────────────────────────────────────────────────────────
const DRAFT_LS_KEY = 'aurora_draft_calibraciones';
const DRAFT_SS_KEY = 'aurora_draftActive_calibraciones';

const signalDraft = (active) => {
  if (active) sessionStorage.setItem(DRAFT_SS_KEY, '1');
  else sessionStorage.removeItem(DRAFT_SS_KEY);
  window.dispatchEvent(new Event('aurora-draft-change'));
};

const EMPTY_FORM = {
  id: null,
  nombre: '',
  fecha: today(),
  tractorId: '',
  tractorNombre: '',
  aplicadorId: '',
  aplicadorNombre: '',
  volumen: '',
  rpmRecomendado: '',
  marchaRecomendada: '',
  tipoBoquilla: '',
  presionRecomendada: '',
  velocidadKmH: '',
  responsableId: '',
  responsableNombre: '',
  metodo: '',
};

// Columnas visibles en la tabla (todas plain — son metadata, no se ordena/filtra)
const COLUMNS = [
  { key: 'nombre',      label: 'Nombre',      sortable: false },
  { key: 'fecha',       label: 'Fecha',       sortable: false },
  { key: 'tractor',     label: 'Tractor',     sortable: false },
  { key: 'aplicador',   label: 'Aplicador',   sortable: false },
  { key: 'volumen',     label: 'Volumen',     sortable: false, align: 'right' },
  { key: 'rpm',         label: 'RPM',         sortable: false, align: 'right' },
  { key: 'marcha',      label: 'Marcha',      sortable: false },
  { key: 'boquilla',    label: 'Boquilla',    sortable: false },
  { key: 'presion',     label: 'Presión',     sortable: false },
  { key: 'velocidad',   label: 'Km/H',        sortable: false, align: 'right' },
  { key: 'responsable', label: 'Responsable', sortable: false },
  { key: 'metodo',      label: 'Método',      sortable: false },
];

// ── Helpers ──────────────────────────────────────────────────────────────────
const labelFor = (activo) =>
  activo ? `${activo.codigo ? activo.codigo + ': ' : ''}${activo.descripcion}` : '';

const formatFecha = (fecha) => {
  if (!fecha) return '—';
  const [y, m, d] = fecha.split('-');
  return `${d}/${m}/${y}`;
};

// AuroraDataTable requiere getColVal aunque las cols no sean sortables (lo
// usaría si el usuario añade un filter, aunque aquí no aplica). Lo dejamos
// no-op para mantener interface estable.
const getColVal = () => '';

// ── Main page ────────────────────────────────────────────────────────────────
function Calibraciones() {
  const apiFetch = useApiFetch();
  const [items, setItems]       = useState([]);
  const [activos, setActivos]   = useState([]);
  const [loading, setLoading]   = useState(true);
  const [form, setForm]         = useState(EMPTY_FORM);
  const [isEditing, setIsEditing] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving]     = useState(false);
  const formRef = useRef(null);
  const [toast, setToast]       = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null); // { id, nombre }
  const [draftSaved, setDraftSaved] = useState(false);

  const showToast = (message, type = 'success') => setToast({ message, type });

  // Restore draft from localStorage on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_LS_KEY);
      if (!raw) return;
      const draft = JSON.parse(raw);
      setForm(draft);
      setIsEditing(!!draft.id);
      setShowForm(true);
      setDraftSaved(true);
      signalDraft(true);
      showToast('Borrador restaurado.', 'info');
    } catch {
      localStorage.removeItem(DRAFT_LS_KEY);
    }
  }, []);

  // Auto-save draft to localStorage while form is open
  useEffect(() => {
    if (!showForm) return;
    localStorage.setItem(DRAFT_LS_KEY, JSON.stringify(form));
    signalDraft(true);
    setDraftSaved(true);
  }, [form, showForm]);

  const fetchItems = () =>
    apiFetch('/api/calibraciones')
      .then(r => r.json())
      .then(data => setItems(Array.isArray(data) ? data : []))
      .catch(() => showToast('Error al cargar calibraciones.', 'error'))
      .finally(() => setLoading(false));

  useEffect(() => {
    fetchItems();
    apiFetch('/api/maquinaria').then(r => r.json()).then(data => setActivos(Array.isArray(data) ? data : [])).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm(prev => ({ ...prev, [name]: value }));
  };

  const handleTractorChange = (id) => {
    const a = activos.find(x => x.id === id);
    setForm(prev => ({ ...prev, tractorId: id, tractorNombre: a ? a.descripcion : '' }));
  };

  const handleAplicadorChange = (id) => {
    const a = activos.find(x => x.id === id);
    setForm(prev => ({ ...prev, aplicadorId: id, aplicadorNombre: a ? a.descripcion : '' }));
  };

  const resetForm = () => {
    localStorage.removeItem(DRAFT_LS_KEY);
    signalDraft(false);
    setForm(EMPTY_FORM);
    setIsEditing(false);
    setShowForm(false);
    setDraftSaved(false);
  };

  const handleNew = () => {
    setForm({ ...EMPTY_FORM, fecha: today() });
    setIsEditing(false);
    setShowForm(true);
  };

  const handleEdit = (item) => {
    setForm({ ...EMPTY_FORM, ...item });
    setIsEditing(true);
    setShowForm(true);
    setTimeout(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };

  const handleDelete = (id, nombre) => setConfirmDelete({ id, nombre });

  const confirmDoDelete = async () => {
    const { id } = confirmDelete;
    setSaving(true);
    try {
      const res = await apiFetch(`/api/calibraciones/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      setConfirmDelete(null);
      showToast('Calibración eliminada.');
      fetchItems();
    } catch {
      showToast('Error al eliminar la calibración.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.nombre.trim()) {
      showToast('El nombre es obligatorio.', 'error');
      return;
    }
    setSaving(true);
    try {
      const url    = isEditing ? `/api/calibraciones/${form.id}` : '/api/calibraciones';
      const method = isEditing ? 'PUT' : 'POST';
      const body   = { ...form };
      delete body.id;
      if (body.rpmRecomendado !== '') body.rpmRecomendado = Number(body.rpmRecomendado);
      if (body.velocidadKmH  !== '') body.velocidadKmH   = parseFloat(body.velocidadKmH);
      const res = await apiFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error();
      showToast(isEditing ? 'Calibración actualizada.' : 'Calibración creada.');
      resetForm();
      fetchItems();
    } catch {
      showToast('Error al guardar la calibración.', 'error');
    } finally {
      setSaving(false);
    }
  };

  // ── Render row ───────────────────────────────────────────────────────────
  const renderRow = (item, visibleCols) => {
    const empty = <span className="machinery-td-empty">—</span>;
    return (
      <>
        {visibleCols.nombre      && <td><strong>{item.nombre}</strong></td>}
        {visibleCols.fecha       && <td>{formatFecha(item.fecha)}</td>}
        {visibleCols.tractor     && <td>{item.tractorNombre    || empty}</td>}
        {visibleCols.aplicador   && <td>{item.aplicadorNombre  || empty}</td>}
        {visibleCols.volumen     && <td className="machinery-td-num">{item.volumen != null && item.volumen !== '' ? item.volumen : empty}</td>}
        {visibleCols.rpm         && <td className="machinery-td-num">{item.rpmRecomendado    || empty}</td>}
        {visibleCols.marcha      && <td>{item.marchaRecomendada || empty}</td>}
        {visibleCols.boquilla    && <td>{item.tipoBoquilla      || empty}</td>}
        {visibleCols.presion     && <td>{item.presionRecomendada || empty}</td>}
        {visibleCols.velocidad   && <td className="machinery-td-num">{item.velocidadKmH != null && item.velocidadKmH !== '' ? item.velocidadKmH : empty}</td>}
        {visibleCols.responsable && <td>{item.responsableNombre || empty}</td>}
        {visibleCols.metodo      && <td>{item.metodo            || empty}</td>}
      </>
    );
  };

  const trailingCell = (item) => (
    <td className="machinery-td-actions">
      <button type="button" className="aur-icon-btn aur-icon-btn--sm" onClick={() => handleEdit(item)} title="Editar">
        <FiEdit size={13} />
      </button>
      <button type="button" className="aur-icon-btn aur-icon-btn--sm aur-icon-btn--danger" onClick={() => handleDelete(item.id, item.nombre)} title="Eliminar">
        <FiTrash2 size={13} />
      </button>
    </td>
  );

  return (
    <div className="machinery-page">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {confirmDelete && (
        <AuroraConfirmModal
          danger
          title="Eliminar calibración"
          body={`¿Eliminar la calibración "${confirmDelete.nombre}"? Esta acción no se puede deshacer.`}
          confirmLabel="Eliminar"
          onConfirm={confirmDoDelete}
          onCancel={() => setConfirmDelete(null)}
          loading={saving}
        />
      )}

      <div className="aur-sheet" ref={formRef}>
        <header className="aur-sheet-header">
          <div className="aur-sheet-header-text">
            <h1 className="aur-sheet-title">
              {showForm ? (isEditing ? 'Editar calibración' : 'Nueva calibración') : 'Calibraciones'}
              {showForm && draftSaved && (
                <span className="aur-chip" style={{ marginLeft: 12, fontSize: 11, padding: '4px 10px' }}>
                  borrador
                </span>
              )}
            </h1>
            <p className="aur-sheet-subtitle">
              {showForm
                ? 'Define los parámetros de calibración para la maquinaria de aplicaciones.'
                : `${items.length} calibración${items.length !== 1 ? 'es' : ''} registrada${items.length !== 1 ? 's' : ''}.`}
            </p>
          </div>
          <div className="aur-sheet-header-actions">
            {showForm ? (
              <button type="button" className="aur-icon-btn" onClick={resetForm} title="Cancelar">
                <FiX size={16} />
              </button>
            ) : items.length > 0 ? (
              <button type="button" className="aur-btn-pill aur-btn-pill--sm" onClick={handleNew}>
                <FiPlus size={14} /> Nueva calibración
              </button>
            ) : null}
          </div>
        </header>

        {showForm ? (
          <form onSubmit={handleSubmit} noValidate>
            <section className="aur-section">
              <div className="aur-section-header">
                <h3 className="aur-section-title">Identificación</h3>
              </div>
              <div className="aur-list">
                <div className="aur-row">
                  <label className="aur-row-label" htmlFor="cal-nombre">Nombre</label>
                  <input
                    id="cal-nombre"
                    name="nombre"
                    className="aur-input"
                    value={form.nombre}
                    onChange={handleChange}
                    placeholder="Ej. Calibración bomba 3 — Lote Norte"
                    required
                  />
                </div>
                <div className="aur-row">
                  <label className="aur-row-label" htmlFor="cal-fecha">Fecha</label>
                  <input
                    id="cal-fecha"
                    name="fecha"
                    type="date"
                    className="aur-input"
                    value={form.fecha}
                    onChange={handleChange}
                  />
                </div>
              </div>
            </section>

            <section className="aur-section">
              <div className="aur-section-header">
                <h3 className="aur-section-title">Maquinaria</h3>
              </div>
              <div className="aur-list">
                <div className="aur-row">
                  <label className="aur-row-label">Tractor</label>
                  <AuroraCombobox
                    value={form.tractorId}
                    onChange={handleTractorChange}
                    items={activos}
                    labelFn={labelFor}
                    placeholder="— Buscar tractor —"
                  />
                </div>
                <div className="aur-row">
                  <label className="aur-row-label">Aplicador</label>
                  <AuroraCombobox
                    value={form.aplicadorId}
                    onChange={handleAplicadorChange}
                    items={activos}
                    labelFn={labelFor}
                    placeholder="— Buscar aplicador —"
                  />
                </div>
              </div>
            </section>

            <section className="aur-section">
              <div className="aur-section-header">
                <h3 className="aur-section-title">Parámetros recomendados</h3>
              </div>
              <div className="aur-list">
                <div className="aur-row">
                  <label className="aur-row-label" htmlFor="cal-vol">Volumen</label>
                  <input
                    id="cal-vol"
                    name="volumen"
                    type="number"
                    className="aur-input aur-input--num"
                    min="0"
                    step="0.1"
                    value={form.volumen}
                    onChange={handleChange}
                    placeholder="Ej. 200"
                  />
                </div>
                <div className="aur-row">
                  <label className="aur-row-label" htmlFor="cal-rpm">RPM</label>
                  <input
                    id="cal-rpm"
                    name="rpmRecomendado"
                    type="number"
                    className="aur-input aur-input--num"
                    min="0"
                    step="1"
                    value={form.rpmRecomendado}
                    onChange={handleChange}
                    placeholder="Ej. 540"
                  />
                </div>
                <div className="aur-row">
                  <label className="aur-row-label" htmlFor="cal-marcha">Marcha</label>
                  <input
                    id="cal-marcha"
                    name="marchaRecomendada"
                    className="aur-input"
                    value={form.marchaRecomendada}
                    onChange={handleChange}
                    placeholder="Ej. 2ª lenta"
                  />
                </div>
                <div className="aur-row">
                  <label className="aur-row-label" htmlFor="cal-boq">Boquilla</label>
                  <input
                    id="cal-boq"
                    name="tipoBoquilla"
                    className="aur-input"
                    value={form.tipoBoquilla}
                    onChange={handleChange}
                    placeholder="Ej. Abanico plano 110-03"
                  />
                </div>
                <div className="aur-row">
                  <label className="aur-row-label" htmlFor="cal-pres">Presión</label>
                  <input
                    id="cal-pres"
                    name="presionRecomendada"
                    className="aur-input"
                    value={form.presionRecomendada}
                    onChange={handleChange}
                    placeholder="Ej. 2.5 bar"
                  />
                </div>
                <div className="aur-row">
                  <label className="aur-row-label" htmlFor="cal-vel">Velocidad (Km/H)</label>
                  <input
                    id="cal-vel"
                    name="velocidadKmH"
                    type="number"
                    className="aur-input aur-input--num"
                    min="0"
                    step="0.1"
                    value={form.velocidadKmH}
                    onChange={handleChange}
                    placeholder="Ej. 5.5"
                  />
                </div>
              </div>
            </section>

            <section className="aur-section">
              <div className="aur-section-header">
                <h3 className="aur-section-title">Procedimiento</h3>
              </div>
              <div className="aur-list">
                <div className="aur-row">
                  <label className="aur-row-label" htmlFor="cal-resp">Responsable</label>
                  <input
                    id="cal-resp"
                    name="responsableNombre"
                    className="aur-input"
                    value={form.responsableNombre}
                    onChange={handleChange}
                    placeholder="Nombre del responsable"
                  />
                </div>
                <div className="aur-row aur-row--multiline">
                  <label className="aur-row-label" htmlFor="cal-metodo">Método</label>
                  <textarea
                    id="cal-metodo"
                    name="metodo"
                    className="aur-textarea"
                    value={form.metodo}
                    onChange={handleChange}
                    placeholder="Ej. Método de los vasos"
                    rows={2}
                  />
                </div>
              </div>
            </section>

            <div className="aur-form-actions">
              <button type="button" className="aur-btn-text" onClick={resetForm}>
                Cancelar
              </button>
              <button type="submit" className="aur-btn-pill" disabled={saving}>
                <FiCheck size={15} /> {saving ? 'Guardando…' : isEditing ? 'Actualizar' : 'Crear calibración'}
              </button>
            </div>
          </form>
        ) : loading ? (
          <div className="aur-page-loading" />
        ) : items.length === 0 ? (
          <div className="machinery-empty">
            <FiDroplet size={40} />
            <p className="machinery-empty-text">No tienes ninguna calibración creada.</p>
            <p className="machinery-empty-sub">Crea tu primera calibración para empezar.</p>
            <button type="button" className="aur-btn-pill aur-btn-pill--sm" onClick={handleNew}>
              <FiPlus size={14} /> Crear calibración
            </button>
          </div>
        ) : (
          <AuroraDataTable
            columns={COLUMNS}
            data={items}
            getColVal={getColVal}
            renderRow={renderRow}
            trailingCell={trailingCell}
          />
        )}
      </div>
    </div>
  );
}

export default Calibraciones;
