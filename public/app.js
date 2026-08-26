/* ============================================================
   MonCRM — CRM avec réception automatique des e-mails et messages WhatsApp.
   Les données vivent côté serveur (voir server.js) ; ce fichier ne fait
   que lire/écrire via l'API et afficher l'interface.
   ============================================================ */

const STAGES = [
  { key: 'prospection',   label: 'Prospection',    css: 'stage-prospection',   var: '--series-1' },
  { key: 'qualification', label: 'Qualification',  css: 'stage-qualification', var: '--series-7' },
  { key: 'proposition',   label: 'Proposition',    css: 'stage-proposition',   var: '--series-4' },
  { key: 'negociation',   label: 'Négociation',    css: 'stage-negociation',   var: '--series-2' },
  { key: 'gagne',         label: 'Gagné',          css: 'stage-gagne',         var: '--status-good' },
  { key: 'perdu',         label: 'Perdu',          css: 'stage-perdu',         var: '--status-critical' },
];

const TASK_TYPES = [
  { key: 'appel', label: 'Appel' },
  { key: 'email', label: 'E-mail' },
  { key: 'rdv',   label: 'Rendez-vous' },
  { key: 'autre', label: 'Autre' },
];

const CHANNELS = [
  { key: 'email',    label: 'E-mail',    css: 'channel-email' },
  { key: 'appel',    label: 'Appel',     css: 'channel-appel' },
  { key: 'sms',      label: 'SMS',       css: 'channel-sms' },
  { key: 'whatsapp', label: 'WhatsApp',  css: 'channel-whatsapp' },
  { key: 'autre',    label: 'Autre',     css: 'channel-autre' },
];

const VIEW_TITLES = {
  dashboard: 'Tableau de bord',
  messages: 'Messages',
  contacts: 'Contacts',
  companies: 'Entreprises',
  pipeline: 'Pipeline de vente',
  tasks: 'Tâches & rappels',
  integrations: 'Intégrations',
};

/* ---------- State ---------- */
let DATA = { contacts: [], companies: [], deals: [], tasks: [], messages: [] };
let currentView = 'dashboard';
let searchTerm = '';
let draggedDealId = null;
let integrationsStatus = { gmail: {}, whatsapp: {} };

/* ---------- Persistence (via l'API du serveur) ---------- */
async function loadData() {
  const res = await fetch('/api/data');
  if (res.status === 401) { showAuthGate(); throw new Error('Session expirée.'); }
  if (!res.ok) throw new Error('Impossible de charger les données.');
  return res.json();
}

function persist(data = DATA) {
  // Écriture "fire-and-forget" : l'interface reflète déjà l'état local
  // mutée avant cet appel, on synchronise le serveur en arrière-plan.
  fetch('/api/data', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  }).catch(() => showToast("Échec de synchronisation avec le serveur."));
}

async function fetchIntegrationsStatus() {
  const res = await fetch('/api/integrations/status');
  integrationsStatus = await res.json();
  return integrationsStatus;
}

function uid() {
  return (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now() + '-' + Math.random().toString(16).slice(2));
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function addHours(n) {
  const d = new Date(Date.now() + n * 3600000);
  const pad = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/* ---------- Helpers: lookups & formatting ---------- */
const findCompany = id => DATA.companies.find(c => c.id === id);
const findContact = id => DATA.contacts.find(c => c.id === id);
const findDeal = id => DATA.deals.find(d => d.id === id);
const stageInfo = key => STAGES.find(s => s.key === key) || STAGES[0];
const channelInfo = key => CHANNELS.find(c => c.key === key) || CHANNELS[CHANNELS.length - 1];

function fmtMoney(n) {
  const num = Number(n) || 0;
  return num.toLocaleString('fr-FR', { maximumFractionDigits: 0 }) + ' €';
}
function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso + 'T00:00:00');
  if (isNaN(d)) return '—';
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
}
function fmtDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return '—';
  const sameDay = d.toDateString() === new Date().toDateString();
  const time = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  if (sameDay) return `Aujourd'hui ${time}`;
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }) + ' ' + time;
}
function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function contactFullName(c) {
  return c ? `${c.firstName} ${c.lastName}`.trim() : '';
}
function truncate(str, max) {
  const s = String(str ?? '');
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}
function initials(name) {
  return (name || '?').split(' ').filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');
}

/* ---------- Toast ---------- */
let toastTimer = null;
function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
}

/* ---------- Navigation ---------- */
function setView(view) {
  currentView = view;
  document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  document.querySelectorAll('.view').forEach(v => v.hidden = true);
  document.getElementById('view-' + view).hidden = false;
  document.getElementById('viewTitle').textContent = VIEW_TITLES[view];
  const search = document.getElementById('globalSearch');
  search.placeholder = {
    dashboard: 'Rechercher un contact, une entreprise…',
    messages: 'Rechercher un message…',
    contacts: 'Rechercher un contact…',
    companies: 'Rechercher une entreprise…',
    pipeline: 'Rechercher une opportunité…',
    tasks: 'Rechercher une tâche…',
    integrations: '',
  }[view];
  search.hidden = view === 'integrations';
  renderCurrentView();
}

function renderCurrentView() {
  if (currentView === 'dashboard') renderDashboard();
  else if (currentView === 'messages') renderMessages();
  else if (currentView === 'contacts') renderContacts();
  else if (currentView === 'companies') renderCompanies();
  else if (currentView === 'pipeline') renderPipeline();
  else if (currentView === 'tasks') renderTasks();
  else if (currentView === 'integrations') renderIntegrations();
}

/* ============================================================
   DASHBOARD
   ============================================================ */
function renderDashboard() {
  const el = document.getElementById('view-dashboard');
  const activeDeals = DATA.deals.filter(d => d.stage !== 'gagne' && d.stage !== 'perdu');
  const wonDeals = DATA.deals.filter(d => d.stage === 'gagne');
  const pipelineValue = activeDeals.reduce((s, d) => s + Number(d.value || 0), 0);
  const wonValue = wonDeals.reduce((s, d) => s + Number(d.value || 0), 0);
  const closedCount = wonDeals.length + DATA.deals.filter(d => d.stage === 'perdu').length;
  const conversionRate = closedCount ? Math.round((wonDeals.length / closedCount) * 100) : 0;
  const overdueTasks = DATA.tasks.filter(t => !t.done && t.dueDate < todayISO());

  const maxStageValue = Math.max(1, ...STAGES.map(s => DATA.deals.filter(d => d.stage === s.key).reduce((sum, d) => sum + Number(d.value || 0), 0)));

  const barsHtml = STAGES.map(s => {
    const val = DATA.deals.filter(d => d.stage === s.key).reduce((sum, d) => sum + Number(d.value || 0), 0);
    const pct = Math.round((val / maxStageValue) * 100);
    return `
      <div class="barchart-row">
        <span class="label">${s.label}</span>
        <div class="barchart-track"><div class="barchart-fill" style="width:${pct}%; background:var(${s.var})"></div></div>
        <span class="amount">${fmtMoney(val)}</span>
      </div>`;
  }).join('');

  const upcomingTasks = DATA.tasks
    .filter(t => !t.done)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .slice(0, 5);

  const upcomingHtml = upcomingTasks.length ? upcomingTasks.map(t => {
    const badge = taskBadge(t);
    return `<div class="mini-row">
      <div>
        <div class="primary">${escapeHtml(t.title)}</div>
        <div class="secondary">${fmtDate(t.dueDate)} · ${relatedLabel(t)}</div>
      </div>
      ${badge}
    </div>`;
  }).join('') : `<div class="mini-row"><span class="secondary">Aucune tâche à venir 🎉</span></div>`;

  const recentMessages = [...DATA.messages].sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, 5);
  const recentMessagesHtml = recentMessages.length ? recentMessages.map(m => {
    const c = findContact(m.contactId);
    const ch = channelInfo(m.channel);
    return `<div class="mini-row">
      <div>
        <div class="primary">${c ? escapeHtml(contactFullName(c)) : 'Contact supprimé'}</div>
        <div class="secondary">${escapeHtml(truncate(m.content, 70))} · ${fmtDateTime(m.date)}</div>
      </div>
      <span class="badge ${ch.css}">${m.direction === 'entrant' ? '↙' : '↗'} ${ch.label}</span>
    </div>`;
  }).join('') : `<div class="mini-row"><span class="secondary">Aucun message pour l'instant.</span></div>`;

  const recentDeals = [...DATA.deals].sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '')).slice(0, 5);
  const recentDealsHtml = recentDeals.length ? recentDeals.map(d => {
    const comp = findCompany(d.companyId);
    const si = stageInfo(d.stage);
    return `<div class="mini-row">
      <div>
        <div class="primary">${escapeHtml(d.title)}</div>
        <div class="secondary">${comp ? escapeHtml(comp.name) : 'Sans entreprise'}</div>
      </div>
      <span class="badge ${si.css}">${si.label}</span>
    </div>`;
  }).join('') : `<div class="mini-row"><span class="secondary">Aucune opportunité pour l'instant.</span></div>`;

  el.innerHTML = `
    <div class="stat-grid">
      <div class="stat-tile accent-1">
        <div class="label">Contacts</div>
        <div class="value">${DATA.contacts.length}</div>
        <div class="sub">${DATA.companies.length} entreprise(s)</div>
      </div>
      <div class="stat-tile">
        <div class="label">Opportunités actives</div>
        <div class="value">${activeDeals.length}</div>
        <div class="sub">${fmtMoney(pipelineValue)} en cours</div>
      </div>
      <div class="stat-tile accent-good">
        <div class="label">Valeur gagnée</div>
        <div class="value">${fmtMoney(wonValue)}</div>
        <div class="sub">Taux de conversion : ${conversionRate}%</div>
      </div>
      <div class="stat-tile ${overdueTasks.length ? 'accent-critical' : ''}">
        <div class="label">Tâches en retard</div>
        <div class="value">${overdueTasks.length}</div>
        <div class="sub">${DATA.tasks.filter(t => !t.done).length} tâche(s) ouverte(s)</div>
      </div>
    </div>

    <div class="dash-grid">
      <div class="panel">
        <div class="panel-head"><h2>Valeur du pipeline par étape</h2></div>
        <div class="barchart">${barsHtml}</div>
      </div>
      <div class="panel">
        <div class="panel-head"><h2>Prochaines tâches</h2></div>
        <div class="mini-list">${upcomingHtml}</div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-head"><h2>Derniers messages</h2><button class="btn secondary small" data-action="new-message">+ Nouveau message</button></div>
      <div class="mini-list">${recentMessagesHtml}</div>
    </div>

    <div class="panel">
      <div class="panel-head"><h2>Opportunités récentes</h2></div>
      <div class="mini-list">${recentDealsHtml}</div>
    </div>
  `;
}

function taskBadge(t) {
  if (t.done) return `<span class="badge task-done">Terminée</span>`;
  if (t.dueDate < todayISO()) return `<span class="badge task-overdue">En retard</span>`;
  if (t.dueDate === todayISO()) return `<span class="badge task-today">Aujourd'hui</span>`;
  return `<span class="badge task-upcoming">À venir</span>`;
}

function relatedLabel(t) {
  if (t.relatedType === 'contact') { const c = findContact(t.relatedId); return c ? 'Contact : ' + contactFullName(c) : 'Contact supprimé'; }
  if (t.relatedType === 'company') { const c = findCompany(t.relatedId); return c ? 'Entreprise : ' + c.name : 'Entreprise supprimée'; }
  if (t.relatedType === 'deal') { const d = findDeal(t.relatedId); return d ? 'Opportunité : ' + d.title : 'Opportunité supprimée'; }
  return 'Sans lien';
}

/* ============================================================
   MESSAGES (boîte de réception centralisée)
   ============================================================ */
function renderMessages() {
  const el = document.getElementById('view-messages');
  const term = searchTerm.trim().toLowerCase();

  const list = [...DATA.messages]
    .filter(m => {
      if (!term) return true;
      const c = findContact(m.contactId);
      return `${m.content} ${contactFullName(c)}`.toLowerCase().includes(term);
    })
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  const groups = groupMessagesByDay(list);
  const groupsHtml = groups.map(g => `
    <div class="task-group">
      <div class="task-group-title">${g.label}</div>
      ${g.items.map(messageRowHtml).join('')}
    </div>
  `).join('');

  el.innerHTML = `
    <div class="toolbar">
      <div class="field-hint">${DATA.messages.length} message(s) au total, tous contacts confondus</div>
      <button class="btn" data-action="new-message">+ Nouveau message</button>
    </div>
    <div class="panel">
      ${list.length ? groupsHtml : emptyState('💬', 'Aucun message', term ? 'Aucun résultat pour votre recherche.' : "Enregistrez vos échanges (e-mail, appel, SMS, WhatsApp…) pour tout retrouver au même endroit.", 'new-message', '+ Nouveau message')}
    </div>
  `;
}

function groupMessagesByDay(list) {
  const today = new Date().toDateString();
  const yesterday = new Date(Date.now() - 86400000).toDateString();
  const groups = [];
  const byLabel = new Map();
  list.forEach(m => {
    const d = new Date(m.date);
    const key = isNaN(d) ? 'Date inconnue' : d.toDateString();
    let label;
    if (key === today) label = "Aujourd'hui";
    else if (key === yesterday) label = 'Hier';
    else if (isNaN(d)) label = 'Date inconnue';
    else label = d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
    if (!byLabel.has(label)) { byLabel.set(label, []); groups.push({ label, items: byLabel.get(label) }); }
    byLabel.get(label).push(m);
  });
  return groups;
}

function messageRowHtml(m) {
  const c = findContact(m.contactId);
  const comp = c ? findCompany(c.companyId) : null;
  const ch = channelInfo(m.channel);
  const time = isNaN(new Date(m.date)) ? '' : new Date(m.date).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const unknown = !c && m.fromRaw;
  const title = c
    ? `${escapeHtml(contactFullName(c))}${comp ? ` · ${escapeHtml(comp.name)}` : ''}`
    : unknown
      ? `Expéditeur inconnu · ${escapeHtml(m.fromRaw)}`
      : 'Contact supprimé';
  return `<div class="task-row" ${unknown ? '' : `data-action="edit-message" data-id="${m.id}" style="cursor:pointer"`}>
    <span class="badge ${ch.css}" title="${m.direction === 'entrant' ? 'Message reçu' : 'Message envoyé'}">${m.direction === 'entrant' ? '↙' : '↗'} ${ch.label}</span>
    <div class="task-body">
      <div class="task-title">${title}</div>
      <div class="task-meta"><span>${escapeHtml(m.content)}</span></div>
    </div>
    <div class="field-hint" style="white-space:nowrap">${time}</div>
    ${unknown ? `<button class="btn secondary small" data-action="assign-message" data-id="${m.id}">Assigner</button>` : ''}
    <button class="icon-btn" data-action="delete-message" data-id="${m.id}" title="Supprimer">${ICON_TRASH}</button>
  </div>`;
}

function messageFormHtml(m) {
  const contactOptions = DATA.contacts.map(c => `<option value="${c.id}" ${m && m.contactId === c.id ? 'selected' : ''}>${escapeHtml(contactFullName(c))}</option>`).join('');
  const channelOptions = CHANNELS.map(c => `<option value="${c.key}" ${m && m.channel === c.key ? 'selected' : ''}>${c.label}</option>`).join('');
  const direction = m?.direction || 'entrant';
  return `
    <div class="field"><label>Contact *</label><select name="contactId" required><option value="">— Choisir —</option>${contactOptions}</select></div>
    <div class="field-row">
      <div class="field"><label>Canal</label><select name="channel">${channelOptions}</select></div>
      <div class="field"><label>Sens</label>
        <select name="direction">
          <option value="entrant" ${direction === 'entrant' ? 'selected' : ''}>Reçu</option>
          <option value="sortant" ${direction === 'sortant' ? 'selected' : ''}>Envoyé</option>
        </select>
      </div>
    </div>
    <div class="field"><label>Date et heure</label><input type="datetime-local" name="date" value="${m?.date || addHours(0)}"></div>
    <div class="field"><label>Message *</label><textarea name="content" required>${escapeHtml(m?.content || '')}</textarea></div>
    ${!m ? `<div class="field-hint">Un nouveau message "Envoyé" par e-mail ou WhatsApp est réellement transmis au contact via l'intégration connectée. Les autres cas (reçu, appel, SMS…) sont simplement enregistrés dans l'historique.</div>` : ''}
  `;
}

function openMessageModal(id) {
  const existing = id ? DATA.messages.find(x => x.id === id) : null;
  openModal({
    title: existing ? 'Modifier le message' : 'Nouveau message',
    bodyHtml: messageFormHtml(existing),
    submitLabel: existing ? 'Enregistrer' : 'Ajouter',
    extraFootHtml: existing ? `<button type="button" class="btn danger small" data-action="delete-message" data-id="${existing.id}" style="margin-right:auto">Supprimer</button>` : '',
    onSubmit: (fd) => {
      const payload = {
        contactId: fd.get('contactId'),
        channel: fd.get('channel'),
        direction: fd.get('direction'),
        date: fd.get('date') || addHours(0),
        content: fd.get('content').trim(),
      };
      if (!payload.contactId || !payload.content) return false;

      if (existing) {
        Object.assign(existing, payload);
        persist();
        renderCurrentView();
        showToast('Message mis à jour.');
        return true;
      }

      const isRealSend = payload.direction === 'sortant' && (payload.channel === 'email' || payload.channel === 'whatsapp');
      if (isRealSend) {
        sendRealMessage(payload).then((ok) => {
          if (ok) { renderCurrentView(); showToast('Message envoyé.'); }
        });
      } else {
        DATA.messages.push({ id: uid(), createdAt: todayISO(), ...payload });
        persist();
        renderCurrentView();
        showToast('Message ajouté.');
      }
      return true;
    },
  });
}

async function sendRealMessage(payload) {
  const endpoint = payload.channel === 'email' ? '/api/messages/send-email' : '/api/messages/send-whatsapp';
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contactId: payload.contactId, content: payload.content }),
    });
    const body = await res.json();
    if (!res.ok) { showToast(body.error || "Échec de l'envoi."); return false; }
    DATA = body.data;
    return true;
  } catch (e) {
    showToast('Serveur injoignable — le message n\'a pas été envoyé.');
    return false;
  }
}

function deleteMessage(id) {
  const m = DATA.messages.find(x => x.id === id);
  if (!m) return;
  confirmModal('Supprimer ce message ?', () => {
    DATA.messages = DATA.messages.filter(x => x.id !== id);
    persist();
    closeModal();
    renderCurrentView();
    showToast('Message supprimé.');
  });
}

function openAssignMessageModal(id) {
  const m = DATA.messages.find(x => x.id === id);
  if (!m) return;
  const contactOptions = DATA.contacts.map(c => `<option value="${c.id}">${escapeHtml(contactFullName(c))}</option>`).join('');
  openModal({
    title: 'Assigner ce message',
    bodyHtml: `
      <p class="confirm-text">Expéditeur : <strong>${escapeHtml(m.fromRaw || '')}</strong></p>
      <div class="field"><label>Associer au contact *</label><select name="contactId" required><option value="">— Choisir —</option>${contactOptions}</select></div>
    `,
    submitLabel: 'Assigner',
    onSubmit: (fd) => {
      const contactId = fd.get('contactId');
      if (!contactId) return false;
      m.contactId = contactId;
      m.fromRaw = null;
      persist();
      renderCurrentView();
      showToast('Message assigné.');
      return true;
    },
  });
}

/* ============================================================
   INTÉGRATIONS
   ============================================================ */
async function renderIntegrations() {
  const el = document.getElementById('view-integrations');
  el.innerHTML = `<div class="panel"><p class="confirm-text">Chargement du statut…</p></div>`;
  let status;
  try {
    status = await fetchIntegrationsStatus();
  } catch (e) {
    el.innerHTML = `<div class="panel"><p class="confirm-text">Impossible de contacter le serveur pour vérifier le statut des intégrations.</p></div>`;
    return;
  }
  const g = status.gmail || {};
  const w = status.whatsapp || {};

  el.innerHTML = `
    <div class="panel">
      <div class="panel-head"><h2>E-mail (Gmail)</h2></div>
      ${!g.configured ? `
        <p class="confirm-text">Non configuré côté serveur. Ajoutez <code>GOOGLE_CLIENT_ID</code> et <code>GOOGLE_CLIENT_SECRET</code> dans les variables d'environnement (voir SETUP.md), puis redéployez.</p>
      ` : g.connected ? `
        <p class="confirm-text">✅ Connecté en tant que <strong>${escapeHtml(g.email || '')}</strong>.<br>
        Les nouveaux e-mails reçus sont synchronisés automatiquement toutes les 2 minutes.${g.lastSyncAt ? `<br>Dernière synchronisation : ${fmtDateTime(g.lastSyncAt)}.` : ''}</p>
        <button class="btn secondary small" data-action="disconnect-gmail">Déconnecter Gmail</button>
      ` : `
        <p class="confirm-text">Serveur configuré, mais aucun compte Gmail n'est encore connecté.</p>
        <button class="btn small" data-action="connect-gmail">Connecter mon compte Gmail</button>
        <p class="field-hint">Si Google affiche « redirect_uri_mismatch », ajoutez exactement cette adresse dans Google Cloud Console (Identifiants → votre ID client OAuth → URI de redirection autorisés) : <code>${escapeHtml(g.redirectUri || '')}</code></p>
      `}
    </div>

    <div class="panel">
      <div class="panel-head"><h2>WhatsApp (Meta Cloud API)</h2></div>
      ${!w.configured ? `
        <p class="confirm-text">Non configuré côté serveur. Ajoutez <code>WHATSAPP_ACCESS_TOKEN</code>, <code>WHATSAPP_PHONE_NUMBER_ID</code> et <code>WHATSAPP_VERIFY_TOKEN</code> dans les variables d'environnement (voir SETUP.md), puis redéployez.</p>
      ` : `
        <p class="confirm-text">✅ Configuré (identifiant de numéro <strong>${escapeHtml(w.phoneNumberId || '')}</strong>).<br>
        Les messages WhatsApp reçus arrivent automatiquement dans MonCRM.</p>
        <p class="field-hint">URL de webhook à renseigner dans Meta for Developers (WhatsApp → Configuration → Webhook) : <code>${escapeHtml(w.webhookUrl || '')}</code></p>
        <p class="field-hint">⚠️ En mode test Meta, l'envoi de réponses ne fonctionne que vers des numéros ajoutés comme destinataires vérifiés dans le tableau de bord Meta.</p>
      `}
    </div>

    <div class="panel">
      <div class="panel-head"><h2>Correspondance des contacts</h2></div>
      <p class="confirm-text">Un e-mail ou message WhatsApp reçu est automatiquement rattaché au contact dont l'adresse e-mail ou le numéro de téléphone correspond. Si aucun contact ne correspond, le message apparaît dans <strong>Messages</strong> comme « Expéditeur inconnu » — vous pourrez l'assigner à un contact existant en un clic.</p>
    </div>
  `;
}

async function disconnectGmail() {
  await fetch('/api/integrations/gmail/disconnect', { method: 'POST' });
  showToast('Gmail déconnecté.');
  renderIntegrations();
}

/* ============================================================
   CONTACTS
   ============================================================ */
function renderContacts() {
  const el = document.getElementById('view-contacts');
  const term = searchTerm.trim().toLowerCase();
  const list = DATA.contacts
    .filter(c => !term || `${c.firstName} ${c.lastName} ${c.email} ${c.position}`.toLowerCase().includes(term))
    .sort((a, b) => a.lastName.localeCompare(b.lastName));

  const rows = list.map(c => {
    const comp = findCompany(c.companyId);
    return `<tr>
      <td>
        <div class="cell-name">${escapeHtml(contactFullName(c))}</div>
        <div class="cell-sub">${escapeHtml(c.position || '')}</div>
      </td>
      <td>${comp ? escapeHtml(comp.name) : '<span class="cell-sub">—</span>'}</td>
      <td>${c.email ? `<a href="mailto:${escapeHtml(c.email)}">${escapeHtml(c.email)}</a>` : '—'}</td>
      <td>${escapeHtml(c.phone || '—')}</td>
      <td>
        <div class="row-actions">
          <button class="icon-btn" data-action="view-contact-messages" data-id="${c.id}" title="Voir les messages">${ICON_CHAT}</button>
          <button class="icon-btn" data-action="edit-contact" data-id="${c.id}" title="Modifier">${ICON_EDIT}</button>
          <button class="icon-btn" data-action="delete-contact" data-id="${c.id}" title="Supprimer">${ICON_TRASH}</button>
        </div>
      </td>
    </tr>`;
  }).join('');

  el.innerHTML = `
    <div class="toolbar">
      <div class="field-hint">${list.length} contact(s)</div>
      <button class="btn" data-action="new-contact">+ Nouveau contact</button>
    </div>
    <div class="panel">
      ${list.length ? `
      <div class="table-wrap">
        <table>
          <thead><tr><th>Nom</th><th>Entreprise</th><th>E-mail</th><th>Téléphone</th><th></th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>` : emptyState('👤', 'Aucun contact', term ? 'Aucun résultat pour votre recherche.' : 'Ajoutez votre premier contact pour commencer.', 'new-contact', '+ Nouveau contact')}
    </div>
  `;
}

function contactFormHtml(c) {
  const companyOptions = DATA.companies.map(co => `<option value="${co.id}" ${c && c.companyId === co.id ? 'selected' : ''}>${escapeHtml(co.name)}</option>`).join('');
  return `
    <div class="field-row">
      <div class="field"><label>Prénom *</label><input type="text" name="firstName" required value="${escapeHtml(c?.firstName || '')}"></div>
      <div class="field"><label>Nom *</label><input type="text" name="lastName" required value="${escapeHtml(c?.lastName || '')}"></div>
    </div>
    <div class="field"><label>Entreprise</label>
      <select name="companyId"><option value="">— Aucune —</option>${companyOptions}</select>
    </div>
    <div class="field-row">
      <div class="field"><label>E-mail</label><input type="email" name="email" value="${escapeHtml(c?.email || '')}"></div>
      <div class="field"><label>Téléphone</label><input type="tel" name="phone" value="${escapeHtml(c?.phone || '')}"></div>
    </div>
    <div class="field"><label>Poste</label><input type="text" name="position" value="${escapeHtml(c?.position || '')}"></div>
    <div class="field"><label>Notes</label><textarea name="notes">${escapeHtml(c?.notes || '')}</textarea></div>
  `;
}

function openContactModal(id) {
  const existing = id ? findContact(id) : null;
  openModal({
    title: existing ? 'Modifier le contact' : 'Nouveau contact',
    bodyHtml: contactFormHtml(existing),
    submitLabel: existing ? 'Enregistrer' : 'Créer',
    onSubmit: (fd) => {
      const payload = {
        firstName: fd.get('firstName').trim(),
        lastName: fd.get('lastName').trim(),
        companyId: fd.get('companyId') || null,
        email: fd.get('email').trim(),
        phone: fd.get('phone').trim(),
        position: fd.get('position').trim(),
        notes: fd.get('notes').trim(),
      };
      if (!payload.firstName || !payload.lastName) return false;
      if (existing) Object.assign(existing, payload);
      else DATA.contacts.push({ id: uid(), createdAt: todayISO(), ...payload });
      persist();
      renderContacts();
      showToast(existing ? 'Contact mis à jour.' : 'Contact créé.');
      return true;
    },
  });
}

function deleteContact(id) {
  const c = findContact(id);
  if (!c) return;
  confirmModal(`Supprimer le contact « ${contactFullName(c)} » ? Cette action est définitive.`, () => {
    DATA.contacts = DATA.contacts.filter(x => x.id !== id);
    persist();
    renderContacts();
    showToast('Contact supprimé.');
  });
}

/* ============================================================
   COMPANIES
   ============================================================ */
function renderCompanies() {
  const el = document.getElementById('view-companies');
  const term = searchTerm.trim().toLowerCase();
  const list = DATA.companies
    .filter(c => !term || `${c.name} ${c.sector}`.toLowerCase().includes(term))
    .sort((a, b) => a.name.localeCompare(b.name));

  const rows = list.map(c => {
    const contactCount = DATA.contacts.filter(p => p.companyId === c.id).length;
    const dealCount = DATA.deals.filter(d => d.companyId === c.id).length;
    return `<tr>
      <td>
        <div class="cell-name">${escapeHtml(c.name)}</div>
        <div class="cell-sub">${escapeHtml(c.sector || '')}</div>
      </td>
      <td>${escapeHtml(c.website || '—')}</td>
      <td>${escapeHtml(c.phone || '—')}</td>
      <td>${contactCount} contact(s) · ${dealCount} opportunité(s)</td>
      <td>
        <div class="row-actions">
          <button class="icon-btn" data-action="edit-company" data-id="${c.id}" title="Modifier">${ICON_EDIT}</button>
          <button class="icon-btn" data-action="delete-company" data-id="${c.id}" title="Supprimer">${ICON_TRASH}</button>
        </div>
      </td>
    </tr>`;
  }).join('');

  el.innerHTML = `
    <div class="toolbar">
      <div class="field-hint">${list.length} entreprise(s)</div>
      <button class="btn" data-action="new-company">+ Nouvelle entreprise</button>
    </div>
    <div class="panel">
      ${list.length ? `
      <div class="table-wrap">
        <table>
          <thead><tr><th>Entreprise</th><th>Site web</th><th>Téléphone</th><th>Liens</th><th></th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>` : emptyState('🏢', 'Aucune entreprise', term ? 'Aucun résultat pour votre recherche.' : 'Ajoutez votre première entreprise pour commencer.', 'new-company', '+ Nouvelle entreprise')}
    </div>
  `;
}

function companyFormHtml(c) {
  return `
    <div class="field"><label>Nom *</label><input type="text" name="name" required value="${escapeHtml(c?.name || '')}"></div>
    <div class="field-row">
      <div class="field"><label>Secteur</label><input type="text" name="sector" value="${escapeHtml(c?.sector || '')}"></div>
      <div class="field"><label>Site web</label><input type="text" name="website" value="${escapeHtml(c?.website || '')}"></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Téléphone</label><input type="tel" name="phone" value="${escapeHtml(c?.phone || '')}"></div>
      <div class="field"><label>Adresse</label><input type="text" name="address" value="${escapeHtml(c?.address || '')}"></div>
    </div>
    <div class="field"><label>Notes</label><textarea name="notes">${escapeHtml(c?.notes || '')}</textarea></div>
  `;
}

function openCompanyModal(id) {
  const existing = id ? findCompany(id) : null;
  openModal({
    title: existing ? "Modifier l'entreprise" : 'Nouvelle entreprise',
    bodyHtml: companyFormHtml(existing),
    submitLabel: existing ? 'Enregistrer' : 'Créer',
    onSubmit: (fd) => {
      const payload = {
        name: fd.get('name').trim(),
        sector: fd.get('sector').trim(),
        website: fd.get('website').trim(),
        phone: fd.get('phone').trim(),
        address: fd.get('address').trim(),
        notes: fd.get('notes').trim(),
      };
      if (!payload.name) return false;
      if (existing) Object.assign(existing, payload);
      else DATA.companies.push({ id: uid(), createdAt: todayISO(), ...payload });
      persist();
      renderCompanies();
      showToast(existing ? 'Entreprise mise à jour.' : 'Entreprise créée.');
      return true;
    },
  });
}

function deleteCompany(id) {
  const c = findCompany(id);
  if (!c) return;
  const linked = DATA.contacts.filter(p => p.companyId === id).length + DATA.deals.filter(d => d.companyId === id).length;
  const msg = `Supprimer l'entreprise « ${c.name} » ?` + (linked ? ` ${linked} élément(s) lié(s) resteront mais ne seront plus rattachés à une entreprise.` : ' Cette action est définitive.');
  confirmModal(msg, () => {
    DATA.companies = DATA.companies.filter(x => x.id !== id);
    DATA.contacts.forEach(p => { if (p.companyId === id) p.companyId = null; });
    DATA.deals.forEach(d => { if (d.companyId === id) d.companyId = null; });
    persist();
    renderCompanies();
    showToast('Entreprise supprimée.');
  });
}

/* ============================================================
   PIPELINE (Kanban)
   ============================================================ */
function renderPipeline() {
  const el = document.getElementById('view-pipeline');
  const term = searchTerm.trim().toLowerCase();

  const cols = STAGES.map(s => {
    const deals = DATA.deals.filter(d => d.stage === s.key && (!term || dealMatches(d, term)));
    const total = deals.reduce((sum, d) => sum + Number(d.value || 0), 0);
    const cards = deals.map(d => {
      const comp = findCompany(d.companyId);
      return `<div class="deal-card" draggable="true" data-deal-id="${d.id}" data-action="edit-deal" data-id="${d.id}">
        <div class="deal-title">${escapeHtml(d.title)}</div>
        <div class="deal-company">${comp ? escapeHtml(comp.name) : 'Sans entreprise'}</div>
        <div class="deal-meta">
          <span class="deal-value">${fmtMoney(d.value)}</span>
          <span class="deal-date">${fmtDate(d.closeDate)}</span>
        </div>
      </div>`;
    }).join('');
    return `<div class="kanban-col" data-stage="${s.key}">
      <div class="kanban-col-head">
        <span class="title">${s.label}</span>
        <span class="count">${deals.length}</span>
      </div>
      <div class="kanban-col-total">${fmtMoney(total)}</div>
      <div class="kanban-cards" data-stage-drop="${s.key}">${cards}</div>
    </div>`;
  }).join('');

  el.innerHTML = `
    <div class="toolbar">
      <div class="field-hint">Glissez-déposez une opportunité pour changer son étape.</div>
      <button class="btn" data-action="new-deal">+ Nouvelle opportunité</button>
    </div>
    <div class="kanban">${cols}</div>
  `;

  attachKanbanDnD();
}

function dealMatches(d, term) {
  const comp = findCompany(d.companyId);
  const contact = findContact(d.contactId);
  return `${d.title} ${comp?.name || ''} ${contactFullName(contact)}`.toLowerCase().includes(term);
}

function attachKanbanDnD() {
  document.querySelectorAll('.deal-card').forEach(card => {
    card.addEventListener('dragstart', (e) => {
      draggedDealId = card.dataset.dealId;
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    card.addEventListener('dragend', () => card.classList.remove('dragging'));
  });
  document.querySelectorAll('.kanban-col').forEach(col => {
    col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('drag-over'); });
    col.addEventListener('dragleave', () => col.classList.remove('drag-over'));
    col.addEventListener('drop', (e) => {
      e.preventDefault();
      col.classList.remove('drag-over');
      const stage = col.dataset.stage;
      const deal = findDeal(draggedDealId);
      if (deal && deal.stage !== stage) {
        deal.stage = stage;
        deal.updatedAt = todayISO();
        persist();
        renderPipeline();
        showToast(`Opportunité déplacée vers « ${stageInfo(stage).label} ».`);
      }
      draggedDealId = null;
    });
  });
}

function dealFormHtml(d) {
  const companyOptions = DATA.companies.map(co => `<option value="${co.id}" ${d && d.companyId === co.id ? 'selected' : ''}>${escapeHtml(co.name)}</option>`).join('');
  const contactOptions = DATA.contacts.map(p => `<option value="${p.id}" ${d && d.contactId === p.id ? 'selected' : ''}>${escapeHtml(contactFullName(p))}</option>`).join('');
  const stageOptions = STAGES.map(s => `<option value="${s.key}" ${d && d.stage === s.key ? 'selected' : (!d && s.key === 'prospection' ? 'selected' : '')}>${s.label}</option>`).join('');
  return `
    <div class="field"><label>Titre *</label><input type="text" name="title" required value="${escapeHtml(d?.title || '')}"></div>
    <div class="field-row">
      <div class="field"><label>Entreprise</label><select name="companyId"><option value="">— Aucune —</option>${companyOptions}</select></div>
      <div class="field"><label>Contact</label><select name="contactId"><option value="">— Aucun —</option>${contactOptions}</select></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Valeur (€) *</label><input type="number" name="value" min="0" step="1" required value="${d?.value ?? ''}"></div>
      <div class="field"><label>Probabilité (%)</label><input type="number" name="probability" min="0" max="100" step="5" value="${d?.probability ?? 20}"></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Étape</label><select name="stage">${stageOptions}</select></div>
      <div class="field"><label>Date de clôture prévue</label><input type="date" name="closeDate" value="${d?.closeDate || ''}"></div>
    </div>
    <div class="field"><label>Notes</label><textarea name="notes">${escapeHtml(d?.notes || '')}</textarea></div>
  `;
}

function openDealModal(id) {
  const existing = id ? findDeal(id) : null;
  openModal({
    title: existing ? "Modifier l'opportunité" : 'Nouvelle opportunité',
    bodyHtml: dealFormHtml(existing),
    submitLabel: existing ? 'Enregistrer' : 'Créer',
    extraFootHtml: existing ? `<button type="button" class="btn danger small" data-action="delete-deal" data-id="${existing.id}" style="margin-right:auto">Supprimer</button>` : '',
    onSubmit: (fd) => {
      const payload = {
        title: fd.get('title').trim(),
        companyId: fd.get('companyId') || null,
        contactId: fd.get('contactId') || null,
        value: Number(fd.get('value')) || 0,
        probability: Number(fd.get('probability')) || 0,
        stage: fd.get('stage'),
        closeDate: fd.get('closeDate') || '',
        notes: fd.get('notes').trim(),
      };
      if (!payload.title) return false;
      if (existing) Object.assign(existing, payload, { updatedAt: todayISO() });
      else DATA.deals.push({ id: uid(), createdAt: todayISO(), updatedAt: todayISO(), ...payload });
      persist();
      renderPipeline();
      showToast(existing ? 'Opportunité mise à jour.' : 'Opportunité créée.');
      return true;
    },
  });
}

function deleteDeal(id) {
  const d = findDeal(id);
  if (!d) return;
  confirmModal(`Supprimer l'opportunité « ${d.title} » ? Cette action est définitive.`, () => {
    DATA.deals = DATA.deals.filter(x => x.id !== id);
    persist();
    closeModal();
    renderPipeline();
    showToast('Opportunité supprimée.');
  });
}

/* ============================================================
   TASKS
   ============================================================ */
function renderTasks() {
  const el = document.getElementById('view-tasks');
  const term = searchTerm.trim().toLowerCase();
  const all = DATA.tasks.filter(t => !term || t.title.toLowerCase().includes(term));

  const today = todayISO();
  const groups = [
    { title: 'En retard', items: all.filter(t => !t.done && t.dueDate < today) },
    { title: "Aujourd'hui", items: all.filter(t => !t.done && t.dueDate === today) },
    { title: 'À venir', items: all.filter(t => !t.done && t.dueDate > today).sort((a, b) => a.dueDate.localeCompare(b.dueDate)) },
    { title: 'Terminées', items: all.filter(t => t.done).sort((a, b) => b.dueDate.localeCompare(a.dueDate)) },
  ].filter(g => g.items.length);

  const groupsHtml = groups.map(g => `
    <div class="task-group">
      <div class="task-group-title">${g.title} (${g.items.length})</div>
      ${g.items.map(taskRowHtml).join('')}
    </div>
  `).join('');

  el.innerHTML = `
    <div class="toolbar">
      <div class="field-hint">${all.filter(t => !t.done).length} tâche(s) ouverte(s)</div>
      <button class="btn" data-action="new-task">+ Nouvelle tâche</button>
    </div>
    <div class="panel">
      ${all.length ? groupsHtml : emptyState('✅', 'Aucune tâche', term ? 'Aucun résultat pour votre recherche.' : 'Ajoutez une tâche pour organiser vos relances.', 'new-task', '+ Nouvelle tâche')}
    </div>
  `;
}

function taskRowHtml(t) {
  const typeLabel = TASK_TYPES.find(x => x.key === t.type)?.label || 'Autre';
  return `<div class="task-row ${t.done ? 'done' : ''}">
    <button class="task-check ${t.done ? 'checked' : ''}" data-action="toggle-task" data-id="${t.id}" title="Marquer comme ${t.done ? 'à faire' : 'terminée'}">${t.done ? '✓' : ''}</button>
    <div class="task-body" data-action="edit-task" data-id="${t.id}">
      <div class="task-title">${escapeHtml(t.title)}</div>
      <div class="task-meta">
        <span>${typeLabel}</span><span>·</span><span>${fmtDate(t.dueDate)}</span><span>·</span><span>${relatedLabel(t)}</span>
        ${taskBadge(t)}
      </div>
    </div>
    <button class="icon-btn" data-action="delete-task" data-id="${t.id}" title="Supprimer">${ICON_TRASH}</button>
  </div>`;
}

function taskFormHtml(t) {
  const typeOptions = TASK_TYPES.map(x => `<option value="${x.key}" ${t && t.type === x.key ? 'selected' : ''}>${x.label}</option>`).join('');
  const relatedType = t?.relatedType || '';
  return `
    <div class="field"><label>Titre *</label><input type="text" name="title" required value="${escapeHtml(t?.title || '')}"></div>
    <div class="field-row">
      <div class="field"><label>Type</label><select name="type">${typeOptions}</select></div>
      <div class="field"><label>Échéance *</label><input type="date" name="dueDate" required value="${t?.dueDate || todayISO()}"></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Lié à</label>
        <select name="relatedType" id="taskRelatedType">
          <option value="">— Aucun —</option>
          <option value="contact" ${relatedType === 'contact' ? 'selected' : ''}>Contact</option>
          <option value="company" ${relatedType === 'company' ? 'selected' : ''}>Entreprise</option>
          <option value="deal" ${relatedType === 'deal' ? 'selected' : ''}>Opportunité</option>
        </select>
      </div>
      <div class="field"><label>Élément</label><select name="relatedId" id="taskRelatedId">${relatedOptionsHtml(relatedType, t?.relatedId)}</select></div>
    </div>
    <div class="field"><label>Notes</label><textarea name="notes">${escapeHtml(t?.notes || '')}</textarea></div>
  `;
}

function relatedOptionsHtml(type, selectedId) {
  if (type === 'contact') return DATA.contacts.map(c => `<option value="${c.id}" ${c.id === selectedId ? 'selected' : ''}>${escapeHtml(contactFullName(c))}</option>`).join('');
  if (type === 'company') return DATA.companies.map(c => `<option value="${c.id}" ${c.id === selectedId ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('');
  if (type === 'deal') return DATA.deals.map(d => `<option value="${d.id}" ${d.id === selectedId ? 'selected' : ''}>${escapeHtml(d.title)}</option>`).join('');
  return '<option value="">—</option>';
}

function openTaskModal(id) {
  const existing = id ? DATA.tasks.find(t => t.id === id) : null;
  openModal({
    title: existing ? 'Modifier la tâche' : 'Nouvelle tâche',
    bodyHtml: taskFormHtml(existing),
    submitLabel: existing ? 'Enregistrer' : 'Créer',
    onSubmit: (fd) => {
      const payload = {
        title: fd.get('title').trim(),
        type: fd.get('type'),
        dueDate: fd.get('dueDate'),
        relatedType: fd.get('relatedType') || null,
        relatedId: fd.get('relatedId') || null,
        notes: fd.get('notes').trim(),
      };
      if (!payload.title || !payload.dueDate) return false;
      if (!payload.relatedType) payload.relatedId = null;
      if (existing) Object.assign(existing, payload);
      else DATA.tasks.push({ id: uid(), done: false, createdAt: todayISO(), ...payload });
      persist();
      renderTasks();
      showToast(existing ? 'Tâche mise à jour.' : 'Tâche créée.');
      return true;
    },
    afterMount: (modalEl) => {
      const typeSel = modalEl.querySelector('#taskRelatedType');
      const idSel = modalEl.querySelector('#taskRelatedId');
      typeSel.addEventListener('change', () => {
        idSel.innerHTML = relatedOptionsHtml(typeSel.value, null);
      });
    },
  });
}

function toggleTask(id) {
  const t = DATA.tasks.find(x => x.id === id);
  if (!t) return;
  t.done = !t.done;
  persist();
  renderTasks();
}

function deleteTask(id) {
  const t = DATA.tasks.find(x => x.id === id);
  if (!t) return;
  confirmModal(`Supprimer la tâche « ${t.title} » ?`, () => {
    DATA.tasks = DATA.tasks.filter(x => x.id !== id);
    persist();
    renderTasks();
    showToast('Tâche supprimée.');
  });
}

/* ============================================================
   Shared UI helpers
   ============================================================ */
const ICON_EDIT = `<svg viewBox="0 0 24 24"><path d="M17 3a2.83 2.83 0 0 1 4 4L7 21l-4 1 1-4Z"/></svg>`;
const ICON_TRASH = `<svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0-1 14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1L5 6"/></svg>`;
const ICON_CHAT = `<svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z"/></svg>`;

function emptyState(icon, title, text, action, actionLabel) {
  return `<div class="empty-state">
    <div class="big">${icon}</div>
    <strong>${title}</strong>
    <p>${text}</p>
    ${action ? `<button class="btn" data-action="${action}">${actionLabel}</button>` : ''}
  </div>`;
}

/* ---------- Modal ---------- */
function openModal({ title, bodyHtml, submitLabel, onSubmit, extraFootHtml = '', afterMount }) {
  const overlay = document.getElementById('modalRoot');
  const box = document.getElementById('modalBox');
  box.innerHTML = `
    <form id="modalForm">
      <div class="modal-head"><h3>${title}</h3><button type="button" class="icon-btn" data-action="close-modal">✕</button></div>
      <div class="modal-body">${bodyHtml}</div>
      <div class="modal-foot">
        ${extraFootHtml}
        <button type="button" class="btn secondary" data-action="close-modal">Annuler</button>
        <button type="submit" class="btn">${submitLabel}</button>
      </div>
    </form>
  `;
  overlay.hidden = false;
  const form = document.getElementById('modalForm');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const ok = onSubmit(fd);
    if (ok !== false) closeModal();
  });
  if (afterMount) afterMount(box);
  const firstInput = form.querySelector('input, select, textarea');
  if (firstInput) setTimeout(() => firstInput.focus(), 30);
}

function confirmModal(text, onConfirm) {
  const overlay = document.getElementById('modalRoot');
  const box = document.getElementById('modalBox');
  box.innerHTML = `
    <div class="modal-head"><h3>Confirmation</h3><button type="button" class="icon-btn" data-action="close-modal">✕</button></div>
    <div class="modal-body"><p class="confirm-text">${text}</p></div>
    <div class="modal-foot">
      <button type="button" class="btn secondary" data-action="close-modal">Annuler</button>
      <button type="button" class="btn danger" id="confirmBtn">Confirmer</button>
    </div>
  `;
  overlay.hidden = false;
  document.getElementById('confirmBtn').addEventListener('click', () => { onConfirm(); closeModal(); });
}

function closeModal() {
  document.getElementById('modalRoot').hidden = true;
  document.getElementById('modalBox').innerHTML = '';
}

/* ============================================================
   Import / Export
   ============================================================ */
function exportData() {
  const blob = new Blob([JSON.stringify(DATA, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `moncrm-export-${todayISO()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  showToast('Export terminé.');
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      if (!parsed || !Array.isArray(parsed.contacts) || !Array.isArray(parsed.companies) || !Array.isArray(parsed.deals) || !Array.isArray(parsed.tasks)) {
        throw new Error('Format invalide');
      }
      if (!Array.isArray(parsed.messages)) parsed.messages = [];
      confirmModal('Importer ce fichier remplacera toutes les données actuelles. Continuer ?', () => {
        DATA = parsed;
        persist();
        renderCurrentView();
        showToast('Import réussi.');
      });
    } catch (e) {
      showToast('Fichier invalide.');
    }
  };
  reader.readAsText(file);
}

/* ============================================================
   Event delegation (single listener for the whole app)
   ============================================================ */
document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-action]');
  if (!t) return;
  const action = t.dataset.action;
  const id = t.dataset.id;

  switch (action) {
    case 'new-message': openMessageModal(); break;
    case 'edit-message': openMessageModal(id); break;
    case 'delete-message': deleteMessage(id); break;
    case 'assign-message': openAssignMessageModal(id); break;

    case 'connect-gmail': window.location.href = '/auth/google'; break;
    case 'disconnect-gmail': disconnectGmail(); break;
    case 'refresh-integrations': renderIntegrations(); break;

    case 'view-contact-messages': {
      const c = findContact(id);
      if (c) {
        searchTerm = contactFullName(c);
        document.getElementById('globalSearch').value = searchTerm;
        setView('messages');
      }
      break;
    }
    case 'new-contact': openContactModal(); break;
    case 'edit-contact': openContactModal(id); break;
    case 'delete-contact': deleteContact(id); break;

    case 'new-company': openCompanyModal(); break;
    case 'edit-company': openCompanyModal(id); break;
    case 'delete-company': deleteCompany(id); break;

    case 'new-deal': openDealModal(); break;
    case 'edit-deal': openDealModal(id); break;
    case 'delete-deal': deleteDeal(id); break;

    case 'new-task': openTaskModal(); break;
    case 'edit-task': openTaskModal(id); break;
    case 'toggle-task': toggleTask(id); break;
    case 'delete-task': deleteTask(id); break;

    case 'close-modal': closeModal(); break;
  }
});

document.querySelectorAll('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => setView(btn.dataset.view));
});

document.getElementById('globalSearch').addEventListener('input', (e) => {
  searchTerm = e.target.value;
  renderCurrentView();
});

document.getElementById('modalRoot').addEventListener('click', (e) => {
  if (e.target.id === 'modalRoot') closeModal();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !document.getElementById('modalRoot').hidden) closeModal();
});

document.getElementById('btnExport').addEventListener('click', exportData);
document.getElementById('btnImport').addEventListener('click', () => document.getElementById('fileImport').click());
document.getElementById('fileImport').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) importData(file);
  e.target.value = '';
});

/* ---------- Synchronisation périodique (reflète les messages reçus automatiquement) ---------- */
const REFRESH_INTERVAL_MS = 20000;
async function refreshFromServer() {
  const modalOpen = !document.getElementById('modalRoot').hidden;
  if (modalOpen) return; // on n'écrase pas un formulaire en cours d'édition
  try {
    const fresh = await loadData();
    if (JSON.stringify(fresh) !== JSON.stringify(DATA)) {
      DATA = fresh;
      renderCurrentView();
    }
  } catch (e) {
    // Le serveur est peut-être temporairement injoignable ; on réessaiera au prochain cycle.
  }
}

function handleOAuthRedirectFlag() {
  const params = new URLSearchParams(window.location.search);
  if (params.has('gmail')) {
    showToast(params.get('gmail') === 'connecte' ? 'Gmail connecté avec succès.' : 'Échec de la connexion à Gmail.');
    window.history.replaceState({}, '', window.location.pathname);
  }
}

/* ============================================================
   Authentification — écran de connexion / création de compte
   ============================================================ */
function showAuthGate() {
  document.getElementById('appRoot').hidden = true;
  document.getElementById('authGate').hidden = false;
}

function hideAuthGate() {
  document.getElementById('authGate').hidden = true;
  document.getElementById('appRoot').hidden = false;
}

let authResetAvailable = false;

function renderAuthGate(mode, errorMsg) {
  const el = document.getElementById('authGate');
  const isSetup = mode === 'setup';
  const isReset = mode === 'reset';

  if (isReset) {
    el.innerHTML = `
      <div class="auth-card">
        <div class="brand"><span class="brand-mark">M</span><span class="brand-name">MonCRM</span></div>
        <h2>Réinitialiser l'accès</h2>
        <p class="lead">Entrez la clé de récupération (définie dans les variables d'environnement de votre serveur, <code>ADMIN_RESET_TOKEN</code>) pour redéfinir votre e-mail et mot de passe.</p>
        <form id="authForm">
          <div class="field"><label>Clé de récupération</label><input type="text" name="resetToken" required autocomplete="off"></div>
          <div class="field"><label>E-mail</label><input type="email" name="email" required autocomplete="username"></div>
          <div class="field"><label>Nouveau mot de passe</label><input type="password" name="password" required minlength="8" autocomplete="new-password"></div>
          ${errorMsg ? `<div class="auth-error">${escapeHtml(errorMsg)}</div>` : ''}
          <button type="submit" class="btn">Réinitialiser et me connecter</button>
        </form>
        <p class="auth-switch"><button type="button" class="link-btn" id="toggleAuthMode">Retour à la connexion</button></p>
      </div>
    `;
    document.getElementById('toggleAuthMode').addEventListener('click', () => renderAuthGate('login'));
    document.getElementById('authForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const payload = { email: fd.get('email').trim(), password: fd.get('password'), resetToken: fd.get('resetToken').trim() };
      try {
        const res = await fetch('/api/auth/reset', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const body = await res.json();
        if (!res.ok) { renderAuthGate('reset', body.error || 'Échec.'); return; }
        hideAuthGate();
        startApp();
      } catch (err) {
        renderAuthGate('reset', 'Serveur injoignable. Réessayez.');
      }
    });
    const firstInputReset = el.querySelector('input');
    if (firstInputReset) setTimeout(() => firstInputReset.focus(), 30);
    return;
  }

  el.innerHTML = `
    <div class="auth-card">
      <div class="brand"><span class="brand-mark">M</span><span class="brand-name">MonCRM</span></div>
      <h2>${isSetup ? 'Créer votre accès' : 'Connexion'}</h2>
      <p class="lead">${isSetup
        ? "Vos données (contacts, messages, e-mails, WhatsApp…) sont désormais protégées par un compte. Choisissez un e-mail et un mot de passe pour sécuriser cet accès — vous seul(e) pourrez vous connecter."
        : "Entrez vos identifiants pour accéder à votre CRM."}</p>
      <form id="authForm">
        <div class="field"><label>E-mail</label><input type="email" name="email" required autocomplete="username"></div>
        <div class="field"><label>Mot de passe</label><input type="password" name="password" required minlength="8" autocomplete="${isSetup ? 'new-password' : 'current-password'}"></div>
        ${errorMsg ? `<div class="auth-error">${escapeHtml(errorMsg)}</div>` : ''}
        <button type="submit" class="btn">${isSetup ? 'Créer mon accès' : 'Se connecter'}</button>
      </form>
      <p class="auth-switch">
        ${isSetup ? 'Vous avez déjà un compte ?' : "Pas encore de compte ?"}
        <button type="button" class="link-btn" id="toggleAuthMode">${isSetup ? 'Se connecter' : 'Créer un accès'}</button>
      </p>
      ${!isSetup && authResetAvailable ? `<p class="auth-switch"><button type="button" class="link-btn" id="forgotPassword">Mot de passe oublié ?</button></p>` : ''}
    </div>
  `;
  document.getElementById('toggleAuthMode').addEventListener('click', () => {
    renderAuthGate(isSetup ? 'login' : 'setup');
  });
  const forgotBtn = document.getElementById('forgotPassword');
  if (forgotBtn) forgotBtn.addEventListener('click', () => renderAuthGate('reset'));
  document.getElementById('authForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const payload = { email: fd.get('email').trim(), password: fd.get('password') };
    try {
      const res = await fetch(isSetup ? '/api/auth/setup' : '/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok) { renderAuthGate(mode, body.error || 'Échec.'); return; }
      hideAuthGate();
      startApp();
    } catch (err) {
      renderAuthGate(mode, 'Serveur injoignable. Réessayez.');
    }
  });
  const firstInput = el.querySelector('input');
  if (firstInput) setTimeout(() => firstInput.focus(), 30);
}

async function logout() {
  await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
  window.location.reload();
}

/* ---------- Démarrage de l'application (une fois authentifié) ---------- */
async function startApp() {
  try {
    DATA = await loadData();
  } catch (e) {
    return; // loadData a déjà géré la redirection si la session a expiré
  }
  handleOAuthRedirectFlag();
  setView('dashboard');
  setInterval(refreshFromServer, REFRESH_INTERVAL_MS);
}

/* ---------- Init : vérifie l'authentification avant tout ---------- */
(async function initAuth() {
  document.getElementById('btnLogout').addEventListener('click', logout);
  try {
    const res = await fetch('/api/auth/status');
    const status = await res.json();
    authResetAvailable = Boolean(status.resetAvailable);
    if (!status.hasAccount) {
      renderAuthGate('setup');
      showAuthGate();
    } else if (!status.authenticated) {
      renderAuthGate('login');
      showAuthGate();
    } else {
      hideAuthGate();
      startApp();
    }
  } catch (e) {
    renderAuthGate('login', 'Impossible de contacter le serveur.');
    showAuthGate();
  }
})();
