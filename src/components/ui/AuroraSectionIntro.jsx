import { useId, useState } from 'react';
import { FiChevronDown, FiInfo } from 'react-icons/fi';
import './AuroraSectionIntro.css';

/**
 * AuroraSectionIntro — párrafo introductorio para una sección/página, con
 * expander opcional "¿Cómo funciona?".
 *
 * Existe para resolver una observación recurrente del audit UX: varias páginas
 * financieras (Tesorería, Simulaciones de Deuda, Financiamiento) asumen
 * vocabulario técnico que un usuario no-experto no entiende. Este componente
 * estandariza el patrón "frase llana arriba + detalle técnico bajo demanda".
 *
 * Props:
 *   - children      ReactNode · texto principal — frase corta, lenguaje llano
 *                              (ej: "Predicción de cuánto dinero tendrás en
 *                              caja semana por semana"). Obligatorio.
 *   - icon          ReactNode · icono opcional al lado izquierdo
 *                              (default: FiInfo). Pasar `null` para ocultarlo.
 *   - expanderLabel string    · texto del botón expander
 *                              (default: "¿Cómo funciona?")
 *   - expanderContent ReactNode · contenido revelado al expandir — el detalle
 *                                 técnico que antes estaba inline. Si no se
 *                                 pasa, no se renderiza el expander.
 *   - defaultOpen   bool      · si true, arranca expandido (default: false)
 *   - className     string    · clase extra opcional
 *
 * Ejemplo simple:
 *   <AuroraSectionIntro>
 *     Predicción de cuánto dinero tendrás en caja semana por semana, basada
 *     en los movimientos registrados y tu saldo inicial.
 *   </AuroraSectionIntro>
 *
 * Ejemplo con expander:
 *   <AuroraSectionIntro
 *     expanderContent={
 *       <p>
 *         Simulamos 500 escenarios de precio y rendimiento (Monte Carlo) y
 *         comparamos cómo se mueve tu caja con y sin la deuda.
 *       </p>
 *     }
 *   >
 *     Evaluamos si un crédito mejora tu caja bajo incertidumbre.
 *   </AuroraSectionIntro>
 */
export default function AuroraSectionIntro({
  children,
  icon,
  expanderLabel = '¿Cómo funciona?',
  expanderContent,
  defaultOpen = false,
  className = '',
}) {
  const [open, setOpen] = useState(defaultOpen);
  const contentId = useId();

  const showIcon = icon !== null;
  const IconNode = icon ?? <FiInfo size={14} aria-hidden="true" />;
  const hasExpander = Boolean(expanderContent);

  const wrapperClass = `aur-section-intro${className ? ' ' + className : ''}`;

  return (
    <div className={wrapperClass}>
      <p className="aur-section-intro-text">
        {showIcon && <span className="aur-section-intro-icon">{IconNode}</span>}
        <span>{children}</span>
      </p>

      {hasExpander && (
        <>
          <button
            type="button"
            className={`aur-section-intro-toggle${open ? ' is-open' : ''}`}
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls={contentId}
          >
            <span>{expanderLabel}</span>
            <FiChevronDown
              size={12}
              className={`aur-section-intro-chevron${open ? ' is-open' : ''}`}
              aria-hidden="true"
            />
          </button>

          {open && (
            <div id={contentId} className="aur-section-intro-content" role="region">
              {expanderContent}
            </div>
          )}
        </>
      )}
    </div>
  );
}
