// PageHeader — encabezado de página unificado.
//
// Reemplaza las 7+ clases competidoras que renderizaban el mismo layout
// (page-header, lote-page-header, pkg-page-header, usr-page-header,
// ingreso-page-title, fin-dashboard-header, además del propio
// aur-sheet-header que ya vive en aurora.css y es la versión canónica).
//
// Internamente siempre renderiza con las primitivas .aur-sheet-header-*,
// así toda la app converge a la misma tipografía y espaciado sin tocar CSS
// por dominio. La migración consiste en cambiar el JSX de cada página y
// dejar morir las clases ad-hoc cuando ya no se usen.
//
// Layout (definido en aurora.css):
//   ┌─ aur-sheet-header (flex row, gap 16) ─────────────────────────────┐
//   │ ┌─ aur-sheet-header-text (flex:1) ─┐   ┌─ aur-sheet-header-actions
//   │ │ <h1 aur-sheet-title>             │   │ {actions}
//   │ │ <p  aur-sheet-subtitle>          │   │
//   │ └──────────────────────────────────┘   └─────────────────────────
//   └────────────────────────────────────────────────────────────────────┘
//
// Props:
//   - title         string | ReactNode  · contenido del h1/h2
//   - subtitle      string | ReactNode  · opcional, párrafo bajo el título
//   - icon          ReactNode           · opcional, va dentro del h, antes del título
//   - actions       ReactNode           · opcional, botón/botones a la derecha
//   - backLink      { to, label }        · opcional, link "← label" sobre el título
//                                          (breadcrumb a la vista padre)
//   - level         1 | 2               · h1 (default) o h2
//   - className     string              · clases extra en el <header>
//   - titleClassName string             · clases extra en el h
//
// Ejemplos:
//   <PageHeader
//     title="Tesorería"
//     icon={<FiActivity />}
//     actions={<button className="aur-btn-pill">…</button>}
//   />
//
//   <PageHeader
//     title="Paquetes de Aplicaciones"
//     subtitle="Define aquí los conjuntos de aplicaciones…"
//     actions={<button …>Nuevo paquete</button>}
//   />

import { Link } from 'react-router-dom';
import { FiArrowLeft } from 'react-icons/fi';

export default function PageHeader({
  title,
  subtitle,
  icon,
  actions,
  backLink,
  level = 1,
  className = '',
  titleClassName = '',
}) {
  const Heading = level === 2 ? 'h2' : 'h1';
  const headerClass = `aur-sheet-header${className ? ' ' + className : ''}`;
  const titleClass = `aur-sheet-title${titleClassName ? ' ' + titleClassName : ''}`;

  return (
    <header className={headerClass}>
      <div className="aur-sheet-header-text">
        {backLink && (
          <Link to={backLink.to} className="aur-sheet-back-link aur-touch-target">
            <FiArrowLeft size={12} aria-hidden="true" /> {backLink.label}
          </Link>
        )}
        <Heading className={titleClass}>
          {icon}
          {icon && ' '}
          {title}
        </Heading>
        {subtitle && (
          <p className="aur-sheet-subtitle">{subtitle}</p>
        )}
      </div>
      {actions && (
        <div className="aur-sheet-header-actions">{actions}</div>
      )}
    </header>
  );
}
