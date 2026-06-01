// Mapa único de variantes de recomendación de deuda. Antes vivía duplicado y
// divergente en DebtSimulations.jsx (label "Condicional") y
// DebtSimulationDetail.jsx (label "Tomar (condicional)") — el mismo crédito se
// veía distinto entre la tabla y el detalle. Fuente de verdad acá.
//
//   label      → texto completo (detalle)
//   labelShort → texto compacto para la celda de tabla
//   cls        → clase de badge del design system

export const RECOMMENDATION_VARIANT = {
  tomar:             { label: 'Tomar',               labelShort: 'Tomar',       cls: 'aur-badge--green'  },
  tomar_condicional: { label: 'Tomar (condicional)', labelShort: 'Condicional', cls: 'aur-badge--yellow' },
  no_tomar:          { label: 'No tomar',            labelShort: 'No tomar',    cls: 'aur-badge--gray'   },
};
