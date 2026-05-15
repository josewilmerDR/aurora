import { describe, test, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTableColumnPreset } from '../useTableColumnPreset';

const COLUMNS = [
  { id: 'a', label: 'A' },
  { id: 'b', label: 'B' },
  { id: 'c', label: 'C' },
  { id: 'd', label: 'D' },
  { id: 'e', label: 'E' },
];
const COMPACT = ['a', 'c', 'e'];
const KEY = 'aurora_test_columns_uid1';

beforeEach(() => {
  window.localStorage.clear();
});

describe('useTableColumnPreset', () => {
  test('default mode es compact y visibleColumns coincide con compactColumnIds', () => {
    const { result } = renderHook(() =>
      useTableColumnPreset(COLUMNS, COMPACT, KEY)
    );
    expect(result.current.isCompact).toBe(true);
    expect(result.current.visibleColumns.map((c) => c.id)).toEqual(['a', 'c', 'e']);
  });

  test('setMode("full") expone todas las columnas en orden de allColumns', () => {
    const { result } = renderHook(() =>
      useTableColumnPreset(COLUMNS, COMPACT, KEY)
    );
    act(() => result.current.setMode('full'));
    expect(result.current.isFull).toBe(true);
    expect(result.current.visibleColumns.map((c) => c.id)).toEqual([
      'a', 'b', 'c', 'd', 'e',
    ]);
  });

  test('toggleColumn agrega una columna oculta y cambia mode a custom', () => {
    const { result } = renderHook(() =>
      useTableColumnPreset(COLUMNS, COMPACT, KEY)
    );
    // 'b' no está en compact → toggling lo agrega
    act(() => result.current.toggleColumn('b'));
    expect(result.current.isCustom).toBe(true);
    expect(result.current.visibleColumns.map((c) => c.id)).toEqual([
      'a', 'b', 'c', 'e',
    ]);
  });

  test('toggleColumn quita una columna visible', () => {
    const { result } = renderHook(() =>
      useTableColumnPreset(COLUMNS, COMPACT, KEY)
    );
    act(() => result.current.toggleColumn('a'));
    expect(result.current.visibleColumns.map((c) => c.id)).toEqual(['c', 'e']);
  });

  test('persiste en localStorage y rehidrata en un siguiente render', () => {
    const { result, unmount } = renderHook(() =>
      useTableColumnPreset(COLUMNS, COMPACT, KEY)
    );
    act(() => result.current.toggleColumn('b'));
    unmount();

    const { result: result2 } = renderHook(() =>
      useTableColumnPreset(COLUMNS, COMPACT, KEY)
    );
    expect(result2.current.isCustom).toBe(true);
    expect(result2.current.visibleColumns.map((c) => c.id)).toEqual([
      'a', 'b', 'c', 'e',
    ]);
  });

  test('storage corrupto cae al default sin tirar', () => {
    window.localStorage.setItem(KEY, 'this is not json');
    const { result } = renderHook(() =>
      useTableColumnPreset(COLUMNS, COMPACT, KEY)
    );
    expect(result.current.isCompact).toBe(true);
  });

  test('ids stale en custom se filtran (definición de columnas cambió)', () => {
    // Simulamos que en una versión anterior 'z' era una columna válida.
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ mode: 'custom', customIds: ['a', 'z', 'c'] })
    );
    const { result } = renderHook(() =>
      useTableColumnPreset(COLUMNS, COMPACT, KEY)
    );
    // 'z' se filtra; quedan 'a' y 'c'.
    expect(result.current.visibleColumns.map((c) => c.id)).toEqual(['a', 'c']);
  });

  test('toggleColumn sobre id desconocido es no-op', () => {
    const { result } = renderHook(() =>
      useTableColumnPreset(COLUMNS, COMPACT, KEY)
    );
    act(() => result.current.toggleColumn('zzz'));
    expect(result.current.isCompact).toBe(true);
    expect(result.current.visibleColumns.map((c) => c.id)).toEqual(['a', 'c', 'e']);
  });

  test('reset() vuelve al modo default y limpia customIds', () => {
    const { result } = renderHook(() =>
      useTableColumnPreset(COLUMNS, COMPACT, KEY)
    );
    act(() => result.current.toggleColumn('b'));
    expect(result.current.isCustom).toBe(true);
    act(() => result.current.reset());
    expect(result.current.isCompact).toBe(true);
    expect(result.current.visibleColumns.map((c) => c.id)).toEqual(['a', 'c', 'e']);
  });

  test('opts.defaultMode="full" se respeta cuando no hay storage', () => {
    const { result } = renderHook(() =>
      useTableColumnPreset(COLUMNS, COMPACT, KEY, { defaultMode: 'full' })
    );
    expect(result.current.isFull).toBe(true);
  });

  test('isVisible refleja el set actual', () => {
    const { result } = renderHook(() =>
      useTableColumnPreset(COLUMNS, COMPACT, KEY)
    );
    expect(result.current.isVisible('a')).toBe(true);
    expect(result.current.isVisible('b')).toBe(false);
    act(() => result.current.setMode('full'));
    expect(result.current.isVisible('b')).toBe(true);
  });

  test('setMode con valor inválido es no-op', () => {
    const { result } = renderHook(() =>
      useTableColumnPreset(COLUMNS, COMPACT, KEY)
    );
    act(() => result.current.setMode('invalid'));
    expect(result.current.isCompact).toBe(true);
  });
});
