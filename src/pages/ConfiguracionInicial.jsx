import { useState, useEffect, useRef } from 'react';
import { FiTool, FiDroplet, FiList, FiLayers, FiHash, FiTruck, FiUsers, FiUserPlus, FiDownload, FiUpload, FiExternalLink, FiSettings, FiArrowRight, FiX } from 'react-icons/fi';
import * as XLSX from 'xlsx';
import { Link, useNavigate } from 'react-router-dom';
import { useApiFetch } from '../hooks/useApiFetch';
import './ConfiguracionInicial.css';

// ── Guardarraíles de importación ─────────────────────────────────────────────
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_ROWS       = 5000;

// Lee y parsea un archivo Excel con validaciones. Devuelve filas o lanza Error con msg legible.
async function readExcelRows(file) {
  if (!file) throw new Error('No se seleccionó archivo.');
  if (file.size > MAX_FILE_BYTES) throw new Error(`Archivo demasiado grande (máx. ${MAX_FILE_BYTES / 1024 / 1024} MB).`);
  const workbook = XLSX.read(await file.arrayBuffer());
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error('El archivo no contiene hojas.');
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' });
  if (rows.length > MAX_ROWS) throw new Error(`Demasiadas filas (máx. ${MAX_ROWS}).`);
  return rows;
}

// ── Normalización de tipo de producto ────────────────────────────────────────
const TIPOS_PRODUCTO = ['Herbicida', 'Fungicida', 'Insecticida', 'Fertilizante', 'Regulador de crecimiento', 'Otro'];
const normalizeTipo = (val) => {
  const s = String(val || '').trim();
  return TIPOS_PRODUCTO.find(t => t.toLowerCase() === s.toLowerCase()) ?? s;
};

// ── Normalización rol de usuario ─────────────────────────────────────────────
const ROLES_VALIDOS = ['trabajador', 'encargado', 'supervisor', 'rrhh', 'administrador'];
const normalizeRol = (val) => {
  const s = String(val || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return ROLES_VALIDOS.find(r => r === s) ?? 'trabajador';
};

// ── Normalización proveedor ───────────────────────────────────────────────────
const CATEGORIAS_PROV = ['agroquimicos', 'fertilizantes', 'maquinaria', 'servicios', 'combustible', 'semillas', 'otros'];
const normalizeCategoriaProv = (val) => {
  const s = String(val || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return CATEGORIAS_PROV.find(c => c === s) ?? '';
};
const normalizeTipoPago = (val) => {
  const s = String(val || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return s === 'credito' ? 'credito' : 'contado';
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
    key: 'unidades-medida',
    nombre: 'Unidades de Medida',
    descripcion: 'Unidades utilizadas en actividades de campo, dosis de productos y conversiones.',
    icon: FiHash,
    endpoint: '/api/unidades-medida',
    adminPath: '/admin/unidades-medida',
    excelHeaders: ['Nombre', 'Descripción', 'Factor de conversión', 'Unidad base', 'Precio', 'Labor'],
    sampleRow:    ['Litro', 'Unidad de volumen líquido', '1', '', '', 'Chapea manual'],
    fileName:     'plantilla_unidades_medida.xlsx',
    sheetName:    'Unidades de Medida',
    parseRow: (row) => ({
      nombre:           String(row['Nombre']                || '').trim(),
      descripcion:      String(row['Descripción']           || '').trim(),
      factorConversion: row['Factor de conversión'] !== '' ? row['Factor de conversión'] : '',
      unidadBase:       String(row['Unidad base']           || '').trim(),
      precio:           row['Precio'] !== '' ? row['Precio'] : '',
      _laborNombre:     String(row['Labor']                 || '').trim(),
    }),
    isValid: (r) => !!r.nombre,
    prepareItems: async (items, apiFetch) => {
      const labores = await fetchJsonSafe(apiFetch, '/api/labores', []);
      const laborMap = {};
      for (const l of labores) {
        if (l.descripcion) laborMap[l.descripcion.toLowerCase()] = l.id;
        if (l.codigo)      laborMap[l.codigo.toLowerCase()]      = l.id;
      }
      return items.map(({ _laborNombre, ...item }) => ({
        ...item,
        labor: _laborNombre ? (laborMap[_laborNombre.toLowerCase()] ?? '') : '',
      }));
    },
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
  {
    key: 'usuarios',
    nombre: 'Usuarios del Sistema',
    descripcion: 'Cuentas de acceso al sistema — nombre, email, teléfono y rol de cada usuario.',
    icon: FiUsers,
    endpoint: '/api/users',
    adminPath: '/users',
    excelHeaders: ['Nombre Completo', 'Email', 'Teléfono', 'Rol'],
    sampleRow:    ['Juan Pérez', 'juan@finca.com', '+506 8888-0000', 'trabajador'],
    fileName:     'plantilla_usuarios.xlsx',
    sheetName:    'Usuarios',
    parseRow: (row) => ({
      nombre:   String(row['Nombre Completo'] || '').trim(),
      email:    String(row['Email']           || '').trim(),
      telefono: String(row['Teléfono']        || '').trim(),
      rol:      normalizeRol(row['Rol']),
    }),
    isValid: (r) => !!(r.nombre && r.email),
  },
  {
    key: 'proveedores',
    nombre: 'Lista de Proveedores',
    descripcion: 'Proveedores de insumos, maquinaria y servicios — idénticos al módulo Proveedores de Contabilidad.',
    icon: FiTruck,
    endpoint: '/api/proveedores',
    adminPath: '/proveedores',
    excelHeaders: [
      'Nombre', 'RUC / Cédula', 'Teléfono', 'Email', 'Dirección',
      'Tipo de Pago', 'Días de Crédito', 'Moneda',
      'Contacto', 'WhatsApp', 'Sitio Web',
      'País de Origen', 'Entrega (días)',
      'Límite Crédito', 'Descuento (%)', 'Banco', 'Cuenta Bancaria',
      'Categoría', 'Estado', 'Notas',
    ],
    sampleRow: [
      'AgroDistribuidora S.A.', '3-101-123456', '+506 2222-3333', 'ventas@agrodist.com', 'San José, Costa Rica',
      'credito', 30, 'USD',
      'Juan Pérez', '+506 8888-7777', 'https://agrodist.com',
      'Costa Rica', 3,
      5000, 5, 'BCR', 'CR21015201001026284066',
      'agroquimicos', 'activo', '',
    ],
    fileName:  'plantilla_proveedores.xlsx',
    sheetName: 'Proveedores',
    parseRow: (row) => {
      const monedaRaw = String(row['Moneda'] || '').trim().toUpperCase();
      return {
        nombre:            String(row['Nombre']           || '').trim(),
        ruc:               String(row['RUC / Cédula']     || '').trim(),
        telefono:          String(row['Teléfono']          || '').trim(),
        email:             String(row['Email']             || '').trim(),
        direccion:         String(row['Dirección']         || '').trim(),
        tipoPago:          normalizeTipoPago(row['Tipo de Pago']),
        diasCredito:       row['Días de Crédito']          || 30,
        moneda:            ['USD', 'CRC'].includes(monedaRaw) ? monedaRaw : 'USD',
        contacto:          String(row['Contacto']          || '').trim(),
        whatsapp:          String(row['WhatsApp']          || '').trim(),
        sitioWeb:          String(row['Sitio Web']         || '').trim(),
        paisOrigen:        String(row['País de Origen']    || '').trim(),
        tiempoEntregaDias: row['Entrega (días)']           || '',
        limiteCredito:     row['Límite Crédito']           || '',
        descuentoHabitual: row['Descuento (%)']            || '',
        banco:             String(row['Banco']             || '').trim(),
        cuentaBancaria:    String(row['Cuenta Bancaria']   || '').trim(),
        categoria:         normalizeCategoriaProv(row['Categoría']),
        estado:            String(row['Estado'] || '').trim().toLowerCase() === 'inactivo' ? 'inactivo' : 'activo',
        notas:             String(row['Notas']             || '').trim(),
      };
    },
    isValid: (r) => !!r.nombre,
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

  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const refreshCount = async () => {
    const data = await fetchJsonSafe(apiFetch, entidad.endpoint, null);
    if (!mountedRef.current) return;
    setCount(Array.isArray(data) ? data.length : null);
  };

  useEffect(() => { refreshCount(); /* eslint-disable-line react-hooks/exhaustive-deps */ }, []);

  const handleDownloadTemplate = () => {
    const ws = XLSX.utils.aoa_to_sheet([entidad.excelHeaders, entidad.sampleRow]);
    ws['!cols'] = entidad.excelHeaders.map(() => ({ wch: 22 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, entidad.sheetName);
    XLSX.writeFile(wb, entidad.fileName);
  };

  const handleImport = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setImportResult(null);
    try {
      const rows = await readExcelRows(file);
      let validas = rows.map(entidad.parseRow).filter(entidad.isValid);
      if (entidad.prepareItems) validas = await entidad.prepareItems(validas, apiFetch);
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
    } catch (err) {
      setImportResult({ error: true, msg: err?.message });
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
            ? `⚠ ${importResult.msg || 'No se pudo leer el archivo. Usa la plantilla.'}`
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

// ── Helper: Date → YYYY-MM-DD seguro ante RangeError de .toISOString() ───────
function dateToIsoDay(d) {
  if (!(d instanceof Date) || isNaN(d)) return null;
  try { return d.toISOString().slice(0, 10); } catch { return null; }
}

// ── Helper: Firestore Timestamp JSON → YYYY-MM-DD ─────────────────────────────
function timestampToDateStr(ts) {
  if (!ts) return null;
  if (typeof ts === 'string') return ts.slice(0, 10);
  const secs = ts.seconds ?? ts._seconds;
  return secs != null ? dateToIsoDay(new Date(secs * 1000)) : null;
}

// ── Helper: cualquier valor de fecha de Excel → YYYY-MM-DD o null ─────────────
// xlsx puede devolver: JS Date, número serial Excel, o string
function toDateStr(val) {
  if (val == null || val === '') return null;
  if (val instanceof Date) return dateToIsoDay(val);
  if (typeof val === 'number') {
    // Número serial Excel: 1 = 1 ene 1900; ajuste de los 25569 días al epoch Unix
    return dateToIsoDay(new Date((val - 25569) * 86400 * 1000));
  }
  const s = String(val).trim();
  if (!s) return null;
  return dateToIsoDay(new Date(s));
}

// ── Helper: fetch JSON tolerante (cualquier fallo → fallback) ────────────────
async function fetchJsonSafe(apiFetch, path, fallback) {
  try {
    const res = await apiFetch(path);
    if (!res.ok) return fallback;
    return await res.json();
  } catch { return fallback; }
}

// ── Plantilla Lotes + Grupos + Bloques ────────────────────────────────────────
const LGB_HEADERS = [
  'Código de lote', 'Nombre del lote', 'Fecha del lote',
  'Nombre del grupo', 'Fecha del grupo', 'Cosecha', 'Etapa',
  'Fecha de siembra', 'Bloque', 'Plantas', 'Densidad', 'Área (calc.)',
  'Material', 'Variedad', 'Rango de pesos', 'Cerrado', 'Fecha de cierre',
];

const LGB_SAMPLE = [
  'LOT-001', 'Lote Principal', '2024-01-15',
  'Grupo A', '2024-01-15', 'Cosecha 2024', 'Etapa 1',
  '2024-01-15', 'B-01', 500, 250, '',
  'Clon X', 'Grande', '18-22 kg', 'SI', '2024-06-30',
];

function LotesGruposCard() {
  const apiFetch = useApiFetch();
  const navigate = useNavigate();
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [showNavPrompt, setShowNavPrompt] = useState(false);
  const fileInputRef = useRef(null);

  const handleDownloadTemplate = () => {
    const ws = XLSX.utils.aoa_to_sheet([LGB_HEADERS, LGB_SAMPLE]);
    ws['!cols'] = LGB_HEADERS.map(() => ({ wch: 18 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Lotes-Grupos-Bloques');
    XLSX.writeFile(wb, 'plantilla_lotes_grupos_bloques.xlsx');
  };

  const handleImport = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setImportResult(null);
    try {
      const rows = await readExcelRows(file);

      if (!rows.length) {
        setImportResult({ error: true, msg: 'El archivo está vacío.' });
        return;
      }

      const today = new Date().toISOString().slice(0, 10);
      const filasSaltadas = [];

      const parsed = rows.map((row, idx) => {
        const cerradoVal = String(row['Cerrado'] || '').trim().toUpperCase();
        const esCerrado = ['SI', 'TRUE', '1', 'YES'].includes(cerradoVal);
        const fechaCierre  = toDateStr(row['Fecha de cierre']);
        const fechaSiembra = toDateStr(row['Fecha de siembra']) || fechaCierre || today;
        return {
          _fila:              idx + 2, // número de fila en el Excel (encabezado = 1)
          codigoLote:         String(row['Código de lote']   || '').trim(),
          nombreLote:         String(row['Nombre del lote']  || '').trim(),
          fechaCreacionLote:  toDateStr(row['Fecha del lote'])   || today,
          nombreGrupo:        String(row['Nombre del grupo'] || '').trim(),
          fechaCreacionGrupo: toDateStr(row['Fecha del grupo'])  || today,
          cosecha:            String(row['Cosecha']          || '').trim(),
          etapa:              String(row['Etapa']            || '').trim(),
          fecha:              fechaSiembra,
          bloque:             String(row['Bloque']           || '').trim(),
          plantas:            Number(row['Plantas'])         || 0,
          densidad:           Number(row['Densidad'])        || 0,
          materialNombre:     String(row['Material']         || '').trim(),
          variedad:           String(row['Variedad']         || '').trim(),
          rangoPesos:         String(row['Rango de pesos']   || '').trim(),
          cerrado:            esCerrado,
          fechaCierre:        esCerrado ? fechaCierre : null,
        };
      }).filter(r => {
        const razon = !r.codigoLote ? 'falta "Código de lote"'
                    : !r.nombreGrupo ? 'falta "Nombre del grupo"'
                    : null;
        if (razon) { filasSaltadas.push(`Fila ${r._fila}: ${razon}`); return false; }
        return true;
      });

      if (!parsed.length) {
        const detalle = filasSaltadas.slice(0, 3).join(' | ');
        setImportResult({ error: true, msg: `Sin filas válidas. ${detalle}` });
        return;
      }

      // ── Phase 0: Materiales de siembra ─────────────────────────────────────
      const existingMateriales = await fetchJsonSafe(apiFetch, '/api/materiales-siembra', []);
      const materialMap = {}; // nombre → { id }
      for (const m of existingMateriales) {
        if (m.nombre) materialMap[m.nombre] = { id: m.id };
      }

      const uniqueMateriales = new Map();
      for (const r of parsed) {
        if (r.materialNombre && !uniqueMateriales.has(r.materialNombre))
          uniqueMateriales.set(r.materialNombre, { variedad: r.variedad, rangoPesos: r.rangoPesos });
      }

      let materialesCreados = 0;
      for (const [nombre, { variedad, rangoPesos }] of uniqueMateriales) {
        if (materialMap[nombre]) continue;
        try {
          const res = await apiFetch('/api/materiales-siembra', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nombre, variedad, rangoPesos }),
          });
          if (!res.ok) continue;
          materialMap[nombre] = { id: (await res.json()).id };
          materialesCreados++;
        } catch { /* non-blocking */ }
      }

      // ── Phase 1: Lotes ──────────────────────────────────────────────────────
      const existingLotes = await fetchJsonSafe(apiFetch, '/api/lotes', []);
      const loteMap = {};
      for (const l of existingLotes) {
        if (l.codigoLote) loteMap[l.codigoLote] = l.id;
      }

      const uniqueLotes = new Map();
      for (const r of parsed) {
        if (!uniqueLotes.has(r.codigoLote))
          uniqueLotes.set(r.codigoLote, { nombreLote: r.nombreLote, fechaCreacion: r.fechaCreacionLote });
      }

      let lotesCreados = 0, lotesExistentes = 0, lotesError = 0;
      for (const [codigoLote, { nombreLote, fechaCreacion }] of uniqueLotes) {
        if (loteMap[codigoLote]) { lotesExistentes++; continue; }
        try {
          const res = await apiFetch('/api/lotes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ codigoLote, nombreLote, fechaCreacion }),
          });
          if (!res.ok) { lotesError++; continue; }
          loteMap[codigoLote] = (await res.json()).id;
          lotesCreados++;
        } catch { lotesError++; }
      }

      // ── Phase 2: Siembras (bloques) ─────────────────────────────────────────
      const grupoQueue = {};
      let siembrasCreadas = 0, siembrasError = 0;
      for (const r of parsed) {
        const loteId = loteMap[r.codigoLote];
        if (!loteId) { siembrasError++; continue; }
        try {
          const mat = r.materialNombre ? materialMap[r.materialNombre] : null;
          const payload = {
            loteId,
            loteNombre: r.nombreLote || r.codigoLote,
            bloque: r.bloque,
            plantas: r.plantas,
            densidad: r.densidad,
            materialId: mat?.id || '',
            materialNombre: r.materialNombre,
            variedad: r.variedad,
            rangoPesos: r.rangoPesos,
            cerrado: r.cerrado,
            fecha: r.fecha,
            ...(r.cerrado && r.fechaCierre ? { fechaCierre: r.fechaCierre } : {}),
          };
          const res = await apiFetch('/api/siembras', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          if (!res.ok) { siembrasError++; continue; }
          const data = await res.json();
          if (!grupoQueue[r.nombreGrupo]) {
            grupoQueue[r.nombreGrupo] = { fechaCreacion: r.fechaCreacionGrupo, cosecha: r.cosecha, etapa: r.etapa, siembraIds: [] };
          }
          grupoQueue[r.nombreGrupo].siembraIds.push(data.id);
          siembrasCreadas++;
        } catch { siembrasError++; }
      }

      // ── Phase 3: Grupos ─────────────────────────────────────────────────────
      const existingGrupos = await fetchJsonSafe(apiFetch, '/api/grupos', []);
      const grupoMap = {};
      for (const g of existingGrupos) {
        if (g.nombreGrupo) grupoMap[g.nombreGrupo] = g;
      }

      let gruposCreados = 0, gruposActualizados = 0, gruposError = 0;
      for (const [nombreGrupo, { fechaCreacion, cosecha, etapa, siembraIds }] of Object.entries(grupoQueue)) {
        if (!siembraIds.length) continue;
        try {
          if (grupoMap[nombreGrupo]) {
            const existing = grupoMap[nombreGrupo];
            const newBloques = [...new Set([...(existing.bloques || []), ...siembraIds])];
            const existingFecha = timestampToDateStr(existing.fechaCreacion) || fechaCreacion;
            const res = await apiFetch(`/api/grupos/${existing.id}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                nombreGrupo,
                cosecha: existing.cosecha || cosecha,
                etapa: existing.etapa || etapa,
                fechaCreacion: existingFecha,
                paqueteId: existing.paqueteId || '',
                bloques: newBloques,
              }),
            });
            if (!res.ok) { gruposError++; continue; }
            gruposActualizados++;
          } else {
            const res = await apiFetch('/api/grupos', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ nombreGrupo, cosecha, etapa, fechaCreacion, bloques: siembraIds }),
            });
            if (!res.ok) { gruposError++; continue; }
            gruposCreados++;
          }
        } catch { gruposError++; }
      }

      const totalErrors = lotesError + siembrasError + gruposError;
      const totalCreados = lotesCreados + siembrasCreadas + gruposCreados + gruposActualizados;

      const partesExito = [
        materialesCreados  > 0 && `${materialesCreados} material(es)`,
        lotesCreados       > 0 && `${lotesCreados} lote(s)`,
        lotesExistentes    > 0 && `${lotesExistentes} lote(s) ya existían`,
        siembrasCreadas    > 0 && `${siembrasCreadas} bloque(s)`,
        gruposCreados      > 0 && `${gruposCreados} grupo(s)`,
        gruposActualizados > 0 && `${gruposActualizados} grupo(s) actualizado(s)`,
      ].filter(Boolean).join(' · ');

      const advertencias = [
        ...filasSaltadas.slice(0, 3),
        totalErrors > 0 && `${totalErrors} registro(s) con error al guardar`,
      ].filter(Boolean);

      if (totalCreados === 0 && totalErrors > 0) {
        const detalle = advertencias.join(' | ');
        setImportResult({ error: true, msg: `No se creó ningún registro. Posible causa: fechas en formato incorrecto o datos inválidos. Detalle: ${detalle}` });
      } else {
        const msgOk = partesExito ? `Creados: ${partesExito}` : 'Sin cambios nuevos.';
        const msgWarn = advertencias.length ? ` ⚠ ${advertencias.join(' | ')}` : '';
        setImportResult({ ok: true, msg: msgOk + msgWarn });
        setShowNavPrompt(totalCreados > 0);
      }
    } catch (err) {
      setImportResult({ error: true, msg: err?.message || 'Error inesperado al procesar el archivo.' });
    } finally {
      setImporting(false);
      e.target.value = '';
    }
  };

  return (
    <div className="ci-card">
      <div className="ci-card-header">
        <span className="ci-card-icon"><FiLayers size={18} /></span>
        <span className="ci-card-nombre">Lotes, Grupos y Bloques</span>
        <Link to="/lotes" className="ci-card-link" title="Ir a Gestión de Lotes">
          <FiExternalLink size={13} />
        </Link>
      </div>
      <p className="ci-card-desc">
        Carga combinada: lotes, grupos de producción y bloques de siembra. Un grupo se crea una sola vez aunque aparezca en varios renglones.
      </p>
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
            ? `⚠ ${importResult.msg || 'No se pudo procesar el archivo.'}`
            : `✓ ${importResult.msg}`}
        </p>
      )}
      {showNavPrompt && (
        <div className="ci-nav-prompt">
          <span>¿Ir a <strong>Gestión de Lotes</strong> para revisar los datos?</span>
          <div className="ci-nav-prompt-actions">
            <button className="btn btn-primary btn-sm" onClick={() => navigate('/lotes')}>
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

// ── Plantilla Empleados (carga masiva) ───────────────────────────────────────
const EMP_HEADERS = [
  'Nombre Completo', 'Email', 'Teléfono', 'Rol',
  'Cédula', 'Puesto', 'Departamento', 'Fecha de Ingreso', 'Tipo de Contrato',
  'Salario Base', 'Precio/Hora', 'Dirección', 'Contacto Emergencia', 'Teléfono Emergencia', 'Notas',
];
const EMP_SAMPLE = [
  'Juan Pérez', 'juan@finca.com', '+506 8888-0000', 'trabajador',
  '1-1234-5678', 'Operario de campo', 'Producción', '2024-01-15', 'permanente',
  '500000', '3000', 'San José, Costa Rica', 'María Pérez', '+506 7777-8888', 'Muy puntual',
];

function EmpleadosCard() {
  const apiFetch = useApiFetch();
  const navigate = useNavigate();
  const [count, setCount] = useState(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [showNavPrompt, setShowNavPrompt] = useState(false);
  const fileInputRef = useRef(null);

  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const refreshCount = async () => {
    const data = await fetchJsonSafe(apiFetch, '/api/users', null);
    if (!mountedRef.current) return;
    setCount(Array.isArray(data) ? data.filter(u => u.empleadoPlanilla).length : null);
  };

  useEffect(() => { refreshCount(); /* eslint-disable-line react-hooks/exhaustive-deps */ }, []);

  const handleDownloadTemplate = () => {
    const ws = XLSX.utils.aoa_to_sheet([EMP_HEADERS, EMP_SAMPLE]);
    ws['!cols'] = EMP_HEADERS.map(() => ({ wch: 22 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Empleados');
    XLSX.writeFile(wb, 'plantilla_empleados.xlsx');
  };

  const handleImport = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setImportResult(null);
    try {
      const rows = await readExcelRows(file);
      const parsed = rows
        .map(row => ({
          nombre:              String(row['Nombre Completo']       || '').trim(),
          email:               String(row['Email']                 || '').trim(),
          telefono:            String(row['Teléfono']              || '').trim(),
          rol:                 normalizeRol(row['Rol']),
          cedula:              String(row['Cédula']                || '').trim(),
          puesto:              String(row['Puesto']                || '').trim(),
          departamento:        String(row['Departamento']          || '').trim(),
          fechaIngreso:        toDateStr(row['Fecha de Ingreso'])  || '',
          tipoContrato:        String(row['Tipo de Contrato']      || 'permanente').trim().toLowerCase() || 'permanente',
          salarioBase:         row['Salario Base']                 || '',
          precioHora:          row['Precio/Hora']                  || '',
          direccion:           String(row['Dirección']             || '').trim(),
          contactoEmergencia:  String(row['Contacto Emergencia']   || '').trim(),
          telefonoEmergencia:  String(row['Teléfono Emergencia']   || '').trim(),
          notas:               String(row['Notas']                 || '').trim(),
        }))
        .filter(r => r.nombre && r.email);

      if (!parsed.length) {
        setImportResult({ error: true });
        return;
      }

      let creados = 0, actualizados = 0, errores = 0;
      for (const item of parsed) {
        const { cedula, puesto, departamento, fechaIngreso, tipoContrato, salarioBase,
                precioHora, direccion, contactoEmergencia, telefonoEmergencia, notas, ...userData } = item;
        try {
          const res = await apiFetch('/api/users', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...userData, empleadoPlanilla: true }),
          });
          if (!res.ok) { errores++; continue; }
          const { id, merged } = await res.json();
          merged ? actualizados++ : creados++;
          await apiFetch(`/api/hr/fichas/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cedula, puesto, departamento, fechaIngreso, tipoContrato,
                                   salarioBase, precioHora, direccion, contactoEmergencia,
                                   telefonoEmergencia, notas }),
          }).catch(() => {});
        } catch { errores++; }
      }

      const parts = [
        creados      > 0 && `${creados} creado(s)`,
        actualizados > 0 && `${actualizados} actualizado(s)`,
        errores      > 0 && `${errores} con error`,
      ].filter(Boolean).join(' · ');
      setImportResult({ ok: true, msg: parts });
      setShowNavPrompt(creados + actualizados > 0);
      refreshCount();
    } catch (err) {
      setImportResult({ error: true, msg: err?.message });
    } finally {
      setImporting(false);
      e.target.value = '';
    }
  };

  return (
    <div className="ci-card">
      <div className="ci-card-header">
        <span className="ci-card-icon"><FiUserPlus size={18} /></span>
        <span className="ci-card-nombre">Empleados (Planilla)</span>
        {count !== null && <span className="ci-card-count">{count}</span>}
        <Link to="/hr/ficha" className="ci-card-link" title="Ir a Ficha del Trabajador">
          <FiExternalLink size={13} />
        </Link>
      </div>
      <p className="ci-card-desc">
        Carga masiva de empleados en planilla. Crea el usuario y su ficha laboral (puesto, salario, fecha de ingreso) en un solo paso.
      </p>
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
            ? `⚠ ${importResult.msg || 'No se pudo leer el archivo. Usa la plantilla.'}`
            : `✓ ${importResult.msg}`}
        </p>
      )}
      {showNavPrompt && (
        <div className="ci-nav-prompt">
          <span>¿Ir a <strong>Ficha del Trabajador</strong> para revisar los datos?</span>
          <div className="ci-nav-prompt-actions">
            <button className="btn btn-primary btn-sm" onClick={() => navigate('/hr/ficha')}>
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
  return (
    <div className="ci-wrap">
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
        <LotesGruposCard />
        <EmpleadosCard />
      </div>
    </div>
  );
}

export default ConfiguracionInicial;
