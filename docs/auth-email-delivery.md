# Auth email delivery and the support safety net

The `email_verified` gate in [functions/lib/middleware.js](../functions/lib/middleware.js)
is correct and stays: an account whose email was never verified cannot call
the API. What this document covers is everything *around* that gate, so a
user whose verification email lands in spam is not locked out of the product
and out of reach.

## 1. What exists in the product

| Piece | Where |
|---|---|
| Support footnote on every auth screen (login, password login, sign-up, verify email, password reset, organization selector, new organization) | [SupportLink.jsx](../src/features/auth/components/SupportLink.jsx), rendered by [AuthCard.jsx](../src/features/auth/components/AuthCard.jsx) |
| Channels and sender address, per environment | [src/lib/support.js](../src/lib/support.js) ← `VITE_SUPPORT_EMAIL`, `VITE_SUPPORT_WHATSAPP`, `VITE_AUTH_EMAIL_SENDER` in `.env` |
| "The email is not arriving" block on the verify screen: sender address to search for, spam/promotions tip, wait hint, switch email, contact support with the account email pre-filled | [VerifyEmail.jsx](../src/features/auth/pages/VerifyEmail.jsx) |

While `VITE_SUPPORT_EMAIL` and `VITE_SUPPORT_WHATSAPP` are both empty the
footnote falls back to a link to comunplace.com. That is a floor, not the
fix: **set a real mailbox** (a shared inbox someone reads daily) and rebuild.
The mailto/WhatsApp links pre-fill the subject with the screen the user was
stuck on and the account email, so the first support message is actionable.

### How a stuck user gets out today

1. Verify screen tells them the sender address to search for and to check
   spam / promotions, and to mark it "not spam".
2. "Reenviar correo" (60 s cooldown; Firebase throttles harder than that).
3. "Usar otro correo" — signs out and lets them register with an address
   that does receive mail.
4. Support contact with the account email already in the message. Support
   can then verify the address from the Firebase console (Authentication →
   Users → ⋮ → *Mark email as verified*) or via Admin SDK
   `auth.updateUser(uid, { emailVerified: true })` **after** confirming
   identity out of band (the person answers from the same address, or the
   organization administrator confirms they invited them).

## 2. Why the default sender is the weak point

Firebase Auth emails go out from `noreply@aurora-7dc9b.firebaseapp.com`
through Firebase's shared infrastructure. Deliverability is average at best
and we control none of it: no SPF/DKIM on a domain we own, a shared sending
reputation, and a from-address that looks nothing like aurora.comunplace.com.
Sign-up verification and password reset both depend on it. The domain move
to aurora.comunplace.com makes this worse for a while: every user whose
session expires or who changes browsers goes through password reset at once.

Check the current state: Firebase console → Authentication → Templates →
*SMTP settings* (empty = default sender) and the *From* address on each
template.

## 3. Own sender: provider + DNS + warm-up

Target: send from `no-reply@mail.aurora.comunplace.com` (a dedicated
subdomain so Aurora's reputation never drags down comunplace.com's own mail)
through a transactional provider with SPF, DKIM and DMARC published.

### 3.1 Provider

Any transactional SMTP provider works with Firebase (it only needs host,
port, user, password and a from-address). Pick by what the company already
pays for; if none: Brevo, Postmark, Resend or SendGrid all have a free or
near-free tier that covers Aurora's volume for years. Create the account
with a company login, not a personal one, and store the SMTP password in the
password manager next to the Auth hash parameters
([firestore-backups.md](firestore-backups.md) §2.4).

### 3.2 DNS (at the comunplace.com registrar)

The provider's dashboard gives the exact values; the shape is:

| Record | Host | Value |
|---|---|---|
| TXT (SPF) | `mail.aurora.comunplace.com` | `v=spf1 include:<provider-spf> -all` |
| CNAME ×2–3 (DKIM) | `<selector>._domainkey.mail.aurora.comunplace.com` | provider-supplied |
| TXT (DMARC) | `_dmarc.mail.aurora.comunplace.com` | `v=DMARC1; p=none; rua=mailto:<reports mailbox>` |
| CNAME (return-path, if the provider asks) | `bounce.mail.aurora.comunplace.com` | provider-supplied |

Start DMARC at `p=none` and read the reports for two weeks; move to
`p=quarantine` once every legitimate source is aligned. Do not put the
subdomain's SPF on the apex `comunplace.com` record — unrelated senders
there (Google Workspace, marketing tools) have their own policy.

### 3.3 Firebase side

Authentication → Templates → *SMTP settings*: host, port (587 STARTTLS or
465 TLS), user, password, from `no-reply@mail.aurora.comunplace.com`,
sender name `Aurora`. Then, on each template (verification, password reset,
email change), confirm the *Action URL* points at
`https://aurora.comunplace.com/__/auth/action` (or the in-app handler) and
that `aurora.comunplace.com` is in *Authorized domains*. Send yourself a
verification email from a fresh sign-up and a password reset; check the
headers show `dkim=pass spf=pass dmarc=pass`.

Finally set `VITE_AUTH_EMAIL_SENDER=no-reply@mail.aurora.comunplace.com` in
`.env` and rebuild, so the verify screen tells users the right address to
search for.

### 3.4 Warm-up before opening sign-ups

A brand-new sending subdomain has no reputation; the first hundred emails
decide it. Before announcing public registration:

1. Week 1: only internal accounts and the existing customers' users
   (sign-up, reset, re-verification). Aim for a few messages per day, all
   opened.
2. Week 2: invite the next batch; watch the provider's bounce and spam
   complaint rates (keep both under 1 %) and the DMARC reports.
3. Only then the public landing's "Crear cuenta" goes live at volume.

If the provider offers an automatic warm-up schedule, use it.

## 4. Checklist

- [ ] `VITE_SUPPORT_EMAIL` (and optionally `VITE_SUPPORT_WHATSAPP`) set in `.env`; rebuilt and deployed.
- [ ] Someone owns the support inbox and checks it daily.
- [ ] Provider account created with a company login; SMTP password in the password manager.
- [ ] SPF, DKIM, DMARC (`p=none`) published on `mail.aurora.comunplace.com`; provider dashboard shows all verified.
- [ ] Firebase SMTP settings + from-address configured; action URL and authorized domains point at `aurora.comunplace.com`.
- [ ] Test sign-up and password reset land in inbox with `dkim=pass spf=pass dmarc=pass`.
- [ ] `VITE_AUTH_EMAIL_SENDER` updated; rebuilt and deployed.
- [ ] Warm-up done before public sign-ups; DMARC moved to `p=quarantine` after two clean weeks.
