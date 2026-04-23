# Roles personalizados — Ruta A (restricción por módulo)

## Qué hace

Permite que un miembro de una finca vea/acceda SOLO a ciertos módulos del
sidebar, sin cambiar el sistema de niveles (`trabajador` → `administrador`)
que sigue rigiendo los permisos dentro de cada módulo.

Ejemplo: un "encargado de muestreo" con rol `encargado` y
`restrictedTo: ['monitoreo']` — el sidebar solo le muestra el módulo
*Monitoreo* y el backend rechaza cualquier petición a otros módulos.

## Modelo de datos

Campo opcional en la colección `memberships`:

```
memberships/{id} = {
  uid, fincaId, nombre, email, telefono, rol,
  restrictedTo: ['monitoreo']   // ← nuevo, opcional
}
```

Semántica:
- **Ausente** o **`[]`** → sin restricción, el usuario ve todos los módulos
  que su rol le permita (comportamiento actual).
- **Array de módulo ids** → el usuario solo ve esos módulos.

Los ids válidos corresponden a `MODULES[].id` en
[src/components/Sidebar.jsx](../src/components/Sidebar.jsx):

| Id | Nombre en sidebar |
|---|---|
| `campo` | Operaciones de Campo |
| `bodega` | Bodega |
| `rrhh` | Recursos Humanos |
| `monitoreo` | Monitoreo |
| `contabilidad` | Contabilidad y Finanzas |
| `estrategia` | Estrategia |
| `admin` | Administración del Sistema |

## Dónde se aplica

**Backend** — [functions/lib/middleware.js](../functions/lib/middleware.js):
después de validar la membresía, si hay `restrictedTo` no vacío el
middleware pide a [functions/lib/moduleMap.js](../functions/lib/moduleMap.js)
que clasifique el path. Si pertenece a un módulo fuera de la lista → `403
You do not have access to this module.`

**Frontend** — [src/components/Sidebar.jsx](../src/components/Sidebar.jsx):
filtra `MODULES` por `currentUser.restrictedTo`. También filtra favoritos
y recientes para que una ruta fijada previamente no aparezca si el módulo
dueño está restringido.

## Paths siempre permitidos

Independientemente del `restrictedTo`, estos prefijos están abiertos para
que la experiencia básica funcione:

- `/api/auth/*` — perfil, membresías, claim de invitaciones
- `/api/feed` — feed del dashboard
- `/api/tasks` — lista de tareas del usuario
- `/api/reminders` — recordatorios
- `/api/webpush` — push notifications
- `/api/chat` — asistente conversacional

Si en el futuro agregas un endpoint que debería ser público para todos los
miembros restringidos, añádelo a `PUBLIC_PREFIXES` en `moduleMap.js`.

## Cómo asignar `restrictedTo` hoy (modo temporal)

Mientras no hay UI administrativa, se hace desde la consola de Firestore:

1. https://console.firebase.google.com/project/aurora-7dc9b/firestore/databases/-default-/data
2. Selecciona base de datos **`auroradatabase`**.
3. Colección `memberships` → busca el doc del usuario (por `uid` + `fincaId`).
4. *Add field* → nombre `restrictedTo`, tipo **array**, valores strings con
   los ids de módulos (`"monitoreo"`, etc.).
5. Pedir al usuario que cierre sesión y vuelva a entrar — el
   `currentUser` se recarga en cada login.

## Modo no estricto (`STRICT = false`)

Si un path no está mapeado en `MODULE_PREFIXES`, el middleware **permite**
la request y loguea un warning. Esto evita que un endpoint nuevo se
olvide del mapeo y bloquee a usuarios legítimos.

Una vez verifiques en logs (`firebase functions:log --only api | grep
restrictedTo`) que no aparecen warnings `unmapped path`, puedes cambiar
`STRICT = true` en [functions/lib/moduleMap.js](../functions/lib/moduleMap.js)
para que paths no clasificados se rechacen por default.

## Fuera de alcance (siguientes PRs)

- **UI administrativa** para setear `restrictedTo` desde la página de
  gestión de usuarios (multi-select de módulos). Hoy es manual vía
  Firestore Console.
- **Filtrar `/api/tasks`** para que un usuario restringido solo vea las
  tareas asignadas a él, no todas las de la finca. Por ahora la lista
  está abierta (es un endpoint público en el mapeo), pero un usuario
  restringido podría ver tareas de módulos que no puede abrir.
- **Permisos granulares por acción** (Ruta B) — ej: "puede ver compras
  pero no aprobarlas". Requiere migración completa del sistema de
  niveles a RBAC.
