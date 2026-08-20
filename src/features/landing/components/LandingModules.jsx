import {
  FiLayers, FiPackage, FiDroplet, FiShoppingCart, FiUsers,
  FiTrendingUp, FiDollarSign, FiActivity, FiTool,
} from 'react-icons/fi';
import { LANDING_MODULES } from '../lib/content';

// Igual que EcosystemMenu: el módulo de contenido nombra el icono por clave y
// la resolución a componente vive acá, del lado de React.
const GLYPH_ICONS = {
  layers: FiLayers,
  package: FiPackage,
  droplet: FiDroplet,
  cart: FiShoppingCart,
  users: FiUsers,
  trending: FiTrendingUp,
  dollar: FiDollarSign,
  activity: FiActivity,
  tool: FiTool,
};

export default function LandingModules() {
  return (
    <section className="lp-section lp-section--alt" id="modulos" aria-labelledby="lp-modules-title">
      <div className="lp-container">
        <header className="lp-section-head">
          <p className="lp-eyebrow">Módulos</p>
          <h2 className="lp-section-title" id="lp-modules-title">
            Todo lo que administra una finca, conectado
          </h2>
          <p className="lp-section-body">
            Cada módulo alimenta al siguiente: la aplicación descuenta bodega, bodega dispara
            la compra, la compra suma al costo del lote y la cosecha cierra el ciclo.
          </p>
        </header>

        <ul className="lp-grid">
          {LANDING_MODULES.map(mod => {
            const Icon = GLYPH_ICONS[mod.glyph];
            return (
              <li className="lp-card" key={mod.id}>
                <span className="lp-card-icon" aria-hidden="true">
                  {Icon && <Icon size={18} />}
                </span>
                <h3 className="lp-card-title">{mod.name}</h3>
                <p className="lp-card-body">{mod.body}</p>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
