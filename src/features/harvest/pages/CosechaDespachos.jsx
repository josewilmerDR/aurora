import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { FiX, FiCheck, FiClock } from 'react-icons/fi';
import Toast from '../../../components/Toast';
import BuyerSelector from '../../finance/components/BuyerSelector';
import { useApiFetch } from '../../../hooks/useApiFetch';
import { useUser } from '../../../contexts/UserContext';
import '../../../pages/Horimetro.css';
import '../styles/cosecha-despachos.css';

// ── Generic combobox ─────────────────────────────────────────────────────────
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
function BoletasSelect({ registros, selected, onChange, usedIds = new Set() }) {
  const filtered = useMemo(
    () => registros.filter(r => !usedIds.has(r.id)),
    [registros, usedIds],
  );

  const toggle = (reg) => {
    const already = selected.find(s => s.id === reg.id);
    if (already) {
      onChange(selected.filter(s => s.id !== reg.id));
    } else {
      onChange([...selected, {
        id: reg.id,
        consecutivo: reg.consecutivo,
        cantidad: reg.cantidad ?? null,
        unidad: reg.unidad ?? '',
      }]);
    }
  };

  return (
    <div className="dsp-boletas-wrap">
      {selected.length > 0 && (
        <div className="dsp-boletas-chips">
          {selected.map(s => (
            <span key={s.id} className="dsp-boleta-chip">
              {s.consecutivo}
              {s.cantidad != null && (
                <span style={{ opacity: 0.75, marginLeft: 3 }}>
                  {Number(s.cantidad).toLocaleString('es-ES')} {s.unidad}
                </span>
              )}
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
      <div className="dsp-boletas-list">
          {filtered.length === 0 ? (
            <span className="dsp-boletas-empty">Sin boletas de cosecha disponibles</span>
          ) : (
            filtered.map(reg => {
              const checked = !!selected.find(s => s.id === reg.id);
              return (
                <div
                  key={reg.id}
                  className={`dsp-boleta-item${checked ? ' dsp-boleta-item--checked' : ''}`}
                  onClick={() => toggle(reg)}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(reg)}
                    onClick={e => e.stopPropagation()}
                  />
                  <span className="dsp-boleta-consec">
                    {reg.consecutivo}
                  </span>
                  {reg.cantidad != null && (
                    <span className="dsp-boleta-qty">
                      {Number(reg.cantidad).toLocaleString('es-ES')} {reg.unidad || ''}
                    </span>
                  )}
                </div>
              );
            })
          )}
        </div>
    </div>
  );
}

// ── Validation constants ─────────────────────────────────────────────────────
const MAX_OPERARIO   = 48;
const MAX_PLACA      = 12;
const MAX_NOTA       = 288;
const MAX_CANTIDAD   = 32768;

// ── Componente principal ──────────────────────────────────────────────────────
export default function CosechaDespachos() {
  const apiFetch = useApiFetch();
  const { currentUser } = useUser();

  const [lotes,           setLotes]           = useState([]);
  const [usuarios,        setUsuarios]        = useState([]);
  const [unidades,        setUnidades]        = useState([]);
  const [registrosCosecha, setRegistrosCosecha] = useState([]);
  const [despachos,       setDespachos]       = useState([]);
  const [loading,         setLoading]         = useState(true);

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
    despachadorId:        currentUser?.id    || '',
    despachadorNombre:    currentUser?.nombre || '',
    encargadoId:          '',
    encargadoNombre:      '',
    nota:                 '',
  }), [currentUser, today]);

  const [form, setForm] = useState(() => emptyForm());

  // ── Carga ─────────────────────────────────────────────────────────────────
  const fetchDespachos = useCallback(() =>
    apiFetch('/api/cosecha/despachos')
      .then(r => r.json())
      .then(data => setDespachos(Array.isArray(data) ? data : []))
      .catch(() => {}),
  [apiFetch]);

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

  const resetForm = () => setForm(emptyForm());

  const usedBoletaIds = useMemo(
    () => new Set(
      despachos
        .filter(d => d.estado !== 'anulado')
        .flatMap(d => (d.boletas || []).map(b => b.id)),
    ),
    [despachos],
  );

  const handleSubmit = async (e) => {
    e.preventDefault();
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
      showToast('Despacho registrado.');
      resetForm();
      fetchDespachos();
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
        <h1 className="hor-page-title">Despacho de Cosecha</h1>
        <Link to="/cosecha/historial-despachos" className="btn btn-secondary">
          <FiClock size={14} /> Historial
        </Link>
      </div>

      {/* ── Formulario ────────────────────────────────────────────────────── */}
      <div className="hor-form-card">
        <div className="hor-form-header">
          <span>Nuevo despacho de cosecha</span>
          <button className="icon-btn" onClick={resetForm} title="Limpiar formulario">
            <FiX size={16} />
          </button>
        </div>

          <form onSubmit={handleSubmit} style={{ padding: '16px 18px' }}>

            <div className="hor-form-grid hor-grid-2">
              <div className="hor-field">
                <label>Fecha *</label>
                <input type="date" name="fecha" value={form.fecha} onChange={handleChange} max={today} required />
              </div>
              <div className="hor-field">
                <label>Lote *</label>
                <select name="loteId" value={form.loteId} onChange={handleChange} required>
                  <option value="">— Seleccionar —</option>
                  {lotes.map(l => <option key={l.id} value={l.id}>{l.nombreLote}</option>)}
                </select>
              </div>
            </div>

            <div className="hor-form-grid hor-grid-2">
              <div className="hor-field">
                <label>Comprador *</label>
                <BuyerSelector
                  value={form.buyerId}
                  onChange={(v) => setForm(prev => ({ ...prev, buyerId: v }))}
                  required
                />
              </div>
            </div>

            <div className="hor-form-grid hor-grid-2">
              <div className="hor-field">
                <label>Operario de camión</label>
                <input
                  type="text"
                  name="operarioCamionNombre"
                  value={form.operarioCamionNombre}
                  onChange={handleChange}
                  placeholder="Nombre del chofer…"
                  maxLength={MAX_OPERARIO}
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
                  maxLength={MAX_PLACA}
                />
              </div>
            </div>

            <p className="hor-section-label">Boletas de cosecha</p>
            <div className="hor-form-grid">
              <div className="hor-field hor-field--full">
                <BoletasSelect
                  registros={registrosCosecha}
                  usedIds={usedBoletaIds}
                  selected={form.boletas}
                  onChange={(boletas) => {
                    const suma = boletas.reduce((acc, b) => acc + (parseFloat(b.cantidad) || 0), 0);
                    setForm(prev => ({
                      ...prev,
                      boletas,
                      cantidad: suma > 0 ? String(suma) : '',
                    }));
                  }}
                />
              </div>
            </div>

            <div className="hor-form-grid hor-grid-2">
              <div className="hor-field">
                <label>Cantidad *</label>
                <input
                  type="number"
                  name="cantidad"
                  min="0"
                  max={MAX_CANTIDAD}
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
                <textarea
                  name="nota"
                  value={form.nota}
                  onChange={handleChange}
                  placeholder="Observaciones adicionales…"
                  rows={2}
                  maxLength={MAX_NOTA}
                />
              </div>
            </div>

            <div className="form-actions" style={{ marginTop: 16 }}>
              <button type="submit" className="btn btn-primary" disabled={saving}>
                <FiCheck size={15} />
                {saving ? 'Guardando…' : 'Registrar despacho'}
              </button>
              <button type="button" className="btn btn-secondary" onClick={resetForm}>
                Limpiar
              </button>
            </div>
          </form>
      </div>

    </div>
  );
}
