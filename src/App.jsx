import { useState, useRef, useEffect, useCallback } from 'react';
import { FiMenu, FiUser, FiSearch, FiArrowLeft, FiCpu } from 'react-icons/fi';
import { BrowserRouter as Router, Routes, Route, Outlet, useLocation, useNavigate, Navigate, NavLink } from 'react-router-dom';
import UserManagement from './pages/UserManagement';
import PackageManagement from './pages/PackageManagement';
import LoteManagement from './pages/LoteManagement';
import TaskTracking from './pages/TaskTracking';
import Dashboard from './pages/Dashboard';
import TaskAction from './pages/TaskAction';
import ProductManagement from './pages/BodegaAgroquimicosProductManagement';
import ProductCatalog from './pages/BodegaAgroquimicosProductCatalog';
import ProductIngreso from './pages/BodegaAgroquimicosProductIngreso';
import MovimientosHistorial from './pages/BodegaAgroquimicosMovimientosHistorial';
import OCDesdeSolicitud from './pages/OCDesdeSolicitud';
import OCNueva from './pages/OCNueva';
import OCHistorial from './pages/OCHistorial';
import ProveedoresList from './pages/ProveedoresList';
import Login from './pages/Login';
import LoginPassword from './pages/LoginPassword';
import Register from './pages/Register';
import ForgotPassword from './pages/ForgotPassword';
import Profile from './pages/Profile';
import FincaSelector from './pages/FincaSelector';
import OrganizationSelector from './pages/OrganizationSelector';
import NewOrganization from './pages/NewOrganization';
import EmployeeProfile from './features/hr/pages/EmployeeProfile';
import LeaveRequests from './features/hr/pages/LeaveRequests';
import FixedPayroll from './features/hr/pages/FixedPayroll';
import FixedPayrollReport from './features/hr/pages/FixedPayrollReport';
import UnitPayroll from './features/hr/pages/UnitPayroll';
import FixedPayrollHistory from './features/hr/pages/FixedPayrollHistory';
import UnitPayrollHistory from './features/hr/pages/UnitPayrollHistory';
import SamplingHistory from './features/monitoring/pages/SamplingHistory';
import TemplateConfig from './features/monitoring/pages/TemplateConfig';
import SamplingPackages from './features/monitoring/pages/SamplingPackages';
import SamplingCenter from './features/monitoring/pages/SamplingCenter';
import AccountSettings from './pages/AccountSettings';
import Parameters from './pages/Parameters';
import MaquinariaList from './pages/MaquinariaList';
import InitialSetup from './pages/InitialSetup';
import Calibraciones from './pages/Calibraciones';
import LaborList from './pages/LaborList';
import UnidadesMedida from './pages/UnidadesMedida';
import Horimetro from './pages/Horimetro';
import RegistroHorimetro from './pages/RegistroHorimetro';
import HistorialHorimetros from './pages/HistorialHorimetros';
import GrupoManagement from './pages/GrupoManagement';
import CedulasAplicacion from './pages/CedulasAplicacion';
import HistorialAplicaciones from './pages/HistorialAplicaciones';
import CedulaViewer from './pages/CedulaViewer';
import BodegasAdmin from './pages/BodegasAdmin';
import CierreCombustible from './pages/CierreCombustible';
import BodegaGenerica from './pages/BodegaGenerica';
import Siembra from './pages/Siembra';
import SiembraMateriales from './pages/SiembraMateriales';
import SiembraHistorial from './pages/SiembraHistorial';
import CosechaProyeccion from './pages/CosechaProyeccion';
import CosechaHistorial from './pages/CosechaHistorial';
import CosechaRegistro from './pages/CosechaRegistro';
import CosechaDespachos from './pages/CosechaDespachos';
import CosechaHistorialDespacho from './pages/CosechaHistorialDespacho';
import CentroCostos from './pages/CentroCostos';
import Budgets from './pages/finance/Budgets';
import FinanceDashboard from './pages/finance/FinanceDashboard';
import FinancingDashboard from './pages/finance/FinancingDashboard';
import CreditOffers from './pages/finance/CreditOffers';
import DebtSimulations from './pages/finance/DebtSimulations';
import CeoDashboard from './pages/ceo/CeoDashboard';
import IncomeRecords from './pages/finance/IncomeRecords';
import BuyersList from './pages/finance/BuyersList';
import Treasury from './pages/finance/Treasury';
import AutopilotDashboard from './pages/AutopilotDashboard';
import AutopilotConfig from './pages/AutopilotConfig';
import ProcurementDashboard from './pages/procurement/ProcurementDashboard';
import PerformanceDashboard from './features/hr/pages/PerformanceDashboard';
import MyPerformance from './features/hr/pages/MyPerformance';
import YieldHistory from './features/strategy/pages/YieldHistory';
import TemporadasManager from './features/strategy/pages/TemporadasManager';
import RotationConstraints from './features/strategy/pages/RotationConstraints';
import RotationRecommender from './features/strategy/pages/RotationRecommender';
import SignalSources from './features/strategy/pages/SignalSources';
import SignalsDashboard from './features/strategy/pages/SignalsDashboard';
import ScenariosSimulator from './features/strategy/pages/ScenariosSimulator';
import AnnualPlan from './features/strategy/pages/AnnualPlan';
import RfqsList from './pages/procurement/RfqsList';
import Sidebar from './components/Sidebar';
import MobileNav from './components/MobileNav';
import AuroraChat from './components/AuroraChat';
import AutopilotPanel from './components/AutopilotPanel';
import { useApiFetch } from './hooks/useApiFetch';
import ReminderNotification from './components/ReminderNotification';
import { useReminderPoller } from './hooks/useReminderPoller';
import { usePushNotifications } from './hooks/usePushNotifications';
import { UserProvider, useUser, hasMinRole } from './contexts/UserContext';
import { MODULES, ALL_ITEMS } from './components/Sidebar';

import './index.css';
import './App.css';

// Route → minRole mapping derived from MODULES (used for route-level access control).
const ROUTE_MIN_ROLE = {
  ...Object.fromEntries(
    ALL_ITEMS.filter(item => item.to).map(item => [item.to, item.minRole || 'trabajador'])
  ),
  // Sub-routes not listed directly in MODULES
  '/productos/todos': 'encargado',
  '/bodega/agroquimicos/existencias': 'encargado',
  '/bodega/agroquimicos/recepcion': 'encargado',
  '/bodega/agroquimicos/movimientos': 'encargado',
  '/admin/bodegas': 'administrador',
  '/cosecha/despacho': 'encargado',
  '/siembra/materiales': 'encargado',
  '/ordenes-compra/historial': 'encargado',
  '/hr/planilla/fijo': 'encargado',
  '/hr/planilla/horas': 'encargado',
  '/monitoreo/paquetes': 'supervisor',
  '/monitoreo/muestreos': 'encargado',
  // Autopilot — accessed via header icon, not sidebar
  '/autopilot': 'encargado',
  '/autopilot/configuracion': 'supervisor',
  // Procurement
  '/procurement/dashboard': 'encargado',
  '/procurement/rfqs': 'encargado',
  // HR (phase 3.6) — supervisor for the team dashboard, any authenticated
  // user for their own score
  '/hr/performance': 'supervisor',
  '/hr/my-performance': 'trabajador',
  // Financing (phase 5.5) — supervisor+ can read; admin gates write ops at API layer
  '/finance/financing': 'supervisor',
  '/finance/financing/ofertas': 'supervisor',
  '/finance/financing/simulaciones': 'supervisor',
  // CEO Dashboard (phase 6.5) — admin only; reflects meta-agent state
  '/ceo': 'administrador',
  // Strategy (phase 4.1)
  '/strategy/rendimiento': 'supervisor',
  '/strategy/temporadas': 'supervisor',
  '/strategy/rotacion/restricciones': 'supervisor',
  '/strategy/rotacion/recomendador': 'supervisor',
  '/strategy/senales/fuentes': 'supervisor',
  '/strategy/senales': 'supervisor',
  '/strategy/escenarios': 'supervisor',
  '/strategy/plan-anual': 'supervisor',
};

// Route → human-readable title mapping (displayed in the app header).
const routeTitles = {
  '/': 'Panel de Control',
  '/users': 'Gestión de Usuarios',
  '/packages': 'Paquetes de Aplicaciones',
  '/lotes': 'Gestión de Lotes',
  '/tasks': 'Seguimiento de Actividades',
  '/productos': 'Inventario Agroquímicos',
  '/productos/todos': 'Inventario Completo',
  '/ingreso-productos': 'Recepción de Mercancía',
  '/productos/movimientos': 'Historial de Movimientos',
  '/bodega/agroquimicos/existencias': 'Existencias — Agroquímicos',
  '/bodega/agroquimicos/recepcion': 'Recepción de Mercancía',
  '/bodega/agroquimicos/movimientos': 'Historial de Movimientos',
  '/admin/bodegas': 'Administrar Bodegas',
  '/ordenes-compra': 'Órdenes de Compra',
  '/ordenes-compra/historial': 'Historial de Órdenes de Compra',
  '/proveedores': 'Proveedores',
  '/costos': 'Centro de Costos',
  '/finance/dashboard': 'Dashboard Financiero',
  '/finance/presupuestos': 'Presupuestos',
  '/finance/tesoreria': 'Tesorería',
  '/finance/ingresos': 'Ingresos',
  '/finance/compradores': 'Compradores',
  '/finance/financing': 'Financiamiento',
  '/finance/financing/ofertas': 'Ofertas de crédito',
  '/finance/financing/simulaciones': 'Simulador de deuda',
  '/ceo': 'CEO Dashboard',
  '/hr/ficha': 'Ficha del Trabajador',
  '/hr/permisos': 'Permisos y Vacaciones',
  '/hr/planilla': 'Cálculo de Planilla',
  '/hr/planilla/fijo': 'Planilla — Salario Fijo',
  '/hr/planilla/horas': 'Planilla — Por Hora / Unidad',
  '/hr/historial-pagos': 'Historial de Pagos',
  '/monitoreo/historial': 'Historial de Muestreos',
  '/monitoreo/config': 'Plantilla de Muestreos',
  '/monitoreo/paquetes': 'Paquete de Muestreos',
  '/monitoreo/muestreos': 'Centro de Monitoreo',
  '/config/cuenta': 'Configuración de Cuenta',
  '/admin/parametros': 'Parámetros y KPI',
  '/admin/config-inicial': 'Configuración Inicial',
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
  '/cosecha/registro': 'Registro de Cosecha',
  '/cosecha/despacho': 'Despacho de Cosecha',
  '/cosecha/proyeccion': 'Proyección de Cosecha',
  '/cosecha/historial': 'Historial de Cosecha',
  '/cosecha/historial-despachos': 'Historial de Despachos',
  '/operaciones/horimetro': 'Horímetros',
  '/operaciones/horimetro/registro': 'Registro de Horímetro',
  '/operaciones/horimetro/historial': 'Historial de Horímetros',
  '/autopilot': 'Piloto Automático',
  '/autopilot/configuracion': 'Configuración — Piloto Automático',
  '/procurement/dashboard': 'Abastecimiento',
  '/procurement/rfqs': 'Cotizaciones',
  '/hr/performance': 'RR.HH. — Desempeño',
  '/hr/my-performance': 'Mi desempeño',
  '/strategy/rendimiento': 'Rendimiento Histórico',
  '/strategy/temporadas': 'Temporadas',
  '/strategy/rotacion/restricciones': 'Rotación — Restricciones Agronómicas',
  '/strategy/rotacion/recomendador': 'Rotación — Recomendador',
  '/strategy/senales/fuentes': 'Señales — Fuentes',
  '/strategy/senales': 'Señales — Observaciones',
  '/strategy/escenarios': 'Escenarios What-if',
  '/strategy/plan-anual': 'Plan Anual Vivo',
};

// --- Route guards ---
const ProtectedRoute = ({ children }) => {
  const { isLoggedIn, isLoading, needsOrgSelection, firebaseUser, activeFincaId, currentUser } = useUser();
  const location = useLocation();
  if (isLoading) return <div className="app-loading" />;
  // Finca selected but profile still loading: show spinner instead of redirecting to /login
  if (firebaseUser && activeFincaId && !currentUser) return <div className="app-loading" />;
  if (!isLoggedIn && !needsOrgSelection) return <Navigate to="/login" state={{ from: location.pathname + location.search }} replace />;
  if (needsOrgSelection) return <OrganizationSelector />;
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
  const apiFetch = useApiFetch();
  const { currentUser } = useUser();
  const [profileOpen, setProfileOpen] = useState(false);
  const [autopilotOpen, setAutopilotOpen] = useState(false);
  const [autopilotPendingCount, setAutopilotPendingCount] = useState(0);
  const { pendingReminders, dismissReminder } = useReminderPoller();
  const { permission, isSubscribed, subscribe } = usePushNotifications();
  const [pushPromptDismissed, setPushPromptDismissed] = useState(() =>
    localStorage.getItem('aurora_push_prompt_dismissed') === 'true'
  );
  const showPushPrompt = permission === 'default' && !isSubscribed && !pushPromptDismissed && 'PushManager' in window;

  const [swUpdateVisible, setSwUpdateVisible] = useState(false);
  useEffect(() => {
    // Check if onNeedRefresh fired before React mounted
    if (window.__swUpdatePending) setSwUpdateVisible(true);
    const handler = () => setSwUpdateVisible(true);
    window.addEventListener('sw-update-available', handler);
    return () => window.removeEventListener('sw-update-available', handler);
  }, []);
  const dismissPushPrompt = () => {
    localStorage.setItem('aurora_push_prompt_dismissed', 'true');
    setPushPromptDismissed(true);
  };
  const title = routeTitles[location.pathname]
    || (location.pathname.startsWith('/aplicaciones/cedula/') ? 'Cédula de Aplicación'
    : location.pathname.startsWith('/bodega/') && !location.pathname.includes('/agroquimicos') ? 'Bodega'
    : 'Aurora');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchActiveIdx, setSearchActiveIdx] = useState(-1);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const searchInputRef = useRef(null);
  const wrapperRef = useRef(null);
  const userRole = currentUser?.rol || 'trabajador';
  const canSeeAutopilot = hasMinRole(userRole, 'encargado');

  // Refresh the pending-actions badge from /api/autopilot/actions
  const refreshAutopilotPending = useCallback(() => {
    if (!canSeeAutopilot) return;
    apiFetch('/api/autopilot/actions')
      .then(r => r.ok ? r.json() : [])
      .then(data => {
        if (Array.isArray(data)) {
          setAutopilotPendingCount(data.filter(a => a.status === 'proposed').length);
        }
      })
      .catch(() => { });
  }, [apiFetch, canSeeAutopilot]);

  useEffect(() => {
    refreshAutopilotPending();
    window.addEventListener('aurora-autopilot-changed', refreshAutopilotPending);
    return () => window.removeEventListener('aurora-autopilot-changed', refreshAutopilotPending);
  }, [refreshAutopilotPending]);

  const openAutopilot = () => {
    setProfileOpen(false);
    setAutopilotOpen(true);
  };
  const openProfile = () => {
    setAutopilotOpen(false);
    setProfileOpen(o => !o);
  };

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
      const modMatches = mod.nombre.toLowerCase().includes(q);
      mod.items.forEach(item => {
        if (item.children) {
          const groupMatches = item.label.toLowerCase().includes(q);
          item.children.forEach(child => {
            if (hasMinRole(userRole, child.minRole) && (child.label.toLowerCase().includes(q) || groupMatches || modMatches)) {
              results.push({ label: child.label, to: child.to, tag: `${mod.nombre} > ${item.label}` });
            }
          });
        } else {
          if (hasMinRole(userRole, item.minRole) && (item.label.toLowerCase().includes(q) || modMatches)) {
            results.push({ label: item.label, to: item.to, tag: mod.nombre });
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
        <NavLink to="/" className="app-header-brand">
          <img src="/aurora-logo.png" alt="Aurora" className="app-header-logo" />
          <span className="app-header-name">Aurora</span>
        </NavLink>

        {/* Desktop search + expanded mobile search */}
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

        {/* Mobile search toggle (visible only on mobile when search is closed) */}
        <button className="app-header-search-toggle" onClick={openMobileSearch} title="Buscar">
          <FiSearch size={19} />
        </button>

        {canSeeAutopilot && (
          <button
            className={`app-header-autopilot-btn${autopilotOpen ? ' active' : ''}`}
            onClick={openAutopilot}
            title="Piloto Automático"
          >
            <FiCpu size={17} />
            {autopilotPendingCount > 0 && (
              <span className="app-header-autopilot-badge">
                {autopilotPendingCount > 99 ? '99+' : autopilotPendingCount}
              </span>
            )}
          </button>
        )}

        <button
          className={`app-header-profile-btn${profileOpen ? ' active' : ''}`}
          onClick={openProfile}
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

      {/* ── Profile panel ── */}
      {profileOpen && (
        <div className="profile-panel-backdrop" onClick={() => setProfileOpen(false)} />
      )}
      <div className={`profile-panel${profileOpen ? ' open' : ''}`}>
        <Profile />
      </div>

      {/* ── Autopilot panel ── */}
      {canSeeAutopilot && (
        <AutopilotPanel open={autopilotOpen} onClose={() => setAutopilotOpen(false)} />
      )}
      {showPushPrompt && (
        <div className="push-prompt">
          <span className="push-prompt-text">¿Activar notificaciones para recordatorios?</span>
          <button className="push-prompt-btn" onClick={subscribe}>Activar</button>
          <button className="push-prompt-dismiss" onClick={dismissPushPrompt}>Ahora no</button>
        </div>
      )}
      {swUpdateVisible && (
        <div className="update-prompt">
          <span className="push-prompt-text">Nueva versión disponible — tu trabajo guardado no se perderá</span>
          <button className="push-prompt-btn" onClick={() => { window.__swUpdatePending = false; window.__swUpdate?.(); }}>Actualizar</button>
          <button className="push-prompt-dismiss" onClick={() => { window.__swUpdatePending = false; setSwUpdateVisible(false); }}>Ahora no</button>
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
            <Route path="/nueva-organizacion" element={<NewOrganization />} />
            <Route path="/logout" element={<LogoutRoute />} />
            <Route path="/task/:taskId" element={<TaskAction />} />
            <Route path="/orden-compra/:taskId" element={<OCDesdeSolicitud />} />
            <Route path="/hr/planilla/fijo/reporte" element={<FixedPayrollReport />} />
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
            <Route path="/operaciones/horimetro" element={<Horimetro />} />
            <Route path="/operaciones/horimetro/registro" element={<RegistroHorimetro />} />
            <Route path="/operaciones/horimetro/historial" element={<HistorialHorimetros />} />
            <Route path="/config/cuenta" element={<AccountSettings />} />
            <Route path="/mi-perfil" element={<Profile />} />
            {/* encargado+ */}
            <Route path="/users" element={<RoleRoute path="/users"><UserManagement /></RoleRoute>} />
            <Route path="/lotes" element={<RoleRoute path="/lotes"><LoteManagement /></RoleRoute>} />
            <Route path="/grupos" element={<RoleRoute path="/grupos"><GrupoManagement /></RoleRoute>} />
            {/* Canonical bodega routes — pattern /bodega/:bodegaId/:submodule */}
            <Route path="/bodega/agroquimicos/existencias" element={<RoleRoute path="/bodega/agroquimicos/existencias"><ProductManagement /></RoleRoute>} />
            <Route path="/bodega/agroquimicos/recepcion" element={<RoleRoute path="/bodega/agroquimicos/recepcion"><ProductIngreso /></RoleRoute>} />
            <Route path="/bodega/agroquimicos/movimientos" element={<RoleRoute path="/bodega/agroquimicos/movimientos"><MovimientosHistorial /></RoleRoute>} />
            <Route path="/bodega/:bodegaId" element={<RoleRoute path="/bodega/agroquimicos/existencias"><BodegaGenerica /></RoleRoute>} />
            {/* Legacy route redirects → canonical */}
            <Route path="/productos" element={<Navigate to="/bodega/agroquimicos/existencias" replace />} />
            <Route path="/ingreso-productos" element={<Navigate to="/bodega/agroquimicos/recepcion" replace />} />
            <Route path="/productos/movimientos" element={<Navigate to="/bodega/agroquimicos/movimientos" replace />} />
            <Route path="/productos/todos" element={<RoleRoute path="/productos/todos"><ProductCatalog /></RoleRoute>} />
            <Route path="/ordenes-compra" element={<RoleRoute path="/ordenes-compra"><OCNueva /></RoleRoute>} />
            <Route path="/ordenes-compra/historial" element={<RoleRoute path="/ordenes-compra/historial"><OCHistorial /></RoleRoute>} />
            <Route path="/proveedores" element={<RoleRoute path="/proveedores"><ProveedoresList /></RoleRoute>} />
            <Route path="/costos" element={<RoleRoute path="/costos"><CentroCostos /></RoleRoute>} />
            <Route path="/finance/dashboard" element={<RoleRoute path="/finance/dashboard"><FinanceDashboard /></RoleRoute>} />
            <Route path="/finance/presupuestos" element={<RoleRoute path="/finance/presupuestos"><Budgets /></RoleRoute>} />
            <Route path="/finance/tesoreria" element={<RoleRoute path="/finance/tesoreria"><Treasury /></RoleRoute>} />
            <Route path="/finance/ingresos" element={<RoleRoute path="/finance/ingresos"><IncomeRecords /></RoleRoute>} />
            <Route path="/finance/compradores" element={<RoleRoute path="/finance/compradores"><BuyersList /></RoleRoute>} />
            <Route path="/finance/financing" element={<RoleRoute path="/finance/financing"><FinancingDashboard /></RoleRoute>} />
            <Route path="/finance/financing/ofertas" element={<RoleRoute path="/finance/financing/ofertas"><CreditOffers /></RoleRoute>} />
            <Route path="/finance/financing/simulaciones" element={<RoleRoute path="/finance/financing/simulaciones"><DebtSimulations /></RoleRoute>} />
            <Route path="/ceo" element={<RoleRoute path="/ceo"><CeoDashboard /></RoleRoute>} />
            <Route path="/hr/ficha" element={<RoleRoute path="/hr/ficha"><EmployeeProfile /></RoleRoute>} />
            <Route path="/hr/permisos" element={<RoleRoute path="/hr/permisos"><LeaveRequests /></RoleRoute>} />
            <Route path="/monitoreo/historial" element={<RoleRoute path="/monitoreo/historial"><SamplingHistory /></RoleRoute>} />
            <Route path="/aplicaciones/cedulas" element={<RoleRoute path="/aplicaciones/cedulas"><CedulasAplicacion /></RoleRoute>} />
            <Route path="/aplicaciones/historial" element={<RoleRoute path="/aplicaciones/historial"><HistorialAplicaciones /></RoleRoute>} />
            <Route path="/aplicaciones/cedula/:id" element={<RoleRoute path="/aplicaciones/cedulas"><CedulaViewer /></RoleRoute>} />
            <Route path="/siembra" element={<RoleRoute path="/siembra"><Siembra /></RoleRoute>} />
            <Route path="/siembra/materiales" element={<RoleRoute path="/siembra/materiales"><SiembraMateriales /></RoleRoute>} />
            <Route path="/siembra/historial" element={<RoleRoute path="/siembra/historial"><SiembraHistorial /></RoleRoute>} />
            <Route path="/cosecha/registro" element={<RoleRoute path="/cosecha/registro"><CosechaRegistro /></RoleRoute>} />
            <Route path="/cosecha/despacho" element={<RoleRoute path="/cosecha/despacho"><CosechaDespachos /></RoleRoute>} />
            <Route path="/cosecha/proyeccion" element={<RoleRoute path="/cosecha/proyeccion"><CosechaProyeccion /></RoleRoute>} />
            <Route path="/cosecha/historial" element={<RoleRoute path="/cosecha/historial"><CosechaHistorial /></RoleRoute>} />
            <Route path="/cosecha/historial-despachos" element={<RoleRoute path="/cosecha/historial-despachos"><CosechaHistorialDespacho /></RoleRoute>} />
            {/* supervisor+ */}
            <Route path="/packages" element={<RoleRoute path="/packages"><PackageManagement /></RoleRoute>} />
            <Route path="/hr/planilla/fijo" element={<RoleRoute path="/hr/planilla/fijo"><FixedPayroll /></RoleRoute>} />
            <Route path="/hr/planilla/horas" element={<RoleRoute path="/hr/planilla/horas"><UnitPayroll /></RoleRoute>} />
            <Route path="/hr/planilla/horas/historial" element={<RoleRoute path="/hr/planilla/horas/historial"><UnitPayrollHistory /></RoleRoute>} />
            <Route path="/hr/historial-pagos" element={<RoleRoute path="/hr/historial-pagos"><FixedPayrollHistory /></RoleRoute>} />
            <Route path="/monitoreo/config" element={<RoleRoute path="/monitoreo/config"><TemplateConfig /></RoleRoute>} />
            <Route path="/monitoreo/paquetes" element={<RoleRoute path="/monitoreo/paquetes"><SamplingPackages /></RoleRoute>} />
            <Route path="/monitoreo/muestreos" element={<RoleRoute path="/monitoreo/muestreos"><SamplingCenter /></RoleRoute>} />
            <Route path="/admin/config-inicial" element={<RoleRoute path="/admin/config-inicial"><InitialSetup /></RoleRoute>} />
            <Route path="/admin/maquinaria" element={<RoleRoute path="/admin/maquinaria"><MaquinariaList /></RoleRoute>} />
            <Route path="/admin/labores" element={<RoleRoute path="/admin/labores"><LaborList /></RoleRoute>} />
            <Route path="/admin/unidades-medida" element={<RoleRoute path="/admin/unidades-medida"><UnidadesMedida /></RoleRoute>} />
            <Route path="/admin/calibraciones" element={<RoleRoute path="/admin/calibraciones"><Calibraciones /></RoleRoute>} />
            {/* Autopilot */}
            <Route path="/autopilot" element={<RoleRoute path="/autopilot"><AutopilotDashboard /></RoleRoute>} />
            <Route path="/autopilot/configuracion" element={<RoleRoute path="/autopilot/configuracion"><AutopilotConfig /></RoleRoute>} />
            <Route path="/procurement/dashboard" element={<RoleRoute path="/procurement/dashboard"><ProcurementDashboard /></RoleRoute>} />
            <Route path="/hr/performance" element={<RoleRoute path="/hr/performance"><PerformanceDashboard /></RoleRoute>} />
            <Route path="/hr/my-performance" element={<RoleRoute path="/hr/my-performance"><MyPerformance /></RoleRoute>} />
            <Route path="/procurement/rfqs" element={<RoleRoute path="/procurement/rfqs"><RfqsList /></RoleRoute>} />
            {/* Strategy (phase 4.1) */}
            <Route path="/strategy/rendimiento" element={<RoleRoute path="/strategy/rendimiento"><YieldHistory /></RoleRoute>} />
            <Route path="/strategy/temporadas" element={<RoleRoute path="/strategy/temporadas"><TemporadasManager /></RoleRoute>} />
            <Route path="/strategy/rotacion/restricciones" element={<RoleRoute path="/strategy/rotacion/restricciones"><RotationConstraints /></RoleRoute>} />
            <Route path="/strategy/rotacion/recomendador" element={<RoleRoute path="/strategy/rotacion/recomendador"><RotationRecommender /></RoleRoute>} />
            <Route path="/strategy/senales/fuentes" element={<RoleRoute path="/strategy/senales/fuentes"><SignalSources /></RoleRoute>} />
            <Route path="/strategy/senales" element={<RoleRoute path="/strategy/senales"><SignalsDashboard /></RoleRoute>} />
            <Route path="/strategy/escenarios" element={<RoleRoute path="/strategy/escenarios"><ScenariosSimulator /></RoleRoute>} />
            <Route path="/strategy/plan-anual" element={<RoleRoute path="/strategy/plan-anual"><AnnualPlan /></RoleRoute>} />
            {/* administrador */}
            <Route path="/admin/bodegas" element={<RoleRoute path="/admin/bodegas"><BodegasAdmin /></RoleRoute>} />
            <Route path="/admin/cierre-combustible" element={<RoleRoute path="/admin/cierre-combustible"><CierreCombustible /></RoleRoute>} />
            <Route path="/admin/parametros" element={<RoleRoute path="/admin/parametros"><Parameters /></RoleRoute>} />
          </Route>
        </Routes>
      </UserProvider>
    </Router>
  );
}

export default App;
