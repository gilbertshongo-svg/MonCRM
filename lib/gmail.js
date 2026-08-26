const { google } = require('googleapis');
const store = require('./store');

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/userinfo.email',
];

function redirectUri() {
  const base = process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
  return `${base}/auth/google/callback`;
}

function isConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

function createOAuthClient() {
  return new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, redirectUri());
}

function isConnected() {
  const saved = store.loadTokens();
  return Boolean(saved && saved.tokens && saved.tokens.refresh_token);
}

function getStatus() {
  const saved = store.loadTokens();
  return {
    configured: isConfigured(),
    connected: isConnected(),
    email: saved?.email || null,
    lastSyncAt: saved?.lastSyncAt || null,
  };
}

function getAuthUrl() {
  const client = createOAuthClient();
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent', // force un refresh_token même si déjà autorisé auparavant
    scope: SCOPES,
  });
}

async function handleCallback(code) {
  const client = createOAuthClient();
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);

  const oauth2 = google.oauth2({ auth: client, version: 'v2' });
  const { data: userinfo } = await oauth2.userinfo.get();

  const gmail = google.gmail({ version: 'v1', auth: client });
  const profile = await gmail.users.getProfile({ userId: 'me' });

  store.saveTokens({
    tokens,
    email: userinfo.email,
    lastHistoryId: profile.data.historyId,
    lastSyncAt: null,
  });
}

function disconnect() {
  store.clearTokens();
}

async function getAuthedClient() {
  const saved = store.loadTokens();
  if (!saved || !saved.tokens) return null;
  const client = createOAuthClient();
  client.setCredentials(saved.tokens);
  client.on('tokens', (newTokens) => {
    const merged = { ...saved.tokens, ...newTokens };
    const current = store.loadTokens() || {};
    store.saveTokens({ ...current, tokens: merged });
  });
  return client;
}

function extractEmailAddress(fromHeader) {
  const match = String(fromHeader || '').match(/<([^>]+)>/);
  return (match ? match[1] : fromHeader || '').trim().toLowerCase();
}

function decodeMimeHeader(subject) {
  // Décodage minimal des sujets encodés en RFC 2047 (=?UTF-8?B?...?=).
  if (!subject) return '';
  return subject.replace(/=\?UTF-8\?B\?([^?]+)\?=/gi, (_, b64) => Buffer.from(b64, 'base64').toString('utf8'));
}

/* ---------- Synchronisation entrante ---------- */
async function pollNewEmails() {
  if (!isConnected()) return { checked: false };
  const client = await getAuthedClient();
  const gmail = google.gmail({ version: 'v1', auth: client });
  const saved = store.loadTokens();
  let startHistoryId = saved.lastHistoryId;

  if (!startHistoryId) {
    const profile = await gmail.users.getProfile({ userId: 'me' });
    startHistoryId = profile.data.historyId;
    store.saveTokens({ ...saved, lastHistoryId: startHistoryId, lastSyncAt: new Date().toISOString() });
    return { checked: true, newMessages: 0 };
  }

  let history;
  try {
    history = await gmail.users.history.list({
      userId: 'me',
      startHistoryId,
      historyTypes: ['messageAdded'],
    });
  } catch (err) {
    if (err.code === 404 || err.response?.status === 404) {
      // La fenêtre d'historique a expiré (trop de temps écoulé) : on repart d'un point récent.
      const profile = await gmail.users.getProfile({ userId: 'me' });
      store.saveTokens({ ...saved, lastHistoryId: profile.data.historyId, lastSyncAt: new Date().toISOString() });
      return { checked: true, newMessages: 0 };
    }
    throw err;
  }

  const addedIds = new Set();
  (history.data.history || []).forEach((h) => {
    (h.messagesAdded || []).forEach((m) => {
      if ((m.message.labelIds || []).includes('INBOX') && !(m.message.labelIds || []).includes('SENT')) {
        addedIds.add(m.message.id);
      }
    });
  });

  const data = store.getData();
  let newMessages = 0;

  for (const id of addedIds) {
    const already = data.messages.some((m) => m.externalId === id);
    if (already) continue;

    const msg = await gmail.users.messages.get({ userId: 'me', id, format: 'metadata', metadataHeaders: ['From', 'Subject'] });
    const headers = msg.data.payload?.headers || [];
    const fromHeader = headers.find((h) => h.name === 'From')?.value || '';
    const subjectHeader = decodeMimeHeader(headers.find((h) => h.name === 'Subject')?.value || '');
    const fromEmail = extractEmailAddress(fromHeader);

    const contact = data.contacts.find((c) => (c.email || '').trim().toLowerCase() === fromEmail);

    store.mutate((d) => {
      d.messages.push({
        id: 'msg-' + id,
        externalId: id,
        contactId: contact ? contact.id : null,
        fromRaw: contact ? null : fromEmail,
        channel: 'email',
        direction: 'entrant',
        content: (subjectHeader ? subjectHeader + ' — ' : '') + (msg.data.snippet || ''),
        date: new Date(Number(msg.data.internalDate)).toISOString(),
        createdAt: new Date().toISOString(),
      });
    });
    newMessages++;
  }

  await store.saveTokens({ ...store.loadTokens(), lastHistoryId: history.data.historyId || startHistoryId, lastSyncAt: new Date().toISOString() });
  return { checked: true, newMessages };
}

/* ---------- Envoi ---------- */
function buildRawMessage({ to, subject, content }) {
  const encodedSubject = `=?UTF-8?B?${Buffer.from(subject || '', 'utf8').toString('base64')}?=`;
  const lines = [
    `To: ${to}`,
    `Subject: ${encodedSubject}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'MIME-Version: 1.0',
    '',
    content,
  ];
  return Buffer.from(lines.join('\r\n'), 'utf8').toString('base64url');
}

async function sendEmail({ to, subject, content }) {
  const client = await getAuthedClient();
  if (!client) throw new Error('Gmail non connecté');
  const gmail = google.gmail({ version: 'v1', auth: client });
  const raw = buildRawMessage({ to, subject: subject || 'Message de MonCRM', content });
  await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
}

module.exports = { isConfigured, isConnected, getStatus, getAuthUrl, handleCallback, disconnect, pollNewEmails, sendEmail };
