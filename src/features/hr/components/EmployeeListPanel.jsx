import { FiUsers, FiChevronRight } from 'react-icons/fi';
import { ROLE_LABELS } from '../../../contexts/UserContext';
import { getInitials } from '../lib/employeeProfileShared';

// Carrusel móvil + lista lateral de empleados. La selección se delega
// al padre vía onSelect; el padre ya decide si toggle (deselect) o
// switch (loadFicha). El carrusel sólo se renderiza cuando hay un
// empleado seleccionado y la vista es 'hub' — eso lo controla el padre
// pasando renderCarousel.

export function EmployeeCarousel({ planillaUsers, selectedId, onSelect, onNew, carouselRef }) {
  return (
    <div className="lote-carousel" ref={carouselRef}>
      {[...planillaUsers]
        .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
        .map(u => (
          <button
            key={u.id}
            className={`lote-bubble${selectedId === u.id ? ' lote-bubble--active' : ''}`}
            onClick={() => onSelect(u)}
          >
            <span className="lote-bubble-avatar">{getInitials(u.nombre)}</span>
            <span className="lote-bubble-label">{u.nombre.split(' ')[0]}</span>
          </button>
        ))}
      <button className="lote-bubble lote-bubble--add" onClick={onNew}>
        <span className="lote-bubble-avatar lote-bubble-avatar--add">+</span>
        <span className="lote-bubble-label">Nuevo</span>
      </button>
    </div>
  );
}

export function EmployeeListPanel({ planillaUsers, fichasMap, selectedId, onSelect }) {
  if (planillaUsers.length === 0) {
    return (
      <div className="lote-list-panel">
        <div className="empty-state">
          <FiUsers size={36} />
          <p>Aún no has registrado ningún empleado.</p>
        </div>
      </div>
    );
  }
  return (
    <div className="lote-list-panel">
      <ul className="lote-list">
        {[...planillaUsers]
          .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
          .map(u => {
            const ficha = fichasMap[u.id] || {};
            const subParts = [
              ficha.cedula && `CI ${ficha.cedula}`,
              ficha.puesto,
              u.email,
              u.telefono,
              ROLE_LABELS[u.rol] || 'Trabajador',
            ].filter(Boolean);
            return (
              <li
                key={u.id}
                className={`lote-list-item${selectedId === u.id ? ' active' : ''}`}
                onClick={() => onSelect(u)}
              >
                <div className="lote-list-info">
                  <span className="lote-list-code">{u.nombre}</span>
                  <span className="lote-list-name">{subParts.join(' · ')}</span>
                </div>
                <FiChevronRight size={14} className="lote-list-arrow" />
              </li>
            );
          })}
      </ul>
    </div>
  );
}
