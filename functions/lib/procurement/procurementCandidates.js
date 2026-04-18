// Pure builder: turns stock gaps + supplier intel into action candidates
// ready to route through the autopilot flow.
//
// Decision tree per gap:
//   - Top-ranked supplier has score ≥ minSupplierScore AND a usable price →
//     crear_orden_compra candidate with that supplier.
//   - Otherwise → crear_solicitud_compra candidate (humans pick the supplier).
//
// One candidate per gap. Combining items by supplier into a single OC is an
// optimization deferred until we have real traffic.

const { rankSuppliers } = require('./supplierRanking');

const MS_PER_DAY = 86400000;

const URGENCY_TO_PRIORITY = {
  critical: 'alta',
  high: 'alta',
  medium: 'media',
  low: 'baja',
};

function buildProcurementCandidates({
  gaps = [],
  suppliers = [],
  orders = [],
  receptions = [],
  marketMedians = {},
  now = new Date(),
  opts = {},
} = {}) {
  const cfg = {
    minSupplierScore: 60,
    leadTimeDays: 14,
    currency: 'USD',
    ...opts,
  };

  const candidates = [];
  for (const gap of gaps) {
    if (!gap?.productoId) continue;

    const ranked = rankSuppliers({
      suppliers,
      orders,
      receptions,
      marketMedians,
      opts: { productoId: gap.productoId, currency: cfg.currency },
    });
    const top = ranked[0];

    const canBuildOc = top
      && top.score != null
      && top.score >= cfg.minSupplierScore
      && top.priceForProduct?.avgPrice > 0;

    if (canBuildOc) {
      candidates.push(buildOcCandidate(gap, top, cfg, now));
    } else {
      candidates.push(buildSolicitudCandidate(gap, top, cfg));
    }
  }
  return candidates;
}

function buildOcCandidate(gap, topSupplier, cfg, now) {
  const fecha = toIsoDate(now);
  const fechaEntrega = toIsoDate(new Date(now.getTime() + cfg.leadTimeDays * MS_PER_DAY));
  const price = topSupplier.priceForProduct.avgPrice;
  const lineCost = Number((price * gap.suggestedQty).toFixed(2));

  return {
    type: 'crear_orden_compra',
    titulo: `OC a ${topSupplier.supplierName}: ${gap.nombreComercial}`,
    descripcion: `${gap.reason} Proveedor top con score ${topSupplier.score} y precio ${price} ${cfg.currency}/${gap.unidad}.`,
    prioridad: URGENCY_TO_PRIORITY[gap.urgency] || 'media',
    gap,
    supplier: {
      id: topSupplier.supplierId,
      name: topSupplier.supplierName,
      score: topSupplier.score,
    },
    estimatedAmount: lineCost,
    params: {
      fecha,
      fechaEntrega,
      proveedor: topSupplier.supplierName,
      proveedorId: topSupplier.supplierId,
      elaboradoPor: 'Aurora',
      notas: `${gap.reason}`.slice(0, 1000),
      items: [{
        productoId: gap.productoId,
        nombreComercial: gap.nombreComercial,
        cantidad: gap.suggestedQty,
        unidad: gap.unidad,
        precioUnitario: price,
        iva: 0,
        moneda: cfg.currency,
      }],
    },
  };
}

function buildSolicitudCandidate(gap, topSupplier, cfg) {
  const reason = topSupplier
    ? `Proveedor top (${topSupplier.supplierName}) con score ${topSupplier.score ?? 'n/a'} no cumple el mínimo (${cfg.minSupplierScore}).`
    : 'Sin proveedor con historial para este producto.';

  return {
    type: 'crear_solicitud_compra',
    titulo: `Solicitud: ${gap.nombreComercial}`,
    descripcion: `${gap.reason} ${reason}`,
    prioridad: URGENCY_TO_PRIORITY[gap.urgency] || 'media',
    gap,
    supplier: null,
    estimatedAmount: null,
    params: {
      responsableId: 'proveeduria',
      responsableNombre: 'Proveeduría',
      notas: `${gap.reason} ${reason}`.slice(0, 288),
      items: [{
        productoId: gap.productoId,
        nombreComercial: gap.nombreComercial,
        cantidadSolicitada: gap.suggestedQty,
        unidad: gap.unidad,
        stockActual: gap.stockActual,
        stockMinimo: gap.stockMinimo,
      }],
    },
  };
}

function toIsoDate(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

module.exports = {
  buildProcurementCandidates,
  URGENCY_TO_PRIORITY,
};
