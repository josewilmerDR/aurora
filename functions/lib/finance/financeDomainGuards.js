// Guardrails específicos del dominio financiero. Puros — el config se
// pasa como argumento, no se consulta Firestore aquí.
//
// Extiende los guardrails globales del autopilot con dos verificaciones:
//   1. Kill switch del dominio: `dominios.financiera.activo`
//   2. Tope de desviación por reasignación: `maxDesviacionPresupuesto`

// Devuelve true si el dominio financiero está activo (default: true).
function isFinancialDomainActive(autopilotConfig) {
  const d = autopilotConfig?.dominios?.financiera;
  if (!d) return true;                 // no configurado → activo por defecto
  if (d.activo === false) return false;
  return true;
}

// Valida que la reasignación propuesta no exceda el % configurado respecto
// al monto asignado del budget origen. El cap protege contra reasignaciones
// "explosivas" que vacíen una categoría entera en una sola acción autónoma.
//
// Si el cap no está configurado, el cheque es permisivo (retorna ok).
function checkMaxDeviation({ amount, sourceAssigned, maxPct }) {
  if (maxPct == null || !Number.isFinite(Number(maxPct))) {
    return { ok: true };
  }
  const assigned = Number(sourceAssigned) || 0;
  if (assigned <= 0) {
    // Sin asignado en origen, no podemos evaluar el porcentaje — delegamos
    // al validateReallocation (que ya rechazará por "source has only 0").
    return { ok: true };
  }
  const amt = Number(amount) || 0;
  const pct = (amt / assigned) * 100;
  if (pct > Number(maxPct)) {
    return {
      ok: false,
      reason: `Reasignación de ${amt.toFixed(0)} (${pct.toFixed(1)}% del asignado) excede el tope de ${maxPct}%.`,
    };
  }
  return { ok: true };
}

// Valida los permisos de ejecución según el nivel del dominio. Mirror del
// modo global (nivel1/nivel2/nivel3) pero localizado al dominio.
//
//   nivel1 → recomendación, NO ejecuta
//   nivel2 → escalada, espera aprobación
//   nivel3 → ejecuta automáticamente (sujeto a otros guardrails)
//
// Si no se define nivel para el dominio, se cae al mode global.
function resolveDomainLevel(autopilotConfig, globalMode) {
  const domainNivel = autopilotConfig?.dominios?.financiera?.nivel;
  if (typeof domainNivel === 'string' && ['nivel1', 'nivel2', 'nivel3'].includes(domainNivel)) {
    return domainNivel;
  }
  return globalMode || 'off';
}

module.exports = {
  isFinancialDomainActive,
  checkMaxDeviation,
  resolveDomainLevel,
};
