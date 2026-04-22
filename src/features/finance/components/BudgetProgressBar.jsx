// Barra de progreso simple — color cambia según % consumido.
function BudgetProgressBar({ percent }) {
  if (percent === null || percent === undefined) {
    return <span className="finance-progress" aria-label="Sin presupuesto asignado" />;
  }
  // Cap visual al 100% para que la barra no se desborde, aunque el número
  // real (label) puede mostrar >100%.
  const width = Math.max(0, Math.min(percent, 100));
  let cls = 'finance-progress-fill';
  if (percent > 100) cls += ' finance-progress-fill--over';
  else if (percent >= 80) cls += ' finance-progress-fill--warn';

  return (
    <span className="finance-progress" title={`${percent.toFixed(1)}%`}>
      <span className={cls} style={{ width: `${width}%` }} />
    </span>
  );
}

export default BudgetProgressBar;
