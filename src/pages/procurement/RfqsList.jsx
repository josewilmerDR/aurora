import { useCallback, useEffect, useState } from 'react';
import { FiSend, FiCheck, FiTrash2, FiChevronDown, FiChevronRight, FiCpu } from 'react-icons/fi';
import { useApiFetch } from '../../hooks/useApiFetch';
import RfqResponseForm from '../../components/procurement/rfqs/RfqResponseForm';
import './RfqsList.css';

const STATE_LABELS = {
  sent: 'Enviado',
  failed_send: 'Sin envío',
  closed: 'Cerrado',
  cancelled: 'Cancelado',
};

function RfqsList() {
  const apiFetch = useApiFetch();
  const [rfqs, setRfqs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('');
  const [expandedId, setExpandedId] = useState(null);
  const [closeResult, setCloseResult] = useState(null); // { rfqId, winner, ... }

  const load = useCallback(() => {
    setLoading(true);
    const qs = filter ? `?estado=${filter}` : '';
    apiFetch(`/api/rfqs${qs}`)
      .then(r => r.json())
      .then(data => setRfqs(Array.isArray(data) ? data : []))
      .catch(() => setError('No se pudo cargar la lista.'))
      .finally(() => setLoading(false));
  }, [apiFetch, filter]);

  useEffect(() => { load(); }, [load]);

  const closeRfq = async (id, useClaude) => {
    const confirmMsg = useClaude
      ? '¿Cerrar el RFQ usando razonamiento de IA?'
      : '¿Cerrar el RFQ y elegir ganador?';
    if (!window.confirm(confirmMsg)) return;
    try {
      const url = useClaude ? `/api/rfqs/${id}/close?useClaude=1` : `/api/rfqs/${id}/close`;
      const r = await apiFetch(url, { method: 'POST' });
      if (!r.ok) throw new Error(await r.text());
      const data = await r.json();
      setCloseResult({ rfqId: id, ...data });
      load();
    } catch (err) {
      alert('Cerrar falló: ' + (err.message || 'error desconocido'));
    }
  };

  const cancelRfq = async (id) => {
    if (!window.confirm('¿Eliminar el RFQ? No se puede deshacer.')) return;
    try {
      const r = await apiFetch(`/api/rfqs/${id}`, { method: 'DELETE' });
      if (!r.ok) throw new Error(await r.text());
      if (expandedId === id) setExpandedId(null);
      load();
    } catch (err) {
      alert('Eliminar falló: ' + (err.message || 'error desconocido'));
    }
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <h2><FiSend /> RFQs — Cotizaciones a proveedores</h2>
      </div>

      <div className="rfq-toolbar">
        <label>
          Filtrar por estado:
          <select value={filter} onChange={e => setFilter(e.target.value)}>
            <option value="">Todos</option>
            <option value="sent">Enviado</option>
            <option value="closed">Cerrado</option>
            <option value="cancelled">Cancelado</option>
            <option value="failed_send">Sin envío</option>
          </select>
        </label>
        <span className="rfq-count">{rfqs.length} registro(s)</span>
      </div>

      {loading && <div className="empty-state">Cargando…</div>}
      {error && <div className="empty-state">{error}</div>}

      {!loading && !error && (
        rfqs.length === 0 ? (
          <div className="empty-state">
            Sin RFQs. Los RFQs se crean vía <code>POST /api/rfqs</code> (la UI de creación se añade en una iteración posterior).
          </div>
        ) : (
          <div className="rfq-list">
            {rfqs.map(r => (
              <RfqRow
                key={r.id}
                rfq={r}
                expanded={expandedId === r.id}
                onToggle={() => setExpandedId(prev => prev === r.id ? null : r.id)}
                onClose={(useClaude) => closeRfq(r.id, useClaude)}
                onCancel={() => cancelRfq(r.id)}
                onResponseSaved={load}
                closeResult={closeResult?.rfqId === r.id ? closeResult : null}
              />
            ))}
          </div>
        )
      )}
    </div>
  );
}

function RfqRow({ rfq, expanded, onToggle, onClose, onCancel, onResponseSaved, closeResult }) {
  const contacted = Array.isArray(rfq.suppliersContacted) ? rfq.suppliersContacted : [];
  const responses = Array.isArray(rfq.responses) ? rfq.responses : [];
  const isOpen = rfq.estado === 'sent' || rfq.estado === 'failed_send';

  return (
    <div className={`rfq-card rfq-card--${rfq.estado}`}>
      <div className="rfq-card-head" onClick={onToggle}>
        <div>
          <strong>{rfq.nombreComercial || rfq.productoId}</strong>
          <span className="fin-widget-sub"> · {rfq.cantidad} {rfq.unidad}</span>
        </div>
        <div className="rfq-card-meta">
          <span className="rfq-badge">{STATE_LABELS[rfq.estado] || rfq.estado}</span>
          <span className="fin-widget-sub">{responses.length}/{contacted.length} resp.</span>
          <span className="fin-widget-sub">cierre {rfq.deadline}</span>
          {expanded ? <FiChevronDown /> : <FiChevronRight />}
        </div>
      </div>

      {expanded && (
        <div className="rfq-card-body">
          <div className="rfq-section">
            <h4>Contactados</h4>
            <ul className="info-list">
              {contacted.map(c => (
                <li key={c.supplierId}>
                  {c.supplierName} — {c.sent ? 'enviado' : `no enviado (${c.reason || 'sin motivo'})`}
                </li>
              ))}
            </ul>
          </div>

          <div className="rfq-section">
            <h4>Respuestas</h4>
            {responses.length === 0
              ? <div className="empty-state">Sin respuestas aún.</div>
              : (
                <ul className="info-list">
                  {responses.map(r => (
                    <li key={r.supplierId}>
                      <strong>{r.supplierName}</strong>
                      {r.disponible
                        ? ` — ${r.precioUnitario} ${r.moneda || 'USD'}`
                        : ' — no disponible'}
                      {r.leadTimeDays != null && r.disponible && ` · ${r.leadTimeDays}d`}
                      {r.notas && <div className="fin-widget-sub">{r.notas}</div>}
                    </li>
                  ))}
                </ul>
              )}
          </div>

          {closeResult && (
            <div className="rfq-section rfq-close-result">
              <h4>Resultado del cierre</h4>
              {closeResult.winner ? (
                <>
                  <p>
                    Ganador: <strong>{closeResult.winner.supplierName}</strong> ·
                    {' '}{closeResult.winner.precioUnitario} {closeResult.winner.moneda || 'USD'}
                    {closeResult.winner.leadTimeDays != null && ` · ${closeResult.winner.leadTimeDays}d`}
                  </p>
                  {closeResult.decisionSource === 'claude' && (
                    <p className="fin-widget-sub">
                      Decisión con IA{closeResult.overrodeDeterministic ? ' (sobrescribió la determinista)' : ''}
                      {closeResult.rationale ? `: ${closeResult.rationale}` : ''}
                    </p>
                  )}
                </>
              ) : (
                <p>Sin respuestas elegibles.</p>
              )}
            </div>
          )}

          {isOpen && (
            <>
              <div className="rfq-section">
                <h4>Registrar respuesta</h4>
                <RfqResponseForm rfq={rfq} onSaved={onResponseSaved} />
              </div>
              <div className="rfq-card-actions">
                <button
                  className="rfq-primary-btn"
                  onClick={() => onClose(false)}
                  disabled={responses.length === 0}
                >
                  <FiCheck size={12} /> Cerrar (determinista)
                </button>
                <button
                  className="rfq-primary-btn"
                  onClick={() => onClose(true)}
                  disabled={responses.length < 2}
                  title="Requiere al menos 2 respuestas elegibles"
                >
                  <FiCpu size={12} /> Cerrar con IA
                </button>
                <button className="rfq-danger-btn" onClick={onCancel}>
                  <FiTrash2 size={12} /> Eliminar
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default RfqsList;
