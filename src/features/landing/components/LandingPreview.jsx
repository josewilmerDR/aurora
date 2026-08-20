// Maqueta ilustrativa de la app que acompaña al hero. Es una representación
// simplificada —no una captura— construida con divs para que pese nada y se
// vea nítida en cualquier pantalla. Decorativa: aria-hidden para que el lector
// de pantalla no lea datos de ejemplo como si fueran reales.

const STATS = [
  { label: 'Tareas de hoy', value: '8' },
  { label: 'Bajo mínimo', value: '3' },
  { label: 'Lotes activos', value: '14' },
];

const ROWS = [
  { title: 'Aplicación foliar', meta: 'Lote 12 · 3.4 ha', state: 'hoy' },
  { title: 'Muestreo de plagas', meta: 'Grupo Norte · 2 bloques', state: 'hoy' },
  { title: 'Recepción de fertilizante', meta: 'Bodega central', state: 'ok' },
  { title: 'Registro de horímetro', meta: 'Tractor 03', state: 'ok' },
];

export default function LandingPreview() {
  return (
    <div className="lp-preview" aria-hidden="true">
      <div className="lp-preview-bar">
        <span className="lp-preview-dot" />
        <span className="lp-preview-dot" />
        <span className="lp-preview-dot" />
        <span className="lp-preview-bar-title">aurora · Finca</span>
      </div>

      <div className="lp-preview-body">
        <div className="lp-preview-rail">
          {[0, 1, 2, 3, 4, 5].map(i => (
            <span key={i} className={`lp-preview-rail-item${i === 1 ? ' is-active' : ''}`} />
          ))}
        </div>

        <div className="lp-preview-main">
          <div className="lp-preview-stats">
            {STATS.map(stat => (
              <div className="lp-preview-stat" key={stat.label}>
                <span className="lp-preview-stat-value">{stat.value}</span>
                <span className="lp-preview-stat-label">{stat.label}</span>
              </div>
            ))}
          </div>

          <div className="lp-preview-list">
            {ROWS.map(row => (
              <div className="lp-preview-row" key={row.title}>
                <span className={`lp-preview-tick lp-preview-tick--${row.state}`} />
                <span className="lp-preview-row-text">
                  <span className="lp-preview-row-title">{row.title}</span>
                  <span className="lp-preview-row-meta">{row.meta}</span>
                </span>
                <span className={`lp-preview-chip lp-preview-chip--${row.state}`}>
                  {row.state === 'hoy' ? 'Pendiente' : 'Listo'}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
