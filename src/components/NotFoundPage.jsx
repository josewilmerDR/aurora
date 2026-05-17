import { useNavigate } from 'react-router-dom';
import { FiCompass, FiHome } from 'react-icons/fi';
import EmptyState from './ui/EmptyState';

/**
 * NotFoundPage — pantalla mostrada por la ruta catch-all (`path="*"`).
 *
 * Se renderiza dentro del MainLayout (con sidebar + header), así que aquí
 * solo proveemos el contenido del área principal. Usamos EmptyState para
 * mantener consistencia visual con otros vacíos de la app.
 */
export default function NotFoundPage() {
  const navigate = useNavigate();
  return (
    <div className="aur-sheet">
      <EmptyState
        icon={FiCompass}
        title="No encontramos esa página"
        subtitle="El enlace puede estar roto o la página fue movida. Vuelve al inicio para seguir trabajando."
        action={
          <button
            type="button"
            className="aur-btn-pill"
            onClick={() => navigate('/')}
          >
            <FiHome size={14} /> Volver al inicio
          </button>
        }
      />
    </div>
  );
}
