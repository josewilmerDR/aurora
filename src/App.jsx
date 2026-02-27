import { BrowserRouter as Router, Routes, Route, Link, Outlet } from 'react-router-dom';
import UserManagement from './pages/UserManagement';
import PackageManagement from './pages/PackageManagement';
import LoteManagement from './pages/LoteManagement';
import TaskTracking from './pages/TaskTracking';
import Dashboard from './pages/Dashboard';
import TaskAction from './pages/TaskAction'; // Importar la nueva página
import './index.css';

// --- Layouts ---

// 1. Layout Principal con la barra de navegación
const MainLayout = () => (
  <div className="App">
    <nav>
      <ul>
        <li><Link to="/">Panel de Control</Link></li>
        <li><Link to="/packages">Gestión de Paquetes</Link></li>
        <li><Link to="/users">Gestión de Usuarios</Link></li>
        <li><Link to="/lotes">Gestión de Lotes</Link></li>
        <li><Link to="/tasks">Seguimiento de Tareas</Link></li>
      </ul>
    </nav>
    <main>
      <Outlet /> 
    </main>
  </div>
);

// 2. Layout Sencillo, sin navegación, para páginas de acción directa
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
        {/* 3. Rutas que usan el Layout Principal (con navegación) */}
        <Route element={<MainLayout />}>
          <Route path="/" element={<Dashboard />} /> 
          <Route path="/users" element={<UserManagement />} />
          <Route path="/packages" element={<PackageManagement />} />
          <Route path="/lotes" element={<LoteManagement />} />
          <Route path="/tasks" element={<TaskTracking />} />
        </Route>

        {/* 4. Rutas que usan el Layout Sencillo (sin navegación) */}
        <Route element={<SimpleLayout />}>
            <Route path="/task/:taskId" element={<TaskAction />} />
        </Route>
      </Routes>
    </Router>
  );
}

export default App;
