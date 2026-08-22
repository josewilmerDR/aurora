import { Link } from 'react-router-dom';
import LegalLayout from '../components/LegalLayout';
import { LEGAL_ENTITY, LEGAL_ROUTES } from '../lib/legal';

/**
 * Términos del servicio de Aurora.
 *
 * Borrador de trabajo para revisión por un abogado en Costa Rica — ver
 * docs/legal.md. El texto evita prometer lo que el producto no hace (no hay
 * SLA, no hay demo, la IA propone y el humano decide) y deja explícito el
 * reparto de responsabilidades sobre los datos del personal de la finca.
 */
export default function Terminos() {
  const operador = LEGAL_ENTITY.razonSocial || LEGAL_ENTITY.nombreComercial;

  return (
    <LegalLayout title="Términos del servicio">
      <div className="legal-summary">
        <p><strong>En resumen:</strong> Aurora es un software de gestión para fincas que {operador} ofrece a organizaciones agrícolas. Al crear una organización aceptás estos términos en su nombre. Los datos que cargás son tuyos; nosotros los tratamos solo para prestarte el servicio. Las funciones de inteligencia artificial proponen, no deciden: la responsabilidad final de cada acción en tu finca sigue siendo tuya.</p>
      </div>

      <section id="definiciones">
        <h2>1. Quiénes somos y qué regulan estos términos</h2>
        <p>Aurora («el Servicio») es operado por <strong>{operador}</strong>{LEGAL_ENTITY.cedulaJuridica ? `, cédula jurídica ${LEGAL_ENTITY.cedulaJuridica}` : ''}{LEGAL_ENTITY.domicilio ? `, con domicilio en ${LEGAL_ENTITY.domicilio}` : ''} («nosotros»). Estos términos regulan el acceso y uso del Servicio por parte de la organización que crea una cuenta («la Organización» o «vos») y de las personas que esa Organización autoriza a usarlo («Usuarios»).</p>
        <p>El tratamiento de datos personales se describe en la <Link to={LEGAL_ROUTES.privacidad}>Política de privacidad</Link>, que forma parte integral de estos términos.</p>
      </section>

      <section id="cuenta">
        <h2>2. Cuenta y organización</h2>
        <ul>
          <li>Para usar el Servicio necesitás una cuenta con correo verificado (o una cuenta de Google) y pertenecer a una Organización.</li>
          <li>Quien crea una Organización declara ser mayor de edad y tener autoridad para aceptar estos términos en nombre de ella, incluido el encargo de tratamiento de datos descrito en la sección 6.</li>
          <li>El administrador de la Organización decide qué personas acceden, con qué rol y a qué módulos. Sos responsable de mantener esa lista al día y de retirar el acceso a quien deje de necesitarlo.</li>
          <li>Cada Usuario es responsable de la confidencialidad de sus credenciales y de lo que se haga con su cuenta.</li>
        </ul>
      </section>

      <section id="uso">
        <h2>3. Uso aceptable</h2>
        <p>Te comprometés a usar el Servicio únicamente para la gestión legítima de tu actividad agrícola. En particular, no podés:</p>
        <ul>
          <li>Cargar datos de personas sin tener base legal para hacerlo (ver sección 6).</li>
          <li>Intentar acceder a datos de otras organizaciones, eludir controles de acceso o probar la seguridad del Servicio sin autorización escrita nuestra.</li>
          <li>Usar el Servicio para enviar comunicaciones no solicitadas, alojar contenido ilícito o interferir con su funcionamiento.</li>
          <li>Revender o sublicenciar el Servicio, ni usarlo para construir un producto competidor a partir de su diseño o contenido.</li>
        </ul>
      </section>

      <section id="ia">
        <h2>4. Funciones de inteligencia artificial</h2>
        <p>El Servicio incluye un asistente conversacional, lectura automática de facturas y formularios, y módulos de análisis y recomendación (compras, planificación, recursos humanos, finanzas). Estas funciones usan modelos de Anthropic, PBC como subencargado (ver Política de privacidad).</p>
        <ul>
          <li><strong>Las salidas de la IA son sugerencias.</strong> Pueden contener errores u omisiones. Antes de actuar sobre una recomendación —una compra, un pago, una aplicación de agroquímicos, una decisión sobre personal— debés verificarla.</li>
          <li>Las funciones que pueden ejecutar acciones de forma autónoma están desactivadas por defecto. Si la Organización decide activarlas, asume las consecuencias de las acciones que el sistema ejecute dentro de los límites que ella misma configuró.</li>
          <li>Cuando interactuás con el asistente, el texto o imagen que enviás y el contexto operativo de tu finca necesario para responder se transmiten al proveedor de IA. El asistente lo indica de forma visible.</li>
        </ul>
      </section>

      <section id="datos">
        <h2>5. Tus datos</h2>
        <ul>
          <li>Los datos que la Organización carga en el Servicio («Datos del Cliente») son y siguen siendo de la Organización.</li>
          <li>Nos otorgás una licencia limitada, no exclusiva, para alojar, procesar, respaldar y mostrar los Datos del Cliente exclusivamente con el fin de prestarte el Servicio y mantener su seguridad.</li>
          <li>Podés solicitar una copia de tus datos en un formato de uso común y la eliminación de tu Organización. Tras la eliminación, los datos se borran de los sistemas activos y desaparecen de las copias de seguridad al vencer su período de retención.</li>
          <li>Podemos usar datos agregados y anonimizados, que no identifican a ninguna persona ni organización, para mejorar el Servicio.</li>
        </ul>
      </section>

      <section id="encargo">
        <h2>6. Datos de personal y de terceros: reparto de responsabilidades</h2>
        <p>El Servicio permite registrar datos personales de empleados, proveedores y compradores de la Organización, incluidos datos sensibles (por ejemplo, el motivo de una incapacidad). Respecto de esos datos:</p>
        <ul>
          <li><strong>La Organización es la responsable del tratamiento.</strong> Decide qué datos registra, con qué finalidad y por cuánto tiempo, y debe contar con el consentimiento informado de las personas o con otra base legal válida conforme a la Ley N.º 8968 de Protección de la Persona frente al Tratamiento de sus Datos Personales y su reglamento.</li>
          <li><strong>Nosotros actuamos como encargados del tratamiento</strong>, exclusivamente por cuenta e instrucciones de la Organización. No usamos esos datos para fines propios, no los cedemos a terceros salvo a los subencargados listados en la Política de privacidad, y aplicamos medidas técnicas y organizativas para protegerlos.</li>
          <li>La aceptación de estos términos al crear la Organización constituye el contrato de encargo de tratamiento entre la Organización y nosotros, en los términos de esta sección y de la Política de privacidad.</li>
          <li>Si una persona ejerce sus derechos de acceso, rectificación, cancelación u oposición ante nosotros, la remitiremos a la Organización y la asistiremos para responder.</li>
        </ul>
      </section>

      <section id="disponibilidad">
        <h2>7. Disponibilidad, cambios y soporte</h2>
        <ul>
          <li>Nos esforzamos por mantener el Servicio disponible de forma continua, pero no garantizamos un nivel de disponibilidad determinado. Puede haber interrupciones por mantenimiento, fallas de proveedores o causas ajenas a nuestro control.</li>
          <li>Podemos modificar, agregar o retirar funciones. Si un cambio reduce de forma sustancial una función que usás, te avisaremos con antelación razonable.</li>
          <li>Realizamos copias de seguridad periódicas de los datos. Aun así, te recomendamos exportar periódicamente la información crítica de tu finca.</li>
        </ul>
      </section>

      <section id="propiedad">
        <h2>8. Propiedad intelectual</h2>
        <p>El Servicio, su código, diseño, marcas y contenidos (excluidos los Datos del Cliente) son de nuestra propiedad o de nuestros licenciantes. Estos términos no te transfieren ningún derecho sobre ellos, salvo el de usar el Servicio conforme a lo aquí pactado.</p>
      </section>

      <section id="terminacion">
        <h2>9. Suspensión y terminación</h2>
        <ul>
          <li>Podés dejar de usar el Servicio y solicitar la eliminación de tu Organización en cualquier momento.</li>
          <li>Podemos suspender o cancelar el acceso si detectamos un incumplimiento de estos términos, un riesgo para la seguridad del Servicio o de otros usuarios, o si así lo exige la ley. Salvo urgencia, te avisaremos antes y te daremos oportunidad de corregir.</li>
          <li>Tras la terminación, conservarás la posibilidad de solicitar una copia de tus datos durante un plazo razonable antes de su eliminación.</li>
        </ul>
      </section>

      <section id="responsabilidad">
        <h2>10. Limitación de responsabilidad</h2>
        <p>En la máxima medida permitida por la ley aplicable, el Servicio se presta «tal cual» y «según disponibilidad». No respondemos por decisiones agronómicas, comerciales, laborales o financieras que tomés con base en la información o recomendaciones del Servicio, ni por pérdidas indirectas, lucro cesante o pérdida de datos atribuible a causas fuera de nuestro control razonable. Nada en estos términos limita la responsabilidad que no pueda limitarse legalmente, incluida la derivada de dolo o culpa grave.</p>
      </section>

      <section id="modificaciones">
        <h2>11. Cambios a estos términos</h2>
        <p>Podemos actualizar estos términos. Cada versión lleva fecha y número de versión al inicio de esta página. Si el cambio es relevante, lo comunicaremos dentro del Servicio o por correo con al menos 15 días de antelación; seguir usando el Servicio después de esa fecha implica aceptar la nueva versión.</p>
      </section>

      <section id="ley">
        <h2>12. Ley aplicable y contacto</h2>
        <p>Estos términos se rigen por las leyes de la República de Costa Rica. Cualquier controversia se someterá a los tribunales competentes de Costa Rica, sin perjuicio de los mecanismos de resolución alternativa que las partes acuerden.</p>
        <p>Para consultas sobre estos términos: {LEGAL_ENTITY.correoContacto
          ? <a href={`mailto:${LEGAL_ENTITY.correoContacto}`}>{LEGAL_ENTITY.correoContacto}</a>
          : <a href={LEGAL_ENTITY.sitioWeb}>{LEGAL_ENTITY.sitioWeb.replace(/^https?:\/\//, '')}</a>}.</p>
      </section>
    </LegalLayout>
  );
}
