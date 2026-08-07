// Unit: DocBrand + IdentityNotice (bloque de marca de documentos imprimibles).
import { describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DocBrand, IdentityNotice } from '../docs/DocBrand';
import { resolveEmpresa } from '../../lib/empresa';

const empresaDe = (config, fincaNombre = '') => resolveEmpresa(config, fincaNombre);

describe('DocBrand', () => {
  test('renderiza nombre, subs con clases del prefijo y logo saneado', () => {
    const empresa = empresaDe({
      nombreEmpresa: 'Hacienda El Roble',
      identificacion: '3-101-123456',
      whatsapp: '8888-8888',
      logoUrl: 'https://x.com/logo.png',
    });
    const { container } = render(<DocBrand classPrefix="po-doc" empresa={empresa} />);
    expect(screen.getByText('Hacienda El Roble')).toHaveClass('po-doc-brand-name');
    expect(screen.getByText('Cédula: 3-101-123456')).toHaveClass('po-doc-brand-sub');
    expect(container.querySelector('img.po-doc-logo-img')).toHaveAttribute('src', 'https://x.com/logo.png');
    expect(container.querySelector('img')).toHaveAttribute('crossorigin', 'anonymous');
  });

  test('logo inseguro cae a iniciales — jamás llega al <img>', () => {
    const empresa = empresaDe({ nombreEmpresa: 'Hacienda El Roble', logoUrl: 'javascript:alert(1)' });
    const { container } = render(<DocBrand classPrefix="gp-doc" empresa={empresa} />);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('HR')).toHaveClass('gp-doc-logo');
  });

  test('uppercaseName no revienta con nombre ausente (trampa SiembraHistorial)', () => {
    const empresa = empresaDe({}, '');
    const { container } = render(<DocBrand classPrefix="pr-doc" empresa={empresa} boxedLogo uppercaseName />);
    expect(container.querySelector('.pr-doc-brand-name')).toBeInTheDocument();
  });

  test('cascada: sin nombreEmpresa muestra la organización, nunca el literal de pruebas', () => {
    const empresa = empresaDe({}, 'Cooperativa La Loma');
    const { container } = render(<DocBrand classPrefix="ca-doc" empresa={empresa} />);
    expect(screen.getByText('Cooperativa La Loma')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/Finca\s+Aurora/);
  });
});

describe('IdentityNotice', () => {
  test('visible solo cuando falta la identidad, con enlace a configuración', () => {
    const { rerender } = render(
      <MemoryRouter><IdentityNotice show /></MemoryRouter>
    );
    const note = screen.getByRole('note');
    expect(note).toHaveAttribute('data-html2canvas-ignore', 'true');
    expect(screen.getByRole('link')).toHaveAttribute('href', '/config/cuenta');

    rerender(<MemoryRouter><IdentityNotice show={false} /></MemoryRouter>);
    expect(screen.queryByRole('note')).toBeNull();
  });
});
