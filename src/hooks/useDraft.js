import { useState, useEffect } from 'react';

/**
 * useDraft — like useState but persists to sessionStorage (default) or localStorage.
 * Session drafts survive SPA navigation but are cleared on tab close.
 * Persistent drafts (storage: 'local') survive page refreshes and tab closes.
 *
 * @param {string} key                        Unique key for this draft (e.g. 'oc-nueva')
 * @param {*}      initial                    Initial value if no draft exists
 * @param {object} [opts]
 * @param {'session'|'local'} [opts.storage]  Storage backend (default: 'session')
 * @returns [value, setter, clearDraft]
 */
export function useDraft(key, initial, { storage = 'session' } = {}) {
  const storageKey = `aurora_draft_${key}`;
  const store = storage === 'local' ? localStorage : sessionStorage;

  const resolve = (v) => (typeof v === 'function' ? v() : v);

  const [state, setState] = useState(() => {
    try {
      const raw = store.getItem(storageKey);
      return raw ? JSON.parse(raw) : resolve(initial);
    } catch {
      return resolve(initial);
    }
  });

  useEffect(() => {
    try {
      store.setItem(storageKey, JSON.stringify(state));
    } catch {}
  }, [storageKey, state]); // eslint-disable-line react-hooks/exhaustive-deps

  const clearDraft = () => {
    try { store.removeItem(storageKey); } catch {}
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

/** Remove every aurora_draft_* key from both storages — called on logout. */
export function clearAllDrafts() {
  try {
    const clearStore = (store) => {
      Object.keys(store)
        .filter(k => k.startsWith('aurora_draft_') || k.startsWith('aurora_draftActive_'))
        .forEach(k => store.removeItem(k));
    };
    clearStore(sessionStorage);
    clearStore(localStorage);
    window.dispatchEvent(new CustomEvent('aurora-draft-change'));
  } catch {}
}
