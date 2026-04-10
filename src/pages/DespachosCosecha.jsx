import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { FiPlus, FiX, FiCheck, FiAlertTriangle } from 'react-icons/fi';
import Toast from '../components/Toast';
import { useApiFetch } from '../hooks/useApiFetch';
import { useUser } from '../contexts/UserContext';
import './Horimetro.css';
import './DespachosCosecha.css';

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmt = (v) => {
  if (!v) return '—';
  const d = new Date(v);
  if (isNaN(d)) return v;
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

const num = (v) => (v != null && v !== '' ? Number(v).toLocaleString('es-ES') : '—');

// ── Combobox genérico ─────────────────────────────────────────────────────────
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

// ── Selector de boletas de cosecha ────────────────────────────────────────────
function BoletasSelect({ registros, selected, onChange, loteId }) {
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return registros
      .filter(r => !loteId || r.loteId === loteId)
      .filter(r =>
        !q ||
        (r.consecutivo  || '').toLowerCase().includes(q) ||
        (r.loteNombre   || '').toLowerCase().includes(q) ||
        (r.grupo        || '').toLowerCase().includes(q) ||
        (r.bloque       || '').toLowerCase().includes(q),
      );
  }, [registros, loteId, search]);

  const toggle = (reg) => {
    const already = selected.find(s => s.id === reg.id);
    if (already) {
      onChange(selected.filter(s => s.id !== reg.id));
    } else {
      onChange([...selected, { id: reg.id, consecutivo: reg.consecutivo }]);
    }
  };

  return (
    <div className="dsp-boletas-wrap">
      {selected.length > 0 && (
        <div className="dsp-boletas-chips">
          {selected.map(s => (
            <span key={s.id} className="dsp-boleta-chip">
              {s.consecutivo}
              <button
                type="button"
                onClick={() => onChange(selected.filter(x => x.id !== s.id))}
                className="dsp-boleta-chip-remove"
              >
                <FiX size={10} />
              </button>
            </span>
          ))}
        </div>
      )}
      <input
        className="dsp-boletas-search"
        placeholder={loteId ? 'Buscar boleta por consecutivo, lote…' : '— Seleccione un lote primero —'}
        value={search}
        onChange={e => setSearch(e.target.value)}
        disabled={!loteId}
      />
      {loteId && (
        <div className="dsp-boletas-list">
          {filtered.length === 0 ? (
            <span className="dsp-boletas-empty">Sin boletas para este lote</span>
          ) : (
            filtered.map(reg => {
              const checked = !!selected.find(s => s.id === reg.id);
              return (
                <label
                  key={reg.id}
                  className={`dsp-boleta-item${checked ? ' dsp-boleta-item--checked' : ''}`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(reg)}
                  />
                  <span className="dsp-boleta-consec">{reg.consecutivo}</span>
                  <span className="dsp-boleta-info">
                    {reg.fecha}
                    {reg.loteNombre ? ` · ${reg.loteNombre}` : ''}
                    {reg.grupo ? ` / ${reg.grupo}` : ''}
                    {reg.bloque ? ` / Bloque ${reg.bloque}` : ''}
                    {reg.cantidad != null ? ` · ${reg.cantidad} ${reg.unidad || ''}` : ''}
                  </span>
                </label>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

// ── Diálogo de anulación inline ────────────────────────────────────────────────
function AnularDialog({ despacho, onConfirm, onCancel }) {
  const [nota, setNota] = useState('');
  return (
    <div className="dsp-anular-dialog">
      <div className="dsp-anular-header">
        <FiAlertTriangle size={14} />
        <span>Anular {despacho.consecutivo} — esta acción no se puede deshacer.</span>
      </div>
      <div className="hor-field" style={{ margin: '8px 0' }}>
        <label>Motivo (opcional)</label>
        <input
          type="text"
          value={nota}
          onChange={e => setNota(e.target.value)}
          placeholder="Razón de la anulación…"
          autoFocus
          onKeyDown={e => { if (e.key === 'Enter') onConfirm(nota); if (e.key === 'Escape') onCancel(); }}
        />
      </div>
      <div className="dsp-anular-actions">
        <button type="button" className="btn btn-danger" onClick={() => onConfirm(nota)}>
          Confirmar anulación
        </button>
        <button type="button" className="btn btn-secondary" onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </div>
  );
}

// ── Componente principal ──────────────────────────────────────────────────────
export default function DespachosCosecha() {
  const apiFetch = useApiFetch();
  const { currentUser } = useUser();

  const [lotes,           setLotes]           = useState([]);
  const [usuarios,        setUsuarios]        = useState([]);
  const [unidades,        setUnidades]        = useState([]);
  const [registrosCosecha, setRegistrosCosecha] = useState([]);
  const [despachos,       setDespachos]       = useState([]);
  const [loading,         setLoading]         = useState(true);

  const [showForm,   setShowForm]   = useState(false);
  const [saving,     setSaving]     = useState(false);
  const [anulandoId, setAnulandoId] = useState(null);
  const [toast,      setToast]      = useState(null);

  const showToast = (msg, type = 'success') => setToast({ message: msg, type });

  const emptyForm = useCallback(() => ({
    fecha:                new Date().toISOString().slice(0, 10),
    loteId:               '',
    loteNombre:           '',
    operarioCamionNombre: '',
    placaCamion:          '',
    cantidad:             '',
    unidadId:             '',
    unidad:               '',
    boletas:              [],
    despachadorId:        currentUser?.id    || '',
    despachadorNombre:    currentUser?.nombre || '',
    encargadoId:          '',
    encargadoNombre:      '',
    nota:                 '',
  }), [currentUser]);

  const [form, setForm] = useState(() => emptyForm());

  // ── Carga ─────────────────────────────────────────────────────────────────
  const fetchDespachos = () =>
    apiFetch('/api/cosecha/despachos')
      .then(r => r.json())
      .then(data => setDespachos(Array.isArray(data) ? data : []))
      .catch(() => {});

  useEffect(() => {
    Promise.all([
      apiFetch('/api/lotes').then(r => r.json()),
      apiFetch('/api/users').then(r => r.json()),
      apiFetch('/api/unidades-medida').then(r => r.json()),
      apiFetch('/api/cosecha/registros').then(r => r.json()),
    ]).then(([lotesData, usersData, unidadesData, registrosData]) => {
      setLotes(Array.isArray(lotesData) ? lotesData : []);
      setUsuarios(Array.isArray(usersData) ? usersData.filter(u => u.empleadoPlanilla) : []);
      setUnidades(Array.isArray(unidadesData) ? unidadesData : []);
      setRegistrosCosecha(Array.isArray(registrosData) ? registrosData : []);
    }).catch(() => {}).finally(() => setLoading(false));
    fetchDespachos();
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

  const resetForm = () => { setForm(emptyForm()); setShowForm(false); };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.fecha || !form.loteId || !form.cantidad) {
      showToast('Fecha, lote y cantidad son obligatorios.', 'error');
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
      showToast('Despacho registrado.');
      resetForm();
      fetchDespachos();
    } catch {
      showToast('Error al guardar.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleAnular = async (id, notaAnulacion) => {
    try {
      const res = await apiFetch(`/api/cosecha/despachos/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ estado: 'anulado', notaAnulacion: notaAnulacion || '' }),
      });
      if (!res.ok) throw new Error();
      setDespachos(prev =>
        prev.map(d => d.id === id ? { ...d, estado: 'anulado', notaAnulacion } : d),
      );
      showToast('Despacho anulado.');
    } catch {
      showToast('Error al anular.', 'error');
    } finally {
      setAnulandoId(null);
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
        <h1 className="hor-page-title">Despacho de Cosecha</h1>
        {!showForm && (
          <button className="btn btn-primary" onClick={() => { setForm(emptyForm()); setShowForm(true); }}>
            <FiPlus size={15} /> Nuevo despacho
          </button>
        )}
      </div>

      {/* ── Formulario ────────────────────────────────────────────────────── */}
      {showForm && (
        <div className="hor-form-card">
          <div className="hor-form-header">
            <span>Nuevo despacho de cosecha</span>
            <button className="icon-btn" onClick={resetForm} title="Cancelar">
              <FiX size={16} />
            </button>
          </div>

          <form onSubmit={handleSubmit} style={{ padding: '16px 18px' }}>

            <p className="hor-section-label">Fecha y lote</p>
            <div className="hor-form-grid hor-grid-2">
              <div className="hor-field">
                <label>Fecha *</label>
                <input type="date" name="fecha" value={form.fecha} onChange={handleChange} required />
              </div>
              <div className="hor-field">
                <label>Lote *</label>
                <select name="loteId" value={form.loteId} onChange={handleChange} required>
                  <option value="">— Seleccionar —</option>
                  {lotes.map(l => <option key={l.id} value={l.id}>{l.nombreLote}</option>)}
                </select>
              </div>
            </div>

            <p className="hor-section-label">Transporte</p>
            <div className="hor-form-grid hor-grid-2">
              <div className="hor-field">
                <label>Operario de camión</label>
                <input
                  type="text"
                  name="operarioCamionNombre"
                  value={form.operarioCamionNombre}
                  onChange={handleChange}
                  placeholder="Nombre del chofer…"
                />
              </div>
              <div className="hor-field">
                <label>Placa de camión</label>
                <input
                  type="text"
                  name="placaCamion"
                  value={form.placaCamion}
                  onChange={handleChange}
                  placeholder="Ej. ABC-123"
                />
              </div>
            </div>

            <p className="hor-section-label">Carga</p>
            <div className="hor-form-grid hor-grid-2">
              <div className="hor-field">
                <label>Cantidad *</label>
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

            <p className="hor-section-label">
              Boletas de cosecha
              {!form.loteId && <span className="dsp-section-hint"> — seleccione un lote primero</span>}
            </p>
            <div className="hor-form-grid">
              <div className="hor-field hor-field--full">
                <label>Boletas de cosecha</label>
                <BoletasSelect
                  registros={registrosCosecha}
                  selected={form.boletas}
                  onChange={(boletas) => setForm(prev => ({ ...prev, boletas }))}
                  loteId={form.loteId}
                />
              </div>
            </div>

            <p className="hor-section-label">Responsables</p>
            <div className="hor-form-grid hor-grid-2">
              <div className="hor-field">
                <label>Despachador</label>
                <Combobox
                  value={form.despachadorId}
                  onChange={handleDespachador}
                  items={usuarios}
                  labelKey="nombre"
                  placeholder="Buscar despachador…"
                />
              </div>
              <div className="hor-field">
                <label>Encargado de cosecha</label>
                <Combobox
                  value={form.encargadoId}
                  onChange={handleEncargado}
                  items={usuarios}
                  labelKey="nombre"
                  placeholder="Buscar encargado…"
                />
              </div>
            </div>

            <p className="hor-section-label">Observaciones</p>
            <div className="hor-form-grid">
              <div className="hor-field hor-field--full">
                <label>Nota</label>
                <textarea
                  name="nota"
                  value={form.nota}
                  onChange={handleChange}
                  placeholder="Observaciones adicionales…"
                  rows={2}
                />
              </div>
            </div>

            <div className="form-actions" style={{ marginTop: 16 }}>
              <button type="submit" className="btn btn-primary" disabled={saving}>
                <FiCheck size={15} />
                {saving ? 'Guardando…' : 'Registrar despacho'}
              </button>
              <button type="button" className="btn btn-secondary" onClick={resetForm}>
                Cancelar
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ── Lista de despachos ─────────────────────────────────────────────── */}
      <div className="hor-form-card">
        <div className="hor-form-header">
          <span>Despachos registrados {despachos.length > 0 && `(${despachos.length})`}</span>
        </div>
        <div style={{ padding: '12px 18px' }}>
          {despachos.length === 0 ? (
            <p className="empty-state">No hay despachos registrados aún.</p>
          ) : (
            <ul className="info-list">
              {despachos.map(d => (
                <li key={d.id} className={d.estado === 'anulado' ? 'dsp-item--anulado' : ''}>
                  <div className="dsp-item-content">

                    {/* Primera línea: consecutivo + badge */}
                    <div className="dsp-item-row">
                      <span className="dsp-consec">{d.consecutivo}</span>
                      {d.estado === 'anulado'
                        ? <span className="dsp-badge dsp-badge--anulado">Anulado</span>
                        : <span className="dsp-badge dsp-badge--activo">Activo</span>}
                    </div>

                    {/* Segunda línea: fecha + lote + placa */}
                    <div className="item-main-text">
                      {fmt(d.fecha)}
                      {d.loteNombre ? ` — ${d.loteNombre}` : ''}
                      {d.placaCamion ? ` · Placa: ${d.placaCamion}` : ''}
                    </div>

                    {/* Meta: cantidad, operarios */}
                    <div className="dsp-item-meta">
                      {d.cantidad != null && <span>{num(d.cantidad)} {d.unidad || ''}</span>}
                      {d.operarioCamionNombre && <span>· Op. camión: {d.operarioCamionNombre}</span>}
                      {d.despachadorNombre    && <span>· Despachador: {d.despachadorNombre}</span>}
                      {d.encargadoNombre      && <span>· Encargado: {d.encargadoNombre}</span>}
                    </div>

                    {/* Boletas vinculadas */}
                    {d.boletas?.length > 0 && (
                      <div className="dsp-boletas-tags">
                        {d.boletas.map(b => (
                          <span key={b.id} className="dsp-boleta-tag">{b.consecutivo}</span>
                        ))}
                      </div>
                    )}

                    {/* Nota de anulación */}
                    {d.estado === 'anulado' && d.notaAnulacion && (
                      <div className="dsp-nota-anulacion">Motivo: {d.notaAnulacion}</div>
                    )}

                    {/* Nota general */}
                    {d.nota && <div className="dsp-nota">{d.nota}</div>}

                    {/* Diálogo inline de anulación */}
                    {anulandoId === d.id && (
                      <AnularDialog
                        despacho={d}
                        onConfirm={(nota) => handleAnular(d.id, nota)}
                        onCancel={() => setAnulandoId(null)}
                      />
                    )}
                  </div>

                  {/* Acción Anular (solo para activos y cuando no hay diálogo abierto) */}
                  {d.estado !== 'anulado' && anulandoId !== d.id && (
                    <div className="lote-actions">
                      <button
                        className="btn btn-secondary dsp-btn-anular"
                        onClick={() => setAnulandoId(d.id)}
                      >
                        Anular
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
