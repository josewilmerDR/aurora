// Helpers puros de validación de formularios. Sin React ni fetch.
// Centraliza la regex de email que antes estaba duplicada (y más débil:
// includes('@') + includes('.')) entre ForgotPassword y Register.

// Validación "suficiente para UI": no cubre el RFC entero, solo descarta typos
// obvios antes de pegarle al backend. Firebase es la red de contención final.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const isValidEmail = (email) => EMAIL_RE.test((email || '').trim());
