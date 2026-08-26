require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');

const store = require('./lib/store');
const gmail = require('./lib/gmail');
const whatsapp = require('./lib/whatsapp');
const auth = require('./lib/auth');

const app = express();
app.set('trust proxy', true);
app.use(cors());
app.use(express.json({ limit: '2mb' }));

const PORT = process.env.PORT || 3000;

/* ============================================================
   Authentification (compte unique, protège toutes vos données)
   ============================================================ */
app.get('/api/auth/status', (req, res) => {
  const session = auth.getSessionFromRequest(req);
  res.json({
    hasAccount: auth.hasAccount(),
    authenticated: Boolean(session),
    email: session?.email || null,
    resetAvailable: auth.isResetConfigured(),
  });
});

app.post('/api/auth/setup', (req, res) => {
  if (auth.hasAccount()) return res.status(400).json({ error: 'Un compte existe déjà.' });
  const { email, password } = req.body;
  if (!email || !password || password.length < 8) {
    return res.status(400).json({ error: 'E-mail et mot de passe (8 caractères minimum) requis.' });
  }
  auth.createAccount(email, password);
  auth.setSessionCookie(res, email.trim().toLowerCase());
  res.json({ ok: true });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  if (!auth.verifyCredentials(email, password)) {
    return res.status(401).json({ error: 'E-mail ou mot de passe incorrect.' });
  }
  auth.setSessionCookie(res, String(email).trim().toLowerCase());
  res.json({ ok: true });
});

app.post('/api/auth/logout', (req, res) => {
  auth.clearSessionCookie(res);
  res.json({ ok: true });
});

app.post('/api/auth/reset', (req, res) => {
  const { email, password, resetToken } = req.body;
  if (!email || !password || password.length < 8) {
    return res.status(400).json({ error: 'E-mail et mot de passe (8 caractères minimum) requis.' });
  }
  try {
    auth.resetAccount(email, password, resetToken);
    auth.setSessionCookie(res, String(email).trim().toLowerCase());
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/* ============================================================
   Données du CRM (protégées : authentification requise)
   ============================================================ */
app.get('/api/data', auth.requireAuth, (req, res) => {
  res.json(store.getData());
});

app.put('/api/data', auth.requireAuth, async (req, res) => {
  try {
    await store.setData(req.body);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Échec de l\'enregistrement.' });
  }
});

/* ============================================================
   Intégrations — statut
   ============================================================ */
app.get('/api/integrations/status', auth.requireAuth, (req, res) => {
  res.json({
    gmail: gmail.getStatus(),
    whatsapp: whatsapp.getStatus(),
  });
});

/* ============================================================
   Gmail — connexion OAuth
   ============================================================ */
app.get('/auth/google', (req, res) => {
  if (!auth.getSessionFromRequest(req)) return res.redirect('/');
  if (!gmail.isConfigured()) return res.status(400).send("Gmail n'est pas configuré côté serveur (variables GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET manquantes).");
  res.redirect(gmail.getAuthUrl());
});

app.get('/auth/google/callback', async (req, res) => {
  try {
    await gmail.handleCallback(req.query.code);
    res.redirect('/?gmail=connecte');
  } catch (e) {
    console.error('Erreur callback Google', e);
    res.redirect('/?gmail=erreur');
  }
});

app.post('/api/integrations/gmail/disconnect', auth.requireAuth, (req, res) => {
  gmail.disconnect();
  res.json({ ok: true });
});

/* ============================================================
   Envoi de messages réels (e-mail / WhatsApp)
   ============================================================ */
app.post('/api/messages/send-email', auth.requireAuth, async (req, res) => {
  const { contactId, subject, content } = req.body;
  const data = store.getData();
  const contact = data.contacts.find((c) => c.id === contactId);
  if (!contact || !contact.email) return res.status(400).json({ error: "Ce contact n'a pas d'adresse e-mail." });

  try {
    await gmail.sendEmail({ to: contact.email, subject, content });
    await store.mutate((d) => {
      d.messages.push({
        id: 'out-' + Date.now(),
        contactId,
        channel: 'email',
        direction: 'sortant',
        content: (subject ? subject + ' — ' : '') + content,
        date: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      });
    });
    res.json({ ok: true, data: store.getData() });
  } catch (e) {
    console.error('Échec envoi e-mail', e);
    res.status(500).json({ error: "Échec de l'envoi. Gmail est-il bien connecté ?" });
  }
});

app.post('/api/messages/send-whatsapp', auth.requireAuth, async (req, res) => {
  const { contactId, content } = req.body;
  const data = store.getData();
  const contact = data.contacts.find((c) => c.id === contactId);
  if (!contact || !contact.phone) return res.status(400).json({ error: "Ce contact n'a pas de numéro de téléphone." });

  try {
    await whatsapp.sendMessage({ to: contact.phone, content });
    await store.mutate((d) => {
      d.messages.push({
        id: 'out-' + Date.now(),
        contactId,
        channel: 'whatsapp',
        direction: 'sortant',
        content,
        date: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      });
    });
    res.json({ ok: true, data: store.getData() });
  } catch (e) {
    console.error('Échec envoi WhatsApp', e);
    res.status(500).json({ error: "Échec de l'envoi. En mode test Meta, le destinataire doit être ajouté comme numéro vérifié." });
  }
});

/* ============================================================
   WhatsApp (Meta Cloud API) — webhook
   ============================================================ */
app.get('/webhook/whatsapp', (req, res) => {
  const challenge = whatsapp.verifyWebhookChallenge(req.query);
  if (challenge) return res.status(200).send(challenge);
  res.status(403).send('Verification failed');
});

app.post('/webhook/whatsapp', (req, res) => {
  whatsapp.handleIncomingWebhook(req.body);
  res.sendStatus(200);
});

/* ============================================================
   Assigner un message à un contact (pour les expéditeurs inconnus)
   ============================================================ */
app.post('/api/messages/:id/assign', auth.requireAuth, async (req, res) => {
  const { contactId } = req.body;
  const data = store.getData();
  const msg = data.messages.find((m) => m.id === req.params.id);
  if (!msg) return res.status(404).json({ error: 'Message introuvable.' });
  await store.mutate((d) => {
    const target = d.messages.find((m) => m.id === req.params.id);
    target.contactId = contactId;
    target.fromRaw = null;
  });
  res.json({ ok: true, data: store.getData() });
});

/* ============================================================
   Frontend statique
   ============================================================ */
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

/* ============================================================
   Synchronisation Gmail périodique
   ============================================================ */
const POLL_INTERVAL_MS = 2 * 60 * 1000;
setInterval(() => {
  gmail.pollNewEmails().catch((e) => console.error('Erreur de synchronisation Gmail', e));
}, POLL_INTERVAL_MS);

app.listen(PORT, () => {
  console.log(`MonCRM en écoute sur le port ${PORT}`);
  gmail.pollNewEmails().catch((e) => console.error('Erreur de synchronisation Gmail (démarrage)', e));
});
