import { useState, useEffect, useMemo } from 'react';
import {
  FiClock, FiPlus, FiX, FiCheck, FiEdit, FiTrash2, FiFilter, FiChevronDown,
} from 'react-icons/fi';
import Toast from '../components/Toast';
import { useApiFetch } from '../hooks/useApiFetch';
import { useUser } from '../contexts/UserContext';
import './Horimetro.css';

const SORT_OPTIONS = [
  { value: '',              label: '— Sin ordenar —' },
  { value: 'fecha',         label: 'Fecha' },
  { value: 'tractorNombre', label: 'Tractor' },
  { value: 'loteNombre',    label: 'Lote' },
  { value: 'operarioNombre',label: 'Operario' },
  { value: 'labor',         label: 'Labor' },
  { value: 'horaInicio',    label: 'Hora de Inicio' },
];

const DRAFT_KEY = 'aurora_horimetro_draft';

const saveDraft  = (form, isEditing) => sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ form, isEditing }));
const clearDraft = () => sessionStorage.removeItem(DRAFT_KEY);
const loadDraft  = () => { try { return JSON.parse(sessionStorage.getItem(DRAFT_KEY)); } catch { return null; } };

const EMPTY_FORM = {
  id: null,
  fecha: new Date().toISOString().slice(0, 10),
  tractorId: '',
  tractorNombre: '',
  implemento: '',
  horimetroInicial: '',
  horimetroFinal: '',
  loteId: '',
  loteNombre: '',
  grupo: '',
  bloques: [],
  labor: '',
  horaInicio: '',
  horaFinal: '',
  operarioId: '',
  operarioNombre: '',
};

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

function horasUsadas(rec) {
  const ini = parseFloat(rec.horimetroInicial);
  const fin = parseFloat(rec.horimetroFinal);
  if (!isNaN(ini) && !isNaN(fin) && fin >= ini) return (fin - ini).toFixed(1);
  return null;
}

function Horimetro() {
  const apiFetch = useApiFetch();
  const { currentUser } = useUser();

  // Catalog data
  const [tractores, setTractores] = useState([]);
  const [lotes, setLotes] = useState([]);
  const [usuarios, setUsuarios] = useState([]);
  const [grupos, setGrupos] = useState([]);
  const [siembras, setSiembras] = useState([]);
  const [labores, setLabores] = useState([]);
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const showToast = (message, type = 'success') => setToast({ message, type });

  // Form — restore draft on mount
  const _draft = loadDraft();
  const [showForm, setShowForm]   = useState(!!_draft);
  const [form, setForm]           = useState(_draft?.form     ?? EMPTY_FORM);
  const [isEditing, setIsEditing] = useState(_draft?.isEditing ?? false);
  const [saving, setSaving]       = useState(false);

  // Filters
  const [filterFechaDesde, setFilterFechaDesde] = useState('');
  const [filterFechaHasta, setFilterFechaHasta] = useState('');
  const [filterOperario, setFilterOperario] = useState('');
  const [filterTractor, setFilterTractor] = useState('');
  const [filterLote, setFilterLote] = useState('');
  const [filterLabor, setFilterLabor] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  // Sorting — 3 levels
  const [sorts, setSorts] = useState([
    { field: 'fecha', dir: 'desc' },
    { field: '',      dir: 'asc' },
    { field: '',      dir: 'asc' },
  ]);

  const fetchRecords = () =>
    apiFetch('/api/horimetro')
      .then(r => r.json())
      .then(data => setRecords(Array.isArray(data) ? data : []))
      .catch(() => showToast('Error al cargar los registros.', 'error'))
      .finally(() => setLoading(false));

  useEffect(() => {
    Promise.all([
      apiFetch('/api/maquinaria').then(r => r.json()),
      apiFetch('/api/lotes').then(r => r.json()),
      apiFetch('/api/users').then(r => r.json()),
      apiFetch('/api/grupos').then(r => r.json()),
      apiFetch('/api/siembras').then(r => r.json()),
      apiFetch('/api/labores').then(r => r.json()),
    ]).then(([maq, lotesData, usersData, gruposData, siembrasData, laboresData]) => {
      setTractores(Array.isArray(maq) ? maq : []);
      setLotes(Array.isArray(lotesData) ? lotesData : []);
      setUsuarios(Array.isArray(usersData) ? usersData : []);
      setGrupos(Array.isArray(gruposData) ? gruposData : []);
      setSiembras(Array.isArray(siembrasData) ? siembrasData : []);
      setLabores(Array.isArray(laboresData) ? laboresData : []);
    }).catch(() => { });
    fetchRecords();
  }, []);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm(prev => {
      const next = { ...prev, [name]: value };
      if (name === 'tractorId') {
        const t = tractores.find(x => x.id === value);
        next.tractorNombre = t ? t.descripcion : '';
      }
      if (name === 'loteId') {
        const l = lotes.find(x => x.id === value);
        next.loteNombre = l ? l.nombreLote : '';
        next.grupo = '';
        next.bloques = [];
      }
      if (name === 'grupo') {
        // auto-select all bloques of the chosen grupo
        const grupoSel = grupos.find(g => g.nombreGrupo === value);
        next.bloques = grupoSel?.bloques
          ?.map(id => siembras.find(s => s.id === id))
          .filter(Boolean)
          .map(s => s.bloque || s.id) ?? [];
      }
      if (name === 'operarioId') {
        const u = usuarios.find(x => x.id === value);
        next.operarioNombre = u ? u.nombre : '';
      }
      saveDraft(next, isEditing);
      return next;
    });
  };

  const toggleBloque = (val) => {
    setForm(prev => {
      const current = prev.bloques || [];
      const next = current.includes(val) ? current.filter(b => b !== val) : [...current, val];
      const newForm = { ...prev, bloques: next };
      saveDraft(newForm, isEditing);
      return newForm;
    });
  };

  const resetForm = () => {
    clearDraft();
    setForm(EMPTY_FORM);
    setIsEditing(false);
    setShowForm(false);
  };

  const handleNew = () => {
    const newForm = {
      ...EMPTY_FORM,
      operarioId: currentUser?.id || '',
      operarioNombre: currentUser?.nombre || '',
    };
    saveDraft(newForm, false);
    setForm(newForm);
    setIsEditing(false);
    setShowForm(true);
  };

  const handleEdit = (rec) => {
    const editForm = { ...EMPTY_FORM, ...rec };
    saveDraft(editForm, true);
    setForm(editForm);
    setIsEditing(true);
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDelete = async (id) => {
    if (!window.confirm('¿Eliminar este registro de horímetro?')) return;
    try {
      const res = await apiFetch(`/api/horimetro/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      showToast('Registro eliminado.');
      fetchRecords();
    } catch {
      showToast('Error al eliminar.', 'error');
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.fecha || !form.tractorId) {
      showToast('Fecha y tractor son obligatorios.', 'error');
      return;
    }
    setSaving(true);
    try {
      const url    = isEditing ? `/api/horimetro/${form.id}` : '/api/horimetro';
      const method = isEditing ? 'PUT' : 'POST';
      const res = await apiFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error();
      showToast(isEditing ? 'Registro actualizado.' : 'Registro guardado.');
      resetForm();
      fetchRecords();
    } catch {
      showToast('Error al guardar.', 'error');
    } finally {
      setSaving(false);
    }
  };

  // ── Derived asset lists ────────────────────────────────────────────────────
  const tractoresLista = useMemo(() =>
    tractores.filter(t => /tractor/i.test(t.tipo) || /otra maquinaria/i.test(t.tipo)),
    [tractores]);

  const implementosLista = useMemo(() =>
    tractores.filter(t => /implemento/i.test(t.tipo)),
    [tractores]);

  const gruposDelLote = useMemo(() => {
    if (!form.loteId) return grupos;
    const siembraIds = new Set(
      siembras.filter(s => s.loteId === form.loteId).map(s => s.id)
    );
    return grupos.filter(g =>
      Array.isArray(g.bloques) && g.bloques.some(bid => siembraIds.has(bid))
    );
  }, [grupos, siembras, form.loteId]);

  const bloquesDelGrupo = useMemo(() => {
    const grupoSel = grupos.find(g => g.nombreGrupo === form.grupo);
    if (!grupoSel || !Array.isArray(grupoSel.bloques)) return [];
    return grupoSel.bloques
      .map(id => siembras.find(s => s.id === id))
      .filter(Boolean);
  }, [grupos, siembras, form.grupo]);

  // ── Filtering ──────────────────────────────────────────────────────────────
  const filtered = useMemo(() => records.filter(r => {
    if (filterFechaDesde && r.fecha < filterFechaDesde) return false;
    if (filterFechaHasta && r.fecha > filterFechaHasta) return false;
    if (filterOperario   && r.operarioId !== filterOperario)   return false;
    if (filterTractor    && r.tractorId  !== filterTractor)    return false;
    if (filterLote       && r.loteId     !== filterLote)       return false;
    if (filterLabor      && !r.labor?.toLowerCase().includes(filterLabor.toLowerCase())) return false;
    return true;
  }), [records, filterFechaDesde, filterFechaHasta, filterOperario, filterTractor, filterLote, filterLabor]);

  const sorted = useMemo(() => multiSort(filtered, sorts), [filtered, sorts]);

  const activeFiltersCount = [
    filterFechaDesde, filterFechaHasta, filterOperario,
    filterTractor, filterLote, filterLabor,
  ].filter(Boolean).length;

  const updateSort = (idx, field) =>
    setSorts(prev => prev.map((s, i) => i === idx ? { ...s, field } : s));

  const updateSortDir = (idx, dir) =>
    setSorts(prev => prev.map((s, i) => i === idx ? { ...s, dir } : s));

  const clearFilters = () => {
    setFilterFechaDesde(''); setFilterFechaHasta('');
    setFilterOperario('');   setFilterTractor('');
    setFilterLote('');       setFilterLabor('');
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="hor-wrap">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {/* ── Form card ── */}
      {showForm ? (
        <div className="hor-form-card">
          <div className="hor-form-header">
            <span>{isEditing ? 'Editar Registro' : 'Nuevo Registro de Horímetro'}</span>
            <button className="hor-close-btn" onClick={resetForm} title="Cancelar">
              <FiX size={16} />
            </button>
          </div>

          <form className="hor-form" onSubmit={handleSubmit}>

            <p className="hor-section-label">Maquinaria</p>
            <div className="hor-form-grid">
              <div className="hor-field">
                <label>Fecha <span className="hor-req">*</span></label>
                <input type="date" name="fecha" value={form.fecha} onChange={handleChange} required />
              </div>

              <div className="hor-field">
                <label>Tractor <span className="hor-req">*</span></label>
                <select name="tractorId" value={form.tractorId} onChange={handleChange} required>
                  <option value="">— Seleccionar —</option>
                  {tractoresLista.map(t => <option key={t.id} value={t.id}>{t.descripcion}</option>)}
                </select>
              </div>

              <div className="hor-field">
                <label>Implemento</label>
                <select name="implemento" value={form.implemento} onChange={handleChange}>
                  <option value="">— Sin implemento —</option>
                  {implementosLista.map(t => <option key={t.id} value={t.descripcion}>{t.descripcion}</option>)}
                </select>
              </div>

              <div className="hor-field">
                <label>Horímetro Inicial</label>
                <input
                  type="number" name="horimetroInicial"
                  value={form.horimetroInicial} onChange={handleChange}
                  min="0" step="0.1" placeholder="0.0"
                />
              </div>

              <div className="hor-field">
                <label>Horímetro Final</label>
                <input
                  type="number" name="horimetroFinal"
                  value={form.horimetroFinal} onChange={handleChange}
                  min="0" step="0.1" placeholder="0.0"
                />
              </div>

              <div className="hor-field">
                <label>Hora de Inicio</label>
                <input type="time" name="horaInicio" value={form.horaInicio} onChange={handleChange} />
              </div>

              <div className="hor-field">
                <label>Hora Final</label>
                <input type="time" name="horaFinal" value={form.horaFinal} onChange={handleChange} />
              </div>
            </div>

            <p className="hor-section-label">Ubicación y Labor</p>
            <div className="hor-form-grid">
              <div className="hor-field">
                <label>Lote</label>
                <select name="loteId" value={form.loteId} onChange={handleChange}>
                  <option value="">— Seleccionar —</option>
                  {lotes.map(l => <option key={l.id} value={l.id}>{l.nombreLote}</option>)}
                </select>
              </div>

              <div className="hor-field">
                <label>Grupo</label>
                <select name="grupo" value={form.grupo} onChange={handleChange}>
                  <option value="">— Sin grupo —</option>
                  {gruposDelLote.map(g => (
                    <option key={g.id} value={g.nombreGrupo}>{g.nombreGrupo}</option>
                  ))}
                </select>
              </div>

              <div className="hor-field hor-field--full">
                <label>Bloques</label>
                {!form.grupo ? (
                  <p className="hor-check-empty">Seleccione un grupo primero.</p>
                ) : bloquesDelGrupo.length === 0 ? (
                  <p className="hor-check-empty">Este grupo no tiene bloques.</p>
                ) : (
                  <div className="hor-check-list">
                    {bloquesDelGrupo.map(s => {
                      const val = s.bloque || s.id;
                      return (
                        <label key={s.id} className="hor-check-row">
                          <input
                            type="checkbox"
                            checked={(form.bloques || []).includes(val)}
                            onChange={() => toggleBloque(val)}
                          />
                          <span>Bloque {s.bloque || s.id}</span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="hor-field hor-field--full">
                <label>Labor</label>
                <select name="labor" value={form.labor} onChange={handleChange}>
                  <option value="">— Seleccionar —</option>
                  {labores.map(l => (
                    <option key={l.id} value={l.descripcion}>
                      {l.codigo ? `${l.codigo} — ${l.descripcion}` : l.descripcion}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <p className="hor-section-label">Operario</p>
            <div className="hor-form-grid">
              <div className="hor-field">
                <label>Operario</label>
                <select name="operarioId" value={form.operarioId} onChange={handleChange}>
                  <option value="">— Seleccionar —</option>
                  {usuarios.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
                </select>
              </div>
            </div>

            <div className="hor-form-actions">
              <button type="button" className="btn btn-secondary" onClick={resetForm}>Cancelar</button>
              <button type="submit" className="btn btn-primary" disabled={saving}>
                <FiCheck size={15} /> {saving ? 'Guardando…' : isEditing ? 'Actualizar' : 'Registrar'}
              </button>
            </div>
          </form>
        </div>
      ) : (
        <div className="hor-toolbar">
          <button className="btn btn-primary" onClick={handleNew}>
            <FiPlus size={15} /> Nuevo
          </button>
        </div>
      )}

      {/* ── Sort + Filter controls ── */}
      <div className="hor-controls">
        <div className="hor-sort-row">
          <span className="hor-control-label">Ordenar por</span>
          {sorts.map((s, i) => (
            <div key={i} className="hor-sort-group">
              {i > 0 && <span className="hor-sort-sep">luego por</span>}
              <select
                className="hor-sort-select"
                value={s.field}
                onChange={e => updateSort(i, e.target.value)}
              >
                {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              {s.field && (
                <select
                  className="hor-sort-dir"
                  value={s.dir}
                  onChange={e => updateSortDir(i, e.target.value)}
                >
                  <option value="asc">↑ Asc</option>
                  <option value="desc">↓ Desc</option>
                </select>
              )}
            </div>
          ))}
        </div>

        <button
          className={`hor-filter-btn${showFilters ? ' active' : ''}`}
          onClick={() => setShowFilters(v => !v)}
        >
          <FiFilter size={14} />
          Filtros
          {activeFiltersCount > 0 && (
            <span className="hor-filter-badge">{activeFiltersCount}</span>
          )}
          <FiChevronDown size={12} className={showFilters ? 'hor-chevron-up' : ''} />
        </button>

        {showFilters && (
          <div className="hor-filters">
            <div className="hor-filter-grid">
              <div className="hor-field">
                <label>Fecha desde</label>
                <input type="date" value={filterFechaDesde} onChange={e => setFilterFechaDesde(e.target.value)} />
              </div>
              <div className="hor-field">
                <label>Fecha hasta</label>
                <input type="date" value={filterFechaHasta} onChange={e => setFilterFechaHasta(e.target.value)} />
              </div>
              <div className="hor-field">
                <label>Operario</label>
                <select value={filterOperario} onChange={e => setFilterOperario(e.target.value)}>
                  <option value="">Todos</option>
                  {usuarios.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
                </select>
              </div>
              <div className="hor-field">
                <label>Tractor / Máquina</label>
                <select value={filterTractor} onChange={e => setFilterTractor(e.target.value)}>
                  <option value="">Todos</option>
                  {tractoresLista.map(t => <option key={t.id} value={t.id}>{t.descripcion}</option>)}
                </select>
              </div>
              <div className="hor-field">
                <label>Lote</label>
                <select value={filterLote} onChange={e => setFilterLote(e.target.value)}>
                  <option value="">Todos</option>
                  {lotes.map(l => <option key={l.id} value={l.id}>{l.nombreLote}</option>)}
                </select>
              </div>
              <div className="hor-field">
                <label>Labor</label>
                <input
                  value={filterLabor}
                  onChange={e => setFilterLabor(e.target.value)}
                  placeholder="Buscar labor…"
                />
              </div>
            </div>
            {activeFiltersCount > 0 && (
              <button className="hor-clear-filters" onClick={clearFilters}>
                Limpiar filtros
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── Historical table ── */}
      <section className="hor-section">
        <div className="hor-section-header">
          <FiClock size={14} />
          <span>Historial de Registros</span>
          {sorted.length > 0 && <span className="hor-count">{sorted.length}</span>}
          {showForm && (
            <button className="hor-add-inline" onClick={handleNew} title="Nuevo registro">
              <FiPlus size={13} />
            </button>
          )}
        </div>

        {loading ? (
          <p className="hor-empty">Cargando…</p>
        ) : sorted.length === 0 ? (
          <div className="hor-empty-state">
            <FiClock size={32} />
            <p>
              {records.length === 0
                ? 'No hay registros aún.'
                : 'Sin resultados para los filtros activos.'}
            </p>
            {records.length === 0 && !showForm && (
              <button className="btn btn-primary" onClick={handleNew}>
                <FiPlus size={14} /> Crear el primero
              </button>
            )}
          </div>
        ) : (
          <div className="hor-table-wrap">
            <table className="hor-table">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Tractor</th>
                  <th>Implemento</th>
                  <th>Hor. Ini.</th>
                  <th>Hor. Fin.</th>
                  <th>Horas</th>
                  <th>Lote</th>
                  <th>Grupo</th>
                  <th>Bloque</th>
                  <th>Labor</th>
                  <th>Inicio</th>
                  <th>Final</th>
                  <th>Operario</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {sorted.map(rec => {
                  const hrs = horasUsadas(rec);
                  return (
                    <tr key={rec.id}>
                      <td className="hor-td-date">{rec.fecha || '—'}</td>
                      <td className="hor-td-maq">{rec.tractorNombre || '—'}</td>
                      <td>{rec.implemento || <span className="hor-td-empty">—</span>}</td>
                      <td className="hor-td-num">{rec.horimetroInicial !== '' && rec.horimetroInicial != null ? rec.horimetroInicial : <span className="hor-td-empty">—</span>}</td>
                      <td className="hor-td-num">{rec.horimetroFinal   !== '' && rec.horimetroFinal   != null ? rec.horimetroFinal   : <span className="hor-td-empty">—</span>}</td>
                      <td className={`hor-td-horas${hrs ? '' : ' hor-td-empty'}`}>{hrs ?? '—'}</td>
                      <td>{rec.loteNombre || <span className="hor-td-empty">—</span>}</td>
                      <td>{rec.grupo      || <span className="hor-td-empty">—</span>}</td>
                      <td>{rec.bloques?.length ? rec.bloques.join(', ') : (rec.bloque || <span className="hor-td-empty">—</span>)}</td>
                      <td className="hor-td-labor">{rec.labor || <span className="hor-td-empty">—</span>}</td>
                      <td className="hor-td-time">{rec.horaInicio || '—'}</td>
                      <td className="hor-td-time">{rec.horaFinal  || '—'}</td>
                      <td>{rec.operarioNombre || <span className="hor-td-empty">—</span>}</td>
                      <td className="hor-td-actions">
                        <button className="hor-btn-icon" onClick={() => handleEdit(rec)} title="Editar">
                          <FiEdit size={13} />
                        </button>
                        <button className="hor-btn-icon hor-btn-danger" onClick={() => handleDelete(rec.id)} title="Eliminar">
                          <FiTrash2 size={13} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

export default Horimetro;
