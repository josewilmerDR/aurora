import { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { FiTool, FiEdit, FiTrash2, FiPlus, FiX, FiCheck, FiFilter, FiSliders, FiDroplet } from 'react-icons/fi';
import Toast from '../components/Toast';
import { useApiFetch } from '../hooks/useApiFetch';
import './MaquinariaList.css';

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

const TIPO_APLICACIONES = 'MAQUINARIA DE APLICACIONES';

const COLUMNS = [
  { id: 'idMaquina',             label: 'ID'                },
  { id: 'codigo',                label: 'CC'                },
  { id: 'descripcion',           label: 'Descripción'       },
  { id: 'tipo',                  label: 'Tipo'              },
  { id: 'ubicacion',             label: 'Ubicación'         },
  { id: 'capacidad',             label: 'Cap. litros',      filterType: 'number' },
  { id: 'valorAdquisicion',      label: 'Val. Adq.',        filterType: 'number' },
  { id: 'valorResidual',         label: 'Val. Residual',    filterType: 'number' },
  { id: 'residualPct',           label: 'Res. %',           plain: true          },
  { id: 'vidaUtilHoras',         label: 'Vida Útil (h)',    filterType: 'number' },
  { id: 'horasAcumuladas',       label: 'Hrs. Acumuladas',  filterType: 'number' },
  { id: 'costoDepHora',          label: 'Costo Dep./h',     plain: true          },
  { id: 'tasaLH',                label: 'L/H (30d)',        plain: true          },
  { id: 'fechaRevisionResidual', label: 'Rev. Residual',    filterType: 'date'   },
  { id: 'observacion',           label: 'Observación'       },
];

const FUEL_BODEGA_KEY = 'aurora_fuel_bodegaId';

function compare(a, b, field) {
  const av = a[field] ?? '';
  const bv = b[field] ?? '';
  if (typeof av === 'number' && typeof bv === 'number') return av - bv;
  return String(av).toLowerCase().localeCompare(String(bv).toLowerCase());
}

function multiSort(records, sorts) {
  const active = sorts.filter(s => s.field);
  if (!active.length) return [...records];
  return [...records].sort((a, b) => {
    for (const s of active) {
      const r = compare(a, b, s.field);
      if (r !== 0) return s.dir === 'desc' ? -r : r;
    }
    return 0;
  });
}

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

  // ── Tasas de combustible ───────────────────────────────────────────────────
  const [bodegas,       setBodegas]       = useState([]);
  const [fuelBodegaId,  setFuelBodegaId]  = useState(() => localStorage.getItem(FUEL_BODEGA_KEY) || '');
  const [tasas,         setTasas]         = useState({});       // { [maquinaId]: { tasaLH, ... } }
  const [fuelPopover,   setFuelPopover]   = useState(false);    // selector de bodega

  const [colFilters,    setColFilters]    = useState({});
  const [filterPopover, setFilterPopover] = useState(null);
  const [hiddenCols,    setHiddenCols]    = useState(new Set());
  const [colMenu,       setColMenu]       = useState(null);
  const [sorts, setSorts] = useState([{ field: 'descripcion', dir: 'asc' }]);

  const showToast = (message, type = 'success') => setToast({ message, type });

  const fetchItems = () =>
    apiFetch('/api/maquinaria')
      .then(r => r.json())
      .then(setItems)
      .catch(() => showToast('Error al cargar la lista de maquinaria.', 'error'))
      .finally(() => setLoading(false));

  useEffect(() => { fetchItems(); }, []);

  // Cargar bodegas (para el selector de bodega de combustible)
  useEffect(() => {
    apiFetch('/api/bodegas')
      .then(r => r.json())
      .then(data => setBodegas(Array.isArray(data) ? data.filter(b => b.tipo !== 'agroquimicos') : []))
      .catch(() => {});
  }, []);

  // Cargar tasas de combustible cuando cambia la bodega seleccionada
  useEffect(() => {
    if (!fuelBodegaId) { setTasas({}); return; }
    apiFetch(`/api/maquinaria/tasas-combustible?bodegaId=${fuelBodegaId}`)
      .then(r => r.json())
      .then(data => setTasas(data.tasas || {}))
      .catch(() => {});
  }, [fuelBodegaId]);

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
    const editForm = { ...EMPTY_FORM, ...item };
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

  const handleDelete = async (id, descripcion) => {
    if (!window.confirm(`¿Eliminar "${descripcion}"?`)) return;
    try {
      const res = await apiFetch(`/api/maquinaria/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      showToast('Activo eliminado.');
      fetchItems();
    } catch {
      showToast('Error al eliminar.', 'error');
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
      const url = isEditing ? `/api/maquinaria/${form.id}` : '/api/maquinaria';
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

  // ── Filtering ──────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = filter.toLowerCase();
    const activeCol = Object.entries(colFilters).filter(([, f]) => {
      if (!f) return false;
      if (f.type === 'range') return !!(f.from?.trim() || f.to?.trim());
      return !!f.value?.trim();
    });
    return items.filter(item => {
      // global search bar
      if (q && !(
        item.descripcion?.toLowerCase().includes(q) ||
        item.tipo?.toLowerCase().includes(q) ||
        item.idMaquina?.toLowerCase().includes(q) ||
        item.codigo?.toLowerCase().includes(q)
      )) return false;
      // column filters
      for (const [field, fil] of activeCol) {
        const cell = item[field];
        if (fil.type === 'range') {
          if (cell == null || cell === '') return false;
          const num = Number(cell);
          if (!isNaN(num)) {
            if (fil.from !== '' && fil.from != null && num < Number(fil.from)) return false;
            if (fil.to   !== '' && fil.to   != null && num > Number(fil.to))   return false;
          } else {
            const str = String(cell);
            if (fil.from && str < fil.from) return false;
            if (fil.to   && str > fil.to)   return false;
          }
        } else {
          if (cell == null) return false;
          if (!String(cell).toLowerCase().includes(fil.value.toLowerCase())) return false;
        }
      }
      return true;
    });
  }, [items, filter, colFilters]);

  const sorted = useMemo(() => multiSort(filtered, sorts), [filtered, sorts]);

  const handleThSort = (field) => {
    setSorts(prev => {
      const next = [...prev];
      next[0] = next[0].field === field
        ? { field, dir: next[0].dir === 'asc' ? 'desc' : 'asc' }
        : { field, dir: 'asc' };
      return next;
    });
  };

  const openFilter = (e, field, filterType = 'text') => {
    e.stopPropagation();
    if (filterPopover?.field === field) { setFilterPopover(null); return; }
    const th   = e.currentTarget.closest('th') ?? e.currentTarget;
    const rect = th.getBoundingClientRect();
    setFilterPopover({ field, x: rect.left, y: rect.bottom + 4, filterType });
  };

  const openColMenu = (e) => {
    e.preventDefault();
    setColMenu({ x: e.clientX, y: e.clientY });
  };

  const toggleCol = (id) => {
    setHiddenCols(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleColBtnClick = (e) => {
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    setColMenu(prev => prev ? null : { x: r.right - 190, y: r.bottom + 4 });
  };

  const setColFilter = (field, filterObj) => {
    const empty = !filterObj ||
      (filterObj.type === 'range' ? !filterObj.from?.trim() && !filterObj.to?.trim() : !filterObj.value?.trim());
    setColFilters(prev => empty
      ? Object.fromEntries(Object.entries(prev).filter(([k]) => k !== field))
      : { ...prev, [field]: filterObj }
    );
  };

  const hiddenCount = hiddenCols.size;
  const hasActiveColFilters = Object.values(colFilters).some(f =>
    f && (f.type === 'range' ? f.from?.trim() || f.to?.trim() : f.value?.trim())
  );

  // ── Sort+filter column header ──────────────────────────────────────────────
  const SortTh = ({ field, children, filterType = 'text' }) => {
    const active = sorts[0].field === field;
    const dir    = active ? sorts[0].dir : null;
    const f      = colFilters[field];
    const hasFilter = f
      ? (f.type === 'range' ? !!(f.from?.trim() || f.to?.trim()) : !!f.value?.trim())
      : false;
    return (
      <th
        className={`maq-th-sortable${active ? ' is-sorted' : ''}${hasFilter ? ' has-col-filter' : ''}`}
        onClick={() => handleThSort(field)}
      >
        {children}
        <span className="maq-th-arrow">{active ? (dir === 'asc' ? '↑' : '↓') : '↕'}</span>
        <span
          className={`maq-th-funnel${hasFilter ? ' is-active' : ''}`}
          onClick={e => openFilter(e, field, filterType)}
          title="Filtrar columna"
        >
          <FiFilter size={10} />
        </span>
      </th>
    );
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <>
    <div className="maq-wrap">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {/* ── Formulario ── */}
      {!showForm ? (
        <div className="maq-toolbar">
          <input
            className="maq-search"
            placeholder="Buscar por descripción, tipo o ID…"
            value={filter}
            onChange={e => setFilter(e.target.value)}
          />
          <button className="btn btn-primary" onClick={handleNew}>
            <FiPlus size={15} /> Nuevo Activo
          </button>
        </div>
      ) : (
        <div className="maq-form-card">
          <div className="maq-form-header">
            <span>{isEditing ? 'Editar Activo' : 'Nuevo Activo'}</span>
            <button className="maq-close-btn" onClick={resetForm} title="Cancelar">
              <FiX size={16} />
            </button>
          </div>

          <form className="maq-form" onSubmit={handleSubmit}>
            <div className="maq-form-grid">
              <div className="maq-field">
                <label>ID Activo</label>
                <input
                  name="idMaquina"
                  value={form.idMaquina}
                  onChange={handleChange}
                  placeholder="Ej. 0403-0020"
                />
              </div>

              <div className="maq-field">
                <label>Código (CC)</label>
                <input
                  name="codigo"
                  value={form.codigo}
                  onChange={handleChange}
                  placeholder="Ej. 3-20"
                />
              </div>

              <div className="maq-field maq-field--full">
                <label>Descripción <span className="maq-required">*</span></label>
                <input
                  name="descripcion"
                  value={form.descripcion}
                  onChange={handleChange}
                  placeholder="Nombre o descripción del activo"
                  required
                />
              </div>

              <div className="maq-field">
                <label>Cap. litros</label>
                <input
                  name="capacidad"
                  type="number"
                  min="0"
                  step="1"
                  value={form.capacidad}
                  onChange={handleChange}
                  placeholder="Ej. 500"
                />
              </div>

              <div className="maq-field">
                <label>Valor Adquisición</label>
                <input
                  name="valorAdquisicion"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.valorAdquisicion}
                  onChange={handleChange}
                  placeholder="Ej. 60000"
                />
              </div>

              <div className="maq-field">
                <label>Valor Residual</label>
                <input
                  name="valorResidual"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.valorResidual}
                  onChange={handleChange}
                  placeholder="Ej. 6000"
                />
              </div>

              <div className="maq-field maq-field--computed">
                <label>Valor Residual %</label>
                <input
                  readOnly
                  tabIndex={-1}
                  value={calcResidualPct(form.valorAdquisicion, form.valorResidual) ?? '—'}
                />
              </div>

              <div className="maq-field">
                <label>Vida Útil (horas)</label>
                <input
                  name="vidaUtilHoras"
                  type="number"
                  min="0"
                  step="1"
                  value={form.vidaUtilHoras}
                  onChange={handleChange}
                  placeholder="Ej. 10000"
                />
              </div>

              <div className="maq-field maq-field--computed">
                <label>Hrs. Acumuladas</label>
                <input
                  readOnly
                  tabIndex={-1}
                  value={form.horasAcumuladas !== '' && form.horasAcumuladas != null
                    ? `${Number(form.horasAcumuladas).toFixed(1)} h`
                    : '—'}
                />
              </div>

              <div className="maq-field maq-field--computed">
                <label>Costo Dep. / Hora</label>
                <input
                  readOnly
                  tabIndex={-1}
                  value={calcCostoDepHora(form.valorAdquisicion, form.valorResidual, form.vidaUtilHoras) ?? '—'}
                />
              </div>

              <div className="maq-field">
                <label>Fecha Rev. Residual</label>
                <input
                  name="fechaRevisionResidual"
                  type="date"
                  value={form.fechaRevisionResidual}
                  onChange={handleChange}
                />
              </div>

              <div className="maq-field">
                <label>Tipo</label>
                <select name="tipo" value={form.tipo} onChange={handleChange}>
                  <option value="">— Seleccionar —</option>
                  {TIPOS.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>

              <div className="maq-field">
                <label>Ubicación</label>
                <input
                  name="ubicacion"
                  value={form.ubicacion}
                  onChange={handleChange}
                  placeholder="Ej. Finca Aurora"
                />
              </div>

              <div className="maq-field maq-field--full">
                <label>Observación</label>
                <textarea
                  name="observacion"
                  value={form.observacion}
                  onChange={handleChange}
                  placeholder="Estado, notas de mantenimiento, etc."
                  rows={2}
                />
              </div>
            </div>

            <div className="maq-form-actions">
              <button type="button" className="btn btn-secondary" onClick={resetForm}>
                Cancelar
              </button>
              <button type="submit" className="btn btn-primary" disabled={saving}>
                <FiCheck size={15} /> {saving ? 'Guardando…' : isEditing ? 'Actualizar' : 'Registrar'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ── Tabla ── */}
      <section className="maq-section">
        <div className="maq-section-header">
          <FiTool size={14} />
          <span>Activos registrados</span>
          {items.length > 0 && <span className="maq-count">{items.length}</span>}
          {showForm && (
            <button className="maq-add-inline" onClick={handleNew} title="Nuevo activo">
              <FiPlus size={13} />
            </button>
          )}
          {hasActiveColFilters && (
            <button className="maq-clear-col-filters" onClick={() => setColFilters({})}>
              <FiX size={11} />
              Limpiar filtros de columna
            </button>
          )}
        </div>

        {loading ? (
          <p className="maq-empty">Cargando…</p>
        ) : sorted.length === 0 ? (
          <div className="maq-empty-state">
            <FiTool size={32} />
            <p>{items.length === 0 ? 'No hay activos registrados.' : 'Sin resultados para la búsqueda.'}</p>
            {items.length === 0 && (
              <button className="btn btn-primary" onClick={handleNew}>
                <FiPlus size={14} /> Agregar el primero
              </button>
            )}
          </div>
        ) : (
          <div className="maq-table-wrap">
            <table className="maq-table">
              <thead>
                <tr onContextMenu={openColMenu}>
                  {COLUMNS.map(col => {
                    if (hiddenCols.has(col.id)) return null;
                    if (col.id === 'tasaLH') return (
                      <th key="tasaLH" className="maq-th-fuel">
                        {fuelBodegaId ? (
                          <>
                            <span>L/H (30d)</span>
                            <button
                              className="maq-fuel-cfg-btn is-configured"
                              onClick={e => { e.stopPropagation(); setFuelPopover(p => !p); }}
                              title="Cambiar bodega de combustible"
                            >
                              <FiDroplet size={11} />
                            </button>
                          </>
                        ) : (
                          <button
                            className="maq-fuel-cfg-prompt"
                            onClick={e => { e.stopPropagation(); setFuelPopover(p => !p); }}
                            title="Seleccionar bodega de combustible"
                          >
                            <FiDroplet size={12} />
                            <span>L/H (30d)</span>
                          </button>
                        )}
                      </th>
                    );
                    if (col.plain) return <th key={col.id}>{col.label}</th>;
                    return <SortTh key={col.id} field={col.id} filterType={col.filterType}>{col.label}</SortTh>;
                  })}
                  <th className="maq-th-settings">
                    <button
                      className={`maq-col-toggle-btn${hiddenCount > 0 ? ' maq-col-toggle-btn--active' : ''}`}
                      onClick={handleColBtnClick}
                      title="Personalizar columnas visibles"
                    >
                      <FiSliders size={12} />
                      {hiddenCount > 0 && <span className="maq-col-hidden-badge">{hiddenCount}</span>}
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {sorted.map(item => (
                  <tr key={item.id}>
                    {!hiddenCols.has('idMaquina')             && <td className="maq-td-code">{item.idMaquina || '—'}</td>}
                    {!hiddenCols.has('codigo')                && <td className="maq-td-code">{item.codigo || '—'}</td>}
                    {!hiddenCols.has('descripcion')           && <td className="maq-td-desc">{item.descripcion}</td>}
                    {!hiddenCols.has('tipo')                  && <td>{item.tipo ? <span className="maq-tipo-badge">{item.tipo}</span> : <span className="maq-td-empty">—</span>}</td>}
                    {!hiddenCols.has('ubicacion')             && <td>{item.ubicacion || <span className="maq-td-empty">—</span>}</td>}
                    {!hiddenCols.has('capacidad')             && <td>{item.capacidad ? `${item.capacidad} L` : <span className="maq-td-empty">—</span>}</td>}
                    {!hiddenCols.has('valorAdquisicion')      && <td className="maq-td-num">{item.valorAdquisicion ? `$${Number(item.valorAdquisicion).toLocaleString('es-CR')}` : <span className="maq-td-empty">—</span>}</td>}
                    {!hiddenCols.has('valorResidual')         && <td className="maq-td-num">{item.valorResidual ? `$${Number(item.valorResidual).toLocaleString('es-CR')}` : <span className="maq-td-empty">—</span>}</td>}
                    {!hiddenCols.has('residualPct')           && <td className="maq-td-num">{calcResidualPct(item.valorAdquisicion, item.valorResidual) ?? <span className="maq-td-empty">—</span>}</td>}
                    {!hiddenCols.has('vidaUtilHoras')         && <td className="maq-td-num">{item.vidaUtilHoras ? `${Number(item.vidaUtilHoras).toLocaleString('es-CR')} h` : <span className="maq-td-empty">—</span>}</td>}
                    {!hiddenCols.has('horasAcumuladas')       && <td className="maq-td-num">{item.horasAcumuladas != null ? `${Number(item.horasAcumuladas).toFixed(1)} h` : <span className="maq-td-empty">—</span>}</td>}
                    {!hiddenCols.has('costoDepHora')          && <td className="maq-td-num">{calcCostoDepHora(item.valorAdquisicion, item.valorResidual, item.vidaUtilHoras) ?? <span className="maq-td-empty">—</span>}</td>}
                    {!hiddenCols.has('tasaLH') && (() => {
                      const t = tasas[item.id];
                      if (!fuelBodegaId) return <td key="fuel" className="maq-td-num"><span className="maq-td-empty" title="Sin bodega configurada">—</span></td>;
                      if (!t)           return <td key="fuel" className="maq-td-num"><span className="maq-td-empty">sin mov.</span></td>;
                      return (
                        <td key="fuel" className="maq-td-num">
                          {t.tasaLH !== null
                            ? <span className="maq-fuel-badge" title={`${t.litros}L en ${t.horas}h`}>{t.tasaLH.toFixed(2)} L/H</span>
                            : <span className="maq-td-empty" title={`${t.horas}h registradas, sin salidas de combustible`}>{t.horas}h / 0L</span>
                          }
                        </td>
                      );
                    })()}
                    {!hiddenCols.has('fechaRevisionResidual') && <td>{item.fechaRevisionResidual || <span className="maq-td-empty">—</span>}</td>}
                    {!hiddenCols.has('observacion')           && <td className="maq-td-obs">{item.observacion || <span className="maq-td-empty">—</span>}</td>}
                    <td className="maq-td-actions">
                      <button className="maq-btn-icon" onClick={() => handleEdit(item)} title="Editar">
                        <FiEdit size={13} />
                      </button>
                      <button className="maq-btn-icon maq-btn-danger" onClick={() => handleDelete(item.id, item.descripcion)} title="Eliminar">
                        <FiTrash2 size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>

    {fuelPopover && createPortal(
      <>
        <div className="maq-filter-backdrop" onClick={() => setFuelPopover(false)} />
        <div className="maq-fuel-popover">
          <div className="maq-fuel-popover-title">
            <FiDroplet size={13} /> Bodega de combustible
          </div>
          <div className="maq-fuel-popover-hint">
            Usada para calcular L/H de los últimos 30 días.
          </div>
          {bodegas.length === 0 ? (
            <p className="maq-fuel-popover-empty">No hay bodegas disponibles.</p>
          ) : (
            bodegas.map(b => (
              <button
                key={b.id}
                className={`maq-fuel-option${fuelBodegaId === b.id ? ' is-selected' : ''}`}
                onClick={() => handleFuelBodegaChange(b.id)}
              >
                {b.nombre}
              </button>
            ))
          )}
          {fuelBodegaId && (
            <button className="maq-fuel-clear" onClick={() => handleFuelBodegaChange('')}>
              <FiX size={11} /> Quitar bodega
            </button>
          )}
        </div>
      </>,
      document.body
    )}

    {filterPopover && createPortal(
      <>
        <div className="maq-filter-backdrop" onClick={() => setFilterPopover(null)} />
        <div
          className={`maq-filter-popover${filterPopover.filterType !== 'text' ? ' maq-filter-popover--range' : ''}`}
          style={{ left: filterPopover.x, top: filterPopover.y }}
        >
          <FiFilter size={13} className="maq-filter-popover-icon" />
          {filterPopover.filterType !== 'text' ? (
            <>
              <div className="maq-filter-range">
                <div className="maq-filter-range-row">
                  <span className="maq-filter-range-label">De</span>
                  <input
                    autoFocus
                    type={filterPopover.filterType}
                    className="maq-filter-input"
                    value={colFilters[filterPopover.field]?.from || ''}
                    onChange={e => setColFilter(filterPopover.field, {
                      type: 'range',
                      from: e.target.value,
                      to: colFilters[filterPopover.field]?.to || '',
                    })}
                    onKeyDown={e => { if (e.key === 'Escape') setFilterPopover(null); }}
                  />
                </div>
                <div className="maq-filter-range-row">
                  <span className="maq-filter-range-label">A</span>
                  <input
                    type={filterPopover.filterType}
                    className="maq-filter-input"
                    value={colFilters[filterPopover.field]?.to || ''}
                    onChange={e => setColFilter(filterPopover.field, {
                      type: 'range',
                      from: colFilters[filterPopover.field]?.from || '',
                      to: e.target.value,
                    })}
                    onKeyDown={e => { if (e.key === 'Escape') setFilterPopover(null); }}
                  />
                </div>
              </div>
              {(colFilters[filterPopover.field]?.from || colFilters[filterPopover.field]?.to) && (
                <button className="maq-filter-clear" title="Limpiar filtro" onClick={() => { setColFilter(filterPopover.field, null); setFilterPopover(null); }}>
                  <FiX size={13} />
                </button>
              )}
            </>
          ) : (
            <>
              <input
                autoFocus
                className="maq-filter-input"
                placeholder="Filtrar…"
                value={colFilters[filterPopover.field]?.value || ''}
                onChange={e => setColFilter(filterPopover.field, { type: 'text', value: e.target.value })}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') setFilterPopover(null); }}
              />
              {colFilters[filterPopover.field]?.value && (
                <button className="maq-filter-clear" title="Limpiar filtro" onClick={() => { setColFilter(filterPopover.field, null); setFilterPopover(null); }}>
                  <FiX size={13} />
                </button>
              )}
            </>
          )}
        </div>
      </>,
      document.body
    )}

    {colMenu && createPortal(
      <>
        <div className="maq-col-menu-backdrop" onClick={() => setColMenu(null)} />
        <div className="maq-col-menu" style={{ left: colMenu.x, top: colMenu.y }}>
          <div className="maq-col-menu-title">Columnas visibles</div>
          {COLUMNS.map(col => (
            <button
              key={col.id}
              className={`maq-col-menu-item${hiddenCols.has(col.id) ? ' is-hidden' : ''}`}
              onClick={() => toggleCol(col.id)}
            >
              <span className="maq-col-menu-check" />
              {col.label}
            </button>
          ))}
          {hiddenCols.size > 0 && (
            <button className="maq-col-menu-reset" onClick={() => { setHiddenCols(new Set()); setColMenu(null); }}>
              Mostrar todas
            </button>
          )}
        </div>
      </>,
      document.body
    )}
    </>
  );
}

export default MaquinariaList;
