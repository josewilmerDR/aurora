// Forzando el reinicio del servidor...
require('dotenv').config();
const express = require('express');
const twilio = require('twilio');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { MessagingResponse } = require('twilio').twiml;

// --- Importaciones de Firebase Admin ---
const admin = require('firebase-admin');
const { getFirestore } = require('firebase-admin/firestore'); 

// Inicializar la app de Firebase
admin.initializeApp({ projectId: 'studio-1637802616-92118' });

// Obtener la instancia de la base de datos NOMBRADA
const db = getFirestore('auroradatabase'); 

const app = express();
const port = process.env.PORT || 3000;

app.use(express.static('public'));
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// --- RUTAS PÚBLICAS ---
app.get('/', (req, res) => {
  res.send('Servidor funcionando.');
});

// --- API ENDPOINTS ---

// GET /api/packages - Obtiene TODOS los paquetes
app.get('/api/packages', async (req, res) => {
  try {
    const snapshot = await db.collection('packages').get();
    const packages = [];
    snapshot.forEach(doc => packages.push({ id: doc.id, ...doc.data() }));
    res.status(200).json(packages);
  } catch (error) {
    res.status(500).json({ message: 'Error al obtener paquetes.' });
  }
});

// --- NUEVO: GET /api/packages/:id - Obtiene UN solo paquete ---
app.get('/api/packages/:id', async (req, res) => {
  try {
    const doc = await db.collection('packages').doc(req.params.id).get();
    if (!doc.exists) {
      return res.status(404).json({ message: 'Paquete no encontrado.' });
    }
    res.status(200).json({ id: doc.id, ...doc.data() });
  } catch (error) {
    res.status(500).json({ message: 'Error al obtener el paquete.' });
  }
});

// POST /api/packages - Crea un nuevo paquete
app.post('/api/packages', async (req, res) => {
  try {
    const docRef = await db.collection('packages').add(req.body);
    res.status(201).json({ message: `Paquete guardado con ID: ${docRef.id}`, documentId: docRef.id });
  } catch (error) {
    res.status(500).json({ message: 'Error al guardar el paquete.' });
  }
});

// --- NUEVO: PUT /api/packages/:id - Actualiza un paquete existente ---
app.put('/api/packages/:id', async (req, res) => {
  try {
    await db.collection('packages').doc(req.params.id).update(req.body);
    res.status(200).json({ message: 'Paquete actualizado correctamente.' });
  } catch (error) {
    console.error(`[FIRESTORE ERROR] Error al actualizar ${req.params.id}:`, error);
    res.status(500).json({ message: 'Error al actualizar el paquete.' });
  }
});

// DELETE /api/packages/:id - Elimina un paquete
app.delete('/api/packages/:id', async (req, res) => {
  try {
    await db.collection('packages').doc(req.params.id).delete();
    res.status(200).json({ message: 'Paquete eliminado correctamente.' });
  } catch (error) {
    res.status(500).json({ message: 'Error al eliminar el paquete.' });
  }
});

app.listen(port, () => {
  console.log(`El servidor se está ejecutando en http://localhost:${port}.`);
});
