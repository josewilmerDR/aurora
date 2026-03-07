import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
  FiFileText, FiExternalLink, FiPackage, FiShoppingCart,
  FiPlus, FiCheck, FiChevronDown, FiChevronUp,
} from 'react-icons/fi';
import Toast from '../components/Toast';
import './OrdenesList.css';

// ─── Helpers ──────────────────────────────────────────────────────────────────
const ESTADO_LABELS = { activa: 'Activa', completada: 'Completada', cancelada: 'Cancelada' };

const generatePoNumber = () => {
  const now = new Date();
  const seq = String(now.getMonth() + 1).padStart(2, '0') + String(now.getDate()).padStart(2, '0');
  return `OC-${now.getFullYear()}-${seq}-${String(Math.floor(Math.random() * 900) + 100)}`;
};

const formatDate = (iso) => {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
};

const isOverdue = (task) => {
  if (task.status === 'completed_by_user') return false;
  const due = new Date(task.dueDate);
  const today = new Date();
  return new Date(due.getFullYear(), due.getMonth(), due.getDate())
    < new Date(today.getFullYear(), today.getMonth(), today.getDate());
};

// ─── Row factory ──────────────────────────────────────────────────────────────
let _uid = 0;
const newRow = () => ({
  _key: ++_uid,
  productoId: '',
  nombreComercial: '',
  ingredienteActivo: '',
  cantidad: '',
  unidad: 'L',
  precioUnitario: '',
  moneda: 'USD',
});

// ─── AutocompleteInput ────────────────────────────────────────────────────────
function AutocompleteInput({ value, onChange, onSelect, suggestions, placeholder }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });
  const inputRef = useRef(null);

  const filtered = !value.trim()
    ? []
    : suggestions.filter(p =>
        p.idProducto?.toLowerCase().includes(value.toLowerCase()) ||
        p.nombreComercial?.toLowerCase().includes(value.toLowerCase())
      ).slice(0, 7);

  const calcPos = () => {
    if (!inputRef.current) return;
    const r = inputRef.current.getBoundingClientRect();
    setPos({ top: r.bottom + window.scrollY + 3, left: r.left + window.scrollX, width: Math.max(r.width, 280) });
  };

  return (
    <div className="ac-wrap">
      <input
        ref={inputRef}
        value={value}
        onChange={e => { onChange(e.target.value); calcPos(); setOpen(true); }}
        onFocus={() => { calcPos(); setOpen(true); }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder}
      />
      {open && filtered.length > 0 && createPortal(
        <ul className="ac-dropdown" style={{ top: pos.top, left: pos.left, width: pos.width }}>
          {filtered.map(p => (
            <li key={p.id} onMouseDown={() => { onSelect(p); setOpen(false); }}>
              <span className="ac-id">{p.idProducto}</span>
              <span className="ac-name">{p.nombreComercial}</span>
              <span className="ac-unit">{p.unidad}</span>
            </li>
          ))}
        </ul>,
        document.body
      )}
    </div>
  );
}

// ─── EditableSelect ───────────────────────────────────────────────────────────
function EditableSelect({ value, options, onChange, onAddOption, renderLabel }) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef(null);

  const handleChange = (e) => {
    if (e.target.value === '__nuevo__') {
      setAdding(true);
      setDraft('');
      setTimeout(() => inputRef.current?.focus(), 0);
    } else {
      onChange(e.target.value);
    }
  };

  const confirm = () => {
    const trimmed = draft.trim();
    if (trimmed) { onAddOption(trimmed); onChange(trimmed); }
    setAdding(false);
    setDraft('');
  };

  if (adding) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={confirm}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); confirm(); } if (e.key === 'Escape') { setAdding(false); setDraft(''); } }}
        placeholder="Nuevo valor…"
        className="ingreso-new-option-input"
      />
    );
  }

  return (
    <select value={value} onChange={handleChange}>
      {options.map(o => <option key={o} value={o}>{renderLabel ? renderLabel(o) : o}</option>)}
      <option disabled>──────────</option>
      <option value="__nuevo__">— Nuevo... —</option>
    </select>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
const OrdenesList = () => {
  const navigate = useNavigate();

  const [solicitudes, setSolicitudes] = useState([]);
  const [ordenes, setOrdenes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const showToast = (msg, type = 'success') => setToast({ message: msg, type });

  // Form — open by default
  const [showForm, setShowForm] = useState(true);
  const [loadedSolicitudId, setLoadedSolicitudId] = useState(null);
  const [catalogo, setCatalogo] = useState([]);
  const [filas, setFilas] = useState([newRow()]);
  const [proveedor, setProveedor] = useState('');
  const [contacto, setContacto] = useState('');
  const [fechaOC, setFechaOC] = useState(new Date().toISOString().split('T')[0]);
  const [fechaEntrega, setFechaEntrega] = useState('');
  const [elaboradoPor, setElaboradoPor] = useState('');
  const [notas, setNotas] = useState('');
  const [saving, setSaving] = useState(false);
  const [unidades, setUnidades] = useState(['L', 'mL', 'kg', 'g', 'und']);
  const [monedas] = useState(['USD', 'CRC', 'EUR']);

  const addUnidad = (val) => { if (!unidades.includes(val)) setUnidades(prev => [...prev, val]); };

  const refreshOrdenes = () =>
    fetch('/api/ordenes-compra').then(r => r.json()).then(setOrdenes).catch(() => {});

  useEffect(() => {
    Promise.all([
      fetch('/api/tasks').then(r => r.json()),
      fetch('/api/ordenes-compra').then(r => r.json()),
      fetch('/api/productos').then(r => r.json()),
    ])
      .then(([tasks, ocs, prods]) => {
        setSolicitudes(tasks.filter(t => t.type === 'SOLICITUD_COMPRA'));
        setOrdenes(ocs);
        setCatalogo(prods);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const loadSolicitudIntoForm = (task) => {
    const productos = task.activity?.productos || [];
    setFilas(
      productos.length > 0
        ? productos.map(p => {
            const cat = catalogo.find(c => c.id === p.productoId);
            return {
              _key: ++_uid,
              productoId:        p.productoId        || '',
              nombreComercial:   p.nombreComercial   || '',
              ingredienteActivo: cat?.ingredienteActivo || '',
              cantidad:          p.cantidad != null ? String(p.cantidad) : '',
              unidad:            p.unidad || cat?.unidad || 'L',
              precioUnitario:    cat?.precioUnitario != null ? String(cat.precioUnitario) : '',
              moneda:            cat?.moneda || 'USD',
            };
          })
        : [newRow()]
    );
    if (task.notas) setNotas(task.notas);
    setLoadedSolicitudId(task.id);
    setShowForm(true);
  };

  const update = (key, field, val) =>
    setFilas(prev => prev.map(f => f._key === key ? { ...f, [field]: val } : f));

  const addFila = () => setFilas(prev => [...prev, newRow()]);
  const removeFila = (key) => setFilas(prev => prev.length > 1 ? prev.filter(f => f._key !== key) : prev);

  const handleAutocompleteSelect = (key, producto) => {
    setFilas(prev => prev.map(f => f._key === key ? {
      ...f,
      productoId:        producto.id                || f.productoId,
      nombreComercial:   producto.nombreComercial   || f.nombreComercial,
      ingredienteActivo: producto.ingredienteActivo || f.ingredienteActivo,
      unidad:            producto.unidad            || f.unidad,
    } : f));
  };

  const totalGeneral = filas.reduce((sum, f) => {
    return sum + (parseFloat(f.cantidad) || 0) * (parseFloat(f.precioUnitario) || 0);
  }, 0);

  const handleGuardarOC = async () => {
    const validItems = filas.filter(f => f.nombreComercial.trim());
    if (validItems.length === 0) {
      showToast('Agrega al menos un producto con nombre.', 'error');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/ordenes-compra', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          poNumber: generatePoNumber(),
          fecha: fechaOC,
          fechaEntrega: fechaEntrega || null,
          proveedor,
          direccionProveedor: contacto,
          elaboradoPor,
          notas,
          taskId: null,
          solicitudId: null,
          items: validItems.map(f => ({
            productoId:        f.productoId        || null,
            nombreComercial:   f.nombreComercial,
            ingredienteActivo: f.ingredienteActivo,
            cantidad:          parseFloat(f.cantidad)       || 0,
            unidad:            f.unidad,
            precioUnitario:    parseFloat(f.precioUnitario) || 0,
            moneda:            f.moneda,
          })),
        }),
      });
      if (!res.ok) throw new Error();
      showToast('Orden de compra guardada');
      await refreshOrdenes();
      setFilas([newRow()]);
      setProveedor(''); setContacto('');
      setFechaOC(new Date().toISOString().split('T')[0]);
      setFechaEntrega(''); setElaboradoPor(''); setNotas('');
    } catch {
      showToast('Error al guardar la orden.', 'error');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="ol-empty">Cargando…</div>;

  const pendingCount = solicitudes.filter(t => t.status !== 'completed_by_user').length;

  return (
    <div className="ol-wrap">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {/* ── Top: form (left) + solicitudes (right) ── */}
      <div className="ol-top-layout">

        {/* ── LEFT: Nueva OC form ── */}
        <div className="ol-nueva-oc-card">
          <button className="ol-nueva-oc-toggle" onClick={() => setShowForm(v => !v)}>
            <FiPlus size={16} />
            Nueva Orden de Compra
            {showForm ? <FiChevronUp size={15} /> : <FiChevronDown size={15} />}
          </button>

          {showForm && (
            <div className="ol-nueva-oc-body">
              <div className="ol-oc-header-fields">
                <div className="ol-oc-field">
                  <label>Proveedor</label>
                  <input value={proveedor} onChange={e => setProveedor(e.target.value)} placeholder="Nombre del proveedor" />
                </div>
                <div className="ol-oc-field">
                  <label>Dirección / Contacto</label>
                  <input value={contacto} onChange={e => setContacto(e.target.value)} placeholder="Correo, teléfono o dirección" />
                </div>
                <div className="ol-oc-field">
                  <label>Fecha de la orden</label>
                  <input type="date" value={fechaOC} onChange={e => setFechaOC(e.target.value)} />
                </div>
                <div className="ol-oc-field">
                  <label>Fecha de entrega estimada</label>
                  <input type="date" value={fechaEntrega} onChange={e => setFechaEntrega(e.target.value)} />
                </div>
                <div className="ol-oc-field">
                  <label>Elaborado por</label>
                  <input value={elaboradoPor} onChange={e => setElaboradoPor(e.target.value)} placeholder="Responsable" />
                </div>
                <div className="ol-oc-field">
                  <label>Notas / Condiciones</label>
                  <input value={notas} onChange={e => setNotas(e.target.value)} placeholder="Condiciones de pago, urgencia…" />
                </div>
              </div>

              <div className="ingreso-grid-wrapper">
                <table className="ingreso-table">
                  <colgroup>
                    <col className="oc-col-product" />
                    <col className="oc-col-ai" />
                    <col className="oc-col-narrow" />
                    <col className="oc-col-narrow" />
                    <col className="oc-col-price" />
                    <col className="oc-col-currency" />
                    <col className="oc-col-total" />
                    <col className="oc-col-del" />
                  </colgroup>
                  <thead>
                    <tr>
                      <th>Producto</th>
                      <th>Ingrediente Activo</th>
                      <th>Cantidad</th>
                      <th>UM</th>
                      <th>Precio Unit.</th>
                      <th>Moneda</th>
                      <th>Total</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filas.map((f) => {
                      const rowTotal = (parseFloat(f.cantidad) || 0) * (parseFloat(f.precioUnitario) || 0);
                      return (
                        <tr key={f._key}>
                          <td>
                            <AutocompleteInput
                              value={f.nombreComercial}
                              onChange={val => update(f._key, 'nombreComercial', val)}
                              onSelect={p => handleAutocompleteSelect(f._key, p)}
                              suggestions={catalogo}
                              placeholder="Nombre comercial"
                            />
                          </td>
                          <td>
                            <input
                              value={f.ingredienteActivo}
                              onChange={e => update(f._key, 'ingredienteActivo', e.target.value)}
                              placeholder="Ing. activo"
                            />
                          </td>
                          <td className="oc-col-narrow">
                            <input type="number" step="0.01" min="0" value={f.cantidad}
                              onChange={e => update(f._key, 'cantidad', e.target.value)} placeholder="0" />
                          </td>
                          <td className="oc-col-narrow">
                            <EditableSelect value={f.unidad} options={unidades}
                              onChange={val => update(f._key, 'unidad', val)} onAddOption={addUnidad} />
                          </td>
                          <td className="oc-col-price">
                            <input type="number" step="0.01" min="0" value={f.precioUnitario}
                              onChange={e => update(f._key, 'precioUnitario', e.target.value)} placeholder="0.00" />
                          </td>
                          <td className="oc-col-currency">
                            <select value={f.moneda} onChange={e => update(f._key, 'moneda', e.target.value)}>
                              {monedas.map(m => <option key={m} value={m}>{m}</option>)}
                            </select>
                          </td>
                          <td className="oc-col-total col-calculated">
                            {rowTotal > 0
                              ? rowTotal.toLocaleString('es-CR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                              : <span className="col-empty">—</span>}
                          </td>
                          <td className="oc-col-del">
                            <button type="button" className="ingreso-row-del"
                              onClick={() => removeFila(f._key)} title="Eliminar fila">×</button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="ol-oc-footer">
                <div className="ol-oc-footer-left">
                  <button type="button" className="btn btn-secondary" onClick={addFila}>
                    <FiPlus size={14} /> Agregar fila
                  </button>
                </div>
                <div className="ol-oc-footer-right">
                  {totalGeneral > 0 && (
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                      <span className="ol-oc-total-label">Total</span>
                      <span className="ol-oc-total-value">
                        {totalGeneral.toLocaleString('es-CR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                    </div>
                  )}
                  <button type="button" className="btn btn-primary" onClick={handleGuardarOC} disabled={saving}>
                    <FiCheck size={15} /> {saving ? 'Guardando…' : 'Guardar OC'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── RIGHT: Solicitudes de Compra ── */}
        <aside className="ol-solicitudes-panel">
          <div className="ol-section-header">
            <FiShoppingCart size={15} />
            <span>Solicitudes</span>
            {pendingCount > 0 && (
              <span className="ol-section-count">{pendingCount}</span>
            )}
          </div>

          {solicitudes.length === 0 ? (
            <div className="ol-solicitudes-empty">
              <p>Sin solicitudes.</p>
              <p className="ol-empty-hint">Crea desde <strong>Bodega → Solicitar Compra</strong>.</p>
            </div>
          ) : (
            <div className="ol-solicitudes-list">
              {solicitudes.map((task) => {
                const overdue = isOverdue(task);
                const done = task.status === 'completed_by_user';
                const isLoaded = loadedSolicitudId === task.id;
                return (
                  <div
                    key={task.id}
                    className={[
                      'ol-solicitud-card',
                      done ? 'ol-solicitud-card--done' : overdue ? 'ol-solicitud-card--overdue' : '',
                      isLoaded ? 'ol-solicitud-card--loaded' : '',
                    ].join(' ')}
                    onClick={() => loadSolicitudIntoForm(task)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={e => e.key === 'Enter' && loadSolicitudIntoForm(task)}
                  >
                    <div className="ol-solicitud-name">{task.activityName}</div>
                    <div className="ol-solicitud-meta">
                      <span>
                        <FiPackage size={11} />
                        {Array.isArray(task.activity?.productos) ? task.activity.productos.length : '—'} prod.
                      </span>
                      <span>{formatDate(task.dueDate)}</span>
                    </div>
                    <div className="ol-solicitud-footer">
                      <span className={`ol-solicitud-status${done ? ' done' : overdue ? ' overdue' : ''}`}>
                        {done ? 'OC Generada' : overdue ? 'Vencida' : 'Pendiente'}
                      </span>
                      <button
                        className="ol-solicitud-ext"
                        onClick={e => { e.stopPropagation(); navigate(`/orden-compra/${task.id}`); }}
                        title="Abrir editor de OC"
                      >
                        <FiExternalLink size={11} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </aside>
      </div>

      {/* ── Órdenes Guardadas (full width) ── */}
      <section className="ol-section">
        <div className="ol-section-header">
          <FiFileText size={15} />
          <span>Órdenes de Compra Guardadas</span>
          {ordenes.length > 0 && (
            <span className="ol-section-count">{ordenes.length} orden{ordenes.length !== 1 ? 'es' : ''}</span>
          )}
        </div>

        {ordenes.length === 0 ? (
          <div className="ol-empty ol-empty--inline">
            <p>No hay órdenes guardadas aún.</p>
            <p className="ol-empty-hint">Crea una nueva OC arriba o guárdala desde el editor de una solicitud.</p>
          </div>
        ) : (
          <div className="ol-card">
            <table className="ol-table">
              <thead>
                <tr>
                  <th>N° OC</th>
                  <th>Proveedor</th>
                  <th className="ol-col-center">Fecha</th>
                  <th className="ol-col-center">Entrega est.</th>
                  <th className="ol-col-center">Productos</th>
                  <th className="ol-col-center">Estado</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {ordenes.map((orden) => (
                  <tr
                    key={orden.id}
                    className={orden.taskId ? 'ol-row ol-row--clickable' : 'ol-row'}
                    onClick={() => orden.taskId && navigate(`/orden-compra/${orden.taskId}`)}
                  >
                    <td className="ol-po-number">{orden.poNumber || '—'}</td>
                    <td>{orden.proveedor || <span className="ol-muted">Sin proveedor</span>}</td>
                    <td className="ol-col-center">{formatDate(orden.fecha)}</td>
                    <td className="ol-col-center">{formatDate(orden.fechaEntrega)}</td>
                    <td className="ol-col-center">
                      <span className="ol-items-count">
                        <FiPackage size={13} />
                        {Array.isArray(orden.items) ? orden.items.length : 0}
                      </span>
                    </td>
                    <td className="ol-col-center">
                      <span className={`ol-estado ol-estado--${orden.estado || 'activa'}`}>
                        {ESTADO_LABELS[orden.estado] || 'Activa'}
                      </span>
                    </td>
                    <td className="ol-col-action">
                      {orden.taskId && (
                        <button className="ol-btn-open"
                          onClick={e => { e.stopPropagation(); navigate(`/orden-compra/${orden.taskId}`); }}
                          title="Abrir editor">
                          <FiExternalLink size={15} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

    </div>
  );
};

export default OrdenesList;
