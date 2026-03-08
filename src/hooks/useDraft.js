import { useState, useEffect } from 'react';

/**
 * useDraft — like useState but persists to sessionStorage.
 * Draft survives page navigation but is cleared on logout or tab close.
 *
 * @param {string} key       Unique key for this draft (e.g. 'oc-nueva')
 * @param {*}      initial   Initial value if no draft exists
 * @returns [value, setter, clearDraft]
 */
export function useDraft(key, initial) {
  const storageKey = `aurora_draft_${key}`;

  const resolve = (v) => (typeof v === 'function' ? v() : v);

  const [state, setState] = useState(() => {
    try {
      const raw = sessionStorage.getItem(storageKey);
      return raw ? JSON.parse(raw) : resolve(initial);
    } catch {
      return resolve(initial);
    }
  });

  useEffect(() => {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(state));
    } catch {}
  }, [storageKey, state]);

  const clearDraft = () => {
    try { sessionStorage.removeItem(storageKey); } catch {}
    setState(resolve(initial));
  };

  return [state, setState, clearDraft];
}

/** Mark a form as having in-progress content. */
export function markDraftActive(formKey) {
  try {
    sessionStorage.setItem(`aurora_draftActive_${formKey}`, '1');
    window.dispatchEvent(new CustomEvent('aurora-draft-change'));
  } catch {}
}

/** Clear the active flag for a form. */
export function clearDraftActive(formKey) {
  try {
    sessionStorage.removeItem(`aurora_draftActive_${formKey}`);
    window.dispatchEvent(new CustomEvent('aurora-draft-change'));
  } catch {}
}

/** Remove every aurora_draft_* key — called on logout. */
export function clearAllDrafts() {
  try {
    Object.keys(sessionStorage)
      .filter(k => k.startsWith('aurora_draft_') || k.startsWith('aurora_draftActive_'))
      .forEach(k => sessionStorage.removeItem(k));
    window.dispatchEvent(new CustomEvent('aurora-draft-change'));
  } catch {}
}
