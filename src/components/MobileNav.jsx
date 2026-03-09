import { useState, useEffect, useCallback } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  FiStar, FiGrid, FiSettings, FiLogOut, FiChevronDown, FiChevronRight,
  FiClock, FiSliders, FiX,
} from 'react-icons/fi';
import { useUser, hasMinRole, ROLE_LABELS } from '../contexts/UserContext';
import {
  DASHBOARD_ITEM, MODULES, ALL_ITEMS,
  getPinned, getRecents, savePinned, saveRecents,
} from './Sidebar';
import './MobileNav.css';

export default function MobileNav() {
  const { currentUser, logout } = useUser();
  const location = useLocation();
  const navigate = useNavigate();

  const uid = currentUser?.id || 'guest';
  const userRole = currentUser?.rol || 'trabajador';

  const [sheet, setSheet] = useState(null); // null | 'favoritos' | 'todas' | 'config'
  const [expandedMods, setExpandedMods] = useState(() => new Set());
  const [expandedGroups, setExpandedGroups] = useState(() => new Set());
  const [pinnedRoutes, setPinnedRoutes] = useState(() => getPinned(uid));
  const [recentRoutes, setRecentRoutes] = useState(() => getRecents(uid));

  const canAccess = useCallback((item) => hasMinRole(userRole, item.minRole), [userRole]);
  const itemFor = (path) => ALL_ITEMS.find((i) => i.to === path);

  // Track recents on route change
  useEffect(() => {
    const path = location.pathname;
    if (!ALL_ITEMS.find((i) => i.to === path)) return;
    setRecentRoutes((prev) => {
      const next = [path, ...prev.filter((r) => r !== path)].slice(0, 5);
      saveRecents(uid, next);
      return next;
    });
  }, [location.pathname, uid]);

  // Close sheet on navigation
  useEffect(() => { setSheet(null); }, [location.pathname]);

  const togglePin = (to) =>
    setPinnedRoutes((prev) => {
      const next = prev.includes(to) ? prev.filter((r) => r !== to) : [...prev, to];
      savePinned(uid, next);
      return next;
    });

  const toggleMod = (id) =>
    setExpandedMods((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const toggleGroup = (label) =>
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      next.has(label) ? next.delete(label) : next.add(label);
      return next;
    });

  const handleTabPress = (tab) => setSheet(s => s === tab ? null : tab);

  // ── Nav item ──────────────────────────────────────────────────────────────
  const NavItem = ({ item, showPin = false }) => {
    const Icon = item.icon;
    const pinned = pinnedRoutes.includes(item.to);
    return (
      <div className="mn-item-row">
        <NavLink
          to={item.to}
          end
          className={({ isActive }) => `mn-link${isActive ? ' active' : ''}`}
        >
          <Icon size={19} />
          <span>{item.label}</span>
        </NavLink>
        {showPin && (
          <button
            className={`mn-pin-btn${pinned ? ' pinned' : ''}`}
            onClick={(e) => { e.stopPropagation(); togglePin(item.to); }}
            title={pinned ? 'Quitar de favoritos' : 'Fijar'}
          >
            <FiStar size={14} />
          </button>
        )}
      </div>
    );
  };

  // ── Sub-group (e.g. Siembra, Aplicaciones) ────────────────────────────────
  const GroupItem = ({ item }) => {
    const visibleChildren = item.children.filter(canAccess);
    if (!visibleChildren.length) return null;
    const expanded = expandedGroups.has(item.label);
    const Icon = item.icon;
    return (
      <div className="mn-subgroup">
        <button className="mn-subgroup-header" onClick={() => toggleGroup(item.label)}>
          <Icon size={17} />
          <span>{item.label}</span>
          {expanded ? <FiChevronDown size={12} /> : <FiChevronRight size={12} />}
        </button>
        {expanded && (
          <div className="mn-subgroup-items">
            {visibleChildren.map((c) => <NavItem key={c.to} item={c} showPin />)}
          </div>
        )}
      </div>
    );
  };

  // ── Sheet: Favoritos ──────────────────────────────────────────────────────
  const FavoritosSheet = () => {
    const pinned = pinnedRoutes.map(itemFor).filter(Boolean).filter(canAccess);
    const recents = recentRoutes.map(itemFor).filter(Boolean).filter(canAccess)
      .filter((i) => !pinnedRoutes.includes(i.to));
    return (
      <>
        <div className="mn-sheet-section">
          <div className="mn-sheet-section-title"><FiStar size={13} /> Fijados</div>
          {pinned.length === 0
            ? <p className="mn-sheet-empty">Ve a <button className="mn-inline-link" onClick={() => setSheet('todas')}>Todas</button> y fija las que más usas.</p>
            : pinned.map((item) => <NavItem key={item.to} item={item} />)
          }
        </div>
        <div className="mn-sheet-section">
          <div className="mn-sheet-section-title"><FiClock size={13} /> Recientes</div>
          {recents.length === 0
            ? <p className="mn-sheet-empty">Aquí aparecerán las páginas que visites.</p>
            : recents.map((item) => <NavItem key={item.to} item={item} />)
          }
        </div>
      </>
    );
  };

  // ── Sheet: Todas ──────────────────────────────────────────────────────────
  const TodasSheet = () => (
    <>
      {canAccess(DASHBOARD_ITEM) && (
        <div className="mn-sheet-section">
          <NavItem item={DASHBOARD_ITEM} showPin />
        </div>
      )}
      {MODULES.map((mod) => {
        const visibleItems = mod.items.filter(canAccess);
        if (!visibleItems.length) return null;
        const expanded = expandedMods.has(mod.id);
        const Icon = mod.icon;
        return (
          <div key={mod.id} className="mn-module">
            <button className="mn-module-header" onClick={() => toggleMod(mod.id)}>
              <Icon size={16} />
              <span>{mod.nombre}</span>
              {expanded ? <FiChevronDown size={13} /> : <FiChevronRight size={13} />}
            </button>
            {expanded && (
              <div className="mn-module-items">
                {visibleItems.map((item) =>
                  item.children
                    ? <GroupItem key={item.label} item={item} />
                    : <NavItem key={item.to} item={item} showPin />
                )}
              </div>
            )}
          </div>
        );
      })}
    </>
  );

  // ── Sheet: Config ─────────────────────────────────────────────────────────
  const ConfigSheet = () => (
    <div className="mn-config-sheet">
      <div className="mn-config-user">
        <div className="mn-config-avatar">{(currentUser?.nombre || 'U')[0].toUpperCase()}</div>
        <div>
          <div className="mn-config-name">{currentUser?.nombre || 'Usuario'}</div>
          <div className="mn-config-role">{ROLE_LABELS[currentUser?.rol] || 'Sin rol'}</div>
        </div>
      </div>
      {hasMinRole(userRole, 'administrador') && (
        <button className="mn-config-action" onClick={() => navigate('/config/cuenta')}>
          <FiSliders size={18} /> Configuración de cuenta
        </button>
      )}
      <button className="mn-config-action mn-config-logout" onClick={() => navigate('/logout')}>
        <FiLogOut size={18} /> Cerrar sesión
      </button>
    </div>
  );

  const sheetTitles = { favoritos: 'Favoritos', todas: 'Todas las funciones', config: 'Cuenta' };

  return (
    <>
      {/* Backdrop */}
      {sheet && <div className="mn-backdrop" onClick={() => setSheet(null)} />}

      {/* Bottom sheet */}
      {sheet && (
        <div className="mn-sheet">
          <div className="mn-sheet-handle" />
          <div className="mn-sheet-header">
            <span className="mn-sheet-title">{sheetTitles[sheet]}</span>
            <button className="mn-sheet-close" onClick={() => setSheet(null)}><FiX size={18} /></button>
          </div>
          <div className="mn-sheet-body">
            {sheet === 'favoritos' && <FavoritosSheet />}
            {sheet === 'todas'     && <TodasSheet />}
            {sheet === 'config'    && <ConfigSheet />}
          </div>
        </div>
      )}

      {/* Bottom nav bar */}
      <nav className="mn-bar">
        <button
          className={`mn-tab${sheet === 'favoritos' ? ' active' : ''}`}
          onClick={() => handleTabPress('favoritos')}
        >
          <FiStar size={22} />
          <span>Favoritos</span>
        </button>
        <button
          className={`mn-tab${sheet === 'todas' ? ' active' : ''}`}
          onClick={() => handleTabPress('todas')}
        >
          <FiGrid size={22} />
          <span>Todas</span>
        </button>
        <button
          className={`mn-tab${sheet === 'config' ? ' active' : ''}`}
          onClick={() => handleTabPress('config')}
        >
          <FiSettings size={22} />
          <span>Config</span>
        </button>
      </nav>
    </>
  );
}
