
import { useState, useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import './Sidebar.css';
import {
  FiGrid,
  FiPackage,
  FiUsers,
  FiArchive,
  FiCheckSquare,
  FiDroplet,
  FiFileText,
  FiShoppingCart,
  FiTruck,
  FiLogOut
} from 'react-icons/fi';

const Sidebar = () => {
  const [stockBajoCount, setStockBajoCount] = useState(0);
  const [tareasVencidasCount, setTareasVencidasCount] = useState(0);

  useEffect(() => {
    fetch('/api/productos')
      .then(res => res.json())
      .then(data => setStockBajoCount(data.filter(p => p.stockActual <= p.stockMinimo).length))
      .catch(() => {});
    fetch('/api/tasks/overdue-count')
      .then(res => res.json())
      .then(data => setTareasVencidasCount(data.count || 0))
      .catch(() => {});
  }, []);

  return (
    <nav className="sidebar">
      <div className="sidebar-header">
        <span className="sidebar-logo-text">AU</span>
      </div>
      <div className="sidebar-links">
        <NavLink to="/" className="sidebar-link" title="Panel de Control">
          <FiGrid size={22} />
          <span className="link-text">Panel de Control</span>
        </NavLink>
        <NavLink to="/packages" className="sidebar-link" title="Gestión de Paquetes">
          <FiPackage size={22} />
          <span className="link-text">Gestión de Paquetes</span>
        </NavLink>
        <NavLink to="/users" className="sidebar-link" title="Gestión de Usuarios">
          <FiUsers size={22} />
          <span className="link-text">Gestión de Usuarios</span>
        </NavLink>
        <NavLink to="/lotes" className="sidebar-link" title="Gestión de Lotes">
          <FiArchive size={22} />
          <span className="link-text">Gestión de Lotes</span>
        </NavLink>
        <NavLink to="/tasks" className="sidebar-link" title="Seguimiento de Tareas">
          <FiCheckSquare size={22} />
          <span className="link-text">Seguimiento de Tareas</span>
          {tareasVencidasCount > 0 && <span className="sidebar-badge">{tareasVencidasCount}</span>}
        </NavLink>
        <NavLink to="/productos" className="sidebar-link" title="Bodega Agroquímicos">
          <FiDroplet size={22} />
          <span className="link-text">Bodega Agroquímicos</span>
          {stockBajoCount > 0 && <span className="sidebar-badge">{stockBajoCount}</span>}
        </NavLink>
        <NavLink to="/compras" className="sidebar-link" title="Registrar Compra">
          <FiFileText size={22} />
          <span className="link-text">Registrar Compra</span>
        </NavLink>
        <NavLink to="/solicitudes" className="sidebar-link" title="Solicitar Compra">
          <FiShoppingCart size={22} />
          <span className="link-text">Solicitar Compra</span>
        </NavLink>
        <NavLink to="/recepcion" className="sidebar-link" title="Recepción de Productos">
          <FiTruck size={22} />
          <span className="link-text">Recepción de Productos</span>
        </NavLink>
      </div>
      <div className="sidebar-footer">
        <NavLink to="/logout" className="sidebar-link" title="Cerrar Sesión">
          <FiLogOut size={22} />
          <span className="link-text">Cerrar Sesión</span>
        </NavLink>
      </div>
    </nav>
  );
};

export default Sidebar;
