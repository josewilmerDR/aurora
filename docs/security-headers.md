# Cabeceras de seguridad (Firebase Hosting)

Se configuran en [firebase.json](../firebase.json), bloque `hosting.headers`, y
se aplican al servir el SPA. **No** cubren `/api/**`: esas respuestas las emite
la Cloud Function, y las cabeceras de Hosting no se agregan a un rewrite.

## Qué está en enforce

| Cabecera | Valor | Qué compra |
|---|---|---|
| `Cross-Origin-Opener-Policy` | `same-origin-allow-popups` | Aísla el contexto de navegación. `allow-popups` es obligatorio: el login con Google abre un popup y `same-origin` a secas lo rompe. |
| `X-Content-Type-Options` | `nosniff` | El navegador deja de adivinar el tipo de un recurso. Sin esto, un archivo subido que el servidor declara como texto puede ejecutarse como script. |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Deja de filtrar el path completo a terceros. Importa acá en concreto: el deep link de tarea lleva su token de capacidad en el query (`/task/:id?t=…`), y una política laxa lo mandaba en el `Referer` de cualquier recurso externo. |
| `X-Frame-Options` | `DENY` | Anti-clickjacking. Es el control **efectivo** hoy, porque el `frame-ancestors` del CSP está en report-only y no bloquea. |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` | Fuerza HTTPS por un año. **Sin `preload` a propósito**: el preload se pide para el apex (`comunplace.com`) y afectaría a todos sus subdominios, no solo a Aurora. Esa no es una decisión que se tome desde este repo. |
| `Permissions-Policy` | `microphone=(), payment=(), usb=(), magnetometer=()` | Apaga APIs que la app no usa. **No** se restringen `camera` ni `geolocation`: el escaneo de formularios y boletas depende de la cámara, y restringirlas por prolijidad rompería la captura en campo. |

## Por qué el CSP va en Report-Only

`Content-Security-Policy-Report-Only` reporta violaciones en la consola del
navegador **sin bloquear nada**. Es el mismo patrón de rollout que este
proyecto ya usa con `APP_CHECK_MODE` (`warn` → `enforce`), y por la misma
razón: un CSP mal calibrado no degrada, tumba. Rompe el login de Firebase, el
challenge de reCAPTCHA Enterprise que alimenta App Check, o la carga de
imágenes de Storage — y el síntoma es una pantalla en blanco.

La política actual permite lo que la app necesita de verdad:

- `script-src` incluye `gstatic.com`, `google.com` y `apis.google.com` — de ahí
  salen el SDK de reCAPTCHA Enterprise y el de Google Sign-In.
- `connect-src` incluye los hosts de Identity Toolkit, Secure Token, Firebase
  Installations y App Check; sin ellos no hay sesión.
- `img-src` incluye `blob:` y `data:` porque los escaneos se previsualizan
  desde memoria antes de subirse.

### Lo que falta para pasar a enforce

1. Desplegar y navegar la app completa —login, cambio de organización, escaneo
   de factura, escaneo de siembra, subida de imagen, push— con la consola
   abierta, anotando cada violación reportada.
2. Ajustar la política hasta que no reporte nada en un flujo limpio.
3. **Sacar `'unsafe-inline'` de `script-src`.** Hoy está porque
   [index.html](../index.html) tiene un `<script>` inline que aplica el tema
   antes del primer paint (para evitar el flash de tema equivocado). La salida
   correcta es moverlo a un archivo propio o firmarlo con un hash
   `sha256-…`; mientras `'unsafe-inline'` esté, el CSP no defiende contra XSS
   inyectado en el HTML, que es la mitad de su valor.
4. Recién ahí, renombrar la cabecera a `Content-Security-Policy`.

Mientras tanto el report-only no es decorativo: `X-Frame-Options`, `nosniff`,
`Referrer-Policy` y HSTS ya están bloqueando de verdad.

## Lo que deliberadamente no se hizo

- **CORS**: no se agrega. Sin cabeceras CORS el navegador ya bloquea las
  llamadas cross-origin, y App Check cubre a los clientes que no son
  navegadores. Agregar una política CORS solo abriría superficie que hoy no
  existe.
- **Cabeceras sobre `/api/**`**: quedan fuera del alcance de Hosting. Si en
  algún momento se quieren (por ejemplo `nosniff` en respuestas JSON), van como
  middleware de Express en `functions/index.js`, no acá.
