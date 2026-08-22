import { describe, test, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// The support footnote is the only way out for a user stuck before the
// email-verified gate. Protected: it always renders SOMETHING (fallback link
// when no channel is configured), and when channels are configured the links
// carry the user's email + context so support gets an actionable message.
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function renderWith(env, props = {}) {
  Object.entries(env).forEach(([k, v]) => vi.stubEnv(k, v));
  const { default: SupportLink } = await import('../SupportLink');
  return render(<SupportLink {...props} />);
}

describe('<SupportLink />', () => {
  test('without configured channels falls back to the comunplace link', async () => {
    await renderWith({ VITE_SUPPORT_EMAIL: '', VITE_SUPPORT_WHATSAPP: '' });
    const a = screen.getByRole('link', { name: /Contactá a comunplace/ });
    expect(a).toHaveAttribute('href', 'https://comunplace.com');
  });

  test('email channel: mailto with context subject and account email in body', async () => {
    await renderWith(
      { VITE_SUPPORT_EMAIL: 'soporte@example.com', VITE_SUPPORT_WHATSAPP: '' },
      { context: 'no recibo el correo de verificación', email: 'ana@finca.cr' },
    );
    const a = screen.getByRole('link', { name: 'soporte@example.com' });
    const href = decodeURIComponent(a.getAttribute('href').replace(/\+/g, ' '));
    expect(href.startsWith('mailto:soporte@example.com?')).toBe(true);
    expect(href).toContain('subject=Aurora — no recibo el correo de verificación');
    expect(href).toContain('Correo de mi cuenta: ana@finca.cr');
    expect(screen.queryByText(/WhatsApp/)).toBeNull();
  });

  test('whatsapp channel: wa.me link with formatted CR number', async () => {
    await renderWith({ VITE_SUPPORT_EMAIL: '', VITE_SUPPORT_WHATSAPP: '+506 8888-7777' });
    const a = screen.getByRole('link', { name: '+506 8888 7777' });
    expect(a.getAttribute('href').startsWith('https://wa.me/50688887777')).toBe(true);
  });

  test('both channels render joined by "o"', async () => {
    await renderWith({ VITE_SUPPORT_EMAIL: 'soporte@example.com', VITE_SUPPORT_WHATSAPP: '50688887777' });
    expect(screen.getByRole('contentinfo').textContent).toMatch(/soporte@example\.com o por WhatsApp al \+506 8888 7777\./);
  });
});
