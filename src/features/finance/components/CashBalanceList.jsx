// Lista de saldos de caja registrados, con eliminación. Resuelve el agujero
// de reversibilidad: el backend trata `cash_balance` como serie editable
// (GET list + DELETE) pero la página solo permitía crear. Un saldo mal tipeado
// se podía corregir solo desde Firestore. Acá se ve y se borra.
//
// No hay PUT en el backend: "editar" = borrar el errado y registrar uno nuevo.

import { useState, useEffect, useCallback } from 'react';
import { FiTrash2, FiChevronDown } from 'react-icons/fi';
import AuroraConfirmModal from '../../../components/AuroraConfirmModal';
import { useApiFetch } from '../../../hooks/useApiFetch';
import { useUser, hasMinRole } from '../../../contexts/UserContext';
import { formatMoney } from '../../../lib/formatMoney';

const SOURCE_LABELS = { manual: 'Manual', bank: 'Bancario' };

function CashBalanceList({ refreshKey, onDeleted, onToast }) {
  const apiFetch = useApiFetch();
  const { currentUser } = useUser();
  // Eliminar un saldo es supervisor+ en el backend (borrado irreversible que
  // cambia la proyección de toda la finca). Ocultamos el botón a roles
  // inferiores como defensa secundaria; el backend manda igual.
  const canDelete = hasMinRole(currentUser?.rol || 'trabajador', 'supervisor');
  const [open, setOpen] = useState(false);
  const [balances, setBalances] = useState(null); // null = aún sin cargar
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    apiFetch('/api/treasury/balance')
      .then(r => {
        if (!r.ok) throw new Error('No se pudieron cargar los saldos.');
        return r.json();
      })
      .then(data => setBalances(Array.isArray(data) ? data : []))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [apiFetch]);

  // Carga al montar y cada vez que el padre registra un saldo nuevo.
  useEffect(() => { load(); }, [load, refreshKey]);

  const handleDelete = async () => {
    if (!confirmDelete) return;
    setDeleting(true);
    try {
      const res = await apiFetch(`/api/treasury/balance/${confirmDelete.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('No se pudo eliminar el saldo.');
      onToast?.('Saldo eliminado. La proyección se recalculó.', 'success');
      setConfirmDelete(null);
      load();
      onDeleted?.();
    } catch (e) {
      onToast?.(e.message, 'error');
    } finally {
      setDeleting(false);
    }
  };

  const count = balances?.length ?? 0;
  // El saldo vigente (más reciente) es el que usa la proyección. Lo marcamos.
  const currentId = balances && balances.length > 0 ? balances[0].id : null;

  return (
    <section className="aur-section">
      <button
        type="button"
        className="treasury-balances-toggle"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-controls="treasury-balances-body"
      >
        <FiChevronDown
          size={14}
          className={`treasury-balances-chevron${open ? ' treasury-balances-chevron--open' : ''}`}
          aria-hidden="true"
        />
        <span className="aur-section-title">
          Saldos registrados{balances ? ` (${count})` : ''}
        </span>
      </button>

      {open && (
        <div id="treasury-balances-body" className="treasury-balances-body">
          {loading && <p className="finance-empty">Cargando saldos…</p>}
          {!loading && error && <p className="finance-empty">{error}</p>}
          {!loading && !error && count === 0 && (
            <p className="finance-empty">Todavía no registraste ningún saldo de caja.</p>
          )}
          {!loading && !error && count > 0 && (
            <div className="aur-table-wrap">
              <table className="aur-table">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th className="aur-td-num">Saldo</th>
                    <th>Fuente</th>
                    <th>Nota</th>
                    <th aria-label="Acciones" />
                  </tr>
                </thead>
                <tbody>
                  {balances.map(b => {
                    const isCurrent = b.id === currentId;
                    const usdNote = b.currency && b.currency !== 'CRC'
                      ? ` (${formatMoney(b.amount, b.currency)} × ${b.exchangeRateToCRC})`
                      : '';
                    return (
                      <tr key={b.id}>
                        <td>
                          {b.dateAsOf}
                          {isCurrent && <span className="aur-badge aur-badge--green treasury-balance-current">Vigente</span>}
                        </td>
                        <td className="aur-td-num">
                          {formatMoney(b.amountCRC ?? b.amount, 'CRC')}
                          {usdNote && <span className="treasury-stat-meta">{usdNote}</span>}
                        </td>
                        <td>{SOURCE_LABELS[b.source] || b.source || '—'}</td>
                        <td>{b.note || '—'}</td>
                        <td className="aur-td-num">
                          {canDelete && (
                            <button
                              type="button"
                              className="aur-icon-btn aur-icon-btn--sm aur-icon-btn--danger aur-touch-target"
                              onClick={() => setConfirmDelete(b)}
                              aria-label={`Eliminar saldo del ${b.dateAsOf}`}
                              title="Eliminar saldo"
                            >
                              <FiTrash2 size={15} />
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {confirmDelete && (
        <AuroraConfirmModal
          danger
          title="Eliminar saldo de caja"
          body={
            <>
              Vas a eliminar el saldo de{' '}
              <strong>{formatMoney(confirmDelete.amountCRC ?? confirmDelete.amount, 'CRC')}</strong>{' '}
              registrado al <strong>{confirmDelete.dateAsOf}</strong>.
              {confirmDelete.id === currentId
                ? ' Es el saldo vigente: la proyección pasará a usar el saldo anterior, o partirá de 0 si no hay otro.'
                : ' La proyección se recalculará.'}
              {' '}Esta acción no se puede deshacer.
            </>
          }
          confirmLabel="Eliminar"
          loading={deleting}
          loadingLabel="Eliminando…"
          onConfirm={handleDelete}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </section>
  );
}

export default CashBalanceList;
