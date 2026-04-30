import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import '../styles/packages.css';
import { FiEdit, FiTrash2, FiPlus, FiX, FiEye, FiSearch, FiCopy, FiChevronRight, FiChevronDown, FiArrowLeft } from 'react-icons/fi';
import Toast from '../../../components/Toast';
import AuroraConfirmModal from '../../../components/AuroraConfirmModal';
import { useApiFetch } from '../../../hooks/useApiFetch';

// ── Product search combobox (sobre .aur-combo-*) ─────────────────────────────
function ProdCombobox({ productos, excludeIds, onSelect }) {
  const [text, setText]       = useState('');
  const [open, setOpen]       = useState(false);
  const [hi,   setHi]         = useState(0);
  const [dropPos, setDropPos] = useState({ top: 0, left: 0, width: 0 });
  const wrapRef               = useRef(null);
  const listRef               = useRef(null);

  const filtered = productos
    .filter(p => !excludeIds.includes(p.id))
    .filter(p => !text ||
      p.nombreComercial?.toLowerCase().includes(text.toLowerCase()) ||
      p.ingredienteActivo?.toLowerCase().includes(text.toLowerCase())
    );

  const openDropdown = useCallback(() => {
    if (wrapRef.current) {
      const r = wrapRef.current.getBoundingClientRect();
      setDropPos({ top: r.bottom + window.scrollY + 2, left: r.left + window.scrollX, width: r.width });
    }
    setOpen(true);
    setHi(0);
  }, []);

  const selectOption = (producto) => {
    setText('');
    setOpen(false);
    setHi(0);
    onSelect(producto.id);
  };

  const handleKeyDown = (e) => {
    if (!open) {
      if (e.key === 'ArrowDown') { openDropdown(); e.preventDefault(); }
      return;
    }
    if (e.key === 'ArrowDown') {
      setHi(h => { const n = Math.min(h + 1, filtered.length - 1); listRef.current?.children[n]?.scrollIntoView({ block: 'nearest' }); return n; });
      e.preventDefault();
    } else if (e.key === 'ArrowUp') {
      setHi(h => { const n = Math.max(h - 1, 0); listRef.current?.children[n]?.scrollIntoView({ block: 'nearest' }); return n; });
      e.preventDefault();
    } else if (e.key === 'Enter') {
      if (filtered[hi]) { selectOption(filtered[hi]); e.preventDefault(); }
    } else if (e.key === 'Escape') {
      setOpen(false);
      setText('');
    }
  };

  useEffect(() => {
    const handler = (e) => {
      if (wrapRef.current?.contains(e.target) || listRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div className="aur-combo pkg-prod-combo" ref={wrapRef}>
      <div className="aur-combo-input-wrap">
        <FiSearch size={13} />
        <input
          type="text"
          className="aur-combo-input"
          placeholder="+ Agregar producto..."
          value={text}
          autoComplete="off"
          onChange={e => { setText(e.target.value); openDropdown(); }}
          onFocus={openDropdown}
          onBlur={() => setTimeout(() => {
            if (!listRef.current?.contains(document.activeElement)) setOpen(false);
          }, 150)}
          onKeyDown={handleKeyDown}
        />
      </div>
      {open && filtered.length > 0 && createPortal(
        <ul
          ref={listRef}
          className="aur-combo-dropdown"
          style={{ top: dropPos.top, left: dropPos.left, width: dropPos.width }}
        >
          {filtered.map((p, i) => (
            <li
              key={p.id}
              className={`aur-combo-option${i === hi ? ' aur-combo-option--active' : ''}`}
              onMouseDown={() => selectOption(p)}
              onMouseEnter={() => setHi(i)}
            >
              <span className="aur-combo-name">{p.nombreComercial}</span>
              {p.ingredienteActivo && <span className="aur-combo-meta">{p.ingredienteActivo}</span>}
            </li>
          ))}
        </ul>,
        document.body
      )}
    </div>
  );
}

function PackageManagement() {
  const apiFetch = useApiFetch();
  const [packages, setPackages] = useState([]);
  const [users, setUsers] = useState([]);
  const [productos, setProductos] = useState([]);
  const [plantillas, setPlantillas] = useState([]);
  const [calibraciones, setCalibraciones] = useState([]);
  const [formData, setFormData] = useState({
    id: null,
    nombrePaquete: '',
    descripcion: '',
    tipoCosecha: '',
    etapaCultivo: '',
    tecnicoResponsable: '',
    activities: []
  });
  const [loading, setLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [selectedPkg, setSelectedPkg] = useState(null);
  const [expandedActivities, setExpandedActivities] = useState(new Set());
  const [toast, setToast] = useState(null);
  const showToast = (message, type = 'success') => setToast({ message, type });
  const carouselRef = useRef(null);

  const [hubExpandedActivities, setHubExpandedActivities] = useState(new Set());
  const [pendingDeleteIdx, setPendingDeleteIdx] = useState(null);
  const [pendingDeletePkgId, setPendingDeletePkgId] = useState(null);
  const [pkgDepsModal, setPkgDepsModal] = useState(null);

  // Centra la burbuja activa en el carousel cuando cambia el paquete seleccionado
  useEffect(() => {
    if (!isFormOpen || !carouselRef.current) return;
    const active = carouselRef.current.querySelector('.pkg-bubble--active');
    active?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }, [selectedPkg?.id, formData.id, isFormOpen]);

  useEffect(() => {
    apiFetch('/api/packages').then(res => res.json()).then(setPackages).catch(console.error).finally(() => setLoading(false));
    apiFetch('/api/users').then(res => res.json()).then(setUsers).catch(console.error);
    apiFetch('/api/productos').then(res => res.json()).then(setProductos).catch(console.error);
    apiFetch('/api/task-templates').then(res => res.json()).then(setPlantillas).catch(console.error);
    apiFetch('/api/calibraciones').then(res => res.json()).then(setCalibraciones).catch(console.error);
  }, []);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value,
      ...(name === 'tipoCosecha' && value === 'Semillero' ? { etapaCultivo: 'N/A' } : {}),
    }));
  };

  const handleActivityChange = (index, field, value) => {
    const updatedActivities = [...formData.activities];
    updatedActivities[index] = { ...updatedActivities[index], [field]: value };
    setFormData(prev => ({ ...prev, activities: updatedActivities }));
  };

  const addActivity = () => {
    setFormData(prev => {
      const newIndex = prev.activities.length;
      setExpandedActivities(exp => {
        const next = new Set(exp);
        next.add(newIndex);
        return next;
      });
      return {
        ...prev,
        activities: [...prev.activities, { day: '', name: '', responsableId: '', calibracionId: '', productos: [] }]
      };
    });
  };

  const duplicateActivity = (index) => {
    setFormData(prev => {
      const copy = JSON.parse(JSON.stringify(prev.activities[index]));
      if (copy.name) copy.name = `Copia de ${copy.name}`;
      return {
        ...prev,
        activities: [
          ...prev.activities.slice(0, index + 1),
          copy,
          ...prev.activities.slice(index + 1),
        ],
      };
    });
    // Shift expanded indices > index up by 1 so the expansion state
    // keeps pointing to the same activities after the splice.
    setExpandedActivities(prev => {
      const next = new Set();
      prev.forEach(i => { if (i <= index) next.add(i); else next.add(i + 1); });
      return next;
    });
    setPendingDeleteIdx(null);
  };

  const removeActivity = (index) => {
    setFormData(prev => ({ ...prev, activities: prev.activities.filter((_, i) => i !== index) }));
    setPendingDeleteIdx(null);
    setExpandedActivities(prev => {
      const next = new Set();
      prev.forEach(i => { if (i < index) next.add(i); else if (i > index) next.add(i - 1); });
      return next;
    });
  };

  const toggleActivityExpand = (index) => {
    setExpandedActivities(prev => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const addProductToActivity = (activityIndex, productoId) => {
    if (!productoId) return;
    const producto = productos.find(p => p.id === productoId);
    if (!producto) return;
    const updatedActivities = [...formData.activities];
    const existing = updatedActivities[activityIndex].productos || [];
    if (existing.find(p => p.productoId === productoId)) return;
    if (existing.length >= 24) {
      showToast('Máximo 24 productos por aplicación.', 'error');
      return;
    }
    updatedActivities[activityIndex] = {
      ...updatedActivities[activityIndex],
      productos: [
        ...existing,
        {
          productoId: producto.id,
          nombreComercial: producto.nombreComercial,
          cantidadPorHa: '',
          unidad: producto.unidad,
          periodoReingreso: producto.periodoReingreso,
          periodoACosecha: producto.periodoACosecha,
        },
      ],
    };
    setFormData(prev => ({ ...prev, activities: updatedActivities }));
  };

  const removeProductFromActivity = (activityIndex, productoId) => {
    const updatedActivities = [...formData.activities];
    updatedActivities[activityIndex] = {
      ...updatedActivities[activityIndex],
      productos: updatedActivities[activityIndex].productos.filter(p => p.productoId !== productoId),
    };
    setFormData(prev => ({ ...prev, activities: updatedActivities }));
  };

  const updateProductCantidad = (activityIndex, productoId, newCantidad) => {
    const updatedActivities = [...formData.activities];
    updatedActivities[activityIndex] = {
      ...updatedActivities[activityIndex],
      productos: updatedActivities[activityIndex].productos.map(p =>
        p.productoId === productoId ? { ...p, cantidadPorHa: newCantidad } : p
      ),
    };
    setFormData(prev => ({ ...prev, activities: updatedActivities }));
  };

  const aplicarPlantillaAActividad = (activityIndex, plantillaId) => {
    const plantilla = plantillas.find(p => p.id === plantillaId);
    if (!plantilla) return;
    const productosDeActividad = plantilla.productos
      .map(tp => {
        const cat = productos.find(p => p.id === tp.productoId);
        if (!cat) return null;
        return {
          productoId: cat.id,
          nombreComercial: cat.nombreComercial,
          cantidadPorHa: tp.cantidad || 0,
          unidad: cat.unidad,
          periodoReingreso: cat.periodoReingreso,
          periodoACosecha: cat.periodoACosecha,
        };
      })
      .filter(Boolean);
    const updatedActivities = [...formData.activities];
    updatedActivities[activityIndex] = {
      ...updatedActivities[activityIndex],
      name: plantilla.nombre || updatedActivities[activityIndex].name,
      responsableId: plantilla.responsableId || updatedActivities[activityIndex].responsableId,
      productos: productosDeActividad,
    };
    setFormData(prev => ({ ...prev, activities: updatedActivities }));
    setExpandedActivities(prev => new Set(prev).add(activityIndex));
  };

  const handleEdit = (pkg) => {
    const normalizedActivities = (pkg.activities || [])
      .map(a => ({ type: 'notificacion', productos: [], ...a }))
      .sort((a, b) => Number(a.day) - Number(b.day));
    setFormData({ ...pkg, activities: normalizedActivities });
    setIsEditing(true);
    setIsFormOpen(true);
    setSelectedPkg(null);
    setExpandedActivities(new Set(normalizedActivities.map((_, i) => i)));
    window.scrollTo(0, 0);
  };

  const resetForm = () => {
    setFormData({ id: null, nombrePaquete: '', descripcion: '', tipoCosecha: '', etapaCultivo: '', tecnicoResponsable: '', activities: [] });
    setIsEditing(false);
    setIsFormOpen(false);
    setSelectedPkg(null);
    setExpandedActivities(new Set());
  };

  const handleNew = () => {
    setFormData({
      id: null,
      nombrePaquete: '',
      descripcion: '',
      tipoCosecha: '',
      etapaCultivo: '',
      tecnicoResponsable: '',
      activities: [{ day: '', name: '', responsableId: '', calibracionId: '', productos: [] }],
    });
    setIsEditing(false);
    setIsFormOpen(true);
    setSelectedPkg(null);
    setExpandedActivities(new Set([0]));
  };

  const handleSelectPkg = (pkg) => {
    setSelectedPkg(pkg);
    setIsEditing(false);
    setIsFormOpen(true);
    setExpandedActivities(new Set());
    setHubExpandedActivities(new Set());
    window.scrollTo(0, 0);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    // Validaciones de entradas
    if (!(formData.nombrePaquete || '').trim()) {
      showToast('El nombre del paquete es requerido.', 'error');
      return;
    }
    if ((formData.descripcion || '').length > 1024) {
      showToast('La descripción no puede superar 1024 caracteres.', 'error');
      return;
    }
    if ((formData.tecnicoResponsable || '').length > 48) {
      showToast('El técnico responsable no puede superar 48 caracteres.', 'error');
      return;
    }
    for (let i = 0; i < formData.activities.length; i++) {
      const a = formData.activities[i];
      if (!(a.name || '').trim()) {
        showToast(`Actividad ${i + 1}: el nombre es requerido.`, 'error');
        return;
      }
      if ((a.name || '').length > 120) {
        showToast(`Actividad ${i + 1}: el nombre no puede superar 120 caracteres.`, 'error');
        return;
      }
      const day = Number(a.day);
      if (!Number.isInteger(day) || day < 0 || day > 1825) {
        showToast(`Actividad ${i + 1}: el día debe ser un entero entre 0 y 1825.`, 'error');
        return;
      }
      const prods = a.productos || [];
      if (prods.length > 24) {
        showToast(`Actividad ${i + 1}: máximo 24 productos por aplicación.`, 'error');
        return;
      }
      for (const p of prods) {
        const cant = Number(p.cantidadPorHa);
        if (!Number.isFinite(cant) || cant <= 0 || cant >= 1024) {
          showToast(`Actividad ${i + 1}: la cantidad de "${p.nombreComercial}" debe ser mayor a 0 y menor a 1024.`, 'error');
          return;
        }
      }
    }

    const url = isEditing ? `/api/packages/${formData.id}` : '/api/packages';
    const method = isEditing ? 'PUT' : 'POST';
    const sortedActivities = [...formData.activities].sort((a, b) => Number(a.day) - Number(b.day));
    const body = {
      ...formData,
      activities: sortedActivities.map(a => ({
        ...a,
        type: (a.productos && a.productos.length > 0) ? 'aplicacion' : 'notificacion',
        productos: (a.productos || []).map(p => ({ ...p, cantidadPorHa: Number(p.cantidadPorHa) })),
      })),
    };
    try {
      const response = await apiFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error('Error al guardar el paquete');
      const updatedPackages = await apiFetch('/api/packages').then(res => res.json());
      setPackages(updatedPackages);
      resetForm();
      showToast(isEditing ? 'Paquete actualizado correctamente' : 'Paquete guardado correctamente');
    } catch (error) {
      showToast('Ocurrió un error al guardar.', 'error');
    }
  };

  const handleDuplicate = async (pkg) => {
    const body = {
      nombrePaquete: `Copia de ${pkg.nombrePaquete}`,
      tipoCosecha: pkg.tipoCosecha,
      etapaCultivo: pkg.etapaCultivo,
      tecnicoResponsable: pkg.tecnicoResponsable || '',
      activities: pkg.activities || [],
    };
    try {
      const response = await apiFetch('/api/packages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error();
      const updatedPackages = await apiFetch('/api/packages').then(res => res.json());
      setPackages(updatedPackages);
      showToast(`Paquete duplicado: "${body.nombrePaquete}"`);
    } catch {
      showToast('Error al duplicar el paquete.', 'error');
    }
  };

  const handleDeleteClick = async (pkg) => {
    try {
      const [lotesData, gruposData] = await Promise.all([
        apiFetch('/api/lotes').then(r => r.json()),
        apiFetch('/api/grupos').then(r => r.json()),
      ]);
      const depLotes = lotesData.filter(l => l.paqueteId === pkg.id);
      const depGrupos = gruposData.filter(g => g.paqueteId === pkg.id);
      if (depLotes.length > 0 || depGrupos.length > 0) {
        setPkgDepsModal({ name: pkg.nombrePaquete, lotes: depLotes, grupos: depGrupos });
      } else {
        setPendingDeletePkgId(pkg.id);
      }
    } catch {
      showToast('Error al verificar dependencias.', 'error');
    }
  };

  const handleDelete = async (id) => {
    try {
      const response = await apiFetch(`/api/packages/${id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('Error al eliminar el paquete');
      setPackages(packages.filter(p => p.id !== id));
      setPendingDeletePkgId(null);
      if (selectedPkg?.id === id) resetForm();
      showToast('Paquete eliminado correctamente');
    } catch (error) {
      showToast('Error al eliminar el paquete.', 'error');
    }
  };

  return (
    <div className={`pkg-page-wrapper${isFormOpen ? ' pkg-page--selected' : ''}${packages.length > 0 ? ' pkg-page--has-packages' : ''}`}>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {pendingDeletePkgId && (
        <AuroraConfirmModal
          danger
          title="¿Eliminar paquete?"
          body="Esta acción no se puede deshacer."
          confirmLabel="Eliminar"
          onConfirm={() => handleDelete(pendingDeletePkgId)}
          onCancel={() => setPendingDeletePkgId(null)}
        />
      )}

      {pkgDepsModal && (
        <AuroraConfirmModal
          size="wide"
          title="No es posible eliminar este paquete"
          body={
            <>
              El paquete <strong>"{pkgDepsModal.name}"</strong> está siendo usado por los siguientes registros.
              Por favor, resuelve estas dependencias antes de eliminarlo.
            </>
          }
          showCancel={false}
          confirmLabel="Entendido"
          onConfirm={() => setPkgDepsModal(null)}
          onCancel={() => setPkgDepsModal(null)}
        >
          <div className="pkg-deps-body">
            {pkgDepsModal.lotes.length > 0 && (
              <>
                <p className="pkg-deps-section-label">Lotes</p>
                <ul className="pkg-deps-list">
                  {pkgDepsModal.lotes.map(l => <li key={l.id}>{l.nombreLote}</li>)}
                </ul>
              </>
            )}
            {pkgDepsModal.grupos.length > 0 && (
              <>
                <p className="pkg-deps-section-label">Grupos</p>
                <ul className="pkg-deps-list">
                  {pkgDepsModal.grupos.map(g => <li key={g.id}>{g.nombreGrupo}</li>)}
                </ul>
              </>
            )}
          </div>
        </AuroraConfirmModal>
      )}

      {/* ── Spinner de carga ── */}
      {loading && <div className="pkg-page-loading" />}

      {!loading && !(isFormOpen && !selectedPkg) && <div className="pkg-page-header">
        <h1 className="pkg-page-title">Paquetes de Aplicaciones</h1>
        <button className="aur-btn-pill" onClick={handleNew}>
          <FiPlus size={14} /> Nuevo Paquete
        </button>
      </div>}
      {/* ── Mobile sticky carousel ── */}
      {!loading && isFormOpen && packages.length > 0 && (
        <div className="pkg-carousel" ref={carouselRef}>
          {packages.map(pkg => (
            <button
              key={pkg.id}
              className={`pkg-bubble${(selectedPkg?.id === pkg.id || (isEditing && formData.id === pkg.id)) ? ' pkg-bubble--active' : ''}`}
              onClick={() => {
                if (selectedPkg?.id === pkg.id && !isEditing) resetForm();
                else handleSelectPkg(pkg);
              }}
            >
              <span className="pkg-bubble-avatar">
                {pkg.nombrePaquete.slice(0, 4).toUpperCase()}
              </span>
              <span className="pkg-bubble-label">{pkg.nombrePaquete}</span>
            </button>
          ))}
          <button
            className={`pkg-bubble pkg-bubble--add${isFormOpen && !selectedPkg && !isEditing ? ' pkg-bubble--active' : ''}`}
            onClick={handleNew}
          >
            <span className="pkg-bubble-avatar pkg-bubble-avatar--add">+</span>
            <span className="pkg-bubble-label">Nuevo</span>
          </button>
        </div>
      )}

      {!loading && (packages.length > 0 || isFormOpen) && <div className="lote-management-layout">
      {isFormOpen && !selectedPkg && (
        <form onSubmit={handleSubmit} className="aur-sheet pkg-form" noValidate>
          <header className="aur-sheet-header">
            <div className="aur-sheet-header-text">
              <h2 className="aur-sheet-title">{isEditing ? 'Editar paquete' : 'Nuevo paquete'}</h2>
              <p className="aur-sheet-subtitle">
                {isEditing
                  ? 'Modifica la información del paquete y su programa de actividades.'
                  : 'Define un programa de aplicaciones reutilizable para tus lotes.'}
              </p>
            </div>
          </header>

          <section className="aur-section">
            <div className="aur-section-header">
              <span className="aur-section-num">01</span>
              <h3>Identidad</h3>
            </div>
            <div className="aur-list">
              <div className="aur-row">
                <label className="aur-row-label" htmlFor="nombrePaquete">Nombre</label>
                <input
                  id="nombrePaquete"
                  name="nombrePaquete"
                  className="aur-input"
                  value={formData.nombrePaquete}
                  onChange={handleInputChange}
                  maxLength={19}
                  placeholder="Ej. Postforza Premium"
                  required
                />
              </div>
              <div className="aur-row aur-row--multiline">
                <label className="aur-row-label" htmlFor="descripcion">Descripción</label>
                <textarea
                  id="descripcion"
                  name="descripcion"
                  className="aur-textarea"
                  value={formData.descripcion}
                  onChange={handleInputChange}
                  placeholder="Resumen breve del propósito del paquete..."
                  rows={3}
                  maxLength={1024}
                />
              </div>
            </div>
          </section>

          <section className="aur-section">
            <div className="aur-section-header">
              <span className="aur-section-num">02</span>
              <h3>Clasificación</h3>
            </div>
            <div className="aur-list">
              <div className="aur-row">
                <label className="aur-row-label" htmlFor="tipoCosecha">Tipo de cosecha</label>
                <select id="tipoCosecha" name="tipoCosecha" className="aur-select" value={formData.tipoCosecha} onChange={handleInputChange} required>
                  <option value="">Seleccionar...</option>
                  <option value="I Cosecha">I Cosecha</option>
                  <option value="II Cosecha">II Cosecha</option>
                  <option value="III Cosecha">III Cosecha</option>
                  <option value="Semillero">Semillero</option>
                </select>
              </div>
              <div className="aur-row">
                <label className="aur-row-label" htmlFor="etapaCultivo">Etapa del cultivo</label>
                <select id="etapaCultivo" name="etapaCultivo" className="aur-select" value={formData.etapaCultivo} onChange={handleInputChange} required>
                  <option value="">Seleccionar...</option>
                  <option value="Desarrollo">Desarrollo</option>
                  <option value="Postforza">Postforza</option>
                  <option value="N/A">N/A</option>
                </select>
              </div>
              <div className="aur-row">
                <label className="aur-row-label" htmlFor="tecnicoResponsable">Técnico responsable</label>
                <input
                  id="tecnicoResponsable"
                  name="tecnicoResponsable"
                  className="aur-input"
                  value={formData.tecnicoResponsable}
                  onChange={handleInputChange}
                  placeholder="Opcional"
                  maxLength={48}
                />
              </div>
            </div>
          </section>

          <section className="aur-section">
            <div className="aur-section-header">
              <span className="aur-section-num">03</span>
              <h3>Programa de actividades</h3>
              <span className="aur-section-count">{formData.activities.length}</span>
            </div>
            <ul className="pkg-act-list">
              {formData.activities.map((activity, index) => {
                const expanded = expandedActivities.has(index);
                const totals = {};
                (activity.productos || []).forEach(p => {
                  const cat = productos.find(cp => cp.id === p.productoId);
                  const precio = parseFloat(cat?.precioUnitario) || 0;
                  if (precio <= 0) return;
                  const mon = cat?.moneda || 'USD';
                  const qty = parseFloat(p.cantidadPorHa) || 0;
                  totals[mon] = (totals[mon] || 0) + qty * precio;
                });
                const costEntries = Object.entries(totals);
                return (
                  <li key={`act-${index}`} className="pkg-act-card">
                    <div className="pkg-act-row">
                      <div className="pkg-act-day">
                        <input
                          type="number"
                          min={0}
                          max={1825}
                          step={1}
                          value={activity.day}
                          onChange={(e) => handleActivityChange(index, 'day', e.target.value)}
                          aria-label="Día"
                          required
                        />
                        <span className="pkg-act-day-suffix">día</span>
                      </div>

                      <div className="pkg-act-body">
                        <input
                          type="text"
                          className="pkg-act-name"
                          value={activity.name}
                          onChange={(e) => handleActivityChange(index, 'name', e.target.value)}
                          placeholder="Nombre de la actividad"
                          required
                          maxLength={120}
                          aria-label="Nombre de la actividad"
                        />
                        <div className="pkg-act-meta">
                          <select
                            className="aur-chip"
                            value={activity.responsableId}
                            onChange={(e) => handleActivityChange(index, 'responsableId', e.target.value)}
                            aria-label="Responsable"
                          >
                            <option value="">Responsable</option>
                            {users.map(user => <option key={user.id} value={user.id}>{user.nombre}</option>)}
                          </select>
                          <select
                            className="aur-chip"
                            value={activity.calibracionId || ''}
                            onChange={(e) => handleActivityChange(index, 'calibracionId', e.target.value)}
                            aria-label="Calibración"
                          >
                            <option value="">Calibración</option>
                            {calibraciones.map(cal => <option key={cal.id} value={cal.id}>{cal.nombre}</option>)}
                          </select>
                          {plantillas.length > 0 && (
                            <select
                              className="aur-chip aur-chip--ghost"
                              value=""
                              onChange={(e) => {
                                if (e.target.value) aplicarPlantillaAActividad(index, e.target.value);
                              }}
                              aria-label="Cargar desde plantilla"
                            >
                              <option value="">+ Plantilla</option>
                              {plantillas.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                            </select>
                          )}
                        </div>
                      </div>

                      <div className={`pkg-act-cost${costEntries.length === 0 ? ' pkg-act-cost--empty' : ''}`}>
                        {costEntries.length === 0 ? '—' : costEntries.map(([mon, total]) => (
                          <div key={mon}>
                            {total.toFixed(2)}
                            <span className="pkg-act-cost-mon">{mon}</span>
                          </div>
                        ))}
                      </div>

                      <div className="pkg-act-actions">
                        {pendingDeleteIdx === index ? (
                          <div className="aur-inline-confirm">
                            <span className="aur-inline-confirm-text">¿Eliminar?</span>
                            <button type="button" className="aur-inline-confirm-yes" onClick={() => removeActivity(index)}>Sí</button>
                            <button type="button" className="aur-inline-confirm-no" onClick={() => setPendingDeleteIdx(null)}>No</button>
                          </div>
                        ) : (
                          <>
                            <button
                              type="button"
                              className="aur-icon-btn"
                              onClick={() => duplicateActivity(index)}
                              title="Duplicar actividad"
                            >
                              <FiCopy size={14} />
                            </button>
                            <button
                              type="button"
                              className="aur-icon-btn aur-icon-btn--danger"
                              onClick={() => setPendingDeleteIdx(index)}
                              title="Eliminar actividad"
                            >
                              <FiX size={15} />
                            </button>
                            <button
                              type="button"
                              className={`aur-icon-btn pkg-act-expand${expanded ? ' is-open' : ''}`}
                              onClick={() => toggleActivityExpand(index)}
                              title={expanded ? 'Ocultar productos' : 'Productos de mezcla'}
                            >
                              <FiChevronDown size={14} />
                            </button>
                          </>
                        )}
                      </div>
                    </div>

                    {expanded && (
                      <div className="pkg-act-products">
                        <span className="pkg-act-products-label">Productos de mezcla</span>
                        <div className="pkg-act-products-list">
                          {(activity.productos || []).map(p => {
                            const catProd = productos.find(cp => cp.id === p.productoId);
                            const precioUnitario = parseFloat(catProd?.precioUnitario) || 0;
                            const moneda = catProd?.moneda || '';
                            const qty = parseFloat(p.cantidadPorHa) || 0;
                            const precioTotal = qty * precioUnitario;
                            return (
                              <div key={p.productoId} className="pkg-prod-row">
                                <span className="pkg-prod-row-name">{p.nombreComercial}</span>
                                <div className="pkg-prod-row-qty">
                                  <input
                                    type="number"
                                    step="0.01"
                                    min="0.01"
                                    max="1023.99"
                                    value={p.cantidadPorHa}
                                    onChange={(e) => updateProductCantidad(index, p.productoId, e.target.value)}
                                    data-prod-qty={`${index}-${p.productoId}`}
                                    title="Cantidad por Ha"
                                  />
                                  <span className="pkg-prod-row-unit">{p.unidad}/Ha</span>
                                </div>
                                {precioUnitario > 0 ? (
                                  <span className="pkg-prod-row-cost">
                                    {precioTotal.toFixed(2)}
                                    <span className="pkg-prod-row-mon">{moneda}</span>
                                  </span>
                                ) : <span />}
                                <button
                                  type="button"
                                  className="pkg-prod-row-remove"
                                  onClick={() => removeProductFromActivity(index, p.productoId)}
                                  title="Quitar producto"
                                >
                                  <FiX size={12} />
                                </button>
                              </div>
                            );
                          })}
                          <ProdCombobox
                            productos={productos}
                            excludeIds={(activity.productos || []).map(p => p.productoId)}
                            onSelect={(productoId) => {
                              addProductToActivity(index, productoId);
                              setTimeout(() => {
                                const el = document.querySelector(`[data-prod-qty="${index}-${productoId}"]`);
                                if (el) { el.focus(); el.select(); }
                              }, 0);
                            }}
                          />
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            <button type="button" onClick={addActivity} className="pkg-add-activity">
              <FiPlus size={14} />
              Añadir actividad
            </button>
          </section>

          <footer className="pkg-form-actions">
            <button type="button" onClick={resetForm} className="aur-btn-text">Cancelar</button>
            <button type="submit" className="aur-btn-pill">{isEditing ? 'Actualizar paquete' : 'Guardar paquete'}</button>
          </footer>
        </form>
      )}

      {isFormOpen && selectedPkg && (
        <div className="lote-hub">
          <button className="lote-hub-back" onClick={resetForm}>
            <FiArrowLeft size={13} /> Todos los paquetes
          </button>
          <div className="hub-header">
            <div className="hub-title-block">
              <h2 className="hub-lote-code">{selectedPkg.nombrePaquete}</h2>
              {(() => {
                const totals = {};
                (selectedPkg.activities || []).forEach(act => {
                  (act.productos || []).forEach(p => {
                    const cat = productos.find(cp => cp.id === p.productoId);
                    const precio = parseFloat(cat?.precioUnitario) || 0;
                    if (precio <= 0) return;
                    const mon = cat?.moneda || 'USD';
                    totals[mon] = (totals[mon] || 0) + (p.cantidadPorHa || 0) * precio;
                  });
                });
                const entries = Object.entries(totals);
                if (entries.length === 0) return null;
                return (
                  <span className="pkg-hub-total-cost">
                    {entries.map(([mon, total]) => (
                      <span key={mon}>{total.toFixed(2)} <span className="pkg-hub-total-cost-mon">{mon}</span></span>
                    ))}
                  </span>
                );
              })()}
            </div>
            <div className="hub-header-actions">
              <button onClick={() => handleEdit(selectedPkg)} className="icon-btn" title="Editar paquete">
                <FiEdit size={16} />
              </button>
              <button onClick={() => handleDuplicate(selectedPkg)} className="icon-btn" title="Duplicar paquete">
                <FiCopy size={16} />
              </button>
              <button onClick={() => handleDeleteClick(selectedPkg)} className="icon-btn delete" title="Eliminar paquete">
                <FiTrash2 size={16} />
              </button>
            </div>
          </div>

          <div className="hub-info-pills">
            {selectedPkg.tipoCosecha && <span className="hub-pill">{selectedPkg.tipoCosecha}</span>}
            {selectedPkg.etapaCultivo && selectedPkg.etapaCultivo !== 'N/A' && (
              <span className="hub-pill">{selectedPkg.etapaCultivo}</span>
            )}
            {selectedPkg.tecnicoResponsable && (
              <span className="hub-pill">{selectedPkg.tecnicoResponsable}</span>
            )}
          </div>

          {selectedPkg.descripcion && (
            <p className="pkg-hub-desc">{selectedPkg.descripcion}</p>
          )}

          <div className="pkg-hub-section-label">
            Actividades <span className="pkg-hub-count">{selectedPkg.activities?.length || 0}</span>
          </div>
          {(!selectedPkg.activities || selectedPkg.activities.length === 0) ? (
            <p className="empty-state">Sin actividades programadas.</p>
          ) : (
            <ul className="pkg-hub-activities">
              {[...selectedPkg.activities]
                .sort((a, b) => Number(a.day) - Number(b.day))
                .map((act, i) => {
                  const resp = users.find(u => u.id === act.responsableId);
                  const cal = calibraciones.find(c => c.id === act.calibracionId);
                  const hasDetails = (act.productos?.length > 0) || !!cal;
                  const expanded = hubExpandedActivities.has(i);
                  const actCostos = (() => {
                    const totals = {};
                    (act.productos || []).forEach(p => {
                      const cat = productos.find(cp => cp.id === p.productoId);
                      const precio = parseFloat(cat?.precioUnitario) || 0;
                      if (precio <= 0) return;
                      const mon = cat?.moneda || 'USD';
                      totals[mon] = (totals[mon] || 0) + (p.cantidadPorHa || 0) * precio;
                    });
                    return Object.entries(totals);
                  })();
                  return (
                    <li key={i} className="pkg-hub-activity-item">
                      <span className="pkg-hub-activity-day">Día {act.day}</span>
                      <div className="pkg-hub-activity-info">
                        <span className="pkg-hub-activity-name">{act.name}</span>
                        {resp && <span className="pkg-hub-activity-resp">{resp.nombre}</span>}
                        {actCostos.length > 0 && (
                          <span className="pkg-hub-activity-cost">
                            {actCostos.map(([mon, total]) => (
                              <span key={mon}>{total.toFixed(2)} <span className="pkg-hub-activity-cost-mon">{mon}</span></span>
                            ))}
                          </span>
                        )}
                        {expanded && (
                          <div className="pkg-hub-activity-detail">
                            {cal && (
                              <span className="pkg-hub-detail-cal">Cal: {cal.nombre}</span>
                            )}
                            {act.productos?.map(p => {
                              const cat = productos.find(cp => cp.id === p.productoId);
                              const precioUnitario = parseFloat(cat?.precioUnitario) || 0;
                              const moneda = cat?.moneda || '';
                              const precioTotal = (p.cantidadPorHa || 0) * precioUnitario;
                              return (
                                <span key={p.productoId} className="pkg-hub-detail-prod">
                                  <span className="pkg-hub-detail-prod-name">{p.nombreComercial}</span>
                                  <span className="pkg-hub-detail-prod-dose">{p.cantidadPorHa} {p.unidad}/Ha</span>
                                  {precioUnitario > 0 && (
                                    <>
                                      <span className="pkg-hub-detail-prod-price">P.U.: {precioUnitario.toFixed(2)} {moneda}</span>
                                      <span className="pkg-hub-detail-prod-total">Total: {precioTotal.toFixed(2)} {moneda}</span>
                                    </>
                                  )}
                                </span>
                              );
                            })}
                          </div>
                        )}
                      </div>
                      {hasDetails && (
                        <button
                          className={`icon-btn pkg-action-btn${expanded ? ' expanded' : ''}`}
                          title={expanded ? 'Ocultar detalle' : 'Ver detalle'}
                          onClick={() => setHubExpandedActivities(prev => {
                            const next = new Set(prev);
                            if (next.has(i)) next.delete(i); else next.add(i);
                            return next;
                          })}
                        >
                          <FiEye size={14} />
                        </button>
                      )}
                    </li>
                  );
                })}
            </ul>
          )}
        </div>
      )}

      {packages.length > 0 && (
        <div className="lote-list-panel">
          <h3 className="lote-list-title">Paquetes</h3>
          <ul className="lote-list">
            {packages.map(pkg => (
              <li
                key={pkg.id}
                className={`lote-list-item${(selectedPkg?.id === pkg.id || (isEditing && formData.id === pkg.id)) ? ' active' : ''}`}
                onClick={() => {
                  if (selectedPkg?.id === pkg.id && !isEditing) { resetForm(); return; }
                  handleSelectPkg(pkg);
                }}
              >
                <div className="lote-list-info">
                  <span className="lote-list-code">{pkg.nombrePaquete}</span>
                  <span className="lote-list-name">{pkg.tipoCosecha} · {pkg.activities.length} act.</span>
                  {(() => {
                    const totals = {};
                    (pkg.activities || []).forEach(act => {
                      (act.productos || []).forEach(p => {
                        const cat = productos.find(cp => cp.id === p.productoId);
                        const precio = parseFloat(cat?.precioUnitario) || 0;
                        if (precio <= 0) return;
                        const mon = cat?.moneda || 'USD';
                        totals[mon] = (totals[mon] || 0) + (p.cantidadPorHa || 0) * precio;
                      });
                    });
                    const entries = Object.entries(totals);
                    if (entries.length === 0) return null;
                    return (
                      <span className="pkg-list-total-cost">
                        {entries.map(([mon, total]) => `${total.toFixed(2)} ${mon}`).join(' + ')}
                      </span>
                    );
                  })()}
                </div>
                <FiChevronRight size={14} className="lote-list-arrow" />
              </li>
            ))}
          </ul>
        </div>
      )}
      </div>}
    </div>
  );
}

export default PackageManagement;
