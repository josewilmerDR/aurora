// ═══════════════════════════════════════════════════════════════════════════
// PACKAGES — Draft persistence (localStorage)
//
// Helpers extraídos de PackageManagement.jsx (Fase B del refactor — ver
// docs/code-standards.md §9 para el límite de 600 LOC en React pages).
//
// Un solo slot global captura el form completo (incluye `id`), así que sirve
// tanto para crear como para editar: como solo hay un form abierto a la vez,
// no se pueden editar dos paquetes en paralelo. En la restauración usamos
// `id` para recuperar el modo (con id → editar; sin id → crear). Mismo
// patrón que MaquinariaList y Calibraciones.
// ═══════════════════════════════════════════════════════════════════════════

export const PKG_DRAFT_LS_KEY = 'aurora_draft_paquete';
export const PKG_DRAFT_SS_KEY = 'aurora_draftActive_paquete';

export function loadPackageDraft() {
  try { return JSON.parse(localStorage.getItem(PKG_DRAFT_LS_KEY)); } catch { return null; }
}

export function savePackageDraft(data) {
  try {
    localStorage.setItem(PKG_DRAFT_LS_KEY, JSON.stringify(data));
    sessionStorage.setItem(PKG_DRAFT_SS_KEY, '1');
    window.dispatchEvent(new CustomEvent('aurora-draft-change'));
  } catch {}
}

export function clearPackageDraft() {
  try {
    localStorage.removeItem(PKG_DRAFT_LS_KEY);
    sessionStorage.removeItem(PKG_DRAFT_SS_KEY);
    window.dispatchEvent(new CustomEvent('aurora-draft-change'));
  } catch {}
}

// "Significativo" = el borrador tiene al menos un campo o actividad con
// contenido real. Evitamos restaurar drafts vacíos (que crean ruido en el
// banner "Borrador restaurado").
export function isPackageDraftMeaningful(d) {
  if (!d) return false;
  if ((d.nombrePaquete || '').trim()) return true;
  if ((d.descripcion || '').trim()) return true;
  if (d.tipoCosecha) return true;
  if (d.etapaCultivo) return true;
  if (d.tecnicoResponsable) return true;
  return (d.activities || []).some(a =>
    (a?.name || '').trim() ||
    (a?.day !== '' && a?.day != null) ||
    a?.responsableId ||
    a?.calibracionId ||
    (a?.productos || []).length > 0
  );
}
