import { BrowserRouter as Router, Routes, Route, Outlet, useLocation } from 'react-router-dom';
import UserManagement from './pages/UserManagement';
import PackageManagement from './pages/PackageManagement';
import LoteManagement from './pages/LoteManagement';
import TaskTracking from './pages/TaskTracking';
import Dashboard from './pages/Dashboard';
import TaskAction from './pages/TaskAction';
import ProductManagement from './pages/ProductManagement';
import ProductCatalog from './pages/ProductCatalog';
import InvoiceScan from './pages/InvoiceScan';
import Sidebar from './components/Sidebar';

import './index.css';
import './App.css';

// Mapeo de rutas a títulos
const routeTitles = {
  '/': 'Panel de Control',
  '/users': 'Gestión de Usuarios',
  '/packages': 'Gestión de Paquetes',
  '/lotes': 'Gestión de Lotes',
  '/tasks': 'Seguimiento de Tareas',
  '/productos': 'Bodega de Agroquímicos',
  '/productos/todos': 'Inventario Completo',
  '/compras': 'Registrar Compra'
};

// --- Layouts ---

// 1. Nuevo Layout Principal con Sidebar y Header dinámico
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

// 2. Layout Sencillo, sin navegación (se mantiene igual)
const SimpleLayout = () => (
    <div className="SimpleApp">
        <main>
            <Outlet />
        </main>
    </div>
);

// --- Componente Principal de la App ---

function App() {
  return (
    <Router>
      <Routes>
        {/* 3. Rutas que usan el Layout Principal con Sidebar */}
        <Route element={<MainLayout />}>
          <Route path="/" element={<Dashboard />} /> 
          <Route path="/users" element={<UserManagement />} />
          <Route path="/packages" element={<PackageManagement />} />
          <Route path="/lotes" element={<LoteManagement />} />
          <Route path="/tasks" element={<TaskTracking />} />
          <Route path="/productos" element={<ProductManagement />} />
          <Route path="/productos/todos" element={<ProductCatalog />} />
          <Route path="/compras" element={<InvoiceScan />} />
        </Route>

        {/* 4. Rutas que usan el Layout Sencillo (se mantiene igual) */}
        <Route element={<SimpleLayout />}>\
            <Route path="/task/:taskId" element={<TaskAction />} />
        </Route>
      </Routes>
    </Router>
  );
}

export default App;
