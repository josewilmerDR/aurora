// Helpers para el estado del onboarding del Dashboard.
// Persistimos en localStorage por uid:
//   - aurora_onboarding_visited_${uid}     → JSON {chat?, bulkUpload?, inviteUser?}
//   - aurora_onboarding_completed_${uid}   → 'true' una vez alcanzado 100% (sticky)
//   - aurora_onboarding_first_view_${uid}  → 'true' cuando el usuario cierra el
//     render inline en el Dashboard. Hasta entonces, el onboarding aparece como
//     una card al final del Dashboard; tras cerrarlo se vuelve FAB minimizado.

const VISITED_KEY        = (uid) => `aurora_onboarding_visited_${uid}`;
const COMPLETED_KEY      = (uid) => `aurora_onboarding_completed_${uid}`;
const FIRST_VIEW_KEY     = (uid) => `aurora_onboarding_first_view_${uid}`;

function safeRead(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function safeWrite(key, value) {
  try { localStorage.setItem(key, value); } catch { /* ignore */ }
}

export function getVisited(uid) {
  const raw = safeRead(VISITED_KEY(uid));
  if (!raw) return {};
  try { return JSON.parse(raw) || {}; } catch { return {}; }
}

export function markVisited(uid, key) {
  if (!uid || !key) return;
  const current = getVisited(uid);
  if (current[key]) return;
  safeWrite(VISITED_KEY(uid), JSON.stringify({ ...current, [key]: true }));
  // Notifica al hook que se montó el badge global para refrescar el progreso
  // sin recargar la app. El evento storage no dispara en la misma pestaña.
  try {
    window.dispatchEvent(new CustomEvent('aurora:onboarding-refresh'));
  } catch { /* SSR / entornos sin window */ }
}

export function isCompletedSticky(uid) {
  return safeRead(COMPLETED_KEY(uid)) === 'true';
}

export function setCompletedSticky(uid) {
  safeWrite(COMPLETED_KEY(uid), 'true');
}

export function isFirstViewDismissed(uid) {
  return safeRead(FIRST_VIEW_KEY(uid)) === 'true';
}

export function setFirstViewDismissed(uid) {
  if (!uid) return;
  safeWrite(FIRST_VIEW_KEY(uid), 'true');
  try {
    window.dispatchEvent(new CustomEvent('aurora:onboarding-refresh'));
  } catch { /* SSR / entornos sin window */ }
}
