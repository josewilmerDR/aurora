import { useCallback } from 'react';
import { useParams } from 'react-router-dom';
import BodegaView from '../components/BodegaView';

// Bodega genérica (resuelta por :bodegaId). Redirige fuera si la bodega no
// existe, es de agroquímicos (tiene su propia vista) o es de combustibles.
export default function BodegaGenerica() {
  const { bodegaId } = useParams();

  const resolveBodega = useCallback((bodegas, navigate) => {
    const b = bodegas.find(x => x.id === bodegaId);
    if (!b || b.tipo === 'agroquimicos') { navigate('/'); return null; }
    if (b.tipo === 'combustibles') { navigate('/bodega/combustibles', { replace: true }); return null; }
    return b;
  }, [bodegaId]);

  return (
    <BodegaView
      resolveBodega={resolveBodega}
      emptyStockTitle="Esta bodega no tiene productos registrados."
      itemNombrePlaceholder="Ej: Tornillos 1/4"
    />
  );
}
