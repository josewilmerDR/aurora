import { useState, useEffect, useCallback } from 'react';
import { useApiFetch } from './useApiFetch';
import { useUser } from '../contexts/UserContext';

export function usePushNotifications() {
  const apiFetch = useApiFetch();
  const { isLoggedIn } = useUser();
  const [permission, setPermission] = useState(() =>
    typeof Notification !== 'undefined' ? Notification.permission : 'denied'
  );
  const [isSubscribed, setIsSubscribed] = useState(false);

  // Al montar, verificar si ya hay una suscripción activa
  useEffect(() => {
    if (!isLoggedIn || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.ready.then(async (reg) => {
      const sub = await reg.pushManager.getSubscription();
      setIsSubscribed(!!sub);
    });
  }, [isLoggedIn]);

  const subscribe = useCallback(async () => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;

    // 1. Pedir permiso
    const perm = await Notification.requestPermission();
    setPermission(perm);
    if (perm !== 'granted') return;

    // 2. Obtener la clave pública VAPID del servidor
    const res = await apiFetch('/api/push/vapid-public-key');
    if (!res.ok) return;
    const { publicKey } = await res.json();

    // 3. Crear suscripción en el service worker
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });

    // 4. Guardar suscripción en el servidor
    await apiFetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription: sub.toJSON() }),
    });

    setIsSubscribed(true);
  }, [apiFetch]);

  const unsubscribe = useCallback(async () => {
    if (!('serviceWorker' in navigator)) return;
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return;

    await apiFetch('/api/push/subscribe', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: sub.endpoint }),
    });
    await sub.unsubscribe();
    setIsSubscribed(false);
  }, [apiFetch]);

  return { permission, isSubscribed, subscribe, unsubscribe };
}

// Convierte la clave pública VAPID (base64url) al formato que espera PushManager
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}
