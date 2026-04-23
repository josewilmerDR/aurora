import { Navigate } from 'react-router-dom';

// Redirect legacy /operaciones/horimetro → /operaciones/horimetro/registro
export default function Horimetro() {
  return <Navigate to="/operaciones/horimetro/registro" replace />;
}
