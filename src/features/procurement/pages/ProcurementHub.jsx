import { NavLink, Outlet } from 'react-router-dom';
import '../styles/procurement-hub.css';

// Unified entry point for the Compras workflow. Sidebar links here and the
// hub renders a tab strip + an <Outlet />, so each inner page (Dashboard,
// Órdenes, Cotizaciones, Proveedores) keeps its own header and stylesheet.
//
// Old standalone URLs (/ordenes-compra, /proveedores, /procurement/rfqs,
// /procurement/dashboard) still resolve via redirects in App.jsx so existing
// bookmarks and notifications keep working.
const TABS = [
  { to: '/procurement',              label: 'Resumen',      end: true },
  { to: '/procurement/ordenes',      label: 'Órdenes' },
  { to: '/procurement/cotizaciones', label: 'Cotizaciones' },
  { to: '/procurement/proveedores',  label: 'Proveedores' },
];

export default function ProcurementHub() {
  return (
    <div className="procurement-hub">
      <nav className="procurement-hub-tabs" role="tablist" aria-label="Compras">
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            className={({ isActive }) =>
              `procurement-hub-tab${isActive ? ' is-active' : ''}`
            }
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>
      <div className="procurement-hub-body">
        <Outlet />
      </div>
    </div>
  );
}
