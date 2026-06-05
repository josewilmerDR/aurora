import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { FiPrinter, FiArrowLeft, FiShare2, FiDownload } from 'react-icons/fi';
import { useApiFetch } from '../../../hooks/useApiFetch';
import { useToast } from '../../../contexts/ToastContext';
import { CCSS_RATE, fmt, fmtIsoLong, fmtIsoShort } from '../lib/payroll-format';
import { csvRow, downloadCsv } from '../lib/csv';
import '../styles/fixed-payroll-report.css';

// salarioDiario autoritativo de la fila; fallback a mensual/30 sólo si no vino
// resuelto. Centralizado para no recalcularlo en cada celda (paridad con el
// editor y el backend, que ya guardan salarioDiario).
const diarioDe = (e) => e?.salarioDiario ?? ((e?.salarioMensual || 0) / 30);

export default function FixedPayrollReport() {
  const navigate = useNavigate();
  const apiFetch = useApiFetch();
  const toast = useToast();
  const docRef = useRef(null);

  // Data from sessionStorage
  const [filas, setFilas]               = useState([]);
  const [periodoLabel, setPeriodoLabel] = useState('');
  const [periodoInicio, setPeriodoInicio] = useState('');
  const [periodoFin, setPeriodoFin]     = useState('');
  const [totalGeneral, setTotalGeneral] = useState(0);
  const [modo, setModo]                 = useState('planilla'); // 'planilla' | 'comprobante'
  const [reportNumber, setReportNumber] = useState('BORRADOR');
  const [fechaEmisionIso, setFechaEmisionIso] = useState(() => new Date().toISOString());

  // Company config from /api/config
  const [config, setConfig] = useState({ nombreEmpresa: 'Finca Aurora', identificacion: '', direccion: '', whatsapp: '', logoUrl: '' });
  const [configLoading, setConfigLoading] = useState(true);
  const [logoBroken, setLogoBroken] = useState(false);

  const [hydrated, setHydrated] = useState(false);
  const [backRoute, setBackRoute] = useState('/hr/planilla/fijo');
  const [sharing, setSharing] = useState(false);

  // El N° es BORRADOR sólo si la planilla no fue guardada (sin consecutivo).
  // Derivado de un flag explícito, no de comparar el string contra 'BORRADOR'.
  const isBorrador = reportNumber === 'BORRADOR';

  useEffect(() => {
    let alive = true;
    const origin = sessionStorage.getItem('aurora_planilla_reporte_origin') || '/hr/planilla/fijo';
    setBackRoute(origin);

    // Vuelca un objeto de datos completo (con filas) al estado del componente.
    const applyData = (data) => {
      setFilas(Array.isArray(data.filas) ? data.filas : []);
      setPeriodoLabel(data.periodoLabel || '');
      setPeriodoInicio(data.periodoInicio || '');
      setPeriodoFin(data.periodoFin || '');
      setTotalGeneral(data.totalGeneral || 0);
      if (data.modo === 'comprobante' || data.modo === 'planilla') setModo(data.modo);
      if (data.numeroConsecutivo) setReportNumber(data.numeroConsecutivo);
      // Para planillas guardadas la emisión es su fecha de creación, NO hoy.
      if (data.fechaEmision) setFechaEmisionIso(data.fechaEmision);
      setHydrated(true);
    };

    let ref;
    try {
      const raw = sessionStorage.getItem('aurora_planilla_reporte');
      if (!raw) { navigate(origin); return; }
      ref = JSON.parse(raw);
      // PII de nómina (salarios + cédulas) no debe quedar legible en
      // sessionStorage. En el flujo del historial (source:'fetch') ya NO viaja
      // ahí — solo una referencia (planillaId + empleadoId); rehidratamos la
      // fila desde el backend con su gate de rol (auditoría F3). El borrador del
      // editor sí trae filas inline (no hay nada que pedir) y las purgamos tras
      // leerlas.
      sessionStorage.removeItem('aurora_planilla_reporte');
    } catch {
      navigate(origin);
      return;
    }

    if (ref?.source === 'fetch' && ref.planillaId && ref.empleadoId) {
      apiFetch(`/api/hr/planilla-fijo?empleadoId=${encodeURIComponent(ref.empleadoId)}`)
        .then(r => r.json())
        .then(list => {
          if (!alive) return;
          const p = Array.isArray(list) ? list.find(x => x?.id === ref.planillaId) : null;
          if (!p || !p.fila) { navigate(origin); return; }
          applyData({
            periodoInicio:     p.periodoInicio,
            periodoFin:        p.periodoFin,
            periodoLabel:      p.periodoLabel,
            totalGeneral:      Number(p.fila.totalNeto) || 0,
            filas:             [p.fila],
            numeroConsecutivo: p.numeroConsecutivo || null,
            fechaEmision:      p.createdAt || null,
            modo:              ref.modo === 'planilla' ? 'planilla' : 'comprobante',
          });
        })
        .catch(() => { if (alive) navigate(origin); });
    } else {
      // Flujo del editor: filas inline en el propio payload.
      applyData(ref);
    }
    return () => { alive = false; };
  }, [navigate, apiFetch]);

  useEffect(() => {
    let alive = true;
    setConfigLoading(true);
    apiFetch('/api/config')
      .then(r => r.json())
      .then(data => {
        if (!alive) return;
        setConfig({
          nombreEmpresa:  data.nombreEmpresa  || 'Finca Aurora',
          identificacion: data.identificacion || '',
          direccion:      data.direccion      || '',
          whatsapp:       data.whatsapp       || '',
          logoUrl:        data.logoUrl        || '',
        });
        setLogoBroken(false);
      })
      .catch(() => {})
      .finally(() => { if (alive) setConfigLoading(false); });
    return () => { alive = false; };
  }, [apiFetch]);

  // Comprobante mode: explicit intent + single employee with daily data.
  // El modo lo decide quien navega (data.modo); la presencia de `dias` es sólo
  // un guard de seguridad, no el criterio.
  const isComprobante = modo === 'comprobante' && filas.length === 1 && (filas[0]?.dias?.length > 0);
  const empleado = isComprobante ? filas[0] : null;

  const fechaEmisionLabel = fmtIsoLong(fechaEmisionIso);
  const safePeriodo = (periodoLabel || 'planilla').replace(/[^\w-]+/g, '_');
  const docTitle = `${isComprobante ? 'comprobante' : 'planilla'}-${reportNumber}-${safePeriodo}`;

  // Nombre lindo en el diálogo "Guardar como PDF" del navegador.
  useEffect(() => {
    if (!hydrated) return;
    const prev = document.title;
    document.title = docTitle;
    return () => { document.title = prev; };
  }, [hydrated, docTitle]);

  const totalEmpleados      = filas.length;
  const totalOrdinario      = filas.reduce((s, f) => s + (f.salarioOrdinario || 0), 0);
  const totalExtraordinario = filas.reduce((s, f) => s + (f.salarioExtraordinario || 0), 0);
  const totalDeducciones    = filas.reduce((s, f) => s + (f.totalDeducciones || 0), 0);

  const handlePrint = () => window.print();

  // Exporta la planilla completa como CSV. Solo se ofrece en modo planilla
  // (el comprobante individual se entrega como PDF, no como tabla).
  // El monto se clampa a >=0 para mantener paridad con el PDF (fmt() también
  // hace Math.max(0, ...)). El total se suma sobre los montos YA clampeados de
  // cada fila para que la columna cuadre exactamente con su propio total.
  const handleExportCSV = useCallback(() => {
    const money = (n) => Math.max(0, Math.round(Number(n) || 0));
    const rows = [];
    rows.push(csvRow(['N°', 'Nombre', 'Cédula', 'Puesto', 'Ordinario', 'Extraordinario', 'Deducciones', 'Total Neto']));
    let sumOrd = 0, sumExt = 0, sumDed = 0, sumNeto = 0;
    filas.forEach((f, idx) => {
      const ord = money(f.salarioOrdinario);
      const ext = money(f.salarioExtraordinario);
      const ded = money(f.totalDeducciones);
      const neto = money(f.totalNeto);
      sumOrd += ord; sumExt += ext; sumDed += ded; sumNeto += neto;
      rows.push(csvRow([idx + 1, f.trabajadorNombre || '', f.cedula || '', f.puesto || '', ord, ext, ded, neto]));
    });
    rows.push(csvRow(['TOTALES', '', '', '', sumOrd, sumExt, sumDed, sumNeto]));
    downloadCsv(`${docTitle}.csv`, rows);
    toast.success('CSV exportado.');
  }, [filas, docTitle, toast]);

  // Genera el PDF real del documento y lo comparte (mobile) o lo descarga
  // (desktop). Patrón reutilizado de OCNueva: html2canvas + jsPDF con soporte
  // multipágina. Sólo se renderiza cuando navigator.share existe O como
  // descarga, así el botón nunca promete un PDF que no entrega.
  const handleShare = useCallback(async () => {
    if (!docRef.current || sharing) return;
    setSharing(true);
    try {
      const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([
        import('html2canvas'),
        import('jspdf'),
      ]);
      const canvas = await html2canvas(docRef.current, { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const imgH = (canvas.height * pageW) / canvas.width;
      let y = 0;
      while (y < imgH) {
        if (y > 0) pdf.addPage();
        pdf.addImage(imgData, 'PNG', 0, -y, pageW, imgH);
        y += pageH;
      }
      const filename = `${docTitle}.pdf`;
      const blob = pdf.output('blob');
      const file = new File([blob], filename, { type: 'application/pdf' });
      if (navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: filename });
        } catch (e) {
          if (e?.name !== 'AbortError') toast.error('No se pudo compartir el PDF.');
        }
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        toast.success('PDF descargado.');
      }
    } catch {
      toast.error('No se pudo generar el PDF.');
    } finally {
      setSharing(false);
    }
  }, [docTitle, sharing, toast]);

  // Loading: gateamos el documento hasta tener datos Y config. Evita el flash de
  // branding placeholder ('Finca Aurora' / logo 'AU') saltando al real, y que el
  // usuario imprima/comparta un documento a medio hidratar.
  if (!hydrated || configLoading) {
    return (
      <main className="pr-page">
        <div className="pr-topbar no-print">
          <button className="pr-btn-back" onClick={() => navigate(backRoute)}>
            <FiArrowLeft size={16} aria-hidden="true" /> Volver
          </button>
          <span className="pr-topbar-title">Cargando documento…</span>
          <span aria-hidden="true" />
        </div>
        <div className="empty-state" style={{ margin: 'auto' }} role="status" aria-live="polite">
          <p>Preparando el documento…</p>
        </div>
      </main>
    );
  }

  // Estado vacío: la planilla existe pero no tiene filas (filtro o planilla sin
  // empleados). Evita renderizar un documento fantasma con totales en ₡0.
  if (filas.length === 0) {
    return (
      <main className="pr-page">
        <div className="pr-topbar no-print">
          <button className="pr-btn-back" onClick={() => navigate(backRoute)}>
            <FiArrowLeft size={16} aria-hidden="true" /> Volver
          </button>
          <span className="pr-topbar-title">Previsualización de planilla</span>
          <span aria-hidden="true" />
        </div>
        <div className="empty-state" style={{ margin: 'auto' }}>
          <p>Esta planilla no tiene empleados para mostrar.</p>
          <button className="pr-btn-print" onClick={() => navigate(backRoute)}>Volver a la planilla</button>
        </div>
      </main>
    );
  }

  return (
    <main className="pr-page">

      {/* Anuncio para lector de pantalla al cargar el documento */}
      <span className="aur-sr-only" role="status" aria-live="polite">
        {hydrated
          ? (isComprobante
              ? `Comprobante de pago de ${empleado.trabajadorNombre}`
              : `Previsualización de planilla, ${totalEmpleados} empleados`)
          : ''}
      </span>

      {/* ── Top bar (hidden on print) ── */}
      <div className="pr-topbar no-print">
        <button className="pr-btn-back" onClick={() => navigate(backRoute)}>
          <FiArrowLeft size={16} aria-hidden="true" /> Volver
        </button>
        <span className="pr-topbar-title">
          {isComprobante
            ? `Comprobante de Pago — ${empleado.trabajadorNombre}`
            : `Previsualización de Planilla — ${periodoLabel}`}
        </span>
        <div className="pr-topbar-actions">
          {!isComprobante && (
            <button className="pr-btn-csv" onClick={handleExportCSV} title="Exportar planilla como CSV" aria-label="Exportar planilla como CSV">
              <FiDownload size={16} aria-hidden="true" /> <span className="pr-btn-label">Exportar CSV</span>
            </button>
          )}
          <button className="pr-btn-share" onClick={handleShare} disabled={sharing} aria-label="Compartir como PDF">
            <FiShare2 size={16} aria-hidden="true" /> <span className="pr-btn-label">{sharing ? 'Generando…' : 'Compartir PDF'}</span>
          </button>
          <button className="pr-btn-print" onClick={handlePrint} aria-label="Imprimir o guardar como PDF">
            <FiPrinter size={16} aria-hidden="true" /> <span className="pr-btn-label">Imprimir / PDF</span>
          </button>
        </div>
      </div>

      {/* ── Alert banner — only for unsaved drafts ── */}
      {isBorrador && (
        <div className="pr-alert-banner no-print" role="status">
          Esta es una <strong>previsualización</strong>. Para conservar los datos, asegúrese de usar <strong>Guardar planilla</strong> antes de cerrar la planilla.
        </div>
      )}

      {/* ══ DOCUMENT ══ */}
      <div className="pr-doc-wrap">
        <div className="pr-document" ref={docRef}>

          {/* ── Encabezado ── */}
          <div className="pr-doc-header">
            <div className="pr-doc-brand">
              <div className="pr-doc-logo">
                {config.logoUrl && !logoBroken
                  ? <img src={config.logoUrl} alt={config.nombreEmpresa} className="pr-doc-logo-img" onError={() => setLogoBroken(true)} />
                  : 'AU'}
              </div>
              <div className="pr-doc-brand-info">
                <div className="pr-doc-brand-name">{String(config.nombreEmpresa || 'Finca Aurora').toUpperCase()}</div>
                {config.identificacion && <div className="pr-doc-brand-sub">Céd. {config.identificacion}</div>}
                {config.direccion && <div className="pr-doc-brand-sub">{config.direccion}{config.whatsapp ? ` · Tel: ${config.whatsapp}` : ''}</div>}
              </div>
            </div>
            <div className="pr-doc-title-block">
              <div className="pr-doc-title">
                {isComprobante ? 'COMPROBANTE DE PAGO' : 'PLANILLA DE SALARIOS'}
              </div>
              <table className="pr-doc-meta-table">
                <tbody>
                  <tr><td>N°:</td><td><strong>{reportNumber}</strong></td></tr>
                  <tr><td>Emisión:</td><td><strong>{fechaEmisionLabel}</strong></td></tr>
                  <tr><td>Período:</td><td><strong>{periodoLabel}</strong></td></tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* ── Bloque de período / empleado ── */}
          <div className="pr-doc-periodo">
            <div className="pr-doc-periodo-item">
              <span className="pr-doc-periodo-label">Fecha inicio</span>
              <span className="pr-doc-periodo-val">{fmtIsoLong(periodoInicio)}</span>
            </div>
            <div className="pr-doc-periodo-item">
              <span className="pr-doc-periodo-label">Fecha fin</span>
              <span className="pr-doc-periodo-val">{fmtIsoLong(periodoFin)}</span>
            </div>
            {isComprobante ? (
              <>
                <div className="pr-doc-periodo-item">
                  <span className="pr-doc-periodo-label">Empleado</span>
                  <span className="pr-doc-periodo-val">{empleado.trabajadorNombre}</span>
                </div>
                <div className="pr-doc-periodo-item">
                  <span className="pr-doc-periodo-label">Cédula</span>
                  <span className="pr-doc-periodo-val">{empleado.cedula || '—'}</span>
                </div>
              </>
            ) : (
              <div className="pr-doc-periodo-item">
                <span className="pr-doc-periodo-label">Total empleados</span>
                <span className="pr-doc-periodo-val">{totalEmpleados}</span>
              </div>
            )}
          </div>

          {/* ══ MODO COMPROBANTE: desglose diario + deducciones ══ */}
          {isComprobante && (
            <>
              {/* ── Info del empleado ── */}
              <div className="pr-comp-emp-row">
                {empleado.puesto && (
                  <div className="pr-comp-emp-field">
                    <span className="pr-comp-emp-label">Puesto</span>
                    <span className="pr-comp-emp-val">{empleado.puesto}</span>
                  </div>
                )}
                <div className="pr-comp-emp-field">
                  <span className="pr-comp-emp-label">Salario mensual</span>
                  <span className="pr-comp-emp-val">{fmt(empleado.salarioMensual)}</span>
                </div>
                <div className="pr-comp-emp-field">
                  <span className="pr-comp-emp-label">Salario diario</span>
                  <span className="pr-comp-emp-val">{fmt(diarioDe(empleado))}</span>
                </div>
              </div>

              {/* ── Desglose diario ── */}
              <div className="pr-comp-section-title">Desglose por día</div>
              <div className="pr-table-scroll">
                <table className="pr-doc-table pr-comp-dias-table">
                  <caption className="aur-sr-only">Desglose de salario por día del empleado {empleado.trabajadorNombre}</caption>
                  <thead>
                    <tr>
                      <th scope="col" style={{ textAlign: 'left', width: 100 }}>Fecha</th>
                      <th scope="col">Salario Ordinario</th>
                      <th scope="col">Salario Extraordinario</th>
                    </tr>
                  </thead>
                  <tbody>
                    {empleado.dias.map((d, idx) => (
                      <tr key={idx} className={d.ausente ? 'pr-comp-row-ausente' : ''}>
                        <td style={{ textAlign: 'left' }}>{fmtIsoShort(d.fecha)}</td>
                        <td>
                          {d.ausente
                            ? <span className="pr-comp-ausente-label">Ausente con permiso</span>
                            : fmt(diarioDe(empleado))}
                        </td>
                        <td>
                          {(d.salarioExtra > 0) ? fmt(d.salarioExtra) : <span className="pr-money-empty">—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td style={{ textAlign: 'left' }}>Totales</td>
                      <td>{fmt(empleado.salarioOrdinario)}</td>
                      <td>{empleado.salarioExtraordinario > 0 ? fmt(empleado.salarioExtraordinario) : '—'}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              {/* ── Resumen de deducciones y neto ── */}
              <div className="pr-comp-section-title">Resumen de pago</div>
              <table className="pr-comp-resumen-table">
                <tbody>
                  <tr>
                    <td>Salario ordinario</td>
                    <td>{fmt(empleado.salarioOrdinario)}</td>
                  </tr>
                  {empleado.salarioExtraordinario > 0 && (
                    <tr>
                      <td>Salario extraordinario</td>
                      <td>{fmt(empleado.salarioExtraordinario)}</td>
                    </tr>
                  )}
                  <tr className="pr-comp-resumen-bruto">
                    <td>Salario bruto</td>
                    <td>{fmt(empleado.salarioBruto)}</td>
                  </tr>
                  <tr className="pr-comp-resumen-ded">
                    <td>Seguro Social CCSS ({(CCSS_RATE * 100).toFixed(2)}%)</td>
                    <td>({fmt(empleado.deduccionCCSS)})</td>
                  </tr>
                  {(empleado.deduccionesExtra || []).map((d, idx) => (
                    <tr key={idx} className="pr-comp-resumen-ded">
                      <td>{d.concepto || 'Deducción adicional'}</td>
                      <td>({fmt(d.monto)})</td>
                    </tr>
                  ))}
                  <tr className="pr-comp-resumen-neto">
                    <td>TOTAL SALARIO NETO</td>
                    <td>{fmt(empleado.totalNeto)}</td>
                  </tr>
                </tbody>
              </table>
            </>
          )}

          {/* ══ MODO PLANILLA COMPLETA ══ */}
          {!isComprobante && (
            <div className="pr-table-scroll">
              <table className="pr-doc-table">
                <caption className="aur-sr-only">Planilla de salarios del período {periodoLabel}</caption>
                <thead>
                  <tr>
                    <th scope="col" className="pr-col-num">#</th>
                    <th scope="col" className="pr-col-nombre">Nombre</th>
                    <th scope="col" className="pr-col-cedula">Cédula</th>
                    <th scope="col" className="pr-col-puesto">Puesto</th>
                    <th scope="col" className="pr-col-money">Ordinario</th>
                    <th scope="col" className="pr-col-money">Extraordinario</th>
                    <th scope="col" className="pr-col-money">Deducciones</th>
                    <th scope="col" className="pr-col-money pr-col-neto">Total Neto</th>
                  </tr>
                </thead>
                <tbody>
                  {filas.map((f, idx) => (
                    <tr key={f.trabajadorId}>
                      <td className="pr-col-num">{idx + 1}</td>
                      <th scope="row" className="pr-col-nombre">{f.trabajadorNombre}</th>
                      <td className="pr-col-cedula">{f.cedula || '—'}</td>
                      <td className="pr-col-puesto">{f.puesto || '—'}</td>
                      <td className="pr-col-money">{fmt(f.salarioOrdinario)}</td>
                      <td className="pr-col-money">
                        {f.salarioExtraordinario > 0 ? fmt(f.salarioExtraordinario) : '—'}
                      </td>
                      <td className="pr-col-money pr-ded">({fmt(f.totalDeducciones)})</td>
                      <td className="pr-col-money pr-col-neto">{fmt(f.totalNeto)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={4} className="pr-tfoot-label">TOTALES</td>
                    <td className="pr-col-money">{fmt(totalOrdinario)}</td>
                    <td className="pr-col-money">{totalExtraordinario > 0 ? fmt(totalExtraordinario) : '—'}</td>
                    <td className="pr-col-money pr-ded">({fmt(totalDeducciones)})</td>
                    <td className="pr-col-money pr-col-neto pr-tfoot-neto">{fmt(totalGeneral)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {/* ── Nota de deducciones ── */}
          <div className="pr-doc-ded-note">
            <strong>Nota:</strong> Las deducciones incluyen Seguro Social (CCSS) del empleado al {(CCSS_RATE * 100).toFixed(2)}% sobre el salario bruto, más cualquier deducción adicional configurada por empleado.
          </div>

          {/* ── Firmas ── */}
          <div className="pr-doc-signatures">
            <div className="pr-sig">
              <div className="pr-sig-line" />
              <div className="pr-sig-role">Elaborado por</div>
            </div>
            <div className="pr-sig">
              <div className="pr-sig-line" />
              <div className="pr-sig-role">{isComprobante ? 'Recibido conforme' : 'Revisado por'}</div>
            </div>
            <div className="pr-sig">
              <div className="pr-sig-line" />
              <div className="pr-sig-role">Autorizado por</div>
            </div>
          </div>

          {/* ── Footer ── */}
          <div className="pr-doc-footer">
            Documento generado por Sistema Aurora · {reportNumber} · {fechaEmisionLabel}
          </div>

        </div>
      </div>
    </main>
  );
}
