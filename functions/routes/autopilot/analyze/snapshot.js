// Autopilot/analyze — carga del snapshot inicial.
//
// Sub-archivo del split de routes/autopilot/analyze.js. Hace 6 queries
// paralelas al estado de la finca y produce dos representaciones de texto:
//
//   - snapshotText          plano (sin IDs internos), consumido por nivel1
//                            donde el modelo solo da recomendaciones de texto.
//   - snapshotTextEnriched  con [ID: xxx] inline, requerido por nivel2/3
//                            para que el modelo use los IDs correctos en sus
//                            tool calls.
//
// También devuelve los lookup maps (taskLoteMap, productStockMap) que el
// nivel3 necesita para evaluar guardrails antes de ejecutar.

const { db, Timestamp } = require('../../../lib/firebase');

async function loadAnalyzeSnapshot(fincaId) {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const fourteenDaysAhead = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

  const [tasksSnap, productosSnap, monitoreosSnap, lotesSnap, usersSnap, proveedoresSnap] = await Promise.all([
    db.collection('scheduled_tasks').where('fincaId', '==', fincaId).get(),
    db.collection('productos').where('fincaId', '==', fincaId).get(),
    db.collection('monitoreos')
      .where('fincaId', '==', fincaId)
      .where('fecha', '>=', Timestamp.fromDate(thirtyDaysAgo))
      .orderBy('fecha', 'desc')
      .limit(50)
      .get(),
    db.collection('lotes').where('fincaId', '==', fincaId).get(),
    db.collection('users').where('fincaId', '==', fincaId).get(),
    db.collection('proveedores').where('fincaId', '==', fincaId).get(),
  ]);

  const todayDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const overdueTasks = [];
  const upcomingTasks = [];
  tasksSnap.docs.forEach(doc => {
    const t = doc.data();
    if (['completed_by_user', 'skipped'].includes(t.status)) return;
    if (t.type === 'REMINDER_3_DAY') return;
    const due = t.executeAt?.toDate?.() || null;
    if (!due) return;
    const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate());
    const taskInfo = {
      id: doc.id,
      nombre: t.activity?.name || '—',
      dueDate: due.toISOString().split('T')[0],
      responsableId: t.activity?.responsableId || null,
      loteId: t.loteId || null,
    };
    if (dueDay < todayDay) {
      overdueTasks.push(taskInfo);
    } else if (due <= fourteenDaysAhead) {
      upcomingTasks.push(taskInfo);
    }
  });

  const lowStockProductos = productosSnap.docs
    .filter(doc => {
      const d = doc.data();
      return (d.stockActual ?? 0) <= (d.stockMinimo ?? 0);
    })
    .map(doc => {
      const d = doc.data();
      return {
        id: doc.id,
        nombre: d.nombreComercial || '—',
        ingredienteActivo: d.ingredienteActivo || '',
        stockActual: d.stockActual ?? 0,
        stockMinimo: d.stockMinimo ?? 0,
        unidad: d.unidad || '',
        proveedor: d.proveedor || '',
      };
    });

  const recentMonitoreos = monitoreosSnap.docs.map(doc => {
    const d = doc.data();
    return {
      loteNombre: d.loteNombre || '—',
      tipoNombre: d.tipoNombre || '—',
      fecha: d.fecha?.toDate?.()?.toISOString().split('T')[0] || '—',
    };
  });

  const activeLotes = lotesSnap.docs.map(doc => {
    const d = doc.data();
    return { id: doc.id, codigo: d.codigoLote || '', nombre: d.nombreLote || '', hectareas: d.hectareas || null };
  });

  // catalogoUsers no se usa en text rendering pero se mantiene en la API
  // por si nivel2/3 lo necesitan para resolver IDs por nombre.
  const catalogoUsers = usersSnap.docs.map(doc => {
    const d = doc.data();
    return { id: doc.id, nombre: d.nombre || '', rol: d.rol || '', telefono: d.telefono || '' };
  });

  const catalogoProveedores = proveedoresSnap.docs
    .map(doc => {
      const d = doc.data();
      return {
        id: doc.id,
        nombre: d.nombre || '',
        direccion: d.direccion || '',
        tipoPago: d.tipoPago || '',
        moneda: d.moneda || '',
        estado: d.estado || 'activo',
        categoria: d.categoria || '',
      };
    })
    .filter(p => p.nombre && p.estado !== 'inactivo');

  const snapshot = {
    overdueTasksCount: overdueTasks.length,
    upcomingTasksCount: upcomingTasks.length,
    lowStockCount: lowStockProductos.length,
    recentMonitoreosCount: recentMonitoreos.length,
    activeLotesCount: activeLotes.length,
  };

  // Texto plano (sin IDs) — consumido por nivel1 que sólo recomienda texto.
  const snapshotText = `
## Estado actual de la finca (fecha: ${now.toISOString().split('T')[0]})

**Lotes activos (${activeLotes.length}):**
${activeLotes.length ? activeLotes.map(l => `  - ${l.codigo ? l.codigo + ' ' : ''}"${l.nombre}"${l.hectareas ? ` | ${l.hectareas} ha` : ''}`).join('\n') : '  (sin lotes registrados)'}

**Tareas vencidas (${overdueTasks.length}):**
${overdueTasks.length ? overdueTasks.slice(0, 15).map(t => `  - "${t.nombre}" — vencida el ${t.dueDate}`).join('\n') : '  (sin tareas vencidas)'}

**Tareas próximas — próximos 14 días (${upcomingTasks.length}):**
${upcomingTasks.length ? upcomingTasks.slice(0, 15).map(t => `  - "${t.nombre}" — programada para ${t.dueDate}`).join('\n') : '  (sin tareas próximas)'}

**Productos con stock bajo o agotado (${lowStockProductos.length}):**
${lowStockProductos.length ? lowStockProductos.map(p => `  - ${p.nombre} | Stock actual: ${p.stockActual} ${p.unidad} | Mínimo: ${p.stockMinimo} ${p.unidad}${p.proveedor ? ` | Proveedor habitual: "${p.proveedor}"` : ' | Sin proveedor habitual'}`).join('\n') : '  (todos los productos tienen stock suficiente)'}

**Monitoreos recientes — últimos 30 días (${recentMonitoreos.length}):**
${recentMonitoreos.length ? recentMonitoreos.slice(0, 10).map(m => `  - ${m.tipoNombre} en ${m.loteNombre} el ${m.fecha}`).join('\n') : '  (sin monitoreos recientes)'}

**Proveedores activos (${catalogoProveedores.length}):**
${catalogoProveedores.length ? catalogoProveedores.slice(0, 15).map(p => `  - "${p.nombre}"${p.categoria ? ` | ${p.categoria}` : ''}`).join('\n') : '  (sin proveedores registrados)'}
`.trim();

  // Texto enriquecido con IDs internos — requerido por nivel2/3 para tool_use.
  const snapshotTextEnriched = `
## Estado actual de la finca (fecha: ${now.toISOString().split('T')[0]})

**Lotes activos (${activeLotes.length}):**
${activeLotes.length ? activeLotes.map(l => `  - [ID: ${l.id}] ${l.codigo ? l.codigo + ' ' : ''}"${l.nombre}"${l.hectareas ? ` | ${l.hectareas} ha` : ''}`).join('\n') : '  (sin lotes registrados)'}

**Tareas vencidas (${overdueTasks.length}):**
${overdueTasks.length ? overdueTasks.slice(0, 15).map(t => `  - [ID: ${t.id}] "${t.nombre}" — vencida el ${t.dueDate}${t.responsableId ? ` (responsable: ${t.responsableId})` : ''}`).join('\n') : '  (sin tareas vencidas)'}

**Tareas próximas — próximos 14 días (${upcomingTasks.length}):**
${upcomingTasks.length ? upcomingTasks.slice(0, 15).map(t => `  - [ID: ${t.id}] "${t.nombre}" — programada para ${t.dueDate}${t.responsableId ? ` (responsable: ${t.responsableId})` : ''}`).join('\n') : '  (sin tareas próximas)'}

**Productos con stock bajo o agotado (${lowStockProductos.length}):**
${lowStockProductos.length ? lowStockProductos.map(p => `  - [ID: ${p.id}] ${p.nombre}${p.ingredienteActivo ? ` (${p.ingredienteActivo})` : ''} | Stock actual: ${p.stockActual} ${p.unidad} | Mínimo: ${p.stockMinimo} ${p.unidad}${p.proveedor ? ` | Proveedor habitual: "${p.proveedor}"` : ' | Sin proveedor habitual'}`).join('\n') : '  (todos los productos tienen stock suficiente)'}

**Monitoreos recientes — últimos 30 días (${recentMonitoreos.length}):**
${recentMonitoreos.length ? recentMonitoreos.slice(0, 10).map(m => `  - ${m.tipoNombre} en ${m.loteNombre} el ${m.fecha}`).join('\n') : '  (sin monitoreos recientes)'}

**Proveedores activos (${catalogoProveedores.length}):**
${catalogoProveedores.length ? catalogoProveedores.slice(0, 15).map(p => `  - [ID: ${p.id}] "${p.nombre}"${p.categoria ? ` | ${p.categoria}` : ''}`).join('\n') : '  (sin proveedores registrados)'}
`.trim();

  // Lookup maps usados sólo por nivel3 para guardrails.
  const taskLoteMap = {};
  tasksSnap.docs.forEach(doc => { taskLoteMap[doc.id] = doc.data().loteId || null; });
  const productStockMap = {};
  productosSnap.docs.forEach(doc => { productStockMap[doc.id] = doc.data().stockActual ?? 0; });

  return {
    snapshot,
    snapshotText,
    snapshotTextEnriched,
    taskLoteMap,
    productStockMap,
    catalogoUsers,
  };
}

module.exports = { loadAnalyzeSnapshot };
