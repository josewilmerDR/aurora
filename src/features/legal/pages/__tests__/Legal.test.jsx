import { describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Terminos from '../Terminos';
import Privacidad from '../Privacidad';
import { LEGAL_VERSION, SUBPROCESSORS, DATA_CATEGORIES } from '../../lib/legal';

// Las páginas legales son la única promesa pública sobre qué hacemos con los
// datos. Lo que se protege aquí: que existan, que digan la versión vigente,
// que listen TODOS los subencargados declarados en lib/legal.js (la política
// promete la lista como exhaustiva) y que el aviso de IA nombre a Anthropic.
const renderAt = (ui) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe('<Terminos />', () => {
  test('un solo h1 y la versión vigente', () => {
    const { container } = renderAt(<Terminos />);
    expect(container.querySelectorAll('h1')).toHaveLength(1);
    expect(screen.getByText(new RegExp(`Versión ${LEGAL_VERSION}`))).toBeInTheDocument();
  });

  test('declara a la organización como responsable y a Aurora como encargado', () => {
    renderAt(<Terminos />);
    expect(screen.getByText(/La Organización es la responsable del tratamiento/)).toBeInTheDocument();
    expect(screen.getByText(/actuamos como encargados del tratamiento/)).toBeInTheDocument();
  });

  test('advierte que las salidas de la IA son sugerencias', () => {
    renderAt(<Terminos />);
    expect(screen.getByText(/Las salidas de la IA son sugerencias/)).toBeInTheDocument();
  });

  test('fija el título de la pestaña', () => {
    renderAt(<Terminos />);
    expect(document.title).toBe('Aurora — Términos del servicio');
  });
});

describe('<Privacidad />', () => {
  test('lista todos los subencargados declarados', () => {
    renderAt(<Privacidad />);
    SUBPROCESSORS.forEach((s) => {
      expect(screen.getAllByText(s.nombre).length).toBeGreaterThan(0);
    });
  });

  test('nombra a Anthropic como procesador de IA', () => {
    renderAt(<Privacidad />);
    expect(screen.getAllByText(/Anthropic/).length).toBeGreaterThan(0);
  });

  test('lista todas las categorías de datos, incluido personal y salud', () => {
    renderAt(<Privacidad />);
    DATA_CATEGORIES.forEach((c) => {
      expect(screen.getByText(c.titulo)).toBeInTheDocument();
    });
    expect(screen.getByText(/incapacidades/)).toBeInTheDocument();
  });

  test('remite a PRODHAB como autoridad de control', () => {
    renderAt(<Privacidad />);
    expect(screen.getByText(/PRODHAB/)).toBeInTheDocument();
  });
});
