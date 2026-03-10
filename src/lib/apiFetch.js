import { auth } from '../firebase';

/**
 * Wrapper de fetch que agrega automáticamente el token de Firebase Auth
 * y el header X-Finca-Id a todas las peticiones a la API.
 *
 * Uso: const res = await apiFetch('/api/lotes', { method: 'POST', body: JSON.stringify(data) }, fincaId);
 */
export async function apiFetch(url, options = {}, fincaId) {
  const user = auth.currentUser;
  const token = user ? await user.getIdToken() : null;

  const headers = {
    ...(options.body !== undefined && { 'Content-Type': 'application/json' }),
    ...(token && { Authorization: `Bearer ${token}` }),
    ...(fincaId && { 'X-Finca-Id': fincaId }),
    ...options.headers,
  };

  return fetch(url, { ...options, headers });
}
