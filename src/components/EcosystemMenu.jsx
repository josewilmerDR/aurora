import { useState, useRef, useEffect, useCallback } from 'react';
import { FiGrid, FiShoppingBag, FiFileText } from 'react-icons/fi';
import { useEscapeClose } from '../hooks/useEscapeClose';
import { ECOSYSTEM_PRODUCTS, CURRENT_APP_ID, getEcosystemHref } from '../lib/ecosystem';
import './EcosystemMenu.css';

// Maps the data-layer glyph keys to actual icon components so the catalog
// module (lib/ecosystem.js) stays framework-free.
const GLYPH_ICONS = {
  'shopping-bag': FiShoppingBag,
  document: FiFileText,
};

const PANEL_ID = 'ecosystem-menu-panel';

// Google-launcher-style waffle button + floating card listing the comunplace
// ecosystem products. Pure static navigation — no requests to sibling apps.
export default function EcosystemMenu() {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef(null);
  const close = useCallback(() => setOpen(false), []);

  // Shared ESC stack (innermost-first): passing null while closed keeps this
  // instance inert, so ESC only reaches us while the panel is open.
  useEscapeClose(open ? close : null);

  // Outside-click close, registered only while open.
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const buttonLabel = open ? 'Cerrar el menú de productos' : 'Abrir el menú de productos';

  return (
    <div className="aur-ecosystem" ref={wrapperRef}>
      <button
        type="button"
        className={`aur-icon-btn aur-ecosystem-btn${open ? ' is-active' : ''}`}
        onClick={() => setOpen(o => !o)}
        title={buttonLabel}
        aria-label={buttonLabel}
        aria-expanded={open}
        aria-haspopup="true"
        aria-controls={PANEL_ID}
      >
        <FiGrid size={17} />
      </button>

      {open && (
        <nav id={PANEL_ID} className="aur-ecosystem-panel" aria-label="Productos de la plataforma">
          <div className="aur-ecosystem-grid">
            {ECOSYSTEM_PRODUCTS.map((product) => {
              const isCurrent = product.id === CURRENT_APP_ID;
              const GlyphIcon = GLYPH_ICONS[product.glyph];
              return (
                <a
                  key={product.id}
                  className="aur-ecosystem-tile"
                  href={getEcosystemHref(product)}
                  aria-current={isCurrent ? 'page' : undefined}
                  onClick={close}
                >
                  {product.logoSrc ? (
                    // alt="" — decorative: the product name sits right below.
                    <img className="aur-ecosystem-tile-art" src={product.logoSrc} alt="" />
                  ) : (
                    <span
                      className={`aur-ecosystem-tile-art aur-ecosystem-tile-art--${product.tone}`}
                      aria-hidden="true"
                    >
                      {GlyphIcon && <GlyphIcon size={20} />}
                    </span>
                  )}
                  <span className="aur-ecosystem-tile-name">{product.name}</span>
                  <span className="aur-ecosystem-tile-hint">{product.hint}</span>
                </a>
              );
            })}
          </div>
        </nav>
      )}
    </div>
  );
}
