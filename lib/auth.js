const path = require('path');
const crypto = require('crypto');
const kv = require('./kv');

// Doit rester aligné avec lib/store.js — DATA_DIR peut être redirigé vers un
// disque persistant (ex. Render) via la variable d'environnement DATA_DIR ;
// ne sert que de repli local quand Upstash n'est pas configuré (voir lib/kv.js).
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const AUTH_FILE = path.join(DATA_DIR, 'auth.json');
const AUTH_KEY = 'moncrm:auth';
const SESSION_MAX_AGE_MS = 30 * 24 * 3600 * 1000; // 30 jours
const COOKIE_NAME = 'moncrm_session';

// Comme pour lib/store.js : le compte vit en mémoire pendant que le serveur
// tourne (lectures instantanées à chaque requête, sans appel réseau), et
// chaque écriture est aussi poussée vers le stockage persistant.
let authRecord = null;
let authWriteQueue = Promise.resolve();

async function init() {
  const parsed = await kv.getJSON(AUTH_KEY, AUTH_FILE);
  if (!parsed) { authRecord = null; return; }
  // Compatibilité avec l'ancien format à un seul compte.
  if (parsed.email && parsed.passwordHash && !parsed.users) {
    authRecord = { users: [{ id: 'u-1', email: parsed.email, passwordHash: parsed.passwordHash, isAdmin: true, createdAt: new Date().toISOString() }], sessionSecret: parsed.sessionSecret };
    return;
  }
  if (!Array.isArray(parsed.users)) parsed.users = [];
  authRecord = parsed;
}

function loadAuth() {
  return authRecord;
}

function saveAuth(record) {
  authRecord = record;
  authWriteQueue = authWriteQueue.then(() => kv.setJSON(AUTH_KEY, record, AUTH_FILE));
  return authWriteQueue;
}

function getOrCreateSessionSecret(record) {
  if (record.sessionSecret) return record.sessionSecret;
  record.sessionSecret = crypto.randomBytes(32).toString('hex');
  saveAuth(record);
  return record.sessionSecret;
}

function hasAccount() {
  const record = loadAuth();
  return Boolean(record && record.users && record.users.length > 0);
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPasswordHash(password, stored) {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  const hashBuf = Buffer.from(hash, 'hex');
  const testBuf = crypto.scryptSync(password, salt, 64);
  return hashBuf.length === testBuf.length && crypto.timingSafeEqual(hashBuf, testBuf);
}

function publicUser(u) {
  return { id: u.id, email: u.email, isAdmin: Boolean(u.isAdmin), createdAt: u.createdAt };
}

/* ---------- Premier compte (bootstrap) ---------- */
function createFirstAccount(email, password) {
  const record = { users: [], sessionSecret: null };
  record.users.push({ id: 'u-' + Date.now(), email: email.trim().toLowerCase(), passwordHash: hashPassword(password), isAdmin: true, createdAt: new Date().toISOString() });
  getOrCreateSessionSecret(record);
  saveAuth(record);
}

/* ---------- Gestion des utilisateurs (réservé aux administrateurs) ---------- */
function listUsers() {
  const record = loadAuth();
  if (!record) return [];
  return record.users.map(publicUser);
}

function addUser(email, password, isAdmin) {
  const record = loadAuth();
  if (!record) throw new Error('Aucun compte existant.');
  const normalized = email.trim().toLowerCase();
  if (record.users.some((u) => u.email === normalized)) throw new Error('Un utilisateur avec cet e-mail existe déjà.');
  const user = { id: 'u-' + Date.now() + '-' + Math.random().toString(16).slice(2, 6), email: normalized, passwordHash: hashPassword(password), isAdmin: Boolean(isAdmin), createdAt: new Date().toISOString() };
  record.users.push(user);
  saveAuth(record);
  return publicUser(user);
}

function removeUser(userId) {
  const record = loadAuth();
  if (!record) throw new Error('Aucun compte existant.');
  const target = record.users.find((u) => u.id === userId);
  if (!target) throw new Error('Utilisateur introuvable.');
  const remainingAdmins = record.users.filter((u) => u.isAdmin && u.id !== userId);
  if (target.isAdmin && remainingAdmins.length === 0) throw new Error('Impossible de supprimer le dernier administrateur.');
  record.users = record.users.filter((u) => u.id !== userId);
  saveAuth(record);
}

/* ---------- Modification d'un utilisateur (réservée aux administrateurs) ---------- */
function updateUser(userId, { email, isAdmin, password } = {}) {
  const record = loadAuth();
  if (!record) throw new Error('Aucun compte existant.');
  const target = record.users.find((u) => u.id === userId);
  if (!target) throw new Error('Utilisateur introuvable.');

  if (email !== undefined) {
    const normalized = email.trim().toLowerCase();
    if (record.users.some((u) => u.id !== userId && u.email === normalized)) {
      throw new Error('Un autre utilisateur utilise déjà cet e-mail.');
    }
    target.email = normalized;
  }

  if (isAdmin !== undefined) {
    const willBeAdmin = Boolean(isAdmin);
    if (target.isAdmin && !willBeAdmin) {
      const remainingAdmins = record.users.filter((u) => u.isAdmin && u.id !== userId);
      if (remainingAdmins.length === 0) throw new Error('Impossible de retirer les droits du dernier administrateur.');
    }
    target.isAdmin = willBeAdmin;
  }

  if (password) {
    if (password.length < 8) throw new Error('Le mot de passe doit contenir au moins 8 caractères.');
    target.passwordHash = hashPassword(password);
  }

  saveAuth(record);
  return publicUser(target);
}

function findUserByEmail(email) {
  const record = loadAuth();
  if (!record) return null;
  return record.users.find((u) => u.email === String(email || '').trim().toLowerCase()) || null;
}

function findUserById(userId) {
  const record = loadAuth();
  if (!record) return null;
  return record.users.find((u) => u.id === userId) || null;
}

function verifyCredentials(email, password) {
  const user = findUserByEmail(email);
  if (!user) return null;
  return verifyPasswordHash(password, user.passwordHash) ? user : null;
}

/* ---------- Mot de passe oublié (code de vérification envoyé par e-mail) ----------
   Les codes sont de courte durée (15 min) et ne survivent pas volontairement à un
   redémarrage du serveur (contrairement au compte lui-même) : rien de grave si un
   redéploiement en cours de route oblige à redemander un code. */
const RESET_CODE_TTL_MS = 15 * 60 * 1000;
const resetCodes = new Map(); // email -> { code, expiresAt }

function createPasswordResetCode(email) {
  const user = findUserByEmail(email);
  if (!user) throw new Error('Aucun compte trouvé avec cet e-mail.');
  const code = String(crypto.randomInt(100000, 1000000)); // 6 chiffres
  resetCodes.set(user.email, { code, expiresAt: Date.now() + RESET_CODE_TTL_MS });
  return { code, email: user.email };
}

function resetPasswordWithCode(email, code, newPassword) {
  const normalized = String(email || '').trim().toLowerCase();
  const entry = resetCodes.get(normalized);
  if (!entry || entry.expiresAt < Date.now()) throw new Error('Code expiré ou invalide. Redemandez-en un.');
  const codeBuf = Buffer.from(String(code || ''));
  const expectedBuf = Buffer.from(entry.code);
  const valid = codeBuf.length === expectedBuf.length && crypto.timingSafeEqual(codeBuf, expectedBuf);
  if (!valid) throw new Error('Code incorrect.');

  const record = loadAuth();
  const user = record?.users.find((u) => u.email === normalized);
  if (!user) throw new Error('Compte introuvable.');
  user.passwordHash = hashPassword(newPassword);
  saveAuth(record);
  resetCodes.delete(normalized);
  return user;
}

/* ---------- Réinitialisation (via une clé de récupération connue de vous seul) ---------- */
function isResetConfigured() {
  return Boolean(process.env.ADMIN_RESET_TOKEN);
}

function resetAccount(email, password, resetToken) {
  if (!isResetConfigured()) throw new Error("Réinitialisation non configurée côté serveur (ADMIN_RESET_TOKEN manquant).");
  const expected = process.env.ADMIN_RESET_TOKEN;
  const providedBuf = Buffer.from(String(resetToken || ''));
  const expectedBuf = Buffer.from(expected);
  const valid = providedBuf.length === expectedBuf.length && crypto.timingSafeEqual(providedBuf, expectedBuf);
  if (!valid) throw new Error('Clé de récupération incorrecte.');

  const normalized = email.trim().toLowerCase();
  // On repart d'un compte administrateur unique et d'un secret de session neuf :
  // toute session ouverte ailleurs est invalidée. C'est un filet de secours,
  // pas un outil de gestion courante des utilisateurs.
  const record = {
    users: [{ id: 'u-' + Date.now(), email: normalized, passwordHash: hashPassword(password), isAdmin: true, createdAt: new Date().toISOString() }],
    sessionSecret: crypto.randomBytes(32).toString('hex'),
  };
  saveAuth(record);
}

/* ---------- Jetons de session (signés, sans état côté serveur) ---------- */
function signSession(user) {
  const record = loadAuth();
  const secret = getOrCreateSessionSecret(record);
  const payload = Buffer.from(JSON.stringify({ userId: user.id, email: user.email, iat: Date.now() })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function verifySession(token) {
  if (!token) return null;
  const record = loadAuth();
  if (!record) return null;
  const secret = getOrCreateSessionSecret(record);
  const [payload, sig] = String(token).split('.');
  if (!payload || !sig) return null;
  const expectedSig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (Date.now() - data.iat > SESSION_MAX_AGE_MS) return null;
    const user = record.users.find((u) => u.id === data.userId && u.email === data.email);
    if (!user) return null; // compte supprimé ou modifié depuis
    return publicUser(user);
  } catch {
    return null;
  }
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  header.split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx === -1) return;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1));
  });
  return out;
}

function isSecureContext() {
  return String(process.env.APP_BASE_URL || '').startsWith('https://');
}

function setSessionCookie(res, user) {
  const token = signSession(user);
  const secure = isSecureContext() ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; Path=/; Max-Age=${SESSION_MAX_AGE_MS / 1000}; SameSite=Lax${secure}`);
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`);
}

function getSessionFromRequest(req) {
  const cookies = parseCookies(req);
  return verifySession(cookies[COOKIE_NAME]);
}

function requireAuth(req, res, next) {
  const session = getSessionFromRequest(req);
  if (!session) return res.status(401).json({ error: 'Non authentifié.' });
  req.user = session;
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user || !req.user.isAdmin) return res.status(403).json({ error: 'Réservé aux administrateurs.' });
  next();
}

module.exports = {
  init,
  hasAccount,
  createFirstAccount,
  listUsers,
  addUser,
  removeUser,
  updateUser,
  findUserById,
  verifyCredentials,
  createPasswordResetCode,
  resetPasswordWithCode,
  isResetConfigured,
  resetAccount,
  setSessionCookie,
  clearSessionCookie,
  getSessionFromRequest,
  requireAuth,
  requireAdmin,
  parseCookies,
  verifySession,
};
