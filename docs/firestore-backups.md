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
| Backups programados diarios | Desastre mayor, borrado detectado tarde | Retención 30 días (schedule creado 2026-04-23; verificado 2026-08-22) |

Plus **delete protection** on the database (enabled 2026-08-22): a wrong
`gcloud firestore databases delete` no longer wipes production.

All three are applied by one idempotent script — use it on day zero, as a
periodic check, and after promoting a restored database (§2.4 item 4):

```bash
scripts/firestore-protect-db.sh            # auroradatabase / aurora-7dc9b
scripts/firestore-protect-db.sh <DB> <PROJECT>
```

Equivalent raw commands (idempotent — verify or re-apply):

```bash
# 0. Locación de la base — BLOQUEANTE para elegir bucket de export:
#    un bucket en otra región falla con un error oscuro ~20 min después.
gcloud firestore databases describe \
  --database=auroradatabase --project=aurora-7dc9b

# 1. PITR
gcloud firestore databases update \
  --database=auroradatabase --project=aurora-7dc9b --enable-pitr --delete-protection

# 2. Backup diario, retención 7 días
gcloud firestore backups schedules create \
  --database=auroradatabase --project=aurora-7dc9b \
  --recurrence=daily --retention=30d

# Verificación
gcloud firestore backups schedules list \
  --database=auroradatabase --project=aurora-7dc9b
gcloud firestore backups list --project=aurora-7dc9b
```

### Dedicated backups bucket — `gs://aurora-7dc9b-firestore-backups`

Created 2026-08-22 in **us-central1** (same location as the database — a
bucket in another region fails `gcloud firestore export` ~20 min later with
an obscure error). Uniform bucket-level access, public-access prevention
enforced, lifecycle rule deletes objects after **30 days**. It holds the
daily Auth exports (§2.4 item 1) and is the only valid destination for an
ad-hoc `gcloud firestore export`.

**Never `gs://aurora-7dc9b.firebasestorage.app`.** That bucket holds user
uploads and assets served by capability URL; a full database dump there is
the whole database inside a bucket with public surface.

IAM: the Cloud Functions service account
(`103051938438-compute@developer.gserviceaccount.com`) has
`roles/storage.objectCreator` on it — write-only, it cannot read or list the
exports. Re-create if ever lost:

```bash
gcloud storage buckets create gs://aurora-7dc9b-firestore-backups \
  --project=aurora-7dc9b --location=us-central1 \
  --uniform-bucket-level-access --public-access-prevention
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

1. **Firebase Auth.** Users live in Identity Platform, not Firestore. Without
   them `memberships` points at UIDs that do not exist and **nobody can log
   in**. Covered since 2026-08-22 by the scheduled function
   `authDailyExport` ([functions/scheduled/auth-export-cron.js](../functions/scheduled/auth-export-cron.js),
   logic in [functions/lib/authExport.js](../functions/lib/authExport.js)):
   every day at 04:00 America/Costa_Rica it writes
   `gs://aurora-7dc9b-firestore-backups/auth/auth-users-YYYY-MM-DD.json` in
   the `firebase auth:import` schema, password hashes included (the bucket
   lifecycle keeps 30 days). First export taken manually the same day
   (7 accounts). Manual equivalent, never into the repo:
   ```bash
   firebase auth:export auth-users.json --project aurora-7dc9b --format json
   gcloud storage cp auth-users.json gs://aurora-7dc9b-firestore-backups/auth/
   ```
   To restore users into a rebuilt project:
   ```bash
   gcloud storage cp gs://aurora-7dc9b-firestore-backups/auth/auth-users-<DATE>.json .
   firebase auth:import auth-users-<DATE>.json --project <PROJECT> \
     --hash-algo=SCRYPT --hash-key=<base64 signer key> \
     --salt-separator=<base64> --rounds=8 --mem-cost=14
   ```
   The hash parameters come from Firebase console → Authentication → Users →
   ⋮ → *Password hash parameters*. They are per project and are NOT in the
   export: copy them into the company password manager now, not during an
   incident. Without them the import still works but every password is
   invalid and users must reset.
2. **Políticas TTL.** Se recrean a mano en la base nueva (consola → Firestore →
   TTL; las políticas activas están documentadas en
   [security-hardening.md](security-hardening.md)).
3. **Índices.** El estado canónico vive en
   [firestore.indexes.json](../firestore.indexes.json). Drill 2026-08-22: a
   restore from a managed backup DID carry all 90 composite indexes to the new
   database (verified with `gcloud firestore indexes composite list` on both),
   so redeploying is a safety net, not a prerequisite. Still run
   `deploy:indexes` against the new database (see 2.3 point 2) and wait for
   any missing index to build before opening traffic — queries without their
   index fail with `FAILED_PRECONDITION`.
4. **PITR and delete protection are NOT inherited.** The restored database
   comes up with `POINT_IN_TIME_RECOVERY_DISABLED` and
   `DELETE_PROTECTION_DISABLED` (verified in the 2026-08-22 drill). The backup
   schedule is per-database too. After promoting a restored database run the
   protection script against it — it applies all three in one go:
   ```bash
   scripts/firestore-protect-db.sh <NEW_DB> aurora-7dc9b
   ```

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
| 2026-08-22 | `227a3c6f…` (snapshot 2026-08-22T08:54Z, daily schedule) | **10 min 02 s** to ACTIVE (t0 11:48:50Z → 11:58:52Z); 11 min 42 s end-to-end incl. verification and cleanup | Restored to `auroradatabase-drill` in us-central1. Verified via REST aggregation counts: 34/34 collections, 492/492 documents, zero per-collection differences; 90/90 composite indexes present. Gaps found and closed the same day: restored DB has PITR and delete protection OFF (→ `scripts/firestore-protect-db.sh`, §2.4 item 4); no Auth export and no dedicated bucket (→ bucket created + `authDailyExport` cron + first manual export of 7 accounts, §2.4 item 1); production had delete protection DISABLED (→ enabled). Still open: copy the password hash parameters to the password manager; deploy `authDailyExport` with the next functions deploy. Drill DB deleted at 12:00:32Z. |
