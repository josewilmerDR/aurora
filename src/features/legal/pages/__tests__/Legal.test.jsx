import { describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Terms from '../Terms';
import Privacy from '../Privacy';
import { LEGAL_VERSION, SUBPROCESSORS, DATA_CATEGORIES } from '../../lib/legal';

// The legal pages are the only public promise about what we do with data.
// Protected here: that they exist, state the current version, list EVERY
// sub-processor declared in lib/legal.js (the policy promises the list as
// exhaustive) and that the AI notice names Anthropic.
const renderAt = (ui) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe('<Terms />', () => {
  test('single h1 and the current version', () => {
    const { container } = renderAt(<Terms />);
    expect(container.querySelectorAll('h1')).toHaveLength(1);
    expect(screen.getByText(new RegExp(`Versión ${LEGAL_VERSION}`))).toBeInTheDocument();
  });

  test('declares the organization as controller and Aurora as processor', () => {
    renderAt(<Terms />);
    expect(screen.getByText(/La Organización es la responsable del tratamiento/)).toBeInTheDocument();
    expect(screen.getByText(/actuamos como encargados del tratamiento/)).toBeInTheDocument();
  });

  test('warns that AI outputs are suggestions', () => {
    renderAt(<Terms />);
    expect(screen.getByText(/Las salidas de la IA son sugerencias/)).toBeInTheDocument();
  });

  test('sets the tab title', () => {
    renderAt(<Terms />);
    expect(document.title).toBe('Aurora — Términos del servicio');
  });
});

describe('<Privacy />', () => {
  test('lists every declared sub-processor', () => {
    renderAt(<Privacy />);
    SUBPROCESSORS.forEach((s) => {
      expect(screen.getAllByText(s.name).length).toBeGreaterThan(0);
    });
  });

  test('names Anthropic as the AI processor', () => {
    renderAt(<Privacy />);
    expect(screen.getAllByText(/Anthropic/).length).toBeGreaterThan(0);
  });

  test('lists every data category, including staff and health data', () => {
    renderAt(<Privacy />);
    DATA_CATEGORIES.forEach((c) => {
      expect(screen.getByText(c.title)).toBeInTheDocument();
    });
    expect(screen.getByText(/incapacidades/)).toBeInTheDocument();
  });

  test('refers to PRODHAB as the supervisory authority', () => {
    renderAt(<Privacy />);
    expect(screen.getByText(/PRODHAB/)).toBeInTheDocument();
  });
});
