/* ============================================================
   Petite couche de stockage clé/valeur, indépendante du disque du
   serveur. Utilise Upstash Redis (gratuit, base externe qui survit
   à chaque redéploiement) quand configuré ; sinon, se replie sur un
   fichier local (pratique pour tester sur votre PC).
   ============================================================ */
const fs = require('fs');
const path = require('path');

function isConfigured() {
  return Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}

function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// Format "corps de requête" (recommandé par Upstash pour les valeurs de
// taille variable) plutôt que le format "segments d'URL", qui se heurterait
// à la limite de longueur d'URL à mesure que vos données grossissent.
async function upstashFetch(command) {
  const res = await fetch(process.env.UPSTASH_REDIS_REST_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(command),
  });
  if (!res.ok) throw new Error(`Upstash ${command[0]} a échoué (${res.status})`);
  const body = await res.json();
  return body.result;
}

async function getJSON(key, fallbackFile) {
  if (isConfigured()) {
    try {
      const result = await upstashFetch(['get', key]);
      if (result == null) return null;
      return JSON.parse(result);
    } catch (e) {
      console.error(`Échec lecture Upstash (${key}) :`, e.message);
      return null;
    }
  }
  if (fs.existsSync(fallbackFile)) {
    try { return JSON.parse(fs.readFileSync(fallbackFile, 'utf8')); } catch { return null; }
  }
  return null;
}

async function setJSON(key, value, fallbackFile) {
  const json = JSON.stringify(value);
  if (isConfigured()) {
    try {
      await upstashFetch(['set', key, json]);
      return;
    } catch (e) {
      console.error(`Échec écriture Upstash (${key}), repli sur le fichier local :`, e.message);
    }
  }
  ensureDir(fallbackFile);
  fs.writeFileSync(fallbackFile, json, 'utf8');
}

async function deleteKey(key, fallbackFile) {
  if (isConfigured()) {
    try {
      await upstashFetch(['del', key]);
      return;
    } catch (e) {
      console.error(`Échec suppression Upstash (${key}) :`, e.message);
    }
  }
  if (fs.existsSync(fallbackFile)) fs.unlinkSync(fallbackFile);
}

module.exports = { isConfigured, getJSON, setJSON, deleteKey };
