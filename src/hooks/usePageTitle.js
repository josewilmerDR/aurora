import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { ALL_ITEMS, DASHBOARD_ITEM } from '../components/Sidebar';

const APP_NAME = 'Aurora';

// Pages that aren't in the sidebar (auth flow, full-screen detail views) keep
// a static title here so we don't fall back to just "Aurora" everywhere.
const STATIC_TITLES = {
  '/login': 'Iniciar sesión',
  '/login/contrasena': 'Iniciar sesión',
  '/register': 'Crear cuenta',
  '/forgot-password': 'Recuperar contraseña',
  '/nueva-organizacion': 'Nueva organización',
  '/mi-perfil': 'Mi perfil',
  '/config/cuenta': 'Configuración de cuenta',
};

// Match `/task/abc` against `/task/:taskId` style entries by trimming the
// trailing dynamic segment. Keeps the lookup table flat.
function findStaticMatch(pathname) {
  if (STATIC_TITLES[pathname]) return STATIC_TITLES[pathname];
  if (pathname.startsWith('/task/')) return 'Detalle de tarea';
  if (pathname.startsWith('/orden-compra/')) return 'Orden de compra';
  if (pathname.startsWith('/aplicaciones/cedula/')) return 'Cédula de aplicación';
  if (pathname.startsWith('/bodega/agroquimicos/recepciones/')) return 'Recepción';
  if (pathname.startsWith('/bodega/')) return 'Bodega';
  if (pathname.startsWith('/hr/planilla/fijo/reporte')) return 'Reporte de planilla';
  return null;
}

function findItemTitle(pathname) {
  if (pathname === DASHBOARD_ITEM.to) return DASHBOARD_ITEM.label;
  const item = ALL_ITEMS.find((i) => i.to === pathname);
  return item?.label || null;
}

// Set the browser tab title once, for the lifetime of the component.
// Pass `null`/empty to reset to just the app name.
export function usePageTitle(title) {
  useEffect(() => {
    document.title = title ? `${APP_NAME} — ${title}` : APP_NAME;
  }, [title]);
}

// Sets the title based on the current route, using sidebar labels or a static
// fallback for routes outside the sidebar. Call once high in the tree.
export function useAutoPageTitle() {
  const { pathname } = useLocation();
  useEffect(() => {
    const title = findItemTitle(pathname) || findStaticMatch(pathname);
    document.title = title ? `${APP_NAME} — ${title}` : APP_NAME;
  }, [pathname]);
}
