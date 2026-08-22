// Single source of truth for the legal texts: current version, operator
// identity and the sub-processor list. The /terms and /privacy pages render
// it; the consent checkbox sends LEGAL_VERSION to the backend, which persists
// it on the finca document (`legalAcceptance`).
//
// How to publish a new version: bump LEGAL_VERSION (ISO date) and edit the
// page whose text changed. See docs/legal.md.

import { DIRECTORY_URL } from '../../../lib/ecosystem';

// ISO date of the current version. Stored with every acceptance, so an
// organization created before a change stays bound to the version it
// actually accepted.
export const LEGAL_VERSION = '2026-08-21';

// While true, the pages show a discreet "preliminary version under legal
// review" notice. Flip to false once the lawyer approves the text — not
// before, so we never present as final something that is not.
export const LEGAL_REVIEW_PENDING = true;

// Service operator. Null fields are data the company must fill in before
// charging third parties (docs/legal.md §2). While missing, the pages omit
// them instead of making them up.
export const LEGAL_ENTITY = {
  tradeName: 'comunplace',
  legalName: null,      // registered legal name
  taxId: null,          // cédula jurídica (Costa Rica)
  address: null,        // legal address
  contactEmail: null,   // mailbox for privacy requests (ARCO rights)
  website: DIRECTORY_URL,
};

export const LEGAL_ROUTES = {
  terms: '/terms',
  privacy: '/privacy',
};

// Third parties that process data on behalf of the service. Any new vendor
// that receives personal data must be added here — the privacy policy
// promises this list as exhaustive.
export const SUBPROCESSORS = [
  {
    name: 'Google LLC (Firebase / Google Cloud)',
    country: 'Estados Unidos',
    purpose: 'Infraestructura del servicio: autenticación (Identity Platform), base de datos (Firestore), almacenamiento de archivos (Cloud Storage), ejecución del backend (Cloud Functions), alojamiento web y protección anti-abuso (App Check / reCAPTCHA).',
    data: 'Todos los datos que se guardan en Aurora, cifrados en tránsito y en reposo.',
  },
  {
    name: 'Anthropic, PBC',
    country: 'Estados Unidos',
    purpose: 'Procesamiento con inteligencia artificial: el asistente conversacional de Aurora, la lectura automática de facturas y formularios fotografiados, y los análisis y recomendaciones (compras, planificación, recursos humanos, finanzas).',
    data: 'El texto o imagen que el usuario envía al asistente y el contexto operativo de la finca necesario para responder (catálogos de lotes, productos, maquinaria, labores y la lista de personal con nombre y rol). Conforme a sus términos comerciales vigentes, Anthropic no utiliza los datos enviados por API para entrenar sus modelos.',
  },
  {
    name: 'Servicios de notificaciones push del navegador (Google, Mozilla, Apple)',
    country: 'Según el navegador del usuario',
    purpose: 'Entrega de notificaciones web push a los dispositivos que las activaron.',
    data: 'Un identificador de suscripción del dispositivo y el contenido cifrado de cada notificación (título, texto breve y enlace).',
  },
];

// Third parties that do NOT receive personal data, listed for transparency.
export const NON_PERSONAL_THIRD_PARTIES = [
  { name: 'OpenWeather', purpose: 'Pronóstico climático por coordenadas aproximadas de la finca.' },
  { name: 'Alpha Vantage', purpose: 'Precios de referencia de mercado (sin datos del usuario).' },
];

// Categories of personal data the system processes, used by the privacy
// policy. Keep aligned with the real data model.
export const DATA_CATEGORIES = [
  {
    title: 'Datos de la cuenta',
    detail: 'Correo electrónico, nombre, teléfono, rol dentro de la organización y registros de acceso.',
  },
  {
    title: 'Datos del personal de la finca',
    detail: 'Nombre, número de cédula, dirección, teléfono, contacto de emergencia, puesto, salario, deducciones y pagos de planilla, asistencia, permisos e incapacidades (incluido el motivo que el encargado registre) y evaluaciones de desempeño.',
  },
  {
    title: 'Datos de proveedores y compradores',
    detail: 'Nombre o razón social, identificación, contacto, condiciones comerciales, cotizaciones y facturas.',
  },
  {
    title: 'Datos operativos de la finca',
    detail: 'Lotes, cultivos, inventarios, aplicaciones de agroquímicos, maquinaria, cosechas, costos, presupuestos y tesorería.',
  },
  {
    title: 'Archivos e imágenes',
    detail: 'Fotografías de facturas, formularios de muestreo y logotipo de la organización que el usuario sube al sistema.',
  },
  {
    title: 'Voz',
    detail: 'Si el usuario dicta al asistente, el reconocimiento de voz lo realiza el propio navegador; Aurora recibe únicamente el texto resultante.',
  },
];
