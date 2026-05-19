// Chat user-tool implementations — crear_empleado / editar_empleado.
//
// Sub-archivo del split de toolImpls.js. Aislados aquí para mantener
// toolImpls.js bajo el budget de <500 LOC y porque ambos comparten reglas
// específicas (faceta User/Employee) que no aplican al resto de tools.
//
// Las invariantes (tieneAcceso ↔ email/rol, rechazo de estado huérfano,
// monotonicidad de tuvoEmpleo, sello de fechaSalidaPlanilla en rescisión)
// son las mismas que enforce el backend HTTP en users.shared.js. Acá se
// replican inline porque la tool no atraviesa la ruta Express — escribe
// directo a Firestore desde el dispatcher.

const { db, Timestamp, FieldValue } = require('../../lib/firebase');

const ROLES_VALIDOS = ['trabajador', 'encargado', 'supervisor', 'rrhh', 'administrador'];
const EMAIL_RE_CHAT = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function chatToolCrearEmpleado(
  { nombre, email, telefono, rol, tieneAcceso, empleadoPlanilla },
  fincaId,
) {
  if (!nombre?.trim()) return { error: 'Nombre es obligatorio.' };

  const hasAccess = tieneAcceso === true;
  const onPayroll = empleadoPlanilla === true;
  if (!hasAccess && !onPayroll) {
    return { error: 'La persona debe ser usuario del sistema (tieneAcceso=true) o estar en planilla (empleadoPlanilla=true), o ambas.' };
  }

  const emailNorm = email?.trim().toLowerCase() || '';
  if (hasAccess) {
    if (!emailNorm || !EMAIL_RE_CHAT.test(emailNorm)) {
      return { error: 'Email válido es obligatorio si tieneAcceso=true.' };
    }
    if (!rol || !ROLES_VALIDOS.includes(rol)) {
      return { error: 'Rol válido (trabajador/encargado/supervisor/rrhh/administrador) es obligatorio si tieneAcceso=true.' };
    }
  } else if (emailNorm && !EMAIL_RE_CHAT.test(emailNorm)) {
    return { error: 'El email provisto no tiene formato válido.' };
  }

  // Email uniqueness only matters when the email exists. Two payroll-only
  // people with no email are allowed.
  if (emailNorm) {
    const existing = await db.collection('users')
      .where('fincaId', '==', fincaId)
      .where('email', '==', emailNorm)
      .get();
    if (!existing.empty) {
      return { error: `Ya existe una persona con el correo "${emailNorm}" en esta finca.` };
    }
  }

  const docRef = await db.collection('users').add({
    nombre: nombre.trim(),
    email: emailNorm,
    telefono: telefono?.trim() || '',
    rol: hasAccess ? rol : 'ninguno',
    tieneAcceso: hasAccess,
    empleadoPlanilla: onPayroll,
    // tuvoEmpleo is monotonic — seed it from the initial planilla state. Once
    // true, it stays true; this is what makes the doc immortal in users.js DELETE.
    tuvoEmpleo: onPayroll,
    restrictedTo: [],
    fincaId,
    createdAt: Timestamp.now(),
  });
  return {
    ok: true,
    id: docRef.id,
    nombre: nombre.trim(),
    email: emailNorm || null,
    rol: hasAccess ? rol : 'ninguno',
    tieneAcceso: hasAccess,
    empleadoPlanilla: onPayroll,
  };
}

async function chatToolEditarEmpleado(
  { empleadoId, nombre, email, telefono, rol, tieneAcceso, empleadoPlanilla },
  fincaId,
) {
  if (
    nombre === undefined && email === undefined && telefono === undefined
    && rol === undefined && tieneAcceso === undefined && empleadoPlanilla === undefined
  ) {
    return { error: 'Debes especificar al menos un campo a modificar.' };
  }
  const doc = await db.collection('users').doc(empleadoId).get();
  if (!doc.exists || doc.data().fincaId !== fincaId) {
    return { error: 'Empleado no encontrado en esta finca.' };
  }
  const current = doc.data();

  // Compute the resulting state by merging the incoming partial update over
  // current. This lets us validate the post-update invariants in one place
  // instead of branching on which fields the caller chose to send.
  const finalAccess = tieneAcceso !== undefined ? tieneAcceso === true : current.tieneAcceso === true;
  const finalPayroll = empleadoPlanilla !== undefined ? empleadoPlanilla === true : current.empleadoPlanilla === true;
  const finalRol = (() => {
    if (rol !== undefined) return rol;
    if (tieneAcceso === false) return 'ninguno';
    return current.rol;
  })();
  const finalEmail = email !== undefined ? email.trim().toLowerCase() : (current.email || '');

  if (!finalAccess && !finalPayroll) {
    return { error: 'No puedes dejar a la persona sin acceso al sistema y sin planilla. Usa otro flujo si quieres eliminar.' };
  }
  if (finalAccess) {
    if (!finalEmail || !EMAIL_RE_CHAT.test(finalEmail)) {
      return { error: 'Email válido es obligatorio para usuarios con acceso al sistema.' };
    }
    if (!finalRol || !ROLES_VALIDOS.includes(finalRol)) {
      return { error: 'Rol válido es obligatorio para usuarios con acceso al sistema.' };
    }
  }

  if (email !== undefined && finalEmail && finalEmail !== (current.email || '').toLowerCase()) {
    const dup = await db.collection('users')
      .where('fincaId', '==', fincaId)
      .where('email', '==', finalEmail)
      .limit(1)
      .get();
    if (!dup.empty && dup.docs[0].id !== empleadoId) {
      return { error: `Ya existe otra persona con el correo "${finalEmail}".` };
    }
  }

  const updates = {};
  if (nombre !== undefined) updates.nombre = nombre.trim();
  if (email !== undefined) updates.email = finalEmail;
  if (telefono !== undefined) updates.telefono = telefono.trim();
  if (rol !== undefined || tieneAcceso !== undefined) updates.rol = finalAccess ? finalRol : 'ninguno';
  if (tieneAcceso !== undefined) {
    updates.tieneAcceso = finalAccess;
    if (!finalAccess) updates.restrictedTo = [];
  }
  if (empleadoPlanilla !== undefined) {
    updates.empleadoPlanilla = finalPayroll;
    if (finalPayroll) {
      // Rehiring or first hire — clear any termination metadata and mark immortal.
      updates.tuvoEmpleo = true;
      updates.fechaSalidaPlanilla = FieldValue.delete();
      updates.motivoSalidaPlanilla = FieldValue.delete();
    } else if (current.empleadoPlanilla === true) {
      // Contract rescission via chat: stamp today's date. No motivo channel
      // available through this tool — the admin can edit via UI for richer
      // metadata, this is just the bookkeeping minimum.
      updates.fechaSalidaPlanilla = Timestamp.now();
      updates.tuvoEmpleo = true;
    }
  }

  await db.collection('users').doc(empleadoId).update(updates);

  // When access is revoked, drop the membership so the next authenticated
  // request from this person fails. Mirrors the http endpoint's behaviour.
  if (tieneAcceso === false && current.tieneAcceso !== false) {
    const targetEmail = (current.email || finalEmail || '').toLowerCase();
    if (targetEmail) {
      const memSnap = await db.collection('memberships')
        .where('fincaId', '==', fincaId)
        .where('email', '==', targetEmail)
        .limit(1)
        .get();
      if (!memSnap.empty) await memSnap.docs[0].ref.delete();
    }
  }

  return { ok: true, empleadoId, nombreActual: current.nombre, cambios: updates };
}

module.exports = { chatToolCrearEmpleado, chatToolEditarEmpleado };
