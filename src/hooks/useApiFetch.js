import { useCallback } from 'react';
import { useUser } from '../contexts/UserContext';
import { apiFetch } from '../lib/apiFetch';

/**
 * Hook que devuelve una función fetch pre-configurada con el token
 * y el fincaId activo del usuario en sesión.
 *
 * Uso en componentes:
 *   const apiFetch = useApiFetch();
 *   const res = await apiFetch('/api/lotes');
 */
export function useApiFetch() {
  const { activeFincaId } = useUser();
  return useCallback(
    (url, options) => apiFetch(url, options, activeFincaId),
    [activeFincaId]
  );
}
