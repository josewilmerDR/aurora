// Purga de la caché de respuestas de /api/* que mantiene el service worker.
//
// El SW cachea /api/* con NetworkFirst para lectura offline (ver src/sw.js).
// Esa caché sobrevive al cierre de sesión: sin purgarla, la persona que inicia
// sesión después en el mismo dispositivo —una tablet de campo compartida es el
// caso normal, no el excepcional— puede recibir desde caché datos de la sesión
// anterior. La clave de caché ya incluye el fincaId, así que dos inquilinos no
// colisionan; lo que esta purga cubre es el cambio de USUARIO, que la clave no
// distingue.
//
// Se llama en dos momentos (src/contexts/UserContext.jsx):
//   - logout()      → cambio de persona.
//   - selectFinca() → cambio de inquilino; redundante con la clave de caché,
//                     pero barato y deja el dispositivo limpio.
//
// Nunca lanza: una purga fallida no debe impedir cerrar sesión.

const API_CACHE_NAME = 'aurora-api-cache';

export async function purgeApiCache() {
  try {
    if (typeof caches === 'undefined') return false;
    return await caches.delete(API_CACHE_NAME);
  } catch {
    return false;
  }
}

export { API_CACHE_NAME };
