// ─────────────────────────────────────────────────────────────────────────────
// Copy de la landing pública (/ para visitantes anónimos, /bienvenido siempre).
//
// Vive separado de los componentes por dos razones: el texto es lo que más se
// va a tocar (y así se edita sin leer JSX), y este módulo queda framework-free
// —los iconos se nombran por clave `glyph` y cada componente los resuelve a un
// componente de react-icons, igual que hace lib/ecosystem.js.
//
// Regla de contenido: acá solo se describe lo que la app HACE hoy. Nada de
// métricas, precios, testimonios ni funciones detrás del flag de avanzadas
// (Estrategia / Financiamiento / CEO / Autopilot, ver lib/features.js).
// ─────────────────────────────────────────────────────────────────────────────

// El ciclo completo de Aurora en tres pasos. El orden es el del uso real:
// configurar una vez → el sistema programa → el campo registra y el costo sale.
export const LANDING_STEPS = [
  {
    id: 'configura',
    title: 'Configuras tu finca una vez',
    body:
      'Cargas lotes, grupos, productos y labores, y sumas a tu equipo con el rol que le toca. ' +
      'Esa base es la que después alimenta todo lo demás.',
  },
  {
    id: 'programa',
    title: 'El paquete técnico programa el trabajo',
    body:
      'Al abrir un grupo, las labores de su paquete se convierten en tareas con fecha y responsable. ' +
      'Cada persona recibe el aviso de lo que le toca ese día.',
  },
  {
    id: 'registra',
    title: 'El campo registra y el costo aparece solo',
    body:
      'El trabajador completa la tarea desde el teléfono: se descuenta el producto de bodega, ' +
      'queda la cédula de aplicación y el gasto cae en el centro de costos del lote.',
  },
];

// Un item por módulo real de la app. El orden sigue el recorrido del producto:
// campo → insumos → gente → salida → dinero → control.
export const LANDING_MODULES = [
  {
    id: 'campo',
    glyph: 'layers',
    name: 'Campo y lotes',
    body: 'Lotes, grupos y siembras con su historial. Cada labor queda ligada al bloque donde ocurrió.',
  },
  {
    id: 'aplicaciones',
    glyph: 'package',
    name: 'Aplicaciones',
    body: 'Paquetes técnicos que generan las tareas, cédulas de aplicación firmadas e historial de lo aplicado.',
  },
  {
    id: 'bodega',
    glyph: 'droplet',
    name: 'Bodega e inventario',
    body: 'Existencias, recepciones y movimientos. El stock baja solo cuando la aplicación se completa.',
  },
  {
    id: 'compras',
    glyph: 'cart',
    name: 'Compras y proveedores',
    body: 'Solicitudes de compra, cotizaciones y órdenes, enlazadas con lo que de verdad falta en bodega.',
  },
  {
    id: 'personal',
    glyph: 'users',
    name: 'Personal y planilla',
    body: 'Ficha del trabajador, asistencia diaria, permisos y planilla por salario fijo o por unidad de trabajo.',
  },
  {
    id: 'cosecha',
    glyph: 'trending',
    name: 'Cosecha y despachos',
    body: 'Registro de cosecha, despacho a compradores con sus boletas y proyección por grupo.',
  },
  {
    id: 'costos',
    glyph: 'dollar',
    name: 'Costos y finanzas',
    body: 'Centro de costos por lote, presupuestos, tesorería e ingresos, alimentados por la operación diaria.',
  },
  {
    id: 'monitoreo',
    glyph: 'activity',
    name: 'Monitoreo y muestreos',
    body: 'Plantillas y paquetes de muestreo, órdenes de campo e historial de lo observado en el cultivo.',
  },
  {
    id: 'maquinaria',
    glyph: 'tool',
    name: 'Maquinaria y combustible',
    body: 'Lista de activos, horímetro por equipo, calibraciones y control del combustible que se despacha.',
  },
];

// Los cuatro argumentos que separan a Aurora de una hoja de cálculo. Todos son
// verificables dentro de la app: roles, PWA + push, auditoría, IA.
export const LANDING_REASONS = [
  {
    id: 'roles',
    glyph: 'shield',
    title: 'Cada quien ve lo suyo',
    body:
      'Cuatro roles —trabajador, encargado, supervisor y administrador— definen qué módulo abre cada persona, ' +
      'y el servidor lo vuelve a verificar en cada operación.',
  },
  {
    id: 'campo',
    glyph: 'smartphone',
    title: 'Pensado para usarse en el lote',
    body:
      'Se instala en el teléfono como una app y avisa por notificación la tarea del día, ' +
      'para que el registro ocurra donde pasa el trabajo y no de vuelta en la oficina.',
  },
  {
    id: 'trazabilidad',
    glyph: 'clipboard',
    title: 'Todo queda registrado',
    body:
      'Quién creó, editó o anuló cada documento queda en el registro de auditoría. ' +
      'Las anulaciones no borran: dejan rastro.',
  },
  {
    id: 'ia',
    glyph: 'cpu',
    title: 'IA donde de verdad ahorra tiempo',
    body:
      'Le tomas una foto a la factura del proveedor y las líneas de la recepción se llenan solas. ' +
      'Y puedes preguntarle al asistente por el estado de la finca en lenguaje normal.',
  },
];
