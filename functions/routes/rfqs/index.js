// Router for Request-for-Quotation flow (procurement phase 2.3).

const { Router } = require('express');
const { authenticate } = require('../../lib/middleware');
const { listRfqs, getRfq, deleteRfq } = require('./crud');
const { createRfq } = require('./create');
const { recordRfqResponse } = require('./response');
const { closeRfq } = require('./close');

const router = Router();

router.get('/api/rfqs', authenticate, listRfqs);
router.post('/api/rfqs', authenticate, createRfq);
router.get('/api/rfqs/:id', authenticate, getRfq);
router.delete('/api/rfqs/:id', authenticate, deleteRfq);
router.post('/api/rfqs/:id/respuesta', authenticate, recordRfqResponse);
router.post('/api/rfqs/:id/close', authenticate, closeRfq);

module.exports = router;
