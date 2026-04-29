import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Vitest config separado de vite.config.js para evitar arrastrar el plugin de
// PWA (workbox) y la configuración de proxy del dev server al test runner.
// Sólo necesitamos el plugin de React y el entorno jsdom.
//
// Convención (docs/code-standards.md §7): tests del frontend viven colocalizados
// en `__tests__/` dentro de cada feature. Tests de utilidades cross-cutting
// viven junto al archivo que prueban (e.g. src/lib/errorMessages.test.js).

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.js'],
    css: false, // No procesamos CSS en tests — los componentes sólo se prueban por estructura/aria.
    include: [
      'src/**/*.test.{js,jsx,ts,tsx}',
      'src/**/__tests__/**/*.{js,jsx,ts,tsx}',
    ],
    exclude: [
      'node_modules',
      'dist',
      'functions/**', // Backend usa jest, ver functions/jest.config.js
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'lcov'],
      include: ['src/**/*.{js,jsx}'],
      exclude: [
        'src/**/*.test.{js,jsx}',
        'src/**/__tests__/**',
        'src/test-setup.js',
        'src/firebase.js', // Inicialización Firebase, no testeable sin emulators
        'src/sw.js',       // Service worker
        'src/main.jsx',    // Entry point
      ],
      // Anti-regression thresholds (F7). Globals están al piso del baseline
      // actual — el frontend tiene pocos tests todavía y no queremos forzar
      // un threshold aspiracional que rompa CI sin valor real. A medida que
      // crece la cobertura (más smoke tests por feature), estos números
      // suben en pasos pequeños.
      //
      // Per-file: cubrimos al 100% utilidades estables y testeadas (e.g.
      // errorMessages.js). Esto previene que un refactor accidentalmente
      // borre cobertura de un módulo crítico.
      thresholds: {
        statements: 0,
        branches: 20,   // baseline ~21.7%
        functions: 5,   // baseline ~5.2%
        lines: 0,
        'src/lib/errorMessages.js': {
          statements: 100, branches: 100, functions: 100, lines: 100,
        },
      },
    },
  },
});
