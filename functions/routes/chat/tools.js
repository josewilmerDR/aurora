// Chat — Anthropic tool definitions.
//
// Sub-archivo del split de routes/chat.js. Define el catálogo completo de
// tools que el agente Claude puede invocar dentro del endpoint /api/chat.
// Las definiciones son JSON Schema puro (input_schema) y describen tanto
// los parámetros como — vía la `description` — el contrato semántico que
// el system prompt complementa.
//
// El runtime filtra este array por rol y por módulo permitido antes de
// pasarlo a Claude (ver index.js). El dispatcher en dispatcher.js es quien
// finalmente ejecuta la implementación correspondiente al `name`.

const CHAT_TOOLS = [
  {
    name: 'consultar_datos',
    description: 'Consulta cualquier colección de Firestore de la finca para reportes, análisis y búsquedas. El filtro de fincaId se aplica automáticamente. Puedes hacer múltiples llamadas encadenadas para cruzar información entre colecciones.',
    input_schema: {
      type: 'object',
      properties: {
        coleccion: {
          type: 'string',
          enum: ['lotes', 'siembras', 'grupos', 'scheduled_tasks', 'productos', 'users', 'materiales_siembra', 'packages'],
          description: 'Colección a consultar',
        },
        filtros: {
          type: 'array',
          description: 'Filtros WHERE a aplicar (opcional)',
          items: {
            type: 'object',
            properties: {
              campo:    { type: 'string' },
              operador: { type: 'string', enum: ['==', '!=', '<', '<=', '>', '>=', 'in', 'array-contains'] },
              valor:    { description: 'Valor del filtro (string, number, boolean, o array para "in")' },
            },
            required: ['campo', 'operador', 'valor'],
          },
        },
        ordenarPor: {
          type: 'object',
          description: 'Ordenamiento opcional',
          properties: {
            campo:     { type: 'string' },
            direccion: { type: 'string', enum: ['asc', 'desc'] },
          },
          required: ['campo'],
        },
        limite: { type: 'number', description: 'Máximo de documentos a devolver (default 20, máximo 200)' },
        campos: {
          type: 'array',
          items: { type: 'string' },
          description: 'Campos a incluir en el resultado (opcional, por defecto todos)',
        },
      },
      required: ['coleccion'],
    },
  },
  {
    name: 'crear_lote',
    description: 'Crea un nuevo lote en el sistema, con sus tareas programadas si se asigna un paquete. Úsala cuando el usuario pida crear o registrar un nuevo lote.',
    input_schema: {
      type: 'object',
      properties: {
        codigoLote:    { type: 'string', description: 'Código estructurado del lote, ej: L2606. Generado automáticamente: "L" + año (2 dígitos) + número de lote (2 dígitos).' },
        nombreLote:    { type: 'string', description: 'Nombre amigable del lote, opcional. Ej: "6", "Norte", "Lote de Rojas".' },
        fechaCreacion: { type: 'string', description: 'Fecha de inicio del lote en formato YYYY-MM-DD.' },
        paqueteId:     { type: 'string', description: 'ID del paquete técnico a asignar (opcional).' },
        hectareas:     { type: 'number', description: 'Superficie del lote en hectáreas (opcional).' },
      },
      required: ['codigoLote', 'fechaCreacion'],
    },
  },
  {
    name: 'escanear_formulario_siembra',
    description: 'Escanea la imagen de formulario de siembra adjunta por el usuario y extrae los datos estructurados. Úsala cuando el usuario comparte una foto de un formulario físico de siembra.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'registrar_siembras',
    description: 'Registra filas de siembra en la base de datos. Úsala después de escanear el formulario o cuando el usuario proporcione los datos directamente.',
    input_schema: {
      type: 'object',
      properties: {
        filas: {
          type: 'array',
          description: 'Arreglo de filas de siembra a registrar',
          items: {
            type: 'object',
            properties: {
              loteId:        { type: 'string',  description: 'ID del lote en el sistema' },
              loteNombre:    { type: 'string',  description: 'Nombre del lote' },
              bloque:        { type: 'string',  description: 'Identificador del bloque' },
              plantas:       { type: 'number',  description: 'Cantidad de plantas' },
              densidad:      { type: 'number',  description: 'Densidad de siembra (pl/ha), default 65000' },
              materialId:    { type: 'string',  description: 'ID del material de siembra' },
              materialNombre:{ type: 'string',  description: 'Nombre del material' },
              rangoPesos:    { type: 'string',  description: 'Rango de pesos del material' },
              variedad:      { type: 'string',  description: 'Variedad del material' },
            },
            required: ['loteId', 'plantas', 'densidad'],
          },
        },
        fecha: { type: 'string', description: 'Fecha de siembra en formato YYYY-MM-DD. Si no se especifica, usa la fecha de hoy.' },
      },
      required: ['filas'],
    },
  },
  {
    name: 'consultar_siembras',
    description: 'Consulta los registros de siembra existentes en el sistema.',
    input_schema: {
      type: 'object',
      properties: {
        loteId: { type: 'string', description: 'Filtrar por ID de lote (opcional)' },
        limite: { type: 'number', description: 'Máximo de registros a devolver (default 10, máximo 50)' },
      },
    },
  },
  {
    name: 'registrar_horimetro',
    description: 'Registra un nuevo registro de horímetro (uso de maquinaria). Úsala cuando el usuario proporcione los datos de un registro de horímetro por texto o voz. Requiere al menos fecha y tractorId.',
    input_schema: {
      type: 'object',
      properties: {
        fecha:             { type: 'string', description: 'Fecha del registro en formato YYYY-MM-DD. Default: hoy.' },
        tractorId:         { type: 'string', description: 'ID interno del tractor (del catálogo de maquinaria).' },
        tractorNombre:     { type: 'string', description: 'Nombre/descripción del tractor.' },
        implemento:        { type: 'string', description: 'Nombre del implemento (descripcion del activo), opcional.' },
        horimetroInicial:  { type: 'number', description: 'Lectura inicial del horímetro, opcional.' },
        horimetroFinal:    { type: 'number', description: 'Lectura final del horímetro, opcional.' },
        loteId:            { type: 'string', description: 'ID interno del lote, opcional.' },
        loteNombre:        { type: 'string', description: 'Nombre del lote, opcional.' },
        grupo:             { type: 'string', description: 'Nombre del grupo (nombreGrupo), requerido si se proporciona lote.' },
        bloques:           { type: 'array', items: { type: 'string' }, description: 'Lista de bloques trabajados, opcional.' },
        labor:             { type: 'string', description: 'Descripción de la labor realizada (no el código, sino la descripción del catálogo).' },
        horaInicio:        { type: 'string', description: 'Hora de inicio en formato HH:MM (24h).' },
        horaFinal:         { type: 'string', description: 'Hora final en formato HH:MM (24h).' },
        operarioId:        { type: 'string', description: 'ID del operario, opcional.' },
        operarioNombre:    { type: 'string', description: 'Nombre del operario, opcional.' },
      },
      required: ['fecha', 'tractorId', 'tractorNombre'],
    },
  },
  {
    name: 'editar_producto',
    description: 'Edita un campo de un producto del inventario de bodega (excepto el stock actual). Úsala cuando el usuario pida cambiar el nombre, ingrediente activo, proveedor, tipo, dosis por hectárea, precio, etc.',
    input_schema: {
      type: 'object',
      properties: {
        productoId: { type: 'string', description: 'ID Firestore del producto.' },
        campo: { type: 'string', description: 'Campo técnico a editar: idProducto, nombreComercial, ingredienteActivo, tipo, plagaQueControla, cantidadPorHa, unidad, periodoReingreso, periodoACosecha, stockMinimo, precioUnitario, moneda, tipoCambio, proveedor.' },
        nuevoValor: { description: 'Nuevo valor para el campo.' },
      },
      required: ['productoId', 'campo', 'nuevoValor'],
    },
  },
  {
    name: 'ajustar_stock',
    description: 'Ajusta el stock actual de un producto del inventario. Genera un movimiento de inventario. Requiere una nota explicativa obligatoria.',
    input_schema: {
      type: 'object',
      properties: {
        productoId: { type: 'string', description: 'ID Firestore del producto.' },
        stockNuevo: { type: 'number', description: 'Nuevo valor del stock.' },
        nota: { type: 'string', description: 'Nota explicativa del ajuste (obligatoria, ej: conteo físico, pérdida, corrección).' },
      },
      required: ['productoId', 'stockNuevo', 'nota'],
    },
  },
  {
    name: 'previsualizar_horimetro',
    description: 'Extrae TODAS las filas de un formulario de horímetro desde una imagen para que el usuario las revise antes de guardar. Úsala SIEMPRE cuando el usuario envíe una imagen. Puede haber una o varias filas. NO guarda nada en la base de datos.',
    input_schema: {
      type: 'object',
      properties: {
        filas: {
          type: 'array',
          description: 'Lista de registros extraídos del formulario. Cada fila es un registro independiente.',
          items: {
            type: 'object',
            properties: {
              fecha:             { type: 'string', description: 'Fecha en formato YYYY-MM-DD.' },
              tractorId:         { type: 'string', description: 'ID interno del tractor.' },
              tractorNombre:     { type: 'string', description: 'Nombre/descripción del tractor.' },
              implemento:        { type: 'string', description: 'Nombre del implemento, opcional.' },
              horimetroInicial:  { type: 'number', description: 'Lectura inicial, opcional.' },
              horimetroFinal:    { type: 'number', description: 'Lectura final, opcional.' },
              loteId:            { type: 'string', description: 'ID del lote, opcional.' },
              loteNombre:        { type: 'string', description: 'Nombre del lote, opcional.' },
              grupo:             { type: 'string', description: 'Nombre del grupo, opcional.' },
              bloques:           { type: 'array', items: { type: 'string' }, description: 'Bloques, opcional.' },
              labor:             { type: 'string', description: 'Descripción de la labor, opcional.' },
              horaInicio:        { type: 'string', description: 'Hora inicio HH:MM (24h), opcional.' },
              horaFinal:         { type: 'string', description: 'Hora final HH:MM (24h), opcional.' },
              operarioId:        { type: 'string', description: 'ID del operario, opcional.' },
              operarioNombre:    { type: 'string', description: 'Nombre del operario, opcional.' },
            },
            required: ['fecha', 'tractorId', 'tractorNombre'],
          },
        },
      },
      required: ['filas'],
    },
  },
  {
    name: 'registrar_permiso',
    description: 'Registra un permiso, ausencia o vacaciones para un trabajador. Puede ser parcial (por horas) o de días completos. Si no se especifica horaFin para un permiso parcial, el sistema la tomará automáticamente del horario semanal del trabajador.',
    input_schema: {
      type: 'object',
      properties: {
        trabajadorId:     { type: 'string', description: 'ID Firestore del trabajador.' },
        trabajadorNombre: { type: 'string', description: 'Nombre completo del trabajador.' },
        tipo: {
          type: 'string',
          enum: ['vacaciones', 'enfermedad', 'permiso_con_goce', 'permiso_sin_goce', 'licencia'],
          description: 'Tipo de permiso.',
        },
        conGoce:    { type: 'boolean', description: 'true = con goce de salario, false = sin goce de salario.' },
        fechaInicio: { type: 'string', description: 'Fecha del permiso en formato YYYY-MM-DD.' },
        esParcial:  { type: 'boolean', description: 'true si el permiso es por horas (parcial), false si es de día(s) completo(s).' },
        horaInicio: { type: 'string', description: 'Hora de inicio HH:MM (24h). Solo para permisos parciales.' },
        horaFin:    { type: 'string', description: 'Hora de fin HH:MM (24h). Solo para permisos parciales. Si se omite, se tomará del horario del trabajador.' },
        fechaFin:   { type: 'string', description: 'Fecha de fin YYYY-MM-DD. Solo para permisos de días completos con rango. Si se omite, se usa fechaInicio.' },
        motivo:     { type: 'string', description: 'Motivo o descripción breve del permiso (opcional).' },
      },
      required: ['trabajadorId', 'trabajadorNombre', 'tipo', 'conGoce', 'fechaInicio', 'esParcial'],
    },
  },
  {
    name: 'crear_recordatorio',
    description: 'Crea un recordatorio personal y privado para el usuario actual. Solo él podrá verlo. Úsala cuando el usuario pida que se le recuerde algo en una fecha/hora futura.',
    input_schema: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'Qué debe recordarle al usuario. Redáctalo como una nota clara, ej: "Revisar la fruta del lote 7".' },
        remindAt: { type: 'string', description: 'Fecha y hora del recordatorio en formato ISO 8601 (YYYY-MM-DDTHH:MM:00). Si el usuario no especifica hora, usa T07:00:00.' },
      },
      required: ['message', 'remindAt'],
    },
  },
  {
    name: 'listar_recordatorios',
    description: 'Lista todos los recordatorios pendientes del usuario actual. Úsala cuando el usuario pregunte por sus recordatorios.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'eliminar_recordatorio',
    description: 'Elimina un recordatorio del usuario. Úsala cuando el usuario pida cancelar o borrar un recordatorio específico.',
    input_schema: {
      type: 'object',
      properties: {
        reminderId: { type: 'string', description: 'ID del recordatorio a eliminar.' },
      },
      required: ['reminderId'],
    },
  },
  {
    name: 'previsualizar_planilla',
    description: 'Extrae los datos de una planilla de trabajadores (por hora o por unidad) desde una imagen para que el usuario revise y confirme antes de guardar. Úsala SIEMPRE cuando el usuario adjunte una imagen de un formulario físico de planilla. NO guarda nada en la base de datos.',
    input_schema: {
      type: 'object',
      properties: {
        fecha:           { type: 'string', description: 'Fecha de la planilla en formato YYYY-MM-DD.' },
        encargadoId:     { type: 'string', description: 'ID del encargado en el sistema (resuelto por nombre aproximado del catálogo de usuarios).' },
        encargadoNombre: { type: 'string', description: 'Nombre del encargado tal como aparece en el formulario.' },
        segmentos: {
          type: 'array',
          description: 'Columnas de trabajo de la planilla, de izquierda a derecha. El índice de cada segmento en este array (0, 1, 2…) es su posición de columna.',
          items: {
            type: 'object',
            properties: {
              loteId:        { type: 'string', description: 'ID del lote en el sistema.' },
              loteNombre:    { type: 'string', description: 'Nombre del lote.' },
              labor:         { type: 'string', description: 'Labor en formato "codigo - descripción".' },
              grupo:         { type: 'string', description: 'Nombre del grupo, opcional.' },
              avanceHa:      { type: 'string', description: 'Avance (número como string), opcional.' },
              unidad:        { type: 'string', description: 'Unidad de medida, opcional.' },
              costoUnitario: { type: 'string', description: 'Costo unitario (número como string), opcional.' },
            },
          },
        },
        trabajadores: {
          type: 'array',
          description: 'Lista de trabajadores. Las cantidades son un array posicional: cantidades[0] es la cantidad del segmento 0 (primera columna), cantidades[1] del segmento 1, etc. Usa "" si el trabajador no trabajó esa columna.',
          items: {
            type: 'object',
            properties: {
              trabajadorId:     { type: 'string', description: 'ID del trabajador en el sistema.' },
              trabajadorNombre: { type: 'string', description: 'Nombre del trabajador.' },
              cantidades: {
                type: 'array',
                description: 'Array posicional de cantidades, una por columna en el mismo orden que segmentos. Ej: si hay 4 columnas y el trabajador trabajó 8 horas en la columna 2: ["", "", "8", ""].',
                items: { type: 'string' },
              },
            },
            required: ['trabajadorNombre', 'cantidades'],
          },
        },
        observaciones: { type: 'string', description: 'Observaciones o notas del formulario, opcional.' },
      },
      required: ['fecha'],
    },
  },
  {
    name: 'crear_empleado',
    description: 'Crea un nuevo empleado/usuario en el sistema. Úsala cuando el usuario pida agregar o registrar un nuevo trabajador. SIEMPRE pide confirmación antes de llamar esta herramienta.',
    input_schema: {
      type: 'object',
      properties: {
        nombre:           { type: 'string', description: 'Nombre completo del empleado.' },
        email:            { type: 'string', description: 'Correo electrónico del empleado.' },
        telefono:         { type: 'string', description: 'Número de teléfono (opcional).' },
        rol:              { type: 'string', enum: ['trabajador', 'encargado', 'supervisor', 'administrador'], description: 'Rol del usuario en el sistema. OBLIGATORIO.' },
        empleadoPlanilla: { type: 'boolean', description: 'true si el empleado debe recibir pago de planilla.' },
      },
      required: ['nombre', 'email', 'rol'],
    },
  },
  {
    name: 'editar_empleado',
    description: 'Modifica los datos de un empleado existente (nombre, email, teléfono, rol o estado de planilla). SIEMPRE pide confirmación antes de llamar esta herramienta.',
    input_schema: {
      type: 'object',
      properties: {
        empleadoId:       { type: 'string', description: 'ID Firestore del empleado a modificar.' },
        nombre:           { type: 'string', description: 'Nuevo nombre completo (opcional).' },
        email:            { type: 'string', description: 'Nuevo correo electrónico (opcional).' },
        telefono:         { type: 'string', description: 'Nuevo número de teléfono (opcional).' },
        rol:              { type: 'string', enum: ['trabajador', 'encargado', 'supervisor', 'administrador'], description: 'Nuevo rol en el sistema (opcional).' },
        empleadoPlanilla: { type: 'boolean', description: 'Nuevo estado de planilla: true = asignado, false = no asignado (opcional).' },
      },
      required: ['empleadoId'],
    },
  },
];

module.exports = { CHAT_TOOLS };
