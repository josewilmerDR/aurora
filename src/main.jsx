import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';
import { registerSW } from 'virtual:pwa-register';

// Con registerType: 'prompt', onNeedRefresh se dispara cuando hay nueva versión esperando.
// __swUpdatePending persiste el estado por si el evento se dispara antes de que React monte.
window.__swUpdatePending = false;

const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    window.__swUpdate = () => updateSW(true);
    window.__swUpdatePending = true;
    window.dispatchEvent(new CustomEvent('sw-update-available'));
  },
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
