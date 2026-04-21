import { useCallback, useEffect, useRef, useState } from 'react';
import { useApiFetch } from './useApiFetch';

// Tiempo máximo de espera antes de abortar la llamada. Evita que una red
// degradada deje la UI colgada indefinidamente.
const FETCH_TIMEOUT_MS = 30000;

// Mensajes en español para cada categoría de falla. El detalle técnico
// (status, stack) va al console.error para debug — la UI recibe texto humano.
const ERROR_MESSAGES = {
  auth:    'Tu sesión expiró. Inicia sesión nuevamente.',
  server:  'El servidor no pudo procesar la solicitud. Intenta de nuevo.',
  client:  'La solicitud fue rechazada por el servidor.',
  timeout: 'La conexión tardó demasiado. Revisa tu red.',
  network: 'Sin conexión con el servidor.',
  invalid: 'La respuesta del servidor tiene un formato inesperado.',
};

function classifyError(err, status) {
  if (err?.isTimeout) return 'timeout';
  if (status === 401 || status === 403) return 'auth';
  if (typeof status === 'number' && status >= 500) return 'server';
  if (typeof status === 'number' && status >= 400) return 'client';
  if (err?.message === 'invalid_shape') return 'invalid';
  return 'network';
}

// Validación de forma. Evita que una respuesta rota reviente ProjectionChart
// o ProjectionTable al acceder a campos que no existen.
function isValidProjection(data) {
  if (!data || typeof data !== 'object') return false;
  if (!data.summary || typeof data.summary !== 'object') return false;
  if (!Array.isArray(data.series)) return false;
  if (data.series.length > 0) {
    const w = data.series[0];
    if (
      typeof w.weekStart !== 'string' ||
      typeof w.weekEnd !== 'string' ||
      typeof w.closingBalance !== 'number' ||
      !Array.isArray(w.inflows) ||
      !Array.isArray(w.outflows)
    ) return false;
  }
  return true;
}

export function useTreasuryProjection(weeks) {
  const apiFetch = useApiFetch();
  const [projection, setProjection] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    let timedOut = false;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, FETCH_TIMEOUT_MS);

    setLoading(true);
    setError(null);

    apiFetch(`/api/treasury/projection?weeks=${weeks}`, { signal: controller.signal })
      .then(async (r) => {
        if (!r.ok) {
          const err = new Error(`HTTP ${r.status}`);
          err.status = r.status;
          throw err;
        }
        return r.json();
      })
      .then((data) => {
        if (cancelled) return;
        if (!isValidProjection(data)) throw new Error('invalid_shape');
        setProjection(data);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err?.name === 'AbortError' && !timedOut) return;
        const decorated = timedOut ? Object.assign(err || new Error('timeout'), { isTimeout: true }) : err;
        const kind = classifyError(decorated, decorated?.status);
        console.error('[Treasury] projection fetch failed', { kind, status: decorated?.status, err: decorated });
        setProjection(null);
        setError({ kind, message: ERROR_MESSAGES[kind] });
      })
      .finally(() => {
        clearTimeout(timeoutId);
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
      controller.abort();
    };
  }, [apiFetch, weeks, reloadKey]);

  return { projection, loading, error, reload };
}

// Helper para guardar un saldo desde fuera del hook, con mount-awareness para
// evitar setState sobre componentes desmontados.
export function useIsMounted() {
  const ref = useRef(true);
  useEffect(() => {
    ref.current = true;
    return () => { ref.current = false; };
  }, []);
  return ref;
}
