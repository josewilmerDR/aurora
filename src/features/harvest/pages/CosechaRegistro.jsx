import { useState, useEffect, useMemo, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { FiCheck, FiClock } from 'react-icons/fi';
import Toast from '../../../components/Toast';
import { useApiFetch } from '../../../hooks/useApiFetch';
import HarvestCombobox from '../components/HarvestCombobox';
import '../styles/harvest.css';

// Fecha local en formato YYYY-MM-DD (sin shift por UTC).
const toLocalISODate = (d) => {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};
const todayISO = () => toLocalISODate(new Date());

// Validación estricta: rechaza fechas inexistentes ("2026-02-30").
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

const CANTIDAD_MAX = 16384;
const NOTA_MAX     = 288;

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

  const [lotes, setLotes]           = useState([]);
  const [grupos, setGrupos]         = useState([]);
  const [siembras, setSiembras]     = useState([]);
  const [unidades, setUnidades]     = useState([]);
  const [usuarios, setUsuarios]     = useState([]);
  const [maquinaria, setMaquinaria] = useState([]);
  const [loading, setLoading]       = useState(true);

  const [form, setForm]   = useState(makeEmptyForm);
  const [saving, setSaving] = useState(false);
  const [toast, setToast]   = useState(null);
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

  // ── Listas derivadas (lote → grupo → bloque) ─────────────────────────────
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

  const activos     = useMemo(() => maquinaria.filter(m => m.tipo !== 'IMPLEMENTO'), [maquinaria]);
  const implementos = useMemo(() => maquinaria.filter(m => m.tipo === 'IMPLEMENTO'), [maquinaria]);

  const activoLabel = useCallback(
    (m) => m ? [m.codigo, m.descripcion].filter(Boolean).join(' — ') : '',
    [],
  );
  const unidadLabel = useCallback(
    (u) => u ? [u.nombre, u.descripcion].filter(Boolean).join(' — ') : '',
    [],
  );

  // ── Handlers ──────────────────────────────────────────────────────────────
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
  const handleActivoChange = (id) => {
    const m = activos.find(x => x.id === id);
    setForm(prev => ({ ...prev, activoId: id, activoNombre: activoLabel(m) }));
  };
  const handleImplementoChange = (id) => {
    const m = implementos.find(x => x.id === id);
    setForm(prev => ({ ...prev, implementoId: id, implementoNombre: activoLabel(m) }));
  };
  const handleUnidadChange = (id) => {
    const u = unidades.find(x => x.id === id);
    setForm(prev => ({ ...prev, unidadId: id, unidad: u ? u.nombre : '' }));
  };

  const resetForm = () => setForm(makeEmptyForm());

  const validateForm = () => {
    if (!form.fecha) return 'La fecha es requerida.';
    if (!isValidISODate(form.fecha)) return 'Fecha inválida.';
    if (form.fecha > todayISO()) {
      return 'La fecha no puede ser posterior al día actual.';
    }
    if (!form.loteId || !form.loteId.trim()) return 'El lote es requerido.';
    const cant = Number(form.cantidad);
    if (!Number.isFinite(cant) || cant <= 0 || cant >= CANTIDAD_MAX) {
      return `La cantidad cosechada debe ser mayor a 0 y menor a ${CANTIDAD_MAX}.`;
    }
    if ((form.nota || '').length >= NOTA_MAX) {
      return `La nota no puede superar ${NOTA_MAX - 1} caracteres.`;
    }
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
    return <div className="harvest-page-loading" />;
  }

  return (
    <div className="harvest-page">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      <form className="aur-sheet" onSubmit={handleSubmit} noValidate>
        <header className="aur-sheet-header">
          <div className="aur-sheet-header-text">
            <h1 className="aur-sheet-title">Registro de cosecha</h1>
            <p className="aur-sheet-subtitle">Captura una nueva boleta de cosecha.</p>
          </div>
          <div className="aur-sheet-header-actions">
            <Link to="/cosecha/historial" className="aur-chip">
              <FiClock size={12} /> Historial
            </Link>
          </div>
        </header>

        <section className="aur-section">
          <div className="aur-section-header">
            <span className="aur-section-num">01</span>
            <h3 className="aur-section-title">Fecha y ubicación</h3>
          </div>
          <div className="aur-list">
            <div className="aur-row">
              <label className="aur-row-label" htmlFor="cr-fecha">Fecha</label>
              <input
                id="cr-fecha"
                type="date"
                name="fecha"
                className="aur-input"
                value={form.fecha}
                onChange={handleChange}
                max={todayISO()}
                required
              />
            </div>
            <div className="aur-row">
              <label className="aur-row-label" htmlFor="cr-lote">Lote</label>
              <select
                id="cr-lote"
                name="loteId"
                className="aur-select"
                value={form.loteId}
                onChange={handleChange}
                required
              >
                <option value="">— Seleccionar —</option>
                {lotes.map(l => <option key={l.id} value={l.id}>{l.nombreLote}</option>)}
              </select>
            </div>
            <div className="aur-row">
              <label className="aur-row-label" htmlFor="cr-grupo">Grupo</label>
              <select
                id="cr-grupo"
                name="grupo"
                className="aur-select"
                value={form.grupo}
                onChange={handleChange}
                disabled={!form.loteId}
              >
                <option value="">{form.loteId ? '— Sin grupo —' : '— Seleccione un lote primero —'}</option>
                {gruposDelLote.map(g => (
                  <option key={g.id} value={g.nombreGrupo}>{grupoLabel(g)}</option>
                ))}
              </select>
            </div>
            <div className="aur-row">
              <label className="aur-row-label" htmlFor="cr-bloque">Bloque</label>
              <select
                id="cr-bloque"
                name="bloque"
                className="aur-select"
                value={form.bloque}
                onChange={handleChange}
                disabled={!form.loteId}
              >
                <option value="">{form.loteId ? '— Sin bloque —' : '— Seleccione un lote primero —'}</option>
                {bloquesDisponibles.map(s => {
                  const val = s.bloque || s.id;
                  return <option key={s.id} value={val}>Bloque {val}</option>;
                })}
              </select>
            </div>
          </div>
        </section>

        <section className="aur-section">
          <div className="aur-section-header">
            <span className="aur-section-num">02</span>
            <h3 className="aur-section-title">Cantidad cosechada</h3>
          </div>
          <div className="aur-list">
            <div className="aur-row">
              <label className="aur-row-label" htmlFor="cr-cantidad">Cantidad</label>
              <input
                id="cr-cantidad"
                type="number"
                name="cantidad"
                className="aur-input aur-input--num"
                min="0.0001"
                max={CANTIDAD_MAX - 0.0001}
                step="any"
                value={form.cantidad}
                onChange={handleChange}
                placeholder="0"
                required
              />
            </div>
            <div className="aur-row">
              <label className="aur-row-label">Unidad</label>
              <HarvestCombobox
                value={form.unidadId}
                onChange={handleUnidadChange}
                items={unidades}
                labelFn={unidadLabel}
                placeholder="Buscar unidad…"
              />
            </div>
          </div>
        </section>

        <section className="aur-section">
          <div className="aur-section-header">
            <span className="aur-section-num">03</span>
            <h3 className="aur-section-title">Operario y maquinaria</h3>
          </div>
          <div className="aur-list">
            <div className="aur-row">
              <label className="aur-row-label">Operario</label>
              <HarvestCombobox
                value={form.operarioId}
                onChange={handleOperarioChange}
                items={usuarios}
                labelKey="nombre"
                placeholder="Buscar operario…"
              />
            </div>
            <div className="aur-row">
              <label className="aur-row-label">Activo</label>
              <HarvestCombobox
                value={form.activoId}
                onChange={handleActivoChange}
                items={activos}
                labelFn={activoLabel}
                placeholder="Buscar activo…"
              />
            </div>
            <div className="aur-row">
              <label className="aur-row-label">Implemento</label>
              <HarvestCombobox
                value={form.implementoId}
                onChange={handleImplementoChange}
                items={implementos}
                labelFn={activoLabel}
                placeholder="Buscar implemento…"
              />
            </div>
          </div>
        </section>

        <section className="aur-section">
          <div className="aur-section-header">
            <span className="aur-section-num">04</span>
            <h3 className="aur-section-title">Observaciones</h3>
          </div>
          <div className="aur-list">
            <div className="aur-row aur-row--multiline">
              <label className="aur-row-label" htmlFor="cr-nota">Nota</label>
              <textarea
                id="cr-nota"
                name="nota"
                className="aur-textarea"
                value={form.nota}
                onChange={handleChange}
                placeholder="Observaciones adicionales…"
                rows={3}
                maxLength={NOTA_MAX - 1}
              />
            </div>
          </div>
        </section>

        <div className="harvest-form-actions">
          <button type="button" className="aur-btn-text" onClick={resetForm}>
            Cancelar
          </button>
          <button type="submit" className="aur-btn-pill" disabled={saving}>
            <FiCheck size={15} /> {saving ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </form>
    </div>
  );
}
