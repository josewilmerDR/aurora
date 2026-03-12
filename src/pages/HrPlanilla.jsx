import { useNavigate } from 'react-router-dom';
import { FiDollarSign, FiClock } from 'react-icons/fi';
import './HR.css';

function HrPlanilla() {
  const navigate = useNavigate();

  return (
    <div className="lote-management-layout">
      <div className="form-card">
        <h2>Cálculo de Planilla</h2>
        <p style={{ color: 'var(--aurora-light)', opacity: 0.6, marginBottom: 24, fontSize: '0.9rem' }}>
          Selecciona el tipo de planilla que deseas generar.
        </p>
        <div className="planilla-hub-grid">
          <button className="planilla-hub-card" onClick={() => navigate('/hr/planilla/fijo')}>
            <FiDollarSign size={34} />
            <span className="planilla-hub-title">Salario Fijo</span>
            <span className="planilla-hub-desc">
              Para empleados con salario mensual definido. Pagos semanales, bisemales, quincenales o mensuales.
            </span>
          </button>
          <button className="planilla-hub-card" onClick={() => navigate('/hr/planilla/horas')}>
            <FiClock size={34} />
            <span className="planilla-hub-title">Por Hora / Unidad</span>
            <span className="planilla-hub-desc">
              Para trabajadores con tarifa por hora trabajada o por unidad producida.
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}

export default HrPlanilla;
