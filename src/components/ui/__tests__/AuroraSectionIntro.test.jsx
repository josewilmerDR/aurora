import { describe, test, expect } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import AuroraSectionIntro from '../AuroraSectionIntro';

describe('<AuroraSectionIntro />', () => {
  test('renderiza el texto principal', () => {
    const { getByText } = render(
      <AuroraSectionIntro>Frase introductoria.</AuroraSectionIntro>
    );
    expect(getByText('Frase introductoria.')).toBeInTheDocument();
  });

  test('por defecto muestra el icono FiInfo', () => {
    const { container } = render(
      <AuroraSectionIntro>Texto</AuroraSectionIntro>
    );
    expect(container.querySelector('.aur-section-intro-icon')).toBeInTheDocument();
  });

  test('icon={null} oculta el icono', () => {
    const { container } = render(
      <AuroraSectionIntro icon={null}>Texto</AuroraSectionIntro>
    );
    expect(container.querySelector('.aur-section-intro-icon')).toBeNull();
  });

  test('sin expanderContent no renderiza el toggle', () => {
    const { container } = render(
      <AuroraSectionIntro>Texto sin detalle.</AuroraSectionIntro>
    );
    expect(container.querySelector('.aur-section-intro-toggle')).toBeNull();
  });

  test('con expanderContent renderiza el toggle colapsado por defecto', () => {
    const { getByRole, queryByText } = render(
      <AuroraSectionIntro expanderContent={<p>Detalle técnico.</p>}>
        Texto
      </AuroraSectionIntro>
    );
    const toggle = getByRole('button');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(queryByText('Detalle técnico.')).toBeNull();
  });

  test('click en el toggle expande y revela el contenido', () => {
    const { getByRole, getByText, queryByText } = render(
      <AuroraSectionIntro expanderContent={<p>Detalle técnico.</p>}>
        Texto
      </AuroraSectionIntro>
    );
    const toggle = getByRole('button');
    expect(queryByText('Detalle técnico.')).toBeNull();

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(getByText('Detalle técnico.')).toBeInTheDocument();
  });

  test('defaultOpen=true arranca expandido', () => {
    const { getByRole, getByText } = render(
      <AuroraSectionIntro
        defaultOpen
        expanderContent={<p>Visible desde el inicio.</p>}
      >
        Texto
      </AuroraSectionIntro>
    );
    expect(getByRole('button')).toHaveAttribute('aria-expanded', 'true');
    expect(getByText('Visible desde el inicio.')).toBeInTheDocument();
  });

  test('expanderLabel custom se refleja en el botón', () => {
    const { getByText } = render(
      <AuroraSectionIntro
        expanderLabel="Más info"
        expanderContent={<p>x</p>}
      >
        Texto
      </AuroraSectionIntro>
    );
    expect(getByText('Más info')).toBeInTheDocument();
  });

  test('aria-controls del toggle apunta al id del contenido', () => {
    const { getByRole, container } = render(
      <AuroraSectionIntro
        defaultOpen
        expanderContent={<p>Body</p>}
      >
        Texto
      </AuroraSectionIntro>
    );
    const toggle = getByRole('button');
    const controlsId = toggle.getAttribute('aria-controls');
    expect(controlsId).toBeTruthy();
    expect(container.querySelector(`#${CSS.escape(controlsId)}`)).toBeInTheDocument();
  });
});
