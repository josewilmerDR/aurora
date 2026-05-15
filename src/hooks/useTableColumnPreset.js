import { useCallback, useEffect, useMemo, useState } from 'react';

/**
 * useTableColumnPreset — manage table column visibility with three modes
 * (compact / full / custom) and persist the user's choice to localStorage.
 *
 * Built for tables that today render every column by default and overwhelm
 * the user (Ingresos, Centro de Costos, etc.). The pattern is: ship a
 * compact preset (5-ish columns) by default, let the user expand to full,
 * and remember their choice per (storageKey + user).
 *
 * Modes:
 *   - 'compact' → only columns whose ids are in `compactColumnIds`
 *   - 'full'    → every column from `allColumns`
 *   - 'custom'  → arbitrary subset chosen by the user (via toggleColumn);
 *                  switching to compact/full discards the custom subset.
 *
 * Storage shape (one localStorage key per storageKey):
 *   { mode: 'compact'|'full'|'custom', customIds?: string[] }
 *
 * @param {Array<{id: string, ...}>} allColumns  Full column definitions.
 *                                                Order is preserved in the
 *                                                returned visibleColumns.
 * @param {string[]} compactColumnIds            Ids that make up the compact
 *                                                preset. Order does NOT matter
 *                                                — output order follows
 *                                                allColumns.
 * @param {string}   storageKey                   localStorage key. Conventionally
 *                                                `aurora_<page>_columns_${uid}`.
 * @param {object}  [opts]
 * @param {'compact'|'full'} [opts.defaultMode]  Mode used when no preference
 *                                                has been saved yet (default:
 *                                                'compact').
 *
 * @returns {{
 *   visibleColumns: typeof allColumns,
 *   visibleIds: Set<string>,
 *   mode: 'compact'|'full'|'custom',
 *   setMode: (m: 'compact'|'full') => void,
 *   toggleColumn: (id: string) => void,
 *   isVisible: (id: string) => boolean,
 *   isCompact: boolean,
 *   isFull: boolean,
 *   isCustom: boolean,
 *   reset: () => void,
 * }}
 *
 * @example
 *   const COLUMNS = [
 *     { id: 'fecha', label: 'Fecha' },
 *     { id: 'comprador', label: 'Comprador' },
 *     // ...
 *   ];
 *   const COMPACT = ['fecha', 'comprador', 'lote', 'monto', 'estado'];
 *
 *   const { visibleColumns, mode, setMode, toggleColumn, isVisible } =
 *     useTableColumnPreset(COLUMNS, COMPACT, `aurora_income_cols_${uid}`);
 */
export function useTableColumnPreset(
  allColumns,
  compactColumnIds,
  storageKey,
  { defaultMode = 'compact' } = {}
) {
  const compactSet = useMemo(() => new Set(compactColumnIds), [compactColumnIds]);
  const allIds = useMemo(() => allColumns.map((c) => c.id), [allColumns]);

  // Read saved preference once at mount. We intentionally don't react to
  // storageKey changes — switching keys mid-life would be an antipattern
  // (e.g. user logout flow should remount).
  const [state, setState] = useState(() => {
    const initial = { mode: defaultMode, customIds: null };
    if (!storageKey || typeof window === 'undefined') return initial;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) return initial;
      const parsed = JSON.parse(raw);
      const mode = ['compact', 'full', 'custom'].includes(parsed?.mode)
        ? parsed.mode
        : defaultMode;
      const customIds = Array.isArray(parsed?.customIds) ? parsed.customIds : null;
      return { mode, customIds };
    } catch {
      return initial;
    }
  });

  // Persist on change. Wrapped in try/catch so a quota error doesn't crash.
  useEffect(() => {
    if (!storageKey || typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(state));
    } catch {
      /* ignore storage failures (private mode, quota, etc.) */
    }
  }, [storageKey, state]);

  // Resolve which column ids should be visible, given current mode.
  const visibleIds = useMemo(() => {
    if (state.mode === 'full') return new Set(allIds);
    if (state.mode === 'custom' && state.customIds?.length) {
      // Filter custom ids by the current allColumns to drop stale ids that
      // existed in a previous version of the table definition.
      const valid = state.customIds.filter((id) => allIds.includes(id));
      return new Set(valid.length ? valid : compactColumnIds);
    }
    // 'compact' (or 'custom' with empty list, treated as compact)
    return new Set(compactColumnIds);
  }, [state, allIds, compactColumnIds]);

  // Visible columns preserve allColumns order.
  const visibleColumns = useMemo(
    () => allColumns.filter((c) => visibleIds.has(c.id)),
    [allColumns, visibleIds]
  );

  const setMode = useCallback((mode) => {
    if (mode !== 'compact' && mode !== 'full') return;
    setState({ mode, customIds: null });
  }, []);

  const toggleColumn = useCallback(
    (id) => {
      if (!allIds.includes(id)) return;
      setState((prev) => {
        // Resolve the current visible set deterministically from prev mode.
        let currentIds;
        if (prev.mode === 'full') currentIds = new Set(allIds);
        else if (prev.mode === 'custom' && prev.customIds?.length) {
          currentIds = new Set(prev.customIds.filter((x) => allIds.includes(x)));
        } else {
          currentIds = new Set(compactColumnIds);
        }
        if (currentIds.has(id)) currentIds.delete(id);
        else currentIds.add(id);
        // Preserve allColumns order in the persisted list.
        const ordered = allIds.filter((x) => currentIds.has(x));
        return { mode: 'custom', customIds: ordered };
      });
    },
    [allIds, compactColumnIds]
  );

  const isVisible = useCallback((id) => visibleIds.has(id), [visibleIds]);

  const reset = useCallback(() => {
    setState({ mode: defaultMode, customIds: null });
  }, [defaultMode]);

  return {
    visibleColumns,
    visibleIds,
    mode: state.mode,
    setMode,
    toggleColumn,
    isVisible,
    isCompact: state.mode === 'compact',
    isFull: state.mode === 'full',
    isCustom: state.mode === 'custom',
    reset,
  };
}
