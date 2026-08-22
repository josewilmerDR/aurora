// Única fuente de verdad de los textos legales: versión vigente, identidad del
// operador y la lista de subencargados. Las páginas /terminos y /privacidad
// la renderizan; el checkbox de consentimiento manda LEGAL_VERSION al backend,
// que la persiste en el doc de la finca (`aceptacionLegal`).
//
// Cómo publicar una nueva versión: cambiar LEGAL_VERSION (fecha ISO) y el
// texto de la página que cambió. Ver docs/legal.md.

import { DIRECTORY_URL } from '../../../lib/ecosystem';

// Fecha ISO de la versión vigente. Se guarda junto con cada aceptación, así
// que una finca creada antes de un cambio queda ligada a la versión que
// realmente aceptó.
export const LEGAL_VERSION = '2026-08-21';

// Mientras sea true, las páginas muestran un aviso discreto de "versión
// preliminar en revisión legal". Pasar a false cuando el abogado apruebe el
// texto — no antes, para no presentar como definitivo algo que no lo es.
export const LEGAL_REVIEW_PENDING = true;

// Operador del servicio. Los campos en null son datos que debe completar la
// empresa antes de cobrar a terceros (docs/legal.md §2). Mientras falten, la
// página los omite en vez de inventarlos.
export const LEGAL_ENTITY = {
  nombreComercial: 'comunplace',
  razonSocial: null,      // razón social registrada
  cedulaJuridica: null,   // cédula jurídica (Costa Rica)
  domicilio: null,        // domicilio legal
  correoContacto: null,   // buzón para solicitudes de privacidad (derechos ARCO)
  sitioWeb: DIRECTORY_URL,
};

export const LEGAL_ROUTES = {
  terminos: '/terminos',
  privacidad: '/privacidad',
};

// Terceros que procesan datos por cuenta del servicio. Reflejar aquí cualquier
// proveedor nuevo que reciba datos personales — la política de privacidad
// promete esta lista como exhaustiva.
export const SUBPROCESSORS = [
  {
    nombre: 'Google LLC (Firebase / Google Cloud)',
    pais: 'Estados Unidos',
    proposito: 'Infraestructura del servicio: autenticación (Identity Platform), base de datos (Firestore), almacenamiento de archivos (Cloud Storage), ejecución del backend (Cloud Functions), alojamiento web y protección anti-abuso (App Check / reCAPTCHA).',
    datos: 'Todos los datos que se guardan en Aurora, cifrados en tránsito y en reposo.',
  },
  {
    nombre: 'Anthropic, PBC',
    pais: 'Estados Unidos',
    proposito: 'Procesamiento con inteligencia artificial: el asistente conversacional de Aurora, la lectura automática de facturas y formularios fotografiados, y los análisis y recomendaciones (compras, planificación, recursos humanos, finanzas).',
    datos: 'El texto o imagen que el usuario envía al asistente y el contexto operativo de la finca necesario para responder (catálogos de lotes, productos, maquinaria, labores y la lista de personal con nombre y rol). Conforme a sus términos comerciales vigentes, Anthropic no utiliza los datos enviados por API para entrenar sus modelos.',
  },
  {
    nombre: 'Servicios de notificaciones push del navegador (Google, Mozilla, Apple)',
    pais: 'Según el navegador del usuario',
    proposito: 'Entrega de notificaciones web push a los dispositivos que las activaron.',
    datos: 'Un identificador de suscripción del dispositivo y el contenido cifrado de cada notificación (título, texto breve y enlace).',
  },
];

// Terceros que NO reciben datos personales, listados por transparencia.
export const NON_PERSONAL_THIRD_PARTIES = [
  { nombre: 'OpenWeather', proposito: 'Pronóstico climático por coordenadas aproximadas de la finca.' },
  { nombre: 'Alpha Vantage', proposito: 'Precios de referencia de mercado (sin datos del usuario).' },
];

// Categorías de datos personales que el sistema trata, usadas en la política
// de privacidad. Mantener alineado con el modelo de datos real.
export const DATA_CATEGORIES = [
  {
    titulo: 'Datos de la cuenta',
    detalle: 'Correo electrónico, nombre, teléfono, rol dentro de la organización y registros de acceso.',
  },
  {
    titulo: 'Datos del personal de la finca',
    detalle: 'Nombre, número de cédula, dirección, teléfono, contacto de emergencia, puesto, salario, deducciones y pagos de planilla, asistencia, permisos e incapacidades (incluido el motivo que el encargado registre) y evaluaciones de desempeño.',
  },
  {
    titulo: 'Datos de proveedores y compradores',
    detalle: 'Nombre o razón social, identificación, contacto, condiciones comerciales, cotizaciones y facturas.',
  },
  {
    titulo: 'Datos operativos de la finca',
    detalle: 'Lotes, cultivos, inventarios, aplicaciones de agroquímicos, maquinaria, cosechas, costos, presupuestos y tesorería.',
  },
  {
    titulo: 'Archivos e imágenes',
    detalle: 'Fotografías de facturas, formularios de muestreo y logotipo de la organización que el usuario sube al sistema.',
  },
  {
    titulo: 'Voz',
    detalle: 'Si el usuario dicta al asistente, el reconocimiento de voz lo realiza el propio navegador; Aurora recibe únicamente el texto resultante.',
  },
];
