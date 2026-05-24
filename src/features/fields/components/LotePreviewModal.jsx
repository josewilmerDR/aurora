import { useMemo, useRef, Fragment } from 'react';
import { createPortal } from 'react-dom';
import { FiArrowLeft, FiShare2, FiPrinter } from 'react-icons/fi';
import { formatDateLong } from '../lib/lotes-helpers';

/**
 * LotePreviewModal — vista imprimible / PDF de un lote y sus bloques.
 *
 * Antes era un bloque inline al final de LoteManagement (~140 LOC entre
 * useMemo, handler de PDF y JSX). Extraído para mantener la página dentro
 * del límite de 600 LOC de docs/code-standards.md y para que la lógica de
 * impresión viva con su markup.
 *
 * El parent decide cuándo está abierto: lo renderiza condicionalmente
 * cuando `lote` está seteado. Las dependencias pesadas (html2canvas, jsPDF)
 * se importan dinámicamente al primer click de "Compartir" — no entran en
 * el bundle inicial.
 *
 * Props:
 *   - lote          object · el lote a previsualizar
 *   - loteTableRows array  · filas ya computadas { grupo, bloque, ha, ... }
 *                            (el parent las tiene en useMemo, evitamos
 *                            recomputar acá)
 *   - packages      array  · catálogo de paquetes (para mostrar nombre del
 *                            paquete técnico asignado al lote)
 *   - empresaConfig object · branding del documento (logo, nombre, etc.)
 *   - onClose       fn     · cerrar el modal
 *   - onShareError  fn     · invocado si la generación de PDF falla — el
 *                            parent decide cómo notificar (toast, banner)
 */
export default function LotePreviewModal({
  lote,
  loteTableRows,
  packages,
  empresaConfig,
  onClose,
  onShareError,
}) {
  const docRef = useRef(null);

  // Mismo cómputo que tenía LoteManagement, ahora memoizado solo cuando el
  // modal está montado. Agrupa por grupo, ordena por código alfanumérico
  // ("L2" antes que "L10") y calcula subtotales para el footer del PDF.
  const previewGrouped = useMemo(() => {
    const map = new Map();
    for (const row of loteTableRows) {
      if (!map.has(row.grupo)) map.set(row.grupo, []);
      map.get(row.grupo).push(row);
    }
    return [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b, 'es', { numeric: true }))
      .map(([grupo, rows]) => ({
        grupo,
        rows: [...rows].sort((a, b) => (a.bloque || '').localeCompare(b.bloque || '', 'es', { numeric: true })),
        totalHa:      rows.reduce((s, b) => s + (b.ha || 0), 0),
        totalPlantas: rows.reduce((s, b) => s + (b.plantas || 0), 0),
      }));
  }, [loteTableRows]);

  const pvTotalHa      = previewGrouped.reduce((s, g) => s + g.totalHa, 0);
  const pvTotalPlantas = previewGrouped.reduce((s, g) => s + g.totalPlantas, 0);

  const pkg = packages.find(p => p.id === lote.paqueteId);

  const handleCompartir = async () => {
    if (!docRef.current) return;
    try {
      // Imports dinámicos: html2canvas + jsPDF pesan ~500kb juntos y solo
      // se necesitan cuando el usuario explícitamente comparte. Sin esto,
      // toda finca paga el costo aunque jamás imprima un lote.
      const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([
        import('html2canvas'),
        import('jspdf'),
      ]);
      const canvas  = await html2canvas(docRef.current, { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
      const imgData = canvas.toDataURL('image/png');
      const pdf     = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
      const pageW   = pdf.internal.pageSize.getWidth();
      const pageH   = pdf.internal.pageSize.getHeight();
      const imgH    = (canvas.height * pageW) / canvas.width;
      let y = 0;
      while (y < imgH) {
        if (y > 0) pdf.addPage();
        pdf.addImage(imgData, 'PNG', 0, -y, pageW, imgH);
        y += pageH;
      }
      const filename = `Lote-${lote?.codigoLote || 'doc'}.pdf`;
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
        <span className="gp-preview-toolbar-title">Lote — {lote.codigoLote}</span>
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
            <div className="gp-doc-grupo-title">
              LOTE: {lote.codigoLote}
              {lote.nombreLote && lote.nombreLote !== lote.codigoLote && ` — ${lote.nombreLote}`}
            </div>
            <div className="gp-doc-grupo-meta">
              <span><strong>Fecha de siembra:</strong> {formatDateLong(lote.fechaCreacion)}</span>
              {lote.hectareas && <span><strong>Hectáreas:</strong> {lote.hectareas} ha</span>}
              {pkg && (
                <span><strong>Paquete técnico:</strong> {pkg.nombrePaquete}</span>
              )}
            </div>
          </div>

          <table className="gp-doc-table">
            <thead>
              <tr>
                <th>Grupo</th>
                <th>Bloque</th>
                <th className="gp-col-num">Ha.</th>
                <th className="gp-col-num">Plantas</th>
                <th>Material</th>
              </tr>
            </thead>
            <tbody>
              {previewGrouped.length === 0 && (
                <tr><td colSpan={5} style={{ textAlign: 'center', padding: '12px', color: '#999' }}>Sin bloques</td></tr>
              )}
              {previewGrouped.map(({ grupo, rows, totalHa, totalPlantas }) => (
                <Fragment key={grupo}>
                  {rows.map(b => (
                    <tr key={b.id}>
                      <td>{b.grupo}</td>
                      <td>{b.bloque}</td>
                      <td className="gp-col-num">{b.ha ? b.ha.toFixed(4) : '—'}</td>
                      <td className="gp-col-num">{b.plantas?.toLocaleString() ?? '—'}</td>
                      <td>{b.material || '—'}</td>
                    </tr>
                  ))}
                  <tr className="gp-doc-subtotal-row">
                    <td className="gp-doc-subtotal-label">{grupo}</td>
                    <td />
                    <td className="gp-col-num">{totalHa.toFixed(4)}</td>
                    <td className="gp-col-num">{totalPlantas.toLocaleString()}</td>
                    <td />
                  </tr>
                </Fragment>
              ))}
            </tbody>
            {previewGrouped.length > 0 && (
              <tfoot>
                <tr>
                  <td colSpan={2}><strong>Totales</strong></td>
                  <td className="gp-col-num"><strong>{pvTotalHa.toFixed(4)}</strong></td>
                  <td className="gp-col-num"><strong>{pvTotalPlantas.toLocaleString()}</strong></td>
                  <td />
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
