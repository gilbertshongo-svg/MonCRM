const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Doit rester aligné avec lib/store.js — DATA_DIR peut être redirigé vers un
// disque persistant (ex. Render) via la variable d'environnement DATA_DIR.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const AUTH_FILE = path.join(DATA_DIR, 'auth.json');
const SESSION_MAX_AGE_MS = 30 * 24 * 3600 * 1000; // 30 jours
const COOKIE_NAME = 'moncrm_session';

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadAuth() {
  ensureDataDir();
  if (fs.existsSync(AUTH_FILE)) {
    try { return JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8')); } catch { /* fichier corrompu, on repart de zéro */ }
  }
  return null;
}

function saveAuth(record) {
  ensureDataDir();
  fs.writeFileSync(AUTH_FILE, JSON.stringify(record, null, 2), 'utf8');
}

function getOrCreateSessionSecret(record) {
  if (record.sessionSecret) return record.sessionSecret;
  record.sessionSecret = crypto.randomBytes(32).toString('hex');
  saveAuth(record);
  return record.sessionSecret;
}

function hasAccount() {
  const record = loadAuth();
  return Boolean(record && record.email && record.passwordHash);
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

function createAccount(email, password) {
  const record = { email: email.trim().toLowerCase(), passwordHash: hashPassword(password) };
  getOrCreateSessionSecret(record);
  saveAuth(record);
}

function verifyCredentials(email, password) {
  const record = loadAuth();
  if (!record) return false;
  if (record.email !== String(email || '').trim().toLowerCase()) return false;
  return verifyPasswordHash(password, record.passwordHash);
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
  // On repart d'un secret de session neuf : toute session ouverte ailleurs est invalidée.
  const record = { email: email.trim().toLowerCase(), passwordHash: hashPassword(password), sessionSecret: crypto.randomBytes(32).toString('hex') };
  saveAuth(record);
}

/* ---------- Jetons de session (signés, sans état côté serveur) ---------- */
function signSession(email) {
  const record = loadAuth();
  const secret = getOrCreateSessionSecret(record);
  const payload = Buffer.from(JSON.stringify({ email, iat: Date.now() })).toString('base64url');
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
    if (data.email !== record.email) return null; // le compte a changé depuis
    return data;
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

function setSessionCookie(res, email) {
  const token = signSession(email);
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

module.exports = {
  hasAccount,
  createAccount,
  verifyCredentials,
  isResetConfigured,
  resetAccount,
  setSessionCookie,
  clearSessionCookie,
  getSessionFromRequest,
  requireAuth,
  parseCookies,
  verifySession,
};
