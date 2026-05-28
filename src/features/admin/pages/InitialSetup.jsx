import { Link, useNavigate } from 'react-router-dom';
import { FiTool, FiDroplet, FiList, FiLayers, FiHash, FiTruck, FiUsers, FiUserPlus, FiShoppingCart, FiDownload, FiUpload, FiExternalLink, FiSettings, FiArrowRight, FiX, FiAlertCircle, FiAlertTriangle, FiCheckCircle } from 'react-icons/fi';
import AuroraConfirmModal from '../../../components/AuroraConfirmModal';
import { useBulkImport } from '../hooks/useBulkImport';
import {
  downloadTemplate, fetchJsonSafe, toDateStr, timestampToDateStr,
  normalizeTipo, normalizeRol, normalizeCategoriaProv, normalizeTipoPago,
} from '../lib/bulkImport';
import '../styles/initial-setup.css';

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
    requeridoLabel: 'Descripción',
    countLabel: 'activos',
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
    requeridoLabel: 'Nombre Comercial',
    countLabel: 'productos',
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
    requeridoLabel: 'Nombre',
    countLabel: 'unidades',
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
    requeridoLabel: 'Descripción',
    countLabel: 'labores',
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
      // La plantilla "Usuarios del Sistema" representa cuentas con acceso por
      // construcción. El backend exige al menos uno de (tieneAcceso,
      // empleadoPlanilla) al crear, así que declaramos la faceta acá.
      tieneAcceso: true,
    }),
    isValid: (r) => !!(r.nombre && r.email),
    requeridoLabel: 'Nombre Completo y Email',
    countLabel: 'usuarios',
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
    requeridoLabel: 'Nombre',
    countLabel: 'proveedores',
  },
  {
    key: 'compradores',
    nombre: 'Lista de Compradores',
    descripcion: 'Compradores de cosecha — idénticos al submódulo Compradores de Contabilidad y Finanzas.',
    icon: FiShoppingCart,
    endpoint: '/api/buyers',
    adminPath: '/finance/compradores',
    excelHeaders: [
      'Nombre', 'Cédula / RUC', 'Teléfono', 'Email', 'Dirección',
      'Tipo de Pago', 'Días de Crédito', 'Moneda',
      'Contacto', 'WhatsApp', 'Sitio Web',
      'País', 'Límite Crédito',
      'Estado', 'Notas',
    ],
    sampleRow: [
      'Comprador Ejemplo S.A.', '3-101-654321', '+506 2222-4444', 'compras@ejemplo.com', 'Heredia, Costa Rica',
      'credito', 30, 'USD',
      'Ana Soto', '+506 8888-6666', 'https://ejemplo.com',
      'Costa Rica', 10000,
      'activo', '',
    ],
    fileName:  'plantilla_compradores.xlsx',
    sheetName: 'Compradores',
    parseRow: (row) => {
      const monedaRaw = String(row['Moneda'] || '').trim().toUpperCase();
      return {
        name:        String(row['Nombre']       || '').trim(),
        taxId:       String(row['Cédula / RUC'] || '').trim(),
        phone:       String(row['Teléfono']     || '').trim(),
        email:       String(row['Email']        || '').trim(),
        address:     String(row['Dirección']    || '').trim(),
        paymentType: normalizeTipoPago(row['Tipo de Pago']),
        creditDays:  row['Días de Crédito']     || 30,
        currency:    ['USD', 'CRC'].includes(monedaRaw) ? monedaRaw : 'USD',
        contact:     String(row['Contacto']     || '').trim(),
        whatsapp:    String(row['WhatsApp']     || '').trim(),
        website:     String(row['Sitio Web']    || '').trim(),
        country:     String(row['País']         || '').trim(),
        creditLimit: row['Límite Crédito']      || '',
        status:      String(row['Estado'] || '').trim().toLowerCase() === 'inactivo' ? 'inactivo' : 'activo',
        notes:       String(row['Notas']        || '').trim(),
      };
    },
    isValid: (r) => !!r.name,
    requeridoLabel: 'Nombre',
    countLabel: 'compradores',
  },
];

// ── Helper de resultado para loops simples (entidad genérica y empleados) ─────
// Convierte los contadores del commit en el shape { didWrite, msg, warn } /
// { error, msg } que espera useBulkImport.
function summarizeResult({ creados = 0, actualizados = 0, omitidos = 0, errores = 0, skipped = [], extraWarn = [], aborted = false }) {
  const didWrite = creados + actualizados > 0;
  const parts = [
    creados      > 0 && `${creados} creado(s)`,
    actualizados > 0 && `${actualizados} actualizado(s)`,
    omitidos     > 0 && `${omitidos} ya existían (omitidos)`,
    errores      > 0 && `${errores} con error`,
  ].filter(Boolean).join(' · ');
  const advert = [
    skipped.length > 0 && `${skipped.length} fila(s) saltada(s)`,
    ...extraWarn,
    aborted && 'cancelado',
  ].filter(Boolean).join(' · ');
  if (!didWrite && (errores > 0 || aborted)) {
    return { error: true, msg: [parts, advert].filter(Boolean).join(' · ') || 'No se creó ningún registro.' };
  }
  return { didWrite, msg: parts || 'Sin cambios nuevos.', warn: advert || null };
}

// ── Subcomponentes presentacionales reutilizables ────────────────────────────

function CardHeader({ icon: Icon, title, count, countLabel, counts, stale, link, linkTitle }) {
  // Cuando el refresh del conteo falló, el badge se atenúa y avisa por title
  // que muestra el último valor conocido en vez de aparentar dato fresco.
  const staleProps = stale
    ? { className: 'aur-badge aur-badge--green ci-card-count ci-card-count--stale', title: 'No se pudo actualizar el conteo; mostrando el último valor conocido.' }
    : { className: 'aur-badge aur-badge--green ci-card-count' };
  // aria-label/title descriptivo: un ícono de flecha pelado no comunica destino
  // a sí solo. Si el card no pasa un linkTitle propio, lo derivamos del título.
  const linkLabel = linkTitle || `Ir a la gestión completa de ${title}`;
  return (
    <div className="ci-card-header">
      <span className="ci-card-icon"><Icon size={18} /></span>
      <span className="ci-card-title">{title}</span>
      {counts
        ? counts.filter(c => c.value !== null && c.value !== undefined).map((c, i) => (
            <span key={i} {...staleProps}>
              {c.value} {c.label}
            </span>
          ))
        : count !== null && (
            <span {...staleProps}>
              {count}{countLabel ? ` ${countLabel}` : ''}
            </span>
          )
      }
      {link && (
        <Link to={link} className="aur-icon-btn aur-icon-btn--sm ci-card-link" title={linkLabel} aria-label={linkLabel}>
          <FiExternalLink size={13} />
        </Link>
      )}
    </div>
  );
}

// Modal de confirmación con preview del import: muestra filas válidas vs
// saltadas ANTES de escribir nada, y durante el commit se transforma en
// barra de progreso con botón para cancelar (AbortController). Construido
// sobre AuroraConfirmModal → hereda focus trap, ESC y role="dialog".
function ImportPreviewModal({ entityName, validCount, skipped, committing, progress, onConfirm, onCancel, onAbort }) {
  const total = validCount + skipped.length;
  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
  return (
    <AuroraConfirmModal
      title={committing ? `Importando ${entityName}…` : `Confirmar importación`}
      icon={<FiUpload size={16} />}
      iconVariant="neutral"
      confirmLabel={committing ? `Procesando ${progress.done}/${progress.total}…` : `Crear ${validCount} registro(s)`}
      confirmDisabled={committing || validCount === 0}
      cancelLabel="Cancelar"
      onConfirm={onConfirm}
      onCancel={committing ? onAbort : onCancel}
    >
      <div className="ci-preview">
        <p className="ci-preview-summary">
          Se importarán <strong>{validCount}</strong> de {total} fila(s) hacia <strong>{entityName}</strong>.
          {skipped.length > 0 && <> {skipped.length} fila(s) se omitirán por datos faltantes.</>}
        </p>
        {skipped.length > 0 && (
          <ul className="ci-preview-skipped">
            {skipped.slice(0, 5).map((s, i) => <li key={i}>{s}</li>)}
            {skipped.length > 5 && <li>… y {skipped.length - 5} más</li>}
          </ul>
        )}
        {committing && (
          <div className="ci-preview-progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <div className="ci-preview-progress-bar" style={{ width: `${pct}%` }} />
          </div>
        )}
      </div>
    </AuroraConfirmModal>
  );
}

function ImportButtons({ onDownload, onImportClick, importing, fileInputRef, onFileChange }) {
  return (
    <div className="ci-import-row">
      <button type="button" className="aur-btn-pill aur-btn-pill--sm" onClick={onDownload}>
        <FiDownload size={13} /> Plantilla
      </button>
      <button
        type="button"
        className="aur-btn-pill aur-btn-pill--sm"
        onClick={onImportClick}
        disabled={importing}
      >
        <FiUpload size={13} /> {importing ? 'Importando…' : 'Importar Excel'}
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xls"
        style={{ display: 'none' }}
        onChange={onFileChange}
      />
    </div>
  );
}

// El feedback vive en un banner DENTRO del card (no en el toast global de la
// app) a propósito: el resultado pertenece a una entidad concreta y un toast
// flotante perdería ese contexto. Tres estados visuales y semánticos:
//   error → danger + alerta asertiva (interrumpe al lector de pantalla)
//   warn  → amarillo + triángulo cuando se escribió algo PERO hubo
//           saltadas/errores/cancelación; evita el banner verde mentiroso
//   ok    → verde + check sólo cuando salió todo limpio
// role/aria-live hacen que el resultado se anuncie sin depender de lo visual.
function ImportResultBanner({ result }) {
  if (!result) return null;
  if (result.error) {
    return (
      <div className="aur-banner aur-banner--danger" role="alert" aria-live="assertive">
        <FiAlertCircle size={14} />
        <span>{result.msg || 'No se pudo leer el archivo. Usá la plantilla.'}</span>
      </div>
    );
  }
  if (result.warn) {
    return (
      <div className="aur-banner aur-banner--warn" role="status" aria-live="polite">
        <FiAlertTriangle size={14} />
        <span>{result.msg ? `${result.msg} — ` : ''}{result.warn}</span>
      </div>
    );
  }
  return (
    <div className="aur-banner aur-banner--info" role="status" aria-live="polite">
      <FiCheckCircle size={14} />
      <span>{result.msg}</span>
    </div>
  );
}

function NavPrompt({ entityName, targetPath, onConfirm, onDismiss }) {
  return (
    <div className="aur-banner aur-banner--info" role="status" aria-live="polite">
      <FiArrowRight size={14} />
      <div className="ci-nav-prompt-body">
        <span>¿Ir a <strong>{entityName}</strong> para revisar los datos?</span>
        <div className="ci-nav-prompt-actions">
          <button type="button" className="aur-btn-pill aur-btn-pill--sm" onClick={onConfirm}>
            <FiArrowRight size={13} /> Ir ahora
          </button>
          <button type="button" className="aur-btn-text" onClick={onDismiss}>
            <FiX size={13} /> No, continuar
          </button>
        </div>
      </div>
    </div>
  );
}

// Chrome compartido de las 3 tarjetas: header (lo arma cada card por sus counts
// distintos) + descripción + botones + banner de resultado + NavPrompt + modal
// de preview. Todo el estado lo maneja el hook useBulkImport.
function BulkImportCard({ bulk, header, descripcion, onDownload, entityName, navEntityName, navTarget }) {
  const navigate = useNavigate();
  return (
    <div className="ci-card">
      {header}
      <p className="ci-card-desc">{descripcion}</p>
      <ImportButtons
        onDownload={onDownload}
        onImportClick={bulk.onImportClick}
        importing={bulk.parsing || bulk.committing}
        fileInputRef={bulk.fileInputRef}
        onFileChange={bulk.onFileChange}
      />
      <ImportResultBanner result={bulk.importResult} />
      {bulk.showNavPrompt && (
        <NavPrompt
          entityName={navEntityName}
          targetPath={navTarget}
          onConfirm={() => navigate(navTarget)}
          onDismiss={bulk.dismissNav}
        />
      )}
      {bulk.preview && (
        <ImportPreviewModal
          entityName={entityName}
          validCount={bulk.preview.validCount}
          skipped={bulk.preview.skipped}
          committing={bulk.committing}
          progress={bulk.progress}
          onConfirm={bulk.confirmImport}
          onCancel={bulk.cancelPreview}
          onAbort={bulk.abortCommit}
        />
      )}
    </div>
  );
}

// ── Tarjeta por entidad (CRUD simple sobre un único endpoint) ─────────────────
function EntidadCard({ entidad }) {
  const bulk = useBulkImport({
    countStorageKey: entidad.key,
    loadCount: async (apiFetch) => {
      const data = await fetchJsonSafe(apiFetch, entidad.endpoint, null);
      return Array.isArray(data) ? data.length : null;
    },
    parse: (rows) => {
      const payload = [];
      const skipped = [];
      rows.forEach((row, idx) => {
        const parsed = entidad.parseRow(row);
        if (entidad.isValid(parsed)) payload.push(parsed);
        else skipped.push(`Fila ${idx + 2}: falta ${entidad.requeridoLabel}`);
      });
      return { payload, skipped };
    },
    commit: async ({ payload, skipped, apiFetch, signal, setProgress }) => {
      let items = payload;
      try {
        if (entidad.prepareItems) items = await entidad.prepareItems(items, apiFetch);
      } catch { /* prepareItems es best-effort; seguimos con lo que haya */ }
      let creados = 0, actualizados = 0, omitidos = 0, errores = 0;
      for (let i = 0; i < items.length; i++) {
        if (signal.aborted) break;
        try {
          const res = await apiFetch(entidad.endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(items[i]),
            signal,
          });
          if (res.status === 409) omitidos++;          // ya existe (p.ej. email de usuario)
          else if (!res.ok) errores++;
          else { const data = await res.json(); data.merged ? actualizados++ : creados++; }
        } catch {
          if (signal.aborted) break;
          errores++;
        }
        setProgress({ done: i + 1, total: items.length });
      }
      return summarizeResult({ creados, actualizados, omitidos, errores, skipped, aborted: signal.aborted });
    },
  });

  return (
    <BulkImportCard
      bulk={bulk}
      header={<CardHeader icon={entidad.icon} title={entidad.nombre} count={bulk.count} countLabel={entidad.countLabel} stale={bulk.countStale} link={entidad.adminPath} />}
      descripcion={entidad.descripcion}
      onDownload={() => downloadTemplate({ headers: entidad.excelHeaders, sampleRow: entidad.sampleRow, sheetName: entidad.sheetName, fileName: entidad.fileName })}
      entityName={entidad.nombre}
      navEntityName={entidad.nombre}
      navTarget={entidad.adminPath}
    />
  );
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
  const bulk = useBulkImport({
    countStorageKey: 'lotes-grupos',
    loadCount: async (apiFetch) => {
      const [lotes, grupos] = await Promise.all([
        fetchJsonSafe(apiFetch, '/api/lotes', null),
        fetchJsonSafe(apiFetch, '/api/grupos', null),
      ]);
      if (!Array.isArray(lotes) || !Array.isArray(grupos)) return null;
      return { lotes: lotes.length, grupos: grupos.length };
    },
    parse: (rows) => {
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
      return { payload: parsed, skipped: filasSaltadas };
    },
    // Crea materiales → lotes → siembras → grupos con progreso y cancelación.
    // Los bloques se deduplican por (loteId, bloque) contra los existentes y
    // dentro del propio archivo, para que re-subir la planilla no duplique siembras.
    commit: async ({ payload: parsed, skipped: filasSaltadas, apiFetch, signal, setProgress }) => {
      const uniqueMateriales = new Map();
      for (const r of parsed) {
        if (r.materialNombre && !uniqueMateriales.has(r.materialNombre))
          uniqueMateriales.set(r.materialNombre, { variedad: r.variedad, rangoPesos: r.rangoPesos });
      }
      const uniqueLotes = new Map();
      for (const r of parsed) {
        if (!uniqueLotes.has(r.codigoLote))
          uniqueLotes.set(r.codigoLote, { nombreLote: r.nombreLote, fechaCreacion: r.fechaCreacionLote });
      }
      const distinctGrupos = new Set(parsed.map(r => r.nombreGrupo)).size;
      const totalOps = uniqueMateriales.size + uniqueLotes.size + parsed.length + distinctGrupos;
      let done = 0;
      const tick = () => { done++; setProgress({ done, total: totalOps }); };
      setProgress({ done: 0, total: totalOps });

      // ── Phase 0: Materiales de siembra ───────────────────────────────────────
      const existingMateriales = await fetchJsonSafe(apiFetch, '/api/materiales-siembra', []);
      const materialMap = {};
      for (const m of existingMateriales) {
        if (m.nombre) materialMap[m.nombre] = { id: m.id };
      }
      let materialesCreados = 0;
      for (const [nombre, { variedad, rangoPesos }] of uniqueMateriales) {
        if (signal.aborted) break;
        if (materialMap[nombre]) { tick(); continue; }
        try {
          const res = await apiFetch('/api/materiales-siembra', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nombre, variedad, rangoPesos }), signal,
          });
          if (res.ok) { materialMap[nombre] = { id: (await res.json()).id }; materialesCreados++; }
        } catch { /* non-blocking */ }
        tick();
      }

      // ── Phase 1: Lotes ────────────────────────────────────────────────────────
      const existingLotes = await fetchJsonSafe(apiFetch, '/api/lotes', []);
      const loteMap = {};
      for (const l of existingLotes) {
        if (l.codigoLote) loteMap[l.codigoLote] = l.id;
      }
      let lotesCreados = 0, lotesExistentes = 0, lotesError = 0;
      for (const [codigoLote, { nombreLote, fechaCreacion }] of uniqueLotes) {
        if (signal.aborted) break;
        if (loteMap[codigoLote]) { lotesExistentes++; tick(); continue; }
        try {
          const res = await apiFetch('/api/lotes', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ codigoLote, nombreLote, fechaCreacion }), signal,
          });
          if (!res.ok) lotesError++;
          else { loteMap[codigoLote] = (await res.json()).id; lotesCreados++; }
        } catch { if (!signal.aborted) lotesError++; }
        tick();
      }

      // ── Phase 2: Siembras (bloques), deduplicadas por (loteId, bloque) ────────
      const existingSiembras = await fetchJsonSafe(apiFetch, '/api/siembras', []);
      const siembraKeyToId = {}; // `${loteId}|${bloque}` → id (existentes + creadas en este import)
      for (const s of (Array.isArray(existingSiembras) ? existingSiembras : [])) {
        if (s.loteId && s.bloque) siembraKeyToId[`${s.loteId}|${String(s.bloque).trim()}`] = s.id;
      }
      const grupoQueue = {};
      let siembrasCreadas = 0, siembrasReutilizadas = 0, siembrasError = 0;
      const pushToGrupo = (r, siembraId) => {
        if (!grupoQueue[r.nombreGrupo]) {
          grupoQueue[r.nombreGrupo] = { fechaCreacion: r.fechaCreacionGrupo, cosecha: r.cosecha, etapa: r.etapa, siembraIds: [] };
        }
        grupoQueue[r.nombreGrupo].siembraIds.push(siembraId);
      };
      for (const r of parsed) {
        if (signal.aborted) break;
        const loteId = loteMap[r.codigoLote];
        if (!loteId) { siembrasError++; tick(); continue; }
        // Bloque con nombre: deduplica. Bloque vacío: siempre crea (preserva
        // el comportamiento previo, no se puede distinguir uno de otro).
        const key = r.bloque ? `${loteId}|${r.bloque}` : null;
        if (key && siembraKeyToId[key]) {
          pushToGrupo(r, siembraKeyToId[key]);
          siembrasReutilizadas++;
          tick();
          continue;
        }
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
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload), signal,
          });
          if (!res.ok) siembrasError++;
          else {
            const data = await res.json();
            if (key) siembraKeyToId[key] = data.id;
            pushToGrupo(r, data.id);
            siembrasCreadas++;
          }
        } catch { if (!signal.aborted) siembrasError++; }
        tick();
      }

      // ── Phase 3: Grupos ───────────────────────────────────────────────────────
      const existingGrupos = await fetchJsonSafe(apiFetch, '/api/grupos', []);
      const grupoMap = {};
      for (const g of existingGrupos) {
        if (g.nombreGrupo) grupoMap[g.nombreGrupo] = g;
      }
      let gruposCreados = 0, gruposActualizados = 0, gruposError = 0;
      for (const [nombreGrupo, { fechaCreacion, cosecha, etapa, siembraIds }] of Object.entries(grupoQueue)) {
        if (signal.aborted) break;
        if (!siembraIds.length) { tick(); continue; }
        try {
          if (grupoMap[nombreGrupo]) {
            const existing = grupoMap[nombreGrupo];
            const newBloques = [...new Set([...(existing.bloques || []), ...siembraIds])];
            const existingFecha = timestampToDateStr(existing.fechaCreacion) || fechaCreacion;
            const res = await apiFetch(`/api/grupos/${existing.id}`, {
              method: 'PUT', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                nombreGrupo,
                cosecha: existing.cosecha || cosecha,
                etapa: existing.etapa || etapa,
                fechaCreacion: existingFecha,
                paqueteId: existing.paqueteId || '',
                bloques: newBloques,
              }), signal,
            });
            if (!res.ok) gruposError++; else gruposActualizados++;
          } else {
            const res = await apiFetch('/api/grupos', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ nombreGrupo, cosecha, etapa, fechaCreacion, bloques: siembraIds }), signal,
            });
            if (!res.ok) gruposError++; else gruposCreados++;
          }
        } catch { if (!signal.aborted) gruposError++; }
        tick();
      }

      const aborted = signal.aborted;
      const totalErrors = lotesError + siembrasError + gruposError;
      const totalCreados = lotesCreados + siembrasCreadas + gruposCreados + gruposActualizados;

      const partesExito = [
        materialesCreados    > 0 && `${materialesCreados} material(es)`,
        lotesCreados         > 0 && `${lotesCreados} lote(s)`,
        lotesExistentes      > 0 && `${lotesExistentes} lote(s) ya existían`,
        siembrasCreadas      > 0 && `${siembrasCreadas} bloque(s)`,
        siembrasReutilizadas > 0 && `${siembrasReutilizadas} bloque(s) ya existían`,
        gruposCreados        > 0 && `${gruposCreados} grupo(s)`,
        gruposActualizados   > 0 && `${gruposActualizados} grupo(s) actualizado(s)`,
      ].filter(Boolean).join(' · ');

      const advertencias = [
        ...filasSaltadas.slice(0, 3),
        totalErrors > 0 && `${totalErrors} registro(s) con error al guardar`,
        aborted && 'importación cancelada',
      ].filter(Boolean);

      if (totalCreados === 0 && (totalErrors > 0 || aborted)) {
        return { error: true, msg: `No se creó ningún registro. ${advertencias.join(' · ')}` };
      }
      return {
        didWrite: totalCreados > 0,
        msg: partesExito ? `Creados: ${partesExito}` : 'Sin cambios nuevos.',
        warn: advertencias.length ? advertencias.join(' · ') : null,
      };
    },
  });

  return (
    <BulkImportCard
      bulk={bulk}
      header={
        <CardHeader
          icon={FiLayers}
          title="Lotes, Grupos y Bloques"
          counts={[
            { value: bulk.count?.lotes ?? null, label: 'lotes' },
            { value: bulk.count?.grupos ?? null, label: 'grupos' },
          ]}
          stale={bulk.countStale}
          link="/lotes"
          linkTitle="Ir a Gestión de Lotes"
        />
      }
      descripcion="Carga combinada: lotes, grupos de producción y bloques de siembra. Un grupo se crea una sola vez aunque aparezca en varios renglones."
      onDownload={() => downloadTemplate({ headers: LGB_HEADERS, sampleRow: LGB_SAMPLE, sheetName: 'Lotes-Grupos-Bloques', fileName: 'plantilla_lotes_grupos_bloques.xlsx', colWidth: 18 })}
      entityName="Lotes, Grupos y Bloques"
      navEntityName="Gestión de Lotes"
      navTarget="/lotes"
    />
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
  const bulk = useBulkImport({
    countStorageKey: 'empleados',
    loadCount: async (apiFetch) => {
      const data = await fetchJsonSafe(apiFetch, '/api/users', null);
      return Array.isArray(data) ? data.filter(u => u.empleadoPlanilla).length : null;
    },
    parse: (rows) => {
      const payload = [];
      const skipped = [];
      rows.forEach((row, idx) => {
        const r = {
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
        };
        if (r.nombre && r.email) payload.push(r);
        else skipped.push(`Fila ${idx + 2}: falta Nombre Completo y/o Email`);
      });
      return { payload, skipped };
    },
    // Crea usuario + ficha laboral. El PUT de la ficha se verifica: si falla, el
    // usuario queda creado pero se cuenta como ficha incompleta (antes el error
    // se tragaba en silencio).
    commit: async ({ payload, skipped, apiFetch, signal, setProgress }) => {
      let creados = 0, actualizados = 0, omitidos = 0, errores = 0, fichasIncompletas = 0;
      for (let i = 0; i < payload.length; i++) {
        if (signal.aborted) break;
        const { cedula, puesto, departamento, fechaIngreso, tipoContrato, salarioBase,
                precioHora, direccion, contactoEmergencia, telefonoEmergencia, notas, ...userData } = payload[i];
        // El template de planilla representa personas con acceso al sistema por
        // construcción, así que declaramos tieneAcceso=true para que el backend
        // no las oculte de UserManagement (default-to-false).
        const tieneAcceso = true;
        try {
          const res = await apiFetch('/api/users', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...userData, empleadoPlanilla: true, tieneAcceso }),
            signal,
          });
          if (res.status === 409) { omitidos++; setProgress({ done: i + 1, total: payload.length }); continue; }
          if (!res.ok) { errores++; setProgress({ done: i + 1, total: payload.length }); continue; }
          const { id, merged } = await res.json();
          merged ? actualizados++ : creados++;
          const fres = await apiFetch(`/api/hr/fichas/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cedula, puesto, departamento, fechaIngreso, tipoContrato,
                                   salarioBase, precioHora, direccion, contactoEmergencia,
                                   telefonoEmergencia, notas }),
            signal,
          }).catch(() => null);
          if (!fres || !fres.ok) fichasIncompletas++;
        } catch {
          if (signal.aborted) break;
          errores++;
        }
        setProgress({ done: i + 1, total: payload.length });
      }
      return summarizeResult({
        creados, actualizados, omitidos, errores, skipped,
        extraWarn: fichasIncompletas > 0 ? [`${fichasIncompletas} ficha(s) sin completar`] : [],
        aborted: signal.aborted,
      });
    },
  });

  return (
    <BulkImportCard
      bulk={bulk}
      header={<CardHeader icon={FiUserPlus} title="Empleados (Planilla)" count={bulk.count} countLabel="empleados" stale={bulk.countStale} link="/hr/ficha" linkTitle="Ir a Ficha del Trabajador" />}
      descripcion="Carga masiva de empleados en planilla. Crea el usuario y su ficha laboral (puesto, salario, fecha de ingreso) en un solo paso."
      onDownload={() => downloadTemplate({ headers: EMP_HEADERS, sampleRow: EMP_SAMPLE, sheetName: 'Empleados', fileName: 'plantilla_empleados.xlsx' })}
      entityName="Empleados (Planilla)"
      navEntityName="Ficha del Trabajador"
      navTarget="/hr/ficha"
    />
  );
}

// Tarjetas con flujo propio (multi-endpoint), fuera del catálogo ENTIDADES.
const EXTRA_CARDS = [LotesGruposCard, EmpleadosCard];

// ── Página principal ──────────────────────────────────────────────────────────
function InitialSetup() {
  return (
    <div className="aur-sheet">
      <header className="aur-sheet-header">
        <div className="aur-sheet-header-text">
          <h2 className="aur-sheet-title">Configuración inicial</h2>
          <p className="aur-sheet-subtitle">
            Carga masiva de datos para poblar la base de datos de la finca.
          </p>
        </div>
      </header>

      <div className="aur-banner aur-banner--info ci-intro">
        <FiSettings size={14} />
        <span>
          Descargá la plantilla de cada entidad, completala y subila. Antes de guardar verás un
          resumen para confirmar. Si un registro ya existe (mismo ID, código, nombre o RUC) se
          actualiza en lugar de duplicarse; las cuentas de usuario con email repetido se omiten.
        </span>
      </div>

      <section className="aur-section">
        <div className="aur-section-header">
          <h3>Entidades</h3>
          <span className="aur-section-count">{ENTIDADES.length + EXTRA_CARDS.length}</span>
        </div>
        <div className="ci-grid">
          {ENTIDADES.map(entidad => (
            <EntidadCard key={entidad.key} entidad={entidad} />
          ))}
          {EXTRA_CARDS.map((Card, i) => <Card key={i} />)}
        </div>
      </section>
    </div>
  );
}

export default InitialSetup;
