import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { FiArrowLeft, FiShare2, FiPrinter, FiCheckCircle } from 'react-icons/fi';
import { useApiFetch } from '../hooks/useApiFetch';
import './CedulasAplicacion.css';
import './CedulaViewer.css';

const fmtDate = (iso) => {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-ES', {
    day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC',
  });
};

const fmtApplied = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

export default function CedulaViewer() {
  const { id } = useParams();
  const navigate = useNavigate();
  const apiFetch = useApiFetch();
  const docRef = useRef(null);

  const [cedula, setCedula]   = useState(null);
  const [config, setConfig]   = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  useEffect(() => {
    const load = async () => {
      try {
        const [cRes, cfRes] = await Promise.all([
          apiFetch(`/api/cedulas/${id}`),
          apiFetch('/api/config'),
        ]);
        if (!cRes.ok) { setError('Cédula no encontrada o sin acceso.'); return; }
        const [c, cf] = await Promise.all([cRes.json(), cfRes.json()]);
        setCedula(c);
        setConfig(cf || {});
      } catch {
        setError('Error al cargar la cédula.');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [id]);

  const handleShare = async () => {
    if (!docRef.current || !cedula) return;
    try {
      const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([
        import('html2canvas'),
        import('jspdf'),
      ]);
      const canvas  = await html2canvas(docRef.current, { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
      const imgData = canvas.toDataURL('image/png');
      const pdf     = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const pageW   = pdf.internal.pageSize.getWidth();
      const pageH   = pdf.internal.pageSize.getHeight();
      const imgH    = (canvas.height * pageW) / canvas.width;
      let y = 0;
      while (y < imgH) {
        if (y > 0) pdf.addPage();
        pdf.addImage(imgData, 'PNG', 0, -y, pageW, imgH);
        y += pageH;
      }
      const filename = `Cedula-${cedula.consecutivo || cedula.id}.pdf`;
      const blob = pdf.output('blob');
      const file = new File([blob], filename, { type: 'application/pdf' });
      if (navigator.canShare?.({ files: [file] })) {
        try { await navigator.share({ files: [file], title: filename }); } catch {}
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = filename; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch (e) {
      console.error('Error generando PDF:', e);
    }
  };

  if (loading) return (
    <div className="cedula-viewer-state">
      <span className="cedula-viewer-loading">Cargando cédula…</span>
    </div>
  );
  if (error) return (
    <div className="cedula-viewer-state">
      <span className="cedula-viewer-error">{error}</span>
      <button className="btn btn-secondary" onClick={() => navigate(-1)}>Volver</button>
    </div>
  );

  const cal          = cedula.calibracion        || null;
  const calAplicador = cedula.calibracionAplicador || null;
  const calTractor   = cedula.calibracionTractor   || null;
  const productos    = cedula.snap_productos || [];
  const bloques      = cedula.snap_bloques   || [];
  const areaHa       = parseFloat(cedula.snap_areaHa) || 0;

  return (
    <div className="cedula-viewer">

      {/* ── Toolbar ── */}
      <div className="ca-preview-toolbar cedula-viewer-toolbar">
        <button className="btn btn-secondary ca-toolbar-icon-btn cedula-viewer-back-btn" onClick={() => navigate(-1)}>
          <FiArrowLeft size={15} /> <span className="ca-toolbar-btn-text">Volver</span>
        </button>
        <div className="cedula-viewer-toolbar-info">
          <span className="ca-preview-toolbar-title">
            Cédula de Aplicación — {cedula.snap_activityName || '—'}
            <span className="ca-toolbar-consecutivo">{cedula.consecutivo}</span>
          </span>
          <span className="ca-toolbar-applied-badge">
            <FiCheckCircle size={14} /> Aplicada
          </span>
        </div>
        <div className="ca-preview-toolbar-actions">
          <button className="btn btn-secondary ca-toolbar-icon-btn" onClick={handleShare}>
            <FiShare2 size={15} /> <span className="ca-toolbar-btn-text">Compartir</span>
          </button>
          <button className="btn btn-secondary ca-toolbar-icon-btn" onClick={() => window.print()}>
            <FiPrinter size={15} /> <span className="ca-toolbar-btn-text">Imprimir</span>
          </button>
        </div>
      </div>

      {/* ── Documento ── */}
      <div className="ca-doc-wrap">
        <div className="ca-document" ref={docRef}>

          {/* Encabezado */}
          <div className="ca-doc-header">
            <div className="ca-doc-brand">
              {config.logoUrl
                ? <img src={config.logoUrl} alt="Logo" className="ca-doc-logo-img" />
                : <div className="ca-doc-logo">AU</div>
              }
              <div className="ca-doc-brand-info">
                <div className="ca-doc-brand-name">{config.nombreEmpresa || 'Finca Aurora'}</div>
                {config.identificacion && <div className="ca-doc-brand-sub">Cédula: {config.identificacion}</div>}
                {config.whatsapp      && <div className="ca-doc-brand-sub">Tel: {config.whatsapp}</div>}
                {config.correo        && <div className="ca-doc-brand-sub">{config.correo}</div>}
                {config.direccion     && <div className="ca-doc-brand-sub">{config.direccion}</div>}
              </div>
            </div>
            <div className="ca-doc-title-block">
              <div className="ca-doc-title">CÉDULA DE APLICACIÓN DE AGROQUÍMICOS</div>
              <div className="ca-doc-subtitle">Aplicación: {cedula.snap_activityName || '—'}</div>
              <div className="ca-doc-consecutivo">{cedula.consecutivo}</div>
            </div>
          </div>

          <hr className="ca-doc-divider" />

          {/* Datos generales */}
          <div className="ca-section-title ca-section-title--split">
            <span>Datos Generales</span>
            {cedula.snap_calibracionNombre && (
              <span className="ca-section-cal-name">Calibración: {cedula.snap_calibracionNombre}</span>
            )}
          </div>
          <div className="ca-datos-grid">

            {/* Columna 1 */}
            <div className="ca-dato ca-dato-col">
              <div className="ca-dato">
                <span className="ca-dato-label">F. Prog. Aplicación:</span>
                <span className="ca-dato-value">{fmtDate(cedula.snap_dueDate)}</span>
              </div>
              <div className="ca-dato">
                <span className="ca-dato-label">F. Prog. Cosecha:</span>
                <span className="ca-dato-value">{fmtDate(cedula.snap_fechaCosecha)}</span>
              </div>
              <div className="ca-dato">
                <span className="ca-dato-label">F. Creación de Grupo:</span>
                <span className="ca-dato-value">{fmtDate(cedula.snap_fechaCreacionGrupo)}</span>
              </div>
              <div className="ca-dato">
                <span className="ca-dato-label">Periodo de Carencia:</span>
                <span className="ca-dato-value">
                  {cedula.snap_periodoCarenciaMax > 0 ? `${cedula.snap_periodoCarenciaMax} días` : '—'}
                </span>
              </div>
              <div className="ca-dato">
                <span className="ca-dato-label">Periodo de Reingreso:</span>
                <span className="ca-dato-value">
                  {cedula.snap_periodoReingresoMax > 0 ? `${cedula.snap_periodoReingresoMax} h` : '—'}
                </span>
              </div>
              <div className="ca-dato">
                <span className="ca-dato-label">Método de Apl.:</span>
                <span className="ca-dato-value">{cedula.metodoAplicacion || cal?.metodo || '—'}</span>
              </div>
              {cedula.snap_paqueteTecnico && (
                <div className="ca-dato">
                  <span className="ca-dato-label">Paq. Téc.:</span>
                  <span className="ca-dato-value">{cedula.snap_paqueteTecnico}</span>
                </div>
              )}
            </div>

            {/* Columna 2 */}
            <div className="ca-dato ca-dato-col">
              <div className="ca-dato">
                <span className="ca-dato-label">Grupo:</span>
                <span className="ca-dato-value">{cedula.snap_sourceName || '—'}</span>
              </div>
              {(cedula.snap_cosecha || cedula.snap_etapa) && (
                <div className="ca-dato">
                  <span className="ca-dato-label">Etapa:</span>
                  <span className="ca-dato-value">
                    {[cedula.snap_cosecha, cedula.snap_etapa].filter(Boolean).join(' / ')}
                  </span>
                </div>
              )}
              <div className="ca-dato">
                <span className="ca-dato-label">Área (ha):</span>
                <span className="ca-dato-value">{areaHa > 0 ? areaHa.toFixed(2) : '—'}</span>
              </div>
              <div className="ca-dato">
                <span className="ca-dato-label">Total Plantas:</span>
                <span className="ca-dato-value">
                  {cedula.snap_totalPlantas ? Number(cedula.snap_totalPlantas).toLocaleString('es-ES') : '—'}
                </span>
              </div>
              <div className="ca-dato">
                <span className="ca-dato-label">Volumen (Lt/Ha):</span>
                <span className="ca-dato-value">{cedula.snap_volumenPorHa ?? cal?.volumen ?? '—'}</span>
              </div>
              <div className="ca-dato">
                <span className="ca-dato-label">Litros aplicador:</span>
                <span className="ca-dato-value">{cedula.snap_litrosAplicador ?? calAplicador?.capacidad ?? '—'}</span>
              </div>
              <div className="ca-dato">
                <span className="ca-dato-label">Total boones requeridos:</span>
                <span className="ca-dato-value">
                  {cedula.snap_totalBoones != null ? Number(cedula.snap_totalBoones).toFixed(2) : '—'}
                </span>
              </div>
            </div>

            {/* Columna 3: Calibración */}
            <div className="ca-dato ca-dato-col">
              <div className="ca-dato">
                <span className="ca-dato-label">Tractor:</span>
                <span className="ca-dato-value">{calTractor?.codigo || cal?.tractorNombre || '—'}</span>
              </div>
              <div className="ca-dato">
                <span className="ca-dato-label">Aplicador:</span>
                <span className="ca-dato-value">{calAplicador?.codigo || cal?.aplicadorNombre || '—'}</span>
              </div>
              <div className="ca-dato">
                <span className="ca-dato-label">RPM Recomendada:</span>
                <span className="ca-dato-value">{cal?.rpmRecomendado || '—'}</span>
              </div>
              <div className="ca-dato">
                <span className="ca-dato-label">Marcha Rec.:</span>
                <span className="ca-dato-value">{cal?.marchaRecomendada || '—'}</span>
              </div>
              <div className="ca-dato">
                <span className="ca-dato-label">Tipo Boq.:</span>
                <span className="ca-dato-value">{cal?.tipoBoquilla || '—'}</span>
              </div>
              <div className="ca-dato">
                <span className="ca-dato-label">Presión Recomendada:</span>
                <span className="ca-dato-value">{cal?.presionRecomendada || '—'}</span>
              </div>
              <div className="ca-dato">
                <span className="ca-dato-label">Km/H Recomendados:</span>
                <span className="ca-dato-value">{cal?.velocidadKmH || '—'}</span>
              </div>
            </div>
          </div>

          {/* Bloques */}
          {bloques.length > 0 && (
            <div className="ca-bloques-summary">
              {Object.entries(
                bloques.reduce((acc, b) => {
                  const lote = b.loteNombre || '—';
                  if (!acc[lote]) acc[lote] = [];
                  acc[lote].push(b.bloque || '—');
                  return acc;
                }, {})
              ).map(([lote, bs]) => (
                <div key={lote} className="ca-bloques-summary-row">
                  <span className="ca-bloques-label">Lote:</span>
                  <span className="ca-bloques-value">{lote}</span>
                  <span className="ca-bloques-label">Bloques:</span>
                  <span className="ca-bloques-value">
                    {[...bs].sort((a, b) => a.localeCompare(b, 'es', { numeric: true })).join(', ')}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Productos */}
          {productos.length === 0 ? (
            <p className="ca-empty-products">Sin productos registrados.</p>
          ) : (
            <table className="ca-doc-table">
              <thead>
                <tr>
                  <th>Id</th>
                  <th>Nombre Comercial — Ing. Activo</th>
                  <th className="ca-col-num">Per. Carencia</th>
                  <th className="ca-col-num">Per. Reing.</th>
                  <th className="ca-col-num">Cant./Ha</th>
                  <th className="ca-col-num">Boom</th>
                  <th className="ca-col-num">Fracción</th>
                  <th>Unidad</th>
                  <th className="ca-col-num">Total</th>
                </tr>
              </thead>
              <tbody>
                {productos.map((prod, i) => {
                  const nombreFull = [prod.nombreComercial, prod.ingredienteActivo].filter(Boolean).join(' — ') || '—';
                  return (
                    <tr key={prod.productoId || i}>
                      <td>{prod.idProducto || '—'}</td>
                      <td>{nombreFull}</td>
                      <td className="ca-col-num">{prod.periodoCarencia ?? '—'}</td>
                      <td className="ca-col-num">{prod.periodoReingreso ?? '—'}</td>
                      <td className="ca-col-num">{prod.cantidadPorHa ?? '—'}</td>
                      <td className="ca-col-num">{prod.cantBoom ?? '—'}</td>
                      <td className="ca-col-num">{prod.cantFraccion ?? '—'}</td>
                      <td>{prod.unidad || '—'}</td>
                      <td className="ca-col-num"><strong>{prod.total ?? '—'}</strong></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          {/* Nota de seguridad */}
          <div className="ca-doc-safety-note">
            No olvide usar el Equipo de Protección Personal durante la aplicación y de asegurarse del buen estado del mismo. No fume ni ingiera alimentos durante la aplicación. Recuerde no contaminar fuentes de agua con productos o envases vacíos.
          </div>

          {/* Sobrante + Condiciones */}
          <div className="ca-campo-data-row">
            <div className="ca-campo-item">
              <span className="ca-campo-label">Sobrante:</span>
              <span className="ca-campo-value">
                {cedula.sobrante === true ? 'Sí' : cedula.sobrante === false ? 'No' : '___'}
              </span>
            </div>
            {cedula.sobrante && (
              <div className="ca-campo-item">
                <span className="ca-campo-label">Depositado en:</span>
                <span className="ca-campo-value">{cedula.sobranteLoteNombre || '___________'}</span>
              </div>
            )}
          </div>
          <div className="ca-campo-data-row">
            <div className="ca-campo-item">
              <span className="ca-campo-label">Condiciones del tiempo:</span>
              <span className="ca-campo-value">{cedula.condicionesTiempo || '___________'}</span>
            </div>
            <div className="ca-campo-item">
              <span className="ca-campo-label">Temperatura:</span>
              <span className="ca-campo-value">
                {cedula.temperatura != null ? `${cedula.temperatura}°C` : '___'}
              </span>
            </div>
            <div className="ca-campo-item">
              <span className="ca-campo-label">% Humedad Relativa:</span>
              <span className="ca-campo-value">
                {cedula.humedadRelativa != null ? `${cedula.humedadRelativa}%` : '___'}
              </span>
            </div>
          </div>

          {/* Firma operarios */}
          <div className="ca-doc-sig-row">
            <div className="ca-sig-block">
              <div className="ca-sig-line ca-sig-line--prefilled">{fmtApplied(cedula.aplicadaAt)}</div>
              <div className="ca-sig-label">Fecha de Aplicación</div>
            </div>
            <div className="ca-sig-block">
              <div className="ca-sig-line ca-sig-line--prefilled">
                {(cedula.horaInicio || cedula.horaFinal)
                  ? [cedula.horaInicio || '___', cedula.horaFinal || '___'].join(' / ')
                  : null}
              </div>
              <div className="ca-sig-label">Hora Inicial / Hora Final</div>
            </div>
            <div className="ca-sig-block">
              <div className="ca-sig-line ca-sig-line--prefilled">{cedula.operario || null}</div>
              <div className="ca-sig-label">Operario</div>
            </div>
          </div>

          {/* Firmas responsables */}
          <div className="ca-doc-sig-row ca-doc-sig-final">
            <div className="ca-sig-block">
              <div className="ca-sig-line ca-sig-line--prefilled">{cedula.encargadoFinca || null}</div>
              <div className="ca-sig-label">Encargado de Finca</div>
            </div>
            <div className="ca-sig-block">
              <div className="ca-sig-line ca-sig-line--prefilled">
                {cedula.encargadoBodega || cedula.mezclaListaNombre || null}
              </div>
              <div className="ca-sig-label">Encargado de Bodega</div>
            </div>
            <div className="ca-sig-block">
              <div className="ca-sig-line ca-sig-line--prefilled">{cedula.supAplicaciones || null}</div>
              <div className="ca-sig-label">Sup. Aplicaciones / Regente</div>
            </div>
          </div>

          <div className="ca-doc-footer">
            Documento generado por Sistema Aurora · {new Date().toLocaleDateString('es-ES')}
          </div>
        </div>
      </div>
    </div>
  );
}
