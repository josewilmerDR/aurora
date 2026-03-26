import { useState, useEffect } from 'react';
import { FiSearch, FiFileText, FiChevronRight } from 'react-icons/fi';
import { useApiFetch } from '../hooks/useApiFetch';
import './HR.css';
import './HrPlanillaPorUnidad.css';

const fmtMoney = (n) =>
  n == null ? '—' : '₡' + Number(n).toLocaleString('es-CR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtDate = (iso) =>
  iso ? new Date(iso).toLocaleDateString('es-CR') : '—';

function HrHistorialPlanillaHoras() {
  const apiFetch = useApiFetch();
  const [planillas, setPlanillas] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [search, setSearch]       = useState('');
  const [selectedId, setSelectedId] = useState(null);

  useEffect(() => {
    apiFetch('/api/hr/planilla-unidad')
      .then(r => r.json())
      .then(data => {
        setPlanillas(data.filter(p => p.estado === 'pagada'));
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const filtered = planillas.filter(p => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      (p.consecutivo || '').toLowerCase().includes(q) ||
      (p.encargadoNombre || '').toLowerCase().includes(q) ||
      fmtDate(p.fecha).includes(q)
    );
  });

  const selected = planillas.find(p => p.id === selectedId);

  return (
    <div className="ficha-page-layout">

      {/* ── Left: detail of selected planilla ── */}
      <div>
        {!selected ? (
          <div className="form-card">
            <div className="empty-state" style={{ padding: '60px 0' }}>
              <FiFileText size={40} style={{ opacity: 0.2, marginBottom: 16 }} />
              <p style={{ marginTop: 0 }}>Selecciona una planilla de la lista para ver su detalle.</p>
            </div>
          </div>
        ) : (
          <div className="form-card">
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: 20 }}>
              <div>
                <div style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--aurora-light)' }}>
                  Planilla por Unidad / Hora
                </div>
                <div style={{ fontSize: '0.82rem', opacity: 0.55, marginTop: 2 }}>
                  {selected.consecutivo || '—'} &nbsp;·&nbsp; {fmtDate(selected.fecha)} &nbsp;·&nbsp; {selected.encargadoNombre || '—'}
                </div>
              </div>
              <span className="planilla-badge planilla-badge--pagada" style={{ marginLeft: 'auto' }}>Pagada</span>
            </div>

            {/* Segmentos */}
            <h3 style={{ margin: '0 0 10px', fontSize: '0.9rem', opacity: 0.7, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Segmentos de trabajo
            </h3>
            {(selected.segmentos || []).length === 0 ? (
              <p style={{ opacity: 0.45, fontSize: '0.85rem' }}>Sin segmentos registrados.</p>
            ) : (
              <div className="planilla-hist-list" style={{ marginBottom: 24 }}>
                <div className="planilla-hist-header" style={{ gridTemplateColumns: '1fr 1fr 1fr auto auto' }}>
                  <div>Lote</div>
                  <div>Labor</div>
                  <div>Grupo</div>
                  <div style={{ textAlign: 'right' }}>Avance</div>
                  <div style={{ textAlign: 'right' }}>Costo/u</div>
                </div>
                {(selected.segmentos || []).map((seg, i) => (
                  <div key={seg.id || i} className="planilla-hist-row" style={{ gridTemplateColumns: '1fr 1fr 1fr auto auto' }}>
                    <div>{seg.loteNombre || '—'}</div>
                    <div style={{ fontSize: '0.8rem', opacity: 0.75 }}>{seg.labor || '—'}</div>
                    <div style={{ fontSize: '0.8rem', opacity: 0.75 }}>{seg.grupo || '—'}</div>
                    <div style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontSize: '0.82rem' }}>
                      {seg.avanceHa ? `${seg.avanceHa} ${seg.unidad || ''}`.trim() : '—'}
                    </div>
                    <div style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontSize: '0.82rem' }}>
                      {seg.costoUnitario ? fmtMoney(seg.costoUnitario) : '—'}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Trabajadores */}
            <h3 style={{ margin: '0 0 10px', fontSize: '0.9rem', opacity: 0.7, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Detalle de trabajadores
            </h3>
            {(selected.trabajadores || []).length === 0 ? (
              <p style={{ opacity: 0.45, fontSize: '0.85rem' }}>Sin trabajadores registrados.</p>
            ) : (
              <div className="planilla-hist-list">
                <div className="planilla-hist-header" style={{ gridTemplateColumns: '1fr auto' }}>
                  <div>Trabajador</div>
                  <div style={{ textAlign: 'right' }}>Total neto</div>
                </div>
                {(selected.trabajadores || [])
                  .filter(t => t.total > 0 || Object.values(t.cantidades || {}).some(v => v && Number(v) !== 0))
                  .map((t, i) => (
                    <div key={t.trabajadorId || i} className="planilla-hist-row" style={{ gridTemplateColumns: '1fr auto' }}>
                      <div className="planilla-hist-periodo">{t.trabajadorNombre || '—'}</div>
                      <div className="planilla-hist-total">{fmtMoney(t.total)}</div>
                    </div>
                  ))}
                <div className="planilla-hist-row" style={{ gridTemplateColumns: '1fr auto', borderTop: '1px solid var(--aurora-border)', marginTop: 4, paddingTop: 8 }}>
                  <div style={{ fontWeight: 600 }}>Total general</div>
                  <div style={{ fontWeight: 700, color: 'var(--aurora-green)', fontVariantNumeric: 'tabular-nums' }}>
                    {fmtMoney(selected.totalGeneral)}
                  </div>
                </div>
              </div>
            )}

            {selected.observaciones && (
              <div style={{ marginTop: 20, padding: '10px 14px', background: 'rgba(255,255,255,0.03)', borderRadius: 6, fontSize: '0.85rem', opacity: 0.75 }}>
                <strong>Observaciones:</strong> {selected.observaciones}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Right: searchable planilla list ── */}
      <div className="empleados-panel">
        <div className="empleados-panel-header">
          <span>Planillas pagadas</span>
          <span className="empleados-panel-count">{planillas.length}</span>
        </div>

        <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--aurora-border)', position: 'relative' }}>
          <FiSearch size={13} style={{ position: 'absolute', left: 22, top: '50%', transform: 'translateY(-50%)', opacity: 0.4 }} />
          <input
            type="text"
            placeholder="Buscar por encargado, fecha o N°..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              width: '100%',
              background: 'var(--aurora-dark-blue)',
              border: '1px solid var(--aurora-border)',
              borderRadius: 4,
              color: 'var(--aurora-light)',
              padding: '7px 10px 7px 28px',
              fontSize: '0.85rem',
              boxSizing: 'border-box',
            }}
          />
        </div>

        {loading ? (
          <div style={{ padding: '20px 16px', opacity: 0.4, fontSize: '0.85rem', textAlign: 'center' }}>
            Cargando...
          </div>
        ) : (
          <ul className="empleados-list">
            {filtered.map(p => (
              <li
                key={p.id}
                className={`empleados-list-item${selectedId === p.id ? ' empleados-list-item--active' : ''}`}
                onClick={() => setSelectedId(p.id)}
              >
                <div className="empleados-list-avatar" style={{ fontSize: '0.75rem', fontVariantNumeric: 'tabular-nums' }}>
                  {p.consecutivo ? p.consecutivo.replace('PU-', '') : '—'}
                </div>
                <div className="empleados-list-info">
                  <div className="empleados-list-name">{fmtDate(p.fecha)}</div>
                  <div className="empleados-list-sub">
                    {p.encargadoNombre || '—'} &nbsp;·&nbsp; {fmtMoney(p.totalGeneral)}
                  </div>
                </div>
                <FiChevronRight size={14} style={{ opacity: 0.3, flexShrink: 0 }} />
              </li>
            ))}
            {filtered.length === 0 && !loading && (
              <li style={{ padding: '20px 16px', opacity: 0.4, fontSize: '0.85rem', textAlign: 'center' }}>
                Sin resultados
              </li>
            )}
          </ul>
        )}
      </div>

    </div>
  );
}

export default HrHistorialPlanillaHoras;
