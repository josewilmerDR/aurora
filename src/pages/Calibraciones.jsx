import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { FiDroplet, FiEdit, FiTrash2, FiPlus, FiX, FiCheck, FiSliders } from 'react-icons/fi';
import Toast from '../components/Toast';
import ConfirmModal from '../components/ConfirmModal';
import { useApiFetch } from '../hooks/useApiFetch';
import './Calibraciones.css';

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

// Columnas visibles en la tabla (sin la columna de acciones)
const COLUMNS = [
  { key: 'nombre',          label: 'Nombre' },
  { key: 'fecha',           label: 'Fecha' },
  { key: 'tractor',         label: 'Tractor' },
  { key: 'aplicador',       label: 'Aplicador' },
  { key: 'volumen',         label: 'Volumen' },
  { key: 'rpm',             label: 'RPM' },
  { key: 'marcha',          label: 'Marcha' },
  { key: 'boquilla',        label: 'Boquilla' },
  { key: 'presion',         label: 'Presión' },
  { key: 'velocidad',       label: 'Km/H' },
  { key: 'responsable',     label: 'Responsable' },
  { key: 'metodo',          label: 'Método' },
];

const ALL_VISIBLE = Object.fromEntries(COLUMNS.map(c => [c.key, true]));

// ── Helper: etiqueta de activo ─────────────────────────────────────────────────
const labelFor = (activo) =>
  activo ? `${activo.codigo ? activo.codigo + ': ' : ''}${activo.descripcion}` : '';

// ── Combobox de activos con portal ─────────────────────────────────────────────
function ActivoCombobox({ value, onChange, activos, placeholder = '— Seleccionar activo —' }) {
  const nameFor = useCallback(
    (id) => { const a = activos.find(a => a.id === id); return a ? labelFor(a) : ''; },
    [activos]
  );

  const [text, setText]       = useState(() => nameFor(value));
  const [open, setOpen]       = useState(false);
  const [hi,   setHi]         = useState(0);
  const [dropPos, setDropPos] = useState({ top: 0, left: 0, width: 0 });
  const inputRef              = useRef(null);
  const listRef               = useRef(null);
  const userTyping            = useRef(false);

  useEffect(() => {
    if (userTyping.current) { userTyping.current = false; return; }
    setText(nameFor(value));
  }, [value, nameFor]);

  const filtered = activos.filter(a => {
    if (!text) return true;
    const q = text.toLowerCase();
    return (
      a.descripcion?.toLowerCase().includes(q) ||
      a.codigo?.toLowerCase().includes(q) ||
      a.idMaquina?.toLowerCase().includes(q)
    );
  });

  const openDropdown = () => {
    if (inputRef.current) {
      const r = inputRef.current.getBoundingClientRect();
      setDropPos({ top: r.bottom + window.scrollY + 2, left: r.left + window.scrollX, width: r.width });
    }
    setOpen(true);
    setHi(0);
  };

  const selectOption = (activo) => {
    setText(labelFor(activo));
    setOpen(false);
    setHi(0);
    onChange(activo.id);
  };

  const handleChange = (e) => {
    userTyping.current = true;
    setText(e.target.value);
    openDropdown();
    if (value) onChange('');
  };

  const handleBlur = () => {
    setTimeout(() => {
      if (document.activeElement !== inputRef.current) {
        setOpen(false);
        setText(nameFor(value));
      }
    }, 150);
  };

  const handleKeyDown = (e) => {
    if (!open) {
      if (e.key === 'ArrowDown') { openDropdown(); e.preventDefault(); }
      return;
    }
    if (e.key === 'ArrowDown') {
      setHi(h => {
        const n = Math.min(h + 1, filtered.length - 1);
        listRef.current?.children[n]?.scrollIntoView({ block: 'nearest' });
        return n;
      });
      e.preventDefault();
    } else if (e.key === 'ArrowUp') {
      setHi(h => {
        const n = Math.max(h - 1, 0);
        listRef.current?.children[n]?.scrollIntoView({ block: 'nearest' });
        return n;
      });
      e.preventDefault();
    } else if (e.key === 'Enter') {
      if (filtered[hi]) { selectOption(filtered[hi]); e.preventDefault(); }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  useEffect(() => {
    const handler = (e) => {
      if (
        inputRef.current && !inputRef.current.contains(e.target) &&
        listRef.current  && !listRef.current.contains(e.target)
      ) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <>
      <input
        ref={inputRef}
        className="cal-combo-input"
        value={text}
        autoComplete="off"
        placeholder={placeholder}
        onChange={handleChange}
        onFocus={openDropdown}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
      />
      {open && filtered.length > 0 && createPortal(
        <ul
          ref={listRef}
          className="cal-activo-dropdown"
          style={{ top: dropPos.top, left: dropPos.left, minWidth: dropPos.width }}
        >
          {filtered.map((a, i) => (
            <li
              key={a.id}
              className={`cal-activo-dropdown-item${i === hi ? ' cal-activo-dropdown-item--active' : ''}`}
              onMouseDown={() => selectOption(a)}
              onMouseEnter={() => setHi(i)}
            >
              {labelFor(a)}
            </li>
          ))}
        </ul>,
        document.body
      )}
    </>
  );
}

// ── Menú contextual de columnas ────────────────────────────────────────────────
function ColMenu({ x, y, visibleCols, onToggle, onClose }) {
  const menuRef = useRef(null);

  // Cerrar al hacer clic fuera o al presionar Escape
  useEffect(() => {
    const onDown = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) onClose();
    };
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  // Ajustar posición para no salirse del viewport
  const style = { position: 'fixed', top: y, left: x };

  return createPortal(
    <div ref={menuRef} className="cal-col-menu" style={style}>
      <div className="cal-col-menu-title">Columnas visibles</div>
      {COLUMNS.map(col => {
        const checked = visibleCols[col.key];
        // Impedir ocultar la última columna visible
        const isLast = checked && Object.values(visibleCols).filter(Boolean).length === 1;
        return (
          <label
            key={col.key}
            className={`cal-col-menu-item${isLast ? ' cal-col-menu-item--disabled' : ''}`}
          >
            <input
              type="checkbox"
              checked={checked}
              disabled={isLast}
              onChange={() => !isLast && onToggle(col.key)}
            />
            <span>{col.label}</span>
          </label>
        );
      })}
    </div>,
    document.body
  );
}

// ── Página principal ───────────────────────────────────────────────────────────
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
  const [visibleCols, setVisibleCols] = useState(ALL_VISIBLE);
  const [colMenu, setColMenu]   = useState(null); // { x, y }
  const [draftSaved, setDraftSaved] = useState(false); // true while form is open and auto-saving

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
      .then(setItems)
      .catch(() => showToast('Error al cargar calibraciones.', 'error'))
      .finally(() => setLoading(false));

  useEffect(() => {
    fetchItems();
    apiFetch('/api/maquinaria').then(r => r.json()).then(setActivos).catch(() => {});
  }, []);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm(prev => ({ ...prev, [name]: value }));
  };

  const handleTractorChange = (id) => {
    const a = activos.find(a => a.id === id);
    setForm(prev => ({ ...prev, tractorId: id, tractorNombre: a ? a.descripcion : '' }));
  };

  const handleAplicadorChange = (id) => {
    const a = activos.find(a => a.id === id);
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

  const formatFecha = (fecha) => {
    if (!fecha) return '—';
    const [y, m, d] = fecha.split('-');
    return `${d}/${m}/${y}`;
  };

  const hiddenCount = COLUMNS.filter(c => !visibleCols[c.key]).length;

  const handleHeaderRightClick = (e) => {
    e.preventDefault();
    setColMenu({ x: e.clientX, y: e.clientY });
  };

  const handleColBtnClick = (e) => {
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    setColMenu({ x: r.right - 180, y: r.bottom + 4 });
  };

  const toggleCol = (key) => {
    setVisibleCols(prev => ({ ...prev, [key]: !prev[key] }));
  };

  // Celda de cada columna para una fila
  const renderCell = (item, key) => {
    switch (key) {
      case 'nombre':      return <td key={key} className="cal-td-nombre">{item.nombre}</td>;
      case 'fecha':       return <td key={key} className="cal-td-secondary">{formatFecha(item.fecha)}</td>;
      case 'tractor':     return <td key={key}>{item.tractorNombre    || <span className="cal-td-empty">—</span>}</td>;
      case 'aplicador':   return <td key={key}>{item.aplicadorNombre  || <span className="cal-td-empty">—</span>}</td>;
      case 'volumen':     return <td key={key} className="cal-td-secondary">{item.volumen != null && item.volumen !== '' ? item.volumen : <span className="cal-td-empty">—</span>}</td>;
      case 'rpm':         return <td key={key} className="cal-td-secondary">{item.rpmRecomendado   || <span className="cal-td-empty">—</span>}</td>;
      case 'marcha':      return <td key={key} className="cal-td-secondary">{item.marchaRecomendada || <span className="cal-td-empty">—</span>}</td>;
      case 'boquilla':    return <td key={key} className="cal-td-secondary">{item.tipoBoquilla      || <span className="cal-td-empty">—</span>}</td>;
      case 'presion':     return <td key={key} className="cal-td-secondary">{item.presionRecomendada || <span className="cal-td-empty">—</span>}</td>;
      case 'velocidad':   return (
        <td key={key} className="cal-td-secondary">
          {item.velocidadKmH != null && item.velocidadKmH !== ''
            ? item.velocidadKmH
            : <span className="cal-td-empty">—</span>}
        </td>
      );
      case 'responsable': return <td key={key}>{item.responsableNombre || <span className="cal-td-empty">—</span>}</td>;
      case 'metodo':      return <td key={key}>{item.metodo || <span className="cal-td-empty">—</span>}</td>;
      default:            return null;
    }
  };

  const visibleList = COLUMNS.filter(c => visibleCols[c.key]);

  return (
    <div className="cal-wrap">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {confirmDelete && (
        <ConfirmModal
          title="Eliminar calibración"
          message={`¿Eliminar la calibración "${confirmDelete.nombre}"? Esta acción no se puede deshacer.`}
          onConfirm={confirmDoDelete}
          onCancel={() => setConfirmDelete(null)}
          loading={saving}
        />
      )}

      {colMenu && (
        <ColMenu
          x={colMenu.x}
          y={colMenu.y}
          visibleCols={visibleCols}
          onToggle={toggleCol}
          onClose={() => setColMenu(null)}
        />
      )}

      {/* ── Formulario ── */}
      {showForm && (
        <div className="cal-form-card" ref={formRef}>
          <div className="cal-form-header">
            <span>
              {isEditing ? 'Editar Calibración' : 'Nueva Calibración'}
              {draftSaved && <span className="cal-draft-tag">borrador</span>}
            </span>
            <button className="cal-close-btn" onClick={resetForm} title="Cancelar">
              <FiX size={16} />
            </button>
          </div>

          <form className="cal-form" onSubmit={handleSubmit}>
            <div className="cal-form-grid">

              <div className="cal-field cal-field--full">
                <label>Nombre <span className="cal-required">*</span></label>
                <input
                  name="nombre"
                  value={form.nombre}
                  onChange={handleChange}
                  placeholder="Ej. Calibración bomba 3 — Lote Norte"
                  required
                />
              </div>

              <div className="cal-field">
                <label>Fecha de la calibración</label>
                <input
                  name="fecha"
                  type="date"
                  value={form.fecha}
                  onChange={handleChange}
                />
              </div>

              <div className="cal-field">
                {/* spacer */}
              </div>

              <div className="cal-field">
                <label>Tractor</label>
                <ActivoCombobox
                  value={form.tractorId}
                  onChange={handleTractorChange}
                  activos={activos}
                  placeholder="— Buscar tractor —"
                />
              </div>

              <div className="cal-field">
                <label>Aplicador</label>
                <ActivoCombobox
                  value={form.aplicadorId}
                  onChange={handleAplicadorChange}
                  activos={activos}
                  placeholder="— Buscar aplicador —"
                />
              </div>

              <div className="cal-field">
                <label>Volumen</label>
                <input
                  name="volumen"
                  type="number"
                  min="0"
                  step="0.1"
                  value={form.volumen}
                  onChange={handleChange}
                  placeholder="Ej. 200"
                />
              </div>

              <div className="cal-field">
                <label>RPM Recomendada</label>
                <input
                  name="rpmRecomendado"
                  type="number"
                  min="0"
                  step="1"
                  value={form.rpmRecomendado}
                  onChange={handleChange}
                  placeholder="Ej. 540"
                />
              </div>

              <div className="cal-field">
                <label>Marcha Recomendada</label>
                <input
                  name="marchaRecomendada"
                  value={form.marchaRecomendada}
                  onChange={handleChange}
                  placeholder="Ej. 2ª lenta"
                />
              </div>

              <div className="cal-field">
                <label>Tipo de Boquilla</label>
                <input
                  name="tipoBoquilla"
                  value={form.tipoBoquilla}
                  onChange={handleChange}
                  placeholder="Ej. Abanico plano 110-03"
                />
              </div>

              <div className="cal-field">
                <label>Presión Recomendada</label>
                <input
                  name="presionRecomendada"
                  value={form.presionRecomendada}
                  onChange={handleChange}
                  placeholder="Ej. 2.5 bar"
                />
              </div>

              <div className="cal-field">
                <label>Km/H Recomendada</label>
                <input
                  name="velocidadKmH"
                  type="number"
                  min="0"
                  step="0.1"
                  value={form.velocidadKmH}
                  onChange={handleChange}
                  placeholder="Ej. 5.5"
                />
              </div>

              <div className="cal-field">
                <label>Responsable de la calibración</label>
                <input
                  name="responsableNombre"
                  value={form.responsableNombre}
                  onChange={handleChange}
                  placeholder="Nombre del responsable"
                />
              </div>

              <div className="cal-field cal-field--full">
                <label>Método</label>
                <input
                  name="metodo"
                  value={form.metodo}
                  onChange={handleChange}
                  placeholder="Ej. Método de los vasos"
                />
              </div>

            </div>

            <div className="cal-form-actions">
              <button type="button" className="btn btn-secondary" onClick={resetForm}>
                Cancelar
              </button>
              <button type="submit" className="btn btn-primary" disabled={saving}>
                <FiCheck size={15} /> {saving ? 'Guardando…' : isEditing ? 'Actualizar' : 'Crear calibración'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ── Toolbar ── */}
      {!showForm && items.length > 0 && (
        <div className="cal-toolbar">
          <button className="btn btn-primary" onClick={handleNew}>
            <FiPlus size={15} /> Nueva calibración
          </button>
        </div>
      )}

      {/* ── Lista / Empty state ── */}
      {loading ? (
        <p className="cal-loading">Cargando…</p>
      ) : items.length === 0 && !showForm ? (
        <div className="cal-empty-state">
          <FiDroplet size={40} />
          <p>No tienes ninguna calibración creada.</p>
          <p className="cal-empty-sub">Crea tu primera calibración.</p>
          <button className="btn btn-primary" onClick={handleNew}>
            <FiPlus size={15} /> Crear nueva calibración
          </button>
        </div>
      ) : items.length > 0 ? (
        <section className="cal-section">
          <div className="cal-section-header">
            <FiDroplet size={14} />
            <span>Calibraciones registradas</span>
            <span className="cal-count">{items.length}</span>
          </div>

          {/* ── Vista tabla (desktop) ── */}
          <div className="cal-table-wrap">
            <table className="cal-table">
              <thead onContextMenu={handleHeaderRightClick}>
                <tr>
                  {visibleList.map(col => (
                    <th key={col.key}>{col.label}</th>
                  ))}
                  <th className="cal-th-settings">
                    <button
                      className={`cal-col-toggle-btn${hiddenCount > 0 ? ' cal-col-toggle-btn--active' : ''}`}
                      onClick={handleColBtnClick}
                      title="Personalizar columnas visibles"
                    >
                      <FiSliders size={12} />
                      {hiddenCount > 0 && (
                        <span className="cal-col-hidden-badge">{hiddenCount}</span>
                      )}
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map(item => (
                  <tr key={item.id}>
                    {visibleList.map(col => renderCell(item, col.key))}
                    <td className="cal-td-actions">
                      <button className="cal-btn-icon" onClick={() => handleEdit(item)} title="Editar">
                        <FiEdit size={13} />
                      </button>
                      <button className="cal-btn-icon cal-btn-danger" onClick={() => handleDelete(item.id, item.nombre)} title="Eliminar">
                        <FiTrash2 size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* ── Vista tarjetas (móvil) ── */}
          <div className="cal-cards">
            {items.map(item => (
              <div key={item.id} className="cal-card">
                <div className="cal-card-header">
                  <span className="cal-card-nombre">{item.nombre}</span>
                  <div className="cal-card-actions">
                    <button className="cal-btn-icon" onClick={() => handleEdit(item)} title="Editar">
                      <FiEdit size={14} />
                    </button>
                    <button className="cal-btn-icon cal-btn-danger" onClick={() => handleDelete(item.id, item.nombre)} title="Eliminar">
                      <FiTrash2 size={14} />
                    </button>
                  </div>
                </div>

                {item.fecha && (
                  <div className="cal-card-date">{formatFecha(item.fecha)}</div>
                )}

                <div className="cal-card-fields">
                  {item.tractorNombre    && <div className="cal-card-field"><span className="cal-card-label">Tractor</span><span>{item.tractorNombre}</span></div>}
                  {item.aplicadorNombre  && <div className="cal-card-field"><span className="cal-card-label">Aplicador</span><span>{item.aplicadorNombre}</span></div>}
                  {(item.volumen != null && item.volumen !== '') && <div className="cal-card-field"><span className="cal-card-label">Volumen</span><span>{item.volumen}</span></div>}
                  {item.rpmRecomendado   && <div className="cal-card-field"><span className="cal-card-label">RPM</span><span>{item.rpmRecomendado}</span></div>}
                  {item.marchaRecomendada && <div className="cal-card-field"><span className="cal-card-label">Marcha</span><span>{item.marchaRecomendada}</span></div>}
                  {item.tipoBoquilla     && <div className="cal-card-field"><span className="cal-card-label">Boquilla</span><span>{item.tipoBoquilla}</span></div>}
                  {item.presionRecomendada && <div className="cal-card-field"><span className="cal-card-label">Presión</span><span>{item.presionRecomendada}</span></div>}
                  {(item.velocidadKmH != null && item.velocidadKmH !== '') && (
                    <div className="cal-card-field"><span className="cal-card-label">Km/H</span><span>{item.velocidadKmH}</span></div>
                  )}
                  {item.responsableNombre && <div className="cal-card-field"><span className="cal-card-label">Responsable</span><span>{item.responsableNombre}</span></div>}
                  {item.metodo && <div className="cal-card-field"><span className="cal-card-label">Método</span><span>{item.metodo}</span></div>}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

export default Calibraciones;
