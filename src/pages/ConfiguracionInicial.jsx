import { useState, useEffect, useRef } from 'react';
import { FiTool, FiDroplet, FiList, FiDownload, FiUpload, FiExternalLink, FiSettings, FiArrowRight, FiX } from 'react-icons/fi';
import * as XLSX from 'xlsx';
import { Link, useNavigate } from 'react-router-dom';
import Toast from '../components/Toast';
import { useApiFetch } from '../hooks/useApiFetch';
import './ConfiguracionInicial.css';

// ── Normalización de tipo de producto ────────────────────────────────────────
const TIPOS_PRODUCTO = ['Herbicida', 'Fungicida', 'Insecticida', 'Fertilizante', 'Regulador de crecimiento', 'Otro'];
const normalizeTipo = (val) => {
  const s = String(val || '').trim();
  return TIPOS_PRODUCTO.find(t => t.toLowerCase() === s.toLowerCase()) ?? s;
};

// ── Definición de entidades ───────────────────────────────────────────────────
const ENTIDADES = [
  {
    key: 'activos',
    nombre: 'Lista de Activos',
    descripcion: 'Maquinaria, tractores, implementos y vehículos de la finca.',
    icon: FiTool,
    endpoint: '/api/maquinaria',
    adminPath: '/admin/maquinaria',
    excelHeaders: ['ID Activo', 'Código (CC)', 'Descripción', 'Tipo', 'Ubicación', 'Capacidad (litros)', 'Observación'],
    sampleRow:    ['0403-0020', '3-20', 'TRACTOR JOHN DEERE 5075E', 'TRACTOR DE LLANTAS', 'Finca Aurora', '', ''],
    fileName:     'plantilla_activos.xlsx',
    sheetName:    'Activos',
    parseRow: (row) => ({
      idMaquina:   String(row['ID Activo']         || '').trim(),
      codigo:      String(row['Código (CC)']       || '').trim(),
      descripcion: String(row['Descripción']       || '').trim(),
      tipo:        String(row['Tipo']              || '').trim(),
      ubicacion:   String(row['Ubicación']         || '').trim(),
      capacidad:   row['Capacidad (litros)']       || '',
      observacion: String(row['Observación']       || '').trim(),
    }),
    isValid: (r) => !!r.descripcion,
  },
  {
    key: 'productos',
    nombre: 'Lista de Productos',
    descripcion: 'Agroquímicos del inventario — campos idénticos al módulo Inventario de Agroquímicos.',
    icon: FiDroplet,
    endpoint: '/api/productos',
    adminPath: '/productos',
    excelHeaders: [
      'ID Producto', 'Nombre Comercial', 'Ingrediente Activo', 'Tipo', 'Plaga / Enfermedad',
      'Dosis/Ha', 'Unidad', 'Reingreso (h)', 'A Cosecha (días)',
      'Stock Actual', 'Stock Mínimo', 'Precio Unitario', 'Moneda',
      'IVA (%)', 'Proveedor', 'Reg. Fitosanitario', 'Observación',
    ],
    sampleRow: [
      'HER-001', 'Roundup', 'Glifosato', 'Herbicida', 'Malezas de hoja ancha',
      '2', 'L', '24', '14',
      '10', '2', '12.50', 'USD',
      '13', 'AgroDistribuidora S.A.', 'B-0123', '',
    ],
    fileName:  'plantilla_inventario_agroquimicos.xlsx',
    sheetName: 'Agroquímicos',
    parseRow: (row) => ({
      idProducto:            String(row['ID Producto']        || '').trim(),
      nombreComercial:       String(row['Nombre Comercial']   || '').trim(),
      ingredienteActivo:     String(row['Ingrediente Activo'] || '').trim(),
      tipo:                  normalizeTipo(row['Tipo']),
      plagaQueControla:      String(row['Plaga / Enfermedad'] || '').trim(),
      cantidadPorHa:         row['Dosis/Ha']                  || '',
      unidad:                String(row['Unidad']             || '').trim(),
      periodoReingreso:      row['Reingreso (h)']             || 0,
      periodoACosecha:       row['A Cosecha (días)']          || 0,
      stockActual:           row['Stock Actual']              || 0,
      stockMinimo:           row['Stock Mínimo']              || 0,
      precioUnitario:        row['Precio Unitario']           || 0,
      moneda:                String(row['Moneda']             || 'USD').trim(),
      iva:                   row['IVA (%)']                   || 0,
      proveedor:             String(row['Proveedor']          || '').trim(),
      registroFitosanitario: String(row['Reg. Fitosanitario'] || '').trim(),
      observacion:           String(row['Observación']        || '').trim(),
    }),
    isValid: (r) => !!r.nombreComercial,
  },
  {
    key: 'labores',
    nombre: 'Lista de Labores',
    descripcion: 'Tipos de trabajo registrables en horímetro y actividades de campo.',
    icon: FiList,
    endpoint: '/api/labores',
    adminPath: '/admin/labores',
    excelHeaders: ['Código', 'Descripción', 'Observación'],
    sampleRow:    ['CHAP-01', 'Chapea manual', ''],
    fileName:     'plantilla_labores.xlsx',
    sheetName:    'Labores',
    parseRow: (row) => ({
      codigo:      String(row['Código']      || '').trim(),
      descripcion: String(row['Descripción'] || '').trim(),
      observacion: String(row['Observación'] || '').trim(),
    }),
    isValid: (r) => !!r.descripcion,
  },
];

// ── Tarjeta por entidad ───────────────────────────────────────────────────────
function EntidadCard({ entidad }) {
  const apiFetch = useApiFetch();
  const navigate = useNavigate();
  const [count, setCount] = useState(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [showNavPrompt, setShowNavPrompt] = useState(false);
  const fileInputRef = useRef(null);

  const refreshCount = () =>
    apiFetch(entidad.endpoint)
      .then(r => r.json())
      .then(data => setCount(Array.isArray(data) ? data.length : null))
      .catch(() => {});

  useEffect(() => { refreshCount(); }, []);

  const handleDownloadTemplate = () => {
    const ws = XLSX.utils.aoa_to_sheet([entidad.excelHeaders, entidad.sampleRow]);
    ws['!cols'] = entidad.excelHeaders.map(() => ({ wch: 22 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, entidad.sheetName);
    XLSX.writeFile(wb, entidad.fileName);
  };

  const handleImport = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setImporting(true);
    setImportResult(null);
    try {
      const workbook = XLSX.read(await file.arrayBuffer());
      const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: '' });
      const validas = rows.map(entidad.parseRow).filter(entidad.isValid);
      if (!validas.length) {
        setImportResult({ error: true });
        return;
      }
      let creados = 0, actualizados = 0, errores = 0;
      for (const item of validas) {
        try {
          const res = await apiFetch(entidad.endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(item),
          });
          if (!res.ok) { errores++; continue; }
          const data = await res.json();
          data.merged ? actualizados++ : creados++;
        } catch { errores++; }
      }
      const parts = [
        creados      > 0 && `${creados} creado(s)`,
        actualizados > 0 && `${actualizados} actualizado(s)`,
        errores      > 0 && `${errores} con error`,
      ].filter(Boolean).join(' · ');
      setImportResult({ ok: true, msg: parts });
      setShowNavPrompt(true);
      refreshCount();
    } catch {
      setImportResult({ error: true });
    } finally {
      setImporting(false);
      e.target.value = '';
    }
  };

  const Icon = entidad.icon;

  return (
    <div className="ci-card">
      <div className="ci-card-header">
        <span className="ci-card-icon"><Icon size={18} /></span>
        <span className="ci-card-nombre">{entidad.nombre}</span>
        {count !== null && <span className="ci-card-count">{count}</span>}
        <Link to={entidad.adminPath} className="ci-card-link" title="Ir a gestión completa">
          <FiExternalLink size={13} />
        </Link>
      </div>
      <p className="ci-card-desc">{entidad.descripcion}</p>
      <div className="ci-import-row">
        <button type="button" className="btn btn-secondary" onClick={handleDownloadTemplate}>
          <FiDownload size={13} /> Plantilla
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => fileInputRef.current?.click()}
          disabled={importing}
        >
          <FiUpload size={13} /> {importing ? 'Importando…' : 'Importar Excel'}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls"
          style={{ display: 'none' }}
          onChange={handleImport}
        />
      </div>
      {importResult && (
        <p className={`ci-import-result ${importResult.error ? 'ci-import-error' : 'ci-import-ok'}`}>
          {importResult.error
            ? '⚠ No se pudo leer el archivo. Usa la plantilla.'
            : `✓ ${importResult.msg}`}
        </p>
      )}
      {showNavPrompt && (
        <div className="ci-nav-prompt">
          <span>¿Ir a <strong>{entidad.nombre}</strong> para revisar los datos?</span>
          <div className="ci-nav-prompt-actions">
            <button className="btn btn-primary btn-sm" onClick={() => navigate(entidad.adminPath)}>
              <FiArrowRight size={13} /> Ir ahora
            </button>
            <button className="btn btn-secondary btn-sm" onClick={() => setShowNavPrompt(false)}>
              <FiX size={13} /> No, continuar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Página principal ──────────────────────────────────────────────────────────
function ConfiguracionInicial() {
  const [toast, setToast] = useState(null);

  return (
    <div className="ci-wrap">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      <div className="ci-intro">
        <FiSettings size={18} />
        <p>
          Carga masiva de datos para la configuración inicial de la finca. Descarga la plantilla de
          cada entidad, complétala y súbela para poblar la base de datos. Si un registro ya existe
          (mismo ID o código), se actualizará en lugar de duplicarse.
        </p>
      </div>

      <div className="ci-grid">
        {ENTIDADES.map(entidad => (
          <EntidadCard key={entidad.key} entidad={entidad} />
        ))}
      </div>
    </div>
  );
}

export default ConfiguracionInicial;
