require('dotenv').config(); // Carga las variables de entorno del archivo .env

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

// --- INICIO: NUEVO ENDPOINT PARA PRUEBAS DE ENVÍO ---
app.get('/send-message', async (req, res) => {
  console.log('[PRUEBA] Iniciando envío de mensaje de prueba...');
  try {
    const to_number = process.env.TO_WHATSAPP_NUMBER;
    const from_number = 'whatsapp:+14155238886'; // Tu número de sandbox de Twilio

    if (!to_number || to_number === 'whatsapp:+XXXXXXXXXX') {
      throw new Error('La variable de entorno TO_WHATSAPP_NUMBER no está definida o no ha sido actualizada en tu archivo .env');
    }

    const message = await client.messages.create({
      body: 'Hola 👋 ¡Este es un mensaje de prueba desde tu app Aurora!',
      from: from_number,
      to: to_number
    });

    console.log(`[PRUEBA] Mensaje enviado con éxito. SID: ${message.sid}`);
    res.status(200).send(`Mensaje enviado con éxito a ${to_number}. SID: ${message.sid}`);
  } catch (error) {
    console.error('[PRUEBA ERROR] No se pudo enviar el mensaje:', error);
    res.status(500).send(`Error al enviar el mensaje: ${error.message}`);
  }
});
// --- FIN: NUEVO ENDPOINT PARA PRUEBAS DE ENVÍO ---

app.listen(port, () => {
  console.log(`El servidor se está ejecutando en http://localhost:${port}.`);
});
