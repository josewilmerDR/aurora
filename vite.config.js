import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',
      registerType: 'prompt',
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

      // Con injectManifest, la lógica de Workbox va en src/sw.js
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        // El bundle supera los 2 MB tras Fase 4.3; permitir hasta 4 MB en
        // precache. Revisar si seguimos creciendo — candidato a code-splitting.
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
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
