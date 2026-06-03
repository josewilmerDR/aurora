import { useCallback } from 'react';
import BodegaView from '../components/BodegaView';

// Bodega de combustibles. Resuelve la bodega por tipo (no usa :bodegaId en URL).
export default function BodegaCombustibles() {
  const resolveBodega = useCallback((bodegas, navigate) => {
    const b = bodegas.find(x => x.tipo === 'combustibles');
    if (!b) { navigate('/'); return null; }
    return b;
  }, []);

  return (
    <BodegaView
      resolveBodega={resolveBodega}
      emptyStockTitle="Sin combustibles registrados"
      itemNombrePlaceholder="Ej: Diesel"
    />
  );
}
