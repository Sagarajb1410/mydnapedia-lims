// Notifications. There is no WhatsApp API account and Stage 1 must not email
// anyone, so every message is written to the outbox. Staff open it from there:
// WhatsApp messages open WhatsApp Web pre-filled, emails open the mail app.
const { nowIso, istDate, getSetting } = require('./util');

const CODES = {
  N1: 'Registration confirmed',
  N2: 'Credit deducted',
  N3: 'Low balance reminder',
  N4: 'Recharge request received',
  N5: 'Recharge approved',
  N16: 'Cancellation and credit reversal',
};

function queue(db, n) {
  if (!n.recipient) return null;
  const r = db.run(
    `INSERT INTO notifications (code, channel, recipient_name, recipient, subject, body, sample_pk, account_id, created_at, day)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    n.code, n.channel, n.recipientName || null, n.recipient, n.subject || null, n.body,
    n.samplePk || null, n.accountId || null, nowIso(), n.day || istDate(),
  );
  return Number(r.lastInsertRowid);
}

// Email and WhatsApp to an account's contact.
function toAccount(db, account, msg) {
  queue(db, { ...msg, channel: 'email', recipient: account.email, recipientName: account.contact_name || account.name, accountId: account.id });
  queue(db, { ...msg, channel: 'whatsapp', recipient: account.phone, recipientName: account.contact_name || account.name, accountId: account.id });
}

function toAdmin(db, msg) {
  queue(db, { ...msg, channel: 'email', recipient: getSetting(db, 'supportEmail'), recipientName: 'Admin' });
}

// Indian mobile numbers are stored as 10 digits; wa.me needs the country code.
function whatsappLink(phone, text) {
  const digits = String(phone || '').replace(/\D/g, '');
  const full = digits.length === 10 ? '91' + digits : digits;
  return `https://wa.me/${full}?text=${encodeURIComponent(text)}`;
}

function mailtoLink(email, subject, body) {
  return `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject || '')}&body=${encodeURIComponent(body)}`;
}

function markSent(db, id, userId) {
  db.run("UPDATE notifications SET status = 'sent', sent_by = ?, sent_at = ? WHERE id = ? AND status = 'pending'", userId, nowIso(), id);
}

function skip(db, id, userId) {
  db.run("UPDATE notifications SET status = 'skipped', sent_by = ?, sent_at = ? WHERE id = ? AND status = 'pending'", userId, nowIso(), id);
}

module.exports = { CODES, queue, toAccount, toAdmin, whatsappLink, mailtoLink, markSent, skip };
