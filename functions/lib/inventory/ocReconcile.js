// Conciliación de líneas de orden de compra (OC) ↔ líneas de recepción.
//
// Tres flujos mutan `ordenes_compra.items[].cantidadRecibida` y el `estado` de
// la OC: la recepción por factura (products/intake.js), la recepción por OC
// (procurement-invoices/receipts.js POST) y la anulación (receipts.js anular).
// Antes cada uno conciliaba de forma distinta (consume-once vs find-first vs
// "todo recibido según cantidadOC del cliente"), lo que desincronizaba el
// estado de la OC entre recepciones parciales y anulaciones.
//
// Este módulo es la ÚNICA fuente de esa lógica. Funciones puras (sin DB) para
// poder testearlas como unit. El estado se deriva SIEMPRE de la `cantidad`
// propia de la OC, nunca de un `cantidadOC` que mande el cliente.

const n = (v) => parseFloat(v) || 0;

// Empareja consume-once una línea de OC con una de recepción: primero por
// productoId; sólo si la línea de OC NO tiene productoId se cae al nombre
// comercial (ambiguo con homónimos, por eso es último recurso). Devuelve el
// índice consumido o -1.
function matchIndex(ocItem, recepcionItems, usados) {
  const pid = ocItem.productoId || null;
  const target = (ocItem.nombreComercial || '').toLowerCase().trim();
  for (let idx = 0; idx < recepcionItems.length; idx++) {
    if (usados.has(idx)) continue;
    const ri = recepcionItems[idx];
    const hit = pid
      ? ri.productoId === pid
      : (target && (ri.nombreComercial || '').toLowerCase().trim() === target);
    if (hit) { usados.add(idx); return idx; }
  }
  return -1;
}

// Recepción: ACUMULA lo recibido sobre lo previo (soporta recepciones
// parciales sucesivas). Devuelve nuevas líneas de OC (no muta las de entrada).
function reconcileReceive(ocItems, recepcionItems) {
  const usados = new Set();
  return (ocItems || []).map((ocItem) => {
    const idx = matchIndex(ocItem, recepcionItems || [], usados);
    const recibidoAhora = idx >= 0 ? n(recepcionItems[idx].cantidadRecibida) : 0;
    return { ...ocItem, cantidadRecibida: n(ocItem.cantidadRecibida) + recibidoAhora };
  });
}

// Anulación: REVIERTE lo recibido (no baja de 0). Mismo emparejamiento
// consume-once que la recepción, por simetría.
function reconcileRevert(ocItems, recepcionItems) {
  const usados = new Set();
  return (ocItems || []).map((ocItem) => {
    const idx = matchIndex(ocItem, recepcionItems || [], usados);
    if (idx < 0) return { ...ocItem };
    const revertido = n(recepcionItems[idx].cantidadRecibida);
    return { ...ocItem, cantidadRecibida: Math.max(0, n(ocItem.cantidadRecibida) - revertido) };
  });
}

// Estado derivado SOLO de la propia OC: pendiente (nada recibido), recibida
// (toda línea con cantidad>0 está cubierta) o recibida_parcialmente.
function computeEstado(items) {
  const list = items || [];
  const totalRecibido = list.reduce((s, i) => s + n(i.cantidadRecibida), 0);
  if (totalRecibido === 0) return 'pendiente';
  const allFull = list.every((i) => n(i.cantidad) === 0 || n(i.cantidadRecibida) >= n(i.cantidad));
  return allFull ? 'recibida' : 'recibida_parcialmente';
}

module.exports = { reconcileReceive, reconcileRevert, computeEstado };
