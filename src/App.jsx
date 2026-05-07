import { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Outlet, useLocation, Navigate } from 'react-router-dom';
import UserManagement from './features/admin/pages/UserManagement';
import PackageManagement from './features/applications/pages/PackageManagement';
import LoteManagement from './features/fields/pages/LoteManagement';
import TaskTracking from './features/tasks/pages/TaskTracking';
import Dashboard from './features/dashboard/pages/Dashboard';
import TaskAction from './features/tasks/pages/TaskAction';
import Existencias from './features/inventory/pages/Existencias';
import ProductosCatalogo from './features/inventory/pages/ProductosCatalogo';
import Recepcion from './features/inventory/pages/Recepcion';
import MovimientosHistorial from './features/inventory/pages/MovimientosHistorial';
import RecepcionViewer from './features/inventory/pages/RecepcionViewer';
import OCDesdeSolicitud from './features/procurement/pages/OCDesdeSolicitud';
import OCNueva from './features/procurement/pages/OCNueva';
import OCHistorial from './features/procurement/pages/OCHistorial';
import ProveedoresList from './features/procurement/pages/ProveedoresList';
import Login from './features/auth/pages/Login';
import LoginPassword from './features/auth/pages/LoginPassword';
import Register from './features/auth/pages/Register';
import ForgotPassword from './features/auth/pages/ForgotPassword';
import Profile from './features/account/pages/Profile';
import OrganizationSelector from './features/auth/pages/OrganizationSelector';
import NewOrganization from './features/auth/pages/NewOrganization';
import EmployeeProfile from './features/hr/pages/EmployeeProfile';
import LeaveRequests from './features/hr/pages/LeaveRequests';
import FixedPayrollPage from './features/hr/pages/FixedPayrollPage';
import FixedPayrollReport from './features/hr/pages/FixedPayrollReport';
import UnitPayrollPage from './features/hr/pages/UnitPayrollPage';
import SamplingHistory from './features/monitoring/pages/SamplingHistory';
import TemplateConfig from './features/monitoring/pages/TemplateConfig';
import SamplingPackages from './features/monitoring/pages/SamplingPackages';
import SamplingCenter from './features/monitoring/pages/SamplingCenter';
import AccountSettings from './features/account/pages/AccountSettings';
import Parameters from './features/admin/pages/Parameters';
import MaquinariaList from './features/machinery/pages/MaquinariaList';
import InitialSetup from './features/admin/pages/InitialSetup';
import AuditEvents from './features/admin/pages/AuditEvents';
import Calibraciones from './features/machinery/pages/Calibraciones';
import LaborList from './features/admin/pages/LaborList';
import UnidadesMedida from './features/admin/pages/UnidadesMedida';
import Horimetro from './features/machinery/pages/Horimetro';
import RegistroHorimetro from './features/machinery/pages/RegistroHorimetro';
import HistorialHorimetros from './features/machinery/pages/HistorialHorimetros';
import GrupoManagement from './features/fields/pages/GrupoManagement';
import CedulasAplicacion from './features/applications/pages/CedulasAplicacion';
import HistorialAplicaciones from './features/applications/pages/HistorialAplicaciones';
import CedulaViewer from './features/applications/pages/CedulaViewer';
import BodegasAdmin from './features/inventory/pages/BodegasAdmin';
import CierreCombustible from './features/machinery/pages/CierreCombustible';
import BodegaGenerica from './features/inventory/pages/BodegaGenerica';
import BodegaCombustibles from './features/inventory/pages/BodegaCombustibles';
import Siembra from './features/planting/pages/Siembra';
import SiembraMateriales from './features/planting/pages/SiembraMateriales';
import SiembraHistorial from './features/planting/pages/SiembraHistorial';
import CosechaProyeccion from './features/harvest/pages/CosechaProyeccion';
import CosechaRegistro from './features/harvest/pages/CosechaRegistro';
import CosechaDespachos from './features/harvest/pages/CosechaDespachos';
import CostCenter from './features/costs/pages/CostCenter';
import Budgets from './features/finance/pages/Budgets';
import FinanceDashboard from './features/finance/pages/FinanceDashboard';
import FinancingDashboard from './features/finance/pages/FinancingDashboard';
import CreditOffers from './features/finance/pages/CreditOffers';
import DebtSimulations from './features/finance/pages/DebtSimulations';
import CeoDashboard from './features/ceo/pages/CeoDashboard';
import IncomeRecords from './features/finance/pages/IncomeRecords';
import BuyersList from './features/finance/pages/BuyersList';
import Treasury from './features/finance/pages/Treasury';
import AutopilotDashboard from './features/autopilot/pages/AutopilotDashboard';
import AutopilotConfig from './features/autopilot/pages/AutopilotConfig';
import ProcurementDashboard from './features/procurement/pages/ProcurementDashboard';
import YieldHistory from './features/strategy/pages/YieldHistory';
import TemporadasManager from './features/strategy/pages/TemporadasManager';
import RotationConstraints from './features/strategy/pages/RotationConstraints';
import RotationRecommender from './features/strategy/pages/RotationRecommender';
import SignalSources from './features/strategy/pages/SignalSources';
import SignalsDashboard from './features/strategy/pages/SignalsDashboard';
import ScenariosSimulator from './features/strategy/pages/ScenariosSimulator';
import AnnualPlan from './features/strategy/pages/AnnualPlan';
import RfqsList from './features/procurement/pages/RfqsList';
import ProcurementHub from './features/procurement/pages/ProcurementHub';
import Sidebar from './components/Sidebar';
import MobileNav from './components/MobileNav';
import AuroraChat from './components/AuroraChat';
import OnboardingChecklist from './features/dashboard/components/OnboardingChecklist';
import AppHeader from './components/AppHeader';
import AutopilotPanel from './features/autopilot/components/AutopilotPanel';
import ReminderNotification from './components/ReminderNotification';
import { useReminderPoller } from './hooks/useReminderPoller';
import { usePushNotifications } from './hooks/usePushNotifications';
import { UserProvider, useUser, hasMinRole } from './contexts/UserContext';
import { RemindersProvider, useReminders } from './contexts/RemindersContext';
import { ALL_ITEMS } from './components/Sidebar';
import { ADVANCED_ENABLED } from './lib/features';

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
  '/bodega/combustibles': 'encargado',
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
  // Procurement hub — children inherit the role gate from the parent route,
  // so only the canonical entry needs an explicit minRole here.
  '/procurement': 'encargado',
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
  const { pendingReminders, dismissReminder } = useReminderPoller();
  const { reload: reloadReminders } = useReminders();
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
    setAutopilotOpen(true);
  };
  const toggleProfile = () => {
    setAutopilotOpen(false);
    setProfileOpen(o => {
      const next = !o;
      // Cuando se abre el panel, refresca recordatorios para captar cambios
      // hechos en otros lugares (p.ej. creados desde el chat).
      if (next) reloadReminders();
      return next;
    });
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

  return (
    <div className="app-wrapper">
      <AppHeader
        isCollapsed={isCollapsed}
        toggleCollapse={toggleCollapse}
        profileOpen={profileOpen}
        onToggleProfile={toggleProfile}
        autopilotOpen={autopilotOpen}
        onOpenAutopilot={openAutopilot}
      />

      {/* ── Body ── */}
      <div className="app-layout">
        <Sidebar isCollapsed={isCollapsed} toggleCollapse={toggleCollapse} />
        <main className="content-area">
          <Outlet />
        </main>
      </div>

      <MobileNav />
      <AuroraChat />
      <OnboardingChecklist />
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
            <Route path="/config/cuenta" element={<AccountSettings />} />
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
          </Route>
        </Routes>
      </UserProvider>
    </Router>
  );
}

export default App;
