// Support channels shown on the auth screens (login, sign-up, verify email,
// password reset). These screens are the only place where a user who cannot
// get in can still reach us, so the contact must be visible there even if
// nothing else in the product offers support.
//
// Configured per environment, not hardcoded: set VITE_SUPPORT_EMAIL and/or
// VITE_SUPPORT_WHATSAPP in .env (see .env.example) and rebuild. While both
// are empty the UI falls back to the comunplace directory link so the user
// always has *some* path out — but a real mailbox is the fix, not the
// fallback (docs/auth-email-delivery.md).

import { DIRECTORY_URL } from './ecosystem';

const env = import.meta.env || {};

// Sender of Firebase Auth emails (verification, password reset). Shown on the
// verify screen so the user can search their inbox / spam for it. Firebase's
// default is noreply@<project-id>.firebaseapp.com; override once a custom
// SMTP sender is configured (docs/auth-email-delivery.md §3).
export const AUTH_EMAIL_SENDER = (env.VITE_AUTH_EMAIL_SENDER || '').trim() || 'noreply@aurora-7dc9b.firebaseapp.com';

export const SUPPORT_EMAIL = (env.VITE_SUPPORT_EMAIL || '').trim();
// Digits only, with country code, e.g. 50688887777 → https://wa.me/50688887777
export const SUPPORT_WHATSAPP = (env.VITE_SUPPORT_WHATSAPP || '').replace(/\D/g, '');
export const SUPPORT_FALLBACK_URL = DIRECTORY_URL;

export function hasDirectSupport() {
  return Boolean(SUPPORT_EMAIL || SUPPORT_WHATSAPP);
}

export function formatWhatsapp(digits) {
  if (!digits) return '';
  // +506 8888 7777 style for Costa Rica; generic "+<digits>" otherwise.
  if (digits.length === 11 && digits.startsWith('506')) {
    return `+506 ${digits.slice(3, 7)} ${digits.slice(7)}`;
  }
  return `+${digits}`;
}

export function supportMailto({ subject = '', body = '' } = {}) {
  if (!SUPPORT_EMAIL) return '';
  const params = new URLSearchParams();
  if (subject) params.set('subject', subject);
  if (body) params.set('body', body);
  const qs = params.toString();
  return `mailto:${SUPPORT_EMAIL}${qs ? `?${qs}` : ''}`;
}

export function supportWhatsappUrl(text = '') {
  if (!SUPPORT_WHATSAPP) return '';
  const qs = text ? `?text=${encodeURIComponent(text)}` : '';
  return `https://wa.me/${SUPPORT_WHATSAPP}${qs}`;
}
