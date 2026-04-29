// Chat — Catalog loaders.
//
// Sub-archivo del split de routes/chat.js. Carga en paralelo las 9 colecciones
// que el system prompt necesita exponer a Claude (lotes, materiales, paquetes,
// grupos, siembras, maquinaria, users, labores, productos) y las formatea
// como bloques de texto listos para inyectar en el prompt.
//
// Devuelve también las versiones estructuradas (catalogo*) por si el caller
// las necesita (hoy solo el prompt builder consume los *Texto).

const { db } = require('../../lib/firebase');

async function loadChatCatalogs(fincaId) {
  const [lotesSnap, matsSnap, paquetesSnap, gruposSnap, siembrasSnap, maquinariaSnap, usersSnap, laboresSnap, productosSnap] = await Promise.all([
    db.collection('lotes').where('fincaId', '==', fincaId).get(),
    db.collection('materiales_siembra').where('fincaId', '==', fincaId).get(),
    db.collection('packages').where('fincaId', '==', fincaId).get(),
    db.collection('grupos').where('fincaId', '==', fincaId).get(),
    db.collection('siembras').where('fincaId', '==', fincaId).get(),
    db.collection('maquinaria').where('fincaId', '==', fincaId).get(),
    db.collection('users').where('fincaId', '==', fincaId).get(),
    db.collection('labores').where('fincaId', '==', fincaId).get(),
    db.collection('productos').where('fincaId', '==', fincaId).get(),
  ]);

  const catalogoLotes = lotesSnap.docs.map(d => ({
    id: d.id,
    codigoLote: d.data().codigoLote || '',
    nombreLote: d.data().nombreLote || '',
  }));
  const catalogoMateriales = matsSnap.docs.map(d => ({
    id: d.id,
    nombre: d.data().nombre,
    rangoPesos: d.data().rangoPesos || '',
    variedad: d.data().variedad || '',
  }));

  const lotesTexto = catalogoLotes.length
    ? catalogoLotes.map(l => {
        const parts = [`  - ID interno: "${l.id}"`];
        if (l.codigoLote) parts.push(`Código: "${l.codigoLote}"`);
        if (l.nombreLote) parts.push(`Nombre: "${l.nombreLote}"`);
        return parts.join(' | ');
      }).join('\n')
    : '  (sin lotes registrados)';
  const matsTexto = catalogoMateriales.length
    ? catalogoMateriales.map(m => `  - ID: "${m.id}" | Nombre: "${m.nombre}"${m.variedad ? ` | Variedad: "${m.variedad}"` : ''}${m.rangoPesos ? ` | Pesos: "${m.rangoPesos}"` : ''}`).join('\n')
    : '  (sin materiales registrados)';

  const catalogoPaquetes = paquetesSnap.docs.map(d => ({ id: d.id, nombre: d.data().nombrePaquete, tipo: d.data().tipoCosecha || '', etapa: d.data().etapaCultivo || '' }));
  const paquetesTexto = catalogoPaquetes.length
    ? catalogoPaquetes.map(p => `  - ID: "${p.id}" | Nombre: "${p.nombre}"${p.tipo ? ` | Tipo: "${p.tipo}"` : ''}${p.etapa ? ` | Etapa: "${p.etapa}"` : ''}`).join('\n')
    : '  (sin paquetes registrados)';

  // siembraId → {loteNombre, bloque} map para enriquecer los grupos.
  const siembraMap = {};
  siembrasSnap.docs.forEach(d => {
    siembraMap[d.id] = { loteNombre: d.data().loteNombre || '', bloque: d.data().bloque || '' };
  });
  const catalogoGrupos = gruposSnap.docs.map(d => {
    const g = d.data();
    const bloques = Array.isArray(g.bloques) ? g.bloques : [];
    const lotesEnGrupo = [...new Set(bloques.map(sid => siembraMap[sid]?.loteNombre).filter(Boolean))];
    const bloquesDetalle = bloques.map(sid => {
      const s = siembraMap[sid];
      return s ? `${s.loteNombre} bloque ${s.bloque}` : sid;
    });
    return {
      id: d.id,
      nombre: g.nombreGrupo || '',
      cosecha: g.cosecha || '',
      etapa: g.etapa || '',
      lotes: lotesEnGrupo,
      bloques: bloquesDetalle,
      totalBloques: bloques.length,
    };
  });
  const gruposTexto = catalogoGrupos.length
    ? catalogoGrupos.map(g =>
        `  - Grupo: "${g.nombre}" | ID: "${g.id}"` +
        (g.cosecha ? ` | Cosecha: ${g.cosecha}` : '') +
        (g.etapa ? ` | Etapa: ${g.etapa}` : '') +
        ` | Lotes que agrupa: [${g.lotes.join(', ') || 'sin lotes resueltos'}]` +
        ` | Bloques: [${g.bloques.join('; ')}]`
      ).join('\n')
    : '  (sin grupos registrados)';

  const catalogoMaquinaria = maquinariaSnap.docs.map(d => ({
    id: d.id, idMaquina: d.data().idMaquina || '', codigo: d.data().codigo || '',
    descripcion: d.data().descripcion || '', tipo: d.data().tipo || '',
  }));
  const tractoresTexto = (() => {
    const t = catalogoMaquinaria.filter(m => /tractor|otra maquinaria/i.test(m.tipo));
    return t.length
      ? t.map(m => `  - ID: "${m.id}" | ID Activo: "${m.idMaquina}" | Código: "${m.codigo}" | Nombre: "${m.descripcion}"`).join('\n')
      : '  (sin tractores registrados)';
  })();
  const implementosTexto = (() => {
    const t = catalogoMaquinaria.filter(m => /implemento/i.test(m.tipo));
    return t.length
      ? t.map(m => `  - ID: "${m.id}" | ID Activo: "${m.idMaquina}" | Código: "${m.codigo}" | Nombre: "${m.descripcion}"`).join('\n')
      : '  (sin implementos registrados)';
  })();

  const catalogoUsers = usersSnap.docs.map(d => ({
    id: d.id, nombre: d.data().nombre || '', rol: d.data().rol || '',
    email: d.data().email || '', telefono: d.data().telefono || '',
    empleadoPlanilla: d.data().empleadoPlanilla === true,
  }));
  const operariosTexto = catalogoUsers.length
    ? catalogoUsers.map(u => `  - ID: "${u.id}" | Nombre: "${u.nombre}" | Rol: ${u.rol} | Email: ${u.email} | Teléfono: ${u.telefono || '—'} | Planilla: ${u.empleadoPlanilla ? 'sí' : 'no'}`).join('\n')
    : '  (sin usuarios registrados)';

  const catalogoLabores = laboresSnap.docs.map(d => ({
    id: d.id, codigo: d.data().codigo || '', descripcion: d.data().descripcion || '',
  }));
  const laboresTexto = catalogoLabores.length
    ? catalogoLabores.map(l => `  - ID: "${l.id}"${l.codigo ? ` | Código: "${l.codigo}"` : ''} | Descripción: "${l.descripcion}"`).join('\n')
    : '  (sin labores registradas)';

  const catalogoProductos = productosSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const productosTexto = catalogoProductos.length
    ? catalogoProductos.map(p =>
        `  - ID: "${p.id}" | Código: "${p.idProducto || ''}" | Nombre: "${p.nombreComercial || ''}" | IngredienteActivo: "${p.ingredienteActivo || ''}" | Tipo: ${p.tipo || ''} | Plaga: "${p.plagaQueControla || ''}" | Dosis/Ha: ${p.cantidadPorHa ?? ''} | Unidad: ${p.unidad || ''} | Stock: ${p.stockActual ?? 0} | StockMin: ${p.stockMinimo ?? 0} | Precio: ${p.precioUnitario ?? ''} ${p.moneda || ''} | Proveedor: "${p.proveedor || ''}"`
      ).join('\n')
    : '  (sin productos registrados)';

  return {
    catalogoLotes, lotesTexto,
    catalogoMateriales, matsTexto,
    catalogoPaquetes, paquetesTexto,
    catalogoGrupos, gruposTexto,
    catalogoMaquinaria, tractoresTexto, implementosTexto,
    catalogoUsers, operariosTexto,
    catalogoLabores, laboresTexto,
    catalogoProductos, productosTexto,
  };
}

module.exports = { loadChatCatalogs };
