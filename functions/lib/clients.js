const twilio = require('twilio');
const Anthropic = require('@anthropic-ai/sdk');
const { twilioAccountSid, twilioAuthToken } = require('./firebase');

// External clients are initialized lazily to avoid deployment errors when
// secrets are not yet available at module-load time.
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
