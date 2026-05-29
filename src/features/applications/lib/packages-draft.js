// ═══════════════════════════════════════════════════════════════════════════
// PACKAGES — Draft persistence (localStorage)
//
// Helpers extraídos de PackageManagement.jsx (Fase B del refactor — ver
// docs/code-standards.md §9 para el límite de 600 LOC en React pages).
//
// Un solo slot por usuario captura el form completo (incluye `id`), así que
// sirve tanto para crear como para editar: como solo hay un form abierto a la
// vez, no se pueden editar dos paquetes en paralelo. En la restauración usamos
// `id` para recuperar el modo (con id → editar; sin id → crear). Mismo
// patrón que MaquinariaList y Calibraciones.
//
// Scoping por usuario (audit seguridad applications): la KEY DE DATOS en
// localStorage se sufija con el uid (`aurora_draft_paquete-<uid>`) para que en
// un dispositivo de campo compartido el usuario B que entra no restaure el
// borrador del usuario A (recetas, técnico, actividades). loadPackageDraft lo
// restaura en mount sin mirar el flag de sesión, así que sin el sufijo el dato
// persistido cruzaba de usuario aun sin logout. El FLAG DE SESIÓN
// (PKG_DRAFT_SS_KEY) queda sin sufijo a propósito: es un booleano efímero en
// sessionStorage (se borra al cerrar el navegador y en logout vía
// clearAllDrafts) que solo alimenta el badge del Sidebar, el cual matchea el
// `draftKey: 'paquete'` literal. clearAllDrafts borra todo `aurora_draft_*`,
// así que la key sufijada también se limpia en logout.
// ═══════════════════════════════════════════════════════════════════════════

// Base del key de datos; el key real se sufija con el uid vía lsKey().
export const PKG_DRAFT_LS_KEY = 'aurora_draft_paquete';
export const PKG_DRAFT_SS_KEY = 'aurora_draftActive_paquete';

// 'anon' como fallback estable cuando el uid no está disponible (mismo patrón
// que el draft de cédulas). Mantiene save/load/clear apuntando al mismo slot.
const lsKey = (uid) => `${PKG_DRAFT_LS_KEY}-${uid || 'anon'}`;

export function loadPackageDraft(uid) {
  try { return JSON.parse(localStorage.getItem(lsKey(uid))); } catch { return null; }
}

export function savePackageDraft(data, uid) {
  try {
    localStorage.setItem(lsKey(uid), JSON.stringify(data));
    sessionStorage.setItem(PKG_DRAFT_SS_KEY, '1');
    window.dispatchEvent(new CustomEvent('aurora-draft-change'));
  } catch {}
}

export function clearPackageDraft(uid) {
  try {
    localStorage.removeItem(lsKey(uid));
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
