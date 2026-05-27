import { useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { FiArrowLeft, FiShare2, FiPrinter } from 'react-icons/fi';
import { formatDateLong, tsToDate } from '../lib/lotes-helpers';
import { consolidateSiembrasByBloque, calcFechaCosecha, getKgPorPlanta } from '../lib/grupo-bloques-helpers';
// Chrome del modal + estilos del documento imprimible. Compartido con
// LotePreviewModal. Importado acá para que la dependencia viaje con el
// componente, no con la página que lo monta.
import '../styles/document-preview.css';

/**
 * GrupoPreviewModal — vista imprimible / PDF de un grupo y sus bloques.
 *
 * Extraído de GrupoManagement.jsx como parte del refactor del #12. Antes
 * eran ~120 LOC inline (handleCompartir + 4 useMemo + JSX del modal). El
 * parent ahora monta condicionalmente y no sabe nada de la lógica de PDF.
 *
 * Las dependencias pesadas (html2canvas, jsPDF) se importan dinámicamente
 * al primer click de "Compartir" — no entran en el bundle inicial.
 *
 * Props:
 *   - grupo          object · el grupo a previsualizar
 *   - siembrasById   Map    · índice id → siembra (el parent ya lo tiene
 *                              memoizado para el hub, evitamos recomputarlo)
 *   - empresaConfig  object · branding del documento (logo, nombre, etc.)
 *                              + parámetros de calcFechaCosecha
 *   - onClose        fn     · cerrar el modal
 *   - onShareError   fn     · invocado si la generación de PDF falla — el
 *                              parent decide cómo notificar (toast)
 */
export default function GrupoPreviewModal({
  grupo,
  siembrasById,
  empresaConfig,
  onClose,
  onShareError,
}) {
  const docRef = useRef(null);

  const bloques = useMemo(() => {
    const owned = (grupo.bloques || [])
      .map(id => siembrasById.get(id))
      .filter(Boolean);
    return consolidateSiembrasByBloque(owned);
  }, [grupo, siembrasById]);

  const fechaCreacion = tsToDate(grupo.fechaCreacion);
  // Si /api/config no cargó (allSettled silenciosamente lo permite) el
  // cálculo cae a defaults 150/215/250 sin avisar. En el PDF, que se
  // comparte y se imprime, no queremos mostrar una fecha "autoritativa"
  // derivada de defaults — el lector externo no tiene cómo saberlo. La
  // ocultamos via la rama '—' del render. GrupoHub sí muestra el badge
  // con tooltip porque el usuario ve la atenuación en pantalla.
  const configLoaded  = !!empresaConfig?.id;
  const fechaCosecha  = configLoaded ? calcFechaCosecha(grupo, empresaConfig) : null;

  const totalHa      = bloques.reduce((s, b) => s + (parseFloat(b.areaCalculada) || 0), 0);
  const totalPlantas = bloques.reduce((s, b) => s + (b.plantas || 0), 0);
  const kgPorPlanta  = getKgPorPlanta(empresaConfig);
  const totalKg      = totalPlantas * kgPorPlanta;

  const handleCompartir = async () => {
    if (!docRef.current) return;
    try {
      // Imports dinámicos: html2canvas + jsPDF pesan ~500kb juntos y solo
      // se necesitan cuando el usuario explícitamente comparte. Sin esto,
      // toda finca paga el costo aunque jamás imprima un grupo.
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
      const filename = `Grupo-${grupo?.nombreGrupo || 'doc'}.pdf`;
      const blob     = pdf.output('blob');
      const file     = new File([blob], filename, { type: 'application/pdf' });
      if (navigator.canShare?.({ files: [file] })) {
        try { await navigator.share({ files: [file], title: filename }); } catch {}
      } else {
        const url = URL.createObjectURL(blob);
        const a   = document.createElement('a');
        a.href = url; a.download = filename; a.click();
        URL.revokeObjectURL(url);
      }
    } catch {
      onShareError?.();
    }
  };

  return createPortal(
    <div className="gp-preview-backdrop">

      <div className="gp-preview-toolbar">
        <button className="aur-chip gp-toolbar-icon-btn" onClick={onClose}>
          <FiArrowLeft size={15} /> <span className="gp-toolbar-btn-text">Volver</span>
        </button>
        <span className="gp-preview-toolbar-title">Grupo — {grupo.nombreGrupo}</span>
        <div className="gp-preview-toolbar-actions">
          <button className="aur-chip gp-toolbar-icon-btn" onClick={handleCompartir}>
            <FiShare2 size={15} /> <span className="gp-toolbar-btn-text">Compartir</span>
          </button>
          <button className="aur-chip gp-toolbar-icon-btn" onClick={() => window.print()}>
            <FiPrinter size={15} /> <span className="gp-toolbar-btn-text">Imprimir</span>
          </button>
        </div>
      </div>

      <div className="gp-doc-wrap">
        <div className="gp-document" ref={docRef}>

          <div className="gp-doc-header">
            <div className="gp-doc-brand">
              {empresaConfig.logoUrl
                ? <img src={empresaConfig.logoUrl} alt="Logo" className="gp-doc-logo-img" />
                : <div className="gp-doc-logo">AU</div>}
              <div className="gp-doc-brand-info">
                <div className="gp-doc-brand-name">{empresaConfig.nombreEmpresa || 'Finca Aurora'}</div>
                {empresaConfig.identificacion && <div className="gp-doc-brand-sub">Cédula: {empresaConfig.identificacion}</div>}
                {empresaConfig.whatsapp       && <div className="gp-doc-brand-sub">Tel: {empresaConfig.whatsapp}</div>}
                {empresaConfig.correo         && <div className="gp-doc-brand-sub">{empresaConfig.correo}</div>}
                {empresaConfig.direccion      && <div className="gp-doc-brand-sub">{empresaConfig.direccion}</div>}
              </div>
            </div>
            <div className="gp-doc-date">
              Fecha: <strong>{formatDateLong(new Date())}</strong>
            </div>
          </div>

          <hr className="gp-doc-divider" />

          <div className="gp-doc-grupo-info">
            <div className="gp-doc-grupo-title">GRUPO: {grupo.nombreGrupo}</div>
            <div className="gp-doc-grupo-meta">
              <span><strong>Fecha de creación:</strong> {formatDateLong(fechaCreacion)}</span>
              <span><strong>Fecha estimada de cosecha:</strong> {fechaCosecha ? formatDateLong(fechaCosecha) : '—'}</span>
              {(grupo.cosecha || grupo.etapa) && (
                <span><strong>Cosecha / Etapa:</strong> {[grupo.cosecha, grupo.etapa].filter(Boolean).join(' · ')}</span>
              )}
            </div>
          </div>

          <table className="gp-doc-table">
            <thead>
              <tr>
                <th>Lote</th>
                <th>Bloque</th>
                <th className="gp-col-num">Ha.</th>
                <th className="gp-col-num">Plantas</th>
                <th>Material</th>
                <th className="gp-col-num">Kg Estimados</th>
              </tr>
            </thead>
            <tbody>
              {bloques.length === 0 && (
                <tr><td colSpan={6} style={{ textAlign: 'center', padding: '12px', color: '#999' }}>Sin bloques</td></tr>
              )}
              {bloques.map(b => (
                <tr key={b.id}>
                  <td>{b.loteNombre || '—'}</td>
                  <td>{b.bloque || '—'}</td>
                  <td className="gp-col-num">{b.areaCalculada ?? '—'}</td>
                  <td className="gp-col-num">{b.plantas?.toLocaleString() ?? '—'}</td>
                  <td>{b.materialNombre || b.variedad || '—'}</td>
                  <td className="gp-col-num">{b.plantas ? (b.plantas * kgPorPlanta).toLocaleString('es-CR', { maximumFractionDigits: 0 }) : '—'}</td>
                </tr>
              ))}
            </tbody>
            {bloques.length > 0 && (
              <tfoot>
                <tr>
                  <td colSpan={2}><strong>Totales</strong></td>
                  <td className="gp-col-num"><strong>{totalHa.toFixed(4)}</strong></td>
                  <td className="gp-col-num"><strong>{totalPlantas.toLocaleString()}</strong></td>
                  <td></td>
                  <td className="gp-col-num"><strong>{totalKg.toLocaleString('es-CR', { maximumFractionDigits: 0 })}</strong></td>
                </tr>
              </tfoot>
            )}
          </table>

          <div className="gp-doc-footer">
            Documento generado por Sistema Aurora
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
