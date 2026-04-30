import { useState, useRef, useEffect, useCallback } from 'react';
import { FiMenu, FiUser, FiSearch, FiArrowLeft, FiCpu } from 'react-icons/fi';
import { useNavigate, NavLink } from 'react-router-dom';
import { useUser, hasMinRole } from '../contexts/UserContext';
import { useReminders } from '../contexts/RemindersContext';
import { useApiFetch } from '../hooks/useApiFetch';
import { ADVANCED_ENABLED } from '../lib/features';
import { MODULES } from './Sidebar';

export default function AppHeader({
  isCollapsed,
  toggleCollapse,
  profileOpen,
  onToggleProfile,
  autopilotOpen,
  onOpenAutopilot,
}) {
  const navigate = useNavigate();
  const apiFetch = useApiFetch();
  const { currentUser } = useUser();
  const { overdueCount } = useReminders();

  const userRole = currentUser?.rol || 'trabajador';
  // v1 public release: Autopilot is hidden behind the advanced-features flag.
  const canSeeAutopilot = ADVANCED_ENABLED && hasMinRole(userRole, 'encargado');

  const [autopilotPendingCount, setAutopilotPendingCount] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchActiveIdx, setSearchActiveIdx] = useState(-1);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const searchInputRef = useRef(null);
  const wrapperRef = useRef(null);

  const refreshAutopilotPending = useCallback(() => {
    if (!canSeeAutopilot) return;
    apiFetch('/api/autopilot/actions')
      .then(r => r.ok ? r.json() : [])
      .then(data => {
        if (Array.isArray(data)) {
          setAutopilotPendingCount(data.filter(a => a.status === 'proposed').length);
        }
      })
      .catch(() => { });
  }, [apiFetch, canSeeAutopilot]);

  useEffect(() => {
    refreshAutopilotPending();
    window.addEventListener('aurora-autopilot-changed', refreshAutopilotPending);
    return () => window.removeEventListener('aurora-autopilot-changed', refreshAutopilotPending);
  }, [refreshAutopilotPending]);

  useEffect(() => {
    if (!searchQuery.trim()) { setSearchResults([]); return; }
    const q = searchQuery.toLowerCase();
    const results = [];
    MODULES.forEach(mod => {
      const modMatches = mod.nombre.toLowerCase().includes(q);
      mod.items.forEach(item => {
        if (item.children) {
          const groupMatches = item.label.toLowerCase().includes(q);
          item.children.forEach(child => {
            if (hasMinRole(userRole, child.minRole) && (child.label.toLowerCase().includes(q) || groupMatches || modMatches)) {
              results.push({ label: child.label, to: child.to, tag: `${mod.nombre} > ${item.label}` });
            }
          });
        } else {
          if (hasMinRole(userRole, item.minRole) && (item.label.toLowerCase().includes(q) || modMatches)) {
            results.push({ label: item.label, to: item.to, tag: mod.nombre });
          }
        }
      });
    });
    setSearchResults(results.slice(0, 8));
    setSearchActiveIdx(-1);
  }, [searchQuery, userRole]);

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
    setSearchActiveIdx(-1);
  };

  const closeMobileSearch = () => {
    setMobileSearchOpen(false);
    setSearchQuery('');
    setSearchResults([]);
  };

  const openMobileSearch = () => {
    setMobileSearchOpen(true);
    setTimeout(() => searchInputRef.current?.focus(), 50);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      setSearchQuery('');
      setSearchResults([]);
      setSearchActiveIdx(-1);
      setMobileSearchOpen(false);
    } else if (e.key === 'ArrowDown' && searchResults.length > 0) {
      e.preventDefault();
      setSearchActiveIdx(i => Math.min(i + 1, searchResults.length - 1));
    } else if (e.key === 'ArrowUp' && searchResults.length > 0) {
      e.preventDefault();
      setSearchActiveIdx(i => Math.max(i - 1, -1));
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (searchActiveIdx >= 0 && searchResults[searchActiveIdx]) {
      handleSelect(searchResults[searchActiveIdx].to);
    } else if (searchResults.length > 0) {
      handleSelect(searchResults[0].to);
    } else if (searchQuery.trim()) {
      window.dispatchEvent(new CustomEvent('aurora:open', { detail: { query: searchQuery } }));
      setSearchQuery('');
      setSearchResults([]);
    }
  };

  return (
    <header className={`app-header${mobileSearchOpen ? ' mobile-search-open' : ''}`}>
      <button
        className="aur-icon-btn aur-header-menu-btn"
        onClick={toggleCollapse}
        title={isCollapsed ? 'Expandir menú' : 'Colapsar menú'}
      >
        <FiMenu size={20} />
      </button>
      <NavLink to="/" className="aur-header-brand">
        <img src="/aurora-logo.png" alt="Aurora" className="aur-header-brand-logo" />
        <span className="aur-header-brand-name">Aurora</span>
      </NavLink>

      {/* Desktop search + expanded mobile search */}
      <div className="aur-header-search" ref={wrapperRef}>
        <button
          className="aur-icon-btn aur-header-search-back"
          onClick={closeMobileSearch}
          title="Cerrar búsqueda"
        >
          <FiArrowLeft size={18} />
        </button>
        <form className="aur-combo-input-wrap aur-header-search-wrap" onSubmit={handleSubmit}>
          <FiSearch size={15} />
          <input
            ref={searchInputRef}
            className="aur-combo-input"
            type="text"
            placeholder="Buscar funciones o preguntar a Aurora..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
        </form>
        {searchResults.length > 0 && (
          <div className="aur-combo-dropdown aur-header-search-dropdown">
            {searchResults.map((item, idx) => (
              <button
                key={item.to}
                className={`aur-combo-option aur-header-search-option${idx === searchActiveIdx ? ' aur-combo-option--active' : ''}`}
                onMouseDown={() => handleSelect(item.to)}
                onMouseEnter={() => setSearchActiveIdx(idx)}
              >
                <span className="aur-combo-name">{item.label}</span>
                {item.tag && <span className="aur-badge aur-badge--gray">{item.tag}</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Mobile search toggle (visible only on mobile when search is closed) */}
      <button
        className="aur-icon-btn aur-header-search-toggle"
        onClick={openMobileSearch}
        title="Buscar"
      >
        <FiSearch size={19} />
      </button>

      {canSeeAutopilot && (
        <button
          className={`aur-icon-btn aur-icon-btn--success aur-header-autopilot-btn${autopilotOpen ? ' is-active' : ''}`}
          onClick={onOpenAutopilot}
          title="Aurora Copilot"
        >
          <FiCpu size={17} />
          {autopilotPendingCount > 0 && (
            <span className="aur-badge aur-badge--yellow aur-header-counter">
              {autopilotPendingCount > 99 ? '99+' : autopilotPendingCount}
            </span>
          )}
        </button>
      )}

      <button
        className={`aur-header-profile-btn${profileOpen ? ' is-active' : ''}`}
        onClick={onToggleProfile}
        title={overdueCount > 0 ? `Mi perfil — ${overdueCount} recordatorio(s) vencido(s)` : 'Mi perfil'}
      >
        <FiUser size={17} />
        <span className="aur-header-profile-name">{currentUser?.nombre?.split(' ')[0] || 'Perfil'}</span>
        {overdueCount > 0 && (
          <span
            className="aur-badge aur-badge--magenta aur-header-counter"
            aria-label={`${overdueCount} recordatorios vencidos`}
          >
            {overdueCount > 9 ? '9+' : overdueCount}
          </span>
        )}
      </button>
    </header>
  );
}
