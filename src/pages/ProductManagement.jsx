import { useState, useEffect, useRef } from 'react';
import * as XLSX from 'xlsx';
import './ProductManagement.css';
import { FiEdit, FiTrash2, FiPlus, FiUpload, FiDownload } from 'react-icons/fi';

const TIPOS = ['Herbicida', 'Fungicida', 'Insecticida', 'Fertilizante', 'Regulador de crecimiento', 'Otro'];
const UNIDADES = ['L', 'mL', 'kg', 'g'];
const MONEDAS = ['USD', 'EUR', 'CRC', 'COP', 'MXN', 'BRL', 'PEN', 'GTQ', 'HNL', 'NIO'];

// Encabezados del Excel (deben coincidir exactamente en el archivo importado)
const EXCEL_HEADERS = [
  'ID Producto', 'Nombre Comercial', 'Ingrediente Activo', 'Tipo',
  'Plaga que Controla', 'Período Reingreso (h)', 'Período a Cosecha (días)',
  'Unidad', 'Stock Actual', 'Stock Mínimo',
  'Moneda', 'Tipo de Cambio', 'Precio Unitario', 'Proveedor',
];

const emptyForm = {
  id: null,
  idProducto: '',
  nombreComercial: '',
  ingredienteActivo: '',
  tipo: '',
  plagaQueControla: '',
  periodoReingreso: '',
  periodoACosecha: '',
  unidad: 'L',
  stockActual: '',
  stockMinimo: '',
  moneda: 'USD',
  tipoCambio: 1,
  precioUnitario: '',
  proveedor: '',
};

function formatCurrency(value, moneda) {
  return `${Number(value).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${moneda || ''}`;
}

function ProductManagement() {
  const [productos, setProductos] = useState([]);
  const [formData, setFormData] = useState(emptyForm);
  const [isEditing, setIsEditing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const fileInputRef = useRef(null);

  const fetchProductos = () => {
    fetch('/api/productos').then(res => res.json()).then(setProductos).catch(console.error);
  };

  useEffect(() => {
    fetchProductos();
  }, []);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const resetForm = () => {
    setFormData(emptyForm);
    setIsEditing(false);
  };

  const handleEdit = (producto) => {
    setFormData({ ...emptyForm, ...producto });
    setIsEditing(true);
    window.scrollTo(0, 0);
  };

  const handleDelete = async (id) => {
    if (window.confirm('¿Seguro que quieres eliminar este producto?')) {
      try {
        const res = await fetch(`/api/productos/${id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error();
        fetchProductos();
      } catch {
        alert('Error al eliminar el producto.');
      }
    }
  };

  const buildPayload = (data) => ({
    ...data,
    periodoReingreso: parseFloat(data.periodoReingreso) || 0,
    periodoACosecha: parseFloat(data.periodoACosecha) || 0,
    stockActual: parseFloat(data.stockActual) || 0,
    stockMinimo: parseFloat(data.stockMinimo) || 0,
    tipoCambio: parseFloat(data.tipoCambio) || 1,
    precioUnitario: parseFloat(data.precioUnitario) || 0,
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    const url = isEditing ? `/api/productos/${formData.id}` : '/api/productos';
    const method = isEditing ? 'PUT' : 'POST';
    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildPayload(formData)),
      });
      if (!res.ok) throw new Error();
      fetchProductos();
      resetForm();
    } catch {
      alert('Ocurrió un error al guardar.');
    }
  };

  // ── Excel: descargar plantilla ──────────────────────────────────────────────
  const handleDownloadTemplate = () => {
    const sampleRow = [
      'PD-001', 'Round-up', 'Glifosato', 'Herbicida', 'Malezas de hoja ancha',
      24, 30, 'L', 100, 20, 'USD', 1, 15.50, 'AgroDistribuciones S.A.',
    ];
    const ws = XLSX.utils.aoa_to_sheet([EXCEL_HEADERS, sampleRow]);
    // Ancho de columnas
    ws['!cols'] = EXCEL_HEADERS.map(() => ({ wch: 22 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Productos');
    XLSX.writeFile(wb, 'plantilla_productos.xlsx');
  };

  // ── Excel: importar archivo ─────────────────────────────────────────────────
  const handleExcelImport = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setImporting(true);
    setImportResult(null);

    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer);
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

      let success = 0;
      let errors = 0;

      for (const row of rows) {
        const producto = {
          idProducto: String(row['ID Producto'] || '').trim(),
          nombreComercial: String(row['Nombre Comercial'] || '').trim(),
          ingredienteActivo: String(row['Ingrediente Activo'] || '').trim(),
          tipo: String(row['Tipo'] || '').trim(),
          plagaQueControla: String(row['Plaga que Controla'] || '').trim(),
          periodoReingreso: parseFloat(row['Período Reingreso (h)']) || 0,
          periodoACosecha: parseFloat(row['Período a Cosecha (días)']) || 0,
          unidad: String(row['Unidad'] || 'L').trim(),
          stockActual: parseFloat(row['Stock Actual']) || 0,
          stockMinimo: parseFloat(row['Stock Mínimo']) || 0,
          moneda: String(row['Moneda'] || 'USD').trim(),
          tipoCambio: parseFloat(row['Tipo de Cambio']) || 1,
          precioUnitario: parseFloat(row['Precio Unitario']) || 0,
          proveedor: String(row['Proveedor'] || '').trim(),
        };

        if (!producto.idProducto || !producto.nombreComercial) { errors++; continue; }

        try {
          const res = await fetch('/api/productos', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(producto),
          });
          if (res.ok) success++; else errors++;
        } catch { errors++; }
      }

      setImportResult({ success, errors });
      if (success > 0) fetchProductos();
    } catch {
      setImportResult({ success: 0, errors: -1 });
    } finally {
      setImporting(false);
      e.target.value = '';
    }
  };

  return (
    <div className="lote-management-layout">
      <div className="form-card">
        {/* ── Importación Excel ── */}
        <div className="import-section">
          <span className="import-label">Importación masiva</span>
          <div className="import-buttons">
            <button type="button" className="btn btn-secondary" onClick={handleDownloadTemplate}>
              <FiDownload size={15} /> Descargar plantilla
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => fileInputRef.current?.click()}
              disabled={importing}
            >
              <FiUpload size={15} /> {importing ? 'Importando…' : 'Importar Excel'}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls"
              style={{ display: 'none' }}
              onChange={handleExcelImport}
            />
          </div>
          {importResult && (
            <p className={`import-result ${importResult.errors === -1 ? 'import-error' : importResult.success > 0 ? 'import-ok' : 'import-error'}`}>
              {importResult.errors === -1
                ? '⚠ No se pudo leer el archivo. Usa la plantilla descargada.'
                : `✓ ${importResult.success} producto(s) importado(s)${importResult.errors > 0 ? ` · ⚠ ${importResult.errors} fila(s) con error` : ''}`}
            </p>
          )}
        </div>

        <div className="form-section-divider" />

        <h2>{isEditing ? 'Editando Producto' : 'Nuevo Producto'}</h2>
        <form onSubmit={handleSubmit} className="lote-form">

          {/* ── Ficha técnica ── */}
          <p className="form-section-title">Ficha Técnica</p>
          <div className="form-grid product-form-grid">
            <div className="form-control">
              <label htmlFor="idProducto">ID de Producto</label>
              <input id="idProducto" name="idProducto" value={formData.idProducto} onChange={handleInputChange} placeholder="Ej: PD-001" required />
            </div>
            <div className="form-control">
              <label htmlFor="nombreComercial">Nombre Comercial</label>
              <input id="nombreComercial" name="nombreComercial" value={formData.nombreComercial} onChange={handleInputChange} required />
            </div>
            <div className="form-control">
              <label htmlFor="ingredienteActivo">Ingrediente Activo</label>
              <input id="ingredienteActivo" name="ingredienteActivo" value={formData.ingredienteActivo} onChange={handleInputChange} required />
            </div>
            <div className="form-control">
              <label htmlFor="tipo">Tipo</label>
              <select id="tipo" name="tipo" value={formData.tipo} onChange={handleInputChange} required>
                <option value="">-- Seleccionar --</option>
                {TIPOS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="form-control form-control-wide">
              <label htmlFor="plagaQueControla">Plaga que Controla</label>
              <input id="plagaQueControla" name="plagaQueControla" value={formData.plagaQueControla} onChange={handleInputChange} />
            </div>
            <div className="form-control">
              <label htmlFor="periodoReingreso">Período Reingreso (horas)</label>
              <input id="periodoReingreso" name="periodoReingreso" type="number" min="0" value={formData.periodoReingreso} onChange={handleInputChange} required />
            </div>
            <div className="form-control">
              <label htmlFor="periodoACosecha">Período a Cosecha (días)</label>
              <input id="periodoACosecha" name="periodoACosecha" type="number" min="0" value={formData.periodoACosecha} onChange={handleInputChange} required />
            </div>
            <div className="form-control">
              <label htmlFor="unidad">Unidad</label>
              <select id="unidad" name="unidad" value={formData.unidad} onChange={handleInputChange} required>
                {UNIDADES.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
            <div className="form-control">
              <label htmlFor="stockActual">Stock Actual</label>
              <input id="stockActual" name="stockActual" type="number" step="0.01" min="0" value={formData.stockActual} onChange={handleInputChange} required />
            </div>
            <div className="form-control">
              <label htmlFor="stockMinimo">Stock Mínimo</label>
              <input id="stockMinimo" name="stockMinimo" type="number" step="0.01" min="0" value={formData.stockMinimo} onChange={handleInputChange} required />
            </div>
          </div>

          {/* ── Información Comercial ── */}
          <p className="form-section-title" style={{ marginTop: '24px' }}>Información Comercial</p>
          <div className="form-grid product-form-grid">
            <div className="form-control">
              <label htmlFor="moneda">Moneda</label>
              <select id="moneda" name="moneda" value={formData.moneda} onChange={handleInputChange}>
                {MONEDAS.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div className="form-control">
              <label htmlFor="tipoCambio">Tipo de Cambio</label>
              <input id="tipoCambio" name="tipoCambio" type="number" step="0.0001" min="0" value={formData.tipoCambio} onChange={handleInputChange} placeholder="1" />
            </div>
            <div className="form-control">
              <label htmlFor="precioUnitario">Precio Unitario</label>
              <input id="precioUnitario" name="precioUnitario" type="number" step="0.01" min="0" value={formData.precioUnitario} onChange={handleInputChange} placeholder="0.00" />
            </div>
            <div className="form-control form-control-wide">
              <label htmlFor="proveedor">Proveedor</label>
              <input id="proveedor" name="proveedor" value={formData.proveedor} onChange={handleInputChange} placeholder="Nombre del proveedor" />
            </div>
          </div>

          <div className="form-actions">
            <button type="submit" className="btn btn-primary">
              <FiPlus />
              {isEditing ? 'Actualizar Producto' : 'Guardar Producto'}
            </button>
            {isEditing && (
              <button type="button" onClick={resetForm} className="btn btn-secondary">Cancelar</button>
            )}
          </div>
        </form>
      </div>

      <div className="list-card">
        <h2>Inventario de Agroquímicos</h2>
        <ul className="info-list">
          {productos.map(p => {
            const stockBajo = p.stockActual <= p.stockMinimo;
            const total = (p.precioUnitario || 0) * (p.stockActual || 0) * (p.tipoCambio || 1);
            return (
              <li key={p.id}>
                <div className="product-list-info">
                  <div className="item-main-text">
                    <span className="product-id-tag">{p.idProducto}</span>
                    {p.nombreComercial}
                  </div>
                  <div className="item-sub-text">
                    {p.ingredienteActivo} · {p.tipo}
                    {p.proveedor && <> · <span className="product-proveedor">{p.proveedor}</span></>}
                  </div>
                  {p.precioUnitario > 0 && (
                    <div className="product-total-value">
                      Total: {formatCurrency(total, p.moneda)}
                    </div>
                  )}
                </div>
                <div className="product-list-right">
                  <span className={`stock-badge ${stockBajo ? 'stock-bajo' : 'stock-ok'}`}>
                    {p.stockActual} {p.unidad}
                  </span>
                  <div className="lote-actions">
                    <button onClick={() => handleEdit(p)} className="icon-btn" title="Editar">
                      <FiEdit size={18} />
                    </button>
                    <button onClick={() => handleDelete(p.id)} className="icon-btn delete" title="Eliminar">
                      <FiTrash2 size={18} />
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
        {productos.length === 0 && <p className="empty-state">No hay productos registrados.</p>}
      </div>
    </div>
  );
}

export default ProductManagement;
