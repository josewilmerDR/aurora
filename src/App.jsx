import { useState, useRef, useEffect } from 'react';
import { FiMenu } from 'react-icons/fi';
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
import Register from './pages/Register';
import FincaSelector from './pages/FincaSelector';
import HrFicha from './pages/HrFicha';
import HrAsistencia from './pages/HrAsistencia';
import HrHorasExtra from './pages/HrHorasExtra';
import HrPermisos from './pages/HrPermisos';
import HrPlanilla from './pages/HrPlanilla';
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
import GrupoManagement from './pages/GrupoManagement';
import CedulasAplicacion from './pages/CedulasAplicacion';
import Siembra from './pages/Siembra';
import SiembraMateriales from './pages/SiembraMateriales';
import SiembraHistorial from './pages/SiembraHistorial';
import Sidebar from './components/Sidebar';
import MobileNav from './components/MobileNav';
import AuroraChat from './components/AuroraChat';
import { UserProvider, useUser, hasMinRole } from './contexts/UserContext';
import { MODULES } from './components/Sidebar';

import './index.css';
import './App.css';

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
  '/admin/maquinaria': 'Lista de Maquinaria',
  '/grupos': 'Grupos',
  '/aplicaciones/cedulas': 'Cédulas de Aplicación',
  '/siembra': 'Registro de Siembra',
  '/siembra/materiales': 'Materiales de Siembra',
  '/siembra/historial': 'Historial de Siembra',
};

// --- Route guard ---
const ProtectedRoute = ({ children }) => {
  const { isLoggedIn, isLoading, needsFincaSelection, needsSetup } = useUser();
  if (isLoading) return <div className="app-loading">Cargando...</div>;
  if (!isLoggedIn && !needsFincaSelection && !needsSetup) return <Navigate to="/login" replace />;
  if (needsSetup) return <Navigate to="/register" replace />;
  if (needsFincaSelection) return <FincaSelector />;
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
  const title = routeTitles[location.pathname] || 'Aurora';
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
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
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') { setSearchQuery(''); setSearchResults([]); }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (searchResults.length > 0) {
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
      <header className="app-header">
        <button className="app-header-menu-btn" onClick={toggleCollapse} title={isCollapsed ? 'Expandir menú' : 'Colapsar menú'}>
          <FiMenu size={20} />
        </button>
        <div className="app-header-brand">
          <img src="/aurora-logo.png" alt="Aurora" className="app-header-logo" />
          <span className="app-header-name">Aurora</span>
        </div>
        <div className="app-header-search" ref={wrapperRef}>
          <form className="main-search-bar" onSubmit={handleSubmit}>
            <span className="main-search-icon">🔍</span>
            <input
              type="text"
              placeholder="Buscar funciones o preguntar a Aurora..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={handleKeyDown}
            />
          </form>
          {searchResults.length > 0 && (
            <div className="search-dropdown">
              {searchResults.map(item => (
                <button key={item.to} className="search-result-item" onMouseDown={() => handleSelect(item.to)}>
                  <span className="search-result-label">{item.label}</span>
                  {item.tag && <span className="search-result-tag">{item.tag}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
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
            <Route path="/register" element={<Register />} />
            <Route path="/logout" element={<LogoutRoute />} />
            <Route path="/task/:taskId" element={<TaskAction />} />
            <Route path="/orden-compra/:taskId" element={<PurchaseOrder />} />
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
            <Route path="/users" element={<UserManagement />} />
            <Route path="/packages" element={<PackageManagement />} />
            <Route path="/lotes" element={<LoteManagement />} />
            <Route path="/tasks" element={<TaskTracking />} />
            <Route path="/productos" element={<ProductManagement />} />
            <Route path="/productos/todos" element={<ProductCatalog />} />
            <Route path="/ingreso-productos" element={<ProductIngreso />} />
            <Route path="/compras" element={<InvoiceScan />} />
            <Route path="/solicitudes" element={<PurchaseRequest />} />
            <Route path="/recepcion" element={<GoodsReceipt />} />
            <Route path="/ordenes-compra" element={<OrdenesList />} />
            <Route path="/ordenes-compra/historial" element={<OrdenesHistorial />} />
            <Route path="/proveedores" element={<ProveedoresList />} />
            <Route path="/hr/ficha" element={<HrFicha />} />
            <Route path="/hr/asistencia" element={<HrAsistencia />} />
            <Route path="/hr/horas-extra" element={<HrHorasExtra />} />
            <Route path="/hr/permisos" element={<HrPermisos />} />
            <Route path="/hr/planilla" element={<HrPlanilla />} />
            <Route path="/hr/historial-pagos" element={<HrHistorialPagos />} />
            <Route path="/hr/historial" element={<HrHistorial />} />
            <Route path="/hr/documentos" element={<HrDocumentos />} />
            <Route path="/hr/memorandums" element={<HrMemorandums />} />
            <Route path="/hr/solicitud-empleo" element={<HrSolicitudEmpleo />} />
            <Route path="/monitoreo" element={<MonitoreoRegistro />} />
            <Route path="/monitoreo/historial" element={<MonitoreoHistorial />} />
            <Route path="/monitoreo/config" element={<MonitoreoConfig />} />
            <Route path="/config/cuenta" element={<ConfigCuenta />} />
            <Route path="/admin/parametros" element={<Parametros />} />
            <Route path="/admin/maquinaria" element={<MaquinariaList />} />
            <Route path="/grupos" element={<GrupoManagement />} />
            <Route path="/aplicaciones/cedulas" element={<CedulasAplicacion />} />
            <Route path="/siembra" element={<Siembra />} />
            <Route path="/siembra/materiales" element={<SiembraMateriales />} />
            <Route path="/siembra/historial" element={<SiembraHistorial />} />
          </Route>
        </Routes>
      </UserProvider>
    </Router>
  );
}

export default App;
