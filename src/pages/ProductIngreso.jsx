import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router-dom';
import * as XLSX from 'xlsx';
import './ProductManagement.css';
import { FiPlus, FiUpload, FiDownload, FiCheck } from 'react-icons/fi';
import Toast from '../components/Toast';
import { useApiFetch } from '../hooks/useApiFetch';

const EXCEL_HEADERS = [
  'ID Producto', 'Nombre Comercial', 'Unidad', 'Cantidad', 'Total', 'IVA (%)',
];

let _uid = 0;
const newRow = () => ({
  _key: ++_uid,
  idProducto: '',
  nombreComercial: '',
  unidad: 'L',
  cantidad: '',
  total: '',
  iva: 0,
});

function calcPrecioUnit(f) {
  const cant = parseFloat(f.cantidad) || 0;
  const tot  = parseFloat(f.total)    || 0;
  return cant > 0 ? tot / cant : 0;
}

function calcIvaAmount(f) {
  const tot = parseFloat(f.total) || 0;
  return tot * (f.iva / 100);
}

// ── Autocompletado con Portal (escapa del overflow del contenedor) ─────────
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

// ── Selector con opción "Nuevo" ────────────────────────────────────────────
function EditableSelect({ value, options, onChange, onAddOption, renderLabel }) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef(null);

  const handleSelectChange = (e) => {
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
    if (trimmed) {
      onAddOption(trimmed);
      onChange(trimmed);
    }
    setAdding(false);
    setDraft('');
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); confirm(); }
    if (e.key === 'Escape') { setAdding(false); setDraft(''); }
  };

  if (adding) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={confirm}
        onKeyDown={handleKeyDown}
        placeholder="Nuevo valor…"
        className="ingreso-new-option-input"
      />
    );
  }

  return (
    <select value={value} onChange={handleSelectChange}>
      {options.map(o => (
        <option key={o} value={o}>{renderLabel ? renderLabel(o) : o}</option>
      ))}
      <option disabled>──────────</option>
      <option value="__nuevo__">— Nuevo... —</option>
    </select>
  );
}

// ── Componente principal ───────────────────────────────────────────────────
function ProductIngreso() {
  const apiFetch = useApiFetch();
  const location = useLocation();
  const [filas, setFilas] = useState([newRow()]);
  const [proveedor, setProveedor] = useState('');
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [toast, setToast] = useState(null);
  const [movimientos, setMovimientos] = useState([]);
  const [catalogo, setCatalogo] = useState([]);
  const fileInputRef = useRef(null);

  // Listas de opciones compartidas (persisten durante la sesión)
  const [unidades, setUnidades] = useState(['L', 'mL', 'kg', 'g']);
  const [ivaOpciones, setIvaOpciones] = useState([0, 4, 8, 13, 15]);

  const addUnidad = (val) => {
    if (!unidades.includes(val)) setUnidades(prev => [...prev, val]);
  };

  const addIva = (val) => {
    const num = parseFloat(val);
    if (!isNaN(num) && !ivaOpciones.includes(num))
      setIvaOpciones(prev => [...prev, num].sort((a, b) => a - b));
  };

  const showToast = (msg, type = 'success') => setToast({ message: msg, type });

  const fetchMovimientos = () => {
    apiFetch('/api/movimientos').then(r => r.json()).then(setMovimientos).catch(console.error);
  };

  const handleAutocompleteSelect = (rowKey, producto) => {
    setFilas(prev => prev.map(f => f._key === rowKey ? {
      ...f,
      idProducto:      producto.idProducto                          || f.idProducto,
      nombreComercial: producto.nombreComercial                     || f.nombreComercial,
      unidad:          producto.unidad                              || f.unidad,
      iva:             producto.iva != null ? producto.iva          : f.iva,
    } : f));
  };

  useEffect(() => {
    apiFetch('/api/productos').then(r => r.json()).then(setCatalogo).catch(console.error);
    fetchMovimientos();
    if (location.state?.editProducto) {
      const p = location.state.editProducto;
      const cant  = parseFloat(p.stockActual)    || 0;
      const precio = parseFloat(p.precioUnitario) || 0;
      setFilas([{
        ...newRow(),
        idProducto:      p.idProducto      || '',
        nombreComercial: p.nombreComercial  || '',
        unidad:          p.unidad           || 'L',
        cantidad:        cant  > 0 ? String(cant)            : '',
        total:           cant > 0 && precio > 0 ? String(cant * precio) : '',
        iva:             0,
      }]);
      setProveedor(p.proveedor || '');
      window.scrollTo(0, 0);
    }
  }, []);

  const update = (key, field, value) =>
    setFilas(prev => prev.map(f => f._key === key ? { ...f, [field]: value } : f));

  const addFila = () => setFilas(prev => [...prev, newRow()]);

  const removeFila = (key) =>
    setFilas(prev => prev.length > 1 ? prev.filter(f => f._key !== key) : prev);

  const subtotal     = filas.reduce((sum, f) => sum + (parseFloat(f.total) || 0), 0);
  const ivaTotal     = filas.reduce((sum, f) => sum + calcIvaAmount(f), 0);
  const totalGeneral = subtotal + ivaTotal;

  const handleGuardarTodo = async () => {
    const validas = filas.filter(f => f.idProducto.trim() && f.nombreComercial.trim());
    if (validas.length === 0) {
      showToast('Completa al menos ID y Nombre Comercial en una fila.', 'error');
      return;
    }
    setSaving(true);
    let creados = 0, mergeados = 0, errores = 0;
    for (const fila of validas) {
      const { _key, cantidad, total, ...rest } = fila;
      const payload = {
        ...rest,           // incluye iva → se persiste en el producto
        proveedor,
        stockActual:    parseFloat(cantidad) || 0,
        precioUnitario: calcPrecioUnit(fila),
        tipo:             '',
        stockMinimo:      0,
        moneda:           'USD',
        tipoCambio:       1,
        plagaQueControla: '',
        periodoReingreso: 0,
        periodoACosecha:  0,
      };
      try {
        const res = await apiFetch('/api/productos', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (res.ok) {
          const d = await res.json();
          d.merged ? mergeados++ : creados++;
        } else { errores++; }
      } catch { errores++; }
    }
    setSaving(false);
    fetchMovimientos();
    setFilas([newRow()]);
    setProveedor('');
    const msg = [
      creados   > 0 && `${creados} creado(s)`,
      mergeados > 0 && `${mergeados} stock actualizado`,
      errores   > 0 && `${errores} error(es)`,
    ].filter(Boolean).join(' · ');
    showToast(msg, errores > 0 ? 'warning' : 'success');
  };

  const handleDownloadTemplate = () => {
    const sample = ['PD-001', 'Round-up', 'L', 50, 775.00, 0];
    const ws = XLSX.utils.aoa_to_sheet([EXCEL_HEADERS, sample]);
    ws['!cols'] = EXCEL_HEADERS.map(() => ({ wch: 22 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Productos');
    XLSX.writeFile(wb, 'plantilla_productos.xlsx');
  };

  const handleExcelImport = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setImporting(true);
    setImportResult(null);
    try {
      const workbook = XLSX.read(await file.arrayBuffer());
      const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: '' });
      const cargadas = rows
        .map(row => ({
          ...newRow(),
          idProducto:      String(row['ID Producto']      || '').trim(),
          nombreComercial: String(row['Nombre Comercial'] || '').trim(),
          unidad:          String(row['Unidad']           || 'L').trim(),
          cantidad:        String(row['Cantidad']         || ''),
          total:           String(row['Total']            || ''),
          iva:             parseFloat(row['IVA (%)'])     || 0,
        }))
        .filter(f => f.idProducto || f.nombreComercial);
      if (cargadas.length > 0) {
        // Registrar unidades/ivas nuevos provenientes del Excel
        cargadas.forEach(f => {
          addUnidad(f.unidad);
          addIva(f.iva);
        });
        setFilas(cargadas);
        setImportResult({ loaded: cargadas.length });
      } else {
        setImportResult({ error: true });
      }
    } catch {
      setImportResult({ error: true });
    } finally {
      setImporting(false);
      e.target.value = '';
    }
  };

  return (
    <div className="lote-management-layout">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      <div className="form-card ingreso-grid-card">

        {/* Importación masiva */}
        <div className="import-section">
          <span className="import-label">Importación masiva</span>
          <div className="import-buttons">
            <button type="button" className="btn btn-secondary" onClick={handleDownloadTemplate}>
              <FiDownload size={15} /> Descargar plantilla
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => fileInputRef.current?.click()} disabled={importing}>
              <FiUpload size={15} /> {importing ? 'Cargando…' : 'Cargar desde Excel'}
            </button>
            <input ref={fileInputRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={handleExcelImport} />
          </div>
          {importResult && (
            <p className={`import-result ${importResult.error ? 'import-error' : 'import-ok'}`}>
              {importResult.error
                ? '⚠ No se pudo leer el archivo. Usa la plantilla descargada.'
                : `✓ ${importResult.loaded} fila(s) cargadas en la grilla — revisa y guarda.`}
            </p>
          )}
        </div>

        <div className="form-section-divider" />

        {/* Cabecera */}
        <div className="ingreso-grid-header">
          <h2>Nuevo Ingreso de Productos</h2>
          <div className="ingreso-header-right">
            <div className="ingreso-proveedor-wrap">
              <label htmlFor="proveedorGlobal">Proveedor</label>
              <input
                id="proveedorGlobal"
                className="ingreso-proveedor-input"
                value={proveedor}
                onChange={e => setProveedor(e.target.value)}
                placeholder="Nombre del proveedor"
              />
            </div>
            <button type="button" className="btn btn-primary" onClick={handleGuardarTodo} disabled={saving}>
              <FiCheck size={15} /> {saving ? 'Guardando…' : 'Guardar todo'}
            </button>
          </div>
        </div>

        {/* Grilla */}
        <div className="ingreso-grid-wrapper">
          <table className="ingreso-table">
            <thead>
              <tr>
                <th className="col-id">ID Producto</th>
                <th className="col-name">Nombre Comercial</th>
                <th className="col-narrow">UM</th>
                <th className="col-number">Cantidad</th>
                <th className="col-number">Precio Unit.</th>
                <th className="col-iva">IVA</th>
                <th className="col-total">Total</th>
                <th className="col-del"></th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => {
                const precioUnit = calcPrecioUnit(f);
                return (
                  <tr key={f._key}>
                    <td>
                      <AutocompleteInput
                        value={f.idProducto}
                        onChange={val => update(f._key, 'idProducto', val)}
                        onSelect={p => handleAutocompleteSelect(f._key, p)}
                        suggestions={catalogo}
                        placeholder="PD-001"
                      />
                    </td>
                    <td>
                      <AutocompleteInput
                        value={f.nombreComercial}
                        onChange={val => update(f._key, 'nombreComercial', val)}
                        onSelect={p => handleAutocompleteSelect(f._key, p)}
                        suggestions={catalogo}
                        placeholder="Nombre"
                      />
                    </td>
                    <td className="col-narrow">
                      <EditableSelect
                        value={f.unidad}
                        options={unidades}
                        onChange={val => update(f._key, 'unidad', val)}
                        onAddOption={addUnidad}
                      />
                    </td>
                    <td className="col-number">
                      <input
                        type="number" step="0.01" min="0"
                        value={f.cantidad}
                        onChange={e => update(f._key, 'cantidad', e.target.value)}
                        placeholder="0"
                      />
                    </td>
                    <td className="col-number col-calculated">
                      {precioUnit > 0
                        ? precioUnit.toLocaleString('es-CR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })
                        : <span className="col-empty">—</span>}
                    </td>
                    <td className="col-narrow">
                      <EditableSelect
                        value={f.iva}
                        options={ivaOpciones}
                        onChange={val => {
                          const num = parseFloat(val);
                          update(f._key, 'iva', isNaN(num) ? 0 : num);
                        }}
                        onAddOption={addIva}
                        renderLabel={v => `${v}%`}
                      />
                    </td>
                    <td className="col-total">
                      <input
                        type="number" step="0.01" min="0"
                        value={f.total}
                        onChange={e => update(f._key, 'total', e.target.value)}
                        placeholder="0.00"
                        className="col-total-input"
                      />
                    </td>
                    <td className="col-del">
                      <button
                        type="button"
                        className="ingreso-row-del"
                        onClick={() => removeFila(f._key)}
                        title="Eliminar fila"
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="ingreso-grid-footer">
          <button type="button" className="btn btn-secondary" onClick={addFila}>
            <FiPlus size={14} /> Agregar fila
          </button>
          {totalGeneral > 0 && (
            <div className="ingreso-totales">
              {ivaTotal > 0 && (
                <div className="ingreso-total-item">
                  <span className="ingreso-total-label">Total IVA</span>
                  <span className="ingreso-total-value ingreso-total-iva">
                    {ivaTotal.toLocaleString('es-CR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
              )}
              <div className="ingreso-total-item">
                <span className="ingreso-total-label">Total General</span>
                <span className="ingreso-total-value">
                  {totalGeneral.toLocaleString('es-CR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
            </div>
          )}
        </div>

      </div>

      {/* Historial de movimientos */}
      <div className="list-card historial-card">
        <h2>Historial de Movimientos</h2>
        {movimientos.length === 0 ? (
          <p className="empty-state">No hay movimientos registrados aún.</p>
        ) : (
          <ul className="info-list movimientos-list">
            {movimientos.map(m => (
              <li key={m.id} className="movimiento-row">
                <span className="mov-fecha">
                  {new Date(m.fecha).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })}
                </span>
                <span className={`mov-tipo-badge ${m.tipo === 'ingreso' ? 'mov-ingreso' : 'mov-egreso'}`}>
                  {m.tipo}
                </span>
                <div className="mov-info">
                  <span className="mov-nombre">{m.nombreComercial}</span>
                  <span className="mov-motivo">{m.motivo}{m.loteNombre ? ` · ${m.loteNombre}` : ''}</span>
                </div>
                <span className={`mov-cantidad ${m.tipo === 'egreso' ? 'mov-neg' : 'mov-pos'}`}>
                  {m.tipo === 'egreso' ? '-' : '+'}{m.cantidad} {m.unidad}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

    </div>
  );
}

export default ProductIngreso;
