import { useState, useEffect, useCallback } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  FiGrid, FiPackage, FiUsers, FiArchive, FiCheckSquare,
  FiDroplet, FiFileText, FiShoppingCart, FiTruck, FiLogOut,
  FiLayers, FiBox, FiSettings, FiChevronDown, FiChevronRight,
  FiStar, FiClock, FiBriefcase, FiUser, FiCalendar, FiDollarSign,
  FiAlertTriangle, FiBook, FiPaperclip, FiList, FiUserPlus, FiUmbrella,
  FiActivity, FiBarChart2,
} from 'react-icons/fi';
import { useUser, hasMinRole, ROLE_LABELS } from '../contexts/UserContext';
import './Sidebar.css';

// ─── Module definitions ───────────────────────────────────────────────────────
const MODULES = [
  {
    id: 'campo',
    nombre: 'Operaciones de Campo',
    icon: FiLayers,
    items: [
      { label: 'Panel de Control',      to: '/',            icon: FiGrid,         minRole: 'trabajador'    },
      { label: 'Seguimiento de Tareas', to: '/tasks',       icon: FiCheckSquare,  minRole: 'trabajador'    },
      { label: 'Gestión de Lotes',      to: '/lotes',       icon: FiArchive,      minRole: 'encargado'     },
      { label: 'Paquetes Técnicos',     to: '/packages',    icon: FiPackage,      minRole: 'supervisor'    },
    ],
  },
  {
    id: 'bodega',
    nombre: 'Bodega',
    icon: FiBox,
    items: [
      { label: 'Inventario Agroquímicos', to: '/productos',   icon: FiDroplet,      minRole: 'encargado'  },
      { label: 'Solicitar Compra',        to: '/solicitudes', icon: FiShoppingCart, minRole: 'encargado'  },
      { label: 'Registrar Compra',        to: '/compras',     icon: FiFileText,     minRole: 'supervisor' },
      { label: 'Recepción de Productos',  to: '/recepcion',   icon: FiTruck,        minRole: 'encargado'  },
    ],
  },
  {
    id: 'rrhh',
    nombre: 'Recursos Humanos',
    icon: FiBriefcase,
    items: [
      { label: 'Ficha del Trabajador',          to: '/hr/ficha',            icon: FiUser,          minRole: 'encargado'     },
      { label: 'Registro de Asistencia',        to: '/hr/asistencia',       icon: FiCalendar,      minRole: 'encargado'     },
      { label: 'Horas Extra',                   to: '/hr/horas-extra',      icon: FiClock,         minRole: 'encargado'     },
      { label: 'Permisos y Vacaciones',         to: '/hr/permisos',         icon: FiUmbrella,      minRole: 'encargado'     },
      { label: 'Cálculo de Planilla',           to: '/hr/planilla',         icon: FiDollarSign,    minRole: 'supervisor'    },
      { label: 'Historial de Pagos',            to: '/hr/historial-pagos',  icon: FiList,          minRole: 'supervisor'    },
      { label: 'Historial del Empleado',        to: '/hr/historial',        icon: FiBook,          minRole: 'encargado'     },
      { label: 'Documentos Adjuntos',           to: '/hr/documentos',       icon: FiPaperclip,     minRole: 'encargado'     },
      { label: 'Memorándums y Amonestaciones',  to: '/hr/memorandums',      icon: FiAlertTriangle, minRole: 'supervisor'    },
      { label: 'Solicitud de Empleo',           to: '/hr/solicitud-empleo', icon: FiUserPlus,      minRole: 'administrador' },
    ],
  },
  {
    id: 'monitoreo',
    nombre: 'Monitoreo',
    icon: FiActivity,
    items: [
      { label: 'Registrar Monitoreo',   to: '/monitoreo',          icon: FiActivity,  minRole: 'trabajador' },
      { label: 'Historial',             to: '/monitoreo/historial', icon: FiBarChart2, minRole: 'encargado'  },
      { label: 'Tipos de Monitoreo',    to: '/monitoreo/config',    icon: FiSettings,  minRole: 'supervisor' },
    ],
  },
  {
    id: 'admin',
    nombre: 'Administración',
    icon: FiSettings,
    items: [
      { label: 'Gestión de Usuarios', to: '/users', icon: FiUsers, minRole: 'administrador' },
    ],
  },
];

const ALL_ITEMS = MODULES.flatMap((m) => m.items);

// ─── localStorage helpers ─────────────────────────────────────────────────────
const getPinned  = (uid) => { try { return JSON.parse(localStorage.getItem(`aurora_pinned_${uid}`))  || []; } catch { return []; } };
const getRecents = (uid) => { try { return JSON.parse(localStorage.getItem(`aurora_recent_${uid}`))  || []; } catch { return []; } };
const savePinned  = (uid, arr) => localStorage.setItem(`aurora_pinned_${uid}`, JSON.stringify(arr));
const saveRecents = (uid, arr) => localStorage.setItem(`aurora_recent_${uid}`, JSON.stringify(arr));

// ─── Sidebar ──────────────────────────────────────────────────────────────────
const Sidebar = () => {
  const { currentUser, logout } = useUser();
  const location = useLocation();
  const navigate = useNavigate();

  const uid      = currentUser?.id   || 'guest';
  const userRole = currentUser?.rol  || 'trabajador';

  const [activeTab, setActiveTab]       = useState('favoritos');
  const [expandedMods, setExpandedMods] = useState(() => new Set());
  const [pinnedRoutes, setPinnedRoutes] = useState(() => getPinned(uid));
  const [recentRoutes, setRecentRoutes] = useState(() => getRecents(uid));
  const [stockBajoCount, setStockBajoCount]           = useState(0);
  const [tareasVencidasCount, setTareasVencidasCount] = useState(0);

  // Track recents on route change
  useEffect(() => {
    const path = location.pathname;
    if (!ALL_ITEMS.find((i) => i.to === path)) return;
    setRecentRoutes((prev) => {
      const next = [path, ...prev.filter((r) => r !== path)].slice(0, 5);
      saveRecents(uid, next);
      return next;
    });
  }, [location.pathname, uid]);

  // Badge counts
  useEffect(() => {
    fetch('/api/productos')
      .then((r) => r.json())
      .then((data) => setStockBajoCount(data.filter((p) => p.stockActual <= p.stockMinimo).length))
      .catch(() => {});
    fetch('/api/tasks/overdue-count')
      .then((r) => r.json())
      .then((data) => setTareasVencidasCount(data.count || 0))
      .catch(() => {});
  }, []);

  const canAccess   = useCallback((item) => hasMinRole(userRole, item.minRole), [userRole]);
  const itemFor     = (path) => ALL_ITEMS.find((i) => i.to === path);
  const badgeFor    = (to) => {
    if (to === '/tasks'     && tareasVencidasCount > 0) return tareasVencidasCount;
    if (to === '/productos' && stockBajoCount > 0)     return stockBajoCount;
    return null;
  };

  const toggleModule = (id) =>
    setExpandedMods((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const togglePin = (to) =>
    setPinnedRoutes((prev) => {
      const next = prev.includes(to) ? prev.filter((r) => r !== to) : [...prev, to];
      savePinned(uid, next);
      return next;
    });

  // ── Single nav item ──────────────────────────────────────────────────────
  const NavItem = ({ item, showPinBtn = false }) => {
    const Icon   = item.icon;
    const badge  = badgeFor(item.to);
    const pinned = pinnedRoutes.includes(item.to);

    return (
      <div className="sidebar-item-row">
        <NavLink
          to={item.to}
          end={item.to === '/'}
          className={({ isActive }) => `sidebar-link${isActive ? ' active' : ''}`}
          title={item.label}
        >
          <Icon size={20} />
          <span className="link-text">{item.label}</span>
          {badge !== null && <span className="sidebar-badge">{badge}</span>}
        </NavLink>
        {showPinBtn && (
          <button
            className={`pin-btn${pinned ? ' pinned' : ''}`}
            onClick={(e) => { e.stopPropagation(); togglePin(item.to); }}
            title={pinned ? 'Quitar de favoritos' : 'Agregar a favoritos'}
          >
            <FiStar size={14} />
          </button>
        )}
      </div>
    );
  };

  // ── Favoritos tab ────────────────────────────────────────────────────────
  const FavoritosTab = () => {
    const pinnedItems = pinnedRoutes.map(itemFor).filter(Boolean).filter(canAccess);
    const recentItems = recentRoutes.map(itemFor).filter(Boolean).filter(canAccess)
                          .filter((i) => !pinnedRoutes.includes(i.to));

    return (
      <div className="tab-content">
        <div className="sidebar-section">
          <div className="sidebar-section-header">
            <FiStar size={13} />
            <span>Fijados</span>
          </div>
          {pinnedItems.length === 0 ? (
            <p className="sidebar-empty-hint">
              Ve a{' '}
              <button className="inline-link" onClick={() => setActiveTab('todas')}>
                Todas las funciones
              </button>{' '}
              y fija las que más usas.
            </p>
          ) : (
            pinnedItems.map((item) => <NavItem key={item.to} item={item} />)
          )}
        </div>

        <div className="sidebar-section">
          <div className="sidebar-section-header">
            <FiClock size={13} />
            <span>Recientes</span>
          </div>
          {recentItems.length === 0 ? (
            <p className="sidebar-empty-hint">Aquí aparecerán las páginas que visites.</p>
          ) : (
            recentItems.map((item) => <NavItem key={item.to} item={item} />)
          )}
        </div>
      </div>
    );
  };

  // ── Todas las funciones tab ──────────────────────────────────────────────
  const TodasTab = () => (
    <div className="tab-content">
      {MODULES.map((mod) => {
        const visibleItems = mod.items.filter(canAccess);
        if (visibleItems.length === 0) return null;
        const expanded = expandedMods.has(mod.id);
        const ModIcon  = mod.icon;

        return (
          <div key={mod.id} className="sidebar-module">
            <button className="module-header" onClick={() => toggleModule(mod.id)}>
              <ModIcon size={15} />
              <span>{mod.nombre}</span>
              {expanded ? <FiChevronDown size={13} /> : <FiChevronRight size={13} />}
            </button>
            {expanded && (
              <div className="module-items">
                {visibleItems.map((item) => <NavItem key={item.to} item={item} showPinBtn />)}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );

  // ── Main render ──────────────────────────────────────────────────────────
  return (
    <nav className="sidebar">
      <div className="sidebar-header">
        <span className="sidebar-logo-text">AU</span>
      </div>

      <div className="sidebar-tabs">
        <button
          className={`sidebar-tab${activeTab === 'favoritos' ? ' active' : ''}`}
          onClick={() => setActiveTab('favoritos')}
        >
          Favoritos
        </button>
        <button
          className={`sidebar-tab${activeTab === 'todas' ? ' active' : ''}`}
          onClick={() => setActiveTab('todas')}
        >
          Todas las funciones
        </button>
      </div>

      <div className="sidebar-links">
        {activeTab === 'favoritos' ? <FavoritosTab /> : <TodasTab />}
      </div>

      <div className="sidebar-footer">
        <div className="sidebar-user">
          <div className="sidebar-user-info">
            <span className="sidebar-user-name link-text">{currentUser?.nombre || 'Usuario'}</span>
            <span className="sidebar-user-role link-text">
              {ROLE_LABELS[currentUser?.rol] || 'Sin rol'}
            </span>
          </div>
          <button
            className="sidebar-logout-btn"
            onClick={() => navigate('/logout')}
            title="Cerrar sesión"
          >
            <FiLogOut size={18} />
          </button>
        </div>
      </div>
    </nav>
  );
};

export default Sidebar;
