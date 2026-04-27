// Tabla semanal con apertura, entradas, salidas, neto y cierre.

import { formatMoney, DEFAULT_CURRENCY } from '../../../lib/formatMoney';

function ProjectionTable({ series, currency = DEFAULT_CURRENCY }) {
  if (!series?.length) return null;
  return (
    <table className="aur-table">
      <thead>
        <tr>
          <th>Semana</th>
          <th className="aur-td-num">Apertura</th>
          <th className="aur-td-num">Entradas</th>
          <th className="aur-td-num">Salidas</th>
          <th className="aur-td-num">Neto</th>
          <th className="aur-td-num">Cierre</th>
        </tr>
      </thead>
      <tbody>
        {series.map((w, i) => {
          const inflowsSum = w.inflows.reduce((s, e) => s + e.amount, 0);
          const outflowsSum = w.outflows.reduce((s, e) => s + e.amount, 0);
          const neg = w.closingBalance < 0;
          return (
            <tr key={i} className={neg ? 'treasury-week-row-negative' : ''}>
              <td>{w.weekStart} → {w.weekEnd}</td>
              <td className="aur-td-num">{formatMoney(w.openingBalance, currency)}</td>
              <td className="aur-td-num">{inflowsSum > 0 ? formatMoney(inflowsSum, currency) : '—'}</td>
              <td className="aur-td-num">{outflowsSum > 0 ? formatMoney(outflowsSum, currency) : '—'}</td>
              <td className="aur-td-num">{formatMoney(w.netFlow, currency)}</td>
              <td className="aur-td-num">{formatMoney(w.closingBalance, currency)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export default ProjectionTable;
