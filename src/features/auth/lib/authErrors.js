/**
 * Mapea códigos de error de Firebase Auth a mensajes en español.
 *
 * Antes este switch vivía inline y duplicado en LoginPassword/Login/Register,
 * con copy divergente entre pantallas. Fuente única acá. Los códigos de
 * Firebase son estables (`auth/...`); el `fallback` es el genérico por página
 * (varía: "iniciar sesión" vs "continuar con Google").
 *
 * `auth/popup-closed-by-user` NO se mapea a propósito: las páginas lo silencian
 * (el usuario cerró el popup, no es un error que mostrar).
 */
const AUTH_ERROR_MESSAGES = {
  'auth/user-not-found': 'Email o contraseña incorrectos.',
  'auth/wrong-password': 'Email o contraseña incorrectos.',
  'auth/invalid-credential': 'Email o contraseña incorrectos.',
  'auth/too-many-requests': 'Demasiados intentos. Intenta más tarde.',
  'auth/email-already-in-use': 'Este correo ya tiene contraseña. Ingresa con correo y contraseña, luego vincula Google desde Mi perfil.',
  'auth/account-exists-with-different-credential': 'Este correo ya tiene contraseña. Ingresa con correo y contraseña, luego vincula Google desde Mi perfil.',
};

export function authErrorMessage(code, fallback = 'Ocurrió un error. Intenta de nuevo.') {
  return AUTH_ERROR_MESSAGES[code] || fallback;
}
