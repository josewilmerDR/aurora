// Router for Request-for-Quotation flow (procurement phase 2.3).

const { Router } = require('express');
const { authenticate } = require('../../lib/middleware');
const { rateLimit } = require('../../lib/rateLimit');
// RFQs: la UI las expone bajo /procurement, gateado a encargado. Las lecturas
// quedan en `authenticate`; todo lo que crea, cierra, responde o borra una
// solicitud de cotización se alinea a ese rol.
const { requireEncargado } = require('../../lib/guards');
const { listRfqs, getRfq, deleteRfq } = require('./crud');
const { createRfq } = require('./create');
const { recordRfqResponse } = require('./response');
const { closeRfq } = require('./close');

const router = Router();

router.get('/api/rfqs', authenticate, listRfqs);
router.post('/api/rfqs', authenticate, requireEncargado, rateLimit('rfqs_write', 'write'), createRfq);
router.get('/api/rfqs/:id', authenticate, getRfq);
router.delete('/api/rfqs/:id', authenticate, requireEncargado, rateLimit('rfqs_write', 'write'), deleteRfq);
router.post('/api/rfqs/:id/respuesta', authenticate, requireEncargado, rateLimit('rfqs_write', 'write'), recordRfqResponse);
// Tier ai_heavy, no 'write': cerrar una RFQ dispara reasonAboutRfqWinner, que
// llama a Claude con thinking habilitado y MAX_TOKENS_WITH_THINKING. Con el
// tier 'write' (120/min) el techo de gasto de este endpoint era ~120 llamadas
// razonadas por minuto y por usuario. El resto del CRUD de RFQ sí es 'write'.
router.post('/api/rfqs/:id/close', authenticate, requireEncargado, rateLimit('rfqs_close_ai', 'ai_heavy'), closeRfq);

module.exports = router;
