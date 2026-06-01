// Catálogo de acciones de auditoría para la UI — única fuente de verdad del
// mapeo action → etiqueta en español que consume AuditEvents.
//
// DEBE mantenerse sincronizado con el catálogo ACTIONS de
// functions/lib/auditLog.js. No podemos importar ese módulo en el bundle del
// frontend (arrastra firebase-admin), así que el contrato se defiende con un
// test guardrail (auditActions.test.js): lee el archivo del backend y falla si
// alguna acción registrada no tiene etiqueta acá. Así el drift sale en CI en
// vez de mostrarle al admin la clave cruda ("cedula.apply") en la columna de
// acción y dejarla además fuera del dropdown de filtro.
//
// Orden: agrupado igual que auditLog.js para que el dropdown refleje la misma
// taxonomía por dominio (user.*, security.*, autopilot.*, …).
export const ACTION_OPTIONS = [
  { value: '', label: 'Todas las acciones' },

  // Ciclo de vida multi-tenant
  { value: 'finca.create',                  label: 'Creación de finca' },
  { value: 'membership.claim',              label: 'Reclamación de membresía' },

  // Configuración de la finca
  { value: 'config.update',                 label: 'Configuración actualizada' },

  // Gestión de usuarios
  { value: 'user.create',                   label: 'Creación de usuario' },
  { value: 'user.update',                   label: 'Actualización de usuario' },
  { value: 'user.delete',                   label: 'Eliminación de usuario' },
  { value: 'user.role.change',              label: 'Cambio de rol' },
  { value: 'user.uid.rebind',               label: 'Reasignación de identidad' },
  { value: 'user.restrictedTo.change',      label: 'Cambio de restricciones' },
  { value: 'user.access.grant',             label: 'Acceso al sistema concedido' },
  { value: 'user.access.revoke',            label: 'Acceso al sistema revocado' },
  { value: 'user.planilla.grant',           label: 'Acceso a planilla concedido' },
  { value: 'user.planilla.revoke',          label: 'Acceso a planilla revocado' },

  // Señales de seguridad
  { value: 'security.prompt_injection.detected', label: 'Inyección de prompt' },
  { value: 'security.token.rejected',       label: 'Token rechazado' },
  { value: 'audit.export',                  label: 'Exportación del registro' },

  // Operaciones de negocio de alto valor
  { value: 'producto.delete',               label: 'Eliminación de producto' },
  { value: 'unidad_medida.delete',          label: 'Eliminación de unidad de medida' },
  { value: 'lote.delete',                   label: 'Eliminación de lote' },
  { value: 'grupo.delete',                  label: 'Eliminación de grupo' },
  { value: 'grupo.package.change',          label: 'Grupo — cambio de paquete' },
  { value: 'package.delete',                label: 'Eliminación de paquete' },
  { value: 'package.archive',               label: 'Paquete archivado' },
  { value: 'package.unarchive',             label: 'Paquete desarchivado' },
  { value: 'siembra.delete',                label: 'Eliminación de siembra' },
  { value: 'siembra.block.reopen',          label: 'Bloque reabierto' },
  { value: 'siembra.block.close',           label: 'Bloque cerrado' },
  { value: 'siembra.scan',                  label: 'Escaneo de siembra' },
  { value: 'material_siembra.update',       label: 'Material de siembra — actualización' },
  { value: 'material_siembra.delete',       label: 'Material de siembra — eliminación' },
  { value: 'stock.adjust',                  label: 'Ajuste manual de stock' },
  { value: 'payroll.pay',                   label: 'Pago de planilla' },
  { value: 'purchase_order.create',         label: 'Orden de compra creada' },
  { value: 'purchase.receipt',              label: 'Recepción de mercancía' },
  { value: 'purchase.receipt.void',         label: 'Recepción de mercancía anulada' },
  { value: 'income.create',                 label: 'Ingreso registrado' },
  { value: 'income.delete',                 label: 'Ingreso eliminado' },
  { value: 'budget.create',                 label: 'Presupuesto creado' },
  { value: 'budget.update',                 label: 'Presupuesto actualizado' },
  { value: 'budget.delete',                 label: 'Presupuesto eliminado' },
  { value: 'costo_indirecto.delete',        label: 'Costo indirecto eliminado' },
  { value: 'costo_snapshot.delete',         label: 'Snapshot de costos eliminado' },

  // Tareas programadas (cambian responsable, fecha o stock)
  { value: 'task.complete',                 label: 'Tarea completada' },
  { value: 'task.reschedule',               label: 'Tarea reprogramada' },
  { value: 'task.reassign',                 label: 'Tarea reasignada' },
  { value: 'task.skip',                     label: 'Tarea omitida' },

  // Cédulas de aplicación (documento auditable de agroquímicos)
  { value: 'cedula.generate',               label: 'Cédula generada' },
  { value: 'cedula.manual_create',          label: 'Cédula creada manualmente' },
  { value: 'cedula.mix_ready',              label: 'Mezcla lista' },
  { value: 'cedula.edit',                   label: 'Cédula editada' },
  { value: 'cedula.apply',                  label: 'Cédula aplicada' },
  { value: 'cedula.void',                   label: 'Cédula anulada' },

  // Autopilot / agente CEO
  { value: 'autopilot.pause',               label: 'Autopilot pausado' },
  { value: 'autopilot.resume',              label: 'Autopilot reanudado' },
  { value: 'autopilot.config.update',       label: 'Autopilot — config cambiada' },
  { value: 'autopilot.action.approve',      label: 'Autopilot — acción aprobada' },
  { value: 'autopilot.action.reject',       label: 'Autopilot — acción rechazada' },
  { value: 'autopilot.action.rollback',     label: 'Autopilot — rollback aplicado' },
  { value: 'autopilot.guardrail.auto_apply', label: 'Autopilot — guardrail auto-aplicado' },
  { value: 'autopilot.chain.execute',       label: 'Autopilot — cadena ejecutada' },
  { value: 'autopilot.chain.abort',         label: 'Autopilot — cadena abortada' },
];

// Lookup action → etiqueta para el render de la lista. La opción vacía ("Todas
// las acciones") no entra al mapa.
export const ACTION_LABEL = Object.fromEntries(
  ACTION_OPTIONS.filter(o => o.value).map(o => [o.value, o.label])
);
