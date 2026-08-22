# Términos, privacidad y consentimiento

Estado: **borrador técnico listo para revisión legal**. El código está completo;
el texto lo tiene que aprobar un abogado en Costa Rica antes de cobrarle a un
tercero. Hasta entonces `LEGAL_REVIEW_PENDING = true` muestra un aviso de
"versión preliminar" en las páginas.

## 1. Qué hay

| Pieza | Dónde |
|---|---|
| Textos y constantes (versión, operador, subencargados, categorías de datos) | [src/features/legal/lib/legal.js](../src/features/legal/lib/legal.js) |
| Página pública `/terminos` | [src/features/legal/pages/Terminos.jsx](../src/features/legal/pages/Terminos.jsx) |
| Página pública `/privacidad` | [src/features/legal/pages/Privacidad.jsx](../src/features/legal/pages/Privacidad.jsx) |
| Checkbox de consentimiento (crear organización) | [src/features/legal/components/LegalConsent.jsx](../src/features/legal/components/LegalConsent.jsx), usado por `FincaForm` |
| Aviso pasivo al crear cuenta (paso 1 de `/register`) | [src/features/auth/pages/Register.jsx](../src/features/auth/pages/Register.jsx) |
| Persistencia de la aceptación | `POST /api/auth/register-finca` → `fincas/{id}.aceptacionLegal = { version, aceptadoPorUid, email, fecha }` |
| Aviso de IA en el asistente | [src/components/AuroraChat.jsx](../src/components/AuroraChat.jsx) |
| Enlaces en el pie de la landing | [src/features/landing/components/LandingFooter.jsx](../src/features/landing/components/LandingFooter.jsx) |

El backend rechaza `register-finca` sin `aceptaTerminos: true` y
`legalVersion: 'YYYY-MM-DD'` con `400 TERMS_NOT_ACCEPTED`. La aceptación se
guarda en el doc de la finca (no en la membresía) porque el contrato de encargo
es entre la **organización** y Aurora; el uid y el correo de quien aceptó
quedan como evidencia de autoría. El evento de auditoría `FINCA_CREATE`
también registra `legalVersion`.

## 2. Qué tiene que completar la empresa (no es código)

En `LEGAL_ENTITY` de `legal.js` hay cuatro campos en `null`. Mientras lo estén,
las páginas los omiten en vez de inventarlos:

- `razonSocial` — razón social registrada del operador.
- `cedulaJuridica` — cédula jurídica.
- `domicilio` — domicilio legal.
- `correoContacto` — buzón real para solicitudes de privacidad (derechos ARCO).
  Hoy las páginas remiten a comunplace.com; una política sin correo de
  contacto es una observación típica de PRODHAB.

## 3. Qué debe revisar el abogado

Marco: Ley N.º 8968 (Protección de la Persona frente al Tratamiento de sus
Datos Personales) y su Reglamento (Decreto 37554-JP); autoridad: PRODHAB.

1. **Roles.** El borrador declara a la finca como *responsable* de los datos de
   su personal/proveedores y a Aurora como *encargado* (Términos §6,
   Privacidad §1). La aceptación al crear la organización se presenta como el
   contrato de encargo. Confirmar si basta o si se requiere un anexo separado.
2. **Datos sensibles.** `hr_permisos.tipo === 'enfermedad'` lleva motivo en
   texto libre. Privacidad §2 lo declara y pide mínimo detalle; decidir si
   además se restringe en producto (p. ej. lista cerrada de motivos).
3. **Transferencia internacional.** Google y Anthropic procesan en EE.UU.
   (Privacidad §6). Confirmar la base (consentimiento del responsable vía
   Términos) y si hace falta inscripción de base de datos ante PRODHAB.
4. **Anthropic y entrenamiento.** El texto afirma que, conforme a los términos
   comerciales vigentes de Anthropic, los datos de API no se usan para
   entrenar. Verificar contra el contrato/terms vigentes al momento de publicar.
5. **Decisiones automatizadas.** Privacidad §4 afirma que ninguna decisión
   sobre personas es exclusivamente automatizada. Es cierto hoy (el agente de
   RRHH solo propone; ver `project_hr_domain_security_audit`). Si se habilita
   Nivel 3 en RRHH, este párrafo deja de ser verdad.
6. **Limitación de responsabilidad y ley aplicable** (Términos §10, §12).
7. **Plazo de aviso de cambios** (15 días en ambos documentos).
8. **Retención en backups.** Los textos dicen "al vencer su período de
   retención" sin cifra; poner la real de
   [firestore-backups.md](firestore-backups.md) cuando esté fijada.

## 4. Cómo publicar una nueva versión

1. Editar el texto en la página correspondiente.
2. Subir `LEGAL_VERSION` en `legal.js` a la fecha ISO del cambio.
3. Si cambia la lista de proveedores que reciben datos personales, editar
   `SUBPROCESSORS` — la política promete esa lista como exhaustiva y el test
   `Legal.test.jsx` verifica que la página la renderice completa.
4. Cuando el abogado apruebe: `LEGAL_REVIEW_PENDING = false`.
5. Cambio relevante → aviso a administradores con ≥15 días (compromiso de
   Términos §11 / Privacidad §11). No existe aún un mecanismo automático de
   re-aceptación; ver §5.

## 5. Pendientes conocidos (fuera de este cambio)

- **Fincas creadas antes de esta versión** no tienen `aceptacionLegal`. Hace
  falta un flujo de re-aceptación para administradores (modal al entrar si
  `aceptacionLegal.version < LEGAL_VERSION`). Hasta entonces, la aceptación de
  clientes existentes debe recogerse por otro medio.
- **Minimización hacia Anthropic.** El catálogo del chat
  ([functions/routes/chat/catalogs.js](../functions/routes/chat/catalogs.js))
  manda la lista de personal con nombre y rol en cada turno. Es lo que la
  política declara; reducirlo (solo cuando la consulta lo requiera) es mejora
  de producto, no requisito legal.
- **Exportación de datos** (Términos §5 promete "copia en formato de uso
  común"): hoy es manual vía backups; no hay botón de exportar.
