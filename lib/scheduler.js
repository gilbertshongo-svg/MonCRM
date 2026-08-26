const store = require('./store');
const gmail = require('./gmail');
const whatsapp = require('./whatsapp');

async function sendDueMessages() {
  const data = store.getData();
  const now = new Date().toISOString();
  const due = data.scheduledMessages.filter((m) => m.status === 'pending' && m.sendAt <= now);

  for (const item of due) {
    const contact = data.contacts.find((c) => c.id === item.contactId);
    try {
      if (!contact) throw new Error('Contact introuvable ou supprimé.');
      if (item.channel === 'email') {
        if (!contact.email) throw new Error("Ce contact n'a plus d'adresse e-mail.");
        await gmail.sendEmail({ to: contact.email, subject: item.subject, content: item.content });
      } else if (item.channel === 'whatsapp') {
        if (!contact.phone) throw new Error("Ce contact n'a plus de numéro de téléphone.");
        await whatsapp.sendMessage({ to: contact.phone, content: item.content });
      } else {
        throw new Error('Canal non pris en charge pour la programmation.');
      }

      await store.mutate((d) => {
        const target = d.scheduledMessages.find((x) => x.id === item.id);
        if (target) { target.status = 'sent'; target.sentAt = new Date().toISOString(); }
        d.messages.push({
          id: 'sched-' + item.id,
          contactId: item.contactId,
          channel: item.channel,
          direction: 'sortant',
          content: (item.subject ? item.subject + ' — ' : '') + item.content,
          date: new Date().toISOString(),
          createdAt: new Date().toISOString(),
        });
      });
    } catch (e) {
      console.error('Échec envoi message programmé', item.id, e.message);
      await store.mutate((d) => {
        const target = d.scheduledMessages.find((x) => x.id === item.id);
        if (target) { target.status = 'failed'; target.error = e.message; }
      });
    }
  }
}

module.exports = { sendDueMessages };
