import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { FiPlus, FiEdit, FiTrash2, FiX, FiCheck, FiPackage, FiSearch } from 'react-icons/fi';
import Toast from '../../../components/Toast';
import AuroraConfirmModal from '../../../components/AuroraConfirmModal';
import { useApiFetch } from '../../../hooks/useApiFetch';
import '../styles/unidades-medida.css';

// ── Combobox labor (sobre .aur-combo-*) ──────────────────────────────────────
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
  const wrapRef    = useRef(null);
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
    if (wrapRef.current) {
      const r = wrapRef.current.getBoundingClientRect();
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
      if (wrapRef.current?.contains(e.target) || listRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div className="aur-combo um-labor-combo" ref={wrapRef}>
      <div className="aur-combo-input-wrap">
        <FiSearch size={13} />
        <input
          ref={inputRef}
          type="text"
          className="aur-combo-input"
          value={text}
          autoComplete="off"
          placeholder="Buscar labor…"
          onChange={handleChange}
          onFocus={openDropdown}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
        />
      </div>
      {open && filtered.length > 0 && createPortal(
        <ul
          ref={listRef}
          className="aur-combo-dropdown"
          style={{ top: dropPos.top, left: dropPos.left, width: dropPos.width }}
        >
          {filtered.map((l, i) => (
            <li
              key={l.id}
              className={`aur-combo-option${i === hi ? ' aur-combo-option--active' : ''}`}
              onMouseDown={() => selectOption(l)}
              onMouseEnter={() => setHi(i)}
            >
              <span className="aur-combo-name">{l.descripcion}</span>
              {l.codigo && <span className="aur-combo-meta">{l.codigo}</span>}
            </li>
          ))}
        </ul>,
        document.body
      )}
    </div>
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
  const [confirmDelete, setConfirmDelete] = useState(null); // { id, nombre }
  const [deleting, setDeleting] = useState(false);
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

  const handleDeleteConfirm = async () => {
    if (!confirmDelete) return;
    setDeleting(true);
    try {
      const res = await apiFetch(`/api/unidades-medida/${confirmDelete.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      showToast('Unidad eliminada.');
      setConfirmDelete(null);
      fetchItems();
    } catch {
      showToast('Error al eliminar.', 'error');
    } finally {
      setDeleting(false);
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

  if (loading) {
    return <div className="aur-page-loading" />;
  }

  if (items.length === 0 && !showForm) {
    return (
      <>
        {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
        <div className="aur-sheet aur-sheet--empty">
          <div className="um-empty">
            <FiPackage size={36} />
            <p>No hay unidades de medida registradas.</p>
            <button type="button" className="aur-btn-pill" onClick={() => setShowForm(true)}>
              <FiPlus size={14} /> Crear la primera
            </button>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {confirmDelete && (
        <AuroraConfirmModal
          danger
          title={`¿Eliminar la unidad "${confirmDelete.nombre}"?`}
          body="Esta acción no se puede deshacer. Si la unidad está siendo usada en productos o actividades, esos registros podrían quedar en estado inconsistente."
          confirmLabel="Eliminar"
          loading={deleting}
          loadingLabel="Eliminando…"
          onConfirm={handleDeleteConfirm}
          onCancel={() => setConfirmDelete(null)}
        />
      )}

      <div className="aur-sheet">
        <header className="aur-sheet-header">
          <div className="aur-sheet-header-text">
            <h2 className="aur-sheet-title">Unidades de medida</h2>
            <p className="aur-sheet-subtitle">
              Unidades utilizadas en actividades de campo, dosis de productos y conversiones.
            </p>
          </div>
          {!showForm && (
            <div className="aur-sheet-header-actions">
              <button type="button" className="aur-btn-pill aur-btn-pill--sm" onClick={() => setShowForm(true)}>
                <FiPlus size={14} /> Nueva unidad
              </button>
            </div>
          )}
        </header>

        {showForm && (
          <form onSubmit={handleSubmit}>
            <section className="aur-section">
              <div className="aur-section-header">
                <span className="aur-section-num">01</span>
                <h3>{isEditing ? 'Editar unidad' : 'Nueva unidad'}</h3>
                <div className="aur-section-actions">
                  <button type="button" className="aur-icon-btn aur-icon-btn--sm" onClick={resetForm} title="Cancelar">
                    <FiX size={14} />
                  </button>
                </div>
              </div>
              <div className="aur-list">
                <div className="aur-row aur-row--multiline">
                  <label className="aur-row-label" htmlFor="um-nombre">
                    Nombre <span className="um-required">*</span>
                  </label>
                  <input
                    id="um-nombre"
                    ref={inputRef}
                    className="aur-input"
                    name="nombre"
                    value={form.nombre}
                    onChange={handleChange}
                    placeholder="Ej: Kg, Ha, Jornal…"
                    maxLength={40}
                    required
                  />
                </div>
                <div className="aur-row aur-row--multiline">
                  <label className="aur-row-label" htmlFor="um-descripcion">Descripción</label>
                  <input
                    id="um-descripcion"
                    className="aur-input"
                    name="descripcion"
                    value={form.descripcion}
                    onChange={handleChange}
                    placeholder="Ej: Kilogramo, Hectárea…"
                    maxLength={80}
                  />
                </div>
              </div>
            </section>

            <section className="aur-section">
              <div className="aur-section-header">
                <span className="aur-section-num">02</span>
                <h3>Conversión</h3>
              </div>
              <div className="aur-list">
                <div className="aur-row aur-row--multiline">
                  <label className="aur-row-label" htmlFor="um-factor">Factor de conversión</label>
                  <input
                    id="um-factor"
                    className="aur-input aur-input--num"
                    name="factorConversion"
                    type="number"
                    min="0"
                    step="any"
                    value={form.factorConversion}
                    onChange={handleChange}
                    placeholder="Ej: 45, 1000…"
                  />
                </div>
                <div className="aur-row aur-row--multiline">
                  <label className="aur-row-label" htmlFor="um-base">Unidad base</label>
                  <select
                    id="um-base"
                    className="aur-select"
                    name="unidadBase"
                    value={form.unidadBase}
                    onChange={handleChange}
                  >
                    <option value="">— Sin conversión —</option>
                    {items
                      .filter(u => u.id !== form.id)
                      .map(u => (
                        <option key={u.id} value={u.nombre}>
                          {u.nombre}{u.descripcion ? ` — ${u.descripcion}` : ''}
                        </option>
                      ))}
                  </select>
                </div>
              </div>
            </section>

            <section className="aur-section">
              <div className="aur-section-header">
                <span className="aur-section-num">03</span>
                <h3>Asociación</h3>
              </div>
              <div className="aur-list">
                <div className="aur-row aur-row--multiline">
                  <label className="aur-row-label" htmlFor="um-precio">Precio</label>
                  <input
                    id="um-precio"
                    className="aur-input aur-input--num"
                    name="precio"
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.precio}
                    onChange={handleChange}
                    placeholder="0.00"
                  />
                </div>
                <div className="aur-row aur-row--multiline">
                  <label className="aur-row-label">Labor</label>
                  <LaborCombobox
                    value={form.labor}
                    onChange={id => setForm(prev => ({ ...prev, labor: id }))}
                    labores={labores}
                  />
                </div>
              </div>
            </section>

            <div className="aur-form-actions">
              <button type="button" className="aur-btn-text" onClick={resetForm}>
                Cancelar
              </button>
              <button type="submit" className="aur-btn-pill aur-btn-pill--sm" disabled={saving}>
                <FiCheck size={14} /> {saving ? 'Guardando…' : isEditing ? 'Actualizar' : 'Crear'}
              </button>
            </div>
          </form>
        )}

        <section className="aur-section">
          <div className="aur-section-header">
            <span className="aur-section-num">{showForm ? '04' : '01'}</span>
            <h3>Unidades registradas</h3>
            {items.length > 0 && <span className="aur-section-count">{items.length}</span>}
          </div>

          {items.length === 0 ? (
            <p className="um-empty-line">No hay unidades aún.</p>
          ) : (
            <ul className="um-list">
              {items.map(item => (
                <li key={item.id} className="um-item">
                  <div className="um-item-main">
                    <span className="um-item-title">{item.nombre}</span>
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
                          <span className="um-meta-precio">{formatPrecio(item.precio)}</span>
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
                  <div className="um-item-actions">
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
                      onClick={() => setConfirmDelete({ id: item.id, nombre: item.nombre })}
                      title="Eliminar"
                    >
                      <FiTrash2 size={13} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}

export default UnidadesMedida;
