# Terms, privacy and consent

Status: **technical draft ready for legal review**. The code is complete; the
text must be approved by a lawyer in Costa Rica before charging any third
party. Until then `LEGAL_REVIEW_PENDING = true` shows a "preliminary version"
notice on the pages.

## 1. What exists

| Piece | Where |
|---|---|
| Texts and constants (version, operator, sub-processors, data categories) | [src/features/legal/lib/legal.js](../src/features/legal/lib/legal.js) |
| Public page `/terms` | [src/features/legal/pages/Terms.jsx](../src/features/legal/pages/Terms.jsx) |
| Public page `/privacy` | [src/features/legal/pages/Privacy.jsx](../src/features/legal/pages/Privacy.jsx) |
| Consent checkbox (create organization) | [src/features/legal/components/LegalConsent.jsx](../src/features/legal/components/LegalConsent.jsx), used by `FincaForm` |
| Passive notice on account creation (`/register` step 1) | [src/features/auth/pages/Register.jsx](../src/features/auth/pages/Register.jsx) |
| Acceptance persistence | `POST /api/auth/register-finca` → `fincas/{id}.legalAcceptance = { version, acceptedByUid, email, acceptedAt }` |
| AI notice in the assistant | [src/components/AuroraChat.jsx](../src/components/AuroraChat.jsx) |
| Links in the landing footer | [src/features/landing/components/LandingFooter.jsx](../src/features/landing/components/LandingFooter.jsx) |

The backend rejects `register-finca` without `acceptsTerms: true` and
`legalVersion: 'YYYY-MM-DD'` with `400 TERMS_NOT_ACCEPTED`. The acceptance is
stored on the finca document (not the membership) because the processing
mandate is between the **organization** and Aurora; the uid and email of the
person who accepted remain as evidence of authorship. The `FINCA_CREATE` audit
event also records `legalVersion`.

User-facing text (page content, checkbox label, chat notice) stays in Spanish
on purpose: the product serves Costa Rican farms. Code, comments, routes and
this document are English per the repo convention.

## 2. What the company must fill in (not code)

`LEGAL_ENTITY` in `legal.js` has four fields set to `null`. While they are,
the pages omit them instead of inventing them:

- `legalName` — registered legal name of the operator.
- `taxId` — cédula jurídica.
- `address` — legal address.
- `contactEmail` — real mailbox for privacy requests (ARCO rights). Today the
  pages fall back to comunplace.com; a policy without a contact email is a
  typical PRODHAB observation.

## 3. What the lawyer must review

Framework: Law No. 8968 (Protección de la Persona frente al Tratamiento de sus
Datos Personales) and its Regulation (Decree 37554-JP); authority: PRODHAB.

1. **Roles.** The draft declares the finca as *controller* of its staff and
   supplier data and Aurora as *processor* (Terms §6, Privacy §1). Acceptance
   at organization creation is presented as the processing mandate. Confirm
   whether that suffices or a separate annex is required.
2. **Sensitive data.** `hr_permisos.tipo === 'enfermedad'` carries a free-text
   reason. Privacy §2 discloses it and asks for minimum detail; decide whether
   the product should also restrict it (e.g. a closed list of reasons).
3. **International transfer.** Google and Anthropic process in the US
   (Privacy §6). Confirm the legal basis (controller consent via Terms) and
   whether a database registration with PRODHAB is needed.
4. **Anthropic and training.** The text states that, under Anthropic's current
   commercial terms, API data is not used for training. Verify against the
   contract/terms in force at publication time.
5. **Automated decisions.** Privacy §4 states no decision about people is
   solely automated. True today (the HR agent only proposes; see
   `project_hr_domain_security_audit`). If HR Level 3 is enabled, that
   paragraph stops being true.
6. **Limitation of liability and governing law** (Terms §10, §12).
7. **Notice period for changes** (15 days in both documents).
8. **Backup retention.** The texts say "when its retention period expires"
   without a number; put the real one from
   [firestore-backups.md](firestore-backups.md) once fixed.

## 4. How to publish a new version

1. Edit the text on the relevant page.
2. Bump `LEGAL_VERSION` in `legal.js` to the ISO date of the change.
3. If the list of vendors receiving personal data changes, edit
   `SUBPROCESSORS` — the policy promises that list as exhaustive and
   `Legal.test.jsx` checks the page renders it in full.
4. When the lawyer approves: `LEGAL_REVIEW_PENDING = false`.
5. Material change → notify administrators ≥15 days ahead (commitment in
   Terms §11 / Privacy §11). There is no automatic re-acceptance mechanism
   yet; see §5.

## 5. Known follow-ups (outside this change)

- **Fincas created before this version** have no `legalAcceptance`. A
  re-acceptance flow for administrators is needed (modal on entry when
  `legalAcceptance.version < LEGAL_VERSION`). Until then, acceptance from
  existing customers must be collected by other means.
- **Minimization toward Anthropic.** The chat catalog
  ([functions/routes/chat/catalogs.js](../functions/routes/chat/catalogs.js))
  sends the staff list with name and role on every turn. That is what the
  policy discloses; reducing it (only when the query needs it) is a product
  improvement, not a legal requirement.
- **Data export** (Terms §5 promises "a copy in a common format"): today it is
  manual via backups; there is no export button.
