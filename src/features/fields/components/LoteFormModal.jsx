import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FiPlusCircle, FiEdit, FiAlertTriangle, FiClock } from 'react-icons/fi';
import { useDraft, markDraftActive, clearDraftActive } from '../../../hooks/useDraft';
import AuroraConfirmModal from '../../../components/AuroraConfirmModal';
import { translateApiError } from '../../../lib/errorMessages';
import { formatDateForInput } from '../lib/lotes-helpers';

const DRAFT_KEY = 'lote-nuevo';

const MAX_CODIGO_LEN = 16;
const MAX_NOMBRE_LEN = 32;

const makeInitialForm = () => ({
  codigoLote: '',
  nombreLote: '',
  fechaCreacion: '',
});

const isFormMeaningful = (form) => {
  if (!form) return false;
  if ((form.codigoLote || '').trim()) return true;
  if ((form.nombreLote || '').trim()) return true;
  if ((form.fechaCreacion || '').trim()) return true;
  return false;
};

function LoteFormModal({
  mode,
  loteToEdit,
  apiFetch,
  onSuccess,
  onClose,
}) {
  const isEditing = mode === 'edit';

  // En crear usamos useDraft (localStorage, sobrevive cierre de pestaña).
  // En editar el form arranca desde loteToEdit y nunca persiste — editar
  // es una acción puntual, no algo que el usuario quiera retomar después.
  const [draftForm, setDraftForm, clearFormDraft] = useDraft(DRAFT_KEY, makeInitialForm, { storage: 'local' });
  const [editForm, setEditForm] = useState(() => isEditing && loteToEdit ? {
    codigoLote: loteToEdit.codigoLote || '',
    nombreLote: loteToEdit.nombreLote || '',
    fechaCreacion: formatDateForInput(loteToEdit.fechaCreacion),
  } : makeInitialForm());

  const form = isEditing ? editForm : draftForm;
  const setForm = isEditing ? setEditForm : setDraftForm;

  // Banner "Borrador restaurado": chequeo único al montar contra el LS,
  // antes de que el usuario altere `form` y rompa la heurística.
  const [restoredFromDraft, setRestoredFromDraft] = useState(() => {
    if (isEditing) return false;
    try {
      const raw = localStorage.getItem(`aurora_draft_${DRAFT_KEY}`);
      if (!raw) return false;
      return isFormMeaningful(JSON.parse(raw));
    } catch { return false; }
  });

  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // Guard de reentrada SINCRÓNICO. `submitting` (state) no alcanza: setSubmitting
  // es asíncrono, así que dos clicks muy rápidos en "Crear" entran ambos al
  // handler antes del re-render que deshabilita el botón → dos POST → lotes
  // duplicados. El ref se actualiza al instante y corta el segundo. (El backend
  // también valida unicidad de código como red de seguridad.)
  const submittingRef = useRef(false);
  const [error, setError] = useState('');

  // Sidebar muestra un indicador de "tienes borrador" basado en el flag
  // sessionStorage `aurora_draftActive_lote-nuevo`. useDraft no lo maneja —
  // lo encendemos/apagamos acá según contenido del form.
  useEffect(() => {
    if (isEditing) return;
    if (isFormMeaningful(form)) markDraftActive(DRAFT_KEY);
    else clearDraftActive(DRAFT_KEY);
  }, [form, isEditing]);

  const handleCloseRequest = () => {
    if (!isEditing && isFormMeaningful(form)) {
      setDiscardConfirmOpen(true);
      return;
    }
    if (!isEditing) {
      clearFormDraft();
      clearDraftActive(DRAFT_KEY);
    }
    onClose();
  };

  const handleDiscardDraft = () => {
    clearFormDraft();
    clearDraftActive(DRAFT_KEY);
    setForm(makeInitialForm());
    setRestoredFromDraft(false);
    setDiscardConfirmOpen(false);
    onClose();
  };

  const handleKeepDraft = () => {
    setDiscardConfirmOpen(false);
    onClose();
  };

  const handleSubmit = async (e) => {
    if (e?.preventDefault) e.preventDefault();
    setError('');

    const codigoLote = form.codigoLote.trim();
    const nombreLote = form.nombreLote.trim();
    const fechaCreacion = form.fechaCreacion;

    if (!codigoLote) { setError('El código del lote es requerido.'); return; }
    if (codigoLote.length > MAX_CODIGO_LEN) { setError(`El código es demasiado largo (máx. ${MAX_CODIGO_LEN}).`); return; }
    if (nombreLote.length > MAX_NOMBRE_LEN) { setError(`El nombre es demasiado largo (máx. ${MAX_NOMBRE_LEN}).`); return; }
    if (!fechaCreacion || !/^\d{4}-\d{2}-\d{2}$/.test(fechaCreacion)) { setError('Fecha inválida.'); return; }

    // Reentrada: si ya hay un submit en vuelo, ignorar. Va después de las
    // validaciones para que un early-return de validación no deje el ref pegado.
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    try {
      const url = isEditing ? `/api/lotes/${loteToEdit.id}` : '/api/lotes';
      const method = isEditing ? 'PUT' : 'POST';
      const payload = { codigoLote, nombreLote, fechaCreacion };
      const res = await apiFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        // translateApiError lee el `code` del body (FORBIDDEN, RATE_LIMITED,
        // VALIDATION_FAILED, etc.) y devuelve el mensaje en español. El
        // fallback genérico solo aplica si el backend no envió un code
        // conocido. Antes acá había un string hardcoded que silenciaba la
        // razón real del fallo.
        const body = await res.json().catch(() => null);
        setError(translateApiError(body, isEditing ? 'Error al actualizar el lote.' : 'Error al crear el lote.'));
        return;
      }
      const saved = await res.json();
      if (!isEditing) {
        clearFormDraft();
        clearDraftActive(DRAFT_KEY);
      }
      onSuccess({ id: isEditing ? loteToEdit.id : saved.id, ...saved });
    } catch {
      setError('Error de conexión. Intente nuevamente.');
    } finally {
      setSubmitting(false);
      submittingRef.current = false;
    }
  };

  const codigoWarning = form.codigoLote.length >= MAX_CODIGO_LEN
    ? `Máximo ${MAX_CODIGO_LEN} caracteres alcanzado.`
    : '';
  const nombreWarning = form.nombreLote.length >= MAX_NOMBRE_LEN
    ? `Máximo ${MAX_NOMBRE_LEN} caracteres alcanzado.`
    : '';

  return createPortal(
    <>
      <div className="aur-modal-backdrop" onPointerDown={handleCloseRequest}>
        <div className="aur-modal" onPointerDown={e => e.stopPropagation()}>

          <div className="aur-modal-header">
            <span className="aur-modal-icon">
              {isEditing ? <FiEdit size={16} /> : <FiPlusCircle size={16} />}
            </span>
            <span className="aur-modal-title">
              {isEditing ? 'Editar lote' : 'Crear nuevo lote'}
            </span>
          </div>

          <form className="aur-modal-content" onSubmit={handleSubmit}>

            {restoredFromDraft && (
              <div className="aur-banner aur-banner--info" role="status" aria-live="polite">
                <FiClock size={14} />
                <span>Borrador restaurado · tienes cambios sin guardar.</span>
                <button
                  type="button"
                  className="aur-btn-text"
                  onClick={handleDiscardDraft}
                >
                  Descartar
                </button>
              </div>
            )}

            {error && (
              <div className="aur-banner aur-banner--danger">
                <FiAlertTriangle size={14} />
                <span>{error}</span>
              </div>
            )}

            <div className="aur-list">
              <div className="aur-row">
                <label className="aur-row-label" htmlFor="lfm-codigo">Código del Lote</label>
                <div>
                  <input
                    id="lfm-codigo"
                    className="aur-input"
                    type="text"
                    maxLength={MAX_CODIGO_LEN}
                    placeholder="Ej: L2604"
                    value={form.codigoLote}
                    onChange={e => setForm(prev => ({ ...prev, codigoLote: e.target.value.slice(0, MAX_CODIGO_LEN) }))}
                    autoFocus
                  />
                  {codigoWarning && <span className="aur-field-error">{codigoWarning}</span>}
                </div>
              </div>

              <div className="aur-row">
                <label className="aur-row-label" htmlFor="lfm-nombre">
                  Nombre amigable <span className="aur-field-hint">(opcional)</span>
                </label>
                <div>
                  <input
                    id="lfm-nombre"
                    className="aur-input"
                    type="text"
                    maxLength={MAX_NOMBRE_LEN}
                    placeholder="Ej: 4, Lote de Aurora"
                    value={form.nombreLote}
                    onChange={e => setForm(prev => ({ ...prev, nombreLote: e.target.value.slice(0, MAX_NOMBRE_LEN) }))}
                  />
                  {nombreWarning && <span className="aur-field-error">{nombreWarning}</span>}
                </div>
              </div>

              <div className="aur-row">
                <label className="aur-row-label" htmlFor="lfm-fecha">Fecha de Creación</label>
                <input
                  id="lfm-fecha"
                  className="aur-input"
                  type="date"
                  max={new Date().toISOString().split('T')[0]}
                  value={form.fechaCreacion}
                  onChange={e => setForm(prev => ({ ...prev, fechaCreacion: e.target.value }))}
                />
              </div>
            </div>

            <p className="aur-field-hint" style={{ marginTop: 8 }}>
              El paquete técnico se asigna por grupo de bloques una vez registradas las siembras del lote.
            </p>
          </form>

          <div className="aur-modal-actions">
            <button
              type="button"
              className="aur-btn-text"
              onClick={handleCloseRequest}
              disabled={submitting}
            >
              Cancelar
            </button>
            <button
              type="button"
              className="aur-btn-pill"
              onClick={handleSubmit}
              disabled={submitting}
            >
              {isEditing ? <FiEdit size={14} /> : <FiPlusCircle size={14} />}
              {submitting
                ? (isEditing ? 'Actualizando…' : 'Creando…')
                : (isEditing ? 'Actualizar Lote' : 'Crear Lote')}
            </button>
          </div>
        </div>
      </div>

      {discardConfirmOpen && (
        <AuroraConfirmModal
          danger
          title="¿Descartar cambios?"
          body="Tienes contenido sin guardar en este lote. Si descartas, el borrador se borra. Si lo mantienes, podrás continuarlo la próxima vez que abras el formulario."
          confirmLabel="Descartar"
          cancelLabel="Mantener borrador"
          onConfirm={handleDiscardDraft}
          onCancel={handleKeepDraft}
        />
      )}
    </>,
    document.body
  );
}

export default LoteFormModal;
