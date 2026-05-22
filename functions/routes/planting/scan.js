// AI vision endpoint para leer un formulario físico de siembra y extraer
// las filas como JSON. Rate-limited en ai_medium (15/min, 200/día) por usuario.

const { Router } = require('express');
const { db } = require('../../lib/firebase');
const { getAnthropicClient } = require('../../lib/clients');
const { authenticate } = require('../../lib/middleware');
const { sendApiError, ERROR_CODES } = require('../../lib/errors');
const { rateLimit } = require('../../lib/rateLimit');

const router = Router();

router.post('/api/siembras/escanear', authenticate, rateLimit('siembras_scan', 'ai_medium'), async (req, res) => {
  try {
    const { imageBase64, mediaType } = req.body;
    if (!imageBase64 || !mediaType) {
      return sendApiError(res, ERROR_CODES.MISSING_REQUIRED_FIELDS, 'imageBase64 and mediaType are required.', 400);
    }

    const [lotesSnap, matsSnap] = await Promise.all([
      db.collection('lotes').where('fincaId', '==', req.fincaId).get(),
      db.collection('materiales_siembra').where('fincaId', '==', req.fincaId).get(),
    ]);

    const lotes = lotesSnap.docs.map(d => ({ id: d.id, nombre: d.data().nombreLote }));
    const materiales = matsSnap.docs.map(d => ({
      id: d.id,
      nombre: d.data().nombre,
      rangoPesos: d.data().rangoPesos || '',
      variedad: d.data().variedad || '',
    }));

    const client = getAnthropicClient();

    const lotesTexto = lotes.length
      ? lotes.map(l => `- ID: "${l.id}" | Nombre: "${l.nombre}"`).join('\n')
      : '(sin lotes registrados)';
    const matsTexto = materiales.length
      ? materiales.map(m => `- ID: "${m.id}" | Nombre: "${m.nombre}" | RangoPesos: "${m.rangoPesos}" | Variedad: "${m.variedad}"`).join('\n')
      : '(sin materiales registrados)';

    const prompt = `Eres un asistente agrícola. Analiza este formulario físico de registro de siembra de piña.

Lotes registrados en el sistema:
${lotesTexto}

Materiales de siembra registrados:
${matsTexto}

Extrae cada fila de siembra del formulario y devuelve un arreglo JSON con este formato exacto:
[
  {
    "loteId": "ID del lote si el nombre coincide con el catálogo, o null si no hay coincidencia",
    "loteNombre": "nombre del lote tal como aparece en el formulario",
    "bloque": "identificador del bloque (letra, número o combinación), o cadena vacía si no aparece",
    "plantas": 15000,
    "densidad": 65000,
    "materialId": "ID del material si el nombre coincide con el catálogo, o null si no hay coincidencia",
    "materialNombre": "nombre del material tal como aparece en el formulario, o cadena vacía",
    "rangoPesos": "rango de pesos si aparece en el formulario, o cadena vacía",
    "variedad": "variedad si aparece en el formulario, o cadena vacía"
  }
]

Reglas:
1. Si el nombre del lote coincide (o es muy similar) con uno del catálogo, usa su ID; si no hay coincidencia, deja loteId como null.
2. Si el nombre del material coincide con uno del catálogo, usa su ID; si no, deja materialId como null.
3. Si no aparece densidad en el formulario, usa 65000 como valor por defecto.
4. plantas y densidad deben ser números enteros, no cadenas.
5. Devuelve SOLO el arreglo JSON, sin texto adicional ni bloques de código.`;

    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
          { type: 'text', text: prompt },
        ],
      }],
    });

    const rawText = response.content[0].text.trim();
    const jsonText = rawText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();

    let filas;
    try {
      filas = JSON.parse(jsonText);
    } catch {
      // Don't expose the raw model output to the client. It may contain
      // catalog data (lote/material IDs and names) used in the prompt
      // context, or surprising tokens the model emitted. Server-side log
      // captures a truncated snippet for debugging.
      console.error('Claude returned unparseable text (truncated):', rawText.slice(0, 200));
      return sendApiError(res, ERROR_CODES.EXTERNAL_SERVICE_ERROR, 'AI could not interpret the form. Try a clearer image.', 422);
    }

    res.json({ filas, lotes, materiales });
  } catch (error) {
    console.error('Error scanning siembra:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to process image with AI.', 500);
  }
});

module.exports = router;
