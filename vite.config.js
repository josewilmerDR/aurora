import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ command, mode }) => {
  // Guard: sin site key de App Check el build de producción queda verde pero
  // la app muere en runtime contra un backend con APP_CHECK_MODE=enforce
  // (ningún cliente puede mintear tokens). Fallar acá convierte un outage
  // silencioso en un error de build con instrucciones. Vitest y `npm run dev`
  // no pasan por command==='build', así que no les afecta.
  const env = loadEnv(mode, process.cwd(), '');
  if (command === 'build' && mode === 'production' && !env.VITE_APPCHECK_SITE_KEY) {
    throw new Error(
      'VITE_APPCHECK_SITE_KEY falta en el entorno de build. Sin ella la app ' +
      'no puede mintear tokens de App Check y muere contra el backend en ' +
      'enforce. Definila en .env.local (ver .env.example) o en el env de CI.'
    );
  }

  return {
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
        lang: 'es',
        theme_color: '#0d1a26',
        background_color: '#0d1a26',
        display: 'standalone',
        orientation: 'portrait-primary',
        scope: '/',
        start_url: '/',
        categories: ['productivity', 'business'],
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
  };
});
