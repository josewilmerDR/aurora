import { useState, useRef, useEffect } from 'react';
import { FiMenu, FiUser, FiSearch, FiArrowLeft } from 'react-icons/fi';
import { BrowserRouter as Router, Routes, Route, Outlet, useLocation, useNavigate, Navigate } from 'react-router-dom';
import UserManagement from './pages/UserManagement';
import PackageManagement from './pages/PackageManagement';
import LoteManagement from './pages/LoteManagement';
import TaskTracking from './pages/TaskTracking';
import Dashboard from './pages/Dashboard';
import TaskAction from './pages/TaskAction';
import ProductManagement from './pages/ProductManagement';
import ProductCatalog from './pages/ProductCatalog';
import ProductIngreso from './pages/ProductIngreso';
import InvoiceScan from './pages/InvoiceScan';
import PurchaseRequest from './pages/PurchaseRequest';
import PurchaseOrder from './pages/PurchaseOrder';
import OrdenesList from './pages/OrdenesList';
import OrdenesHistorial from './pages/OrdenesHistorial';
import ProveedoresList from './pages/ProveedoresList';
import GoodsReceipt from './pages/GoodsReceipt';
import Login from './pages/Login';
import LoginPassword from './pages/LoginPassword';
import Register from './pages/Register';
import ForgotPassword from './pages/ForgotPassword';
import MiPerfil from './pages/MiPerfil';
import FincaSelector from './pages/FincaSelector';
import OrgSelector from './pages/OrgSelector';
import NuevaOrganizacion from './pages/NuevaOrganizacion';
import HrFicha from './pages/HrFicha';
import HrAsistencia from './pages/HrAsistencia';
import HrHorasExtra from './pages/HrHorasExtra';
import HrPermisos from './pages/HrPermisos';
import HrPlanilla from './pages/HrPlanilla';
import HrPlanillaSalarioFijo from './pages/HrPlanillaSalarioFijo';
import HrPlanillaReporte from './pages/HrPlanillaReporte';
import HrPlanillaPorHora from './pages/HrPlanillaPorHora';
import HrHistorialPagos from './pages/HrHistorialPagos';
import HrHistorial from './pages/HrHistorial';
import HrDocumentos from './pages/HrDocumentos';
import HrMemorandums from './pages/HrMemorandums';
import HrSolicitudEmpleo from './pages/HrSolicitudEmpleo';
import MonitoreoRegistro from './pages/MonitoreoRegistro';
import MonitoreoHistorial from './pages/MonitoreoHistorial';
import MonitoreoConfig from './pages/MonitoreoConfig';
import ConfigCuenta from './pages/ConfigCuenta';
import Parametros from './pages/Parametros';
import MaquinariaList from './pages/MaquinariaList';
import Calibraciones from './pages/Calibraciones';
import LaborList from './pages/LaborList';
import UnidadesMedida from './pages/UnidadesMedida';
import Horimetro from './pages/Horimetro';
import GrupoManagement from './pages/GrupoManagement';
import CedulasAplicacion from './pages/CedulasAplicacion';
import HistorialAplicaciones from './pages/HistorialAplicaciones';
import CedulaViewer from './pages/CedulaViewer';
import Siembra from './pages/Siembra';
import SiembraMateriales from './pages/SiembraMateriales';
import SiembraHistorial from './pages/SiembraHistorial';
import Sidebar from './components/Sidebar';
import MobileNav from './components/MobileNav';
import AuroraChat from './components/AuroraChat';
import ReminderNotification from './components/ReminderNotification';
import { useReminderPoller } from './hooks/useReminderPoller';
import { usePushNotifications } from './hooks/usePushNotifications';
import { UserProvider, useUser, hasMinRole } from './contexts/UserContext';
import { MODULES, ALL_ITEMS } from './components/Sidebar';

import './index.css';
import './App.css';

// Mapeo de rutas → minRole derivado de MODULES (para restricción de rutas)
const ROUTE_MIN_ROLE = {
  ...Object.fromEntries(
    ALL_ITEMS.filter(item => item.to).map(item => [item.to, item.minRole || 'trabajador'])
  ),
  // Sub-rutas no listadas directamente en MODULES
  '/productos/todos': 'encargado',
  '/siembra/materiales': 'encargado',
  '/ordenes-compra/historial': 'encargado',
  '/hr/planilla/fijo': 'supervisor',
  '/hr/planilla/horas': 'encargado',
};

// Mapeo de rutas a títulos
const routeTitles = {
  '/': 'Panel de Control',
  '/users': 'Gestión de Usuarios',
  '/packages': 'Paquetes Técnicos',
  '/lotes': 'Gestión de Lotes',
  '/tasks': 'Seguimiento de Actividades',
  '/productos': 'Inventario Agroquímicos',
  '/productos/todos': 'Inventario Completo',
  '/ingreso-productos': 'Ingreso de Productos',
  '/compras': 'Registrar Compra',
  '/solicitudes': 'Solicitud de Compra',
  '/recepcion': 'Recepción de Productos',
  '/ordenes-compra': 'Órdenes de Compra',
  '/ordenes-compra/historial': 'Historial de Órdenes de Compra',
  '/proveedores': 'Proveedores',
  '/hr/ficha': 'Ficha del Trabajador',
  '/hr/asistencia': 'Registro de Asistencia',
  '/hr/horas-extra': 'Horas Extra',
  '/hr/permisos': 'Permisos y Vacaciones',
  '/hr/planilla': 'Cálculo de Planilla',
  '/hr/planilla/fijo': 'Planilla — Salario Fijo',
  '/hr/planilla/horas': 'Planilla — Por Hora / Unidad',
  '/hr/historial-pagos': 'Historial de Pagos',
  '/hr/historial': 'Historial del Empleado',
  '/hr/documentos': 'Documentos Adjuntos',
  '/hr/memorandums': 'Memorándums y Amonestaciones',
  '/hr/solicitud-empleo': 'Solicitud de Empleo',
  '/monitoreo': 'Registrar Monitoreo',
  '/monitoreo/historial': 'Historial de Monitoreos',
  '/monitoreo/config': 'Tipos de Monitoreo',
  '/config/cuenta': 'Configuración de Cuenta',
  '/admin/parametros': 'Parámetros y KPI',
  '/admin/maquinaria': 'Lista de Activos',
  '/admin/labores': 'Lista de Labores',
  '/admin/unidades-medida': 'Unidades de Medida',
  '/admin/calibraciones': 'Calibraciones',
  '/grupos': 'Grupos',
  '/aplicaciones/cedulas': 'Cédulas de Aplicación',
  '/aplicaciones/historial': 'Historial de Aplicaciones',
  '/siembra': 'Registro de Siembra',
  '/siembra/materiales': 'Materiales de Siembra',
  '/siembra/historial': 'Historial de Siembra',
  '/operaciones/horimetro': 'Horímetro',
};

// --- Route guards ---
const ProtectedRoute = ({ children }) => {
  const { isLoggedIn, isLoading, needsOrgSelection } = useUser();
  const location = useLocation();
  if (isLoading) return <div className="app-loading">Cargando...</div>;
  if (!isLoggedIn && !needsOrgSelection) return <Navigate to="/login" state={{ from: location.pathname + location.search }} replace />;
  if (needsOrgSelection) return <OrgSelector />;
  return children;
};

const RoleRoute = ({ path, children }) => {
  const { currentUser } = useUser();
  const userRole = currentUser?.rol || 'trabajador';
  const minRole = ROUTE_MIN_ROLE[path] || 'trabajador';
  if (!hasMinRole(userRole, minRole)) return <Navigate to="/" replace />;
  return children;
};

// --- Logout handler ---
const LogoutRoute = () => {
  const { logout } = useUser();
  logout();
  return <Navigate to="/login" replace />;
};

// --- Layouts ---

const MainLayout = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { currentUser } = useUser();
  const { pendingReminders, dismissReminder } = useReminderPoller();
  const { permission, isSubscribed, subscribe } = usePushNotifications();
  const [pushPromptDismissed, setPushPromptDismissed] = useState(() =>
    localStorage.getItem('aurora_push_prompt_dismissed') === 'true'
  );
  const showPushPrompt = permission === 'default' && !isSubscribed && !pushPromptDismissed && 'PushManager' in window;
  const dismissPushPrompt = () => {
    localStorage.setItem('aurora_push_prompt_dismissed', 'true');
    setPushPromptDismissed(true);
  };
  const title = routeTitles[location.pathname]
    || (location.pathname.startsWith('/aplicaciones/cedula/') ? 'Cédula de Aplicación' : 'Aurora');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchActiveIdx, setSearchActiveIdx] = useState(-1);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const searchInputRef = useRef(null);
  const wrapperRef = useRef(null);
  const userRole = currentUser?.rol || 'trabajador';
  const [isCollapsed, setIsCollapsed] = useState(() => {
    try { return localStorage.getItem('aurora_sidebar_collapsed') === 'true'; }
    catch { return false; }
  });
  const toggleCollapse = () => setIsCollapsed(prev => {
    const next = !prev;
    localStorage.setItem('aurora_sidebar_collapsed', String(next));
    return next;
  });

  // Filter nav items by query and role
  useEffect(() => {
    if (!searchQuery.trim()) { setSearchResults([]); return; }
    const q = searchQuery.toLowerCase();
    const results = [];
    MODULES.forEach(mod => {
      mod.items.forEach(item => {
        if (item.children) {
          item.children.forEach(child => {
            if (hasMinRole(userRole, child.minRole) && child.label.toLowerCase().includes(q)) {
              results.push({ label: child.label, to: child.to, tag: `${mod.nombre} > ${item.label}`.toLowerCase() });
            }
          });
        } else {
          if (hasMinRole(userRole, item.minRole) && item.label.toLowerCase().includes(q)) {
            results.push({ label: item.label, to: item.to, tag: mod.nombre.toLowerCase() });
          }
        }
      });
    });
    setSearchResults(results.slice(0, 8));
    setSearchActiveIdx(-1);
  }, [searchQuery, userRole]);

  // Close dropdown on outside click — only active when dropdown is visible
  useEffect(() => {
    if (searchResults.length === 0) return;
    const handler = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) setSearchResults([]);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [searchResults.length]);

  const handleSelect = (to) => {
    navigate(to);
    setSearchQuery('');
    setSearchResults([]);
    setSearchActiveIdx(-1);
  };

  const closeMobileSearch = () => {
    setMobileSearchOpen(false);
    setSearchQuery('');
    setSearchResults([]);
  };

  const openMobileSearch = () => {
    setMobileSearchOpen(true);
    setTimeout(() => searchInputRef.current?.focus(), 50);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      setSearchQuery('');
      setSearchResults([]);
      setSearchActiveIdx(-1);
      setMobileSearchOpen(false);
    } else if (e.key === 'ArrowDown' && searchResults.length > 0) {
      e.preventDefault();
      setSearchActiveIdx(i => Math.min(i + 1, searchResults.length - 1));
    } else if (e.key === 'ArrowUp' && searchResults.length > 0) {
      e.preventDefault();
      setSearchActiveIdx(i => Math.max(i - 1, -1));
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (searchActiveIdx >= 0 && searchResults[searchActiveIdx]) {
      handleSelect(searchResults[searchActiveIdx].to);
    } else if (searchResults.length > 0) {
      handleSelect(searchResults[0].to);
    } else if (searchQuery.trim()) {
      window.dispatchEvent(new CustomEvent('aurora:open', { detail: { query: searchQuery } }));
      setSearchQuery('');
      setSearchResults([]);
    }
  };

  return (
    <div className="app-wrapper">

      {/* ── Top header ── */}
      <header className={`app-header${mobileSearchOpen ? ' mobile-search-open' : ''}`}>
        <button className="app-header-menu-btn" onClick={toggleCollapse} title={isCollapsed ? 'Expandir menú' : 'Colapsar menú'}>
          <FiMenu size={20} />
        </button>
        <div className="app-header-brand">
          <img src="/aurora-logo.png" alt="Aurora" className="app-header-logo" />
          <span className="app-header-name">Aurora</span>
        </div>

        {/* Buscador desktop + móvil expandido */}
        <div className="app-header-search" ref={wrapperRef}>
          <button className="app-header-search-back" onClick={closeMobileSearch} title="Cerrar búsqueda">
            <FiArrowLeft size={18} />
          </button>
          <form className="main-search-bar" onSubmit={handleSubmit}>
            <span className="main-search-icon">🔍</span>
            <input
              ref={searchInputRef}
              type="text"
              placeholder="Buscar funciones o preguntar a Aurora..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={handleKeyDown}
            />
          </form>
          {searchResults.length > 0 && (
            <div className="search-dropdown">
              {searchResults.map((item, idx) => (
                <button
                  key={item.to}
                  className={`search-result-item${idx === searchActiveIdx ? ' search-result-item--active' : ''}`}
                  onMouseDown={() => handleSelect(item.to)}
                  onMouseEnter={() => setSearchActiveIdx(idx)}
                >
                  <span className="search-result-label">{item.label}</span>
                  {item.tag && <span className="search-result-tag">{item.tag}</span>}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Lupa móvil (solo visible en mobile con búsqueda cerrada) */}
        <button className="app-header-search-toggle" onClick={openMobileSearch} title="Buscar">
          <FiSearch size={19} />
        </button>

        <button
          className="app-header-profile-btn"
          onClick={() => navigate('/mi-perfil')}
          title="Mi perfil"
        >
          <FiUser size={17} />
          <span className="app-header-profile-name">{currentUser?.nombre?.split(' ')[0] || 'Perfil'}</span>
        </button>
      </header>

      {/* ── Body ── */}
      <div className="app-layout">
        <Sidebar isCollapsed={isCollapsed} toggleCollapse={toggleCollapse} />
        <main className="content-area">
          <Outlet />
        </main>
      </div>

      <MobileNav />
      <AuroraChat />
      <ReminderNotification reminders={pendingReminders} onDismiss={dismissReminder} />
      {showPushPrompt && (
        <div className="push-prompt">
          <span className="push-prompt-text">¿Activar notificaciones para recordatorios?</span>
          <button className="push-prompt-btn" onClick={subscribe}>Activar</button>
          <button className="push-prompt-dismiss" onClick={dismissPushPrompt}>Ahora no</button>
        </div>
      )}
    </div>
  );
};

const SimpleLayout = () => (
  <div className="SimpleApp">
    <main>
      <Outlet />
    </main>
  </div>
);

// --- App ---

function App() {
  return (
    <Router>
      <UserProvider>
        <Routes>
          {/* Public routes */}
          <Route element={<SimpleLayout />}>
            <Route path="/login" element={<Login />} />
            <Route path="/login/contrasena" element={<LoginPassword />} />
            <Route path="/register" element={<Register />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/nueva-organizacion" element={<NuevaOrganizacion />} />
            <Route path="/logout" element={<LogoutRoute />} />
            <Route path="/task/:taskId" element={<TaskAction />} />
            <Route path="/orden-compra/:taskId" element={<PurchaseOrder />} />
            <Route path="/hr/planilla/fijo/reporte" element={<HrPlanillaReporte />} />
          </Route>

          {/* Protected routes with sidebar */}
          <Route
            element={
              <ProtectedRoute>
                <MainLayout />
              </ProtectedRoute>
            }
          >
            <Route path="/" element={<Dashboard />} />
            <Route path="/tasks" element={<TaskTracking />} />
            <Route path="/monitoreo" element={<MonitoreoRegistro />} />
            <Route path="/operaciones/horimetro" element={<Horimetro />} />
            <Route path="/config/cuenta" element={<ConfigCuenta />} />
            <Route path="/mi-perfil" element={<MiPerfil />} />
            {/* encargado+ */}
            <Route path="/users" element={<RoleRoute path="/users"><UserManagement /></RoleRoute>} />
            <Route path="/lotes" element={<RoleRoute path="/lotes"><LoteManagement /></RoleRoute>} />
            <Route path="/grupos" element={<RoleRoute path="/grupos"><GrupoManagement /></RoleRoute>} />
            <Route path="/productos" element={<RoleRoute path="/productos"><ProductManagement /></RoleRoute>} />
            <Route path="/productos/todos" element={<RoleRoute path="/productos/todos"><ProductCatalog /></RoleRoute>} />
            <Route path="/ingreso-productos" element={<RoleRoute path="/ingreso-productos"><ProductIngreso /></RoleRoute>} />
            <Route path="/solicitudes" element={<RoleRoute path="/solicitudes"><PurchaseRequest /></RoleRoute>} />
            <Route path="/recepcion" element={<RoleRoute path="/recepcion"><GoodsReceipt /></RoleRoute>} />
            <Route path="/ordenes-compra" element={<RoleRoute path="/ordenes-compra"><OrdenesList /></RoleRoute>} />
            <Route path="/ordenes-compra/historial" element={<RoleRoute path="/ordenes-compra/historial"><OrdenesHistorial /></RoleRoute>} />
            <Route path="/proveedores" element={<RoleRoute path="/proveedores"><ProveedoresList /></RoleRoute>} />
            <Route path="/hr/ficha" element={<RoleRoute path="/hr/ficha"><HrFicha /></RoleRoute>} />
            <Route path="/hr/asistencia" element={<RoleRoute path="/hr/asistencia"><HrAsistencia /></RoleRoute>} />
            <Route path="/hr/horas-extra" element={<RoleRoute path="/hr/horas-extra"><HrHorasExtra /></RoleRoute>} />
            <Route path="/hr/permisos" element={<RoleRoute path="/hr/permisos"><HrPermisos /></RoleRoute>} />
            <Route path="/hr/historial" element={<RoleRoute path="/hr/historial"><HrHistorial /></RoleRoute>} />
            <Route path="/hr/documentos" element={<RoleRoute path="/hr/documentos"><HrDocumentos /></RoleRoute>} />
            <Route path="/monitoreo/historial" element={<RoleRoute path="/monitoreo/historial"><MonitoreoHistorial /></RoleRoute>} />
            <Route path="/aplicaciones/cedulas" element={<RoleRoute path="/aplicaciones/cedulas"><CedulasAplicacion /></RoleRoute>} />
            <Route path="/aplicaciones/historial" element={<RoleRoute path="/aplicaciones/historial"><HistorialAplicaciones /></RoleRoute>} />
            <Route path="/aplicaciones/cedula/:id" element={<RoleRoute path="/aplicaciones/cedulas"><CedulaViewer /></RoleRoute>} />
            <Route path="/siembra" element={<RoleRoute path="/siembra"><Siembra /></RoleRoute>} />
            <Route path="/siembra/materiales" element={<RoleRoute path="/siembra/materiales"><SiembraMateriales /></RoleRoute>} />
            <Route path="/siembra/historial" element={<RoleRoute path="/siembra/historial"><SiembraHistorial /></RoleRoute>} />
            {/* supervisor+ */}
            <Route path="/packages" element={<RoleRoute path="/packages"><PackageManagement /></RoleRoute>} />
            <Route path="/compras" element={<RoleRoute path="/compras"><InvoiceScan /></RoleRoute>} />
            <Route path="/hr/planilla" element={<RoleRoute path="/hr/planilla"><HrPlanilla /></RoleRoute>} />
            <Route path="/hr/planilla/fijo" element={<RoleRoute path="/hr/planilla/fijo"><HrPlanillaSalarioFijo /></RoleRoute>} />
            <Route path="/hr/planilla/horas" element={<RoleRoute path="/hr/planilla/horas"><HrPlanillaPorHora /></RoleRoute>} />
            <Route path="/hr/historial-pagos" element={<RoleRoute path="/hr/historial-pagos"><HrHistorialPagos /></RoleRoute>} />
            <Route path="/hr/memorandums" element={<RoleRoute path="/hr/memorandums"><HrMemorandums /></RoleRoute>} />
            <Route path="/monitoreo/config" element={<RoleRoute path="/monitoreo/config"><MonitoreoConfig /></RoleRoute>} />
            <Route path="/admin/maquinaria" element={<RoleRoute path="/admin/maquinaria"><MaquinariaList /></RoleRoute>} />
            <Route path="/admin/labores" element={<RoleRoute path="/admin/labores"><LaborList /></RoleRoute>} />
            <Route path="/admin/unidades-medida" element={<RoleRoute path="/admin/unidades-medida"><UnidadesMedida /></RoleRoute>} />
            <Route path="/admin/calibraciones" element={<RoleRoute path="/admin/calibraciones"><Calibraciones /></RoleRoute>} />
            {/* administrador */}
            <Route path="/hr/solicitud-empleo" element={<RoleRoute path="/hr/solicitud-empleo"><HrSolicitudEmpleo /></RoleRoute>} />
            <Route path="/admin/parametros" element={<RoleRoute path="/admin/parametros"><Parametros /></RoleRoute>} />
          </Route>
        </Routes>
      </UserProvider>
    </Router>
  );
}

export default App;
