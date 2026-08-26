const store = require('./store');
const { phonesMatch } = require('./phone');

const GRAPH_API_VERSION = 'v20.0';

function isConfigured() {
  return Boolean(process.env.FACEBOOK_PAGE_ACCESS_TOKEN && process.env.FACEBOOK_PAGE_ID && process.env.FACEBOOK_LEADS_VERIFY_TOKEN);
}

function getStatus() {
  return {
    configured: isConfigured(),
    pageId: process.env.FACEBOOK_PAGE_ID || null,
    webhookUrl: isConfigured() ? `${process.env.APP_BASE_URL || ''}/webhook/facebook-leads` : null,
  };
}

function verifyWebhookChallenge(query) {
  const mode = query['hub.mode'];
  const token = query['hub.verify_token'];
  const challenge = query['hub.challenge'];
  if (mode === 'subscribe' && token === process.env.FACEBOOK_LEADS_VERIFY_TOKEN) {
    return challenge;
  }
  return null;
}

function fieldMap(fieldData) {
  const out = {};
  (fieldData || []).forEach((f) => {
    out[f.name] = (f.values && f.values[0]) || '';
  });
  return out;
}

function splitName(fullName) {
  const parts = String(fullName || '').trim().split(/\s+/);
  if (parts.length === 0 || !parts[0]) return { firstName: 'Prospect', lastName: 'Facebook' };
  const firstName = parts[0];
  const lastName = parts.slice(1).join(' ') || 'Facebook';
  return { firstName, lastName };
}

async function fetchLeadDetails(leadgenId) {
  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${leadgenId}?access_token=${process.env.FACEBOOK_PAGE_ACCESS_TOKEN}`;
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Échec récupération prospect (${res.status}): ${body}`);
  }
  return res.json();
}

async function processLeadgenEvent(value) {
  const leadgenId = value.leadgen_id;
  if (!leadgenId) return;

  const data = store.getData();
  if (data.contacts.some((c) => c.notes && c.notes.includes(`[leadgen:${leadgenId}]`))) return; // déjà traité

  const lead = await fetchLeadDetails(leadgenId);
  const fields = fieldMap(lead.field_data);
  const email = (fields.email || '').trim().toLowerCase();
  const phone = (fields.phone_number || fields.phone || '').trim();
  const { firstName, lastName } = splitName(fields.full_name || fields.name || `${fields.first_name || ''} ${fields.last_name || ''}`);

  let contact = null;
  if (email) contact = data.contacts.find((c) => (c.email || '').trim().toLowerCase() === email);
  if (!contact && phone) contact = data.contacts.find((c) => c.phone && phonesMatch(c.phone, phone));

  await store.mutate((d) => {
    let target = contact;
    if (!target) {
      target = {
        id: 'lead-' + leadgenId,
        firstName: fields.first_name || firstName,
        lastName: fields.last_name || lastName,
        email,
        phone,
        companyId: null,
        position: '',
        notes: `Prospect issu d'une publicité Facebook/Instagram (formulaire ${value.form_id || ''}). [leadgen:${leadgenId}]`,
        createdAt: new Date().toISOString().slice(0, 10),
      };
      d.contacts.push(target);
    } else {
      const existing = d.contacts.find((c) => c.id === target.id);
      existing.notes = `${existing.notes ? existing.notes + ' ' : ''}[leadgen:${leadgenId}]`;
    }
    d.tasks.push({
      id: 'lead-task-' + leadgenId,
      title: `Contacter ${target.firstName} ${target.lastName} (nouveau prospect Facebook/Instagram)`,
      type: 'appel',
      relatedType: 'contact',
      relatedId: target.id,
      dueDate: new Date().toISOString().slice(0, 10),
      done: false,
      notes: '',
      createdAt: new Date().toISOString().slice(0, 10),
    });
  });
}

async function handleIncomingWebhook(body) {
  const entries = body.entry || [];
  for (const entry of entries) {
    const changes = entry.changes || [];
    for (const change of changes) {
      if (change.field !== 'leadgen') continue;
      try {
        await processLeadgenEvent(change.value);
      } catch (e) {
        console.error('Échec traitement prospect Facebook', e.message);
      }
    }
  }
}

module.exports = { isConfigured, getStatus, verifyWebhookChallenge, handleIncomingWebhook };
