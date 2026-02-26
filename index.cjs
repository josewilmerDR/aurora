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

// <-- CAMBIO CLAVE: ID "quemado" para el inquilino actual. Prepara la App para el futuro.
const ID_FINCA_ACTUAL = 'finca_aurora_test';

const app = express();
const port = process.env.PORT || 3000;

app.use(express.static('public'));
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// --- RUTAS PÚBLICAS ---
app.get('/', (req, res) => {
  res.send('Servidor funcionando.');
});

// --- API ENDPOINTS (AHORA CON SEGURIDAD MULTI-INQUILINO) ---

// GET /api/packages - Obtiene los paquetes SÓLO de la finca actual
app.get('/api/packages', async (req, res) => {
  try {
    // <-- CAMBIO CLAVE: Se añade el filtro .where() para aislar los datos.
    const snapshot = await db.collection('packages').where('fincaId', '==', ID_FINCA_ACTUAL).get();
    const packages = [];
    snapshot.forEach(doc => packages.push({ id: doc.id, ...doc.data() }));
    res.status(200).json(packages);
  } catch (error) {
    console.error("[FIRESTORE ERROR] al obtener paquetes:", error);
    res.status(500).json({ message: 'Error al obtener paquetes.' });
  }
});

// GET /api/packages/:id - Obtiene UN paquete, verificando que pertenezca a la finca
app.get('/api/packages/:id', async (req, res) => {
  try {
    const doc = await db.collection('packages').doc(req.params.id).get();
    // <-- CAMBIO CLAVE: Se verifica si el paquete existe Y si pertenece a la finca actual.
    if (!doc.exists || doc.data().fincaId !== ID_FINCA_ACTUAL) {
      return res.status(404).json({ message: 'Paquete no encontrado o no pertenece a esta finca.' });
    }
    res.status(200).json({ id: doc.id, ...doc.data() });
  } catch (error) {
    console.error(`[FIRESTORE ERROR] al obtener paquete ${req.params.id}:`, error);
    res.status(500).json({ message: 'Error al obtener el paquete.' });
  }
});

// POST /api/packages - Crea un nuevo paquete ASIGNADO a la finca actual
app.post('/api/packages', async (req, res) => {
  try {
    const newPackage = req.body;
    delete newPackage.id; 
    // <-- CAMBIO CLAVE: Se añade automáticamente el ID de la finca al nuevo paquete.
    const docRef = await db.collection('packages').add({ ...newPackage, fincaId: ID_FINCA_ACTUAL });
    res.status(201).json({ ...newPackage, id: docRef.id, fincaId: ID_FINCA_ACTUAL });
  } catch (error) {
    console.error("[FIRESTORE ERROR] al crear paquete:", error);
    res.status(500).json({ message: 'Error al guardar el paquete.' });
  }
});

// PUT /api/packages/:id - Actualiza un paquete, verificando la pertenencia
app.put('/api/packages/:id', async (req, res) => {
  try {
    const docRef = db.collection('packages').doc(req.params.id);
    const doc = await docRef.get();

    // <-- CAMBIO CLAVE: Se verifica si el paquete existe Y si pertenece a la finca actual antes de actualizar.
    if (!doc.exists || doc.data().fincaId !== ID_FINCA_ACTUAL) {
        return res.status(404).json({ message: 'Paquete no encontrado o no pertenece a esta finca.' });
    }

    const packageData = req.body;
    delete packageData.id; 
    await docRef.update(packageData);
    res.status(200).json({ message: 'Paquete actualizado correctamente.' });
  } catch (error) {
    console.error(`[FIRESTORE ERROR] al actualizar ${req.params.id}:`, error);
    res.status(500).json({ message: 'Error al actualizar el paquete.' });
  }
});

// DELETE /api/packages/:id - Elimina un paquete, verificando la pertenencia
app.delete('/api/packages/:id', async (req, res) => {
  try {
    const docRef = db.collection('packages').doc(req.params.id);
    const doc = await docRef.get();

    // <-- CAMBIO CLAVE: Se verifica si el paquete existe Y si pertenece a la finca actual antes de eliminar.
    if (!doc.exists || doc.data().fincaId !== ID_FINCA_ACTUAL) {
        return res.status(404).json({ message: 'Paquete no encontrado o no pertenece a esta finca.' });
    }

    await docRef.delete();
    res.status(200).json({ message: 'Paquete eliminado correctamente.' });
  } catch (error) {
    console.error(`[FIRESTORE ERROR] al eliminar ${req.params.id}:`, error);
    res.status(500).json({ message: 'Error al eliminar el paquete.' });
  }
});

app.listen(port, () => {
  console.log(`El servidor se está ejecutando en http://localhost:${port}.`);
});
