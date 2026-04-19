// Serialization for the financial profile. Two formats:
//   - json: pass-through (already plain-JSON-safe)
//   - html: print-optimized single document. Browsers can "Print → Save as PDF"
//          to get a bank-presentable PDF without us pulling in a PDF lib.
//
// PDF via a native renderer is intentionally deferred. HTML-to-PDF via the
// browser covers the Fase 5.1 use case (user exports, attaches to email).

function escape(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtMoney(n, currency = 'USD') {
  if (n === null || n === undefined || n === '') return '—';
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  const parts = v.toFixed(2).split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${currency === 'CRC' ? '₡' : '$'}${parts.join('.')}`;
}

function fmtPercent(ratio) {
  if (!Number.isFinite(ratio)) return '—';
  return `${(ratio * 100).toFixed(1)}%`;
}

function categoryLabel(cat) {
  const labels = {
    combustible: 'Combustible',
    depreciacion: 'Depreciación',
    planilla_directa: 'Planilla directa',
    planilla_fija: 'Planilla fija',
    insumos: 'Insumos',
    mantenimiento: 'Mantenimiento',
    administrativo: 'Administrativo',
    otro: 'Otro',
  };
  return labels[cat] || cat;
}

// ─── HTML sections ────────────────────────────────────────────────────────

function renderHeader(profile, meta = {}) {
  const generatedAt = meta.generatedAt || new Date().toISOString();
  return `
    <header>
      <h1>Estado Financiero</h1>
      <div class="meta">
        <div><strong>Finca:</strong> ${escape(profile.fincaId)}</div>
        <div><strong>Corte:</strong> ${escape(profile.asOf)}</div>
        <div><strong>Generado:</strong> ${escape(generatedAt.slice(0, 19).replace('T', ' '))}</div>
        ${meta.snapshotId ? `<div><strong>Snapshot:</strong> ${escape(meta.snapshotId)}</div>` : ''}
      </div>
    </header>`;
}

function renderBalanceSheet(bs) {
  const { assets, liabilities, equity, notes = [] } = bs;
  const rows = [
    ['Activos', '', true],
    ['  Caja', fmtMoney(assets.cash.amount), false],
    ['  Cuentas por cobrar', fmtMoney(assets.accountsReceivable.amount), false],
    ['  Inventario', fmtMoney(assets.inventory.amount), false],
    ['  Activos fijos (neto)', fmtMoney(assets.fixedAssets.netBookValue), false],
    ['Total activos', fmtMoney(assets.totalAssets), true],
    ['Pasivos', '', true],
    ['  Cuentas por pagar', fmtMoney(liabilities.accountsPayable.amount), false],
    ['  Obligaciones de deuda', fmtMoney(liabilities.debtObligations.amount), false],
    ['Total pasivos', fmtMoney(liabilities.totalLiabilities), true],
    ['Patrimonio', fmtMoney(equity.totalEquity), true],
  ];

  const body = rows.map(([label, value, strong]) => `
      <tr class="${strong ? 'row-strong' : ''}">
        <td>${escape(label)}</td>
        <td class="num">${value}</td>
      </tr>`).join('');

  const notesHtml = notes.length > 0 ? `
    <div class="notes">
      <strong>Notas:</strong>
      <ul>${notes.map(n => `<li>${escape(n)}</li>`).join('')}</ul>
    </div>` : '';

  return `
    <section>
      <h2>Balance General — al ${escape(bs.asOf)}</h2>
      <table class="sheet">
        <tbody>${body}</tbody>
      </table>
      ${notesHtml}
    </section>`;
}

function renderIncomeStatement(is) {
  const rows = Object.entries(is.costs.byCategory)
    .filter(([, v]) => v > 0)
    .map(([cat, v]) => `
        <tr>
          <td>  ${escape(categoryLabel(cat))}</td>
          <td class="num">${fmtMoney(v)}</td>
        </tr>`).join('');

  return `
    <section>
      <h2>Estado de Resultados — ${escape(is.periodStart)} a ${escape(is.periodEnd)}</h2>
      <table class="sheet">
        <tbody>
          <tr class="row-strong">
            <td>Ingresos</td>
            <td class="num">${fmtMoney(is.revenue.amount)}</td>
          </tr>
          <tr class="row-strong">
            <td>Costos</td>
            <td class="num">${fmtMoney(is.costs.totalCosts)}</td>
          </tr>
          ${rows}
          <tr class="row-strong">
            <td>Margen neto</td>
            <td class="num">${fmtMoney(is.netMargin)} (${escape(fmtPercent(is.marginRatio))})</td>
          </tr>
        </tbody>
      </table>
    </section>`;
}

function renderCashFlow(cf) {
  const historyRows = cf.history.series.map(b => `
      <tr>
        <td>${escape(b.month)}</td>
        <td class="num">${fmtMoney(b.inflows)}</td>
        <td class="num">${fmtMoney(b.outflows)}</td>
        <td class="num">${fmtMoney(b.net)}</td>
      </tr>`).join('');

  const projRows = cf.projection.series.map(b => `
      <tr>
        <td>${escape(b.month)}</td>
        <td class="num">${fmtMoney(b.inflows)}</td>
        <td class="num">${fmtMoney(b.outflows)}</td>
        <td class="num">${fmtMoney(b.net)}</td>
        <td class="num">${fmtMoney(b.endingBalance)}</td>
      </tr>`).join('');

  return `
    <section>
      <h2>Flujo de caja — Histórico (12m)</h2>
      <table class="sheet">
        <thead>
          <tr><th>Mes</th><th>Ingresos</th><th>Egresos</th><th>Neto</th></tr>
        </thead>
        <tbody>${historyRows}</tbody>
      </table>
    </section>

    <section>
      <h2>Flujo de caja — Proyección (6m)</h2>
      <p class="muted">Saldo inicial: ${fmtMoney(cf.projection.startingBalance)}</p>
      <table class="sheet">
        <thead>
          <tr><th>Mes</th><th>Ingresos</th><th>Egresos</th><th>Neto</th><th>Saldo final</th></tr>
        </thead>
        <tbody>${projRows}</tbody>
      </table>
      <p class="muted">Saldo mínimo proyectado: ${fmtMoney(cf.projection.summary.minBalance)}</p>
    </section>`;
}

function renderFooter(profile) {
  return `
    <footer>
      <div class="muted small">
        Hash de inputs: ${escape(profile.inputsHash || '')}
      </div>
    </footer>`;
}

function renderStyles() {
  return `
    <style>
      @page { size: letter; margin: 1.5cm; }
      body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #111; font-size: 11pt; line-height: 1.4; max-width: 820px; margin: 0 auto; padding: 24px; }
      header { border-bottom: 2px solid #111; padding-bottom: 12px; margin-bottom: 20px; }
      header h1 { margin: 0 0 8px 0; font-size: 22pt; }
      header .meta { display: grid; grid-template-columns: repeat(2, 1fr); gap: 4px 24px; font-size: 10pt; }
      section { page-break-inside: avoid; margin: 24px 0; }
      h2 { font-size: 13pt; border-bottom: 1px solid #ccc; padding-bottom: 4px; margin: 0 0 10px 0; }
      table.sheet { width: 100%; border-collapse: collapse; }
      table.sheet td, table.sheet th { padding: 6px 8px; border-bottom: 1px solid #eee; text-align: left; }
      table.sheet th { background: #f5f5f5; font-weight: 600; font-size: 10pt; }
      table.sheet td.num { text-align: right; font-variant-numeric: tabular-nums; }
      tr.row-strong td { font-weight: 600; background: #fafafa; }
      .muted { color: #666; font-size: 10pt; }
      .small { font-size: 8pt; }
      .notes { margin-top: 12px; font-size: 10pt; background: #fff8e1; padding: 8px 12px; border-left: 3px solid #f5b400; }
      .notes ul { margin: 4px 0 0 0; padding-left: 18px; }
      footer { border-top: 1px solid #eee; margin-top: 32px; padding-top: 12px; }
      @media print { body { max-width: none; padding: 0; } }
    </style>`;
}

function toHtml(profile, meta = {}) {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>Estado Financiero — ${escape(profile.fincaId)} — ${escape(profile.asOf)}</title>
${renderStyles()}
</head>
<body>
${renderHeader(profile, meta)}
${renderBalanceSheet(profile.balanceSheet)}
${renderIncomeStatement(profile.incomeStatement)}
${renderCashFlow(profile.cashFlow)}
${renderFooter(profile)}
</body>
</html>`;
}

function toJson(profile, meta = {}) {
  return JSON.stringify({ ...profile, meta }, null, 2);
}

module.exports = {
  toHtml,
  toJson,
  // exported for tests
  _internals: { escape, fmtMoney, fmtPercent, categoryLabel },
};
