const twilio = require('twilio');
const Anthropic = require('@anthropic-ai/sdk');
const { twilioAccountSid, twilioAuthToken } = require('./firebase');

// Los clientes externos se inicializan "perezosamente" (lazy) para evitar
// errores de despliegue cuando los secretos aún no están disponibles.
let twilioClient;
let anthropicClient;

function getTwilioClient() {
  if (!twilioClient) {
    twilioClient = twilio(twilioAccountSid.value(), twilioAuthToken.value());
  }
  return twilioClient;
}

function getAnthropicClient() {
  if (!anthropicClient) {
    anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return anthropicClient;
}

module.exports = { getTwilioClient, getAnthropicClient };
