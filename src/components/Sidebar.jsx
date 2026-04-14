import { useState, useEffect, useCallback } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  FiHome, FiGrid, FiPackage, FiUsers, FiArchive,
  FiDroplet, FiFileText, FiTruck, FiLogOut, FiPlusCircle,
  FiLayers, FiBox, FiSettings, FiChevronDown, FiChevronRight,
  FiStar, FiClock, FiBriefcase, FiUser, FiCalendar, FiDollarSign,
  FiAlertTriangle, FiPaperclip, FiList, FiUmbrella,
  FiActivity, FiBarChart2, FiSliders, FiSunrise, FiTool, FiTrendingUp,
  FiCpu,
} from 'react-icons/fi';

// Mapa de iconos para bodegas genéricas (clave string → componente)
const BODEGA_ICON_MAP = { FiBox, FiTool, FiTruck, FiDroplet, FiPackage };
const getBodegaIcon = (key) => BODEGA_ICON_MAP[key] || FiBox;
import { useUser, hasMinRole, ROLE_LABELS } from '../contexts/UserContext';
import { useApiFetch } from '../hooks/useApiFetch';
import './Sidebar.css';

// ─── Module definitions ───────────────────────────────────────────────────────
export const DASHBOARD_ITEM = { label: 'Home', to: '/', icon: FiHome, minRole: 'trabajador' };

export const MODULES = [
  {
    id: 'campo',
    nombre: 'Operaciones de Campo',
    icon: FiLayers,
    items: [

      {
        label: 'Siembra', icon: FiSunrise, minRole: 'encargado', children: [
          { label: 'Registro de Siembra', to: '/siembra', icon: FiSunrise, minRole: 'encargado', draftKey: 'siembra-registro' },
          { label: 'Historial de Siembra', to: '/siembra/historial', icon: FiBarChart2, minRole: 'encargado' },
        ]
      },
      {
        label: 'Aplicaciones', icon: FiPackage, minRole: 'encargado', children: [
          { label: 'Cédulas de Aplicación',   to: '/aplicaciones/cedulas',   icon: FiFileText, minRole: 'encargado' },
          { label: 'Historial de Aplicaciones', to: '/aplicaciones/historial', icon: FiList,     minRole: 'encargado' },
          { label: 'Paquetes de Aplicaciones', to: '/packages', icon: FiPackage, minRole: 'supervisor' },
        ]
      },
      {
        label: 'Cosecha', icon: FiTrendingUp, minRole: 'encargado', children: [
          { label: 'Registro de Cosecha',    to: '/cosecha/registro',            icon: FiPlusCircle, minRole: 'encargado' },
          { label: 'Despacho de Cosecha',    to: '/cosecha/despacho',            icon: FiTruck,      minRole: 'encargado' },
          { label: 'Proyección de Cosecha',  to: '/cosecha/proyeccion',          icon: FiBarChart2,  minRole: 'encargado' },
          { label: 'Historial de Cosecha',   to: '/cosecha/historial',           icon: FiList,       minRole: 'encargado' },
          { label: 'Historial de Despachos', to: '/cosecha/historial-despachos', icon: FiList,       minRole: 'encargado' },
        ]
      },
      {
        label: 'Horímetros', icon: FiClock, minRole: 'trabajador', children: [
          { label: 'Registro de Horímetro',   to: '/operaciones/horimetro/registro',  icon: FiClock,  minRole: 'trabajador', draftKey: 'horimetro-registro' },
          { label: 'Historial de Horímetros', to: '/operaciones/horimetro/historial', icon: FiList,   minRole: 'trabajador' },
        ]
      },
      { label: 'Lotes', to: '/lotes', icon: FiArchive, minRole: 'encargado', draftKey: 'lote-nuevo' },
      { label: 'Grupos', to: '/grupos', icon: FiLayers, minRole: 'encargado' },
    ],
  },
  {
    id: 'bodega',
    nombre: 'Bodega',
    icon: FiBox,
    items: [
      {
        label: 'Agroquímicos', icon: FiDroplet, minRole: 'encargado',
        children: [
          { label: 'Existencias', to: '/bodega/agroquimicos/existencias', icon: FiDroplet, minRole: 'encargado', draftKey: ['inv-productos', 'nuevo-producto'] },
          { label: 'Recepción de Mercancía', to: '/bodega/agroquimicos/recepcion', icon: FiPlusCircle, minRole: 'encargado' },
          { label: 'Historial de Movimientos', to: '/bodega/agroquimicos/movimientos', icon: FiList, minRole: 'encargado' },
        ],
      },
    ],
  },
  {
    id: 'rrhh',
    nombre: 'Recursos Humanos',
    icon: FiBriefcase,
    items: [
      { label: 'Ficha del Trabajador', to: '/hr/ficha', icon: FiUser, minRole: 'encargado', draftKey: 'hr-ficha' },
      { label: 'Permisos y Vacaciones', to: '/hr/permisos', icon: FiUmbrella, minRole: 'encargado' },
      { label: 'Planilla', icon: FiDollarSign, minRole: 'encargado', children: [
        { label: 'Salario Fijo', to: '/hr/planilla/fijo', icon: FiDollarSign, minRole: 'encargado' },
        { label: 'Salario por Unidad', to: '/hr/planilla/horas', icon: FiClock, minRole: 'encargado', draftKey: 'hr-planilla-unidad' },
        { label: 'Historial Salario Fijo', to: '/hr/historial-pagos', icon: FiList, minRole: 'supervisor' },
        { label: 'Historial Salario por Unidad', to: '/hr/planilla/horas/historial', icon: FiList, minRole: 'encargado' },
      ]},
    ],
  },
  {
    id: 'monitoreo',
    nombre: 'Monitoreo',
    icon: FiActivity,
    items: [
      { label: 'Historial', to: '/monitoreo/historial', icon: FiBarChart2, minRole: 'encargado' },
      { label: 'Muestreos', to: '/monitoreo/muestreos', icon: FiList, minRole: 'encargado' },
      { label: 'Plantillas de Muestreo', to: '/monitoreo/config', icon: FiSettings, minRole: 'supervisor' },
      { label: 'Paquetes de Muestreos', to: '/monitoreo/paquetes', icon: FiPackage, minRole: 'supervisor' },
    ],
  },
  {
    id: 'contabilidad',
    nombre: 'Contabilidad y Finanzas',
    icon: FiDollarSign,
    items: [
      { label: 'Centro de Costos', to: '/costos', icon: FiBarChart2, minRole: 'encargado' },
      { label: 'Órdenes de Compra', to: '/ordenes-compra', icon: FiFileText, minRole: 'encargado', draftKey: 'oc-nueva' },
      { label: 'Proveedores', to: '/proveedores', icon: FiTruck, minRole: 'encargado', draftKey: 'proveedor-nuevo' },
    ],
  },
  {
    id: 'admin',
    nombre: 'Administración del Sistema',
    icon: FiSettings,
    items: [
      { label: 'Configuración Inicial', to: '/admin/config-inicial', icon: FiSettings, minRole: 'administrador' },
      { label: 'Gestión de Usuarios', to: '/users', icon: FiUsers, minRole: 'administrador', draftKey: 'user-mgmt' },
      { label: 'Lista de Activos', to: '/admin/maquinaria', icon: FiTool, minRole: 'supervisor', draftKey: 'maquinaria-activo' },
      { label: 'Cierre de Combustible', to: '/admin/cierre-combustible', icon: FiDroplet, minRole: 'administrador' },
      { label: 'Lista de Labores', to: '/admin/labores', icon: FiList, minRole: 'supervisor' },
      { label: 'Unidades de Medida', to: '/admin/unidades-medida', icon: FiPackage, minRole: 'supervisor' },
      { label: 'Parámetros y KPI', to: '/admin/parametros', icon: FiSliders, minRole: 'administrador' },
      { label: 'Calibraciones', to: '/admin/calibraciones', icon: FiDroplet, minRole: 'supervisor', draftKey: 'calibraciones' },
    ],
  },
  {
    id: 'autopilot',
    nombre: 'Piloto Automático',
    icon: FiCpu,
    items: [
      { label: 'Panel', to: '/autopilot', icon: FiCpu, minRole: 'encargado' },
      { label: 'Configuración', to: '/autopilot/configuracion', icon: FiSettings, minRole: 'supervisor' },
    ],
  },
];

export const ALL_ITEMS = [
  DASHBOARD_ITEM,
  ...MODULES.flatMap((m) => m.items.flatMap((item) => item.children ? item.children : [item])),
];

// ─── localStorage helpers ─────────────────────────────────────────────────────
export const getPinned  = (uid) => { try { return JSON.parse(localStorage.getItem(`aurora_pinned_${uid}`)) || []; } catch { return []; } };
export const getRecents = (uid) => { try { return JSON.parse(localStorage.getItem(`aurora_recent_${uid}`)) || []; } catch { return []; } };
export const savePinned  = (uid, arr) => localStorage.setItem(`aurora_pinned_${uid}`, JSON.stringify(arr));
export const saveRecents = (uid, arr) => localStorage.setItem(`aurora_recent_${uid}`, JSON.stringify(arr));

// ─── Sidebar ──────────────────────────────────────────────────────────────────
const Sidebar = ({ isCollapsed, toggleCollapse }) => {
  const apiFetch = useApiFetch();
  const { currentUser, firebaseUser, logout } = useUser();
  const location = useLocation();
  const navigate = useNavigate();

  const uid = currentUser?.id || 'guest';
  const userRole = currentUser?.rol || 'trabajador';

  const [activeTab, setActiveTab] = useState('favoritos');
  const [expandedMods, setExpandedMods] = useState(() => new Set());
  const [expandedGroups, setExpandedGroups] = useState(() => new Set());
  const [pinnedRoutes, setPinnedRoutes] = useState(() => getPinned(uid));
  const [recentRoutes, setRecentRoutes] = useState(() => getRecents(uid));
  const [stockBajoCount, setStockBajoCount] = useState(0);
  const [tareasVencidasCount, setTareasVencidasCount] = useState(0);
  const [genericBodegas, setGenericBodegas] = useState([]);

  const fetchGenericBodegas = useCallback(() => {
    apiFetch('/api/bodegas')
      .then(r => r.json())
      .then(data => setGenericBodegas(data.filter(b => b.tipo !== 'agroquimicos')))
      .catch(() => {});
  }, [apiFetch]);
  const readActiveDrafts = () => {
    try {
      return new Set(
        Object.keys(sessionStorage)
          .filter(k => k.startsWith('aurora_draftActive_'))
          .map(k => k.replace('aurora_draftActive_', ''))
      );
    } catch { return new Set(); }
  };
  const [activeDrafts, setActiveDrafts] = useState(readActiveDrafts);
  useEffect(() => {
    const handler = () => setActiveDrafts(readActiveDrafts());
    window.addEventListener('aurora-draft-change', handler);
    return () => window.removeEventListener('aurora-draft-change', handler);
  }, []);

  // Soporta draftKey como string o array de strings
  const checkDraft = (key) =>
    Array.isArray(key) ? key.some(k => activeDrafts.has(k)) : activeDrafts.has(key);

  // Track recents on route change
  useEffect(() => {
    const path = location.pathname;
    if (!ALL_ITEMS.find((i) => i.to === path)) return;
    setRecentRoutes((prev) => {
      const next = [path, ...prev.filter((r) => r !== path)].slice(0, 5);
      saveRecents(uid, next);
      // If already in list, save the new order to localStorage but keep
      // the displayed order stable so items don't jump while navigating.
      if (prev.includes(path)) return prev;
      return next;
    });
  }, [location.pathname, uid]);

  // Badge counts
  const refreshOverdueCount = useCallback(() => {
    const archivedIds = new Set(
      JSON.parse(localStorage.getItem(`aurora_archived_tasks_${firebaseUser?.uid || 'guest'}`) || '[]')
    );
    const today = new Date();
    const todayDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    apiFetch('/api/tasks')
      .then((r) => r.json())
      .then((tasks) => {
        const count = tasks.filter(t =>
          t.type !== 'REMINDER_3_DAY' &&
          !['completed_by_user', 'skipped'].includes(t.status) &&
          !archivedIds.has(t.id) &&
          new Date(new Date(t.dueDate).getFullYear(), new Date(t.dueDate).getMonth(), new Date(t.dueDate).getDate()) < todayDay
        ).length;
        setTareasVencidasCount(count);
      })
      .catch(() => { });
  }, [apiFetch, firebaseUser?.uid]);

  useEffect(() => {
    apiFetch('/api/productos')
      .then((r) => r.json())
      .then((data) => setStockBajoCount(data.filter((p) => p.stockActual <= p.stockMinimo).length))
      .catch(() => { });
    refreshOverdueCount();
    fetchGenericBodegas();
  }, []);

  useEffect(() => {
    window.addEventListener('aurora-bodegas-changed', fetchGenericBodegas);
    return () => window.removeEventListener('aurora-bodegas-changed', fetchGenericBodegas);
  }, [fetchGenericBodegas]);

  useEffect(() => {
    window.addEventListener('aurora-tasks-changed', refreshOverdueCount);
    return () => window.removeEventListener('aurora-tasks-changed', refreshOverdueCount);
  }, [refreshOverdueCount]);

  const canAccess = useCallback((item) => hasMinRole(userRole, item.minRole), [userRole]);
  const itemFor = (path) => ALL_ITEMS.find((i) => i.to === path);
  const badgeFor = (to) => {
    if (to === '/' && tareasVencidasCount > 0) return tareasVencidasCount;
    if (to === '/bodega/agroquimicos/existencias' && stockBajoCount > 0) return stockBajoCount;
    return null;
  };

  const toggleModule = (id) =>
    setExpandedMods((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const toggleGroup = (label) =>
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      next.has(label) ? next.delete(label) : next.add(label);
      return next;
    });

  const togglePin = (to) =>
    setPinnedRoutes((prev) => {
      const next = prev.includes(to) ? prev.filter((r) => r !== to) : [...prev, to];
      savePinned(uid, next);
      return next;
    });

  // ── Collapsible sub-group ────────────────────────────────────────────────
  const GroupItem = ({ item }) => {
    const visibleChildren = item.children.filter(canAccess);
    if (!visibleChildren.length) return null;
    const expanded = expandedGroups.has(item.label);
    const isChildActive = visibleChildren.some(c => location.pathname === c.to);
    const GroupIcon = item.icon;
    const groupHasDraft = visibleChildren.some(c => c.draftKey && checkDraft(c.draftKey));

    return (
      <div className="sidebar-subgroup">
        <button
          className={`sidebar-subgroup-header${isChildActive ? ' subgroup-child-active' : ''}`}
          onClick={() => toggleGroup(item.label)}
        >
          <span className="icon-wrap">
            <GroupIcon size={18} />
            {groupHasDraft && <span className="draft-dot" title="Borrador en progreso" />}
          </span>
          <span className="link-text">{item.label}</span>
          {expanded ? <FiChevronDown size={12} /> : <FiChevronRight size={12} />}
        </button>
        {expanded && (
          <div className="sidebar-subgroup-items">
            {visibleChildren.map((child) => <NavItem key={child.to} item={child} showPinBtn />)}
          </div>
        )}
      </div>
    );
  };

  // ── Single nav item ──────────────────────────────────────────────────────
  const NavItem = ({ item, showPinBtn = false }) => {
    const Icon = item.icon;
    const badge = badgeFor(item.to);
    const pinned = pinnedRoutes.includes(item.to);
    const hasDraft = item.draftKey && checkDraft(item.draftKey);

    return (
      <div className="sidebar-item-row">
        <NavLink
          to={item.to}
          end
          className={({ isActive }) => `sidebar-link${isActive ? ' active' : ''}`}
          title={item.label}
        >
          <span className="icon-wrap">
            <Icon size={20} />
            {hasDraft && <span className="draft-dot" title="Borrador en progreso" />}
          </span>
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
      {canAccess(DASHBOARD_ITEM) && (
        <div className="sidebar-toplevel">
          <NavItem item={DASHBOARD_ITEM} showPinBtn />
        </div>
      )}
      {MODULES.map((mod) => {
        const visibleItems = mod.items.filter(canAccess);
        if (visibleItems.length === 0) return null;
        const expanded = expandedMods.has(mod.id);
        const ModIcon = mod.icon;
        const modHasDraft = mod.items.some(item =>
          item.draftKey ? checkDraft(item.draftKey)
          : item.children?.some(c => c.draftKey && checkDraft(c.draftKey))
        );

        const showBodegaAdd = mod.id === 'bodega' && hasMinRole(userRole, 'administrador');

        return (
          <div key={mod.id} className="sidebar-module">
            <div className="module-header-row">
              <button className="module-header" onClick={() => toggleModule(mod.id)}>
                <span
                  className={`icon-wrap${showBodegaAdd ? ' icon-wrap--has-action' : ''}`}
                  onClick={showBodegaAdd ? (e) => { e.stopPropagation(); navigate('/admin/bodegas'); } : undefined}
                  title={showBodegaAdd ? 'Administrar bodegas' : undefined}
                >
                  <ModIcon size={15} className="icon-default" />
                  {showBodegaAdd && <FiPlusCircle size={15} className="icon-hover" />}
                  {modHasDraft && <span className="draft-dot" title="Borrador en progreso" />}
                </span>
                <span>{mod.nombre}</span>
                {expanded ? <FiChevronDown size={13} /> : <FiChevronRight size={13} />}
              </button>
            </div>
            {expanded && (
              <div className="module-items">
                {visibleItems.map((item) =>
                  item.children
                    ? <GroupItem key={item.label} item={item} />
                    : <NavItem key={item.to} item={item} showPinBtn />
                )}
                {/* Bodegas genéricas dinámicas (solo en módulo bodega) */}
                {mod.id === 'bodega' && genericBodegas.map((b) => {
                  const Icon = getBodegaIcon(b.icono);
                  const syntheticItem = { label: b.nombre, to: `/bodega/${b.id}`, icon: Icon, minRole: 'encargado' };
                  return <NavItem key={b.id} item={syntheticItem} showPinBtn />;
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );

  // ── Collapsed icon-only nav ──────────────────────────────────────────────
  const CollapsedNav = () => {
    const visibleModules = MODULES.filter(mod => mod.items.some(canAccess));
    const dashBadge = badgeFor('/');

    const handleModuleClick = (modId) => {
      toggleCollapse();
      setActiveTab('todas');
      setExpandedMods(new Set([modId]));
    };

    return (
      <div className="collapsed-nav">
        {/* Dashboard */}
        <NavLink
          to="/"
          end
          className={({ isActive }) => `collapsed-link${isActive ? ' active' : ''}`}
          title={DASHBOARD_ITEM.label}
        >
          <span className="icon-wrap">
            <FiGrid size={20} />
            {dashBadge !== null && <span className="collapsed-badge">{dashBadge}</span>}
          </span>
        </NavLink>

        {/* One icon per module */}
        {visibleModules.map(mod => {
          const ModIcon = mod.icon;
          const modHasDraft = mod.items.some(item =>
            item.draftKey ? activeDrafts.has(item.draftKey)
            : item.children?.some(c => c.draftKey && activeDrafts.has(c.draftKey))
          );
          return (
            <button
              key={mod.id}
              className="collapsed-link"
              onClick={() => handleModuleClick(mod.id)}
              title={mod.nombre}
            >
              <span className="icon-wrap">
                <ModIcon size={20} />
                {modHasDraft && <span className="draft-dot" title="Borrador en progreso" />}
              </span>
            </button>
          );
        })}
      </div>
    );
  };

  // ── Main render ──────────────────────────────────────────────────────────
  return (
    <nav className={`sidebar${isCollapsed ? ' collapsed' : ''}`}>

      {/* ── Nav content ── */}
      {isCollapsed ? (
        <div className="sidebar-links">
          <CollapsedNav />
        </div>
      ) : (
        <>
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
        </>
      )}

      {/* ── Footer ── */}
      <div className="sidebar-footer">
        <div className={`sidebar-user${isCollapsed ? ' sidebar-user--collapsed' : ''}`}>
          {!isCollapsed && (
            <div className="sidebar-user-info">
              <span className="sidebar-user-name link-text">{currentUser?.nombre || 'Usuario'}</span>
              <span className="sidebar-user-role link-text">
                {ROLE_LABELS[currentUser?.rol] || 'Sin rol'}
              </span>
            </div>
          )}
          {!isCollapsed && hasMinRole(userRole, 'administrador') && (
            <button
              className="sidebar-logout-btn"
              onClick={() => navigate('/config/cuenta')}
              title="Configuración de cuenta"
            >
              <FiSliders size={16} />
            </button>
          )}
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
