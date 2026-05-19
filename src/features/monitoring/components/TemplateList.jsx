import { useMemo, useState } from 'react';
import {
  FiChevronRight, FiClipboard, FiPlus, FiSearch,
  FiToggleLeft, FiToggleRight,
} from 'react-icons/fi';

function TemplateList({ tipos, selectedTipo, onSelect, onCreateNew, onToggleActivo }) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all'); // 'all' | 'active' | 'inactive'

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tipos.filter(t => {
      if (filter === 'active'   && !t.activo) return false;
      if (filter === 'inactive' &&  t.activo) return false;
      if (q && !(t.nombre || '').toLowerCase().includes(q)) return false;
      return true;
    });
  }, [tipos, search, filter]);

  // Empty state — no hay plantillas en absoluto
  if (tipos.length === 0) {
    return (
      <div className="lote-list-panel">
        <div className="grupo-cta">
          <div className="grupo-cta-icon"><FiClipboard size={24} /></div>
          <p className="grupo-cta-title">Aún no has creado ninguna plantilla de muestreo</p>
          <p className="grupo-cta-desc">
            Crea una plantilla para definir qué datos se registrarán al hacer un muestreo.
          </p>
          {onCreateNew && (
            <button type="button" className="aur-btn-pill grupo-cta-btn" onClick={onCreateNew}>
              <FiPlus size={16} /> Crear primera plantilla
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="lote-list-panel">
      <div className="tpl-list-toolbar">
        <div className="tpl-list-search-wrap">
          <FiSearch size={13} className="tpl-list-search-icon" aria-hidden="true" />
          <input
            type="text"
            className="aur-input tpl-list-search"
            placeholder="Buscar plantilla..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            aria-label="Buscar plantilla por nombre"
          />
        </div>
        <div className="tpl-list-filters" role="group" aria-label="Filtrar plantillas">
          {[
            { key: 'all',      label: 'Todas'     },
            { key: 'active',   label: 'Activas'   },
            { key: 'inactive', label: 'Inactivas' },
          ].map(opt => (
            <button
              key={opt.key}
              type="button"
              className={`aur-chip${filter === opt.key ? ' is-active' : ''}`}
              onClick={() => setFilter(opt.key)}
              aria-pressed={filter === opt.key}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="tpl-list-empty-filtered">
          Sin resultados con los filtros aplicados.
        </div>
      ) : (
        <ul className="lote-list">
          {filtered.map(tipo => {
            const camposCount = tipo.campos?.length || 0;
            return (
              <li
                key={tipo.id}
                className={`lote-list-item${selectedTipo?.id === tipo.id ? ' active' : ''}`}
                onClick={() => onSelect(tipo)}
              >
                <div className="lote-list-info">
                  <span className={`lote-list-code${!tipo.activo ? ' tipo-inactivo' : ''}`}>
                    {tipo.nombre}
                  </span>
                  <div className="tpl-list-meta">
                    <span className="tpl-list-fields-count" title="Campos personalizados">
                      {camposCount} {camposCount === 1 ? 'campo' : 'campos'}
                    </span>
                    {!tipo.activo && <span className="tpl-list-inactive-label">Inactiva</span>}
                  </div>
                </div>
                {onToggleActivo && (
                  <button
                    type="button"
                    className="aur-icon-btn aur-icon-btn--sm tpl-list-toggle"
                    onClick={e => { e.stopPropagation(); onToggleActivo(tipo); }}
                    title={tipo.activo ? 'Desactivar plantilla' : 'Activar plantilla'}
                    aria-label={tipo.activo ? 'Desactivar plantilla' : 'Activar plantilla'}
                  >
                    {tipo.activo
                      ? <FiToggleRight size={16} style={{ color: 'var(--aurora-green)' }} />
                      : <FiToggleLeft size={16} />}
                  </button>
                )}
                <FiChevronRight size={14} className="lote-list-arrow" />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default TemplateList;
