// Chat — Tool dispatcher.
//
// Sub-archivo del split de routes/chat.js. Recibe un bloque tool_use
// emitido por Claude y ejecuta la implementación correspondiente.
//
// Responsabilidades:
//   - Despachar al `chatTool*` correcto según `block.name`.
//   - Inline-handling de las tools cortas (ajustar_stock, editar_producto,
//     previsualizar_*, recordatorios) que no merecen su propio handler.
//   - Mutar `drafts` para `previsualizar_horimetro` y `previsualizar_planilla`
//     — el handler HTTP necesita esos drafts en la respuesta final.
//   - Capturar errores y devolverlos como `{ error: err.message }` para que
//     el agente pueda reaccionar dentro del mismo loop.
//
// El gating por rol (toolMinRole vs req.userRole) se hace ANTES de llamar a
// dispatchTool, en el handler. Aquí asumimos que la herramienta es ejecutable.

const { db, Timestamp } = require('../../lib/firebase');
const { verifyOwnership } = require('../../lib/helpers');
const {
  chatToolEscanarSiembra,
  chatToolRegistrarSiembras,
  chatToolConsultarDatos,
  chatToolCrearLote,
  chatToolConsultarSiembras,
  chatToolRegistrarHorimetro,
  chatToolRegistrarPermiso,
  chatToolCrearEmpleado,
  chatToolEditarEmpleado,
} = require('./toolImpls');

const PRODUCTO_EDITABLE_FIELDS = [
  'idProducto', 'nombreComercial', 'ingredienteActivo', 'tipo', 'plagaQueControla',
  'cantidadPorHa', 'unidad', 'periodoReingreso', 'periodoACosecha', 'stockMinimo',
  'precioUnitario', 'moneda', 'tipoCambio', 'proveedor',
];

const HORIMETRO_DRAFT_FIELDS = [
  'fecha', 'tractorId', 'tractorNombre', 'implemento',
  'horimetroInicial', 'horimetroFinal', 'loteId', 'loteNombre',
  'grupo', 'bloques', 'labor', 'horaInicio', 'horaFinal',
  'operarioId', 'operarioNombre',
];

// Execute a single tool_use block. `ctx` carries everything the impl might need
// from the request (fincaId, uid, image attached to the user message, etc).
// `drafts` is mutated for preview tools so the caller can include them in the
// final HTTP response payload.
async function dispatchTool(block, ctx, drafts) {
  const {
    fincaId, uid, userId, userName,
    imageBase64, mediaType,
    allowedColsList, clientTzOffset,
  } = ctx;

  try {
    switch (block.name) {
      case 'consultar_datos':
        return await chatToolConsultarDatos(block.input, fincaId, allowedColsList);

      case 'crear_lote':
        return await chatToolCrearLote(block.input, fincaId);

      case 'escanear_formulario_siembra':
        if (!imageBase64 || !mediaType) {
          return { error: 'No se adjuntó ninguna imagen. Por favor adjunta una foto del formulario.' };
        }
        return await chatToolEscanarSiembra(imageBase64, mediaType, fincaId);

      case 'registrar_siembras':
        return await chatToolRegistrarSiembras(block.input, userId, userName, fincaId);

      case 'consultar_siembras':
        return await chatToolConsultarSiembras(block.input, fincaId);

      case 'registrar_horimetro':
        return await chatToolRegistrarHorimetro(block.input, fincaId);

      case 'editar_producto': {
        const { productoId, campo, nuevoValor } = block.input;
        if (!PRODUCTO_EDITABLE_FIELDS.includes(campo)) {
          return { error: `Campo "${campo}" no permitido. Para ajustar el stock usa ajustar_stock.` };
        }
        const ownership = await verifyOwnership('productos', productoId, fincaId);
        if (!ownership.ok) return { error: ownership.message };
        const oldValue = ownership.doc.data()[campo];
        await db.collection('productos').doc(productoId).update({ [campo]: nuevoValor });
        return {
          ok: true,
          productoNombre: ownership.doc.data().nombreComercial,
          campo,
          oldValue: oldValue ?? null,
          newValue: nuevoValor,
        };
      }

      case 'ajustar_stock': {
        const { productoId, stockNuevo, nota } = block.input;
        if (!nota?.trim()) {
          return { error: 'La nota explicativa es obligatoria para ajustar el stock.' };
        }
        const ownership = await verifyOwnership('productos', productoId, fincaId);
        if (!ownership.ok) return { error: ownership.message };
        const stockAnterior = ownership.doc.data().stockActual ?? 0;
        const stockNuevoNum = parseFloat(stockNuevo);
        if (isNaN(stockNuevoNum) || stockNuevoNum < 0) {
          return { error: 'El stock debe ser un número mayor o igual a 0.' };
        }
        if (Math.abs(stockNuevoNum - stockAnterior) < 0.001) {
          return { ok: true, mensaje: 'El stock ya tiene ese valor, no se realizó ningún cambio.' };
        }
        const batch = db.batch();
        batch.update(db.collection('productos').doc(productoId), { stockActual: stockNuevoNum });
        batch.set(db.collection('movimientos').doc(), {
          fincaId, productoId,
          tipo: 'ajuste',
          cantidad: stockNuevoNum - stockAnterior,
          stockAnterior, stockNuevo: stockNuevoNum,
          nota: nota.trim(),
          fecha: new Date(),
        });
        await batch.commit();
        return {
          ok: true,
          productoNombre: ownership.doc.data().nombreComercial,
          stockAnterior,
          stockNuevo: stockNuevoNum,
          diferencia: stockNuevoNum - stockAnterior,
        };
      }

      case 'previsualizar_horimetro': {
        const filas = Array.isArray(block.input.filas) ? block.input.filas : [block.input];
        drafts.horimetroDraft = filas.map(row =>
          Object.fromEntries(Object.entries(row).filter(([k]) => HORIMETRO_DRAFT_FIELDS.includes(k)))
        );
        return {
          preview: true,
          filas: drafts.horimetroDraft.length,
          mensaje: 'Datos extraídos. El sistema mostrará una tarjeta al usuario para confirmar o editar antes de guardar.',
        };
      }

      case 'previsualizar_planilla': {
        // Assign real segment IDs and map positional cantidades array → { segId: value }.
        const rawSegs = Array.isArray(block.input.segmentos) ? block.input.segmentos : [];
        const segmentos = rawSegs.map(s => ({
          id: `s${Date.now()}${Math.random().toString(36).slice(2, 5)}`,
          loteId: s.loteId || '', loteNombre: s.loteNombre || '',
          labor: s.labor || '', grupo: s.grupo || '',
          avanceHa: s.avanceHa || '', unidad: s.unidad || '',
          costoUnitario: s.costoUnitario || '',
        }));
        const trabajadores = (Array.isArray(block.input.trabajadores) ? block.input.trabajadores : []).map(t => {
          const arr = Array.isArray(t.cantidades) ? t.cantidades : [];
          const cantidades = {};
          segmentos.forEach((seg, idx) => { cantidades[seg.id] = String(arr[idx] ?? ''); });
          return { trabajadorId: t.trabajadorId || '', trabajadorNombre: t.trabajadorNombre || '', cantidades };
        });
        drafts.planillaDraft = {
          fecha:           block.input.fecha || '',
          encargadoId:     block.input.encargadoId || '',
          encargadoNombre: block.input.encargadoNombre || '',
          segmentos, trabajadores,
          observaciones:   block.input.observaciones || '',
        };
        return {
          preview: true,
          segmentos: segmentos.length,
          trabajadores: trabajadores.length,
          mensaje: 'Datos extraídos. El sistema mostrará una tarjeta al usuario para confirmar o editar antes de guardar.',
        };
      }

      case 'crear_empleado':
        return await chatToolCrearEmpleado(block.input, fincaId);

      case 'editar_empleado':
        return await chatToolEditarEmpleado(block.input, fincaId);

      case 'registrar_permiso':
        return await chatToolRegistrarPermiso(block.input, fincaId);

      case 'crear_recordatorio': {
        const { message: rMsg, remindAt: rAt } = block.input;
        if (!rMsg?.trim() || !rAt) {
          return { error: 'Se requieren message y remindAt.' };
        }
        // If Claude returns a local time without offset (e.g. "2026-03-17T08:40:00"),
        // the UTC server would interpret it as UTC. Correct using the client's offset.
        const remindDate = /Z$|[+-]\d{2}:\d{2}$/.test(rAt)
          ? new Date(rAt)
          : new Date(new Date(rAt + 'Z').getTime() + (Number(clientTzOffset) || 0) * 60 * 1000);
        if (isNaN(remindDate.getTime())) return { error: 'Fecha inválida.' };

        const docRef = await db.collection('reminders').add({
          uid,
          fincaId,
          message: rMsg.trim(),
          remindAt: Timestamp.fromDate(remindDate),
          status: 'pending',
          createdAt: Timestamp.now(),
        });
        return { ok: true, id: docRef.id, message: rMsg.trim(), remindAt: remindDate.toISOString() };
      }

      case 'listar_recordatorios': {
        // Match the REST list: both pending (future) and delivered
        // (past-due but awaiting user resolution) count as active.
        const rSnap = await db.collection('reminders')
          .where('uid', '==', uid)
          .where('fincaId', '==', fincaId)
          .where('status', 'in', ['pending', 'delivered'])
          .get();
        const rList = rSnap.docs
          .map(d => ({ id: d.id, message: d.data().message, remindAt: d.data().remindAt?.toDate?.()?.toISOString() }))
          .sort((a, b) => new Date(a.remindAt) - new Date(b.remindAt));
        return { total: rList.length, recordatorios: rList };
      }

      case 'eliminar_recordatorio': {
        const { reminderId } = block.input;
        const rDoc = await db.collection('reminders').doc(reminderId).get();
        if (!rDoc.exists || rDoc.data().uid !== uid) {
          return { error: 'Recordatorio no encontrado o sin permiso.' };
        }
        await db.collection('reminders').doc(reminderId).delete();
        return { ok: true };
      }

      default:
        return { error: `Herramienta desconocida: ${block.name}` };
    }
  } catch (err) {
    console.error(`Error ejecutando herramienta ${block.name}:`, err);
    return { error: err.message };
  }
}

module.exports = { dispatchTool };
