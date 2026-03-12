import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { FiPrinter, FiArrowLeft } from 'react-icons/fi';
import './HrPlanillaReporte.css';

const CCSS_RATE = 0.1083;

const fmt = (n) => `₡${Math.max(0, Math.round(Number(n))).toLocaleString('es-CR')}`;

const fmtDateLong = (iso) => {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' });
};

const generateReportNumber = () => {
  const now = new Date();
  return `PL-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(Math.floor(Math.random() * 900) + 100)}`;
};

export default function HrPlanillaReporte() {
  const navigate = useNavigate();
  const [reportNumber]  = useState(generateReportNumber);
  const [fechaEmision]  = useState(new Date().toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' }));

  // Data from sessionStorage
  const [filas, setFilas]           = useState([]);
  const [periodoLabel, setPeriodoLabel] = useState('');
  const [periodoInicio, setPeriodoInicio] = useState('');
  const [periodoFin, setPeriodoFin] = useState('');
  const [totalGeneral, setTotalGeneral] = useState(0);

  // Editable company / report metadata
  const [empresa, setEmpresa]               = useState('Finca Aurora');
  const [cedJuridica, setCedJuridica]       = useState('');
  const [direccion, setDireccion]           = useState('San José, Costa Rica');
  const [telefono, setTelefono]             = useState('');
  const [elaboradoPor, setElaboradoPor]     = useState('');
  const [notas, setNotas]                   = useState('');

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('aurora_planilla_reporte');
      if (!raw) { navigate('/hr/planilla/fijo'); return; }
      const data = JSON.parse(raw);
      setFilas(data.filas || []);
      setPeriodoLabel(data.periodoLabel || '');
      setPeriodoInicio(data.periodoInicio || '');
      setPeriodoFin(data.periodoFin || '');
      setTotalGeneral(data.totalGeneral || 0);
    } catch {
      navigate('/hr/planilla/fijo');
    }
  }, [navigate]);

  const handlePrint = () => window.print();

  const totalEmpleados = filas.length;
  const totalOrdinario = filas.reduce((s, f) => s + (f.salarioOrdinario || 0), 0);
  const totalExtraordinario = filas.reduce((s, f) => s + (f.salarioExtraordinario || 0), 0);
  const totalDeducciones = filas.reduce((s, f) => s + (f.totalDeducciones || 0), 0);

  return (
    <div className="pr-page">

      {/* ── Top bar (hidden on print) ── */}
      <div className="pr-topbar no-print">
        <button className="pr-btn-back" onClick={() => navigate('/hr/planilla/fijo')}>
          <FiArrowLeft size={16} /> Volver
        </button>
        <span className="pr-topbar-title">Reporte de Planilla — {periodoLabel}</span>
        <button className="pr-btn-print" onClick={handlePrint}>
          <FiPrinter size={16} /> Imprimir / PDF
        </button>
      </div>

      <div className="pr-layout">

        {/* ══ PANEL EDITOR (hidden on print) ══ */}
        <aside className="pr-editor no-print">
          <section className="pr-editor-section">
            <h3>Datos de la organización</h3>
            <div className="pr-field">
              <label>Nombre de la empresa</label>
              <input value={empresa} onChange={e => setEmpresa(e.target.value)} placeholder="Finca Aurora" />
            </div>
            <div className="pr-field">
              <label>Cédula jurídica / RUC</label>
              <input value={cedJuridica} onChange={e => setCedJuridica(e.target.value)} placeholder="3-101-XXXXXX" />
            </div>
            <div className="pr-field">
              <label>Dirección</label>
              <input value={direccion} onChange={e => setDireccion(e.target.value)} placeholder="San José, Costa Rica" />
            </div>
            <div className="pr-field">
              <label>Teléfono</label>
              <input value={telefono} onChange={e => setTelefono(e.target.value)} placeholder="2222-2222" />
            </div>
          </section>

          <section className="pr-editor-section">
            <h3>Responsable</h3>
            <div className="pr-field">
              <label>Elaborado por</label>
              <input value={elaboradoPor} onChange={e => setElaboradoPor(e.target.value)} placeholder="Nombre completo" />
            </div>
          </section>

          <section className="pr-editor-section">
            <h3>Notas / Observaciones</h3>
            <textarea
              rows={4}
              value={notas}
              onChange={e => setNotas(e.target.value)}
              placeholder="Observaciones generales de esta planilla…"
            />
          </section>
        </aside>

        {/* ══ DOCUMENT ══ */}
        <div className="pr-doc-wrap">
          <div className="pr-document">

            {/* ── Encabezado ── */}
            <div className="pr-doc-header">
              <div className="pr-doc-brand">
                <div className="pr-doc-logo">AU</div>
                <div className="pr-doc-brand-info">
                  <div className="pr-doc-brand-name">{empresa.toUpperCase()}</div>
                  {cedJuridica && <div className="pr-doc-brand-sub">Céd. Jurídica: {cedJuridica}</div>}
                  <div className="pr-doc-brand-sub">{direccion}{telefono ? ` · Tel: ${telefono}` : ''}</div>
                </div>
              </div>
              <div className="pr-doc-title-block">
                <div className="pr-doc-title">PLANILLA DE SALARIOS</div>
                <table className="pr-doc-meta-table">
                  <tbody>
                    <tr><td>N°:</td><td><strong>{reportNumber}</strong></td></tr>
                    <tr><td>Emisión:</td><td><strong>{fechaEmision}</strong></td></tr>
                    <tr><td>Período:</td><td><strong>{periodoLabel}</strong></td></tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* ── Bloque de período ── */}
            <div className="pr-doc-periodo">
              <div className="pr-doc-periodo-item">
                <span className="pr-doc-periodo-label">Fecha inicio</span>
                <span className="pr-doc-periodo-val">{fmtDateLong(periodoInicio)}</span>
              </div>
              <div className="pr-doc-periodo-item">
                <span className="pr-doc-periodo-label">Fecha fin</span>
                <span className="pr-doc-periodo-val">{fmtDateLong(periodoFin)}</span>
              </div>
              <div className="pr-doc-periodo-item">
                <span className="pr-doc-periodo-label">Total empleados</span>
                <span className="pr-doc-periodo-val">{totalEmpleados}</span>
              </div>
              {elaboradoPor && (
                <div className="pr-doc-periodo-item">
                  <span className="pr-doc-periodo-label">Elaborado por</span>
                  <span className="pr-doc-periodo-val">{elaboradoPor}</span>
                </div>
              )}
            </div>

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

            {/* ── Resumen de deducciones ── */}
            <div className="pr-doc-ded-note">
              <strong>Nota:</strong> Las deducciones incluyen Seguro Social (CCSS) del empleado al {(CCSS_RATE * 100).toFixed(2)}% sobre el salario bruto, más cualquier deducción adicional configurada por empleado.
            </div>

            {/* ── Notas ── */}
            {notas && (
              <div className="pr-doc-notes">
                <strong>Observaciones:</strong> {notas}
              </div>
            )}

            {/* ── Firmas ── */}
            <div className="pr-doc-signatures">
              <div className="pr-sig">
                <div className="pr-sig-line" />
                <div className="pr-sig-role">Elaborado por</div>
                {elaboradoPor && <div className="pr-sig-name">{elaboradoPor}</div>}
              </div>
              <div className="pr-sig">
                <div className="pr-sig-line" />
                <div className="pr-sig-role">Revisado por</div>
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
    </div>
  );
}
