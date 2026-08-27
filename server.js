require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');

const store = require('./lib/store');
const kv = require('./lib/kv');
const gmail = require('./lib/gmail');
const whatsapp = require('./lib/whatsapp');
const facebookLeads = require('./lib/facebookLeads');
const facebookAds = require('./lib/facebookAds');
const auth = require('./lib/auth');
const scheduler = require('./lib/scheduler');
const exportLib = require('./lib/export');

const app = express();
app.set('trust proxy', true);
app.use(cors());
app.use(express.json({ limit: '2mb' }));

const PORT = process.env.PORT || 3000;

/* ============================================================
   Authentification (plusieurs comptes possibles, protège toutes vos données)
   ============================================================ */
app.get('/api/auth/status', (req, res) => {
  const session = auth.getSessionFromRequest(req);
  res.json({
    hasAccount: auth.hasAccount(),
    authenticated: Boolean(session),
    email: session?.email || null,
    isAdmin: session?.isAdmin || false,
    resetAvailable: auth.isResetConfigured(),
  });
});

app.post('/api/auth/setup', (req, res) => {
  if (auth.hasAccount()) return res.status(400).json({ error: 'Un compte existe déjà.' });
  const { email, password } = req.body;
  if (!email || !password || password.length < 8) {
    return res.status(400).json({ error: 'E-mail et mot de passe (8 caractères minimum) requis.' });
  }
  auth.createFirstAccount(email, password);
  const user = auth.verifyCredentials(email, password);
  auth.setSessionCookie(res, user);
  res.json({ ok: true });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  const user = auth.verifyCredentials(email, password);
  if (!user) return res.status(401).json({ error: 'E-mail ou mot de passe incorrect.' });
  auth.setSessionCookie(res, user);
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
    const user = auth.verifyCredentials(email, password);
    auth.setSessionCookie(res, user);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/* ---------- Mot de passe oublié (code envoyé par e-mail, pour tous les utilisateurs) ---------- */
app.post('/api/auth/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'E-mail requis.' });
  if (!gmail.isConnected()) {
    return res.status(400).json({ error: "L'envoi d'e-mails n'est pas configuré sur ce CRM. Demandez à votre administrateur d'utiliser la clé de récupération." });
  }
  try {
    const { code, email: userEmail } = auth.createPasswordResetCode(email);
    await gmail.sendEmail({
      to: userEmail,
      subject: 'Code de vérification MonCRM',
      content: `Votre code de vérification pour réinitialiser votre mot de passe MonCRM est : ${code}\n\nCe code est valable 15 minutes. Si vous n'êtes pas à l'origine de cette demande, ignorez cet e-mail.`,
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message || "Échec de l'envoi du code." });
  }
});

app.post('/api/auth/reset-with-code', (req, res) => {
  const { email, code, password } = req.body;
  if (!email || !code || !password || password.length < 8) {
    return res.status(400).json({ error: 'E-mail, code et mot de passe (8 caractères minimum) requis.' });
  }
  try {
    const user = auth.resetPasswordWithCode(email, code, password);
    auth.setSessionCookie(res, user);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/* ---------- Gestion des utilisateurs (réservée aux administrateurs) ---------- */
app.get('/api/users', auth.requireAuth, auth.requireAdmin, (req, res) => {
  res.json(auth.listUsers());
});

app.post('/api/users', auth.requireAuth, auth.requireAdmin, (req, res) => {
  const { email, password, isAdmin } = req.body;
  if (!email || !password || password.length < 8) {
    return res.status(400).json({ error: 'E-mail et mot de passe (8 caractères minimum) requis.' });
  }
  try {
    const user = auth.addUser(email, password, isAdmin);
    res.json({ ok: true, user });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete('/api/users/:id', auth.requireAuth, auth.requireAdmin, (req, res) => {
  if (req.params.id === req.user.id) return res.status(400).json({ error: 'Vous ne pouvez pas supprimer votre propre compte pendant que vous êtes connecté·e.' });
  try {
    auth.removeUser(req.params.id);
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
    facebookLeads: facebookLeads.getStatus(),
    facebookAds: facebookAds.getStatus(),
  });
});

app.get('/api/integrations/facebook-ads/insights', auth.requireAuth, async (req, res) => {
  try {
    const insights = await facebookAds.fetchInsights({ datePreset: req.query.datePreset });
    res.json(insights);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
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
   Messages programmés (envoi automatique différé)
   ============================================================ */
app.post('/api/messages/schedule', auth.requireAuth, async (req, res) => {
  const { contactId, channel, subject, content, sendAt } = req.body;
  const data = store.getData();
  const contact = data.contacts.find((c) => c.id === contactId);
  if (!contact) return res.status(400).json({ error: 'Contact introuvable.' });
  if (channel !== 'email' && channel !== 'whatsapp') return res.status(400).json({ error: 'Canal invalide (e-mail ou WhatsApp uniquement).' });
  if (channel === 'email' && !contact.email) return res.status(400).json({ error: "Ce contact n'a pas d'adresse e-mail." });
  if (channel === 'whatsapp' && !contact.phone) return res.status(400).json({ error: "Ce contact n'a pas de numéro de téléphone." });
  if (!content || !content.trim()) return res.status(400).json({ error: 'Le message ne peut pas être vide.' });
  const sendDate = new Date(sendAt);
  if (isNaN(sendDate) || sendDate.getTime() <= Date.now()) {
    return res.status(400).json({ error: "La date d'envoi doit être dans le futur." });
  }

  const item = {
    id: 'sch-' + Date.now() + '-' + Math.random().toString(16).slice(2, 8),
    contactId,
    channel,
    subject: subject || '',
    content: content.trim(),
    sendAt: sendDate.toISOString(),
    status: 'pending',
    createdAt: new Date().toISOString(),
  };
  await store.mutate((d) => { d.scheduledMessages.push(item); });
  res.json({ ok: true, data: store.getData() });
});

app.post('/api/messages/schedule/:id/cancel', auth.requireAuth, async (req, res) => {
  const data = store.getData();
  const item = data.scheduledMessages.find((m) => m.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Message programmé introuvable.' });
  if (item.status === 'sent') return res.status(400).json({ error: 'Ce message a déjà été envoyé.' });
  await store.mutate((d) => {
    d.scheduledMessages = d.scheduledMessages.filter((m) => m.id !== req.params.id);
  });
  res.json({ ok: true, data: store.getData() });
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
   Facebook / Instagram — prospects (Lead Ads) — webhook
   ============================================================ */
app.get('/webhook/facebook-leads', (req, res) => {
  const challenge = facebookLeads.verifyWebhookChallenge(req.query);
  if (challenge) return res.status(200).send(challenge);
  res.status(403).send('Verification failed');
});

app.post('/webhook/facebook-leads', (req, res) => {
  facebookLeads.handleIncomingWebhook(req.body).catch((e) => console.error('Erreur webhook prospects Facebook', e));
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
   Export (Excel / PDF / Word)
   ============================================================ */
app.get('/api/export/excel', auth.requireAuth, async (req, res) => {
  try {
    const buffer = await exportLib.generateExcelBuffer(store.getData());
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="moncrm-export-${new Date().toISOString().slice(0, 10)}.xlsx"`);
    res.send(buffer);
  } catch (e) {
    console.error('Échec export Excel', e);
    res.status(500).json({ error: "Échec de la génération du fichier Excel." });
  }
});

app.get('/api/export/pdf', auth.requireAuth, async (req, res) => {
  try {
    const buffer = await exportLib.generatePdfBuffer(store.getData());
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="moncrm-export-${new Date().toISOString().slice(0, 10)}.pdf"`);
    res.send(buffer);
  } catch (e) {
    console.error('Échec export PDF', e);
    res.status(500).json({ error: "Échec de la génération du fichier PDF." });
  }
});

app.get('/api/export/word', auth.requireAuth, async (req, res) => {
  try {
    const buffer = await exportLib.generateWordBuffer(store.getData());
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="moncrm-export-${new Date().toISOString().slice(0, 10)}.docx"`);
    res.send(buffer);
  } catch (e) {
    console.error('Échec export Word', e);
    res.status(500).json({ error: "Échec de la génération du fichier Word." });
  }
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
const SCHEDULE_CHECK_INTERVAL_MS = 60 * 1000;

/* ============================================================
   Démarrage : on charge d'abord les données persistées (Upstash ou
   fichier local, voir lib/kv.js) avant d'accepter la moindre requête.
   ============================================================ */
Promise.all([store.init(), auth.init()])
  .then(() => {
    console.log(kv.isConfigured()
      ? 'Stockage : Upstash (persistant, survit aux redéploiements).'
      : 'Stockage : fichier local (voir DATA_DIR / Upstash pour la persistance en production).');

    setInterval(() => {
      gmail.pollNewEmails().catch((e) => console.error('Erreur de synchronisation Gmail', e));
    }, POLL_INTERVAL_MS);

    setInterval(() => {
      scheduler.sendDueMessages().catch((e) => console.error('Erreur d\'envoi des messages programmés', e));
    }, SCHEDULE_CHECK_INTERVAL_MS);

    app.listen(PORT, () => {
      console.log(`MonCRM en écoute sur le port ${PORT}`);
      gmail.pollNewEmails().catch((e) => console.error('Erreur de synchronisation Gmail (démarrage)', e));
      scheduler.sendDueMessages().catch((e) => console.error('Erreur d\'envoi des messages programmés (démarrage)', e));
    });
  })
  .catch((err) => {
    console.error('Échec du chargement des données au démarrage :', err);
    process.exit(1);
  });
