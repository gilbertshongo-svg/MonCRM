const fs = require('fs');
const path = require('path');

// DATA_DIR peut être redirigé vers un disque persistant (ex. Render) via la
// variable d'environnement DATA_DIR ; par défaut, dossier local du projet.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'data.json');
const TOKENS_FILE = path.join(DATA_DIR, 'tokens.json');

function emptyData() {
  return { contacts: [], companies: [], deals: [], tasks: [], messages: [], scheduledMessages: [] };
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

// L'état vit en mémoire pendant que le serveur tourne ; chaque mutation est
// aussi écrite sur disque. Comme Node exécute le JS sur un seul thread, une
// simple file d'attente de promesses suffit à sérialiser les écritures et
// évite toute corruption du fichier en cas d'écritures concurrentes
// (webhook Twilio + poll Gmail + interface, potentiellement en même temps).
let writeQueue = Promise.resolve();
let data = loadFromDisk();

function loadFromDisk() {
  ensureDataDir();
  if (fs.existsSync(DATA_FILE)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      return { ...emptyData(), ...parsed };
    } catch (e) {
      console.error('data.json illisible, réinitialisation.', e);
    }
  }
  return emptyData();
}

function saveToDisk() {
  writeQueue = writeQueue.then(() => new Promise((resolve, reject) => {
    ensureDataDir();
    fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2), 'utf8', (err) => {
      if (err) { console.error('Échec écriture data.json', err); reject(err); }
      else resolve();
    });
  }));
  return writeQueue;
}

function getData() {
  return data;
}

function setData(next) {
  data = { ...emptyData(), ...next };
  return saveToDisk();
}

function mutate(fn) {
  fn(data);
  return saveToDisk();
}

/* ---------- Jetons OAuth Google (par serveur, un seul compte connecté) ---------- */
function loadTokens() {
  ensureDataDir();
  if (fs.existsSync(TOKENS_FILE)) {
    try { return JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf8')); } catch { return null; }
  }
  return null;
}

function saveTokens(tokens) {
  ensureDataDir();
  fs.writeFileSync(TOKENS_FILE, JSON.stringify(tokens, null, 2), 'utf8');
}

function clearTokens() {
  if (fs.existsSync(TOKENS_FILE)) fs.unlinkSync(TOKENS_FILE);
}

module.exports = { getData, setData, mutate, loadTokens, saveTokens, clearTokens };
