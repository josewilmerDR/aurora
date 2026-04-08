import { useState, useEffect } from 'react';
import { FiTool, FiEdit, FiTrash2, FiPlus, FiX, FiCheck } from 'react-icons/fi';
import Toast from '../components/Toast';
import { useApiFetch } from '../hooks/useApiFetch';
import './MaquinariaList.css';

const TIPOS = [
  'CARRETA DE SEMILLA',
  'CARRETA DE COSECHA',
  'IMPLEMENTO',
  'MAQUINARIA DE APLICACIONES',
  'MAQUINARIA DE PREPARACIÓN DE TERRENO',
  'MONTACARGA',
  'MOTOCICLETA',
  'TRACTOR DE LLANTAS',
  'VEHÍCULO CARGA LIVIANA',
  'OTRO MAQUINARIA DE CAMPO',
];

const TIPO_APLICACIONES = 'MAQUINARIA DE APLICACIONES';

function calcResidualPct(adq, res) {
  const a = parseFloat(adq), r = parseFloat(res);
  if (!isNaN(a) && !isNaN(r) && a > 0) return `${((r / a) * 100).toFixed(1)}%`;
  return null;
}

function calcCostoDepHora(adq, res, hrs) {
  const a = parseFloat(adq), r = parseFloat(res), h = parseFloat(hrs);
  if (!isNaN(a) && !isNaN(r) && !isNaN(h) && h > 0) return `$${((a - r) / h).toFixed(2)}`;
  return null;
}

const EMPTY_FORM = {
  id: null,
  idMaquina: '',
  codigo: '',
  descripcion: '',
  tipo: '',
  ubicacion: '',
  observacion: '',
  capacidad: '',
  valorAdquisicion: '',
  valorResidual: '',
  vidaUtilHoras: '',
  fechaRevisionResidual: '',
};

function MaquinariaList() {
  const apiFetch = useApiFetch();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(EMPTY_FORM);
  const [isEditing, setIsEditing] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [filter, setFilter] = useState('');

  const showToast = (message, type = 'success') => setToast({ message, type });

  const fetchItems = () =>
    apiFetch('/api/maquinaria')
      .then(r => r.json())
      .then(setItems)
      .catch(() => showToast('Error al cargar la lista de maquinaria.', 'error'))
      .finally(() => setLoading(false));

  useEffect(() => { fetchItems(); }, []);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm(prev => ({
      ...prev,
      [name]: value,
    }));
  };

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setIsEditing(false);
    setShowForm(false);
  };

  const handleEdit = (item) => {
    setForm({ ...EMPTY_FORM, ...item });
    setIsEditing(true);
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleNew = () => {
    setForm(EMPTY_FORM);
    setIsEditing(false);
    setShowForm(true);
  };

  const handleDelete = async (id, descripcion) => {
    if (!window.confirm(`¿Eliminar "${descripcion}"?`)) return;
    try {
      const res = await apiFetch(`/api/maquinaria/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      showToast('Activo eliminado.');
      fetchItems();
    } catch {
      showToast('Error al eliminar.', 'error');
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.descripcion.trim()) {
      showToast('La descripción es obligatoria.', 'error');
      return;
    }
    setSaving(true);
    try {
      const url = isEditing ? `/api/maquinaria/${form.id}` : '/api/maquinaria';
      const method = isEditing ? 'PUT' : 'POST';
      const res = await apiFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error();
      showToast(isEditing ? 'Activo actualizado.' : 'Activo registrado.');
      resetForm();
      fetchItems();
    } catch {
      showToast('Error al guardar.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const q = filter.toLowerCase();
  const filtered = items.filter(item =>
    !q ||
    item.descripcion?.toLowerCase().includes(q) ||
    item.tipo?.toLowerCase().includes(q) ||
    item.idMaquina?.toLowerCase().includes(q) ||
    item.codigo?.toLowerCase().includes(q)
  );

  return (
    <div className="maq-wrap">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {/* ── Formulario ── */}
      {!showForm ? (
        <div className="maq-toolbar">
          <input
            className="maq-search"
            placeholder="Buscar por descripción, tipo o ID…"
            value={filter}
            onChange={e => setFilter(e.target.value)}
          />
          <button className="btn btn-primary" onClick={handleNew}>
            <FiPlus size={15} /> Nuevo Activo
          </button>
        </div>
      ) : (
        <div className="maq-form-card">
          <div className="maq-form-header">
            <span>{isEditing ? 'Editar Activo' : 'Nuevo Activo'}</span>
            <button className="maq-close-btn" onClick={resetForm} title="Cancelar">
              <FiX size={16} />
            </button>
          </div>

          <form className="maq-form" onSubmit={handleSubmit}>
            <div className="maq-form-grid">
              <div className="maq-field">
                <label>ID Activo</label>
                <input
                  name="idMaquina"
                  value={form.idMaquina}
                  onChange={handleChange}
                  placeholder="Ej. 0403-0020"
                />
              </div>

              <div className="maq-field">
                <label>Código (CC)</label>
                <input
                  name="codigo"
                  value={form.codigo}
                  onChange={handleChange}
                  placeholder="Ej. 3-20"
                />
              </div>

              <div className="maq-field maq-field--full">
                <label>Descripción <span className="maq-required">*</span></label>
                <input
                  name="descripcion"
                  value={form.descripcion}
                  onChange={handleChange}
                  placeholder="Nombre o descripción del activo"
                  required
                />
              </div>

              <div className="maq-field">
                <label>Cap. litros</label>
                <input
                  name="capacidad"
                  type="number"
                  min="0"
                  step="1"
                  value={form.capacidad}
                  onChange={handleChange}
                  placeholder="Ej. 500"
                />
              </div>

              <div className="maq-field">
                <label>Valor Adquisición</label>
                <input
                  name="valorAdquisicion"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.valorAdquisicion}
                  onChange={handleChange}
                  placeholder="Ej. 60000"
                />
              </div>

              <div className="maq-field">
                <label>Valor Residual</label>
                <input
                  name="valorResidual"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.valorResidual}
                  onChange={handleChange}
                  placeholder="Ej. 6000"
                />
              </div>

              <div className="maq-field maq-field--computed">
                <label>Valor Residual %</label>
                <input
                  readOnly
                  tabIndex={-1}
                  value={calcResidualPct(form.valorAdquisicion, form.valorResidual) ?? '—'}
                />
              </div>

              <div className="maq-field">
                <label>Vida Útil (horas)</label>
                <input
                  name="vidaUtilHoras"
                  type="number"
                  min="0"
                  step="1"
                  value={form.vidaUtilHoras}
                  onChange={handleChange}
                  placeholder="Ej. 10000"
                />
              </div>

              <div className="maq-field maq-field--computed">
                <label>Costo Dep. / Hora</label>
                <input
                  readOnly
                  tabIndex={-1}
                  value={calcCostoDepHora(form.valorAdquisicion, form.valorResidual, form.vidaUtilHoras) ?? '—'}
                />
              </div>

              <div className="maq-field">
                <label>Fecha Rev. Residual</label>
                <input
                  name="fechaRevisionResidual"
                  type="date"
                  value={form.fechaRevisionResidual}
                  onChange={handleChange}
                />
              </div>

              <div className="maq-field">
                <label>Tipo</label>
                <select name="tipo" value={form.tipo} onChange={handleChange}>
                  <option value="">— Seleccionar —</option>
                  {TIPOS.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>

              <div className="maq-field">
                <label>Ubicación</label>
                <input
                  name="ubicacion"
                  value={form.ubicacion}
                  onChange={handleChange}
                  placeholder="Ej. Finca Aurora"
                />
              </div>

              <div className="maq-field maq-field--full">
                <label>Observación</label>
                <textarea
                  name="observacion"
                  value={form.observacion}
                  onChange={handleChange}
                  placeholder="Estado, notas de mantenimiento, etc."
                  rows={2}
                />
              </div>
            </div>

            <div className="maq-form-actions">
              <button type="button" className="btn btn-secondary" onClick={resetForm}>
                Cancelar
              </button>
              <button type="submit" className="btn btn-primary" disabled={saving}>
                <FiCheck size={15} /> {saving ? 'Guardando…' : isEditing ? 'Actualizar' : 'Registrar'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ── Tabla ── */}
      <section className="maq-section">
        <div className="maq-section-header">
          <FiTool size={14} />
          <span>Activos registrados</span>
          {items.length > 0 && <span className="maq-count">{items.length}</span>}
          {showForm && (
            <button className="maq-add-inline" onClick={handleNew} title="Nuevo activo">
              <FiPlus size={13} />
            </button>
          )}
        </div>

        {loading ? (
          <p className="maq-empty">Cargando…</p>
        ) : filtered.length === 0 ? (
          <div className="maq-empty-state">
            <FiTool size={32} />
            <p>{items.length === 0 ? 'No hay activos registrados.' : 'Sin resultados para la búsqueda.'}</p>
            {items.length === 0 && (
              <button className="btn btn-primary" onClick={handleNew}>
                <FiPlus size={14} /> Agregar el primero
              </button>
            )}
          </div>
        ) : (
          <div className="maq-table-wrap">
            <table className="maq-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>CC</th>
                  <th>Descripción</th>
                  <th>Tipo</th>
                  <th>Ubicación</th>
                  <th>Cap. litros</th>
                  <th>Val. Adq.</th>
                  <th>Val. Residual</th>
                  <th>Res. %</th>
                  <th>Vida Útil (h)</th>
                  <th>Hrs. Acumuladas</th>
                  <th>Costo Dep./h</th>
                  <th>Rev. Residual</th>
                  <th>Observación</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(item => (
                  <tr key={item.id}>
                    <td className="maq-td-code">{item.idMaquina || '—'}</td>
                    <td className="maq-td-code">{item.codigo || '—'}</td>
                    <td className="maq-td-desc">{item.descripcion}</td>
                    <td>
                      {item.tipo
                        ? <span className="maq-tipo-badge">{item.tipo}</span>
                        : <span className="maq-td-empty">—</span>}
                    </td>
                    <td>{item.ubicacion || <span className="maq-td-empty">—</span>}</td>
                    <td>{item.capacidad ? `${item.capacidad} L` : <span className="maq-td-empty">—</span>}</td>
                    <td className="maq-td-num">{item.valorAdquisicion ? `$${Number(item.valorAdquisicion).toLocaleString('es-CR')}` : <span className="maq-td-empty">—</span>}</td>
                    <td className="maq-td-num">{item.valorResidual ? `$${Number(item.valorResidual).toLocaleString('es-CR')}` : <span className="maq-td-empty">—</span>}</td>
                    <td className="maq-td-num">{calcResidualPct(item.valorAdquisicion, item.valorResidual) ?? <span className="maq-td-empty">—</span>}</td>
                    <td className="maq-td-num">{item.vidaUtilHoras ? `${Number(item.vidaUtilHoras).toLocaleString('es-CR')} h` : <span className="maq-td-empty">—</span>}</td>
                    <td className="maq-td-num">{item.horasAcumuladas != null ? `${Number(item.horasAcumuladas).toFixed(1)} h` : <span className="maq-td-empty">—</span>}</td>
                    <td className="maq-td-num">{calcCostoDepHora(item.valorAdquisicion, item.valorResidual, item.vidaUtilHoras) ?? <span className="maq-td-empty">—</span>}</td>
                    <td>{item.fechaRevisionResidual || <span className="maq-td-empty">—</span>}</td>
                    <td className="maq-td-obs">{item.observacion || <span className="maq-td-empty">—</span>}</td>
                    <td className="maq-td-actions">
                      <button className="maq-btn-icon" onClick={() => handleEdit(item)} title="Editar">
                        <FiEdit size={13} />
                      </button>
                      <button className="maq-btn-icon maq-btn-danger" onClick={() => handleDelete(item.id, item.descripcion)} title="Eliminar">
                        <FiTrash2 size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

export default MaquinariaList;
