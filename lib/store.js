const path = require('path');
const kv = require('./kv');

// DATA_DIR sert de repli local (utilisé seulement si Upstash n'est pas
// configuré — voir lib/kv.js). Peut aussi pointer vers un disque persistant
// Render via la variable d'environnement DATA_DIR.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'data.json');
const TOKENS_FILE = path.join(DATA_DIR, 'tokens.json');

const DATA_KEY = 'moncrm:data';
const TOKENS_KEY = 'moncrm:tokens';

function emptyData() {
  return { contacts: [], companies: [], deals: [], tasks: [], messages: [], scheduledMessages: [] };
}

// Comme avant : l'état vit en mémoire pendant que le serveur tourne (lectures
// instantanées, aucun appel réseau par requête) ; chaque mutation est aussi
// écrite vers le stockage persistant (Upstash ou fichier local) via une file
// d'attente de promesses qui sérialise les écritures.
let data = emptyData();
let tokensCache = null;
let dataWriteQueue = Promise.resolve();
let tokensWriteQueue = Promise.resolve();

async function init() {
  const loaded = await kv.getJSON(DATA_KEY, DATA_FILE);
  data = loaded ? { ...emptyData(), ...loaded } : emptyData();
  tokensCache = await kv.getJSON(TOKENS_KEY, TOKENS_FILE);
}

function persistData() {
  dataWriteQueue = dataWriteQueue.then(() => kv.setJSON(DATA_KEY, data, DATA_FILE));
  return dataWriteQueue;
}

function getData() {
  return data;
}

function setData(next) {
  data = { ...emptyData(), ...next };
  return persistData();
}

function mutate(fn) {
  fn(data);
  return persistData();
}

/* ---------- Jetons OAuth Google (par serveur, un seul compte connecté) ---------- */
function loadTokens() {
  return tokensCache;
}

function saveTokens(tokens) {
  tokensCache = tokens;
  tokensWriteQueue = tokensWriteQueue.then(() => kv.setJSON(TOKENS_KEY, tokens, TOKENS_FILE));
  return tokensWriteQueue;
}

function clearTokens() {
  tokensCache = null;
  tokensWriteQueue = tokensWriteQueue.then(() => kv.deleteKey(TOKENS_KEY, TOKENS_FILE));
  return tokensWriteQueue;
}

module.exports = { init, getData, setData, mutate, loadTokens, saveTokens, clearTokens };
