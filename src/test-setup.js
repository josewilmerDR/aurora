// Setup global para Vitest. Carga los matchers de @testing-library/jest-dom
// (toBeInTheDocument, toHaveClass, etc.) y limpia el DOM entre tests.

import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// React Testing Library normalmente limpia automáticamente, pero lo hacemos
// explícito por si se ejecutan tests en serie y un fragmento queda colgado.
afterEach(() => {
  cleanup();
});
