import { useState, useMemo } from 'react';
import { FiUsers, FiChevronRight, FiPlus, FiX } from 'react-icons/fi';
import { ROLE_LABELS } from '../../../contexts/UserContext';
import { getInitials } from '../lib/employeeProfileShared';

// Lowercase + sin tildes para que "Jose" encuentre "José".
const norm = (s) => (s || '')
  .toString()
  .toLowerCase()
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '');

const byNombre = (a, b) => a.nombre.localeCompare(b.nombre, 'es');

// Carrusel móvil + lista lateral de empleados. La selección se delega
// al padre vía onSelect; el padre ya decide si toggle (deselect) o
// switch (loadFicha). El carrusel sólo se renderiza cuando hay un
// empleado seleccionado y la vista es 'hub' — eso lo controla el padre
// pasando renderCarousel.

export function EmployeeCarousel({ planillaUsers, selectedId, onSelect, onNew, canCreate = true, carouselRef }) {
  const sorted = useMemo(() => [...planillaUsers].sort(byNombre), [planillaUsers]);
  return (
    <div className="lote-carousel" ref={carouselRef}>
      {sorted.map(u => (
        <button
          key={u.id}
          className={`lote-bubble${selectedId === u.id ? ' lote-bubble--active' : ''}`}
          onClick={() => onSelect(u)}
        >
          <span className="lote-bubble-avatar">{getInitials(u.nombre)}</span>
          <span className="lote-bubble-label">{u.nombre.split(' ')[0]}</span>
        </button>
      ))}
      {canCreate && (
        <button className="lote-bubble lote-bubble--add" onClick={onNew}>
          <span className="lote-bubble-avatar lote-bubble-avatar--add"><FiPlus /></span>
          <span className="lote-bubble-label">Nuevo</span>
        </button>
      )}
    </div>
  );
}

export function EmployeeListPanel({ planillaUsers, exEmployees = [], fichasMap, selectedId, onSelect }) {
  const [query, setQuery] = useState('');
  const [showEx, setShowEx] = useState(false);

  // Filtra y ordena una lista contra el query (nombre, email, tel, cédula,
  // puesto, departamento, rol). Memoizamos por separado activos y ex para no
  // recomputar cuando sólo cambia uno.
  const matchUsers = (list) => {
    const sorted = [...list].sort(byNombre);
    const q = norm(query).trim();
    if (!q) return sorted;
    return sorted.filter(u => {
      const ficha = fichasMap[u.id] || {};
      const haystack = norm([
        u.nombre, u.email, u.telefono,
        ficha.cedula, ficha.puesto, ficha.departamento,
        ROLE_LABELS[u.rol] || '',
      ].filter(Boolean).join(' '));
      return haystack.includes(q);
    });
  };

  const filteredActivos = useMemo(() => matchUsers(planillaUsers), [planillaUsers, fichasMap, query]); // eslint-disable-line react-hooks/exhaustive-deps
  const filteredEx = useMemo(() => (showEx ? matchUsers(exEmployees) : []), [exEmployees, fichasMap, query, showEx]); // eslint-disable-line react-hooks/exhaustive-deps

  if (planillaUsers.length === 0 && exEmployees.length === 0) {
    return (
      <div className="lote-list-panel">
        <div className="empty-state">
          <FiUsers size={36} />
          <p>Aún no has registrado ningún empleado.</p>
        </div>
      </div>
    );
  }

  const renderRow = (u, isEx) => {
    const ficha = fichasMap[u.id] || {};
    const subParts = [
      ficha.cedula && `CI ${ficha.cedula}`,
      ficha.puesto,
      u.email,
      u.telefono,
      ROLE_LABELS[u.rol] || 'Trabajador',
    ].filter(Boolean);
    const selected = selectedId === u.id;
    return (
      <li
        key={u.id}
        className={`lote-list-item${selected ? ' active' : ''}${isEx ? ' lote-list-item--ex' : ''}`}
        role="button"
        tabIndex={0}
        aria-pressed={selected}
        onClick={() => onSelect(u)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(u); }
        }}
      >
        <div className="lote-list-info">
          <span className="lote-list-code">
            {u.nombre}
            {isEx && <span className="lote-list-ex-tag">Ex</span>}
          </span>
          <span className="lote-list-name">{subParts.join(' · ')}</span>
        </div>
        <FiChevronRight size={14} className="lote-list-arrow" />
      </li>
    );
  };

  const totalVisible = filteredActivos.length + filteredEx.length;

  return (
    <div className="lote-list-panel">
      <div className="empleados-search-wrap">
        <input
          type="text"
          className="empleados-search"
          placeholder="Buscar por nombre, cédula, puesto, email…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Buscar empleado"
        />
        {query && (
          <button
            type="button"
            className="empleados-search-clear"
            onClick={() => setQuery('')}
            aria-label="Limpiar búsqueda"
          >
            <FiX size={14} />
          </button>
        )}
      </div>

      {exEmployees.length > 0 && (
        <label className="empleados-exfilter">
          <input
            type="checkbox"
            checked={showEx}
            onChange={(e) => setShowEx(e.target.checked)}
          />
          Mostrar ex-empleados ({exEmployees.length})
        </label>
      )}

      {totalVisible === 0 ? (
        <div className="empty-state">
          <FiUsers size={28} />
          <p>Ningún empleado coincide con “{query}”.</p>
        </div>
      ) : (
        <ul className="lote-list">
          {filteredActivos.map(u => renderRow(u, false))}
          {filteredEx.map(u => renderRow(u, true))}
        </ul>
      )}
    </div>
  );
}
