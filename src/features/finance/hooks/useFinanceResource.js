import { useCallback, useEffect, useState } from 'react';
import { useApiFetch } from '../../../hooks/useApiFetch';

/**
 * useFinanceResource — fetch GET con manejo correcto de errores HTTP y retry.
 *
 * Reemplaza el patrón `apiFetch(url).then(r => r.json()).then(setData)` que
 * vivía repetido en cada widget del dashboard y que NO chequeaba `r.ok`: un
 * 403/500 resolvía la promesa, el body de error se seteaba como `data` y el
 * widget renderizaba un "empty state" (o crasheaba) en lugar de mostrar el
 * error real. Acá un status no-2xx va a la rama `error`.
 *
 * Devuelve `{ data, loading, error, reload }`. `reload()` re-dispara el fetch
 * (lo usa el botón "Reintentar" de WidgetError).
 *
 * @param {string|null} url  endpoint a consultar; `null` deshabilita el fetch.
 * @param {object}  opts
 * @param {string}  opts.errorMessage  mensaje user-facing en caso de fallo.
 */
export function useFinanceResource(url, { errorMessage = 'No se pudo cargar la información.' } = {}) {
  const apiFetch = useApiFetch();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // Cada reload incrementa este nonce para re-ejecutar el effect.
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => {
    setError(null);
    setLoading(true);
    setNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!url) return undefined;
    let cancelled = false;
    apiFetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setError(errorMessage); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [apiFetch, url, nonce, errorMessage]);

  return { data, loading, error, reload };
}
