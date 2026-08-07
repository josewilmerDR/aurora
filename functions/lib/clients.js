const Anthropic = require('@anthropic-ai/sdk');

// External clients are initialized lazily to avoid deployment errors when
// secrets are not yet available at module-load time.
// (El cliente Twilio se eliminó junto con el canal WhatsApp.)
let anthropicClient;

function getAnthropicClient() {
  if (!anthropicClient) {
    // Timeout explícito para que los endpoints de IA fallen limpio DENTRO
    // de la ventana de 60s de Hosting (el proxy corta el rewrite a los 60s
    // pase lo que pase): 45s de intento + margen para responder el error.
    // maxRetries 1 (default 2): un reintento tras timeout ya no cabe en la
    // ventana; uno solo cubre errores de conexión transitorios sin duplicar
    // la espera del usuario.
    anthropicClient = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      timeout: 45_000,
      maxRetries: 1,
    });
  }
  return anthropicClient;
}

module.exports = { getAnthropicClient };
