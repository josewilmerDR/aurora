// Helpers genéricos de imagen (compresión cliente-side antes de subir/escanear).
// Extraído de Recepcion.jsx; el mismo patrón vive duplicado en InvoiceScan,
// SamplingRegisterModal, RegistroHorimetro, Siembra y AuroraChat — migrar esos
// a este módulo cuando se toquen.

export const MAX_IMAGE_PX = 1600;
export const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10 MB

// Redimensiona a MAX_IMAGE_PX (lado mayor) y recomprime a JPEG 0.82.
// Devuelve { base64, mediaType, previewUrl }.
export function compressImage(file) {
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
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
        resolve({ base64: dataUrl.split(',')[1], mediaType: 'image/jpeg', previewUrl: dataUrl });
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
