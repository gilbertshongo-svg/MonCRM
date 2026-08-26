const store = require('./store');
const { phonesMatch } = require('./phone');

const GRAPH_API_VERSION = 'v20.0';

function isConfigured() {
  return Boolean(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID && process.env.WHATSAPP_VERIFY_TOKEN);
}

function getStatus() {
  return {
    configured: isConfigured(),
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || null,
    webhookUrl: isConfigured() ? `${process.env.APP_BASE_URL || ''}/webhook/whatsapp` : null,
  };
}

/* ---------- Vérification du webhook (poignée de main exigée par Meta) ---------- */
function verifyWebhookChallenge(query) {
  const mode = query['hub.mode'];
  const token = query['hub.verify_token'];
  const challenge = query['hub.challenge'];
  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return challenge;
  }
  return null;
}

/* ---------- Réception ---------- */
function handleIncomingWebhook(body) {
  const entry = body.entry?.[0];
  const change = entry?.changes?.[0];
  const value = change?.value;
  const messages = value?.messages || [];
  if (messages.length === 0) return; // accusés de réception (status) ou autre évènement : rien à faire

  const data = store.getData();

  messages.forEach((msg) => {
    if (msg.type !== 'text') return; // on ne gère que le texte pour l'instant
    const already = data.messages.some((m) => m.externalId === msg.id);
    if (already) return;

    const from = msg.from; // numéro au format international sans "+"
    const contact = data.contacts.find((c) => c.phone && phonesMatch(c.phone, from));

    store.mutate((d) => {
      d.messages.push({
        id: 'wa-' + msg.id,
        externalId: msg.id,
        contactId: contact ? contact.id : null,
        fromRaw: contact ? null : '+' + from,
        channel: 'whatsapp',
        direction: 'entrant',
        content: msg.text?.body || '',
        date: new Date(Number(msg.timestamp) * 1000).toISOString(),
        createdAt: new Date().toISOString(),
      });
    });
  });
}

/* ---------- Envoi ---------- */
async function sendMessage({ to, content }) {
  if (!isConfigured()) throw new Error('WhatsApp non configuré');
  const toDigits = String(to).replace(/\D/g, '');
  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: toDigits,
      type: 'text',
      text: { body: content },
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Échec envoi WhatsApp (${res.status}): ${errBody}`);
  }
}

module.exports = { isConfigured, getStatus, verifyWebhookChallenge, handleIncomingWebhook, sendMessage };
