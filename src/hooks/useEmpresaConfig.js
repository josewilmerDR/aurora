// Hooks de identidad de empresa para documentos imprimibles.
//
// - useEmpresaIdentity(config): para páginas que YA tienen el doc de config
//   (fetch propio o prop) — aplica la cascada nombreEmpresa → fincaNombre y
//   el saneo de logo, memoizado.
// - useEmpresaConfig(): para páginas sin fetch de config — lo trae de
//   /api/config. Un 403 (rol < encargado) o error de red NO es fatal: la
//   cascada cae al nombre de la organización, que viaja en /api/auth/me
//   para cualquier rol.

import { useEffect, useMemo, useState } from 'react';
import { useApiFetch } from './useApiFetch';
import { useUser } from '../contexts/UserContext';
import { resolveEmpresa } from '../lib/empresa';

export function useEmpresaIdentity(config) {
  const { currentUser } = useUser();
  return useMemo(
    () => resolveEmpresa(config, currentUser?.fincaNombre || ''),
    [config, currentUser]
  );
}

export function useEmpresaConfig() {
  const apiFetch = useApiFetch();
  const [config, setConfig] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    apiFetch('/api/config')
      .then(r => (r.ok ? r.json() : {}))
      .then(data => { if (alive) setConfig(data && typeof data === 'object' ? data : {}); })
      .catch(() => {})
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [apiFetch]);

  const empresa = useEmpresaIdentity(config);
  return { empresa, loading };
}
