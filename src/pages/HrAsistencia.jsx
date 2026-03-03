import { useState, useEffect } from 'react';
import './HR.css';
import { FiTrash2, FiPlus } from 'react-icons/fi';
import Toast from '../components/Toast';

const now = new Date();
const ESTADOS = ['presente', 'ausente', 'tardanza', 'permiso'];

function HrAsistencia() {
  const [records, setRecords] = useState([]);
  const [users, setUsers] = useState([]);
  const [mes, setMes] = useState(String(now.getMonth() + 1).padStart(2, '0'));
  const [anio, setAnio] = useState(String(now.getFullYear()));
  const [formData, setFormData] = useState({
    trabajadorId: '', fecha: new Date().toISOString().split('T')[0],
    estado: 'presente', horasExtra: '0', notas: '',
  });
  const [toast, setToast] = useState(null);
  const showToast = (message, type = 'success') => setToast({ message, type });

  const fetchRecords = () => {
    fetch(`/api/hr/asistencia?mes=${mes}&anio=${anio}`)
      .then(r => r.json()).then(setRecords).catch(console.error);
  };

  useEffect(() => {
    fetch('/api/users').then(r => r.json()).then(setUsers).catch(console.error);
  }, []);

  useEffect(() => { fetchRecords(); }, [mes, anio]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const worker = users.find(u => u.id === formData.trabajadorId);
    try {
      const res = await fetch('/api/hr/asistencia', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...formData, trabajadorNombre: worker?.nombre || '' }),
      });
      if (!res.ok) throw new Error();
      fetchRecords();
      setFormData(prev => ({ ...prev, trabajadorId: '', notas: '', horasExtra: '0' }));
      showToast('Asistencia registrada.');
    } catch {
      showToast('Error al registrar asistencia.', 'error');
    }
  };

  const handleDelete = async (id) => {
    try {
      await fetch(`/api/hr/asistencia/${id}`, { method: 'DELETE' });
      fetchRecords();
      showToast('Registro eliminado.');
    } catch {
      showToast('Error al eliminar.', 'error');
    }
  };

  // Stats
  const stats = ESTADOS.reduce((acc, e) => {
    acc[e] = records.filter(r => r.estado === e).length;
    return acc;
  }, {});

  return (
    <div className="lote-management-layout">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      <div className="form-card">
        <h2>Registrar Asistencia</h2>
        <form onSubmit={handleSubmit} className="lote-form">
          <div className="form-grid">
            <div className="form-control">
              <label>Trabajador</label>
              <select name="trabajadorId" value={formData.trabajadorId} onChange={handleChange} required>
                <option value="">-- Seleccionar --</option>
                {users.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
              </select>
            </div>
            <div className="form-control">
              <label>Fecha</label>
              <input type="date" name="fecha" value={formData.fecha} onChange={handleChange} required />
            </div>
            <div className="form-control">
              <label>Estado</label>
              <select name="estado" value={formData.estado} onChange={handleChange}>
                <option value="presente">Presente</option>
                <option value="ausente">Ausente</option>
                <option value="tardanza">Tardanza</option>
                <option value="permiso">Permiso</option>
              </select>
            </div>
            <div className="form-control">
              <label>Horas Extra</label>
              <input type="number" name="horasExtra" min="0" step="0.5" value={formData.horasExtra} onChange={handleChange} />
            </div>
            <div className="form-control">
              <label>Notas</label>
              <input type="text" name="notas" value={formData.notas} onChange={handleChange} placeholder="Opcional" />
            </div>
          </div>
          <div className="form-actions">
            <button type="submit" className="btn btn-primary"><FiPlus /> Registrar</button>
          </div>
        </form>
      </div>

      <div className="list-card">
        <h2>Registro del Mes</h2>

        <div className="hr-filters">
          <select value={mes} onChange={e => setMes(e.target.value)}>
            {['01','02','03','04','05','06','07','08','09','10','11','12'].map(m => (
              <option key={m} value={m}>{new Date(2000, Number(m)-1).toLocaleString('es-ES', { month: 'long' })}</option>
            ))}
          </select>
          <select value={anio} onChange={e => setAnio(e.target.value)}>
            {[2024, 2025, 2026, 2027].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>

        <div className="hr-stats">
          {ESTADOS.map(e => (
            <div key={e} className="hr-stat-card">
              <div className="hr-stat-value">{stats[e] || 0}</div>
              <div className="hr-stat-label">{e}</div>
            </div>
          ))}
        </div>

        <ul className="info-list">
          {records.map(r => (
            <li key={r.id}>
              <div>
                <div className="item-main-text">
                  {r.trabajadorNombre}
                  <span className={`status-badge status-badge--${r.estado}`}>{r.estado}</span>
                  {r.horasExtra > 0 && <span className="status-badge status-badge--pendiente">+{r.horasExtra}h extra</span>}
                </div>
                <div className="item-sub-text">
                  {new Date(r.fecha).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' })}
                  {r.notas && ` · ${r.notas}`}
                </div>
              </div>
              <div className="lote-actions">
                <button onClick={() => handleDelete(r.id)} className="icon-btn delete" title="Eliminar">
                  <FiTrash2 size={18} />
                </button>
              </div>
            </li>
          ))}
        </ul>
        {records.length === 0 && <p className="empty-state">Sin registros para este período.</p>}
      </div>
    </div>
  );
}

export default HrAsistencia;
