import { useState, useEffect, useRef } from 'react';

// Celda de nota con expand/collapse. Clampa a 2 líneas y muestra "ver más"
// sólo si el texto realmente se desborda (mide scrollHeight). Compartida por
// CosechaRegistro y CosechaDespachos — antes Despachos truncaba a 2 líneas sin
// ningún toggle, dejando la nota ilegible salvo por el tooltip. Punto #3 audit.
export default function NotaCell({ text }) {
  const [expanded, setExpanded] = useState(false);
  const [clamped, setClamped]   = useState(false);
  const textRef = useRef(null);

  useEffect(() => {
    const el = textRef.current;
    if (el) setClamped(el.scrollHeight > el.clientHeight + 1);
  }, [text]);

  if (!text) return <span className="harvest-td-empty">—</span>;

  return (
    <span className="harvest-nota">
      <span ref={textRef} className={`harvest-nota-text${expanded ? ' harvest-nota-text--open' : ''}`}>
        {text}
      </span>
      {(clamped || expanded) && (
        <button type="button" className="harvest-nota-toggle" onClick={() => setExpanded(p => !p)}>
          {expanded ? 'ver menos' : 'ver más'}
        </button>
      )}
    </span>
  );
}
