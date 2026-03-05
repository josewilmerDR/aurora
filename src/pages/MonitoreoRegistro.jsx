import { useState, useEffect } from 'react';
import { useUser } from '../contexts/UserContext';
import Toast from '../components/Toast';
import './Monitoreo.css';

function MonitoreoRegistro() {
  const { currentUser } = useUser();
  const [lotes, setLotes]       = useState([]);
  const [tipos, setTipos]       = useState([]);
  const [form, setForm]         = useState({
    loteId: '', tipoId: '', bloque: '',
    fecha: new Date().toISOString().slice(0, 10),
    observaciones: '',
  });
  const [datos, setDatos]       = useState({});
  const [loading, setLoading]   = useState(false);
  const [toast, setToast]       = useState(null);
  const showToast = (message, type = 'success') => setToast({ message, type });

  useEffect(() => {
    fetch('/api/lotes').then(r => r.json()).then(setLotes).catch(console.error);
    fetch('/api/monitoreo/tipos').then(r => r.json())
      .then(data => setTipos(data.filter(t => t.activo !== false)))
      .catch(console.error);
  }, []);

  const tipoSeleccionado = tipos.find(t => t.id === form.tipoId);

  const handleForm = (e) => {
    const { name, value } = e.target;
    if (name === 'tipoId') setDatos({});
    setForm(prev => ({ ...prev, [name]: value }));
  };

  const handleDato = (key, value) => setDatos(prev => ({ ...prev, [key]: value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.loteId || !form.tipoId || !form.fecha) {
      showToast('Lote, tipo y fecha son obligatorios.', 'error');
      return;
    }
    setLoading(true);
    try {
      const lote = lotes.find(l => l.id === form.loteId);
      const tipo = tipos.find(t => t.id === form.tipoId);
      const res = await fetch('/api/monitoreo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          loteNombre: lote?.nombreLote || '',
          tipoNombre: tipo?.nombre || '',
          responsableId: currentUser?.id || '',
          responsableNombre: currentUser?.nombre || '',
          datos,
        }),
      });
      if (!res.ok) throw new Error();
      showToast('Monitoreo registrado correctamente.');
      setForm(prev => ({ ...prev, loteId: '', tipoId: '', bloque: '', observaciones: '' }));
      setDatos({});
    } catch {
      showToast('Error al registrar el monitoreo.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const renderCampo = (campo) => {
    const value = datos[campo.key] ?? '';
    if (campo.type === 'select') {
      return (
        <select value={value} onChange={e => handleDato(campo.key, e.target.value)}>
          <option value="">-- Seleccionar --</option>
          {campo.opciones.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      );
    }
    if (campo.type === 'date') {
      return (
        <input type="date" value={value} onChange={e => handleDato(campo.key, e.target.value)} />
      );
    }
    return (
      <input
        type={campo.type === 'percent' ? 'number' : campo.type}
        min={campo.type === 'percent' ? 0 : undefined}
        max={campo.type === 'percent' ? 100 : undefined}
        step={campo.type === 'number' || campo.type === 'percent' ? '0.01' : undefined}
        value={value}
        placeholder={campo.type === 'percent' ? '0 – 100' : ''}
        onChange={e => handleDato(campo.key, e.target.value)}
      />
    );
  };

  return (
    <div className="lote-management-layout">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      <div className="form-card">
        <form onSubmit={handleSubmit} className="lote-form">

          <p className="form-section-title">Información General</p>
          <div className="form-grid">
            <div className="form-control">
              <label htmlFor="loteId">Lote *</label>
              <select id="loteId" name="loteId" value={form.loteId} onChange={handleForm} required>
                <option value="">-- Seleccionar lote --</option>
                {lotes.map(l => <option key={l.id} value={l.id}>{l.nombreLote}</option>)}
              </select>
            </div>

            <div className="form-control">
              <label htmlFor="tipoId">Tipo de monitoreo *</label>
              <select id="tipoId" name="tipoId" value={form.tipoId} onChange={handleForm} required>
                <option value="">-- Seleccionar tipo --</option>
                {tipos.map(t => <option key={t.id} value={t.id}>{t.nombre}</option>)}
              </select>
            </div>

            <div className="form-control">
              <label htmlFor="fecha">Fecha *</label>
              <input id="fecha" name="fecha" type="date" value={form.fecha} onChange={handleForm} required />
            </div>

            <div className="form-control">
              <label htmlFor="bloque">Bloque / sector <span className="label-optional">(opcional)</span></label>
              <input id="bloque" name="bloque" value={form.bloque} onChange={handleForm} placeholder="Ej: Bloque A, Sector Norte" />
            </div>
          </div>

          {tipoSeleccionado && tipoSeleccionado.campos.length > 0 && (
            <>
              <p className="form-section-title">Datos del Monitoreo — {tipoSeleccionado.nombre}</p>
              <div className="form-grid">
                {tipoSeleccionado.campos.map(campo => (
                  <div key={campo.key} className="form-control">
                    <label>
                      {campo.label}
                      {campo.type === 'percent' && <span className="label-optional"> (%)</span>}
                    </label>
                    {renderCampo(campo)}
                  </div>
                ))}
              </div>
            </>
          )}

          <p className="form-section-title">Observaciones</p>
          <div className="form-control">
            <textarea
              name="observaciones"
              value={form.observaciones}
              onChange={handleForm}
              rows={3}
              placeholder="Condiciones del campo, anomalías observadas, recomendaciones..."
            />
          </div>

          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? 'Guardando...' : 'Registrar Monitoreo'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default MonitoreoRegistro;
