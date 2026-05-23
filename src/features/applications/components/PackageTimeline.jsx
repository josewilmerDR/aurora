/**
 * PackageTimeline — Timeline horizontal de actividades (vista hub, read-only).
 *
 * Extraído de PackageManagement.jsx (Fase C del refactor para acercar el
 * archivo padre al límite de 600 LOC). Componente puro — no usa hooks.
 *
 * Renderiza cada actividad como un punto en una línea proporcional al día en
 * que se ejecuta. Permite ver de un vistazo:
 *   - distribución temporal del programa (gaps, aglomeraciones)
 *   - cuáles son aplicaciones (verde) vs notificaciones (gris)
 *   - el día exacto on hover (tooltip)
 *
 * Decisiones:
 *   - Eventos puntuales, no rangos → puntos en eje, no barras Gantt.
 *   - Eje se auto-escala al maxDay del paquete (con piso de 30d para que
 *     paquetes muy cortos no se vean colapsados).
 *   - Actividades en el mismo día se agrupan en un solo marker con badge
 *     contador (caso real: dos aplicaciones distintas el día 0).
 *   - Tooltip nativo del navegador (atributo `title`) — sin lib de tooltips
 *     para mantener el componente liviano.
 *
 * Props:
 *   - activities  array  · cada item con { day, name?, type? }
 */
export default function PackageTimeline({ activities }) {
  if (!activities || activities.length === 0) return null;

  const items = activities.map(a => ({
    day: Number.isFinite(Number(a.day)) ? Number(a.day) : 0,
    name: (a.name || '').trim() || '(sin nombre)',
    type: a.type || 'notificacion',
  }));
  const maxDay = Math.max(...items.map(it => it.day), 30);

  // Agrupar por día para mostrar marker único con badge contador.
  const byDay = new Map();
  items.forEach(it => {
    if (!byDay.has(it.day)) byDay.set(it.day, []);
    byDay.get(it.day).push(it);
  });
  const sortedDays = [...byDay.keys()].sort((a, b) => a - b);

  return (
    <div className="pkg-timeline" role="img" aria-label="Timeline de actividades del paquete">
      <div className="pkg-timeline-track">
        <div className="pkg-timeline-line" />
        {sortedDays.map(day => {
          const acts = byDay.get(day);
          const pct = maxDay > 0 ? (day / maxDay) * 100 : 0;
          const hasAplicacion = acts.some(a => a.type === 'aplicacion');
          const cls = hasAplicacion ? 'pkg-timeline-marker--apl' : 'pkg-timeline-marker--notif';
          const labels = acts.map(a => a.name).join(' · ');
          const title = acts.length === 1
            ? `Día ${day} · ${labels}`
            : `Día ${day} · ${acts.length} actividades: ${labels}`;
          return (
            <div
              key={day}
              className={`pkg-timeline-marker ${cls}`}
              style={{ left: `${pct}%` }}
              title={title}
            >
              <span className="pkg-timeline-marker-dot">
                {acts.length > 1 && (
                  <span className="pkg-timeline-marker-count">{acts.length}</span>
                )}
              </span>
            </div>
          );
        })}
      </div>
      <div className="pkg-timeline-axis">
        <span>Día 0</span>
        <span>Día {maxDay}</span>
      </div>
      <div className="pkg-timeline-legend" aria-hidden="true">
        <span className="pkg-timeline-legend-item">
          <span className="pkg-timeline-legend-dot pkg-timeline-legend-dot--apl" /> Aplicación
        </span>
        <span className="pkg-timeline-legend-item">
          <span className="pkg-timeline-legend-dot pkg-timeline-legend-dot--notif" /> Notificación
        </span>
      </div>
    </div>
  );
}
