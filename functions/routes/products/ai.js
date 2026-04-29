// Products — endpoint de edición vía IA.
//
// Sub-archivo del split de routes/products.js. POST /api/productos/ai-editar
// recibe un mensaje en español, lo despacha a Claude con el inventario
// actual como contexto, y devuelve un JSON con `changes` (campos del
// catálogo a editar) + `stockAdjustments` (cambios de stockActual con
// nota obligatoria, gestionados aparte por el frontend que llama a
// /api/inventario/ajuste).

const { Router } = require('express');
const { db } = require('../../lib/firebase');
const { authenticate } = require('../../lib/middleware');
const { getAnthropicClient } = require('../../lib/clients');
const { sendApiError, ERROR_CODES } = require('../../lib/errors');
const { rateLimit } = require('../../lib/rateLimit');

const router = Router();

router.post('/api/productos/ai-editar', authenticate, rateLimit('productos_ai', 'ai_light'), async (req, res) => {
  try {
    const { mensaje } = req.body;
    if (!mensaje?.trim()) return sendApiError(res, ERROR_CODES.MISSING_REQUIRED_FIELDS, 'Message is required.', 400);

    const snap = await db.collection('productos').where('fincaId', '==', req.fincaId).get();
    const productos = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    const anthropicClient = getAnthropicClient();

    const productosTexto = productos.map(p =>
      `ID: ${p.id} | Código: ${p.idProducto || ''} | Nombre: ${p.nombreComercial || ''} | IngredienteActivo: ${p.ingredienteActivo || ''} | Tipo: ${p.tipo || ''} | Plaga: ${p.plagaQueControla || ''} | Dosis/Ha: ${p.cantidadPorHa ?? ''} | Unidad: ${p.unidad || ''} | Reingreso(h): ${p.periodoReingreso ?? ''} | Cosecha(días): ${p.periodoACosecha ?? ''} | Stock: ${p.stockActual ?? 0} | StockMin: ${p.stockMinimo ?? 0} | Precio: ${p.precioUnitario ?? ''} ${p.moneda || ''} | TipoCambio: ${p.tipoCambio ?? ''} | Proveedor: ${p.proveedor || ''}`
    ).join('\n');

    const systemPrompt = `Eres el asistente de inventario Aurora. Interpretas solicitudes en español para modificar productos agroquímicos.

CAMPOS DISPONIBLES (nombre técnico exacto):
- idProducto: Código del producto
- nombreComercial: Nombre comercial
- ingredienteActivo: Ingrediente activo
- tipo: Tipo — solo estos valores: "Herbicida", "Fungicida", "Insecticida", "Fertilizante", "Regulador de crecimiento", "Otro"
- plagaQueControla: Plaga o enfermedad que controla
- cantidadPorHa: Dosis por hectárea (número)
- unidad: Unidad de medida (L, kg, cc, g, mL, etc.)
- periodoReingreso: Período de reingreso en horas (número entero)
- periodoACosecha: Período a cosecha en días (número entero)
- stockMinimo: Stock mínimo (número)
- precioUnitario: Precio unitario (número)
- moneda: Moneda — solo: "USD", "CRC", "EUR"
- tipoCambio: Tipo de cambio (número)
- proveedor: Nombre del proveedor

CAMPO ESPECIAL (ajuste de inventario con nota obligatoria):
- stockActual: Stock actual (número) — devuélvelo en "stockAdjustments", NUNCA en "changes"

REGLAS:
1. Identifica el/los productos por nombre aproximado, código o ingrediente activo.
2. Solo incluye los cambios explícitamente solicitados.
3. Si un producto no se encuentra, explícalo en "error".
4. Si la solicitud es ambigua (varios productos podrían coincidir), pide aclaración en "error".
5. Normaliza el campo "tipo" al valor válido más cercano.

Responde SOLO con JSON válido, sin texto adicional ni bloques de código:
{
  "mensaje": "texto breve describiendo los cambios o el error",
  "changes": [
    { "productoId": "id_firestore", "nombreProducto": "nombre", "field": "campoTecnico", "oldValue": "valor_actual", "newValue": "nuevo_valor" }
  ],
  "stockAdjustments": [
    { "productoId": "id_firestore", "nombreProducto": "nombre", "stockActual": 0, "newStock": 0 }
  ],
  "error": null
}`;

    const response = await anthropicClient.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: 'user', content: `Inventario actual:\n${productosTexto}\n\nSolicitud: ${mensaje}` }],
    });

    const text = response.content[0].text;
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Respuesta de IA inválida.');
    const parsed = JSON.parse(jsonMatch[0]);
    res.json(parsed);
  } catch (err) {
    console.error('Error en ai-editar productos:', err);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, err.message || 'Failed to process AI request.', 500);
  }
});

module.exports = router;
