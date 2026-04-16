import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { FiCheck, FiClock } from 'react-icons/fi';
import Toast from '../components/Toast';
import { useApiFetch } from '../hooks/useApiFetch';
import './Horimetro.css';

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

// ── Formulario principal ─────────────────────────────────────────────────────
// Fecha local en formato YYYY-MM-DD (sin shift por UTC)
const toLocalISODate = (d) => {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};
const todayISO = () => toLocalISODate(new Date());

// Strict validation: rejects non-existent dates like "2026-02-30"
// (which `new Date()` would silently normalize to another real date).
const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;
const isValidISODate = (s) => {
  if (typeof s !== 'string' || !FECHA_RE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return (
    dt.getFullYear() === y &&
    dt.getMonth() === m - 1 &&
    dt.getDate() === d
  );
};

const CANTIDAD_MAX = 16384;   // exclusive
const NOTA_MAX     = 288;     // exclusive (max 287 characters)

const makeEmptyForm = () => ({
  fecha: todayISO(),
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
});

export default function CosechaRegistro() {
  const apiFetch = useApiFetch();

  const [lotes, setLotes]         = useState([]);
  const [grupos, setGrupos]       = useState([]);
  const [siembras, setSiembras]   = useState([]);
  const [unidades, setUnidades]   = useState([]);
  const [usuarios, setUsuarios]   = useState([]);
  const [maquinaria, setMaquinaria] = useState([]);
  const [loading, setLoading]     = useState(true);

  const [form, setForm]           = useState(makeEmptyForm);
  const [saving, setSaving]       = useState(false);
  const [toast, setToast]         = useState(null);
  const showToast = (msg, type = 'success') => setToast({ message: msg, type });

  useEffect(() => {
    let alive = true;
    Promise.all([
      apiFetch('/api/lotes').then(r => r.json()),
      apiFetch('/api/grupos').then(r => r.json()),
      apiFetch('/api/siembras').then(r => r.json()),
      apiFetch('/api/unidades-medida').then(r => r.json()),
      apiFetch('/api/users').then(r => r.json()),
      apiFetch('/api/maquinaria').then(r => r.json()),
    ]).then(([lotesData, gruposData, siembrasData, unidadesData, usersData, maqData]) => {
      if (!alive) return;
      setLotes(Array.isArray(lotesData) ? lotesData : []);
      setGrupos(Array.isArray(gruposData) ? gruposData : []);
      setSiembras(Array.isArray(siembrasData) ? siembrasData : []);
      setUnidades(Array.isArray(unidadesData) ? unidadesData : []);
      setUsuarios(Array.isArray(usersData) ? usersData.filter(u => u.empleadoPlanilla) : []);
      setMaquinaria(Array.isArray(maqData) ? maqData : []);
    }).catch(() => {})
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
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
    setForm(makeEmptyForm());
  };

  const validateForm = () => {
    // fecha — required, existing, not after the current day
    if (!form.fecha) return 'La fecha es requerida.';
    if (!isValidISODate(form.fecha)) return 'Fecha inválida.';
    if (form.fecha > todayISO()) {
      return 'La fecha no puede ser posterior al día actual.';
    }
    // lote
    if (!form.loteId || !form.loteId.trim()) return 'El lote es requerido.';
    // cantidad — > 0 y < 16384
    const cant = Number(form.cantidad);
    if (!Number.isFinite(cant) || cant <= 0 || cant >= CANTIDAD_MAX) {
      return `La cantidad cosechada debe ser mayor a 0 y menor a ${CANTIDAD_MAX}.`;
    }
    // nota — < 288 caracteres
    if ((form.nota || '').length >= NOTA_MAX) {
      return `La nota no puede superar ${NOTA_MAX - 1} caracteres.`;
    }
    // lengths of other fields (defense against tampered values)
    if ((form.grupo || '').length > 128)            return 'El grupo es demasiado largo.';
    if ((form.bloque || '').length > 64)            return 'El bloque es demasiado largo.';
    if ((form.unidad || '').length > 64)            return 'La unidad es demasiado larga.';
    if ((form.operarioNombre || '').length > 128)   return 'El nombre del operario es demasiado largo.';
    if ((form.activoNombre || '').length > 160)     return 'El nombre del activo es demasiado largo.';
    if ((form.implementoNombre || '').length > 160) return 'El nombre del implemento es demasiado largo.';
    return null;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const validationError = validateForm();
    if (validationError) {
      showToast(validationError, 'error');
      return;
    }
    setSaving(true);
    try {
      // Explicit payload: only fields the backend persists
      // (avoids sending local state like `unidadId` which the backend discards).
      const payload = {
        fecha: form.fecha,
        loteId: form.loteId,
        loteNombre: form.loteNombre,
        grupo: form.grupo,
        bloque: form.bloque,
        cantidad: form.cantidad,
        unidad: form.unidad,
        operarioId: form.operarioId,
        operarioNombre: form.operarioNombre,
        activoId: form.activoId,
        activoNombre: form.activoNombre,
        implementoId: form.implementoId,
        implementoNombre: form.implementoNombre,
        nota: form.nota,
      };
      const res = await apiFetch('/api/cosecha/registros', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || 'Error al guardar.');
      }
      showToast('Registro guardado.');
      resetForm();
    } catch (err) {
      showToast(err.message || 'Error al guardar.', 'error');
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
        <Link to="/cosecha/historial" className="btn btn-secondary">
          <FiClock size={14} /> Historial
        </Link>
      </div>

      {/* ── Formulario ── */}
      <div className="hor-form-card">
        <div className="hor-form-header">
          <span>Nuevo registro de cosecha</span>
        </div>

        <form onSubmit={handleSubmit} style={{ padding: '16px 18px' }}>

          {/* Fecha */}
          <div className="hor-form-grid hor-grid-2">
            <div className="hor-field">
              <label>Fecha</label>
              <input
                type="date"
                name="fecha"
                value={form.fecha}
                onChange={handleChange}
                max={todayISO()}
                required
              />
            </div>
          </div>

          {/* Ubicación: lote / grupo / bloque */}
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
          <div className="hor-form-grid hor-grid-2">
            <div className="hor-field">
              <label>Cantidad cosechada *</label>
              <input
                type="number"
                name="cantidad"
                min="0.0001"
                max={CANTIDAD_MAX - 0.0001}
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
              <textarea
                name="nota"
                value={form.nota}
                onChange={handleChange}
                placeholder="Observaciones adicionales…"
                rows={3}
                maxLength={NOTA_MAX - 1}
              />
            </div>
          </div>

          <div className="form-actions" style={{ marginTop: 16 }}>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              <FiCheck size={15} />
              {saving ? 'Guardando…' : 'Guardar'}
            </button>
            <button type="button" className="btn btn-secondary" onClick={resetForm}>
              Cancelar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
