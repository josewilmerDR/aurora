import { useMemo, useState, useEffect, useRef } from 'react';
import { FiCheck, FiX, FiTrash2, FiChevronLeft, FiChevronRight } from 'react-icons/fi';
import '../styles/leave-calendar.css';

// Vista mensual de permisos. Recibe la lista ya cargada (no fetchea por sí
// solo — comparte data con LeaveRequests). Cada día muestra bandas por
// trabajador, coloreadas por tipo y con estilo según estado. Click en una
// banda abre un popover con acciones aprobar / rechazar / eliminar según
// permisos del usuario.

const TIPO_LABELS = {
  vacaciones:        'Vacaciones',
  enfermedad:        'Enfermedad',
  permiso_con_goce:  'Permiso con goce',
  permiso_sin_goce:  'Permiso sin goce',
  licencia:          'Licencia',
};

// dateStr → 'YYYY-MM-DD' canonical (acepta ISO completo o ya recortado).
const ymd = (s) => (typeof s === 'string' ? s.slice(0, 10) : '');

// Genera 6 semanas (42 celdas) que cubren el mes completo, empezando lunes.
// Las celdas fuera del mes se marcan como `outside` para tenue rendering.
function buildMonthGrid(year, month1based) {
  const first = new Date(year, month1based - 1, 1);
  // 0=Sun..6=Sat → queremos Mon=0
  const startOffset = (first.getDay() + 6) % 7;
  const start = new Date(year, month1based - 1, 1 - startOffset);

  const cells = [];
  const cur = new Date(start);
  for (let i = 0; i < 42; i++) {
    const inMonth = cur.getMonth() === month1based - 1;
    cells.push({
      iso: `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`,
      day: cur.getDate(),
      outside: !inMonth,
      isWeekend: cur.getDay() === 0 || cur.getDay() === 6,
    });
    cur.setDate(cur.getDate() + 1);
  }
  return cells;
}

// Indexa permisos por día (YYYY-MM-DD). Un permiso de varios días aparece
// en cada día de su rango. Los esParcial sólo en su fechaInicio.
function indexPermisosByDay(permisos) {
  const map = new Map();
  const push = (key, p) => {
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(p);
  };
  permisos.forEach(p => {
    if (!p.fechaInicio) return;
    const fi = ymd(p.fechaInicio);
    if (!fi) return;
    if (p.esParcial) {
      push(fi, p);
      return;
    }
    const ff = ymd(p.fechaFin) || fi;
    const cur = new Date(fi + 'T12:00:00');
    const end = new Date(ff + 'T12:00:00');
    while (cur <= end) {
      const key = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`;
      push(key, p);
      cur.setDate(cur.getDate() + 1);
    }
  });
  return map;
}

const WEEKDAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

export default function LeaveCalendar({
  permisos,
  mes,
  anio,
  onMesChange,
  onAnioChange,
  canApprove,
  canDelete,
  pendingId,
  onApprove,
  onReject,
  onDelete,
}) {
  const year = Number(anio);
  const month = Number(mes);
  const grid = useMemo(() => buildMonthGrid(year, month), [year, month]);
  const byDay = useMemo(() => indexPermisosByDay(permisos), [permisos]);

  // Popover state: { permiso, anchorRect } | null
  const [popover, setPopover] = useState(null);
  const popRef = useRef(null);
  useEffect(() => {
    const onDoc = (e) => {
      if (popRef.current && !popRef.current.contains(e.target)) setPopover(null);
    };
    if (popover) document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [popover]);

  const goPrev = () => {
    if (month === 1) {
      onAnioChange(String(year - 1));
      onMesChange('12');
    } else {
      onMesChange(String(month - 1).padStart(2, '0'));
    }
  };
  const goNext = () => {
    if (month === 12) {
      onAnioChange(String(year + 1));
      onMesChange('01');
    } else {
      onMesChange(String(month + 1).padStart(2, '0'));
    }
  };

  const monthLabel = new Date(year, month - 1, 1)
    .toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });

  const openPopover = (e, p) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setPopover({ permiso: p, anchorRect: rect });
  };

  const handleAction = async (fn, id) => {
    setPopover(null);
    await fn(id);
  };

  return (
    <div className="leave-cal">
      <header className="leave-cal-header">
        <button type="button" className="leave-cal-nav" onClick={goPrev} aria-label="Mes anterior">
          <FiChevronLeft size={16} />
        </button>
        <h3 className="leave-cal-title">{monthLabel}</h3>
        <button type="button" className="leave-cal-nav" onClick={goNext} aria-label="Mes siguiente">
          <FiChevronRight size={16} />
        </button>
      </header>

      <div className="leave-cal-weekdays">
        {WEEKDAYS.map(w => <div key={w} className="leave-cal-weekday">{w}</div>)}
      </div>

      <div className="leave-cal-grid">
        {grid.map(cell => {
          const items = byDay.get(cell.iso) || [];
          return (
            <div
              key={cell.iso}
              className={`leave-cal-cell${cell.outside ? ' is-outside' : ''}${cell.isWeekend ? ' is-weekend' : ''}`}
            >
              <div className="leave-cal-day">{cell.day}</div>
              <div className="leave-cal-items">
                {items.map(p => (
                  <button
                    key={`${p.id}-${cell.iso}`}
                    type="button"
                    onClick={(e) => openPopover(e, p)}
                    className={`leave-band leave-band--${p.tipo} leave-band--${p.estado}${p.esParcial ? ' leave-band--parcial' : ''}`}
                    title={`${p.trabajadorNombre} · ${TIPO_LABELS[p.tipo] || p.tipo} · ${p.estado}`}
                  >
                    <span className="leave-band-name">{p.trabajadorNombre || '—'}</span>
                    {p.esParcial && p.horaInicio && (
                      <span className="leave-band-hours">{p.horaInicio}</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Popover acciones ── */}
      {popover && (
        <div
          ref={popRef}
          className="leave-cal-popover"
          style={{
            top: popover.anchorRect.bottom + window.scrollY + 6,
            left: Math.min(
              popover.anchorRect.left + window.scrollX,
              window.innerWidth - 280
            ),
          }}
          role="dialog"
        >
          <div className="leave-cal-popover-head">
            <strong>{popover.permiso.trabajadorNombre || '—'}</strong>
            <span className={`status-badge status-badge--${popover.permiso.estado}`}>
              {popover.permiso.estado}
            </span>
          </div>
          <div className="leave-cal-popover-body">
            <div>{TIPO_LABELS[popover.permiso.tipo] || popover.permiso.tipo}</div>
            {popover.permiso.esParcial ? (
              <div>
                {ymd(popover.permiso.fechaInicio)} · {popover.permiso.horaInicio}–{popover.permiso.horaFin}
              </div>
            ) : (
              <div>
                {ymd(popover.permiso.fechaInicio)} → {ymd(popover.permiso.fechaFin)}
                {popover.permiso.dias ? ` (${popover.permiso.dias} ${popover.permiso.dias === 1 ? 'día' : 'días'})` : ''}
              </div>
            )}
            <div className={popover.permiso.conGoce !== false ? 'leave-cal-pop-goce' : 'leave-cal-pop-singoce'}>
              {popover.permiso.conGoce !== false ? 'Con goce de salario' : 'Sin goce de salario'}
            </div>
            {popover.permiso.motivo && (
              <div className="leave-cal-pop-motivo">{popover.permiso.motivo}</div>
            )}
          </div>
          <div className="leave-cal-popover-actions">
            {canApprove && popover.permiso.estado === 'pendiente' && (
              <>
                <button
                  type="button"
                  className="aur-icon-btn aur-icon-btn--success"
                  disabled={pendingId === popover.permiso.id}
                  onClick={() => handleAction(onApprove, popover.permiso.id)}
                  title="Aprobar"
                >
                  <FiCheck size={16} />
                </button>
                <button
                  type="button"
                  className="aur-icon-btn aur-icon-btn--danger"
                  disabled={pendingId === popover.permiso.id}
                  onClick={() => handleAction(onReject, popover.permiso.id)}
                  title="Rechazar"
                >
                  <FiX size={16} />
                </button>
              </>
            )}
            {canDelete && (
              <button
                type="button"
                className="aur-icon-btn aur-icon-btn--danger"
                disabled={pendingId === popover.permiso.id}
                onClick={() => handleAction(onDelete, popover.permiso.id)}
                title="Eliminar"
              >
                <FiTrash2 size={16} />
              </button>
            )}
            <button
              type="button"
              className="aur-icon-btn"
              onClick={() => setPopover(null)}
              title="Cerrar"
            >
              Cerrar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
