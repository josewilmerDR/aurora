import { BrowserRouter as Router, Routes, Route, Outlet, useLocation, Navigate } from 'react-router-dom';
import UserManagement from './pages/UserManagement';
import PackageManagement from './pages/PackageManagement';
import LoteManagement from './pages/LoteManagement';
import TaskTracking from './pages/TaskTracking';
import Dashboard from './pages/Dashboard';
import TaskAction from './pages/TaskAction';
import ProductManagement from './pages/ProductManagement';
import ProductCatalog from './pages/ProductCatalog';
import InvoiceScan from './pages/InvoiceScan';
import PurchaseRequest from './pages/PurchaseRequest';
import PurchaseOrder from './pages/PurchaseOrder';
import GoodsReceipt from './pages/GoodsReceipt';
import Login from './pages/Login';
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
import Sidebar from './components/Sidebar';
import { UserProvider, useUser } from './contexts/UserContext';

import './index.css';
import './App.css';

// Mapeo de rutas a títulos
const routeTitles = {
  '/': 'Panel de Control',
  '/users': 'Gestión de Usuarios',
  '/packages': 'Paquetes Técnicos',
  '/lotes': 'Gestión de Lotes',
  '/tasks': 'Seguimiento de Tareas',
  '/productos': 'Bodega de Agroquímicos',
  '/productos/todos': 'Inventario Completo',
  '/compras': 'Registrar Compra',
  '/solicitudes': 'Solicitud de Compra',
  '/recepcion': 'Recepción de Productos',
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
};

// --- Route guard ---
const ProtectedRoute = ({ children }) => {
  const { isLoggedIn } = useUser();
  return isLoggedIn ? children : <Navigate to="/login" replace />;
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
  const title = routeTitles[location.pathname] || 'Aurora';

  return (
    <div className="app-layout">
      <Sidebar />
      <main className="content-area">
        <header className="main-header">
          <h1>{title}</h1>
        </header>
        <div className="page-content">
          <Outlet />
        </div>
      </main>
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
            <Route path="/compras" element={<InvoiceScan />} />
            <Route path="/solicitudes" element={<PurchaseRequest />} />
            <Route path="/recepcion" element={<GoodsReceipt />} />
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
          </Route>
        </Routes>
      </UserProvider>
    </Router>
  );
}

export default App;
