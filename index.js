require('dotenv').config();
const express = require('express');
const twilio = require('twilio');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { MessagingResponse } = require('twilio').twiml;

// --- NUEVO: Importa e inicializa Firebase Admin ---
const admin = require('firebase-admin');

// CORRECCIÓN FINAL: Usar el Project ID correcto donde la base de datos fue creada.
admin.initializeApp({
  projectId: 'studio-1637802616-92118'
});

// SOLUCIÓN DEFINITIVA: Especificar el ID de la base de datos nombrada.
const db = admin.firestore('auroradatabase'); 

const app = express();
const port = process.env.PORT || 3000;

// --- MIDDLEWARE ---
app.use(express.static('public'));
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// --- CONFIGURACIONES ---
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const client = new twilio(accountSid, authToken);
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-flash-latest"});

// --- RUTAS PÚBLICAS ---
app.get('/', (req, res) => {
  res.send('Servidor funcionando. Visita /admin.html para gestionar paquetes de cultivo.');
});

// --- API ENDPOINTS ---
app.post('/api/packages', async (req, res) => {
  const packageData = req.body;
  console.log('[API] Recibido paquete. Intentando guardar en Firestore...');

  if (!packageData || !packageData.packageName || !packageData.activities.length) {
    return res.status(400).json({ message: 'Datos incompletos. Se requiere nombre y al menos una actividad.' });
  }

  try {
    const docRef = await db.collection('packages').add(packageData);
    console.log(`[FIRESTORE] Documento guardado con éxito. ID: ${docRef.id}`);

    res.status(201).json({
      message: `Paquete guardado en Firestore con ID: ${docRef.id}`,
      documentId: docRef.id
    });
  } catch (error) {
    console.error('[FIRESTORE ERROR] Error al guardar el documento:', error);
    res.status(500).json({ message: 'Error interno al conectar con la base de datos.', error: error.message });
  }
});


// --- WEBHOOKS ---
app.post('/whatsapp-webhook', async (req, res) => {
  const incomingMsg = req.body.Body;
  const twiml = new MessagingResponse();
  // ... (lógica del webhook de WhatsApp sin cambios) ...
});


// --- INICIO DEL SERVIDOR ---
app.listen(port, () => {
  console.log(`El servidor se está ejecutando en http://localhost:${port}.`);
});
