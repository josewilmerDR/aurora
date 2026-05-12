import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { FiX, FiExternalLink } from 'react-icons/fi';
import './ImageLightbox.css';

/**
 * ImageLightbox — vista ampliada de una imagen sobre un backdrop oscurecido.
 *
 * Props:
 *   - src      string · URL o data-URL de la imagen
 *   - alt      string · texto alternativo (default: "Imagen")
 *   - caption  ReactNode · texto opcional debajo de la imagen
 *   - openUrl  string · si se provee, muestra link "Abrir en pestaña nueva"
 *                       (útil cuando src es data-URL y se quiere descargar)
 *   - onClose  fn · cierre por backdrop, botón X o tecla Esc
 */
export default function ImageLightbox({ src, alt = 'Imagen', caption, openUrl, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleBackdrop = (e) => {
    if (e.target === e.currentTarget) onClose?.();
  };

  return createPortal(
    <div className="img-lb-backdrop" onPointerDown={handleBackdrop}>
      <div className="img-lb-shell" onPointerDown={(e) => e.stopPropagation()}>
        <button
          type="button"
          className="img-lb-close"
          onClick={onClose}
          aria-label="Cerrar"
          title="Cerrar (Esc)"
        >
          <FiX size={18} />
        </button>
        <img src={src} alt={alt} className="img-lb-img" />
        {(caption || openUrl) && (
          <div className="img-lb-footer">
            {caption && <span className="img-lb-caption">{caption}</span>}
            {openUrl && (
              <a
                href={openUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="img-lb-open"
              >
                <FiExternalLink size={13} /> Abrir en pestaña nueva
              </a>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
