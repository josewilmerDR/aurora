import { auth } from '../firebase';
import { translateApiError } from './errorMessages';

/**
 * Fetch wrapper that automatically attaches the Firebase Auth token and the
 * X-Finca-Id header to every request.
 *
 * Usage: const res = await apiFetch('/api/lotes', { method: 'POST', body: JSON.stringify(data) }, fincaId);
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

  return fetch(url, { cache: 'no-store', ...options, headers });
}

/**
 * Like apiFetch, but parses the JSON response and returns a discriminated result:
 *   { ok: true, data }              on 2xx
 *   { ok: false, status, error }    on non-2xx (error is a Spanish user-facing message)
 *
 * Use this in components that need to display errors to the user. The raw
 * apiFetch is still available for callers that need to stream or inspect the
 * response manually.
 */
export async function apiFetchJson(url, options = {}, fincaId) {
  let res;
  try {
    res = await apiFetch(url, options, fincaId);
  } catch (err) {
    return { ok: false, status: 0, error: translateApiError(null), networkError: err };
  }

  let body = null;
  try {
    body = await res.json();
  } catch {
    // Empty or non-JSON body — acceptable for 204 etc.
  }

  if (res.ok) {
    return { ok: true, data: body };
  }
  return { ok: false, status: res.status, error: translateApiError(body), body };
}
