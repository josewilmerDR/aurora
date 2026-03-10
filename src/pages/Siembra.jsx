import { useState, useEffect, useRef, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { FiPlus, FiTrash2, FiCheckCircle, FiCircle, FiAlertCircle, FiCamera, FiChevronRight } from 'react-icons/fi';
import { useUser, hasMinRole } from '../contexts/UserContext';
import Toast from '../components/Toast';
import { useApiFetch } from '../hooks/useApiFetch';
import './Siembra.css';

const HOY = new Date().toISOString().slice(0, 10);

// ── Sort utilities ────────────────────────────────────────────────────────────
const SORT_FIELDS = [
  { value: 'fecha',    label: 'Fecha' },
  { value: 'lote',     label: 'Lote' },
  { value: 'bloque',   label: 'Bloque' },
  { value: 'plantas',  label: 'Plantas' },
  { value: 'area',     label: 'Área' },
  { value: 'material', label: 'Material' },
  { value: 'variedad', label: 'Variedad' },
  { value: 'cerrado',  label: 'Cerrado' },
];

function getSortVal(r, field) {
  switch (field) {
    case 'fecha':    return r.fecha || '';
    case 'lote':     return (r.loteNombre || '').toLowerCase();
    case 'bloque':   return (r.bloque || '').toLowerCase();
    case 'plantas':  return r.plantas || 0;
    case 'area':     return r.areaCalculada || 0;
    case 'material': return (r.materialNombre || '').toLowerCase();
    case 'variedad': return (r.variedad || '').toLowerCase();
    case 'cerrado':  return r.cerrado ? 1 : 0;
    default:         return '';
  }
}

function applySort(data, sortConfig) {
  const active = sortConfig.filter(s => s.field);
  if (!active.length) return [...data];
  return [...data].sort((a, b) => {
    for (const { field, dir } of active) {
      const av = getSortVal(a, field);
      const bv = getSortVal(b, field);
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      if (cmp !== 0) return dir === 'asc' ? cmp : -cmp;
    }
    return 0;
  });
}

const MAX_IMAGE_PX = 1600;
function compressImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = (e) => {
      img.onload = () => {
        let { width, height } = img;
        if (width > MAX_IMAGE_PX || height > MAX_IMAGE_PX) {
          const ratio = Math.min(MAX_IMAGE_PX / width, MAX_IMAGE_PX / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
        resolve({ base64: dataUrl.split(',')[1], mediaType: 'image/jpeg' });
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

const EMPTY_ROW = {
  loteId: '', loteNuevoNombre: '',
  bloque: '', plantas: '', densidad: '65000',
  materialId: '', matNuevoNombre: '', matNuevoRangoPesos: '', matNuevoVariedad: '',
  cerrado: false,
};

function Siembra() {
  const apiFetch = useApiFetch();
  const { currentUser } = useUser();
  const [lotes, setLotes]           = useState([]);
  const [materiales, setMateriales] = useState([]);
  const [fecha, setFecha]           = useState(HOY);
  const [rows, setRows]             = useState([{ ...EMPTY_ROW }]);
  const [registros, setRegistros]   = useState([]);
  const [loading, setLoading]       = useState(false);
  const [scanning, setScanning]     = useState(false);
  const [toast, setToast]           = useState(null);
  const [sortConfig, setSortConfig] = useState([
    { field: 'fecha', dir: 'desc' },
    { field: '',      dir: 'asc'  },
  ]);

  const updateSort = (idx, key, value) =>
    setSortConfig(prev => prev.map((s, i) => i === idx ? { ...s, [key]: value } : s));

  const displayedRegistros = useMemo(() => applySort(registros, sortConfig).slice(0, 20), [registros, sortConfig]);
  const fileInputRef                = useRef(null);
  const showToast = (msg, type = 'success') => setToast({ message: msg, type });

  useEffect(() => {
    apiFetch('/api/lotes').then(r => r.json()).then(d => setLotes(Array.isArray(d) ? d : [])).catch(console.error);
    apiFetch('/api/materiales-siembra').then(r => r.json()).then(d => setMateriales(Array.isArray(d) ? d : [])).catch(console.error);
    cargarRegistros();
  }, []);

  const cargarRegistros = async () => {
    try {
      const data = await apiFetch('/api/siembras').then(r => r.json());
      setRegistros(Array.isArray(data) ? data : []);
    } catch { /* silent */ }
  };

  // ── Row helpers ──────────────────────────────────────────────────────────
  const updateRow = (idx, field, value) => {
    setRows(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value };
      return next;
    });
  };

  const addRow    = () => setRows(prev => [...prev, { ...EMPTY_ROW }]);
  const removeRow = (idx) => setRows(prev => prev.filter((_, i) => i !== idx));

  // Verifica si un lote+bloque ya tiene un registro cerrado
  const isBloqueadoCerrado = (loteId, bloque) =>
    bloque.trim() !== '' && registros.some(r => r.loteId === loteId && r.bloque === bloque.trim() && r.cerrado);

  // Checkbox "Cerrado" en el formulario: pide confirmación antes de marcar
  const handleCerradoChange = (idx, checked) => {
    if (checked) {
      const ok = window.confirm(
        '¿Marcar este bloque como cerrado?\n\n' +
        'Esto indica que la siembra del bloque está completa y el lote está listo para iniciar aplicaciones. ' +
        'No se podrán registrar más siembras en este bloque.\n\n' +
        'Solo un supervisor puede revertir esta acción.'
      );
      if (!ok) return;
    }
    updateRow(idx, 'cerrado', checked);
  };

  const materialFor = (id) => materiales.find(m => m.id === id);

  const areaCalc = (row) => {
    const p = parseInt(row.plantas);
    const d = parseFloat(row.densidad);
    if (!p || !d) return '—';
    return (p / d).toFixed(2) + ' ha';
  };

  // ── Escanear formulario físico con IA ────────────────────────────────────
  const handleScanFile = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    setScanning(true);
    try {
      const imageData = await compressImage(file);
      const res = await apiFetch('/api/siembras/escanear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: imageData.base64, mediaType: imageData.mediaType }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Error del servidor');

      const newRows = (data.filas || []).map(f => ({
        loteId:           f.loteId || (f.loteNombre ? '__nuevo__' : ''),
        loteNuevoNombre:  f.loteId ? '' : (f.loteNombre || ''),
        bloque:           f.bloque || '',
        plantas:          f.plantas ? String(f.plantas) : '',
        densidad:         f.densidad ? String(f.densidad) : '65000',
        materialId:       f.materialId || (f.materialNombre ? '__nuevo__' : ''),
        matNuevoNombre:   f.materialId ? '' : (f.materialNombre || ''),
        matNuevoRangoPesos: f.materialId ? '' : (f.rangoPesos || ''),
        matNuevoVariedad: f.materialId ? '' : (f.variedad || ''),
        cerrado: false,
      }));

      if (newRows.length > 0) {
        setRows(newRows);
        showToast(`${newRows.length} fila(s) cargadas desde la imagen. Revisa los datos y guarda.`);
      } else {
        showToast('La IA no encontró filas de siembra en la imagen.', 'error');
      }
    } catch (err) {
      showToast(err.message || 'Error al escanear el formulario.', 'error');
    } finally {
      setScanning(false);
    }
  };

  // ── Guardar todos los rows ───────────────────────────────────────────────
  const handleGuardar = async () => {
    const validos = rows.filter(r => (r.loteId || r.loteNuevoNombre.trim()) && r.plantas && r.densidad);
    if (!validos.length) {
      showToast('Completa al menos una fila con lote, plantas y densidad.', 'error');
      return;
    }

    // Validar que ningún lote+bloque esté cerrado
    for (const row of validos) {
      if (row.loteId && row.loteId !== '__nuevo__' && isBloqueadoCerrado(row.loteId, row.bloque)) {
        const loteNombre = lotes.find(l => l.id === row.loteId)?.nombreLote || row.loteId;
        showToast(
          `El bloque "${row.bloque}" del lote "${loteNombre}" ya está cerrado. Corrija la información antes de guardar.`,
          'error'
        );
        return;
      }
    }

    setLoading(true);
    let errores = 0;

    // Mapas para evitar crear duplicados dentro del mismo guardado
    const createdLoteMap = {};   // nombreLote -> { id, nombreLote }
    const createdMatMap  = {};   // nombreMat   -> { id, nombre, rangoPesos, variedad }

    for (const row of validos) {
      try {
        let loteId = row.loteId;
        let loteNombre = '';

        // Crear nuevo lote si es necesario (solo una vez por nombre)
        if (loteId === '__nuevo__' && row.loteNuevoNombre.trim()) {
          const nombre = row.loteNuevoNombre.trim();
          if (createdLoteMap[nombre]) {
            loteId     = createdLoteMap[nombre].id;
            loteNombre = nombre;
          } else {
            const res = await apiFetch('/api/lotes', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ nombreLote: nombre, fechaCreacion: fecha }),
            });
            if (!res.ok) throw new Error('No se pudo crear el lote.');
            const created = await res.json();
            loteId     = created.id;
            loteNombre = nombre;
            createdLoteMap[nombre] = { id: loteId, nombreLote: nombre };
            setLotes(prev => [...prev, { id: loteId, nombreLote: nombre }]);
          }
        } else {
          loteNombre = lotes.find(l => l.id === loteId)?.nombreLote || '';
        }

        // Crear nuevo material si es necesario (solo una vez por nombre)
        let mat = materialFor(row.materialId);
        let materialId = row.materialId || '';
        if (row.materialId === '__nuevo__' && row.matNuevoNombre.trim()) {
          const nombre = row.matNuevoNombre.trim();
          if (createdMatMap[nombre]) {
            mat        = createdMatMap[nombre];
            materialId = mat.id;
          } else {
            const mRes = await apiFetch('/api/materiales-siembra', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                nombre,
                rangoPesos: row.matNuevoRangoPesos || '',
                variedad:   row.matNuevoVariedad   || '',
              }),
            });
            if (!mRes.ok) throw new Error('No se pudo crear el material.');
            const mCreated = await mRes.json();
            mat        = { id: mCreated.id, nombre, rangoPesos: row.matNuevoRangoPesos || '', variedad: row.matNuevoVariedad || '' };
            materialId = mCreated.id;
            createdMatMap[nombre] = mat;
            setMateriales(prev => [...prev, mat]);
          }
        }

        await apiFetch('/api/siembras', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            loteId, loteNombre,
            bloque: row.bloque,
            plantas: parseInt(row.plantas),
            densidad: parseFloat(row.densidad),
            materialId,
            materialNombre: mat?.nombre || '',
            rangoPesos: mat?.rangoPesos || '',
            variedad: mat?.variedad || '',
            cerrado: row.cerrado,
            fecha,
            responsableId: currentUser?.id || '',
            responsableNombre: currentUser?.nombre || '',
          }),
        });
      } catch {
        errores++;
      }
    }

    setLoading(false);
    if (errores > 0) {
      showToast(`${errores} fila(s) no pudieron guardarse.`, 'error');
    } else {
      showToast(`${validos.length} registro(s) guardados correctamente.`);
      setRows([{ ...EMPTY_ROW }]);
      cargarRegistros();
    }
  };

  // ── Toggle cerrado en registros existentes ───────────────────────────────
  const toggleCerrado = async (reg) => {
    const esSupervisor = hasMinRole(currentUser?.rol, 'supervisor');

    // Desmarcar cerrado: solo supervisor+
    if (reg.cerrado) {
      if (!esSupervisor) {
        showToast('Solo un supervisor puede reabrir un bloque cerrado.', 'error');
        return;
      }
      const ok = window.confirm(
        `¿Reabrir el bloque "${reg.bloque || '(sin bloque)'}" del lote "${reg.loteNombre}"?\n\n` +
        'Se podrán volver a agregar registros de siembra en este bloque.'
      );
      if (!ok) return;
    }

    // Marcar como cerrado: pide confirmación
    if (!reg.cerrado) {
      const ok = window.confirm(
        `¿Marcar el bloque "${reg.bloque || '(sin bloque)'}" del lote "${reg.loteNombre}" como cerrado?\n\n` +
        'Esto indica que la siembra está completa y el lote está listo para iniciar aplicaciones. ' +
        'Solo un supervisor puede revertir esta acción.'
      );
      if (!ok) return;
    }

    try {
      await apiFetch(`/api/siembras/${reg.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cerrado: !reg.cerrado }),
      });
      setRegistros(prev => prev.map(r => r.id === reg.id ? { ...r, cerrado: !r.cerrado } : r));
    } catch {
      showToast('Error al actualizar.', 'error');
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('¿Eliminar este registro?')) return;
    try {
      await apiFetch(`/api/siembras/${id}`, { method: 'DELETE' });
      setRegistros(prev => prev.filter(r => r.id !== id));
      showToast('Registro eliminado.');
    } catch {
      showToast('Error al eliminar.', 'error');
    }
  };

  const formatFecha = (iso) => new Date(iso.slice(0, 10) + 'T12:00:00').toLocaleDateString('es-CR', { day: '2-digit', month: 'short', year: 'numeric' });

  return (
    <div className="siembra-layout">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {/* ── Formulario de entrada ─────────────────────────────────────── */}
      <div className="form-card siembra-form-card">
        <div className="siembra-header-row">
          <div className="form-control siembra-fecha">
            <label htmlFor="fecha">Fecha de siembra</label>
            <input id="fecha" type="date" value={fecha} onChange={e => setFecha(e.target.value)} />
          </div>
        </div>

        {/* Tabla de filas */}
        <div className="siembra-table-wrapper">
          <table className="siembra-table">
            <thead>
              <tr>
                <th>Lote</th>
                <th>Bloque</th>
                <th>Plantas</th>
                <th>Densidad<span className="th-hint">(pl/ha)</span></th>
                <th>Área calc.</th>
                <th>Material</th>
                <th>Rango pesos</th>
                <th>Variedad</th>
                <th className="th-center">Cerrado</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => {
                const mat = materialFor(row.materialId);
                return (
                  <tr key={idx}>
                    {/* Lote */}
                    <td className="td-lote">
                      {row.loteId === '__nuevo__' ? (
                        <input
                          className="td-input"
                          placeholder="Nombre del nuevo lote"
                          value={row.loteNuevoNombre}
                          onChange={e => updateRow(idx, 'loteNuevoNombre', e.target.value)}
                          autoFocus
                        />
                      ) : (
                        <select
                          className="td-select"
                          value={row.loteId}
                          onChange={e => {
                            updateRow(idx, 'loteId', e.target.value);
                            if (e.target.value !== '__nuevo__') updateRow(idx, 'loteNuevoNombre', '');
                          }}
                        >
                          <option value="">-- Lote --</option>
                          {lotes.map(l => <option key={l.id} value={l.id}>{l.nombreLote}</option>)}
                          <option value="__nuevo__">＋ Crear nuevo lote</option>
                        </select>
                      )}
                      {row.loteId === '__nuevo__' && (
                        <button
                          className="btn-icon siembra-cancel-nuevo"
                          title="Cancelar nuevo"
                          onClick={() => { updateRow(idx, 'loteId', ''); updateRow(idx, 'loteNuevoNombre', ''); }}
                        >×</button>
                      )}
                    </td>

                    {/* Bloque */}
                    <td>
                      <input className="td-input" placeholder="Ej: A" value={row.bloque}
                        onChange={e => updateRow(idx, 'bloque', e.target.value)} />
                    </td>

                    {/* Plantas */}
                    <td>
                      <input className="td-input td-num" type="number" min="0" placeholder="0"
                        value={row.plantas} onChange={e => updateRow(idx, 'plantas', e.target.value)} />
                    </td>

                    {/* Densidad */}
                    <td>
                      <input className="td-input td-num" type="number" min="0" placeholder="65000"
                        value={row.densidad} onChange={e => updateRow(idx, 'densidad', e.target.value)} />
                    </td>

                    {/* Área calculada */}
                    <td className="td-calc">{areaCalc(row)}</td>

                    {/* Material */}
                    <td className="td-lote">
                      {row.materialId === '__nuevo__' ? (
                        <input
                          className="td-input"
                          placeholder="Nombre del material"
                          value={row.matNuevoNombre}
                          onChange={e => updateRow(idx, 'matNuevoNombre', e.target.value)}
                          autoFocus
                        />
                      ) : (
                        <select
                          className="td-select"
                          value={row.materialId}
                          onChange={e => {
                            updateRow(idx, 'materialId', e.target.value);
                            if (e.target.value !== '__nuevo__') updateRow(idx, 'matNuevoNombre', '');
                          }}
                        >
                          <option value="">-- Material --</option>
                          {materiales.map(m => <option key={m.id} value={m.id}>{m.nombre}</option>)}
                          <option value="__nuevo__">＋ Nuevo material</option>
                        </select>
                      )}
                      {row.materialId === '__nuevo__' && (
                        <button
                          className="btn-icon siembra-cancel-nuevo"
                          title="Cancelar nuevo"
                          onClick={() => updateRow(idx, 'materialId', '')}
                        >×</button>
                      )}
                    </td>

                    {/* Rango pesos: readonly o editable si es nuevo material */}
                    <td>
                      {row.materialId === '__nuevo__'
                        ? <input className="td-input" placeholder="Ej: 200g-300g" value={row.matNuevoRangoPesos} onChange={e => updateRow(idx, 'matNuevoRangoPesos', e.target.value)} />
                        : <span className="td-readonly">{mat?.rangoPesos || '—'}</span>
                      }
                    </td>

                    {/* Variedad: readonly o editable si es nuevo material */}
                    <td>
                      {row.materialId === '__nuevo__'
                        ? <input className="td-input" placeholder="Ej: MD2" value={row.matNuevoVariedad} onChange={e => updateRow(idx, 'matNuevoVariedad', e.target.value)} />
                        : <span className="td-readonly">{mat?.variedad || '—'}</span>
                      }
                    </td>

                    {/* Cerrado */}
                    <td className="td-center">
                      <input type="checkbox" checked={row.cerrado}
                        onChange={e => handleCerradoChange(idx, e.target.checked)} />
                    </td>

                    {/* Eliminar fila */}
                    <td>
                      {rows.length > 1 && (
                        <button className="btn-icon btn-danger" onClick={() => removeRow(idx)}>
                          <FiTrash2 size={14} />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="siembra-form-actions">
          <button className="btn btn-secondary" onClick={addRow} disabled={scanning}>
            <FiPlus size={15} /> Agregar fila
          </button>
          <button className="btn btn-secondary" onClick={() => fileInputRef.current?.click()} disabled={scanning || loading}>
            <FiCamera size={15} /> {scanning ? 'Analizando…' : 'Escanear'}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            style={{ display: 'none' }}
            onChange={handleScanFile}
          />
          <button className="btn btn-primary" onClick={handleGuardar} disabled={loading || scanning}>
            {loading ? 'Guardando...' : 'Guardar registros'}
          </button>
        </div>
      </div>

      {/* ── Historial reciente ─────────────────────────────────────────── */}
      <div className="siembra-historial">
        <div className="historial-top-row">
          <h3 className="siembra-historial-title">Registros de Siembra</h3>
          {/* Sort controls */}
          <div className="historial-sort-row">
            {sortConfig.map((s, idx) => (
              <div key={idx} className="sort-group">
                <span className="sort-label">{idx === 0 ? 'Ordenar por' : 'Luego por'}</span>
                <select
                  className="sort-select"
                  value={s.field}
                  onChange={e => updateSort(idx, 'field', e.target.value)}
                >
                  <option value="">—</option>
                  {SORT_FIELDS.map(f => (
                    <option key={f.value} value={f.value}>{f.label}</option>
                  ))}
                </select>
                <button
                  className={`sort-dir-btn${!s.field ? ' sort-dir-disabled' : ''}`}
                  disabled={!s.field}
                  onClick={() => updateSort(idx, 'dir', s.dir === 'asc' ? 'desc' : 'asc')}
                  title={s.dir === 'asc' ? 'Ascendente' : 'Descendente'}
                >
                  {s.dir === 'asc' ? '↑' : '↓'}
                </button>
              </div>
            ))}
          </div>
        </div>

        {registros.length === 0 ? (
          <p className="empty-state">No hay registros aún.</p>
        ) : (
          <table className="siembra-table siembra-table-historial">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Lote</th>
                <th>Bloque</th>
                <th>Plantas</th>
                <th>Densidad</th>
                <th>Área</th>
                <th>Material</th>
                <th>Variedad</th>
                <th className="th-center">Cerrado</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {displayedRegistros.map(r => (
                <tr key={r.id} className={r.cerrado ? 'row-cerrado' : ''}>
                  <td className="td-readonly">{formatFecha(r.fecha)}</td>
                  <td>{r.loteNombre}</td>
                  <td>{r.bloque || '—'}</td>
                  <td className="td-num">{r.plantas?.toLocaleString()}</td>
                  <td className="td-num">{r.densidad?.toLocaleString()}</td>
                  <td className="td-calc">{r.areaCalculada ? r.areaCalculada + ' ha' : '—'}</td>
                  <td>{r.materialNombre || '—'}</td>
                  <td>{r.variedad || '—'}</td>
                  <td className="td-center">
                    <button
                      className={`siembra-cerrado-btn${r.cerrado ? ' is-cerrado' : ''}`}
                      onClick={() => toggleCerrado(r)}
                      title={r.cerrado ? 'Marcar como abierto' : 'Marcar como cerrado'}
                    >
                      {r.cerrado ? <FiCheckCircle size={18} /> : <FiCircle size={18} />}
                    </button>
                  </td>
                  <td>
                    <button className="btn-icon btn-danger" onClick={() => handleDelete(r.id)}>
                      <FiTrash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {registros.some(r => r.cerrado) && (
          <p className="siembra-cerrado-hint">
            <FiAlertCircle size={13} />
            Los bloques cerrados están listos para iniciar aplicaciones.
          </p>
        )}

        {registros.length > 0 && (
          <div className="historial-footer">
            <span className="historial-count">
              Mostrando {Math.min(20, registros.length)} de {registros.length} registros
            </span>
            <Link to="/siembra/historial" className="ver-todos-link">
              Ver todos los registros <FiChevronRight size={13} />
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

export default Siembra;
