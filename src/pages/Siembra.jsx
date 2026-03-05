import { useState, useEffect, useRef } from 'react';
import { FiPlus, FiTrash2, FiCheckCircle, FiCircle, FiAlertCircle, FiCamera } from 'react-icons/fi';
import { useUser, hasMinRole } from '../contexts/UserContext';
import Toast from '../components/Toast';
import './Siembra.css';

const HOY = new Date().toISOString().slice(0, 10);

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
  const { currentUser } = useUser();
  const [lotes, setLotes]           = useState([]);
  const [materiales, setMateriales] = useState([]);
  const [fecha, setFecha]           = useState(HOY);
  const [rows, setRows]             = useState([{ ...EMPTY_ROW }]);
  const [registros, setRegistros]   = useState([]);
  const [loading, setLoading]       = useState(false);
  const [scanning, setScanning]     = useState(false);
  const [toast, setToast]           = useState(null);
  const fileInputRef                = useRef(null);
  const showToast = (msg, type = 'success') => setToast({ message: msg, type });

  useEffect(() => {
    fetch('/api/lotes').then(r => r.json()).then(setLotes).catch(console.error);
    fetch('/api/materiales-siembra').then(r => r.json()).then(setMateriales).catch(console.error);
    cargarRegistros();
  }, []);

  const cargarRegistros = async () => {
    try {
      const data = await fetch('/api/siembras').then(r => r.json());
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
      const res = await fetch('/api/siembras/escanear', {
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

    for (const row of validos) {
      try {
        let loteId = row.loteId;
        let loteNombre = '';

        // Crear nuevo lote si es necesario
        if (loteId === '__nuevo__' && row.loteNuevoNombre.trim()) {
          const res = await fetch('/api/lotes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nombreLote: row.loteNuevoNombre.trim(), fechaCreacion: fecha }),
          });
          if (!res.ok) throw new Error('No se pudo crear el lote.');
          const created = await res.json();
          loteId = created.id;
          loteNombre = row.loteNuevoNombre.trim();
          // Refrescar lista de lotes
          setLotes(prev => [...prev, { id: loteId, nombreLote: loteNombre }]);
        } else {
          loteNombre = lotes.find(l => l.id === loteId)?.nombreLote || '';
        }

        // Crear nuevo material si es necesario
        let mat = materialFor(row.materialId);
        let materialId = row.materialId || '';
        if (row.materialId === '__nuevo__' && row.matNuevoNombre.trim()) {
          const mRes = await fetch('/api/materiales-siembra', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              nombre: row.matNuevoNombre.trim(),
              rangoPesos: row.matNuevoRangoPesos || '',
              variedad: row.matNuevoVariedad || '',
            }),
          });
          if (!mRes.ok) throw new Error('No se pudo crear el material.');
          const mCreated = await mRes.json();
          mat = { id: mCreated.id, nombre: row.matNuevoNombre.trim(), rangoPesos: row.matNuevoRangoPesos || '', variedad: row.matNuevoVariedad || '' };
          materialId = mCreated.id;
          setMateriales(prev => [...prev, mat]);
        }

        await fetch('/api/siembras', {
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
      await fetch(`/api/siembras/${reg.id}`, {
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
      await fetch(`/api/siembras/${id}`, { method: 'DELETE' });
      setRegistros(prev => prev.filter(r => r.id !== id));
      showToast('Registro eliminado.');
    } catch {
      showToast('Error al eliminar.', 'error');
    }
  };

  const formatFecha = (iso) => new Date(iso).toLocaleDateString('es-CR', { day: '2-digit', month: 'short', year: 'numeric' });

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
        <h3 className="siembra-historial-title">Registros de Siembra</h3>

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
              {registros.map(r => (
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
                      {r.cerrado
                        ? <FiCheckCircle size={18} />
                        : <FiCircle size={18} />}
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
      </div>
    </div>
  );
}

export default Siembra;
