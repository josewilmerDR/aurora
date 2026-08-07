# Respaldos de Firestore y ensayo de restauración

Runbook operativo de la base `auroradatabase` (proyecto `aurora-7dc9b`).
Cubre: qué protección está activa, cómo restaurar de verdad, qué NO cubre un
restore, y el ensayo (drill) que convierte los respaldos en respaldos de verdad.

> **Contexto de código.** El backend selecciona la base con
> `process.env.FIRESTORE_DATABASE_ID || 'auroradatabase'`
> ([functions/lib/firebase.js](../functions/lib/firebase.js)). El literal como
> respaldo del `||` no es decorativo: `getFirestore(app, undefined)` **no
> lanza** — devuelve un handle a la base `(default)`, que existe y está vacía.
> El backend arranca sano, responde 200 a todo, devuelve listas vacías y
> escribe ahí. Es indistinguible de "se borraron todos los datos". Nunca dejar
> el env a secas; el test `tests/unit/firebase.databaseId.test.js` lo guarda.

## 1. Protección activa (configurada por consola — "día cero")

Dos capas complementarias:

| Capa | Qué cubre | Ventana |
|---|---|---|
| PITR (point-in-time recovery) | Borrado/corrupción reciente, con granularidad de 1 minuto | 7 días hacia atrás **desde que se activó** — no cubre hacia atrás los días que estuvo apagada |
| Backups programados diarios | Desastre mayor, borrado detectado tarde | Retención 7 días |

Comandos (idempotentes — sirven para verificar o re-aplicar):

```bash
# 0. Locación de la base — BLOQUEANTE para elegir bucket de export:
#    un bucket en otra región falla con un error oscuro ~20 min después.
gcloud firestore databases describe \
  --database=auroradatabase --project=aurora-7dc9b

# 1. PITR
gcloud firestore databases update \
  --database=auroradatabase --project=aurora-7dc9b --enable-pitr

# 2. Backup diario, retención 7 días
gcloud firestore backups schedules create \
  --database=auroradatabase --project=aurora-7dc9b \
  --recurrence=daily --retention=7d

# Verificación
gcloud firestore backups schedules list \
  --database=auroradatabase --project=aurora-7dc9b
gcloud firestore backups list --project=aurora-7dc9b
```

### Bucket de export (si se usa `gcloud firestore export`)

**Nunca `gs://aurora-7dc9b.appspot.com`.** Ese bucket tiene los uploads de
usuarios y assets servidos por capability URL; un volcado completo de la base
ahí es la base entera dentro de un bucket con superficie pública. Usar un
bucket dedicado, en la **misma locación que la base** (ver comando 0), con
acceso restringido:

```bash
gsutil mb -p aurora-7dc9b -l <LOCACION_DE_LA_BASE> -b on gs://aurora-7dc9b-firestore-backups
```

## 2. Restaurar — cómo funciona de verdad

**Una restauración no se hace encima.** Firestore siempre restaura a una base
**nueva** y falla si el destino ya existe. Recuperarse no es "apretar restore":
es restaurar a una base nueva y repuntar la app. Cualquier procedimiento que
no diga esto es fantasía.

### 2.1 Restaurar desde backup

```bash
gcloud firestore backups list --project=aurora-7dc9b   # elegir BACKUP_ID
gcloud firestore databases restore \
  --project=aurora-7dc9b \
  --source-backup=<BACKUP_ID> \
  --destination-database=auroradatabase-restored
```

### 2.2 Restaurar un punto en el tiempo (PITR)

```bash
gcloud firestore databases clone \
  --project=aurora-7dc9b \
  --source-database=auroradatabase \
  --snapshot-time=<TIMESTAMP_RFC3339> \
  --destination-database=auroradatabase-restored
```

### 2.3 Repuntar la app a la base restaurada

1. **Backend**: setear `FIRESTORE_DATABASE_ID=auroradatabase-restored` en el
   entorno de las functions (`functions/.env` para deploy, `functions/.env.local`
   para emulador) y redesplegar: `npm run deploy:functions`.
2. **Índices**: los targets de deploy fijan el nombre de la base en
   [firebase.json](../firebase.json) (`"database": "auroradatabase"`) y en los
   scripts `deploy:indexes`/`deploy:rules` de [package.json](../package.json).
   Para una base con otro nombre hay que editar esos dos archivos (o renombrar
   la base restaurada al terminar el ciclo: borrar la vieja y restaurar de
   nuevo con el nombre canónico `auroradatabase`).
3. **Frontend**: [src/firebase.js](../src/firebase.js) también fija
   `auroradatabase`, pero hoy ningún componente consume ese handle de Firestore
   (todo pasa por `/api/*`); verificar que siga siendo cierto antes de omitirlo.

### 2.4 Lo que un restore NO cubre — tres brechas

1. **Firebase Auth.** Los usuarios viven en Identity Platform, no en Firestore.
   Sin ellos, `memberships` apunta a UIDs que no existen y **nadie entra**.
   Auth se respalda aparte:
   ```bash
   firebase auth:export auth-backup.json --project aurora-7dc9b
   ```
   (guardarlo en el bucket de backups, no en el repo — contiene hashes de
   contraseñas). Un desastre que borre Firestore normalmente no toca Auth,
   pero el runbook no puede asumirlo.
2. **Políticas TTL.** Se recrean a mano en la base nueva (consola → Firestore →
   TTL; las políticas activas están documentadas en
   [security-hardening.md](security-hardening.md)).
3. **Índices.** El estado canónico vive en
   [firestore.indexes.json](../firestore.indexes.json); redesplegarlos contra
   la base nueva (ver 2.3 punto 2) y esperar a que terminen de construirse
   antes de abrir tráfico — consultas con índice faltante fallan con
   `FAILED_PRECONDITION`.

## 3. El ensayo (drill)

Se ejecuta **una vez de punta a punta, cronometrado**. Ese número es el RTO
real; sin él, "tenemos respaldos" es una hipótesis.

1. `t0` — elegir el backup más reciente y lanzar el restore a
   `auroradatabase-drill` (§2.1).
2. Esperar a que la base quede `ACTIVE`
   (`gcloud firestore databases describe --database=auroradatabase-drill`).
3. Verificar contenido contra la base de prueba, sin tocar producción:
   arrancar el backend local apuntándola —
   `FIRESTORE_DATABASE_ID=auroradatabase-drill` (sin emulador de Firestore) —
   y comprobar que `/api/lotes`, `/api/tasks` y `/api/usuarios` devuelven los
   datos esperados; o revisar colecciones clave en la consola.
4. Recorrer las tres brechas de §2.4 y anotar qué haría falta en un incidente
   real (¿el export de Auth existe y es reciente? ¿TTL documentadas? ¿índices
   construidos?).
5. `t1` — registrar **RTO = t1 − t0** en la tabla de abajo.
6. **Borrar la base de prueba** — las bases extra facturan almacenamiento:
   ```bash
   gcloud firestore databases delete \
     --database=auroradatabase-drill --project=aurora-7dc9b
   ```

Repetir el drill tras cambios estructurales grandes (nuevas colecciones
críticas, cambio de locación, migraciones masivas) o al menos 1 vez por año.

### Registro de drills

| Fecha | Backup usado | RTO | Notas |
|---|---|---|---|
| _pendiente_ | | | Primer drill — ejecutar tras mergear este PR |
