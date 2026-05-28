import { useState, useEffect, useRef } from 'react';
import { useApiFetch } from '../../../hooks/useApiFetch';
import { useUser } from '../../../contexts/UserContext';
import { readExcelRows } from '../lib/bulkImport';

// ─────────────────────────────────────────────────────────────────────────────
// useBulkImport — estado-máquina compartido de las tarjetas de carga masiva.
//
// Las 3 tarjetas (entidad genérica, Lotes-Grupos-Bloques, Empleados) repetían
// el mismo andamiaje: conteo cacheado por finca con flag "stale", lectura +
// parseo del archivo, preview de confirmación, commit con progreso y
// cancelación (AbortController), y el wiring del modal. Eso vive acá una sola
// vez; cada tarjeta sólo aporta su `parse` y su `commit`.
//
// Contrato:
//   countStorageKey : string base; se namespacea con el fincaId activo
//   loadCount(apiFetch) → valor a mostrar | null
//        · null/undefined  = no se pudo refrescar → badge "stale"
//        · cualquier valor JSON-serializable (number, {lotes,grupos}, …)
//   parse(rows) → { payload: Array, skipped: string[] }
//        · payload  = filas válidas a escribir; payload.length = filas válidas
//        · skipped  = motivos de filas descartadas (para el preview/resultado)
//        · throw Error  = fallo fatal de parseo (archivo ilegible, etc.)
//   commit({ payload, skipped, apiFetch, signal, setProgress })
//        → { didWrite, msg, warn }   éxito/parcial (warn = advertencias o null)
//        | { error: true, msg }      fracaso total
//   emptyMessage : texto cuando hay 0 válidas y 0 saltadas
// ─────────────────────────────────────────────────────────────────────────────
export function useBulkImport({ countStorageKey, loadCount, parse, commit, emptyMessage = 'El archivo no contiene filas de datos.' }) {
  const apiFetch = useApiFetch();
  const { activeFincaId } = useUser();
  const storageKey = `aurora_initsetup_count_${activeFincaId}_${countStorageKey}`;

  const [count, setCount] = useState(null);
  const [countStale, setCountStale] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [preview, setPreview] = useState(null); // { validCount, skipped }
  const [importResult, setImportResult] = useState(null);
  const [showNavPrompt, setShowNavPrompt] = useState(false);
  const fileInputRef = useRef(null);
  const abortRef = useRef(null);
  const pendingRef = useRef(null); // { payload, skipped } entre preview y commit

  // Refresh directo del conteo: distingue "no se pudo refrescar" (→ stale) de
  // "colección vacía", para no dejar un número viejo aparentando ser fresco.
  const refreshCount = async () => {
    try {
      const v = await loadCount(apiFetch);
      if (v === null || v === undefined) { setCountStale(true); return; }
      setCount(v);
      setCountStale(false);
      localStorage.setItem(storageKey, JSON.stringify(v));
    } catch { setCountStale(true); }
  };

  // Al montar y al cambiar de finca: muestro el cacheado de ESA finca al
  // instante y luego refresco. La key incluye fincaId → no se filtra entre fincas.
  useEffect(() => {
    const cached = localStorage.getItem(storageKey);
    try {
      setCount(cached !== null ? JSON.parse(cached) : null);
    } catch { setCount(null); }
    setCountStale(false);
    refreshCount();
  }, [activeFincaId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fase 1: leer + parsear el archivo y abrir el preview. No escribe nada.
  const onFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setParsing(true);
    setImportResult(null);
    setShowNavPrompt(false);
    try {
      const rows = await readExcelRows(file);
      const { payload, skipped } = parse(rows);
      if (!payload.length) {
        setImportResult({
          error: true,
          msg: skipped.length ? `Ninguna fila válida. ${skipped.slice(0, 3).join(' · ')}` : emptyMessage,
        });
        return;
      }
      pendingRef.current = { payload, skipped };
      setPreview({ validCount: payload.length, skipped });
    } catch (err) {
      setImportResult({ error: true, msg: err?.message || 'No se pudo leer el archivo. Usá la plantilla.' });
    } finally {
      setParsing(false);
      e.target.value = '';
    }
  };

  // Fase 2: confirmado el preview, ejecuta el commit con progreso y cancelación.
  const confirmImport = async () => {
    const pending = pendingRef.current;
    if (!pending) return;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setCommitting(true);
    setProgress({ done: 0, total: pending.payload.length });
    try {
      const res = await commit({
        payload: pending.payload,
        skipped: pending.skipped,
        apiFetch,
        signal: ctrl.signal,
        setProgress,
      });
      if (res?.error) {
        setImportResult({ error: true, msg: res.msg || 'No se creó ningún registro.' });
      } else {
        setImportResult({ ok: true, msg: res?.msg || 'Sin cambios nuevos.', warn: res?.warn || null });
        setShowNavPrompt(!!res?.didWrite);
        if (res?.didWrite) refreshCount();
      }
    } catch (err) {
      setImportResult({ error: true, msg: err?.message || 'Error inesperado al procesar el archivo.' });
    } finally {
      abortRef.current = null;
      pendingRef.current = null;
      setCommitting(false);
      setPreview(null);
    }
  };

  return {
    count,
    countStale,
    parsing,
    committing,
    progress,
    preview,
    importResult,
    showNavPrompt,
    fileInputRef,
    onImportClick: () => fileInputRef.current?.click(),
    onFileChange,
    confirmImport,
    cancelPreview: () => { pendingRef.current = null; setPreview(null); },
    abortCommit: () => abortRef.current?.abort(),
    dismissNav: () => setShowNavPrompt(false),
  };
}
