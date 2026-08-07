# `/api/_health` — probe de salud

Endpoint público de salud del backend ([functions/routes/health.js](../functions/routes/health.js)).
Es el instrumento para verificar deploys, el cutover de dominio y la
recuperación post-restore — **si entendés qué prueba y qué no**.

## Contrato

`GET https://aurora-7dc9b.web.app/api/_health` — sin auth, sin App Check,
sin rate limit. Payload de **exactamente cuatro campos** (es público por
definición; todo lo demás queda afuera a propósito):

```json
{
  "status": "ok",            // "ok" | "degraded"
  "db": "auroradatabase",    // databaseId apuntado, o "error" si Firestore no responde
  "time": "2026-08-07T18:00:00.000Z",
  "revision": "api-00042-abc" // K_REVISION de Cloud Run; "unknown" fuera de Cloud Run
}
```

HTTP 200 cuando Firestore responde; 503 cuando no (`status: "degraded"`,
`db: "error"`).

- **`db` es la verificación barata del repunte.** Tras un restore
  ([firestore-backups.md](firestore-backups.md) §2.3), `db` debe mostrar la
  base nueva. Y si algún día muestra algo inesperado, recordá el fallo
  silencioso: un backend apuntado a `(default)` responde 200 con listas
  vacías en toda la API.
- **`revision` confirma que el deploy que creés que está vivo, está vivo.**

## Configurar el uptime check — content matcher OBLIGATORIO

Hosting reescribe `**` a `/index.html`. Si la reescritura de `/api/**` se
rompe, `GET /api/_health` devuelve **200 con el HTML del SPA** — un check
que solo mira el código de estado te dice que todo está bien mientras la API
entera está caída.

Cloud Monitoring → Uptime check:

- URL: `https://aurora-7dc9b.web.app/api/_health` (tras el cutover, el
  dominio nuevo — y mantené un check sobre el viejo durante la transición)
- **Content matching**: la respuesta debe contener `"db": "auroradatabase"`
  (o `"status": "ok"`) — cualquier string que el HTML del SPA jamás contenga.
- Frecuencia: 60s está bien — el probe cuesta ~1 lectura de Firestore por
  request (~1.4k reads/día).

## Qué NO prueba un health verde — leer antes del cutover

`/api/_health` está **fuera de App Check** (en `PUBLIC_PATHS` de
[lib/appcheck.js](../functions/lib/appcheck.js)), a propósito: el probe de
un uptime checker no puede mintear tokens de reCAPTCHA.

La consecuencia: **el modo de fallo más probable del cutover — dominio nuevo
sin registrar en reCAPTCHA Enterprise — da health verde y aplicación
muerta.** Todos los endpoints reales rechazan con 401 mientras el probe
sigue reportando `ok`.

Verificación de cutover completa, en orden:

1. `/api/_health` verde en el dominio nuevo → Hosting + rewrite + función +
   Firestore OK.
2. Login real en el dominio nuevo y una lectura autenticada (p.ej. abrir
   `/tasks`) → App Check + Auth OK. **Esto no lo cubre el health y no hay
   atajo.**

## Por qué no tiene rate limit

Deliberado, no un olvido: el limitador del repo hace una transacción de
Firestore por request — más caro que el probe que pretende proteger — y
falla en abierto, así que tampoco protege. El endpoint no lee input del
cliente y responde un objeto fijo; el riesgo de abuso es costo de reads, ya
acotado por ser la lectura más barata posible.
