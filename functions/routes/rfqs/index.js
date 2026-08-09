// Router for Request-for-Quotation flow (procurement phase 2.3).

const { Router } = require('express');
const { authenticate } = require('../../lib/middleware');
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
router.post('/api/rfqs', authenticate, requireEncargado, createRfq);
router.get('/api/rfqs/:id', authenticate, getRfq);
router.delete('/api/rfqs/:id', authenticate, requireEncargado, deleteRfq);
router.post('/api/rfqs/:id/respuesta', authenticate, requireEncargado, recordRfqResponse);
router.post('/api/rfqs/:id/close', authenticate, requireEncargado, closeRfq);

module.exports = router;
