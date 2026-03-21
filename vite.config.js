import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['aurora-logo.png', 'icon-512-maskable.png'],

      // ── Web App Manifest ──────────────────────────────────────────────────
      manifest: {
        name: 'Aurora',
        short_name: 'Aurora',
        description: 'Plataforma de gestión agrícola',
        theme_color: '#0d1a26',
        background_color: '#0d1a26',
        display: 'standalone',
        orientation: 'portrait-primary',
        scope: '/',
        start_url: '/',
        icons: [
          {
            src: 'aurora-logo.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'icon-512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },

      // ── Workbox (service worker) ──────────────────────────────────────────
      workbox: {
        // Pre-cachear todos los assets del build
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],

        runtimeCaching: [
          {
            // API calls: NetworkFirst → intenta red, si falla usa caché
            urlPattern: ({ url }) => url.pathname.startsWith('/api/'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'aurora-api-cache',
              networkTimeoutSeconds: 5,
              expiration: {
                maxEntries: 200,
                maxAgeSeconds: 60 * 60 * 2, // 2 horas
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
        ],
      },
    }),
  ],

  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:5001',
        changeOrigin: true,
        rewrite: (path) => `/aurora-7dc9b/us-central1/api${path}`,
      },
    },
  },
});
