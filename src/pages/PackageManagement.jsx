import { useState, useEffect, useRef, useCallback, Fragment } from 'react';
import { createPortal } from 'react-dom';
import './PackageManagement.css';
import { FiEdit, FiTrash2, FiPlus, FiX, FiEye, FiSearch, FiCopy, FiPackage, FiChevronRight, FiArrowLeft } from 'react-icons/fi';
import Toast from '../components/Toast';
import { useApiFetch } from '../hooks/useApiFetch';

// ── Product search combobox ──────────────────────────────────────────────────
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
    <div className="pkg-prod-combo" ref={wrapRef}>
      <div className="pkg-prod-input-wrap">
        <FiSearch size={13} />
        <input
          type="text"
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
          className="pkg-prod-dropdown"
          style={{ top: dropPos.top, left: dropPos.left, width: dropPos.width }}
        >
          {filtered.map((p, i) => (
            <li
              key={p.id}
              className={`pkg-prod-option${i === hi ? ' pkg-prod-option--active' : ''}`}
              onMouseDown={() => selectOption(p)}
              onMouseEnter={() => setHi(i)}
            >
              <span className="pkg-prod-name">{p.nombreComercial}</span>
              {p.ingredienteActivo && <span className="pkg-prod-ing">{p.ingredienteActivo}</span>}
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
  const [focusedActivity, setFocusedActivity] = useState(null);
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
        <div className="pkg-deps-overlay" onClick={() => setPendingDeletePkgId(null)}>
          <div className="pkg-deps-modal" onClick={e => e.stopPropagation()}>
            <h3>¿Eliminar paquete?</h3>
            <p>Esta acción no se puede deshacer.</p>
            <div className="pkg-deps-actions">
              <button className="btn btn-secondary" onClick={() => setPendingDeletePkgId(null)}>Cancelar</button>
              <button className="btn btn-primary" onClick={() => handleDelete(pendingDeletePkgId)}>Eliminar</button>
            </div>
          </div>
        </div>
      )}

      {pkgDepsModal && (
        <div className="pkg-deps-overlay" onClick={() => setPkgDepsModal(null)}>
          <div className="pkg-deps-modal" onClick={e => e.stopPropagation()}>
            <h3>No es posible eliminar este paquete</h3>
            <p>
              El paquete <strong>"{pkgDepsModal.name}"</strong> está siendo usado por los siguientes registros.
              Por favor, resuelve estas dependencias antes de eliminarlo.
            </p>
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
            <div className="pkg-deps-actions">
              <button className="btn btn-secondary" onClick={() => setPkgDepsModal(null)}>Entendido</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Spinner de carga ── */}
      {loading && <div className="pkg-page-loading" />}

      {/* ── Estado vacío ── */}
      {!loading && packages.length === 0 && !isFormOpen && (
        <div className="pkg-empty-state">
          <FiPackage size={36} />
          <p>No hay paquetes de aplicaciones creados aún.</p>
          <button className="btn btn-primary" onClick={handleNew}>
            <FiPlus size={15} /> Crear el primero
          </button>
        </div>
      )}

      {!loading && (packages.length > 0 || isFormOpen) && <div className="pkg-page-header">
        <h1 className="pkg-page-title">Paquetes de Aplicaciones</h1>
        {packages.length > 0 && !(isFormOpen && !selectedPkg && !isEditing) && (
          <button className="btn btn-primary" onClick={handleNew}>
            <FiPlus /> Nuevo Paquete
          </button>
        )}
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
      {isFormOpen && !selectedPkg && <div className="form-card">
          <h2>{isEditing ? 'Editando Paquete' : 'Nuevo Paquete de Aplicaciones'}</h2>
          <form onSubmit={handleSubmit} className="lote-form">
          <div className="form-grid">
            <div className="form-control">
              <label htmlFor="nombrePaquete">Nombre del Paquete</label>
              <input id="nombrePaquete" name="nombrePaquete" value={formData.nombrePaquete} onChange={handleInputChange} maxLength={19} required />
            </div>
            <div className="form-control form-control--full">
              <label htmlFor="descripcion">Descripción del Paquete</label>
              <textarea
                id="descripcion"
                name="descripcion"
                value={formData.descripcion}
                onChange={handleInputChange}
                placeholder="Ej: Paquete para la etapa inicial de desarrollo, incluye aplicaciones preventivas contra hongos y fertilización base."
                rows={3}
                maxLength={1024}
              />
            </div>
            <div className="form-control">
              <label htmlFor="tipoCosecha">Tipo de Cosecha</label>
              <select id="tipoCosecha" name="tipoCosecha" value={formData.tipoCosecha} onChange={handleInputChange} required>
                <option value="">-- Seleccionar --</option>
                <option value="I Cosecha">I Cosecha</option>
                <option value="II Cosecha">II Cosecha</option>
                <option value="III Cosecha">III Cosecha</option>
                <option value="Semillero">Semillero</option>
              </select>
            </div>
            <div className="form-control">
              <label htmlFor="etapaCultivo">Etapa del Cultivo</label>
              <select id="etapaCultivo" name="etapaCultivo" value={formData.etapaCultivo} onChange={handleInputChange} required>
                <option value="">-- Seleccionar --</option>
                <option value="Desarrollo">Desarrollo</option>
                <option value="Postforza">Postforza</option>
                <option value="N/A">N/A</option>
              </select>
            </div>
            <div className="form-control">
              <label htmlFor="tecnicoResponsable">Técnico responsable</label>
              <input
                id="tecnicoResponsable"
                name="tecnicoResponsable"
                value={formData.tecnicoResponsable}
                onChange={handleInputChange}
                placeholder="Nombre del técnico responsable"
                maxLength={48}
              />
            </div>
          </div>

          <h3>Actividades Programadas</h3>
          <div className="activities-table-wrapper">
            <table className="activities-table">
              <thead>
                <tr>
                  <th className="col-day">Día</th>
                  <th className="col-name">Actividad</th>
                  <th className="col-cal">Volumen/Calibración</th>
                  <th className="col-user">Responsable</th>
                  <th className="col-cost">Costo total</th>
                  <th className="col-action"></th>
                </tr>
              </thead>
              <tbody>
                {formData.activities.map((activity, index) => (
                  <Fragment key={`act-${index}`}>
                    <tr>
                      <td><input value={activity.day} onChange={(e) => handleActivityChange(index, 'day', e.target.value)} type="number" min={0} max={1825} step={1} required /></td>
                      <td>
                        <div
                          className="activity-name-cell"
                          onBlur={(e) => {
                            if (!e.currentTarget.contains(e.relatedTarget)) {
                              setFocusedActivity(null);
                            }
                          }}
                        >
                          {plantillas.length > 0 && focusedActivity === index && (
                            <select
                              className="plantilla-inline-select"
                              value=""
                              onChange={(e) => {
                                if (e.target.value) {
                                  aplicarPlantillaAActividad(index, e.target.value);
                                  setFocusedActivity(null);
                                }
                              }}
                            >
                              <option value="">-- Cargar desde plantilla --</option>
                              {plantillas.map(p => (
                                <option key={p.id} value={p.id}>{p.nombre}</option>
                              ))}
                            </select>
                          )}
                          <input
                            value={activity.name}
                            onChange={(e) => handleActivityChange(index, 'name', e.target.value)}
                            placeholder="Nombre de la actividad"
                            required
                            maxLength={120}
                            onFocus={() => setFocusedActivity(index)}
                          />
                        </div>
                      </td>
                      <td>
                        <select value={activity.calibracionId || ''} onChange={(e) => handleActivityChange(index, 'calibracionId', e.target.value)}>
                          <option value="">-- Ninguna --</option>
                          {calibraciones.map(cal => (
                            <option key={cal.id} value={cal.id}>{cal.nombre}</option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <select value={activity.responsableId} onChange={(e) => handleActivityChange(index, 'responsableId', e.target.value)}>
                          <option value="">-- Asignar --</option>
                          {users.map(user => <option key={user.id} value={user.id}>{user.nombre}</option>)}
                        </select>
                      </td>
                      <td className="activity-cost-cell">
                        {(() => {
                          const totals = {};
                          (activity.productos || []).forEach(p => {
                            const cat = productos.find(cp => cp.id === p.productoId);
                            const precio = parseFloat(cat?.precioUnitario) || 0;
                            if (precio <= 0) return;
                            const mon = cat?.moneda || 'USD';
                            const qty = parseFloat(p.cantidadPorHa) || 0;
                            totals[mon] = (totals[mon] || 0) + qty * precio;
                          });
                          const entries = Object.entries(totals);
                          if (entries.length === 0) return <span className="activity-cost-empty">—</span>;
                          return entries.map(([mon, total]) => (
                            <span key={mon} className="activity-cost-value">
                              {total.toFixed(2)} <span className="activity-cost-mon">{mon}</span>
                            </span>
                          ));
                        })()}
                      </td>
                      <td>
                        <div className="activity-row-actions">
                          {pendingDeleteIdx === index ? (
                            <div className="activity-delete-confirm">
                              <span>¿Eliminar?</span>
                              <button type="button" className="btn-confirm-yes" onClick={() => removeActivity(index)}>Sí</button>
                              <button type="button" className="btn-confirm-no" onClick={() => setPendingDeleteIdx(null)}>No</button>
                            </div>
                          ) : (
                            <>
                              <button type="button" onClick={() => setPendingDeleteIdx(index)} className="icon-btn pkg-action-btn" title="Eliminar Actividad">
                                <FiX size={16} />
                              </button>
                              <button type="button" onClick={() => duplicateActivity(index)} className="icon-btn pkg-action-btn" title="Duplicar Actividad">
                                <FiCopy size={15} />
                              </button>
                              <button
                                type="button"
                                onClick={() => toggleActivityExpand(index)}
                                className={`icon-btn pkg-action-btn${expandedActivities.has(index) ? ' expanded' : ''}`}
                                title={expandedActivities.has(index) ? 'Ocultar productos' : 'Agregar productos'}
                              >
                                <FiEye size={16} />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                    {expandedActivities.has(index) && (
                      <tr className="products-subrow-tr">
                        <td colSpan="6">
                          <div className="products-subrow">
                            <div className="products-subrow-header">
                              <span className="products-subrow-label">Productos de mezcla:</span>
                            </div>
                            <div className="products-tags">
                              {(activity.productos || []).map(p => {
                                const catProd = productos.find(cp => cp.id === p.productoId);
                                const precioUnitario = parseFloat(catProd?.precioUnitario) || 0;
                                const moneda = catProd?.moneda || '';
                                const qty = parseFloat(p.cantidadPorHa) || 0;
                                const precioTotal = qty * precioUnitario;
                                return (
                                  <span key={p.productoId} className="product-tag">
                                    <strong>{p.nombreComercial}</strong>
                                    <input
                                      type="number"
                                      step="0.01"
                                      min="0.01"
                                      max="1023.99"
                                      value={p.cantidadPorHa}
                                      onChange={(e) => updateProductCantidad(index, p.productoId, e.target.value)}
                                      className="product-tag-qty"
                                      title="Cantidad por Ha (> 0 y < 1024)"
                                      data-prod-qty={`${index}-${p.productoId}`}
                                    />
                                    <span className="product-tag-unit">{p.unidad}/Ha</span>
                                    {precioUnitario > 0 && (
                                      <>
                                        <span className="product-tag-price">P.U.: {precioUnitario.toFixed(2)} {moneda}</span>
                                        <span className="product-tag-price product-tag-price--total">Total: {precioTotal.toFixed(2)} {moneda}</span>
                                      </>
                                    )}
                                    <button
                                      type="button"
                                      className="product-tag-remove"
                                      onClick={() => removeProductFromActivity(index, p.productoId)}
                                      title="Quitar producto"
                                    >
                                      <FiX size={12} />
                                    </button>
                                  </span>
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
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          <div className="add-activity-btn-container">
            <button type="button" onClick={addActivity} className="btn btn-secondary">
              <FiPlus />
              Añadir Actividad
            </button>
          </div>

          <div className="form-actions">
            <button type="submit" className="btn btn-primary">{isEditing ? 'Actualizar Paquete' : 'Guardar Paquete'}</button>
            <button type="button" onClick={resetForm} className="btn btn-secondary">Cancelar</button>
          </div>
        </form>
      </div>}

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
