import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  FiPlus, FiX, FiCheck, FiEdit, FiTrash2,
} from 'react-icons/fi';
import Toast from '../components/Toast';
import { useApiFetch } from '../hooks/useApiFetch';
import './Horimetro.css';

// ── Combobox genérico ────────────────────────────────────────────────────────
function Combobox({ value, onChange, items, labelKey = 'nombre', labelFn, placeholder = '— Seleccionar —' }) {
  const getLabel = useCallback(
    (item) => labelFn ? labelFn(item) : (item?.[labelKey] || ''),
    [labelFn, labelKey],
  );
  const nameFor = useCallback(
    (id) => { const item = items.find(i => i.id === id); return item ? getLabel(item) : ''; },
    [items, getLabel],
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

  const filtered = items.filter(i =>
    !text || getLabel(i).toLowerCase().includes(text.toLowerCase()),
  );

  const openDropdown = () => {
    if (inputRef.current) {
      const r = inputRef.current.getBoundingClientRect();
      setDropPos({ top: r.bottom + window.scrollY + 2, left: r.left + window.scrollX, width: r.width });
    }
    setOpen(true);
    setHi(0);
  };

  const selectOption = (item) => {
    setText(getLabel(item));
    setOpen(false);
    setHi(0);
    onChange(item.id);
  };

  const handleTextChange = (e) => {
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
      setHi(h => { const n = Math.min(h + 1, filtered.length - 1); listRef.current?.children[n]?.scrollIntoView({ block: 'nearest' }); return n; });
      e.preventDefault();
    } else if (e.key === 'ArrowUp') {
      setHi(h => { const n = Math.max(h - 1, 0); listRef.current?.children[n]?.scrollIntoView({ block: 'nearest' }); return n; });
      e.preventDefault();
    } else if (e.key === 'Enter') {
      if (filtered[hi]) { selectOption(filtered[hi]); e.preventDefault(); }
    } else if (e.key === 'Escape') {
      setOpen(false);
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
        placeholder={placeholder}
        onChange={handleTextChange}
        onFocus={openDropdown}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
      />
      {open && filtered.length > 0 && createPortal(
        <ul
          ref={listRef}
          className="hor-combobox-dropdown"
          style={{ top: dropPos.top, left: dropPos.left, minWidth: dropPos.width }}
        >
          {filtered.map((item, i) => (
            <li
              key={item.id}
              className={`hor-combobox-item${i === hi ? ' hor-combobox-item--active' : ''}`}
              onMouseDown={() => selectOption(item)}
              onMouseEnter={() => setHi(i)}
            >
              {getLabel(item)}
            </li>
          ))}
        </ul>,
        document.body,
      )}
    </>
  );
}

// ── Formulario principal ─────────────────────────────────────────────────────
const EMPTY_FORM = {
  id: null,
  consecutivo: '',
  fecha: new Date().toISOString().slice(0, 10),
  loteId: '',
  loteNombre: '',
  grupo: '',
  bloque: '',
  cantidad: '',
  unidadId: '',
  unidad: '',
  operarioId: '',
  operarioNombre: '',
  activoId: '',
  activoNombre: '',
  implementoId: '',
  implementoNombre: '',
  nota: '',
};

export default function RegistroCosecha() {
  const apiFetch = useApiFetch();

  const [lotes, setLotes]         = useState([]);
  const [grupos, setGrupos]       = useState([]);
  const [siembras, setSiembras]   = useState([]);
  const [unidades, setUnidades]   = useState([]);
  const [usuarios, setUsuarios]   = useState([]);
  const [maquinaria, setMaquinaria] = useState([]);
  const [records, setRecords]     = useState([]);
  const [loading, setLoading]     = useState(true);

  const [form, setForm]           = useState(EMPTY_FORM);
  const [showForm, setShowForm]   = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving]       = useState(false);
  const [toast, setToast]         = useState(null);
  const showToast = (msg, type = 'success') => setToast({ message: msg, type });

  // ── Fetch catalogs ──
  const fetchRecords = () =>
    apiFetch('/api/cosecha/registros')
      .then(r => r.json())
      .then(data => setRecords(Array.isArray(data) ? data : []))
      .catch(() => {});

  useEffect(() => {
    Promise.all([
      apiFetch('/api/lotes').then(r => r.json()),
      apiFetch('/api/grupos').then(r => r.json()),
      apiFetch('/api/siembras').then(r => r.json()),
      apiFetch('/api/unidades-medida').then(r => r.json()),
      apiFetch('/api/users').then(r => r.json()),
      apiFetch('/api/maquinaria').then(r => r.json()),
    ]).then(([lotesData, gruposData, siembrasData, unidadesData, usersData, maqData]) => {
      setLotes(Array.isArray(lotesData) ? lotesData : []);
      setGrupos(Array.isArray(gruposData) ? gruposData : []);
      setSiembras(Array.isArray(siembrasData) ? siembrasData : []);
      setUnidades(Array.isArray(unidadesData) ? unidadesData : []);
      setUsuarios(Array.isArray(usersData) ? usersData.filter(u => u.empleadoPlanilla) : []);
      setMaquinaria(Array.isArray(maqData) ? maqData : []);
    }).catch(() => {})
      .finally(() => setLoading(false));
    fetchRecords();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Derived lists (lote → grupo → bloque) ──
  const gruposDelLote = useMemo(() => {
    if (!form.loteId) return grupos;
    const siembraIds = new Set(
      siembras.filter(s => s.loteId === form.loteId).map(s => s.id),
    );
    return grupos.filter(g =>
      Array.isArray(g.bloques) && g.bloques.some(bid => siembraIds.has(bid)),
    );
  }, [grupos, siembras, form.loteId]);

  const bloquesDisponibles = useMemo(() => {
    const grupoSel = form.grupo ? grupos.find(g => g.nombreGrupo === form.grupo) : null;
    let ids;
    if (grupoSel && Array.isArray(grupoSel.bloques)) {
      ids = grupoSel.bloques;
    } else if (form.loteId) {
      ids = siembras.filter(s => s.loteId === form.loteId).map(s => s.id);
    } else {
      return [];
    }
    const seen = new Set();
    return ids
      .map(id => siembras.find(s => s.id === id))
      .filter(s => {
        if (!s) return false;
        const key = s.bloque || s.id;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => parseInt(a.bloque || a.id) - parseInt(b.bloque || b.id));
  }, [grupos, siembras, form.grupo, form.loteId]);

  const grupoLabel = (g) => {
    const bloqueNums = [...new Set(
      (g.bloques || [])
        .map(id => siembras.find(s => s.id === id)?.bloque)
        .filter(Boolean),
    )].sort((a, b) => parseInt(a) - parseInt(b));
    return bloqueNums.length
      ? `${g.nombreGrupo} (${bloqueNums.join(', ')})`
      : g.nombreGrupo;
  };

  // Activos = maquinaria excluyendo IMPLEMENTO
  const activos = useMemo(
    () => maquinaria.filter(m => m.tipo !== 'IMPLEMENTO'),
    [maquinaria],
  );
  // Implementos = solo IMPLEMENTO
  const implementos = useMemo(
    () => maquinaria.filter(m => m.tipo === 'IMPLEMENTO'),
    [maquinaria],
  );

  // ── Handlers ──
  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm(prev => {
      const next = { ...prev, [name]: value };
      if (name === 'loteId') {
        const l = lotes.find(x => x.id === value);
        next.loteNombre = l ? l.nombreLote : '';
        next.grupo = '';
        next.bloque = '';
      }
      if (name === 'grupo') {
        next.bloque = '';
      }
      return next;
    });
  };

  const handleOperarioChange = (id) => {
    const u = usuarios.find(x => x.id === id);
    setForm(prev => ({ ...prev, operarioId: id, operarioNombre: u ? u.nombre : '' }));
  };

  const activoLabel = useCallback(
    (m) => m ? [m.codigo, m.descripcion].filter(Boolean).join(' - ') : '',
    [],
  );

  const handleActivoChange = (id) => {
    const m = activos.find(x => x.id === id);
    setForm(prev => ({ ...prev, activoId: id, activoNombre: activoLabel(m) }));
  };

  const handleImplementoChange = (id) => {
    const m = implementos.find(x => x.id === id);
    setForm(prev => ({ ...prev, implementoId: id, implementoNombre: activoLabel(m) }));
  };

  const unidadLabel = useCallback(
    (u) => u ? [u.nombre, u.descripcion].filter(Boolean).join(' — ') : '',
    [],
  );

  const handleUnidadChange = (id) => {
    const u = unidades.find(x => x.id === id);
    setForm(prev => ({ ...prev, unidadId: id, unidad: u ? u.nombre : '' }));
  };

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setIsEditing(false);
    setShowForm(false);
  };

  const handleEdit = (rec) => {
    const unidadObj = unidades.find(u => u.nombre === rec.unidad);
    setForm({ ...EMPTY_FORM, ...rec, unidadId: unidadObj ? unidadObj.id : '' });
    setIsEditing(true);
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDelete = async (id) => {
    if (!window.confirm('¿Eliminar este registro de cosecha?')) return;
    try {
      const res = await apiFetch(`/api/cosecha/registros/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      showToast('Registro eliminado.');
      fetchRecords();
    } catch {
      showToast('Error al eliminar.', 'error');
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.fecha || !form.loteId || !form.cantidad) {
      showToast('Fecha, lote y cantidad son obligatorios.', 'error');
      return;
    }
    setSaving(true);
    try {
      const payload = { ...form };
      delete payload.id;
      if (isEditing) {
        const res = await apiFetch(`/api/cosecha/registros/${form.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error();
        showToast('Registro actualizado.');
      } else {
        const res = await apiFetch('/api/cosecha/registros', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error();
        showToast('Registro guardado.');
      }
      resetForm();
      fetchRecords();
    } catch {
      showToast('Error al guardar.', 'error');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="ficha-page-loading">
        <div className="ficha-spinner" />
      </div>
    );
  }

  return (
    <div className="hor-wrap">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      <div className="hor-toolbar">
        <h1 className="hor-page-title">Registro de Cosecha</h1>
        {!showForm && (
          <button className="btn btn-primary" onClick={() => { setForm(EMPTY_FORM); setIsEditing(false); setShowForm(true); }}>
            <FiPlus size={15} /> Nuevo registro
          </button>
        )}
      </div>

      {/* ── Formulario ── */}
      {showForm && (
        <div className="hor-form-card">
          <div className="hor-form-header">
            <span>
              {isEditing
                ? `Editar registro${form.consecutivo ? ` · ${form.consecutivo}` : ''}`
                : 'Nuevo registro de cosecha'}
            </span>
            <button className="icon-btn" onClick={resetForm} title="Cancelar"><FiX size={16} /></button>
          </div>

          <form onSubmit={handleSubmit} style={{ padding: '16px 18px' }}>

            {/* Fecha */}
            <p className="hor-section-label">Fecha</p>
            <div className="hor-form-grid hor-grid-2">
              <div className="hor-field">
                <label>Fecha</label>
                <input type="date" name="fecha" value={form.fecha} onChange={handleChange} required />
              </div>
            </div>

            {/* Ubicación: lote / grupo / bloque */}
            <p className="hor-section-label">Ubicación</p>
            <div className="hor-form-grid hor-grid-2">
              <div className="hor-field">
                <label>Lote *</label>
                <select name="loteId" value={form.loteId} onChange={handleChange} required>
                  <option value="">— Seleccionar —</option>
                  {lotes.map(l => <option key={l.id} value={l.id}>{l.nombreLote}</option>)}
                </select>
              </div>

              <div className="hor-field">
                <label>Grupo</label>
                <select name="grupo" value={form.grupo} onChange={handleChange} disabled={!form.loteId}>
                  <option value="">{form.loteId ? '— Sin grupo —' : '— Seleccione un lote primero —'}</option>
                  {gruposDelLote.map(g => (
                    <option key={g.id} value={g.nombreGrupo}>{grupoLabel(g)}</option>
                  ))}
                </select>
              </div>

              <div className="hor-field">
                <label>Bloque</label>
                <select name="bloque" value={form.bloque} onChange={handleChange} disabled={!form.loteId}>
                  <option value="">{form.loteId ? '— Sin bloque —' : '— Seleccione un lote primero —'}</option>
                  {bloquesDisponibles.map(s => {
                    const val = s.bloque || s.id;
                    return <option key={s.id} value={val}>Bloque {val}</option>;
                  })}
                </select>
              </div>
            </div>

            {/* Cantidad y unidad */}
            <p className="hor-section-label">Cosecha</p>
            <div className="hor-form-grid hor-grid-2">
              <div className="hor-field">
                <label>Cantidad cosechada *</label>
                <input
                  type="number"
                  name="cantidad"
                  min="0"
                  step="any"
                  value={form.cantidad}
                  onChange={handleChange}
                  placeholder="0"
                  required
                />
              </div>

              <div className="hor-field">
                <label>Unidad</label>
                <Combobox
                  value={form.unidadId}
                  onChange={handleUnidadChange}
                  items={unidades}
                  labelFn={unidadLabel}
                  placeholder="Buscar unidad…"
                />
              </div>
            </div>

            {/* Operario / Activo / Implemento */}
            <p className="hor-section-label">Recursos</p>
            <div className="hor-form-grid hor-grid-2">
              <div className="hor-field">
                <label>Operario</label>
                <Combobox
                  value={form.operarioId}
                  onChange={handleOperarioChange}
                  items={usuarios}
                  labelKey="nombre"
                  placeholder="Buscar operario…"
                />
              </div>

              <div className="hor-field">
                <label>Activo</label>
                <Combobox
                  value={form.activoId}
                  onChange={handleActivoChange}
                  items={activos}
                  labelFn={activoLabel}
                  placeholder="Buscar activo…"
                />
              </div>

              <div className="hor-field">
                <label>Implemento</label>
                <Combobox
                  value={form.implementoId}
                  onChange={handleImplementoChange}
                  items={implementos}
                  labelFn={activoLabel}
                  placeholder="Buscar implemento…"
                />
              </div>
            </div>

            {/* Nota */}
            <p className="hor-section-label">Observaciones</p>
            <div className="hor-form-grid">
              <div className="hor-field hor-field--full">
                <label>Nota</label>
                <textarea
                  name="nota"
                  value={form.nota}
                  onChange={handleChange}
                  placeholder="Observaciones adicionales…"
                  rows={3}
                />
              </div>
            </div>

            <div className="form-actions" style={{ marginTop: 16 }}>
              <button type="submit" className="btn btn-primary" disabled={saving}>
                <FiCheck size={15} />
                {saving ? 'Guardando…' : isEditing ? 'Actualizar' : 'Guardar'}
              </button>
              <button type="button" className="btn btn-secondary" onClick={resetForm}>
                Cancelar
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ── Lista de registros ── */}
      <div className="hor-form-card">
        <div className="hor-form-header">
          <span>Registros de cosecha {records.length > 0 && `(${records.length})`}</span>
        </div>
        <div style={{ padding: '12px 18px' }}>
          {records.length === 0 ? (
            <p className="empty-state">No hay registros de cosecha aún.</p>
          ) : (
            <ul className="info-list">
              {records.map(rec => (
                <li key={rec.id}>
                  <div>
                    <span className="item-main-text">
                      {rec.consecutivo && (
                        <span style={{ color: 'var(--aurora-green)', marginRight: 8 }}>{rec.consecutivo}</span>
                      )}
                      {rec.fecha} — {rec.loteNombre || 'Sin lote'}
                      {rec.bloque ? ` / Bloque ${rec.bloque}` : ''}
                    </span>
                    <div style={{ fontSize: '0.82rem', color: 'var(--aurora-light)', opacity: 0.7, marginTop: 2 }}>
                      {rec.cantidad} {rec.unidad || ''}
                      {rec.operarioNombre ? ` · ${rec.operarioNombre}` : ''}
                      {rec.activoNombre ? ` · ${rec.activoNombre}` : ''}
                      {rec.implementoNombre ? ` · ${rec.implementoNombre}` : ''}
                    </div>
                  </div>
                  <div className="lote-actions">
                    <button className="icon-btn" onClick={() => handleEdit(rec)} title="Editar">
                      <FiEdit size={15} />
                    </button>
                    <button className="icon-btn icon-btn--danger" onClick={() => handleDelete(rec.id)} title="Eliminar">
                      <FiTrash2 size={15} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
