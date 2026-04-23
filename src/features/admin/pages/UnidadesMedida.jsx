import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { FiPlus, FiEdit, FiTrash2, FiX, FiCheck, FiPackage } from 'react-icons/fi';
import Toast from '../../../components/Toast';
import { useApiFetch } from '../../../hooks/useApiFetch';
import '../../fields/styles/lote-management.css';
import '../styles/unidades-medida.css';

// ── Combobox labor ────────────────────────────────────────────────────────────
function LaborCombobox({ value, onChange, labores }) {
  const labelFor = useCallback((id) => {
    const l = labores.find(l => l.id === id);
    if (!l) return '';
    return l.descripcion + (l.codigo ? ` (${l.codigo})` : '');
  }, [labores]);

  const [text,    setText]    = useState(() => labelFor(value));
  const [open,    setOpen]    = useState(false);
  const [hi,      setHi]      = useState(0);
  const [dropPos, setDropPos] = useState({ top: 0, left: 0, width: 0 });
  const inputRef   = useRef(null);
  const listRef    = useRef(null);
  const userTyping = useRef(false);

  useEffect(() => {
    if (userTyping.current) { userTyping.current = false; return; }
    setText(labelFor(value));
  }, [value, labelFor]);

  const filtered = labores.filter(l => {
    if (!text) return true;
    const q = text.toLowerCase();
    return l.descripcion?.toLowerCase().includes(q) || l.codigo?.toLowerCase().includes(q);
  });

  const openDropdown = () => {
    if (inputRef.current) {
      const r = inputRef.current.getBoundingClientRect();
      setDropPos({ top: r.bottom + window.scrollY + 2, left: r.left + window.scrollX, width: r.width });
    }
    setOpen(true);
    setHi(0);
  };

  const selectOption = (labor) => {
    setText(labelFor(labor.id));
    setOpen(false);
    setHi(0);
    onChange(labor.id);
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
        setText(labelFor(value));
      }
    }, 150);
  };

  const handleKeyDown = (e) => {
    if (!open) {
      if (e.key === 'ArrowDown') { openDropdown(); e.preventDefault(); }
      return;
    }
    if (e.key === 'ArrowDown') {
      setHi(h => { const n = Math.min(h + 1, filtered.length - 1); listRef.current?.children[n]?.scrollIntoView({ block: 'nearest' }); return n; });
      e.preventDefault();
    } else if (e.key === 'ArrowUp') {
      setHi(h => { const n = Math.max(h - 1, 0); listRef.current?.children[n]?.scrollIntoView({ block: 'nearest' }); return n; });
      e.preventDefault();
    } else if (e.key === 'Enter') {
      if (filtered[hi]) { selectOption(filtered[hi]); e.preventDefault(); }
    } else if (e.key === 'Escape') {
      setOpen(false);
      setText(labelFor(value));
    }
  };

  useEffect(() => {
    const handler = (e) => {
      if (inputRef.current && !inputRef.current.contains(e.target) &&
          listRef.current  && !listRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <>
      <input
        ref={inputRef}
        value={text}
        autoComplete="off"
        placeholder="Buscar labor…"
        onChange={handleChange}
        onFocus={openDropdown}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
      />
      {open && filtered.length > 0 && createPortal(
        <ul
          ref={listRef}
          className="um-labor-dropdown"
          style={{ top: dropPos.top, left: dropPos.left, minWidth: dropPos.width }}
        >
          {filtered.map((l, i) => (
            <li
              key={l.id}
              className={`um-labor-dropdown-item${i === hi ? ' um-labor-dropdown-item--active' : ''}`}
              onMouseDown={() => selectOption(l)}
              onMouseEnter={() => setHi(i)}
            >
              <span className="um-labor-desc">{l.descripcion}</span>
              {l.codigo && <span className="um-labor-codigo">{l.codigo}</span>}
            </li>
          ))}
        </ul>,
        document.body
      )}
    </>
  );
}

const EMPTY_FORM = {
  id: null,
  nombre: '',
  descripcion: '',
  precio: '',
  labor: '',
  factorConversion: '',
  unidadBase: '',
};

function UnidadesMedida() {
  const apiFetch = useApiFetch();
  const [items,     setItems]     = useState([]);
  const [labores,   setLabores]   = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [form,      setForm]      = useState(EMPTY_FORM);
  const [isEditing, setIsEditing] = useState(false);
  const [showForm,  setShowForm]  = useState(false);
  const [saving,    setSaving]    = useState(false);
  const [toast,     setToast]     = useState(null);
  const inputRef = useRef(null);

  const showToast = (message, type = 'success') => setToast({ message, type });

  const fetchItems = () =>
    apiFetch('/api/unidades-medida')
      .then(r => r.json())
      .then(data => setItems(Array.isArray(data) ? data : []))
      .catch(() => showToast('Error al cargar las unidades.', 'error'))
      .finally(() => setLoading(false));

  useEffect(() => {
    fetchItems();
    apiFetch('/api/labores').then(r => r.json()).then(d => setLabores(Array.isArray(d) ? d : [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (showForm) setTimeout(() => inputRef.current?.focus(), 50);
  }, [showForm]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm(prev => ({ ...prev, [name]: value }));
  };

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setIsEditing(false);
    setShowForm(false);
  };

  const handleEdit = (item) => {
    setForm({
      id:               item.id,
      nombre:           item.nombre           || '',
      descripcion:      item.descripcion      || '',
      precio:           item.precio != null ? String(item.precio) : '',
      labor:            item.labor            || '',
      factorConversion: item.factorConversion != null ? String(item.factorConversion) : '',
      unidadBase:       item.unidadBase        || '',
    });
    setIsEditing(true);
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDelete = async (id, nombre) => {
    if (!window.confirm(`¿Eliminar la unidad "${nombre}"?`)) return;
    try {
      const res = await apiFetch(`/api/unidades-medida/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      showToast('Unidad eliminada.');
      fetchItems();
    } catch {
      showToast('Error al eliminar.', 'error');
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.nombre.trim()) {
      showToast('El nombre es requerido.', 'error');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        nombre:           form.nombre.trim(),
        descripcion:      form.descripcion.trim(),
        precio:           form.precio !== '' ? parseFloat(form.precio) : null,
        labor:            form.labor,
        factorConversion: form.factorConversion !== '' ? parseFloat(form.factorConversion) : null,
        unidadBase:       form.unidadBase.trim(),
      };
      const res = await apiFetch(
        isEditing ? `/api/unidades-medida/${form.id}` : '/api/unidades-medida',
        {
          method: isEditing ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }
      );
      if (!res.ok) throw new Error();
      showToast(isEditing ? 'Unidad actualizada.' : 'Unidad creada.');
      resetForm();
      fetchItems();
    } catch {
      showToast('Error al guardar.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const formatPrecio = (val) => {
    if (val == null || val === '') return null;
    return Number(val).toLocaleString('es-CR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const getLaborNombre = (laborId) =>
    labores.find(l => l.id === laborId)?.descripcion || laborId || '';

  return (
    <div className="um-page-wrap">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {/* ── Spinner de carga ── */}
      {loading && <div className="um-page-loading" />}

      {/* ── Estado vacío ── */}
      {!loading && items.length === 0 && !showForm && (
        <div className="um-empty-state">
          <FiPackage size={36} />
          <p>No hay unidades de medida registradas.</p>
          <button className="btn btn-primary" onClick={() => setShowForm(true)}>
            <FiPlus size={15} /> Crear el primero
          </button>
        </div>
      )}

      {/* ── Botón top-right ── */}
      {!loading && items.length > 0 && (
        <div className="um-page-header">
          {!showForm && (
            <button className="btn btn-primary" onClick={() => setShowForm(true)}>
              <FiPlus size={15} /> Nueva unidad
            </button>
          )}
        </div>
      )}

      {!loading && (items.length > 0 || showForm) && (
      <div className="lote-management-layout um-layout">

        {/* ── Panel izquierdo: formulario o CTA ── */}
        <div className="form-card">
          {showForm ? (
            <>
              <div className="um-form-header">
                <h3>{isEditing ? 'Editar unidad' : 'Nueva unidad'}</h3>
                <button className="icon-btn" onClick={resetForm} title="Cancelar">
                  <FiX size={16} />
                </button>
              </div>
              <form onSubmit={handleSubmit}>
                <div className="um-form-grid">
                  <div className="form-control">
                    <label>Nombre <span className="um-required">*</span></label>
                    <input
                      ref={inputRef}
                      name="nombre"
                      value={form.nombre}
                      onChange={handleChange}
                      placeholder="Ej: Kg, Ha, Jornal…"
                      maxLength={40}
                    />
                  </div>
                  <div className="form-control">
                    <label>Descripción</label>
                    <input
                      name="descripcion"
                      value={form.descripcion}
                      onChange={handleChange}
                      placeholder="Ej: Kilogramo, Hectárea…"
                      maxLength={80}
                    />
                  </div>
                  <div className="form-control">
                    <label>Factor de conversión</label>
                    <input
                      name="factorConversion"
                      type="number"
                      min="0"
                      step="any"
                      value={form.factorConversion}
                      onChange={handleChange}
                      placeholder="Ej: 45, 1000…"
                    />
                  </div>
                  <div className="form-control">
                    <label>Unidad base</label>
                    <select name="unidadBase" value={form.unidadBase} onChange={handleChange}>
                      <option value="">— Sin conversión —</option>
                      {items
                        .filter(u => u.id !== form.id)
                        .map(u => (
                          <option key={u.id} value={u.nombre}>{u.nombre}{u.descripcion ? ` — ${u.descripcion}` : ''}</option>
                        ))}
                    </select>
                  </div>
                  <div className="form-control">
                    <label>Precio</label>
                    <input
                      name="precio"
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.precio}
                      onChange={handleChange}
                      placeholder="0.00"
                    />
                  </div>
                  <div className="form-control um-field-full">
                    <label>Labor</label>
                    <LaborCombobox
                      value={form.labor}
                      onChange={id => setForm(prev => ({ ...prev, labor: id }))}
                      labores={labores}
                    />
                  </div>
                </div>
                <div className="form-actions" style={{ marginTop: 16 }}>
                  <button type="submit" className="btn btn-primary" disabled={saving}>
                    <FiCheck size={15} />
                    {saving ? 'Guardando…' : isEditing ? 'Actualizar' : 'Crear'}
                  </button>
                  <button type="button" className="btn btn-secondary" onClick={resetForm}>
                    Cancelar
                  </button>
                </div>
              </form>
            </>
          ) : (
            <div className="um-cta um-cta--secondary">
              <div className="um-cta-icon"><FiEdit size={24} /></div>
              <p className="um-cta-title">Selecciona una unidad para editarla</p>
              <p className="um-cta-desc">
                Elige una unidad de la lista para modificar sus datos o
                configurar su factor de conversión.
              </p>
            </div>
          )}
        </div>

        {/* ── Panel derecho: lista ── */}
        <div className="list-card">
          <h2>
            Unidades registradas
            {items.length > 0 && <span className="um-list-count">{items.length}</span>}
          </h2>
          {loading ? (
            <p className="empty-state">Cargando…</p>
          ) : items.length === 0 ? (
            <p className="empty-state">No hay unidades aún.</p>
          ) : (
            <ul className="info-list">
              {items.map(item => (
                <li key={item.id}>
                  <div>
                    <span className="item-main-text">{item.nombre}</span>
                    <div className="um-item-meta">
                      {item.descripcion && <span>{item.descripcion}</span>}
                      {item.factorConversion != null && item.unidadBase && (
                        <>
                          <span className="um-meta-sep">·</span>
                          <span className="um-meta-conversion">
                            1 {item.nombre} = {item.factorConversion} {item.unidadBase}
                          </span>
                        </>
                      )}
                      {item.precio != null && item.precio !== '' && (
                        <>
                          <span className="um-meta-sep">·</span>
                          <span>{formatPrecio(item.precio)}</span>
                        </>
                      )}
                      {item.labor && (
                        <>
                          <span className="um-meta-sep">·</span>
                          <span className="um-meta-labor">{getLaborNombre(item.labor)}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="lote-actions">
                    <button className="icon-btn" onClick={() => handleEdit(item)} title="Editar">
                      <FiEdit size={15} />
                    </button>
                    <button className="icon-btn icon-btn--danger" onClick={() => handleDelete(item.id, item.nombre)} title="Eliminar">
                      <FiTrash2 size={15} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

      </div>
      )}
    </div>
  );
}

export default UnidadesMedida;
