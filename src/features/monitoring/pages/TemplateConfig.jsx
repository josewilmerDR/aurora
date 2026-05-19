import { useState, useEffect, useMemo } from 'react';
import { FiPlus } from 'react-icons/fi';
import Toast from '../../../components/Toast';
import AuroraConfirmModal from '../../../components/AuroraConfirmModal';
import { useApiFetch } from '../../../hooks/useApiFetch';
import TemplateList from '../components/TemplateList';
import TemplateDetail from '../components/TemplateDetail';
import TemplateForm from '../components/TemplateForm';
import {
  sanitizePayload,
  MAX_NOMBRE_PLANTILLA,
  DEFAULT_CAMPOS,
} from '../lib/templateShared';

const COPIA_SUFFIX = ' (copia)';
import '../../applications/styles/packages.css';
import '../styles/monitoring.css';

function TemplateConfig() {
  const apiFetch = useApiFetch();
  const [tipos, setTipos]               = useState([]);
  const [paquetes, setPaquetes]         = useState([]);
  const [selectedTipo, setSelectedTipo] = useState(null);
  const [editingId, setEditingId]       = useState(null);
  const [editData, setEditData]         = useState(null);
  const [showNew, setShowNew]           = useState(false);
  const [newTipo, setNewTipo]           = useState({ nombre: '', campos: [] });
  const [toast, setToast]               = useState(null);
  const [loading, setLoading]           = useState(true);
  const [confirmDelete, setConfirmDelete] = useState(null);
  // confirmDiscard guarda la acción a ejecutar si el usuario confirma
  // que quiere perder los cambios sin guardar.
  const [confirmDiscard, setConfirmDiscard] = useState(null);
  // Campos predeterminados del sistema — fetched al montar la página. Inicia
  // con la lista local como fallback (en caso de error de red o backend
  // viejo) y se reemplaza con la del backend apenas responde.
  const [defaultCampos, setDefaultCampos] = useState(DEFAULT_CAMPOS);

  const showToast = (message, type = 'success') => setToast({ message, type });

  useEffect(() => {
    Promise.all([
      apiFetch('/api/muestreos/tipos').then(r => r.json()),
      apiFetch('/api/muestreos/campos-predeterminados').then(r => r.json()).catch(() => null),
      apiFetch('/api/muestreos/paquetes').then(r => r.json()).catch(() => []),
    ])
      .then(([tiposData, defaultsData, paquetesData]) => {
        if (Array.isArray(tiposData)) setTipos(tiposData);
        if (Array.isArray(defaultsData) && defaultsData.length > 0) {
          setDefaultCampos(defaultsData);
        }
        if (Array.isArray(paquetesData)) setPaquetes(paquetesData);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  // Mapa tipoId → cuenta de paquetes que la referencian (distinct pkg per tipo).
  // Un paquete puede listar la misma plantilla en múltiples actividades; se
  // cuenta una sola vez.
  const usageByTipoId = useMemo(() => {
    const buckets = {};
    for (const pkg of paquetes) {
      const seenInPkg = new Set();
      for (const act of (pkg.activities || [])) {
        for (const f of (act.formularios || [])) {
          if (f.tipoId) seenInPkg.add(f.tipoId);
        }
      }
      for (const tipoId of seenInPkg) {
        buckets[tipoId] = (buckets[tipoId] || 0) + 1;
      }
    }
    return buckets;
  }, [paquetes]);

  // ── Dirty checks ──────────────────────────────────────────────────────────
  const isEditDirty = useMemo(() => {
    if (!editingId || !editData || !selectedTipo) return false;
    if ((editData.nombre || '') !== (selectedTipo.nombre || '')) return true;
    const a = editData.campos || [];
    const b = selectedTipo.campos || [];
    if (a.length !== b.length) return true;
    return a.some((c, i) => c.nombre !== b[i].nombre || c.tipo !== b[i].tipo);
  }, [editingId, editData, selectedTipo]);

  const isFormDirty = useMemo(() => {
    if (!showNew) return false;
    return (newTipo.nombre || '').trim() !== '' || (newTipo.campos || []).length > 0;
  }, [showNew, newTipo]);

  // Envuelve una acción de cierre/cambio de contexto: si hay datos sin
  // guardar, pide confirmación; si no, ejecuta directo.
  const guardEditExit = (action) => {
    if (isEditDirty) setConfirmDiscard({ action, kind: 'edit' });
    else action();
  };
  const guardFormExit = (action) => {
    if (isFormDirty) setConfirmDiscard({ action, kind: 'form' });
    else action();
  };

  // ── Handlers ──────────────────────────────────────────────────────────────
  const toggleActivo = async (tipo) => {
    try {
      await apiFetch(`/api/muestreos/tipos/${tipo.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activo: !tipo.activo }),
      });
      const updated = { ...tipo, activo: !tipo.activo };
      setTipos(prev => prev.map(t => t.id === tipo.id ? updated : t));
      setSelectedTipo(prev => prev?.id === tipo.id ? updated : prev);
    } catch {
      showToast('Error al actualizar.', 'error');
    }
  };

  const startEdit = (tipo) => {
    setEditingId(tipo.id);
    setEditData({
      nombre: tipo.nombre,
      campos: tipo.campos ? tipo.campos.map(c => ({ ...c })) : [],
    });
  };

  const cancelEdit = () => { setEditingId(null); setEditData(null); };

  const saveEdit = async () => {
    const clean = sanitizePayload(editData?.nombre, editData?.campos);
    if (!clean.ok) { showToast(clean.message, 'error'); return; }
    try {
      const body = { nombre: clean.nombre, campos: clean.campos };
      await apiFetch(`/api/muestreos/tipos/${editingId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      setTipos(prev => prev.map(t => t.id === editingId ? { ...t, ...body } : t));
      setSelectedTipo(prev => prev?.id === editingId ? { ...prev, ...body } : prev);
      setEditingId(null);
      setEditData(null);
      showToast('Plantilla actualizada.');
    } catch {
      showToast('Error al guardar.', 'error');
    }
  };

  const openNew = () => {
    setNewTipo({ nombre: '', campos: [] });
    setShowNew(true);
  };

  // Duplicar una plantilla existente: abre el form prellenado con los campos
  // y un nombre "<original> (copia)" — truncado para no exceder el max.
  const handleDuplicate = (tipo) => {
    const maxBase = MAX_NOMBRE_PLANTILLA - COPIA_SUFFIX.length;
    const baseName = (tipo.nombre || '').slice(0, maxBase);
    setNewTipo({
      nombre: `${baseName}${COPIA_SUFFIX}`,
      campos: (tipo.campos || []).map(c => ({ ...c })),
    });
    setShowNew(true);
  };

  const closeNew = () => {
    setShowNew(false);
    setNewTipo({ nombre: '', campos: [] });
  };

  const saveNew = async () => {
    const clean = sanitizePayload(newTipo.nombre, newTipo.campos);
    if (!clean.ok) { showToast(clean.message, 'error'); return; }
    try {
      const body = { nombre: clean.nombre, campos: clean.campos };
      const res = await apiFetch('/api/muestreos/tipos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const { id } = await res.json();
      setTipos(prev => [...prev, { id, ...body, activo: true }]);
      closeNew();
      showToast('Plantilla de muestreo creada.');
    } catch {
      showToast('Error al crear.', 'error');
    }
  };

  const doDelete = async (tipo) => {
    try {
      await apiFetch(`/api/muestreos/tipos/${tipo.id}`, { method: 'DELETE' });
      setTipos(prev => prev.filter(t => t.id !== tipo.id));
      if (selectedTipo?.id === tipo.id) { setSelectedTipo(null); setEditData(null); }
      if (editingId === tipo.id) setEditingId(null);
      showToast('Plantilla eliminada.');
    } catch {
      showToast('Error al eliminar.', 'error');
    }
  };

  // Cambiar de tipo seleccionado (o deseleccionar). Si hay edición sucia, confirma.
  const doSelectTipo = (tipo) => {
    if (selectedTipo?.id === tipo.id) {
      setSelectedTipo(null);
      setEditingId(null);
      setEditData(null);
      return;
    }
    setSelectedTipo(tipo);
    setEditingId(null);
    setEditData(null);
  };
  const handleSelectTipo = (tipo) => guardEditExit(() => doSelectTipo(tipo));

  const doBack = () => {
    setSelectedTipo(null);
    setEditingId(null);
    setEditData(null);
  };
  const handleBack = () => guardEditExit(doBack);

  const handleCancelEdit = () => guardEditExit(cancelEdit);
  const handleCloseForm = () => guardFormExit(closeNew);

  return (
    <div className={`lote-page${selectedTipo ? ' lote-page--selected' : ''}`}>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {loading ? (
        <div className="mon-loading" />
      ) : (
        <>
          <div className="lote-page-header lote-page-header--with-action-block">
            <div className="aur-sheet-header-text">
              <h1 className="lote-list-title">Plantillas de muestreo</h1>
              <p className="aur-sheet-subtitle">
                Define los campos que se registrarán al hacer un muestreo. Cada plantilla se adjunta a paquetes para que los lotes usen el mismo formato de registro.
              </p>
            </div>
            <button className="aur-btn-pill" onClick={openNew}>
              <FiPlus size={16} /> Nueva plantilla
            </button>
          </div>

          <div className="lote-management-layout">
            {selectedTipo && (
              <TemplateDetail
                tipo={selectedTipo}
                isEditing={editingId === selectedTipo.id}
                editData={editData}
                onChangeEditData={setEditData}
                onBack={handleBack}
                onStartEdit={() => startEdit(selectedTipo)}
                onCancelEdit={handleCancelEdit}
                onSaveEdit={saveEdit}
                onToggleActivo={() => toggleActivo(selectedTipo)}
                onRequestDelete={() => setConfirmDelete(selectedTipo)}
                onDuplicate={() => handleDuplicate(selectedTipo)}
                defaultCampos={defaultCampos}
                usageCount={usageByTipoId[selectedTipo.id] || 0}
              />
            )}

            <TemplateList
              tipos={tipos}
              selectedTipo={selectedTipo}
              onSelect={handleSelectTipo}
              onCreateNew={openNew}
              onToggleActivo={toggleActivo}
              usageByTipoId={usageByTipoId}
            />
          </div>
        </>
      )}

      {showNew && (
        <TemplateForm
          nuevoTipo={newTipo}
          onChange={setNewTipo}
          onCancel={handleCloseForm}
          onSave={saveNew}
          defaultCampos={defaultCampos}
        />
      )}

      {confirmDelete && (() => {
        const usage = usageByTipoId[confirmDelete.id] || 0;
        return (
          <AuroraConfirmModal
            danger
            title="Eliminar plantilla"
            body={
              usage > 0 ? (
                <>
                  Esta plantilla está adjunta a <strong>{usage} paquete{usage === 1 ? '' : 's'}</strong>.
                  Si la eliminás, esos paquetes seguirán existiendo pero perderán esta plantilla en sus actividades.
                  Los registros de muestreo previos no se borran.
                </>
              ) : (
                <>¿Eliminar la plantilla <strong>"{confirmDelete.nombre}"</strong>? Esta acción no se puede deshacer.</>
              )
            }
            confirmLabel="Eliminar"
            onConfirm={() => { doDelete(confirmDelete); setConfirmDelete(null); }}
            onCancel={() => setConfirmDelete(null)}
          />
        );
      })()}

      {confirmDiscard && (
        <AuroraConfirmModal
          title="¿Descartar cambios sin guardar?"
          body={
            confirmDiscard.kind === 'form'
              ? 'Perderás los datos de la nueva plantilla.'
              : 'Perderás los cambios que hiciste en esta plantilla.'
          }
          confirmLabel="Descartar"
          onConfirm={() => {
            const { action } = confirmDiscard;
            setConfirmDiscard(null);
            action?.();
          }}
          onCancel={() => setConfirmDiscard(null)}
        />
      )}
    </div>
  );
}

export default TemplateConfig;
