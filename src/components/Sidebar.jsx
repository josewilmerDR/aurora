
import React from 'react';
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
  FiLogOut
} from 'react-icons/fi';

const Sidebar = () => {
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
        </NavLink>
        <NavLink to="/productos" className="sidebar-link" title="Bodega Agroquímicos">
          <FiDroplet size={22} />
          <span className="link-text">Bodega Agroquímicos</span>
        </NavLink>
        <NavLink to="/compras" className="sidebar-link" title="Registrar Compra">
          <FiFileText size={22} />
          <span className="link-text">Registrar Compra</span>
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
