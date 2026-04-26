import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';
import './styles/aurora.css';
import './styles/legacy-globals.css';
import { registerSW } from 'virtual:pwa-register';

// With registerType: 'prompt', onNeedRefresh fires when a new version is waiting.
// __swUpdatePending persists the state in case the event fires before React mounts.
window.__swUpdatePending = false;

const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    window.__swUpdate = () => updateSW(true);
    window.__swUpdatePending = true;
    window.dispatchEvent(new CustomEvent('sw-update-available'));
  },
});

// In SPAs the browser does not check the SW on every navigation.
// Force an update check when the tab regains focus, and every hour.
if ('serviceWorker' in navigator) {
  const checkForUpdate = () => navigator.serviceWorker.ready.then(r => r.update()).catch(() => {});
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkForUpdate();
  });
  setInterval(checkForUpdate, 60 * 60 * 1000);
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
