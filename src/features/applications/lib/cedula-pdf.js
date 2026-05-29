// ═══════════════════════════════════════════════════════════════════════════
// CEDULA-PDF — helper compartido para generar y compartir el PDF de una cédula
//
// Antes esta lógica vivía duplicada en CedulasAplicacion.handleShare (~50 LOC)
// y CedulaViewer.handleShare (~50 LOC) con dos divergencias menores: el listing
// loggeaba en consola, el viewer no; los nombres de archivo se construían
// desde campos distintos (activityName vs consecutivo). Cualquier evolución
// del flujo (cambio de DPI, soporte de orientación, fallback offline) tenía
// que tocarse en dos lugares.
//
// La función es agnóstica del shape de cédula — recibe el DOM node y un raw
// para el filename. El caller decide si guardea contra doble-tap (CedulaViewer
// sí, listing no) y cómo notifica error (toast en ambos).
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Sanitiza un raw string a un nombre de archivo seguro multiplataforma.
 * Reemplaza no-alfanuméricos/espacios/guiones por `_` y trunca a 64 chars
 * (el límite es para evitar paths excesivos en Windows / Android viejo;
 * algunos browsers truncan silenciosamente más largo, lo cual confunde).
 */
export function sanitizeCedulaFilename(raw, { prefix = 'Cedula' } = {}) {
  const base = String(raw || 'cedula');
  const safe = base.replace(/[^\w\s-]/g, '_').replace(/\s+/g, '_').slice(0, 64);
  return `${prefix}-${safe}.pdf`;
}

/**
 * Renderiza el `node` a un PDF A4 portrait (scale 2, fondo blanco) y dispara
 * la hoja de compartir nativa si está disponible, o un download como fallback.
 *
 *   - El blob URL se revoca inmediatamente después del .click() — el browser
 *     ya tiene la referencia y un setTimeout(1000) pisaba el download a medio
 *     en mobile con CPU lenta.
 *   - navigator.share rechaza con AbortError cuando el usuario cancela la
 *     hoja nativa: esa rama no es un error y se silencia explícitamente.
 *   - Errores reales (html2canvas + CORS del logo, jsPDF en mobile viejo,
 *     dynamic import offline) se re-throwean para que el caller decida
 *     entre log + toast / solo toast.
 *
 * @param {Object} params
 * @param {HTMLElement} params.node — referencia DOM a renderizar (docRef.current)
 * @param {string} params.filenameRaw — string usado para construir el filename
 *   (activityName del listing, consecutivo del viewer)
 * @returns {Promise<void>}
 */
export async function generateAndShareCedulaPdf({ node, filenameRaw }) {
  if (!node) throw new Error('cedula-pdf: node es requerido');
  const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([
    import('html2canvas'),
    import('jspdf'),
  ]);
  const canvas  = await html2canvas(node, { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
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
  const filename = sanitizeCedulaFilename(filenameRaw);
  const blob = pdf.output('blob');
  const file = new File([blob], filename, { type: 'application/pdf' });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: filename }); } catch {}
  } else {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  }
}
