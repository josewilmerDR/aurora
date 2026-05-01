import { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { FiTool, FiEdit, FiTrash2, FiPlus, FiX, FiCheck, FiSearch, FiDroplet } from 'react-icons/fi';
import Toast from '../../../components/Toast';
import AuroraConfirmModal from '../../../components/AuroraConfirmModal';
import AuroraDataTable from '../../../components/AuroraDataTable';
import { useApiFetch } from '../../../hooks/useApiFetch';
import '../styles/machinery.css';

const TIPOS = [
  'CARRETA DE SEMILLA',
  'CARRETA DE COSECHA',
  'IMPLEMENTO',
  'MAQUINARIA DE APLICACIONES',
  'MAQUINARIA DE PREPARACIÓN DE TERRENO',
  'MONTACARGA',
  'MOTOCICLETA',
  'TRACTOR DE LLANTAS',
  'VEHÍCULO CARGA LIVIANA',
  'OTRO MAQUINARIA DE CAMPO',
];

const MAX_ID = 50;
const MAX_CODIGO = 50;
const MAX_DESC = 200;
const MAX_UBIC = 150;
const MAX_OBS = 2000;

const COLUMNS = [
  { key: 'idMaquina',             label: 'ID',              type: 'text'                       },
  { key: 'codigo',                label: 'CC',              type: 'text'                       },
  { key: 'descripcion',           label: 'Descripción',     type: 'text'                       },
  { key: 'tipo',                  label: 'Tipo',            type: 'text'                       },
  { key: 'ubicacion',             label: 'Ubicación',       type: 'text'                       },
  { key: 'capacidad',             label: 'Cap. litros',     type: 'number', align: 'right'     },
  { key: 'valorAdquisicion',      label: 'Val. Adq.',       type: 'number', align: 'right'     },
  { key: 'valorResidual',         label: 'Val. Residual',   type: 'number', align: 'right'     },
  { key: 'residualPct',           label: 'Res. %',          sortable: false, align: 'right'    },
  { key: 'vidaUtilHoras',         label: 'Vida útil (h)',   type: 'number', align: 'right'     },
  { key: 'horasAcumuladas',       label: 'Hrs. acum.',      sortable: false, align: 'right'    },
  { key: 'costoDepHora',          label: 'Costo dep./h',    sortable: false, align: 'right'    },
  { key: 'tasaLH',                label: 'L/H (30d)',       sortable: false, align: 'right'    },
  { key: 'fechaRevisionResidual', label: 'Rev. residual',   type: 'date'                       },
  { key: 'observacion',           label: 'Observación',     type: 'text'                       },
];

const FUEL_BODEGA_KEY = 'aurora_fuel_bodegaId';

function calcResidualPct(adq, res) {
  const a = parseFloat(adq), r = parseFloat(res);
  if (!isNaN(a) && !isNaN(r) && a > 0) return `${((r / a) * 100).toFixed(1)}%`;
  return null;
}

function calcCostoDepHora(adq, res, hrs) {
  const a = parseFloat(adq), r = parseFloat(res), h = parseFloat(hrs);
  if (!isNaN(a) && !isNaN(r) && !isNaN(h) && h > 0) return `$${((a - r) / h).toFixed(2)}`;
  return null;
}

function getColVal(item, key) {
  switch (key) {
    case 'idMaquina':             return (item.idMaquina   || '').toLowerCase();
    case 'codigo':                return (item.codigo      || '').toLowerCase();
    case 'descripcion':           return (item.descripcion || '').toLowerCase();
    case 'tipo':                  return (item.tipo        || '').toLowerCase();
    case 'ubicacion':             return (item.ubicacion   || '').toLowerCase();
    case 'capacidad':             return Number(item.capacidad)        || 0;
    case 'valorAdquisicion':      return Number(item.valorAdquisicion) || 0;
    case 'valorResidual':         return Number(item.valorResidual)    || 0;
    case 'vidaUtilHoras':         return Number(item.vidaUtilHoras)    || 0;
    case 'fechaRevisionResidual': return item.fechaRevisionResidual    || '';
    case 'observacion':           return (item.observacion || '').toLowerCase();
    default:                      return '';
  }
}

const EMPTY_FORM = {
  id: null,
  idMaquina: '',
  codigo: '',
  descripcion: '',
  tipo: '',
  ubicacion: '',
  observacion: '',
  capacidad: '',
  valorAdquisicion: '',
  valorResidual: '',
  vidaUtilHoras: '',
  horasAcumuladas: '',
  fechaRevisionResidual: '',
};

const DRAFT_KEY        = 'aurora_maquinaria_draft';
const DRAFT_ACTIVE_KEY = 'aurora_draftActive_maquinaria-activo';
const _saveDraft  = (form, isEditing) => {
  localStorage.setItem(DRAFT_KEY, JSON.stringify({ form, isEditing }));
  sessionStorage.setItem(DRAFT_ACTIVE_KEY, '1');
  window.dispatchEvent(new Event('aurora-draft-change'));
};
const _clearDraft = () => {
  localStorage.removeItem(DRAFT_KEY);
  sessionStorage.removeItem(DRAFT_ACTIVE_KEY);
  window.dispatchEvent(new Event('aurora-draft-change'));
};
const _loadDraft  = () => { try { return JSON.parse(localStorage.getItem(DRAFT_KEY)); } catch { return null; } };

function MaquinariaList() {
  const apiFetch = useApiFetch();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const _draft = _loadDraft();
  const [form, setForm]         = useState(_draft?.form      ?? EMPTY_FORM);
  const [isEditing, setIsEditing] = useState(_draft?.isEditing ?? false);
  const [showForm, setShowForm]   = useState(!!_draft);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [filter, setFilter] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(null); // { id, descripcion }

  // ── Tasas de combustible ───────────────────────────────────────────────────
  const [bodegas,       setBodegas]       = useState([]);
  const [fuelBodegaId,  setFuelBodegaId]  = useState(() => localStorage.getItem(FUEL_BODEGA_KEY) || '');
  const [tasas,         setTasas]         = useState({});       // { [maquinaId]: { tasaLH, ... } }
  const [fuelPopover,   setFuelPopover]   = useState(false);    // selector de bodega

  const showToast = (message, type = 'success') => setToast({ message, type });

  const fetchItems = () =>
    apiFetch('/api/maquinaria')
      .then(r => r.json())
      .then(data => setItems(Array.isArray(data) ? data : []))
      .catch(() => showToast('Error al cargar la lista de maquinaria.', 'error'))
      .finally(() => setLoading(false));

  useEffect(() => { fetchItems(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Cargar bodegas (para el selector de bodega de combustible)
  useEffect(() => {
    apiFetch('/api/bodegas')
      .then(r => r.json())
      .then(data => {
        const lista = Array.isArray(data) ? data.filter(b => b.tipo !== 'agroquimicos') : [];
        setBodegas(lista);
        // Auto-seleccionar bodega de combustibles si no hay ninguna guardada
        if (!localStorage.getItem(FUEL_BODEGA_KEY)) {
          const defComb = lista.find(b => b.tipo === 'combustibles');
          if (defComb) {
            setFuelBodegaId(defComb.id);
            localStorage.setItem(FUEL_BODEGA_KEY, defComb.id);
          }
        }
      })
      .catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Cargar tasas de combustible cuando cambia la bodega seleccionada
  useEffect(() => {
    if (!fuelBodegaId) { setTasas({}); return; }
    apiFetch(`/api/maquinaria/tasas-combustible?bodegaId=${encodeURIComponent(fuelBodegaId)}`)
      .then(r => r.json())
      .then(data => setTasas(data.tasas || {}))
      .catch(() => {});
  }, [fuelBodegaId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleFuelBodegaChange = (id) => {
    setFuelBodegaId(id);
    if (id) localStorage.setItem(FUEL_BODEGA_KEY, id);
    else    localStorage.removeItem(FUEL_BODEGA_KEY);
    setFuelPopover(false);
  };

  // Restore sidebar draft badge if a cross-session draft exists
  useEffect(() => {
    if (_loadDraft()) {
      sessionStorage.setItem(DRAFT_ACTIVE_KEY, '1');
      window.dispatchEvent(new Event('aurora-draft-change'));
    }
  }, []);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm(prev => {
      const next = { ...prev, [name]: value };
      _saveDraft(next, isEditing);
      return next;
    });
  };

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setIsEditing(false);
    setShowForm(false);
    _clearDraft();
  };

  const handleEdit = (item) => {
    // Coerce null numerics to '' to keep inputs controlled
    const editForm = { ...EMPTY_FORM, ...item };
    for (const k of Object.keys(EMPTY_FORM)) {
      if (editForm[k] == null) editForm[k] = '';
    }
    setForm(editForm);
    setIsEditing(true);
    setShowForm(true);
    _saveDraft(editForm, true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleNew = () => {
    setForm(EMPTY_FORM);
    setIsEditing(false);
    setShowForm(true);
    _clearDraft();
  };

  const doDelete = async () => {
    if (!confirmDelete) return;
    const { id } = confirmDelete;
    setSaving(true);
    try {
      const res = await apiFetch(`/api/maquinaria/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      setConfirmDelete(null);
      showToast('Activo eliminado.');
      fetchItems();
    } catch {
      showToast('Error al eliminar.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.descripcion.trim()) {
      showToast('La descripción es obligatoria.', 'error');
      return;
    }
    setSaving(true);
    try {
      const url    = isEditing ? `/api/maquinaria/${form.id}` : '/api/maquinaria';
      const method = isEditing ? 'PUT' : 'POST';
      const res = await apiFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error();
      showToast(isEditing ? 'Activo actualizado.' : 'Activo registrado.');
      resetForm();
      fetchItems();
    } catch {
      showToast('Error al guardar.', 'error');
    } finally {
      setSaving(false);
    }
  };

  // ── Pre-filtering por search bar global ────────────────────────────────────
  // (Los column filters de AuroraDataTable se aplican después)
  const searchFiltered = useMemo(() => {
    const q = filter.toLowerCase().trim();
    if (!q) return items;
    return items.filter(item =>
      item.descripcion?.toLowerCase().includes(q) ||
      item.tipo?.toLowerCase().includes(q) ||
      item.idMaquina?.toLowerCase().includes(q) ||
      item.codigo?.toLowerCase().includes(q),
    );
  }, [items, filter]);

  const fuelBodegaName = bodegas.find(b => b.id === fuelBodegaId)?.nombre || '';

  // ── Render row ─────────────────────────────────────────────────────────────
  const renderRow = (item, visibleCols) => {
    const fuelTasa = tasas[item.id];
    return (
      <>
        {visibleCols.idMaquina   && <td className="machinery-td-code">{item.idMaquina || <span className="machinery-td-empty">—</span>}</td>}
        {visibleCols.codigo      && <td className="machinery-td-code">{item.codigo    || <span className="machinery-td-empty">—</span>}</td>}
        {visibleCols.descripcion && <td>{item.descripcion || <span className="machinery-td-empty">—</span>}</td>}
        {visibleCols.tipo        && <td>{item.tipo ? <span className="machinery-tipo-badge">{item.tipo}</span> : <span className="machinery-td-empty">—</span>}</td>}
        {visibleCols.ubicacion   && <td>{item.ubicacion || <span className="machinery-td-empty">—</span>}</td>}
        {visibleCols.capacidad   && <td className="machinery-td-num">{item.capacidad != null && item.capacidad !== '' ? `${item.capacidad} L` : <span className="machinery-td-empty">—</span>}</td>}
        {visibleCols.valorAdquisicion && <td className="machinery-td-num">{item.valorAdquisicion != null && item.valorAdquisicion !== '' ? `$${Number(item.valorAdquisicion).toLocaleString('es-CR')}` : <span className="machinery-td-empty">—</span>}</td>}
        {visibleCols.valorResidual    && <td className="machinery-td-num">{item.valorResidual    != null && item.valorResidual    !== '' ? `$${Number(item.valorResidual).toLocaleString('es-CR')}`    : <span className="machinery-td-empty">—</span>}</td>}
        {visibleCols.residualPct      && <td className="machinery-td-num">{calcResidualPct(item.valorAdquisicion, item.valorResidual) ?? <span className="machinery-td-empty">—</span>}</td>}
        {visibleCols.vidaUtilHoras    && <td className="machinery-td-num">{item.vidaUtilHoras != null && item.vidaUtilHoras !== '' ? `${Number(item.vidaUtilHoras).toLocaleString('es-CR')} h` : <span className="machinery-td-empty">—</span>}</td>}
        {visibleCols.horasAcumuladas  && <td className="machinery-td-num">{item.horasAcumuladas != null ? `${Number(item.horasAcumuladas).toFixed(1)} h` : <span className="machinery-td-empty">—</span>}</td>}
        {visibleCols.costoDepHora     && <td className="machinery-td-num">{calcCostoDepHora(item.valorAdquisicion, item.valorResidual, item.vidaUtilHoras) ?? <span className="machinery-td-empty">—</span>}</td>}
        {visibleCols.tasaLH && (
          <td className="machinery-td-num">
            {!fuelBodegaId
              ? <span className="machinery-td-empty" title="Sin bodega configurada">—</span>
              : !fuelTasa
                ? <span className="machinery-td-empty">sin mov.</span>
                : fuelTasa.tasaLH != null
                  ? <span className="machinery-fuel-rate" title={`${fuelTasa.litros}L en ${fuelTasa.horas}h`}>{fuelTasa.tasaLH.toFixed(2)} L/H</span>
                  : <span className="machinery-td-empty" title={`${fuelTasa.horas}h registradas, sin salidas de combustible`}>{fuelTasa.horas}h / 0L</span>}
          </td>
        )}
        {visibleCols.fechaRevisionResidual && <td>{item.fechaRevisionResidual || <span className="machinery-td-empty">—</span>}</td>}
        {visibleCols.observacion && <td>{item.observacion ? <span>{item.observacion}</span> : <span className="machinery-td-empty">—</span>}</td>}
      </>
    );
  };

  const trailingCell = (item) => (
    <td className="machinery-td-actions">
      <button
        type="button"
        className="aur-icon-btn aur-icon-btn--sm"
        onClick={() => handleEdit(item)}
        title="Editar"
      >
        <FiEdit size={13} />
      </button>
      <button
        type="button"
        className="aur-icon-btn aur-icon-btn--sm aur-icon-btn--danger"
        onClick={() => setConfirmDelete({ id: item.id, descripcion: item.descripcion })}
        title="Eliminar"
      >
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
          title="Eliminar activo"
          body={`¿Eliminar "${confirmDelete.descripcion}"? Esta acción no se puede deshacer.`}
          confirmLabel="Eliminar"
          onConfirm={doDelete}
          onCancel={() => setConfirmDelete(null)}
          loading={saving}
        />
      )}

      <div className="aur-sheet">
        <header className="aur-sheet-header">
          <div className="aur-sheet-header-text">
            <h1 className="aur-sheet-title">
              {showForm ? (isEditing ? 'Editar activo' : 'Nuevo activo') : 'Activos de maquinaria'}
            </h1>
            <p className="aur-sheet-subtitle">
              {showForm
                ? 'Registra los datos del activo. Los campos calculados se actualizan automáticamente.'
                : `${items.length} activo${items.length !== 1 ? 's' : ''} registrado${items.length !== 1 ? 's' : ''}.`}
            </p>
          </div>
          <div className="aur-sheet-header-actions">
            {showForm ? (
              <button
                type="button"
                className="aur-icon-btn"
                onClick={resetForm}
                title="Cancelar"
              >
                <FiX size={16} />
              </button>
            ) : (
              <button
                type="button"
                className="aur-btn-pill aur-btn-pill--sm"
                onClick={handleNew}
              >
                <FiPlus size={14} /> Nuevo activo
              </button>
            )}
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
                  <label className="aur-row-label" htmlFor="ml-id">ID activo</label>
                  <input
                    id="ml-id"
                    name="idMaquina"
                    className="aur-input"
                    value={form.idMaquina}
                    onChange={handleChange}
                    placeholder="Ej. 0403-0020"
                    maxLength={MAX_ID}
                  />
                </div>
                <div className="aur-row">
                  <label className="aur-row-label" htmlFor="ml-codigo">Código (CC)</label>
                  <input
                    id="ml-codigo"
                    name="codigo"
                    className="aur-input"
                    value={form.codigo}
                    onChange={handleChange}
                    placeholder="Ej. 3-20"
                    maxLength={MAX_CODIGO}
                  />
                </div>
                <div className="aur-row">
                  <label className="aur-row-label" htmlFor="ml-desc">Descripción</label>
                  <input
                    id="ml-desc"
                    name="descripcion"
                    className="aur-input"
                    value={form.descripcion}
                    onChange={handleChange}
                    placeholder="Nombre o descripción del activo"
                    required
                    maxLength={MAX_DESC}
                  />
                </div>
                <div className="aur-row">
                  <label className="aur-row-label" htmlFor="ml-tipo">Tipo</label>
                  <select
                    id="ml-tipo"
                    name="tipo"
                    className="aur-select"
                    value={form.tipo}
                    onChange={handleChange}
                  >
                    <option value="">— Seleccionar —</option>
                    {TIPOS.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div className="aur-row">
                  <label className="aur-row-label" htmlFor="ml-ubic">Ubicación</label>
                  <input
                    id="ml-ubic"
                    name="ubicacion"
                    className="aur-input"
                    value={form.ubicacion}
                    onChange={handleChange}
                    placeholder="Ej. Finca Aurora"
                    maxLength={MAX_UBIC}
                  />
                </div>
              </div>
            </section>

            <section className="aur-section">
              <div className="aur-section-header">
                <h3 className="aur-section-title">Valor y vida útil</h3>
              </div>
              <div className="aur-list">
                <div className="aur-row">
                  <label className="aur-row-label" htmlFor="ml-cap">Capacidad (litros)</label>
                  <input
                    id="ml-cap"
                    name="capacidad"
                    type="number"
                    className="aur-input aur-input--num"
                    min="0"
                    max="1000000"
                    step="1"
                    value={form.capacidad}
                    onChange={handleChange}
                    placeholder="Ej. 500"
                  />
                </div>
                <div className="aur-row">
                  <label className="aur-row-label" htmlFor="ml-vadq">Valor adquisición</label>
                  <input
                    id="ml-vadq"
                    name="valorAdquisicion"
                    type="number"
                    className="aur-input aur-input--num"
                    min="0"
                    max="1000000000000"
                    step="0.01"
                    value={form.valorAdquisicion}
                    onChange={handleChange}
                    placeholder="Ej. 60000"
                  />
                </div>
                <div className="aur-row">
                  <label className="aur-row-label" htmlFor="ml-vres">Valor residual</label>
                  <input
                    id="ml-vres"
                    name="valorResidual"
                    type="number"
                    className="aur-input aur-input--num"
                    min="0"
                    max="1000000000000"
                    step="0.01"
                    value={form.valorResidual}
                    onChange={handleChange}
                    placeholder="Ej. 6000"
                  />
                </div>
                <div className="aur-row">
                  <label className="aur-row-label">Valor residual %</label>
                  <input
                    className="aur-input aur-input--readonly aur-input--num"
                    readOnly
                    tabIndex={-1}
                    value={calcResidualPct(form.valorAdquisicion, form.valorResidual) ?? '—'}
                  />
                </div>
                <div className="aur-row">
                  <label className="aur-row-label" htmlFor="ml-vida">Vida útil (horas)</label>
                  <input
                    id="ml-vida"
                    name="vidaUtilHoras"
                    type="number"
                    className="aur-input aur-input--num"
                    min="0"
                    max="1000000"
                    step="1"
                    value={form.vidaUtilHoras}
                    onChange={handleChange}
                    placeholder="Ej. 10000"
                  />
                </div>
                <div className="aur-row">
                  <label className="aur-row-label">Horas acumuladas</label>
                  <input
                    className="aur-input aur-input--readonly aur-input--num"
                    readOnly
                    tabIndex={-1}
                    value={form.horasAcumuladas !== '' && form.horasAcumuladas != null
                      ? `${Number(form.horasAcumuladas).toFixed(1)} h`
                      : '—'}
                  />
                </div>
                <div className="aur-row">
                  <label className="aur-row-label">Costo dep. / hora</label>
                  <input
                    className="aur-input aur-input--readonly aur-input--num"
                    readOnly
                    tabIndex={-1}
                    value={calcCostoDepHora(form.valorAdquisicion, form.valorResidual, form.vidaUtilHoras) ?? '—'}
                  />
                </div>
                <div className="aur-row">
                  <label className="aur-row-label" htmlFor="ml-rev">Fecha rev. residual</label>
                  <input
                    id="ml-rev"
                    name="fechaRevisionResidual"
                    type="date"
                    className="aur-input"
                    value={form.fechaRevisionResidual}
                    onChange={handleChange}
                  />
                </div>
              </div>
            </section>

            <section className="aur-section">
              <div className="aur-section-header">
                <h3 className="aur-section-title">Observación</h3>
              </div>
              <div className="aur-list">
                <div className="aur-row aur-row--multiline">
                  <label className="aur-row-label" htmlFor="ml-obs">Notas</label>
                  <textarea
                    id="ml-obs"
                    name="observacion"
                    className="aur-textarea"
                    value={form.observacion}
                    onChange={handleChange}
                    placeholder="Estado, notas de mantenimiento, etc."
                    rows={3}
                    maxLength={MAX_OBS}
                  />
                </div>
              </div>
            </section>

            <div className="aur-form-actions">
              <button type="button" className="aur-btn-text" onClick={resetForm}>
                Cancelar
              </button>
              <button type="submit" className="aur-btn-pill" disabled={saving}>
                <FiCheck size={15} /> {saving ? 'Guardando…' : isEditing ? 'Actualizar' : 'Registrar'}
              </button>
            </div>
          </form>
        ) : (
          <>
            <div className="machinery-toolbar">
              <div className="machinery-search-wrap">
                <FiSearch size={14} />
                <input
                  type="text"
                  className="machinery-search-input"
                  placeholder="Buscar por descripción, tipo, ID o código…"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                />
              </div>
              <button
                type="button"
                className={`machinery-fuel-chip${fuelBodegaId ? ' is-configured' : ' is-empty'}`}
                onClick={() => setFuelPopover(p => !p)}
                title={fuelBodegaId
                  ? `Bodega de combustible: ${fuelBodegaName} (clic para cambiar)`
                  : 'Configurar bodega de combustible para calcular L/H'}
              >
                <FiDroplet size={12} />
                {fuelBodegaId ? fuelBodegaName : 'Bodega de combustible'}
              </button>
            </div>

            {loading ? (
              <div className="aur-page-loading" />
            ) : items.length === 0 ? (
              <div className="machinery-empty">
                <FiTool size={40} />
                <p className="machinery-empty-text">No hay activos registrados.</p>
                <p className="machinery-empty-sub">Empieza por registrar tu primer activo de maquinaria.</p>
                <button type="button" className="aur-btn-pill aur-btn-pill--sm" onClick={handleNew}>
                  <FiPlus size={14} /> Agregar el primero
                </button>
              </div>
            ) : (
              <AuroraDataTable
                columns={COLUMNS}
                data={searchFiltered}
                getColVal={getColVal}
                initialSort={{ field: 'descripcion', dir: 'asc' }}
                firstClickDir="asc"
                resultLabel={(filtered, total) => {
                  if (filter.trim() && filtered === total)         return `${total} activo${total !== 1 ? 's' : ''}`;
                  if (filter.trim() && filtered !== total)         return `${filtered} de ${total} (búsqueda)`;
                  if (filtered === items.length)                   return `${filtered} activo${filtered !== 1 ? 's' : ''}`;
                  return `${filtered} de ${items.length} activos`;
                }}
                renderRow={renderRow}
                trailingCell={trailingCell}
                emptyText={filter.trim()
                  ? 'Sin resultados para la búsqueda.'
                  : 'No hay activos con los filtros aplicados.'}
              />
            )}
          </>
        )}
      </div>

      {fuelPopover && createPortal(
        <>
          <div className="aur-filter-backdrop" onClick={() => setFuelPopover(false)} />
          <div className="machinery-fuel-popover" style={{ top: 80, right: 24 }}>
            <div className="machinery-fuel-popover-title">
              <FiDroplet size={11} /> Bodega de combustible
            </div>
            <p className="machinery-fuel-popover-hint">
              Usada para calcular L/H de los últimos 30 días.
            </p>
            {bodegas.length === 0 ? (
              <p className="machinery-fuel-popover-empty">No hay bodegas disponibles.</p>
            ) : (
              bodegas.map(b => (
                <button
                  key={b.id}
                  type="button"
                  className={`machinery-fuel-option${fuelBodegaId === b.id ? ' is-selected' : ''}`}
                  onClick={() => handleFuelBodegaChange(b.id)}
                >
                  {b.nombre}
                </button>
              ))
            )}
            {fuelBodegaId && (
              <button
                type="button"
                className="machinery-fuel-clear"
                onClick={() => handleFuelBodegaChange('')}
              >
                <FiX size={11} /> Quitar bodega
              </button>
            )}
          </div>
        </>,
        document.body,
      )}
    </div>
  );
}

export default MaquinariaList;
