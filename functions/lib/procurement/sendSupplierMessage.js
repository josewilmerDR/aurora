// Outbound WhatsApp helper for RFQs. Sends to a supplier's `whatsapp` field
// using the existing Twilio client configured in lib/clients.js. Best-effort:
// logs but does not throw, so a single failing number doesn't kill the whole
// RFQ fan-out.
//
// Returns a per-supplier outcome row suitable for persisting on the RFQ doc.

const { getTwilioClient } = require('../clients');
const { twilioWhatsappFrom } = require('../firebase');

async function sendRfqToSupplier({ supplier, messageBody }) {
  const phone = typeof supplier?.whatsapp === 'string' && supplier.whatsapp.trim()
    ? supplier.whatsapp.trim().replace(/\s+/g, '')
    : '';
  if (!phone) {
    return {
      supplierId: supplier?.id || null,
      supplierName: supplier?.nombre || '',
      sent: false,
      reason: 'Proveedor sin número de WhatsApp.',
    };
  }

  try {
    const client = getTwilioClient();
    const from = `whatsapp:${twilioWhatsappFrom.value()}`;
    const to = `whatsapp:${phone}`;
    const result = await client.messages.create({ body: messageBody, from, to });
    return {
      supplierId: supplier.id,
      supplierName: supplier.nombre || '',
      sent: true,
      twilioSid: result?.sid || null,
      to: phone,
    };
  } catch (err) {
    console.error(`[RFQ-WA] send failed for ${supplier?.nombre}:`, err.message);
    return {
      supplierId: supplier?.id || null,
      supplierName: supplier?.nombre || '',
      sent: false,
      reason: `WhatsApp error: ${err.message}`.slice(0, 200),
    };
  }
}

module.exports = { sendRfqToSupplier };
