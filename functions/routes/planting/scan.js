// AI vision endpoint para leer un formulario físico de siembra y extraer
// las filas como JSON. Rate-limited en ai_medium (15/min, 200/día) por usuario.

const { Router } = require('express');
const { db } = require('../../lib/firebase');
const { getAnthropicClient } = require('../../lib/clients');
const { authenticate } = require('../../lib/middleware');
const { sendApiError, ERROR_CODES } = require('../../lib/errors');
const { rateLimit } = require('../../lib/rateLimit');
const { hasMinRoleBE } = require('../../lib/helpers');
const { writeAuditEvent, ACTIONS, SEVERITY } = require('../../lib/auditLog');

const router = Router();

// Límites de entrada del scan. Se redefinen locales (en vez de importar de
// monitoring/helpers.js) para no acoplar el dominio planting con monitoring —
// mismo criterio que plots.js con UNSAFE_TEXT_CHARS. Valores alineados con el
// escáner hermano /api/muestreos/escanear-formulario.
const MAX_SCAN_IMAGE_BASE64 = 8 * 1024 * 1024; // ~6MB de imagen binaria
const MEDIA_TYPES_IMG = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

// Anti prompt-injection: los nombres de lote/material del catálogo se
// interpolan en el prompt. Aunque son del propio tenant, un nombre con
// instrucciones embebidas podría desviar al modelo. Solo letras/números +
// puntuación común, truncado a 40 chars. Espejo de sampling.js.
const sanitizeForPrompt = (s) => String(s ?? '').replace(/[^\p{L}\p{N} _\-./%()]/gu, '').slice(0, 40);

router.post('/api/siembras/escanear', authenticate, rateLimit('siembras_scan', 'ai_medium'), async (req, res) => {
  try {
    // H2: el único consumidor legítimo es el form de Siembra (gated a
    // encargado+). Sin este gate, un trabajador autenticado podía invocar el
    // escáner IA y, en la respuesta, recibir el catálogo `materiales` completo
    // —que GET /api/materiales-siembra le niega (403)— además de gastar
    // presupuesto de IA. Alineado con el resto del dominio siembras.
    if (!hasMinRoleBE(req.userRole, 'encargado')) {
      return sendApiError(res, ERROR_CODES.FORBIDDEN, 'Only encargado or above can scan siembra forms.', 403);
    }
    const { imageBase64, mediaType } = req.body;
    if (!imageBase64 || !mediaType) {
      return sendApiError(res, ERROR_CODES.MISSING_REQUIRED_FIELDS, 'imageBase64 and mediaType are required.', 400);
    }
    // H1: cap de tamaño + allowlist de mediaType. El body de Express admite
    // hasta 15MB; sin estos checks, un autenticado podía empujar ~15MB de
    // base64 a Anthropic por request (amplificación de costo) y un media_type
    // arbitrario viajaba crudo al campo `media_type` de la API → 500 opaco.
    if (typeof imageBase64 !== 'string' || imageBase64.length > MAX_SCAN_IMAGE_BASE64) {
      return sendApiError(res, ERROR_CODES.VALIDATION_FAILED, 'Image exceeds max size.', 413);
    }
    if (!MEDIA_TYPES_IMG.includes(mediaType)) {
      return sendApiError(res, ERROR_CODES.INVALID_INPUT, 'Unsupported image type. Use jpeg, png, gif or webp.', 400);
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

    // H3: los nombres del catálogo (user-controlled) se sanitizan SOLO para el
    // prompt. El id es un doc id de Firestore (alfanumérico, seguro). Las
    // respuestas al cliente más abajo devuelven el catálogo original sin tocar.
    const lotesTexto = lotes.length
      ? lotes.map(l => `- ID: "${l.id}" | Nombre: "${sanitizeForPrompt(l.nombre)}"`).join('\n')
      : '(sin lotes registrados)';
    const matsTexto = materiales.length
      ? materiales.map(m => `- ID: "${m.id}" | Nombre: "${sanitizeForPrompt(m.nombre)}" | RangoPesos: "${sanitizeForPrompt(m.rangoPesos)}" | Variedad: "${sanitizeForPrompt(m.variedad)}"`).join('\n')
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

    // "Who scanned what when" trail. Fires after a successful parse so we
    // don't audit failed attempts (parsing errors are caught above and
    // returned to the client without an audit row). Bounded by the
    // ai_medium rate limit (15/min, 200/day per user), so the event stream
    // can't be flooded by abuse.
    writeAuditEvent({
      fincaId: req.fincaId,
      actor: req,
      action: ACTIONS.SIEMBRA_SCAN,
      target: null,
      metadata: {
        filasCount: Array.isArray(filas) ? filas.length : 0,
        mediaType: String(mediaType || '').slice(0, 32),
      },
      severity: SEVERITY.INFO,
    });

    res.json({ filas, lotes, materiales });
  } catch (error) {
    console.error('Error scanning siembra:', error);
    sendApiError(res, ERROR_CODES.INTERNAL_ERROR, 'Failed to process image with AI.', 500);
  }
});

module.exports = router;
