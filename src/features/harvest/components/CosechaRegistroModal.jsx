import { useState, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { FiPlusCircle, FiAlertTriangle } from 'react-icons/fi';
import Toast from '../../../components/Toast';
import AuroraCombobox from '../../../components/AuroraCombobox';
import { useBlurValidation } from '../../../hooks/useBlurValidation';
import { useEscapeClose } from '../../../hooks/useEscapeClose';
import { translateApiError } from '../../../lib/errorMessages';
import { todayISO, isValidISODate } from '../lib/dates';

const CANTIDAD_MAX = 16384;
const NOTA_MAX     = 288;

function validate(form) {
  const errors = {};
  if (!form.fecha) {
    errors.fecha = 'La fecha es requerida.';
  } else if (!isValidISODate(form.fecha)) {
    errors.fecha = 'Fecha inválida.';
  } else if (form.fecha > todayISO()) {
    errors.fecha = 'No puede ser posterior al día actual.';
  }
  if (!form.loteId || !form.loteId.trim()) errors.loteId = 'El lote es requerido.';
  const cant = Number(form.cantidad);
  if (!form.cantidad || !Number.isFinite(cant) || cant <= 0 || cant >= CANTIDAD_MAX) {
    errors.cantidad = `Debe ser mayor a 0 y menor a ${CANTIDAD_MAX}.`;
  }
  if ((form.nota || '').length >= NOTA_MAX) errors.nota = `Máx ${NOTA_MAX - 1} caracteres.`;
  return errors;
}

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

export default function CosechaRegistroModal({ apiFetch, prereqs, onSuccess, onClose }) {
  // Si el padre ya prefetcheó los catálogos, los usamos directo (modal instantáneo).
  // Si no (apertura antes de que terminen), caemos al fetch interno y mostramos skeleton.
  const [lotes, setLotes]           = useState(() => prereqs?.lotes      || []);
  const [grupos, setGrupos]         = useState(() => prereqs?.grupos     || []);
  const [siembras, setSiembras]     = useState(() => prereqs?.siembras   || []);
  const [unidades, setUnidades]     = useState(() => prereqs?.unidades   || []);
  const [usuarios, setUsuarios]     = useState(() => prereqs?.usuarios   || []);
  const [maquinaria, setMaquinaria] = useState(() => prereqs?.maquinaria || []);
  const [loading, setLoading]       = useState(() => !prereqs);

  const [form, setForm]   = useState(makeEmptyForm);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [toast, setToast]   = useState(null);
  const showToast = (msg, type = 'success') => setToast({ message: msg, type });
  const { fieldErrors, blurField, clearField, validateAll, inputClass } = useBlurValidation(validate);

  // ESC cierra el modal (salvo durante un guardado en vuelo). #3 audit.
  useEscapeClose(saving ? null : onClose);

  useEffect(() => {
    if (prereqs) return; // datos ya disponibles vía props
    let alive = true;
    setLoading(true);
    setLoadError(false);
    Promise.all([
      apiFetch('/api/lotes').then(r => r.json()),
      apiFetch('/api/grupos').then(r => r.json()),
      apiFetch('/api/siembras').then(r => r.json()),
      apiFetch('/api/unidades-medida').then(r => r.json()),
      apiFetch('/api/users/lite').then(r => r.json()),
      apiFetch('/api/maquinaria').then(r => r.json()),
    ]).then(([lotesData, gruposData, siembrasData, unidadesData, usersData, maqData]) => {
      if (!alive) return;
      setLotes(Array.isArray(lotesData) ? lotesData : []);
      setGrupos(Array.isArray(gruposData) ? gruposData : []);
      setSiembras(Array.isArray(siembrasData) ? siembrasData : []);
      setUnidades(Array.isArray(unidadesData) ? unidadesData : []);
      setUsuarios(Array.isArray(usersData) ? usersData.filter(u => u.empleadoPlanilla) : []);
      setMaquinaria(Array.isArray(maqData) ? maqData : []);
    }).catch(() => {
      // Sin esto el catch era silencioso: el usuario abría el modal con los
      // selects de Lote vacíos y sin saber por qué no podía guardar. #15 audit.
      if (alive) setLoadError(true);
    }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [prereqs, reloadKey]); // eslint-disable-line react-hooks/exhaustive-deps

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
    clearField(name);
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

  const handleSubmit = async (e) => {
    e?.preventDefault?.();
    if (saving) return;
    if (!validateAll(form)) return;
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
        unidadId: form.unidadId,
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
        throw new Error(translateApiError(body, 'Error al guardar.'));
      }
      const created = await res.json().catch(() => ({}));
      onSuccess?.(created);
      onClose?.();
    } catch (err) {
      showToast(err.message || 'Error al guardar.', 'error');
      setSaving(false);
    }
  };

  return createPortal(
    <div className="aur-modal-backdrop" onPointerDown={() => { if (!saving) onClose?.(); }}>
      <div className="aur-modal aur-modal--xl" onPointerDown={(e) => e.stopPropagation()}>
        {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

        <div className="aur-modal-header">
          <span className="aur-modal-icon">
            <FiPlusCircle size={16} />
          </span>
          <span className="aur-modal-title">Nuevo registro de cosecha</span>
        </div>

        {loading ? (
          <div className="aur-modal-content">
            <div className="aur-page-loading" />
          </div>
        ) : loadError ? (
          <div className="aur-modal-content">
            <div className="aur-banner aur-banner--danger">
              <FiAlertTriangle size={15} />
              <span>
                No se pudieron cargar los catálogos (lotes, grupos, unidades…).{' '}
                <button type="button" className="aur-btn-text" onClick={() => setReloadKey(k => k + 1)}>Reintentar</button>
              </span>
            </div>
          </div>
        ) : (
          <form className="aur-modal-content" onSubmit={handleSubmit} noValidate>
            <section className="aur-section">
              <div className="aur-section-header">
                <h3 className="aur-section-title">Fecha y ubicación</h3>
              </div>
              <div className="aur-list">
                <div className="aur-row aur-row--multiline">
                  <label className="aur-row-label" htmlFor="cr-fecha">Fecha</label>
                  <input
                    id="cr-fecha"
                    type="date"
                    name="fecha"
                    className={inputClass('fecha')}
                    value={form.fecha}
                    onChange={handleChange}
                    onBlur={() => blurField('fecha', form)}
                    max={todayISO()}
                    required
                  />
                  {fieldErrors.fecha && <span className="aur-field-error">{fieldErrors.fecha}</span>}
                </div>
                <div className="aur-row aur-row--multiline">
                  <label className="aur-row-label" htmlFor="cr-lote">Lote</label>
                  <select
                    id="cr-lote"
                    name="loteId"
                    className={inputClass('loteId', 'aur-select')}
                    value={form.loteId}
                    onChange={handleChange}
                    onBlur={() => blurField('loteId', form)}
                    required
                  >
                    <option value="">— Seleccionar —</option>
                    {lotes.map(l => <option key={l.id} value={l.id}>{l.nombreLote}</option>)}
                  </select>
                  {fieldErrors.loteId && <span className="aur-field-error">{fieldErrors.loteId}</span>}
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
                <h3 className="aur-section-title">Cantidad cosechada</h3>
              </div>
              <div className="aur-list">
                <div className="aur-row aur-row--multiline">
                  <label className="aur-row-label" htmlFor="cr-cantidad">Cantidad</label>
                  <input
                    id="cr-cantidad"
                    type="number"
                    name="cantidad"
                    className={inputClass('cantidad', 'aur-input aur-input--num')}
                    min="0.0001"
                    max={CANTIDAD_MAX - 0.0001}
                    step="any"
                    value={form.cantidad}
                    onChange={handleChange}
                    onBlur={() => blurField('cantidad', form)}
                    placeholder="0"
                    required
                  />
                  {fieldErrors.cantidad && <span className="aur-field-error">{fieldErrors.cantidad}</span>}
                </div>
                <div className="aur-row">
                  <label className="aur-row-label">Unidad</label>
                  <AuroraCombobox
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
                <h3 className="aur-section-title">Operario y maquinaria</h3>
              </div>
              <div className="aur-list">
                <div className="aur-row">
                  <label className="aur-row-label">Operario</label>
                  <AuroraCombobox
                    value={form.operarioId}
                    onChange={handleOperarioChange}
                    items={usuarios}
                    labelKey="nombre"
                    placeholder="Buscar operario…"
                  />
                </div>
                <div className="aur-row">
                  <label className="aur-row-label">Activo</label>
                  <AuroraCombobox
                    value={form.activoId}
                    onChange={handleActivoChange}
                    items={activos}
                    labelFn={activoLabel}
                    placeholder="Buscar activo…"
                  />
                </div>
                <div className="aur-row">
                  <label className="aur-row-label">Implemento</label>
                  <AuroraCombobox
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
                <h3 className="aur-section-title">Observaciones</h3>
              </div>
              <div className="aur-list">
                <div className="aur-row aur-row--multiline">
                  <label className="aur-row-label" htmlFor="cr-nota">Nota</label>
                  <textarea
                    id="cr-nota"
                    name="nota"
                    className={inputClass('nota', 'aur-textarea')}
                    value={form.nota}
                    onChange={handleChange}
                    onBlur={() => blurField('nota', form)}
                    placeholder="Observaciones adicionales…"
                    rows={3}
                    maxLength={NOTA_MAX - 1}
                  />
                  {fieldErrors.nota && <span className="aur-field-error">{fieldErrors.nota}</span>}
                </div>
              </div>
            </section>
          </form>
        )}

        <div className="aur-modal-actions">
          <button
            type="button"
            className="aur-btn-text"
            onClick={onClose}
            disabled={saving}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="aur-btn-pill"
            onClick={handleSubmit}
            disabled={saving || loading}
          >
            <FiPlusCircle size={14} />
            {saving ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
