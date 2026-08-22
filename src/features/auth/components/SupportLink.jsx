import {
  SUPPORT_EMAIL,
  SUPPORT_WHATSAPP,
  SUPPORT_FALLBACK_URL,
  hasDirectSupport,
  formatWhatsapp,
  supportMailto,
  supportWhatsappUrl,
} from '../../../lib/support';

/**
 * Support footnote for the auth screens. Rendered by AuthCard so every
 * screen a locked-out user can reach (login, sign-up, verify email, reset
 * password, organization selection) shows a way to contact a human.
 *
 * `context` pre-fills the subject/message so the support request arrives
 * with the user's email and the screen they were stuck on.
 */
export default function SupportLink({ context = '', email = '' }) {
  const subject = context ? `Aurora — ${context}` : 'Aurora — ayuda para entrar';
  const body = email ? `Correo de mi cuenta: ${email}\n\n` : '';

  if (!hasDirectSupport()) {
    return (
      <p className="auth-support" role="contentinfo">
        ¿Problemas para entrar?{' '}
        <a href={SUPPORT_FALLBACK_URL} target="_blank" rel="noopener">Contactá a comunplace</a>.
      </p>
    );
  }

  return (
    <p className="auth-support" role="contentinfo">
      ¿Problemas para entrar? Escribinos
      {SUPPORT_EMAIL && (
        <>
          {' '}a <a href={supportMailto({ subject, body })}>{SUPPORT_EMAIL}</a>
        </>
      )}
      {SUPPORT_EMAIL && SUPPORT_WHATSAPP && ' o'}
      {SUPPORT_WHATSAPP && (
        <>
          {' '}por WhatsApp al{' '}
          <a href={supportWhatsappUrl(`${subject}. ${body}`.trim())} target="_blank" rel="noopener">
            {formatWhatsapp(SUPPORT_WHATSAPP)}
          </a>
        </>
      )}
      .
    </p>
  );
}
