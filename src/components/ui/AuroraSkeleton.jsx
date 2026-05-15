import './AuroraSkeleton.css';

/**
 * AuroraSkeleton — placeholder visual para estados de carga.
 *
 * Reemplaza los `<p>Cargando…</p>` ad-hoc que viven en varias páginas y
 * widgets de finance/financing. La idea es que el layout no salte cuando los
 * datos llegan: el skeleton ocupa aproximadamente el mismo espacio que el
 * contenido final.
 *
 * Variantes (prop `variant`):
 *   - `widget`  → bloque tipo dashboard widget (header + valor + 2-3 stats).
 *                 Min-height 220px para empatar con `.aur-section` y
 *                 `.fin-widget`. Usa esta variante en grids 2x2 de finance
 *                 y financing.
 *   - `card`    → bloque genérico (título + 3 líneas). Para listas de tarjetas.
 *   - `row`     → fila tipo tabla (3 celdas con anchos variados). `count`
 *                 controla cuántas filas renderizar.
 *   - `text`    → una sola línea de texto con ancho configurable via `width`.
 *
 * Props:
 *   - variant   string  · 'widget' | 'card' | 'row' | 'text' (default: 'card')
 *   - count     number  · cuántos elementos repetir (default: 1; útil en row/text)
 *   - width     string  · ancho CSS sólo para variant='text' (default: '100%')
 *   - className string  · clase extra opcional para overrides puntuales
 *   - label     string  · aria-label para lectores de pantalla
 *                         (default: 'Cargando contenido…')
 *
 * Acceso: el wrapper marca `role="status"` + `aria-busy="true"` para que los
 * screen readers anuncien el estado de carga.
 *
 * Ejemplo:
 *   {loading
 *     ? <AuroraSkeleton variant="widget" />
 *     : <CashWidget data={data} />
 *   }
 *
 *   <AuroraSkeleton variant="row" count={5} label="Cargando movimientos…" />
 */
export default function AuroraSkeleton({
  variant = 'card',
  count = 1,
  width,
  className = '',
  label = 'Cargando contenido…',
}) {
  const safeCount = Math.max(1, Math.min(50, Number(count) || 1));
  const items = Array.from({ length: safeCount });

  const wrapperClass = `aur-skeleton aur-skeleton--${variant}${className ? ' ' + className : ''}`;

  // Variantes "compuestas" se renderizan una sola vez: ya contienen su layout
  // interno (líneas + bloques). Las variantes "simples" (row/text) repiten
  // según `count`.
  if (variant === 'widget') {
    return (
      <div className={wrapperClass} role="status" aria-busy="true" aria-label={label}>
        <div className="aur-skeleton-line aur-skeleton-line--header" />
        <div className="aur-skeleton-line aur-skeleton-line--value" />
        <div className="aur-skeleton-stats">
          <div className="aur-skeleton-line aur-skeleton-line--stat" />
          <div className="aur-skeleton-line aur-skeleton-line--stat" />
          <div className="aur-skeleton-line aur-skeleton-line--stat" />
        </div>
      </div>
    );
  }

  if (variant === 'card') {
    return (
      <div className={wrapperClass} role="status" aria-busy="true" aria-label={label}>
        <div className="aur-skeleton-line aur-skeleton-line--title" />
        <div className="aur-skeleton-line" />
        <div className="aur-skeleton-line" />
        <div className="aur-skeleton-line aur-skeleton-line--short" />
      </div>
    );
  }

  if (variant === 'row') {
    return (
      <div className={wrapperClass} role="status" aria-busy="true" aria-label={label}>
        {items.map((_, i) => (
          <div key={i} className="aur-skeleton-row">
            <span className="aur-skeleton-cell aur-skeleton-cell--narrow" />
            <span className="aur-skeleton-cell aur-skeleton-cell--wide" />
            <span className="aur-skeleton-cell aur-skeleton-cell--medium" />
          </div>
        ))}
      </div>
    );
  }

  // variant === 'text'
  return (
    <div className={wrapperClass} role="status" aria-busy="true" aria-label={label}>
      {items.map((_, i) => (
        <span
          key={i}
          className="aur-skeleton-line"
          style={width ? { width } : undefined}
        />
      ))}
    </div>
  );
}
