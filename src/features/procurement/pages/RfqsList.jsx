import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FiSend, FiCheck, FiTrash2, FiChevronDown, FiChevronRight, FiCpu,
  FiPlus, FiFileText, FiAward,
} from 'react-icons/fi';
import { useApiFetch } from '../../../hooks/useApiFetch';
import AuroraConfirmModal from '../../../components/AuroraConfirmModal';
import RfqResponseForm from '../components/rfqs/RfqResponseForm';
import RfqCreateForm from '../components/rfqs/RfqCreateForm';
import '../styles/rfqs-list.css';

const STATE_LABELS = {
  sent: 'Enviado',
  failed_send: 'Sin envío',
  closed: 'Cerrado',
  cancelled: 'Cancelado',
};

// Estado del RFQ → variante de aur-badge (verde activo, gris cerrado, etc.).
const STATE_BADGE_VARIANT = {
  sent:        'aur-badge--green',
  failed_send: 'aur-badge--yellow',
  closed:      'aur-badge--gray',
  cancelled:   'aur-badge--gray',
};

function RfqsList() {
  const apiFetch = useApiFetch();
  const navigate = useNavigate();
  const [rfqs, setRfqs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('');
  const [expandedId, setExpandedId] = useState(null);
  const [closeResult, setCloseResult] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [confirmClose, setConfirmClose] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);

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

  const doCloseRfq = async (id, useClaude) => {
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

  const doCancelRfq = async (id) => {
    try {
      const r = await apiFetch(`/api/rfqs/${id}`, { method: 'DELETE' });
      if (!r.ok) throw new Error(await r.text());
      if (expandedId === id) setExpandedId(null);
      load();
    } catch (err) {
      alert('Eliminar falló: ' + (err.message || 'error desconocido'));
    }
  };

  const goToCreateOc = (rfqId) => {
    navigate(`/ordenes-compra?fromRfq=${encodeURIComponent(rfqId)}`);
  };

  return (
    <div className="lote-page">
      <div className="lote-page-header">
        <h2 className="lote-page-title"><FiSend /> Cotizaciones a proveedores</h2>
        <button className="aur-btn-pill" onClick={() => setShowCreate(true)}>
          <FiPlus /> Nueva cotización
        </button>
      </div>

      <div className="rfq-toolbar">
        <label className="rfq-toolbar-filter">
          <span>Estado</span>
          <select
            className="aur-select"
            value={filter}
            onChange={e => setFilter(e.target.value)}
          >
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
            Sin cotizaciones. Usa <strong>Nueva cotización</strong> para solicitar precios a tus proveedores.
          </div>
        ) : (
          <div className="rfq-list">
            {rfqs.map(r => (
              <RfqRow
                key={r.id}
                rfq={r}
                expanded={expandedId === r.id}
                onToggle={() => setExpandedId(prev => prev === r.id ? null : r.id)}
                onClose={(useClaude) => setConfirmClose({ id: r.id, useClaude })}
                onCancel={() => setConfirmDelete(r)}
                onResponseSaved={load}
                onCreateOc={() => goToCreateOc(r.id)}
                closeResult={closeResult?.rfqId === r.id ? closeResult : null}
              />
            ))}
          </div>
        )
      )}

      {showCreate && (
        <RfqCreateForm
          onCreated={load}
          onClose={() => setShowCreate(false)}
        />
      )}

      {confirmClose && (
        <AuroraConfirmModal
          title={confirmClose.useClaude ? 'Cerrar con IA' : 'Cerrar cotización'}
          body={confirmClose.useClaude
            ? '¿Cerrar la cotización usando razonamiento de IA para elegir el ganador?'
            : '¿Cerrar la cotización y elegir ganador con criterio determinista?'}
          confirmLabel="Cerrar"
          icon={<FiCheck size={16} />}
          onConfirm={() => { doCloseRfq(confirmClose.id, confirmClose.useClaude); setConfirmClose(null); }}
          onCancel={() => setConfirmClose(null)}
        />
      )}

      {confirmDelete && (
        <AuroraConfirmModal
          danger
          title="Eliminar cotización"
          body={`¿Eliminar la cotización "${confirmDelete.nombreComercial || confirmDelete.productoId}"? No se puede deshacer.`}
          confirmLabel="Eliminar"
          onConfirm={() => { doCancelRfq(confirmDelete.id); setConfirmDelete(null); }}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}

function RfqRow({ rfq, expanded, onToggle, onClose, onCancel, onResponseSaved, onCreateOc, closeResult }) {
  const contacted = Array.isArray(rfq.suppliersContacted) ? rfq.suppliersContacted : [];
  const responses = Array.isArray(rfq.responses) ? rfq.responses : [];
  const isOpen = rfq.estado === 'sent' || rfq.estado === 'failed_send';
  const isClosed = rfq.estado === 'closed';
  const persistentWinner = isClosed ? rfq.winner : null;
  const displayedWinner = closeResult?.winner || persistentWinner;
  const hasOc = !!rfq.ocId;
  const stateVariant = STATE_BADGE_VARIANT[rfq.estado] || 'aur-badge--gray';

  return (
    <div className={`rfq-card rfq-card--${rfq.estado}`}>
      <div className="rfq-card-head" onClick={onToggle}>
        <div className="rfq-card-title">
          <strong>{rfq.nombreComercial || rfq.productoId}</strong>
          <span className="rfq-card-qty"> · {rfq.cantidad} {rfq.unidad}</span>
        </div>
        <div className="rfq-card-meta">
          <span className={`aur-badge ${stateVariant}`}>{STATE_LABELS[rfq.estado] || rfq.estado}</span>
          <span className="rfq-card-meta-text">{responses.length}/{contacted.length} resp.</span>
          <span className="rfq-card-meta-text">cierre {rfq.deadline}</span>
          {hasOc && <span className="aur-badge aur-badge--green">{rfq.ocNumber || 'OC'}</span>}
          {expanded ? <FiChevronDown /> : <FiChevronRight />}
        </div>
      </div>

      {expanded && (
        <div className="rfq-card-body">
          <section className="aur-section">
            <header className="aur-section-header">
              <h3 className="aur-section-title">Contactados</h3>
              <span className="aur-section-count">{contacted.length}</span>
            </header>
            <ul className="info-list">
              {contacted.map(c => (
                <li key={c.supplierId}>
                  {c.supplierName} — {c.sent ? 'enviado' : `no enviado (${c.reason || 'sin motivo'})`}
                </li>
              ))}
            </ul>
          </section>

          <section className="aur-section">
            <header className="aur-section-header">
              <h3 className="aur-section-title">Respuestas</h3>
              <span className="aur-section-count">{responses.length}</span>
            </header>
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
                      {r.notas && <div className="rfq-response-note">{r.notas}</div>}
                    </li>
                  ))}
                </ul>
              )}
          </section>

          {isClosed && (
            <section className="aur-section rfq-close-result">
              <header className="aur-section-header">
                <span className="aur-section-num"><FiAward size={14} /></span>
                <h3 className="aur-section-title">Ganador</h3>
              </header>
              {displayedWinner ? (
                <>
                  <p className="rfq-winner-summary">
                    <strong>{displayedWinner.supplierName}</strong> ·{' '}
                    {displayedWinner.precioUnitario} {displayedWinner.moneda || rfq.currency || 'USD'}
                    {displayedWinner.leadTimeDays != null && ` · ${displayedWinner.leadTimeDays}d`}
                  </p>
                  {closeResult?.decisionSource === 'claude' && (
                    <p className="rfq-winner-rationale">
                      Decisión con IA{closeResult.overrodeDeterministic ? ' (sobrescribió la determinista)' : ''}
                      {closeResult.rationale ? `: ${closeResult.rationale}` : ''}
                    </p>
                  )}
                  <div className="rfq-card-actions">
                    {hasOc ? (
                      <span className="rfq-oc-link">
                        <FiFileText size={12} /> OC ya creada: <strong>{rfq.ocNumber}</strong>
                      </span>
                    ) : (
                      <button className="aur-btn-pill aur-btn-pill--sm" onClick={onCreateOc}>
                        <FiFileText size={12} /> Crear OC desde esta cotización
                      </button>
                    )}
                  </div>
                </>
              ) : (
                <p className="rfq-winner-empty">Sin respuestas elegibles.</p>
              )}
            </section>
          )}

          {isOpen && (
            <>
              <section className="aur-section">
                <header className="aur-section-header">
                  <h3 className="aur-section-title">Registrar respuesta</h3>
                </header>
                <RfqResponseForm rfq={rfq} onSaved={onResponseSaved} />
              </section>
              <div className="rfq-card-actions">
                <button
                  className="aur-btn-pill aur-btn-pill--sm"
                  onClick={() => onClose(false)}
                  disabled={responses.length === 0}
                >
                  <FiCheck size={12} /> Cerrar (determinista)
                </button>
                <button
                  className="aur-btn-pill aur-btn-pill--sm"
                  onClick={() => onClose(true)}
                  disabled={responses.length < 2}
                  title="Requiere al menos 2 respuestas elegibles"
                >
                  <FiCpu size={12} /> Cerrar con IA
                </button>
                <button className="aur-btn-pill aur-btn-pill--sm aur-btn-pill--danger" onClick={onCancel}>
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
