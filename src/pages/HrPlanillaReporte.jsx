import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { FiPrinter, FiArrowLeft, FiShare2 } from 'react-icons/fi';
import { useApiFetch } from '../hooks/useApiFetch';
import './HrPlanillaReporte.css';

const CCSS_RATE = 0.1083;

const fmt = (n) => `₡${Math.max(0, Math.round(Number(n))).toLocaleString('es-CR')}`;

const fmtDateLong = (iso) => {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' });
};

const fmtDateShort = (iso) => {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

export default function HrPlanillaReporte() {
  const navigate = useNavigate();
  const apiFetch = useApiFetch();
  const [fechaEmision]  = useState(new Date().toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' }));
  const [reportNumber, setReportNumber] = useState('BORRADOR');

  // Data from sessionStorage
  const [filas, setFilas]               = useState([]);
  const [periodoLabel, setPeriodoLabel] = useState('');
  const [periodoInicio, setPeriodoInicio] = useState('');
  const [periodoFin, setPeriodoFin]     = useState('');
  const [totalGeneral, setTotalGeneral] = useState(0);

  // Company config from /api/config
  const [config, setConfig] = useState({ nombreEmpresa: 'Finca Aurora', identificacion: '', direccion: '', whatsapp: '', logoUrl: '' });

  const [backRoute, setBackRoute] = useState('/hr/planilla/fijo');

  useEffect(() => {
    const origin = sessionStorage.getItem('aurora_planilla_reporte_origin') || '/hr/planilla/fijo';
    setBackRoute(origin);
    try {
      const raw = sessionStorage.getItem('aurora_planilla_reporte');
      if (!raw) { navigate(origin); return; }
      const data = JSON.parse(raw);
      setFilas(data.filas || []);
      setPeriodoLabel(data.periodoLabel || '');
      setPeriodoInicio(data.periodoInicio || '');
      setPeriodoFin(data.periodoFin || '');
      setTotalGeneral(data.totalGeneral || 0);
      if (data.numeroConsecutivo) setReportNumber(data.numeroConsecutivo);
    } catch {
      navigate(origin);
    }
  }, [navigate]);

  useEffect(() => {
    apiFetch('/api/config')
      .then(r => r.json())
      .then(data => setConfig({
        nombreEmpresa:  data.nombreEmpresa  || 'Finca Aurora',
        identificacion: data.identificacion || '',
        direccion:      data.direccion      || '',
        whatsapp:       data.whatsapp       || '',
        logoUrl:        data.logoUrl        || '',
      }))
      .catch(() => {});
  }, []);

  const handlePrint = () => window.print();

  const handleShare = async () => {
    const title = `Planilla de Salarios — ${periodoLabel}`;
    if (navigator.share) {
      try {
        await navigator.share({ title, text: `${title} · ${config.nombreEmpresa}` });
      } catch { /* user cancelled */ }
    } else {
      handlePrint();
    }
  };

  const totalEmpleados     = filas.length;
  const totalOrdinario     = filas.reduce((s, f) => s + (f.salarioOrdinario || 0), 0);
  const totalExtraordinario = filas.reduce((s, f) => s + (f.salarioExtraordinario || 0), 0);
  const totalDeducciones   = filas.reduce((s, f) => s + (f.totalDeducciones || 0), 0);

  // Comprobante mode: single employee with daily data available
  const isComprobante = filas.length === 1 && (filas[0]?.dias?.length > 0);
  const empleado = isComprobante ? filas[0] : null;

  return (
    <div className="pr-page">

      {/* ── Top bar (hidden on print) ── */}
      <div className="pr-topbar no-print">
        <button className="pr-btn-back" onClick={() => navigate(backRoute)}>
          <FiArrowLeft size={16} /> Volver
        </button>
        <span className="pr-topbar-title">
          {isComprobante
            ? `Comprobante de Pago — ${empleado.trabajadorNombre}`
            : `Previsualización de Planilla — ${periodoLabel}`}
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="pr-btn-share" onClick={handleShare}>
            <FiShare2 size={16} /> Compartir PDF
          </button>
          <button className="pr-btn-print" onClick={handlePrint}>
            <FiPrinter size={16} /> Imprimir / PDF
          </button>
        </div>
      </div>

      {/* ── Alert banner — only for unsaved drafts ── */}
      {reportNumber === 'BORRADOR' && (
        <div className="pr-alert-banner no-print">
          Esta es una <strong>previsualización</strong>. Para conservar los datos, asegúrese de usar <strong>Guardar planilla</strong> antes de cerrar la planilla.
        </div>
      )}

      {/* ══ DOCUMENT ══ */}
      <div className="pr-doc-wrap">
        <div className="pr-document">

          {/* ── Encabezado ── */}
          <div className="pr-doc-header">
            <div className="pr-doc-brand">
              <div className="pr-doc-logo">
                {config.logoUrl
                  ? <img src={config.logoUrl} alt="Logo" className="pr-doc-logo-img" />
                  : 'AU'}
              </div>
              <div className="pr-doc-brand-info">
                <div className="pr-doc-brand-name">{config.nombreEmpresa.toUpperCase()}</div>
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
                  <tr><td>Emisión:</td><td><strong>{fechaEmision}</strong></td></tr>
                  <tr><td>Período:</td><td><strong>{periodoLabel}</strong></td></tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* ── Bloque de período / empleado ── */}
          <div className="pr-doc-periodo">
            <div className="pr-doc-periodo-item">
              <span className="pr-doc-periodo-label">Fecha inicio</span>
              <span className="pr-doc-periodo-val">{fmtDateLong(periodoInicio)}</span>
            </div>
            <div className="pr-doc-periodo-item">
              <span className="pr-doc-periodo-label">Fecha fin</span>
              <span className="pr-doc-periodo-val">{fmtDateLong(periodoFin)}</span>
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
                  <span className="pr-comp-emp-val">{fmt(empleado.salarioDiario ?? (empleado.salarioMensual / 30))}</span>
                </div>
              </div>

              {/* ── Desglose diario ── */}
              <div className="pr-comp-section-title">Desglose por día</div>
              <table className="pr-doc-table pr-comp-dias-table">
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', width: 100 }}>Fecha</th>
                    <th>Salario Ordinario</th>
                    <th>Salario Extraordinario</th>
                  </tr>
                </thead>
                <tbody>
                  {empleado.dias.map((d, idx) => {
                    const diario = empleado.salarioDiario ?? (empleado.salarioMensual / 30);
                    return (
                      <tr key={idx} className={d.ausente ? 'pr-comp-row-ausente' : ''}>
                        <td style={{ textAlign: 'left' }}>{fmtDateShort(d.fecha)}</td>
                        <td>
                          {d.ausente
                            ? <span style={{ fontStyle: 'italic', color: '#c0392b', fontSize: '0.9em' }}>Ausente con permiso</span>
                            : fmt(diario)}
                        </td>
                        <td>
                          {(d.salarioExtra > 0) ? fmt(d.salarioExtra) : <span style={{ color: '#aaa' }}>—</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td style={{ textAlign: 'left' }}>Totales</td>
                    <td>{fmt(empleado.salarioOrdinario)}</td>
                    <td>{empleado.salarioExtraordinario > 0 ? fmt(empleado.salarioExtraordinario) : '—'}</td>
                  </tr>
                </tfoot>
              </table>

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
            <>
              {/* ── Tabla de empleados ── */}
              <table className="pr-doc-table">
                <thead>
                  <tr>
                    <th className="pr-col-num">#</th>
                    <th className="pr-col-nombre">Nombre</th>
                    <th className="pr-col-cedula">Cédula</th>
                    <th className="pr-col-puesto">Puesto</th>
                    <th className="pr-col-money">Ordinario</th>
                    <th className="pr-col-money">Extraordinario</th>
                    <th className="pr-col-money">Deducciones</th>
                    <th className="pr-col-money pr-col-neto">Total Neto</th>
                  </tr>
                </thead>
                <tbody>
                  {filas.map((f, idx) => (
                    <tr key={f.trabajadorId}>
                      <td className="pr-col-num">{idx + 1}</td>
                      <td className="pr-col-nombre">{f.trabajadorNombre}</td>
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
            </>
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
            Documento generado por Sistema Aurora · {reportNumber} · {fechaEmision}
          </div>

        </div>
      </div>
    </div>
  );
}
