// Sample receipt acknowledgements: what the central lab received from each
// partner or franchise on each day, accepted or rejected, with the time,
// the condition, who received it and the expected report date. One
// acknowledgement per account per day (India time), so a box of samples gets
// one document however many barcodes were scanned.
const config = require('./config');
const { UserError, istDate, getSetting } = require('./util');

const STAFF = ['admin', 'lab'];

function ackNo(account, day) {
  return `ACK-${account.code || account.id}-${day.replace(/-/g, '')}`;
}

function link(accountId, day) {
  return `${config.publicUrl}/receipts/${accountId}/${day}`;
}

function canSee(user, accountId) {
  if (STAFF.includes(user.role)) return true;
  return user.role === 'partner' && user.account_id === Number(accountId);
}

// Every sample the lab has received from the account, newest first.
function received(db, accountId) {
  return db.all(
    `SELECT s.id, s.sample_id, s.status, s.received_at, s.receipt_condition, s.reject_reason, s.tat_due_at, s.partner_ref,
            p.full_name, t.name AS test_name,
            (SELECT u.name FROM sample_events e JOIN users u ON u.id = e.user_id
              WHERE e.sample_pk = s.id AND e.to_status IN ('RECEIVED_AT_LAB', 'REJECTED') ORDER BY e.id DESC LIMIT 1) AS received_by
       FROM samples s JOIN patients p ON p.id = s.patient_id JOIN tests t ON t.id = s.test_id
      WHERE s.account_id = ? AND s.received_at IS NOT NULL ORDER BY s.received_at DESC`, accountId)
    .map((r) => ({ ...r, day: istDate(new Date(r.received_at)), accepted: r.receipt_condition === 'Acceptable' }));
}

// One acknowledgement: the account and the samples received that day.
function forDay(db, user, accountId, day) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day || '')) throw new UserError('Choose a valid date.');
  if (!canSee(user, accountId)) throw new UserError('Acknowledgement not found.');
  const account = db.get("SELECT * FROM accounts WHERE id = ? AND type != 'main'", Number(accountId));
  if (!account) throw new UserError('Acknowledgement not found.');
  const rows = received(db, account.id).filter((r) => r.day === day).reverse();
  if (!rows.length) throw new UserError('Nothing was received from this account on that day.');
  return {
    account, day, rows, number: ackNo(account, day),
    accepted: rows.filter((r) => r.accepted).length, rejected: rows.filter((r) => !r.accepted).length,
    lab: getSetting(db, 'labName'), company: getSetting(db, 'companyLegalName'), address: getSetting(db, 'companyAddress'),
    unit: getSetting(db, 'unitLine'), email: getSetting(db, 'supportEmail'),
  };
}

// The list of acknowledgements: a partner sees its own, staff see every account's.
function list(db, user, { accountId } = {}) {
  let accounts;
  if (STAFF.includes(user.role)) {
    accounts = accountId ? db.all("SELECT * FROM accounts WHERE id = ? AND type != 'main'", Number(accountId)) : db.all("SELECT * FROM accounts WHERE type != 'main' ORDER BY name");
  } else if (user.role === 'partner') {
    accounts = db.all('SELECT * FROM accounts WHERE id = ?', user.account_id);
  } else {
    throw new UserError('Receipt acknowledgements are for staff and partners.');
  }
  const out = [];
  for (const a of accounts) {
    const byDay = new Map();
    for (const r of received(db, a.id)) {
      const d = byDay.get(r.day) || { account: a, day: r.day, number: ackNo(a, r.day), accepted: 0, rejected: 0, last: r.received_at };
      if (r.accepted) d.accepted++; else d.rejected++;
      byDay.set(r.day, d);
    }
    out.push(...byDay.values());
  }
  return out.sort((x, y) => (y.day.localeCompare(x.day)) || x.account.name.localeCompare(y.account.name)).slice(0, 200);
}

module.exports = { ackNo, link, forDay, list, canSee };
