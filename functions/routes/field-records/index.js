// Field-records — Aggregator del dominio (legacy `cedulas`).
//
// Resultado del split de routes/field-records.js (1193 LOC). El dominio
// modela cédulas de aplicación: instrucciones que el supervisor genera a
// partir de una scheduled_task (o manualmente), que un encargado prepara
// como mezcla, que un trabajador aplica en campo, y que pueden anularse.
//
// Sub-archivos por etapa del lifecycle de la cédula:
//   - helpers.js  — constantes, sanitizers, contadores, serializers, validators
//   - read.js     — GET /list, GET /:id (lectura)
//   - create.js   — POST / (desde tarea), POST /manual (sin tarea preexistente)
//   - mix.js      — PUT /mezcla-lista, /editar-productos (pendiente → en_transito)
//   - apply.js    — PUT /aplicada (en_transito → aplicada_en_campo, snapshot histórico)
//   - void.js     — PUT /anular (cualquier estado → anulada, con reversión de inventario)
//
// Cada sub-archivo expone su propio Router con paths absolutos /api/cedulas/*;
// este index los monta. functions/index.js requiere con
// `app.use(require('./routes/field-records'))` — Node resuelve el directorio
// y carga este index automáticamente.

const { Router } = require('express');

const readRouter   = require('./read');
const createRouter = require('./create');
const mixRouter    = require('./mix');
const applyRouter  = require('./apply');
const voidRouter   = require('./void');

const router = Router();

router.use(readRouter);
router.use(createRouter);
router.use(mixRouter);
router.use(applyRouter);
router.use(voidRouter);

module.exports = router;
