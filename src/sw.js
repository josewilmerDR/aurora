import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { NetworkFirst } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
import { CacheableResponsePlugin } from 'workbox-cacheable-response';

// Precaché de assets estáticos (inyectado por vite-plugin-pwa en el build)
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// Permite que la app dispare la activación del SW en espera
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

// API calls: NetworkFirst → intenta red, si falla usa caché (lectura offline)
//
// AISLAMIENTO DE INQUILINO — leer antes de tocar esta ruta:
// El inquilino viaja en el header `X-Finca-Id` y la identidad en
// `Authorization`, pero Workbox indexa la caché SOLO por URL. Sin el
// `cacheKeyWillBeUsed` de abajo, `/api/lotes` de la finca A y de la finca B
// son la MISMA entrada: un usuario con membresía en dos fincas (o dos personas
// compartiendo una tablet de campo) recibe datos del inquilino equivocado
// servidos desde caché. Y no es un caso raro: con networkTimeoutSeconds bajo,
// una conexión móvil lenta cae al fallback de caché todos los días.
//
// Dos controles, a propósito redundantes:
//   1. La clave de caché incluye el fincaId → dos inquilinos nunca colisionan.
//   2. La app purga `aurora-api-cache` al cerrar sesión y al cambiar de finca
//      (src/lib/apiCache.js). Esto cubre el cambio de USUARIO dentro de la
//      misma finca, que la clave por sí sola no distingue.
// El (1) además cubre la carrera del (2): un request en vuelo durante el
// cambio de finca no puede envenenar la entrada del inquilino nuevo.
//
// `statuses: [0, 200]` conserva las respuestas opacas para que la app siga
// funcionando offline detrás del proxy de Hosting; los 401/403 nunca se
// cachean, así que una sesión revocada no queda "pegada" en la caché.
const withFincaCacheKey = {
  cacheKeyWillBeUsed: async ({ request }) => {
    const fincaId = request.headers.get('X-Finca-Id') || 'no-finca';
    const url = new URL(request.url);
    url.searchParams.set('__finca', fincaId);
    return url.href;
  },
};

registerRoute(
  ({ url }) => url.pathname.startsWith('/api/'),
  new NetworkFirst({
    cacheName: 'aurora-api-cache',
    networkTimeoutSeconds: 5,
    plugins: [
      withFincaCacheKey,
      new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 60 * 60 * 2 }),
      new CacheableResponsePlugin({ statuses: [0, 200] }),
    ],
  })
);

// ── Web Push ──────────────────────────────────────────────────────────────────

self.addEventListener('push', (event) => {
  if (!event.data) return;
  let data;
  try { data = event.data.json(); } catch { return; }

  const { title = 'Aurora', body = '', icon = '/aurora-logo.png', badge = '/aurora-logo.png', data: notifData = {} } = data;

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon,
      badge,
      data: notifData,
      vibrate: [200, 100, 200],
      requireInteraction: false,
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          client.focus();
          client.navigate(url);
          return;
        }
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
