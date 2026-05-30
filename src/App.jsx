import { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, Outlet, useLocation, Navigate } from 'react-router-dom';

// ─── Eager: páginas de la ruta caliente ──────────────────────────────────────
// Auth flow (la app no arranca sin estos), pantallas más visitadas (Home,
// Tareas, Lotes, Existencias) y Profile (que se monta siempre en el panel
// lateral del MainLayout, así que un lazy aquí pegaría a todo el árbol
// autenticado). Todo lo demás se carga bajo demanda.
import Login from './features/auth/pages/Login';
import LoginPassword from './features/auth/pages/LoginPassword';
import Register from './features/auth/pages/Register';
import ForgotPassword from './features/auth/pages/ForgotPassword';
import OrganizationSelector from './features/auth/pages/OrganizationSelector';
import NewOrganization from './features/auth/pages/NewOrganization';
import Dashboard from './features/dashboard/pages/Dashboard';
import TaskTracking from './features/tasks/pages/TaskTracking';
import TaskAction from './features/tasks/pages/TaskAction';
import LoteManagement from './features/fields/pages/LoteManagement';
import Existencias from './features/inventory/pages/Existencias';
import Profile from './features/account/pages/Profile';

// ─── Lazy: páginas detrás de un click ────────────────────────────────────────
// Cada lazy() genera un chunk independiente; el initial bundle de la app
// arranca con ~50% menos código. El fallback de <Suspense> es el mismo
// .app-loading que usa ProtectedRoute mientras resuelve auth.
const UserManagement = lazy(() => import('./features/admin/pages/UserManagement'));
const PackageManagement = lazy(() => import('./features/applications/pages/PackageManagement'));
const ProductosCatalogo = lazy(() => import('./features/inventory/pages/ProductosCatalogo'));
const Recepcion = lazy(() => import('./features/inventory/pages/Recepcion'));
const MovimientosHistorial = lazy(() => import('./features/inventory/pages/MovimientosHistorial'));
const RecepcionViewer = lazy(() => import('./features/inventory/pages/RecepcionViewer'));
const OCDesdeSolicitud = lazy(() => import('./features/procurement/pages/OCDesdeSolicitud'));
const OCNueva = lazy(() => import('./features/procurement/pages/OCNueva'));
const OCHistorial = lazy(() => import('./features/procurement/pages/OCHistorial'));
const ProveedoresList = lazy(() => import('./features/procurement/pages/ProveedoresList'));
const EmployeeProfile = lazy(() => import('./features/hr/pages/EmployeeProfile'));
const LeaveRequests = lazy(() => import('./features/hr/pages/LeaveRequests'));
const Asistencia = lazy(() => import('./features/hr/pages/Asistencia'));
const FixedPayrollPage = lazy(() => import('./features/hr/pages/FixedPayrollPage'));
const FixedPayrollReport = lazy(() => import('./features/hr/pages/FixedPayrollReport'));
const UnitPayrollPage = lazy(() => import('./features/hr/pages/UnitPayrollPage'));
const SamplingHistory = lazy(() => import('./features/monitoring/pages/SamplingHistory'));
const TemplateConfig = lazy(() => import('./features/monitoring/pages/TemplateConfig'));
const SamplingPackages = lazy(() => import('./features/monitoring/pages/SamplingPackages'));
const SamplingCenter = lazy(() => import('./features/monitoring/pages/SamplingCenter'));
const AccountSettings = lazy(() => import('./features/account/pages/AccountSettings'));
const Parameters = lazy(() => import('./features/admin/pages/Parameters'));
const MaquinariaList = lazy(() => import('./features/machinery/pages/MaquinariaList'));
const InitialSetup = lazy(() => import('./features/admin/pages/InitialSetup'));
const AuditEvents = lazy(() => import('./features/admin/pages/AuditEvents'));
const Calibraciones = lazy(() => import('./features/machinery/pages/Calibraciones'));
const LaborList = lazy(() => import('./features/admin/pages/LaborList'));
const UnidadesMedida = lazy(() => import('./features/admin/pages/UnidadesMedida'));
const Horimetro = lazy(() => import('./features/machinery/pages/Horimetro'));
const RegistroHorimetro = lazy(() => import('./features/machinery/pages/RegistroHorimetro'));
const HistorialHorimetros = lazy(() => import('./features/machinery/pages/HistorialHorimetros'));
const GrupoManagement = lazy(() => import('./features/fields/pages/GrupoManagement'));
const CedulasAplicacion = lazy(() => import('./features/applications/pages/CedulasAplicacion'));
const HistorialAplicaciones = lazy(() => import('./features/applications/pages/HistorialAplicaciones'));
const CedulaViewer = lazy(() => import('./features/applications/pages/CedulaViewer'));
const BodegasAdmin = lazy(() => import('./features/inventory/pages/BodegasAdmin'));
const CierreCombustible = lazy(() => import('./features/machinery/pages/CierreCombustible'));
const BodegaGenerica = lazy(() => import('./features/inventory/pages/BodegaGenerica'));
const BodegaCombustibles = lazy(() => import('./features/inventory/pages/BodegaCombustibles'));
const Siembra = lazy(() => import('./features/planting/pages/Siembra'));
const SiembraMateriales = lazy(() => import('./features/planting/pages/SiembraMateriales'));
const SiembraHistorial = lazy(() => import('./features/planting/pages/SiembraHistorial'));
const CosechaProyeccion = lazy(() => import('./features/harvest/pages/CosechaProyeccion'));
const CosechaRegistro = lazy(() => import('./features/harvest/pages/CosechaRegistro'));
const CosechaDespachos = lazy(() => import('./features/harvest/pages/CosechaDespachos'));
const CostCenter = lazy(() => import('./features/costs/pages/CostCenter'));
const Budgets = lazy(() => import('./features/finance/pages/Budgets'));
const FinanceDashboard = lazy(() => import('./features/finance/pages/FinanceDashboard'));
const FinancingDashboard = lazy(() => import('./features/finance/pages/FinancingDashboard'));
const CreditOffers = lazy(() => import('./features/finance/pages/CreditOffers'));
const DebtSimulations = lazy(() => import('./features/finance/pages/DebtSimulations'));
const CeoDashboard = lazy(() => import('./features/ceo/pages/CeoDashboard'));
const IncomeRecords = lazy(() => import('./features/finance/pages/IncomeRecords'));
const BuyersList = lazy(() => import('./features/finance/pages/BuyersList'));
const Treasury = lazy(() => import('./features/finance/pages/Treasury'));
const AutopilotDashboard = lazy(() => import('./features/autopilot/pages/AutopilotDashboard'));
const AutopilotConfig = lazy(() => import('./features/autopilot/pages/AutopilotConfig'));
const ProcurementDashboard = lazy(() => import('./features/procurement/pages/ProcurementDashboard'));
const YieldHistory = lazy(() => import('./features/strategy/pages/YieldHistory'));
const TemporadasManager = lazy(() => import('./features/strategy/pages/TemporadasManager'));
const RotationConstraints = lazy(() => import('./features/strategy/pages/RotationConstraints'));
const RotationRecommender = lazy(() => import('./features/strategy/pages/RotationRecommender'));
const SignalSources = lazy(() => import('./features/strategy/pages/SignalSources'));
const SignalsDashboard = lazy(() => import('./features/strategy/pages/SignalsDashboard'));
const ScenariosSimulator = lazy(() => import('./features/strategy/pages/ScenariosSimulator'));
const AnnualPlan = lazy(() => import('./features/strategy/pages/AnnualPlan'));
const RfqsList = lazy(() => import('./features/procurement/pages/RfqsList'));
const ProcurementHub = lazy(() => import('./features/procurement/pages/ProcurementHub'));
import Sidebar from './components/Sidebar';
import MobileNav from './components/MobileNav';
import AuroraChat from './components/AuroraChat';
import OnboardingChecklist from './features/dashboard/components/OnboardingChecklist';
import AppHeader from './components/AppHeader';
import AutopilotPanel from './features/autopilot/components/AutopilotPanel';
import ReminderNotification from './components/ReminderNotification';
import ErrorBoundary from './components/ErrorBoundary';
import NotFoundPage from './components/NotFoundPage';
import { useReminderPoller } from './hooks/useReminderPoller';
import { usePushNotifications } from './hooks/usePushNotifications';
import { useAutoPageTitle } from './hooks/usePageTitle';
import { useEscapeClose } from './hooks/useEscapeClose';
import { UserProvider, useUser, hasMinRole } from './contexts/UserContext';
import { RemindersProvider, useReminders } from './contexts/RemindersContext';
import { ToastProvider } from './contexts/ToastContext';
import { resolveRouteMinRole } from './lib/routeRoles';
import { ADVANCED_ENABLED } from './lib/features';

import './index.css';
import './App.css';

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
  // Fail-closed: resolveRouteMinRole defaults an unmapped path to 'administrador'
  // (see src/lib/routeRoles.js), so a new route can't silently fall to trabajador.
  const minRole = resolveRouteMinRole(path);
  if (!hasMinRole(userRole, minRole)) return <Navigate to="/" replace />;
  return children;
};

// v1 public release: wraps routes for Estrategia / Financiamiento / CEO /
// Autopilot. When ADVANCED_ENABLED is false, deep-links redirect to home.
const AdvancedRoute = ({ children }) => {
  if (!ADVANCED_ENABLED) return <Navigate to="/" replace />;
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
  const { currentUser } = useUser();
  const [profileOpen, setProfileOpen] = useState(false);
  const [autopilotOpen, setAutopilotOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatBadge, setChatBadge] = useState(0);
  const { pendingReminders, dismissReminder } = useReminderPoller();
  const { reload: reloadReminders } = useReminders();
  const profilePanelRef = useRef(null);
  // ESC cierra el panel de perfil (solo cuando está abierto: pasar null
  // desactiva el handler). Patrón del stack innermost de useEscapeClose.
  useEscapeClose(profileOpen ? () => setProfileOpen(false) : null);
  // Al abrir, mover el foco al panel para que el teclado/lector entren al
  // diálogo en vez de quedar detrás del backdrop.
  useEffect(() => {
    if (profileOpen) profilePanelRef.current?.focus();
  }, [profileOpen]);
  useAutoPageTitle();
  const { permission, isSubscribed, subscribe } = usePushNotifications();
  const [pushPromptDismissed, setPushPromptDismissed] = useState(() =>
    localStorage.getItem('aurora_push_prompt_dismissed') === 'true'
  );
  const showPushPrompt = permission === 'default' && !isSubscribed && !pushPromptDismissed && 'PushManager' in window;

  const [swUpdateVisible, setSwUpdateVisible] = useState(false);
  useEffect(() => {
    if (window.__swUpdatePending) setSwUpdateVisible(true);
    const handler = () => setSwUpdateVisible(true);
    window.addEventListener('sw-update-available', handler);
    return () => window.removeEventListener('sw-update-available', handler);
  }, []);
  const dismissPushPrompt = () => {
    localStorage.setItem('aurora_push_prompt_dismissed', 'true');
    setPushPromptDismissed(true);
  };

  const userRole = currentUser?.rol || 'trabajador';
  // v1 public release: Autopilot panel only renders when advanced features
  // are enabled; mirrors the gate on the header button in AppHeader.jsx.
  const canSeeAutopilot = ADVANCED_ENABLED && hasMinRole(userRole, 'encargado');

  const openAutopilot = () => {
    setProfileOpen(false);
    setChatOpen(false);
    setAutopilotOpen(true);
  };
  const toggleProfile = () => {
    setAutopilotOpen(false);
    setChatOpen(false);
    setProfileOpen(o => {
      const next = !o;
      // Cuando se abre el panel, refresca recordatorios para captar cambios
      // hechos en otros lugares (p.ej. creados desde el chat).
      if (next) reloadReminders();
      return next;
    });
  };
  const toggleChat = () => {
    setProfileOpen(false);
    setAutopilotOpen(false);
    setChatOpen(o => !o);
  };
  const openChat = () => {
    setProfileOpen(false);
    setAutopilotOpen(false);
    setChatOpen(true);
  };
  const closeChat = () => setChatOpen(false);

  const [isCollapsed, setIsCollapsed] = useState(() => {
    try { return localStorage.getItem('aurora_sidebar_collapsed') === 'true'; }
    catch { return false; }
  });
  const toggleCollapse = () => setIsCollapsed(prev => {
    const next = !prev;
    localStorage.setItem('aurora_sidebar_collapsed', String(next));
    return next;
  });

  return (
    <div className="app-wrapper">
      <a href="#main-content" className="aur-skip-link">Saltar al contenido</a>
      <AppHeader
        isCollapsed={isCollapsed}
        toggleCollapse={toggleCollapse}
        profileOpen={profileOpen}
        onToggleProfile={toggleProfile}
        autopilotOpen={autopilotOpen}
        onOpenAutopilot={openAutopilot}
        chatOpen={chatOpen}
        onToggleChat={toggleChat}
        chatBadge={chatBadge}
      />

      {/* ── Body ── */}
      <div className="app-layout">
        <Sidebar isCollapsed={isCollapsed} toggleCollapse={toggleCollapse} />
        <main className="content-area" id="main-content" tabIndex={-1}>
          <Outlet />
        </main>
      </div>

      <MobileNav />
      <AuroraChat
        open={chatOpen}
        onClose={closeChat}
        onRequestOpen={openChat}
        onBadgeChange={setChatBadge}
      />
      <OnboardingChecklist />
      <ReminderNotification reminders={pendingReminders} onDismiss={dismissReminder} />

      {/* ── Profile panel ── */}
      {profileOpen && (
        <div className="profile-panel-backdrop" onClick={() => setProfileOpen(false)} />
      )}
      <div
        ref={profilePanelRef}
        className={`profile-panel${profileOpen ? ' open' : ''}`}
        role="dialog"
        aria-modal={profileOpen}
        aria-label="Mi perfil"
        aria-hidden={!profileOpen}
        inert={!profileOpen ? '' : undefined}
        tabIndex={-1}
      >
        <Profile onClose={() => setProfileOpen(false)} />
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

const SimpleLayout = () => {
  useAutoPageTitle();
  return (
    <div className="SimpleApp">
      <main>
        <Outlet />
      </main>
    </div>
  );
};

// --- App ---

function App() {
  return (
    <Router>
      <UserProvider>
        <ErrorBoundary>
          <ToastProvider>
          <Suspense fallback={<div className="app-loading" />}>
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
                <RemindersProvider>
                  <MainLayout />
                </RemindersProvider>
              </ProtectedRoute>
            }
          >
            <Route path="/" element={<Dashboard />} />
            <Route path="/tasks" element={<TaskTracking />} />
            <Route path="/operaciones/horimetro" element={<Horimetro />} />
            <Route path="/operaciones/horimetro/registro" element={<RegistroHorimetro />} />
            <Route path="/operaciones/horimetro/historial" element={<HistorialHorimetros />} />
            <Route path="/config/cuenta" element={<RoleRoute path="/config/cuenta"><AccountSettings /></RoleRoute>} />
            <Route path="/mi-perfil" element={<Profile />} />
            {/* encargado+ */}
            <Route path="/users" element={<RoleRoute path="/users"><UserManagement /></RoleRoute>} />
            <Route path="/lotes" element={<RoleRoute path="/lotes"><LoteManagement /></RoleRoute>} />
            <Route path="/grupos" element={<RoleRoute path="/grupos"><GrupoManagement /></RoleRoute>} />
            {/* Canonical bodega routes — pattern /bodega/:bodegaId/:submodule */}
            <Route path="/bodega/agroquimicos/existencias" element={<RoleRoute path="/bodega/agroquimicos/existencias"><Existencias /></RoleRoute>} />
            <Route path="/bodega/agroquimicos/recepcion" element={<RoleRoute path="/bodega/agroquimicos/recepcion"><Recepcion /></RoleRoute>} />
            <Route path="/bodega/agroquimicos/movimientos" element={<RoleRoute path="/bodega/agroquimicos/movimientos"><MovimientosHistorial /></RoleRoute>} />
            <Route path="/bodega/agroquimicos/recepciones/:id" element={<RoleRoute path="/bodega/agroquimicos/movimientos"><RecepcionViewer /></RoleRoute>} />
            <Route path="/bodega/combustibles" element={<RoleRoute path="/bodega/combustibles"><BodegaCombustibles /></RoleRoute>} />
            <Route path="/bodega/:bodegaId" element={<RoleRoute path="/bodega/agroquimicos/existencias"><BodegaGenerica /></RoleRoute>} />
            {/* Legacy route redirects → canonical */}
            <Route path="/productos" element={<Navigate to="/bodega/agroquimicos/existencias" replace />} />
            <Route path="/ingreso-productos" element={<Navigate to="/bodega/agroquimicos/recepcion" replace />} />
            <Route path="/productos/movimientos" element={<Navigate to="/bodega/agroquimicos/movimientos" replace />} />
            <Route path="/productos/todos" element={<RoleRoute path="/productos/todos"><ProductosCatalogo /></RoleRoute>} />
            {/* Compras hub — single canonical entry point with tabs.
                Old standalone URLs redirect to the hub-aware route below. */}
            <Route path="/procurement" element={<RoleRoute path="/procurement"><ProcurementHub /></RoleRoute>}>
              <Route index element={<ProcurementDashboard />} />
              <Route path="ordenes" element={<OCNueva />} />
              <Route path="ordenes/historial" element={<OCHistorial />} />
              <Route path="cotizaciones" element={<RfqsList />} />
              <Route path="proveedores" element={<ProveedoresList />} />
            </Route>
            {/* Backward-compat redirects for bookmarks and push-notification deep-links. */}
            <Route path="/procurement/dashboard" element={<Navigate to="/procurement" replace />} />
            <Route path="/procurement/rfqs" element={<Navigate to="/procurement/cotizaciones" replace />} />
            <Route path="/ordenes-compra" element={<Navigate to="/procurement/ordenes" replace />} />
            <Route path="/ordenes-compra/historial" element={<Navigate to="/procurement/ordenes/historial" replace />} />
            <Route path="/proveedores" element={<Navigate to="/procurement/proveedores" replace />} />
            <Route path="/costos" element={<RoleRoute path="/costos"><CostCenter /></RoleRoute>} />
            <Route path="/finance/dashboard" element={<RoleRoute path="/finance/dashboard"><FinanceDashboard /></RoleRoute>} />
            <Route path="/finance/presupuestos" element={<RoleRoute path="/finance/presupuestos"><Budgets /></RoleRoute>} />
            <Route path="/finance/tesoreria" element={<RoleRoute path="/finance/tesoreria"><Treasury /></RoleRoute>} />
            <Route path="/finance/ingresos" element={<RoleRoute path="/finance/ingresos"><IncomeRecords /></RoleRoute>} />
            <Route path="/finance/compradores" element={<RoleRoute path="/finance/compradores"><BuyersList /></RoleRoute>} />
            <Route path="/finance/financing" element={<AdvancedRoute><RoleRoute path="/finance/financing"><FinancingDashboard /></RoleRoute></AdvancedRoute>} />
            <Route path="/finance/financing/ofertas" element={<AdvancedRoute><RoleRoute path="/finance/financing/ofertas"><CreditOffers /></RoleRoute></AdvancedRoute>} />
            <Route path="/finance/financing/simulaciones" element={<AdvancedRoute><RoleRoute path="/finance/financing/simulaciones"><DebtSimulations /></RoleRoute></AdvancedRoute>} />
            <Route path="/ceo" element={<AdvancedRoute><RoleRoute path="/ceo"><CeoDashboard /></RoleRoute></AdvancedRoute>} />
            <Route path="/hr/ficha" element={<RoleRoute path="/hr/ficha"><EmployeeProfile /></RoleRoute>} />
            <Route path="/hr/asistencia" element={<RoleRoute path="/hr/asistencia"><Asistencia /></RoleRoute>} />
            <Route path="/hr/permisos" element={<RoleRoute path="/hr/permisos"><LeaveRequests /></RoleRoute>} />
            <Route path="/monitoreo/historial" element={<RoleRoute path="/monitoreo/historial"><SamplingHistory /></RoleRoute>} />
            <Route path="/aplicaciones/cedulas" element={<RoleRoute path="/aplicaciones/cedulas"><CedulasAplicacion /></RoleRoute>} />
            <Route path="/aplicaciones/historial" element={<RoleRoute path="/aplicaciones/historial"><HistorialAplicaciones /></RoleRoute>} />
            <Route path="/aplicaciones/cedula/:id" element={<RoleRoute path="/aplicaciones/cedulas"><CedulaViewer /></RoleRoute>} />
            <Route path="/siembra" element={<RoleRoute path="/siembra"><Siembra /></RoleRoute>} />
            <Route path="/siembra/materiales" element={<RoleRoute path="/siembra/materiales"><SiembraMateriales /></RoleRoute>} />
            <Route path="/siembra/historial" element={<RoleRoute path="/siembra/historial"><SiembraHistorial /></RoleRoute>} />
            <Route path="/cosecha/despacho" element={<RoleRoute path="/cosecha/despacho"><CosechaDespachos /></RoleRoute>} />
            <Route path="/cosecha/proyeccion" element={<RoleRoute path="/cosecha/proyeccion"><CosechaProyeccion /></RoleRoute>} />
            <Route path="/cosecha/registro" element={<RoleRoute path="/cosecha/registro"><CosechaRegistro /></RoleRoute>} />
            {/* supervisor+ */}
            <Route path="/packages" element={<RoleRoute path="/packages"><PackageManagement /></RoleRoute>} />
            <Route path="/hr/planilla/fijo" element={<RoleRoute path="/hr/planilla/fijo"><FixedPayrollPage /></RoleRoute>} />
            <Route path="/hr/planilla/horas" element={<RoleRoute path="/hr/planilla/horas"><UnitPayrollPage /></RoleRoute>} />
            {/* Historiales antes vivían en rutas independientes; ahora son tabs dentro
                de los hubs. Mantenemos redirects para no romper deep-links viejos. */}
            <Route path="/hr/historial-pagos" element={<Navigate to="/hr/planilla/fijo" replace />} />
            <Route path="/hr/planilla/horas/historial" element={<Navigate to="/hr/planilla/horas" replace />} />
            <Route path="/monitoreo/config" element={<RoleRoute path="/monitoreo/config"><TemplateConfig /></RoleRoute>} />
            <Route path="/monitoreo/paquetes" element={<RoleRoute path="/monitoreo/paquetes"><SamplingPackages /></RoleRoute>} />
            <Route path="/monitoreo/muestreos" element={<RoleRoute path="/monitoreo/muestreos"><SamplingCenter /></RoleRoute>} />
            <Route path="/admin/config-inicial" element={<RoleRoute path="/admin/config-inicial"><InitialSetup /></RoleRoute>} />
            <Route path="/admin/maquinaria" element={<RoleRoute path="/admin/maquinaria"><MaquinariaList /></RoleRoute>} />
            <Route path="/admin/labores" element={<RoleRoute path="/admin/labores"><LaborList /></RoleRoute>} />
            <Route path="/admin/unidades-medida" element={<RoleRoute path="/admin/unidades-medida"><UnidadesMedida /></RoleRoute>} />
            <Route path="/admin/calibraciones" element={<RoleRoute path="/admin/calibraciones"><Calibraciones /></RoleRoute>} />
            {/* Autopilot (gated by ADVANCED_ENABLED for the v1 public release) */}
            <Route path="/autopilot" element={<AdvancedRoute><RoleRoute path="/autopilot"><AutopilotDashboard /></RoleRoute></AdvancedRoute>} />
            <Route path="/autopilot/configuracion" element={<AdvancedRoute><RoleRoute path="/autopilot/configuracion"><AutopilotConfig /></RoleRoute></AdvancedRoute>} />
            {/* Strategy (phase 4.1) — gated by ADVANCED_ENABLED for v1 */}
            <Route path="/strategy/rendimiento" element={<AdvancedRoute><RoleRoute path="/strategy/rendimiento"><YieldHistory /></RoleRoute></AdvancedRoute>} />
            <Route path="/strategy/temporadas" element={<AdvancedRoute><RoleRoute path="/strategy/temporadas"><TemporadasManager /></RoleRoute></AdvancedRoute>} />
            <Route path="/strategy/rotacion/restricciones" element={<AdvancedRoute><RoleRoute path="/strategy/rotacion/restricciones"><RotationConstraints /></RoleRoute></AdvancedRoute>} />
            <Route path="/strategy/rotacion/recomendador" element={<AdvancedRoute><RoleRoute path="/strategy/rotacion/recomendador"><RotationRecommender /></RoleRoute></AdvancedRoute>} />
            <Route path="/strategy/senales/fuentes" element={<AdvancedRoute><RoleRoute path="/strategy/senales/fuentes"><SignalSources /></RoleRoute></AdvancedRoute>} />
            <Route path="/strategy/senales" element={<AdvancedRoute><RoleRoute path="/strategy/senales"><SignalsDashboard /></RoleRoute></AdvancedRoute>} />
            <Route path="/strategy/escenarios" element={<AdvancedRoute><RoleRoute path="/strategy/escenarios"><ScenariosSimulator /></RoleRoute></AdvancedRoute>} />
            <Route path="/strategy/plan-anual" element={<AdvancedRoute><RoleRoute path="/strategy/plan-anual"><AnnualPlan /></RoleRoute></AdvancedRoute>} />
            {/* administrador */}
            <Route path="/admin/bodegas" element={<RoleRoute path="/admin/bodegas"><BodegasAdmin /></RoleRoute>} />
            <Route path="/admin/cierre-combustible" element={<RoleRoute path="/admin/cierre-combustible"><CierreCombustible /></RoleRoute>} />
            <Route path="/admin/parametros" element={<RoleRoute path="/admin/parametros"><Parameters /></RoleRoute>} />
            <Route path="/admin/auditoria" element={<RoleRoute path="/admin/auditoria"><AuditEvents /></RoleRoute>} />
            {/* Catch-all 404 dentro del MainLayout: el usuario autenticado
                ve la página de "no encontrado" sin perder header + sidebar. */}
            <Route path="*" element={<NotFoundPage />} />
          </Route>
          </Routes>
          </Suspense>
          </ToastProvider>
        </ErrorBoundary>
      </UserProvider>
    </Router>
  );
}

export default App;
