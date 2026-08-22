import { Link } from 'react-router-dom';
import LegalLayout from '../components/LegalLayout';
import {
  LEGAL_ENTITY,
  LEGAL_ROUTES,
  SUBPROCESSORS,
  NON_PERSONAL_THIRD_PARTIES,
  DATA_CATEGORIES,
} from '../lib/legal';

/**
 * Aurora Privacy Policy.
 *
 * Working draft for review by a lawyer in Costa Rica (Law 8968 and its
 * Regulation, Decree 37554-JP) — see docs/legal.md. The sub-processor list
 * and data categories come from lib/legal.js so the page cannot drift from
 * the real system.
 */
export default function Privacy() {
  const operator = LEGAL_ENTITY.legalName || LEGAL_ENTITY.tradeName;
  const contact = LEGAL_ENTITY.contactEmail
    ? <a href={`mailto:${LEGAL_ENTITY.contactEmail}`}>{LEGAL_ENTITY.contactEmail}</a>
    : <a href={LEGAL_ENTITY.website}>{LEGAL_ENTITY.website.replace(/^https?:\/\//, '')}</a>;

  return (
    <LegalLayout title="Política de privacidad">
      <div className="legal-summary">
        <p><strong>En resumen:</strong> Aurora guarda los datos que tu organización registra para administrar su finca —incluidos datos de su personal— y los usa solo para prestar el servicio. Tu organización es la responsable de esos datos; nosotros los tratamos por encargo. Para funcionar, el servicio se apoya en proveedores de infraestructura (Google) e inteligencia artificial (Anthropic), listados abajo. No vendemos datos ni los usamos para publicidad.</p>
      </div>

      <section id="quien">
        <h2>1. Quién trata tus datos</h2>
        <p>El Servicio Aurora es operado por <strong>{operator}</strong>{LEGAL_ENTITY.taxId ? `, cédula jurídica ${LEGAL_ENTITY.taxId}` : ''}{LEGAL_ENTITY.address ? `, con domicilio en ${LEGAL_ENTITY.address}` : ''}. Contacto para asuntos de privacidad: {contact}.</p>
        <p>Esta política aplica a todos los datos personales tratados a través del Servicio, en dos roles distintos:</p>
        <ul>
          <li><strong>Somos responsables</strong> de los datos de la cuenta de cada Usuario (correo, nombre, credenciales, registros de acceso), necesarios para operar el Servicio y protegerlo.</li>
          <li><strong>Somos encargados</strong> de los datos que la Organización registra sobre su personal, proveedores, compradores y operación. De esos datos, la Organización es la responsable: ella decide qué registra y para qué, y debe informar y obtener el consentimiento de las personas conforme a la Ley N.º 8968.</li>
        </ul>
      </section>

      <section id="datos">
        <h2>2. Qué datos se tratan</h2>
        <dl className="legal-dl">
          {DATA_CATEGORIES.map((c) => (
            <div key={c.title}>
              <dt>{c.title}</dt>
              <dd>{c.detail}</dd>
            </div>
          ))}
        </dl>
        <p>Algunos de estos datos son <strong>sensibles</strong> según la Ley 8968 (por ejemplo, el motivo de una incapacidad médica). La Organización solo debe registrarlos cuando exista una base legal para ello y con el mínimo detalle necesario.</p>
      </section>

      <section id="finalidad">
        <h2>3. Para qué se usan</h2>
        <ul>
          <li>Prestar las funciones del Servicio: planificación de labores, inventario, compras, planilla, cosecha, finanzas y reportes.</li>
          <li>Autenticar a los Usuarios, controlar el acceso por rol y registrar acciones relevantes (bitácora de auditoría) por seguridad y trazabilidad.</li>
          <li>Generar respuestas, lecturas automáticas y recomendaciones mediante inteligencia artificial, cuando el Usuario usa esas funciones.</li>
          <li>Enviar notificaciones dentro del Servicio y notificaciones push a los dispositivos que el Usuario haya activado.</li>
          <li>Realizar copias de seguridad, detectar abuso y cumplir obligaciones legales.</li>
        </ul>
        <p>No usamos datos personales para publicidad, no los vendemos y no los cedemos a terceros distintos de los subencargados listados en la sección 5.</p>
      </section>

      <section id="ia">
        <h2>4. Inteligencia artificial</h2>
        <p>Cuando un Usuario escribe al asistente, adjunta una imagen o solicita un análisis, el contenido enviado y el contexto operativo de la finca necesario para responder (catálogos de lotes, productos, maquinaria y labores, y la lista de personal con nombre y rol) se transmiten a <strong>Anthropic, PBC</strong> para generar la respuesta. El asistente muestra un aviso visible de este tratamiento.</p>
        <ul>
          <li>Conforme a los términos comerciales vigentes de Anthropic, los datos enviados por API no se utilizan para entrenar sus modelos.</li>
          <li>Las salidas de la IA son sugerencias que el Usuario debe verificar antes de actuar. Ninguna decisión sobre una persona (contratación, evaluación, pago) se toma de forma exclusivamente automatizada: el sistema propone y un humano decide.</li>
        </ul>
      </section>

      <section id="subencargados">
        <h2>5. Subencargados y terceros</h2>
        <p>Para prestar el Servicio nos apoyamos en los siguientes proveedores, que tratan datos personales por cuenta nuestra bajo contratos que les exigen confidencialidad y medidas de seguridad equivalentes:</p>
        <div className="legal-table-wrap">
          <table className="legal-table">
            <thead>
              <tr>
                <th>Proveedor</th>
                <th>País</th>
                <th>Propósito</th>
                <th>Datos que recibe</th>
              </tr>
            </thead>
            <tbody>
              {SUBPROCESSORS.map((s) => (
                <tr key={s.name}>
                  <td>{s.name}</td>
                  <td>{s.country}</td>
                  <td>{s.purpose}</td>
                  <td>{s.data}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>Además, el Servicio consulta proveedores que <strong>no reciben datos personales</strong>:</p>
        <ul>
          {NON_PERSONAL_THIRD_PARTIES.map((t) => (
            <li key={t.name}><strong>{t.name}</strong>: {t.purpose}</li>
          ))}
        </ul>
        <p>Si incorporamos un nuevo subencargado que trate datos personales, actualizaremos esta lista y, cuando el cambio sea relevante, avisaremos a los administradores de cada Organización con antelación.</p>
      </section>

      <section id="transferencias">
        <h2>6. Transferencias internacionales</h2>
        <p>Nuestros proveedores de infraestructura e inteligencia artificial alojan y procesan los datos en Estados Unidos. La transferencia se realiza para la prestación del Servicio contratado, con medidas contractuales y técnicas de protección (cifrado en tránsito y en reposo, control de acceso, registros de auditoría). Al aceptar los Términos, la Organización autoriza estas transferencias como parte del encargo de tratamiento.</p>
      </section>

      <section id="conservacion">
        <h2>7. Cuánto tiempo se conservan</h2>
        <ul>
          <li>Los datos se conservan mientras la Organización mantenga su cuenta activa. La Organización puede rectificar o eliminar registros individuales en cualquier momento desde el Servicio, con excepción de la bitácora de auditoría, que se conserva por seguridad y trazabilidad.</li>
          <li>Al eliminar una Organización, sus datos se borran de los sistemas activos y desaparecen de las copias de seguridad al vencer su período de retención.</li>
          <li>Podemos conservar datos por más tiempo cuando una obligación legal lo exija.</li>
        </ul>
      </section>

      <section id="seguridad">
        <h2>8. Seguridad</h2>
        <p>Aplicamos medidas técnicas y organizativas proporcionales al riesgo: cifrado en tránsito y en reposo, autenticación con correo verificado, control de acceso por rol y por organización, aislamiento de datos entre organizaciones, límites de tasa, bitácora de auditoría de acciones sensibles, copias de seguridad periódicas y protección del sitio contra uso automatizado. Ningún sistema es infalible; si detectamos un incidente de seguridad que afecte datos personales, lo notificaremos a la Organización afectada sin demora indebida.</p>
      </section>

      <section id="derechos">
        <h2>9. Tus derechos</h2>
        <p>Toda persona cuyos datos se traten a través del Servicio tiene derecho a acceder a ellos, rectificarlos, solicitar su supresión, oponerse a su tratamiento y revocar el consentimiento otorgado, conforme a la Ley 8968. Para ejercerlos:</p>
        <ul>
          <li>Si sos Usuario del Servicio, podés gestionar los datos de tu cuenta desde tu perfil o escribirnos a {contact}.</li>
          <li>Si sos empleado, proveedor o comprador de una Organización que usa Aurora, dirigí tu solicitud a esa Organización, que es la responsable de tus datos. Si nos la enviás a nosotros, la remitiremos a la Organización y la asistiremos para responder.</li>
        </ul>
        <p>Si considerás que tus derechos no fueron atendidos, podés acudir a la Agencia de Protección de Datos de los Habitantes (PRODHAB) de Costa Rica.</p>
      </section>

      <section id="cookies">
        <h2>10. Cookies y almacenamiento local</h2>
        <p>El Servicio usa almacenamiento local del navegador para mantener la sesión, recordar preferencias de interfaz (módulos favoritos, columnas visibles, borradores de formularios) y registrar suscripciones a notificaciones push. No usamos cookies de seguimiento ni de publicidad de terceros.</p>
      </section>

      <section id="cambios">
        <h2>11. Cambios a esta política</h2>
        <p>Cada versión de esta política lleva fecha y número de versión al inicio. Si el cambio es relevante —por ejemplo, un nuevo subencargado o una nueva finalidad— lo comunicaremos dentro del Servicio o por correo a los administradores con al menos 15 días de antelación.</p>
        <p>Ver también los <Link to={LEGAL_ROUTES.terms}>Términos del servicio</Link>.</p>
      </section>
    </LegalLayout>
  );
}
