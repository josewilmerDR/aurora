const express = require('express');
const twilio = require('twilio');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { MessagingResponse } = require('twilio').twiml;

const app = express();
const port = process.env.PORT || 3000;

app.use(express.urlencoded({ extended: false }));

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const client = new twilio(accountSid, authToken);

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
// --- CORRECCIÓN: Cambiado a un modelo más rápido para evitar timeouts ---
const model = genAI.getGenerativeModel({ model: "gemini-flash-latest"});

app.get('/', (req, res) => {
  res.send('El servidor de la IA para WhatsApp está funcionando.');
});

app.post('/whatsapp-webhook', async (req, res) => {
  const incomingMsg = req.body.Body;
  const twiml = new MessagingResponse();
  console.log(`[INICIO] Mensaje recibido: "${incomingMsg}"`);

  try {
    console.log('[PASO 1] Iniciando llamada a la API de Gemini...');

    const generateContentWithTimeout = Promise.race([
      model.generateContent(incomingMsg),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout de 10 segundos para la API de Gemini')), 10000))
    ]);

    const result = await generateContentWithTimeout;
    const response = await result.response;
    const text = response.text();
    
    console.log(`[PASO 2] Respuesta de la IA recibida: "${text}"`);
    twiml.message(text);

  } catch (error) {
    console.error("[ERROR] Ocurrió un problema durante la llamada a la IA:", error.message);
    twiml.message(`Lo siento, ocurrió un error: ${error.message}`);
  }

  console.log('[PASO 3] Enviando respuesta a Twilio.');
  res.writeHead(200, {'Content-Type': 'text/xml'});
  res.end(twiml.toString());
});

app.listen(port, () => {
  console.log(`El servidor se está ejecutando en http://localhost:${port}.`);
});
