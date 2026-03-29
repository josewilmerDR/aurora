import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';
import { registerSW } from 'virtual:pwa-register';

// Rastrea la última actividad del usuario para detección de idle
let lastActivity = Date.now();
['mousemove', 'keydown', 'click', 'scroll', 'touchstart'].forEach(e =>
  window.addEventListener(e, () => { lastActivity = Date.now(); }, { passive: true })
);

// Con registerType: 'prompt', onNeedRefresh se dispara cuando hay nueva versión esperando
const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    const idleMs = Date.now() - lastActivity;
    if (idleMs > 30_000) {
      // Más de 30s sin actividad → recarga silenciosa
      updateSW(true);
    } else {
      // Usuario activo → mostrar banner
      window.__swUpdate = () => updateSW(true);
      window.dispatchEvent(new CustomEvent('sw-update-available'));
    }
  },
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
