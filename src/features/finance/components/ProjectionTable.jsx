// Tabla semanal con apertura, entradas, salidas, neto y cierre.
// Cada fila con movimientos es expandible y revela el detalle de los eventos
// (label/fuente + monto) que componen las entradas y salidas de esa semana.

import { useState } from 'react';
import { FiChevronRight } from 'react-icons/fi';
import { formatMoney, DEFAULT_CURRENCY } from '../../../lib/formatMoney';

// Etiqueta legible de un evento: preferimos el label de negocio (ej. "OC-00042"),
// caemos a la fuente (ej. "ordenes_compra") y por último al tipo.
const SOURCE_LABELS = {
  ordenes_compra: 'Orden de compra',
  income: 'Ingreso esperado',
  ingresos: 'Ingreso esperado',
  payroll: 'Planilla',
  nomina: 'Planilla',
};

function eventLabel(ev) {
  if (ev.label) return ev.label;
  if (ev.source) return SOURCE_LABELS[ev.source] || ev.source;
  return ev.type === 'inflow' ? 'Entrada' : 'Salida';
}

function ProjectionTable({ series, currency = DEFAULT_CURRENCY }) {
  const [expanded, setExpanded] = useState(null);
  if (!series?.length) return null;

  const toggle = (key) => setExpanded(prev => (prev === key ? null : key));

  return (
    <table className="aur-table treasury-table">
      <thead>
        <tr>
          <th>Semana</th>
          <th className="aur-td-num treasury-col-secondary">Apertura</th>
          <th className="aur-td-num">Entradas</th>
          <th className="aur-td-num">Salidas</th>
          <th className="aur-td-num treasury-col-secondary">Neto</th>
          <th className="aur-td-num">Cierre</th>
        </tr>
      </thead>
      <tbody>
        {series.map((w) => {
          const inflowsSum = w.inflows.reduce((s, e) => s + e.amount, 0);
          const outflowsSum = w.outflows.reduce((s, e) => s + e.amount, 0);
          const neg = w.closingBalance < 0;
          const movements = w.inflows.length + w.outflows.length;
          const key = w.weekStart;
          const isOpen = expanded === key;
          return [
            <tr key={key} className={neg ? 'treasury-week-row-negative' : ''}>
              <td>
                {movements > 0 ? (
                  <button
                    type="button"
                    className="treasury-week-toggle"
                    onClick={() => toggle(key)}
                    aria-expanded={isOpen}
                    aria-controls={`treasury-week-detail-${key}`}
                    title={isOpen ? 'Ocultar movimientos' : 'Ver movimientos de la semana'}
                  >
                    <FiChevronRight
                      size={13}
                      className={`treasury-week-chevron${isOpen ? ' treasury-week-chevron--open' : ''}`}
                      aria-hidden="true"
                    />
                    {w.weekStart} → {w.weekEnd}
                  </button>
                ) : (
                  <span className="treasury-week-static">{w.weekStart} → {w.weekEnd}</span>
                )}
              </td>
              <td className="aur-td-num treasury-col-secondary">{formatMoney(w.openingBalance, currency)}</td>
              <td className="aur-td-num">{inflowsSum > 0 ? formatMoney(inflowsSum, currency) : '—'}</td>
              <td className="aur-td-num">{outflowsSum > 0 ? formatMoney(outflowsSum, currency) : '—'}</td>
              <td className="aur-td-num treasury-col-secondary">{formatMoney(w.netFlow, currency)}</td>
              <td className="aur-td-num">{formatMoney(w.closingBalance, currency)}</td>
            </tr>,
            isOpen && (
              <tr key={`${key}-detail`} className="treasury-week-detail-row">
                <td colSpan={6} id={`treasury-week-detail-${key}`}>
                  <ul className="treasury-week-detail">
                    {w.inflows.map((ev, j) => (
                      <li key={`in-${j}`} className="treasury-week-detail-item">
                        <span className="treasury-week-detail-dot treasury-week-detail-dot--in" aria-hidden="true" />
                        <span className="treasury-week-detail-label">{eventLabel(ev)}</span>
                        {ev.date && <span className="treasury-week-detail-date">{ev.date}</span>}
                        <span className="treasury-week-detail-amount treasury-week-detail-amount--in">
                          +{formatMoney(ev.amount, currency)}
                        </span>
                      </li>
                    ))}
                    {w.outflows.map((ev, j) => (
                      <li key={`out-${j}`} className="treasury-week-detail-item">
                        <span className="treasury-week-detail-dot treasury-week-detail-dot--out" aria-hidden="true" />
                        <span className="treasury-week-detail-label">{eventLabel(ev)}</span>
                        {ev.date && <span className="treasury-week-detail-date">{ev.date}</span>}
                        <span className="treasury-week-detail-amount treasury-week-detail-amount--out">
                          −{formatMoney(ev.amount, currency)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </td>
              </tr>
            ),
          ];
        })}
      </tbody>
    </table>
  );
}

export default ProjectionTable;
