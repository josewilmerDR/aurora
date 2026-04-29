// Tool definitions del autopilot.
//
// Sub-archivo del split de routes/autopilot.js. Aísla las schemas de tools
// (Anthropic tool_use API) y los mapas que traducen entre nombres de tool
// (proponer_*/ejecutar_*) y tipos canónicos de acción (crear_tarea,
// reprogramar_tarea, etc.). Las schemas son puramente declarativas — sin
// efectos — y se reutilizan entre /analyze (N2/N3) y /command.

// ─── Mapas de traducción nombre-de-tool → tipo de acción ─────────────────

// Tools N2/command (proponer_*) → tipo canónico
const PROPOSE_ACTION_MAP = {
  proponer_crear_tarea: 'crear_tarea',
  proponer_reprogramar_tarea: 'reprogramar_tarea',
  proponer_reasignar_tarea: 'reasignar_tarea',
  proponer_ajustar_inventario: 'ajustar_inventario',
  proponer_notificacion: 'enviar_notificacion',
  proponer_solicitud_compra: 'crear_solicitud_compra',
  proponer_orden_compra: 'crear_orden_compra',
};

// Tools N3 (ejecutar_*) → tipo canónico
const EXECUTE_ACTION_MAP = {
  ejecutar_crear_tarea: 'crear_tarea',
  ejecutar_reprogramar_tarea: 'reprogramar_tarea',
  ejecutar_reasignar_tarea: 'reasignar_tarea',
  ejecutar_ajustar_inventario: 'ajustar_inventario',
  ejecutar_notificacion: 'enviar_notificacion',
  ejecutar_solicitud_compra: 'crear_solicitud_compra',
  ejecutar_orden_compra: 'crear_orden_compra',
};

// Categoría usada para filtrar acciones en el dashboard / feed.
const ACTION_CATEGORY_MAP = {
  crear_tarea: 'tareas',
  reprogramar_tarea: 'tareas',
  reasignar_tarea: 'tareas',
  ajustar_inventario: 'inventario',
  enviar_notificacion: 'general',
  crear_solicitud_compra: 'inventario',
  crear_orden_compra: 'inventario',
};

// ─── Tools de propuesta (N2 + command) ───────────────────────────────────

const AUTOPILOT_PROPOSE_TOOLS = [
  {
    name: 'proponer_crear_tarea',
    description: 'Propone la creación de una nueva tarea programada. Se guardará como propuesta para aprobación del supervisor.',
    input_schema: {
      type: 'object',
      properties: {
        nombre:            { type: 'string', description: 'Nombre descriptivo de la tarea/actividad.' },
        loteId:            { type: 'string', description: 'ID del lote (del catálogo).' },
        loteNombre:        { type: 'string', description: 'Nombre del lote (para visualización).' },
        responsableId:     { type: 'string', description: 'ID del usuario responsable (del catálogo).' },
        responsableNombre: { type: 'string', description: 'Nombre del responsable (para visualización).' },
        fecha:             { type: 'string', description: 'Fecha de ejecución YYYY-MM-DD.' },
        productos:         { type: 'array', items: { type: 'object', properties: { productoId: { type: 'string' }, nombreComercial: { type: 'string' }, cantidad: { type: 'number' }, unidad: { type: 'string' } } }, description: 'Productos a aplicar (opcional, solo para tareas de tipo aplicación).' },
        razon:             { type: 'string', description: 'Razón clara por la cual se propone esta tarea, basada en los datos.' },
        prioridad:         { type: 'string', enum: ['alta', 'media', 'baja'] },
      },
      required: ['nombre', 'loteId', 'responsableId', 'fecha', 'razon', 'prioridad'],
    },
  },
  {
    name: 'proponer_reprogramar_tarea',
    description: 'Propone reprogramar una tarea existente a una nueva fecha.',
    input_schema: {
      type: 'object',
      properties: {
        taskId:    { type: 'string', description: 'ID de la tarea existente (del snapshot).' },
        taskName:  { type: 'string', description: 'Nombre de la tarea (para visualización).' },
        oldDate:   { type: 'string', description: 'Fecha actual de la tarea YYYY-MM-DD.' },
        newDate:   { type: 'string', description: 'Nueva fecha propuesta YYYY-MM-DD.' },
        razon:     { type: 'string', description: 'Razón de la reprogramación.' },
        prioridad: { type: 'string', enum: ['alta', 'media', 'baja'] },
      },
      required: ['taskId', 'taskName', 'newDate', 'razon', 'prioridad'],
    },
  },
  {
    name: 'proponer_reasignar_tarea',
    description: 'Propone reasignar una tarea a un usuario diferente.',
    input_schema: {
      type: 'object',
      properties: {
        taskId:      { type: 'string', description: 'ID de la tarea existente.' },
        taskName:    { type: 'string', description: 'Nombre de la tarea.' },
        oldUserId:   { type: 'string', description: 'ID del responsable actual.' },
        oldUserName: { type: 'string', description: 'Nombre del responsable actual.' },
        newUserId:   { type: 'string', description: 'ID del nuevo responsable (del catálogo).' },
        newUserName: { type: 'string', description: 'Nombre del nuevo responsable.' },
        razon:       { type: 'string', description: 'Razón de la reasignación.' },
        prioridad:   { type: 'string', enum: ['alta', 'media', 'baja'] },
      },
      required: ['taskId', 'taskName', 'newUserId', 'newUserName', 'razon', 'prioridad'],
    },
  },
  {
    name: 'proponer_ajustar_inventario',
    description: 'Propone CORREGIR el stock registrado para reflejar la realidad física (por conteo físico, pérdida, merma o error de captura). NO usar para reponer inventario bajo — para eso existen proponer_solicitud_compra y proponer_orden_compra.',
    input_schema: {
      type: 'object',
      properties: {
        productoId:     { type: 'string', description: 'ID del producto (del catálogo).' },
        productoNombre: { type: 'string', description: 'Nombre del producto.' },
        stockActual:    { type: 'number', description: 'Stock actual registrado.' },
        stockNuevo:     { type: 'number', description: 'Nuevo valor de stock propuesto.' },
        unidad:         { type: 'string', description: 'Unidad de medida.' },
        nota:           { type: 'string', description: 'Razón concreta del ajuste: conteo físico, merma, pérdida, error de captura, etc.' },
        prioridad:      { type: 'string', enum: ['alta', 'media', 'baja'] },
      },
      required: ['productoId', 'productoNombre', 'stockNuevo', 'nota', 'prioridad'],
    },
  },
  {
    name: 'proponer_solicitud_compra',
    description: 'Propone crear una solicitud interna de compra (request interno para que proveeduría cotice/compre). Úsalo cuando hay bajo stock y no hay proveedor habitual claro, o cuando el productor decide la cotización antes de emitir la orden formal.',
    input_schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          description: 'Productos que se solicitan.',
          items: {
            type: 'object',
            properties: {
              productoId:         { type: 'string', description: 'ID del producto (del catálogo).' },
              nombreComercial:    { type: 'string', description: 'Nombre comercial del producto.' },
              cantidadSolicitada: { type: 'number', description: 'Cantidad a solicitar (en la misma unidad del producto).' },
              unidad:             { type: 'string', description: 'Unidad del producto.' },
              stockActual:        { type: 'number', description: 'Stock actual del producto al momento de la solicitud.' },
              stockMinimo:        { type: 'number', description: 'Stock mínimo configurado para el producto.' },
            },
            required: ['productoId', 'nombreComercial', 'cantidadSolicitada', 'unidad'],
          },
        },
        responsableId:     { type: 'string', description: 'ID del usuario responsable de la solicitud (del catálogo); omitir para default "proveeduria".' },
        responsableNombre: { type: 'string', description: 'Nombre del responsable (para visualización).' },
        notas:             { type: 'string', description: 'Justificación y contexto de la solicitud.' },
        razon:             { type: 'string', description: 'Razón clara que el supervisor pueda evaluar.' },
        prioridad:         { type: 'string', enum: ['alta', 'media', 'baja'] },
      },
      required: ['items', 'razon', 'prioridad'],
    },
  },
  {
    name: 'proponer_orden_compra',
    description: 'Propone emitir una orden de compra formal a un proveedor específico. Úsalo cuando el producto tiene un proveedor habitual identificado o el productor ya tiene decidido a quién comprar. Si el proveedor habitual no está claro, prefiere proponer_solicitud_compra.',
    input_schema: {
      type: 'object',
      properties: {
        proveedor:          { type: 'string', description: 'Nombre del proveedor (del catálogo de proveedores si existe, o del campo producto.proveedor).' },
        direccionProveedor: { type: 'string', description: 'Dirección del proveedor (opcional).' },
        fecha:              { type: 'string', description: 'Fecha de la orden YYYY-MM-DD (opcional; por defecto hoy).' },
        fechaEntrega:       { type: 'string', description: 'Fecha esperada de entrega YYYY-MM-DD (opcional).' },
        items: {
          type: 'array',
          description: 'Productos a ordenar con cantidad y precio estimado.',
          items: {
            type: 'object',
            properties: {
              productoId:       { type: 'string', description: 'ID del producto (del catálogo).' },
              nombreComercial:  { type: 'string', description: 'Nombre comercial.' },
              ingredienteActivo:{ type: 'string', description: 'Ingrediente activo (si aplica).' },
              cantidad:         { type: 'number', description: 'Cantidad a ordenar.' },
              unidad:           { type: 'string', description: 'Unidad (kg, L, etc).' },
              precioUnitario:   { type: 'number', description: 'Precio unitario estimado (0 si no se conoce).' },
              iva:              { type: 'number', description: 'Porcentaje de IVA (0 si no se conoce).' },
              moneda:           { type: 'string', description: 'Moneda (USD/CRC). Default USD.' },
            },
            required: ['nombreComercial', 'cantidad', 'unidad'],
          },
        },
        solicitudId: { type: 'string', description: 'ID de la solicitud de compra asociada (opcional).' },
        notas:       { type: 'string', description: 'Notas adicionales de la orden.' },
        razon:       { type: 'string', description: 'Razón clara que el supervisor pueda evaluar.' },
        prioridad:   { type: 'string', enum: ['alta', 'media', 'baja'] },
      },
      required: ['proveedor', 'items', 'razon', 'prioridad'],
    },
  },
  {
    name: 'proponer_notificacion',
    description: 'Propone enviar una notificación WhatsApp a un trabajador.',
    input_schema: {
      type: 'object',
      properties: {
        userId:   { type: 'string', description: 'ID del usuario destinatario (del catálogo).' },
        userName: { type: 'string', description: 'Nombre del usuario.' },
        telefono: { type: 'string', description: 'Teléfono del usuario.' },
        mensaje:  { type: 'string', description: 'Contenido del mensaje WhatsApp.' },
        razon:    { type: 'string', description: 'Razón de la notificación.' },
        prioridad:{ type: 'string', enum: ['alta', 'media', 'baja'] },
      },
      required: ['userId', 'userName', 'mensaje', 'razon', 'prioridad'],
    },
  },
];

// ─── Tools de ejecución directa (N3) ────────────────────────────────────

const AUTOPILOT_EXECUTE_TOOLS = [
  {
    name: 'ejecutar_crear_tarea',
    description: 'Crea una nueva tarea programada directamente. Se ejecuta de inmediato si cumple las barandillas de seguridad.',
    input_schema: {
      type: 'object',
      properties: {
        nombre:            { type: 'string', description: 'Nombre descriptivo de la tarea/actividad.' },
        loteId:            { type: 'string', description: 'ID del lote (del catálogo).' },
        loteNombre:        { type: 'string', description: 'Nombre del lote (para visualización).' },
        responsableId:     { type: 'string', description: 'ID del usuario responsable (del catálogo).' },
        responsableNombre: { type: 'string', description: 'Nombre del responsable (para visualización).' },
        fecha:             { type: 'string', description: 'Fecha de ejecución YYYY-MM-DD.' },
        productos:         { type: 'array', items: { type: 'object', properties: { productoId: { type: 'string' }, nombreComercial: { type: 'string' }, cantidad: { type: 'number' }, unidad: { type: 'string' } } }, description: 'Productos a aplicar (opcional, solo para tareas de tipo aplicación).' },
        razon:             { type: 'string', description: 'Razón clara por la cual se ejecuta esta tarea, basada en los datos.' },
        prioridad:         { type: 'string', enum: ['alta', 'media', 'baja'] },
      },
      required: ['nombre', 'loteId', 'responsableId', 'fecha', 'razon', 'prioridad'],
    },
  },
  {
    name: 'ejecutar_reprogramar_tarea',
    description: 'Reprograma una tarea existente a una nueva fecha directamente.',
    input_schema: {
      type: 'object',
      properties: {
        taskId:    { type: 'string', description: 'ID de la tarea existente (del snapshot).' },
        taskName:  { type: 'string', description: 'Nombre de la tarea (para visualización).' },
        oldDate:   { type: 'string', description: 'Fecha actual de la tarea YYYY-MM-DD.' },
        newDate:   { type: 'string', description: 'Nueva fecha YYYY-MM-DD.' },
        razon:     { type: 'string', description: 'Razón de la reprogramación.' },
        prioridad: { type: 'string', enum: ['alta', 'media', 'baja'] },
      },
      required: ['taskId', 'taskName', 'newDate', 'razon', 'prioridad'],
    },
  },
  {
    name: 'ejecutar_reasignar_tarea',
    description: 'Reasigna una tarea a un usuario diferente directamente.',
    input_schema: {
      type: 'object',
      properties: {
        taskId:      { type: 'string', description: 'ID de la tarea existente.' },
        taskName:    { type: 'string', description: 'Nombre de la tarea.' },
        oldUserId:   { type: 'string', description: 'ID del responsable actual.' },
        oldUserName: { type: 'string', description: 'Nombre del responsable actual.' },
        newUserId:   { type: 'string', description: 'ID del nuevo responsable (del catálogo).' },
        newUserName: { type: 'string', description: 'Nombre del nuevo responsable.' },
        razon:       { type: 'string', description: 'Razón de la reasignación.' },
        prioridad:   { type: 'string', enum: ['alta', 'media', 'baja'] },
      },
      required: ['taskId', 'taskName', 'newUserId', 'newUserName', 'razon', 'prioridad'],
    },
  },
  {
    name: 'ejecutar_ajustar_inventario',
    description: 'CORRIGE el stock registrado para reflejar la realidad física (por conteo físico, merma, pérdida documentada, error de captura). NO usar para reponer inventario bajo — para eso existen ejecutar_solicitud_compra y ejecutar_orden_compra.',
    input_schema: {
      type: 'object',
      properties: {
        productoId:     { type: 'string', description: 'ID del producto (del catálogo).' },
        productoNombre: { type: 'string', description: 'Nombre del producto.' },
        stockActual:    { type: 'number', description: 'Stock actual registrado.' },
        stockNuevo:     { type: 'number', description: 'Nuevo valor de stock.' },
        unidad:         { type: 'string', description: 'Unidad de medida.' },
        nota:           { type: 'string', description: 'Razón concreta del ajuste: conteo físico, merma, pérdida, error de captura.' },
        prioridad:      { type: 'string', enum: ['alta', 'media', 'baja'] },
      },
      required: ['productoId', 'productoNombre', 'stockNuevo', 'nota', 'prioridad'],
    },
  },
  {
    name: 'ejecutar_solicitud_compra',
    description: 'Crea una solicitud interna de compra directamente. Úsalo cuando hay bajo stock y no hay proveedor habitual claro, o cuando se necesita que proveeduría cotice antes de emitir la orden formal.',
    input_schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          description: 'Productos que se solicitan.',
          items: {
            type: 'object',
            properties: {
              productoId:         { type: 'string' },
              nombreComercial:    { type: 'string' },
              cantidadSolicitada: { type: 'number' },
              unidad:             { type: 'string' },
              stockActual:        { type: 'number' },
              stockMinimo:        { type: 'number' },
            },
            required: ['productoId', 'nombreComercial', 'cantidadSolicitada', 'unidad'],
          },
        },
        responsableId:     { type: 'string' },
        responsableNombre: { type: 'string' },
        notas:             { type: 'string' },
        razon:             { type: 'string', description: 'Razón clara de la solicitud.' },
        prioridad:         { type: 'string', enum: ['alta', 'media', 'baja'] },
      },
      required: ['items', 'razon', 'prioridad'],
    },
  },
  {
    name: 'ejecutar_orden_compra',
    description: 'Emite una orden de compra formal a un proveedor específico directamente. Úsalo cuando el producto tiene un proveedor habitual identificado y conocido.',
    input_schema: {
      type: 'object',
      properties: {
        proveedor:          { type: 'string', description: 'Nombre del proveedor.' },
        direccionProveedor: { type: 'string' },
        fecha:              { type: 'string', description: 'YYYY-MM-DD (opcional).' },
        fechaEntrega:       { type: 'string', description: 'YYYY-MM-DD (opcional).' },
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              productoId:        { type: 'string' },
              nombreComercial:   { type: 'string' },
              ingredienteActivo: { type: 'string' },
              cantidad:          { type: 'number' },
              unidad:            { type: 'string' },
              precioUnitario:    { type: 'number' },
              iva:               { type: 'number' },
              moneda:            { type: 'string' },
            },
            required: ['nombreComercial', 'cantidad', 'unidad'],
          },
        },
        solicitudId: { type: 'string' },
        notas:       { type: 'string' },
        razon:       { type: 'string', description: 'Razón clara de la orden.' },
        prioridad:   { type: 'string', enum: ['alta', 'media', 'baja'] },
      },
      required: ['proveedor', 'items', 'razon', 'prioridad'],
    },
  },
  {
    name: 'ejecutar_notificacion',
    description: 'Envía una notificación WhatsApp a un trabajador directamente.',
    input_schema: {
      type: 'object',
      properties: {
        userId:   { type: 'string', description: 'ID del usuario destinatario (del catálogo).' },
        userName: { type: 'string', description: 'Nombre del usuario.' },
        telefono: { type: 'string', description: 'Teléfono del usuario.' },
        mensaje:  { type: 'string', description: 'Contenido del mensaje WhatsApp.' },
        razon:    { type: 'string', description: 'Razón de la notificación.' },
        prioridad:{ type: 'string', enum: ['alta', 'media', 'baja'] },
      },
      required: ['userId', 'userName', 'mensaje', 'razon', 'prioridad'],
    },
  },
];

module.exports = {
  PROPOSE_ACTION_MAP,
  EXECUTE_ACTION_MAP,
  ACTION_CATEGORY_MAP,
  AUTOPILOT_PROPOSE_TOOLS,
  AUTOPILOT_EXECUTE_TOOLS,
};
