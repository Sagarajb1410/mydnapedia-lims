// Registering an old sample: one the lab collected, received and processed
// before it was entered in the LIMS. It is registered, collected and received
// in one go with the real dates, so the TAT, the monthly report and the
// sample's timeline show when things actually happened. Patients and partners
// are not messaged about events that are long over.
const samples = require('./samples');
const tracking = require('./tracking');
const { UserError, istDate, audit } = require('./util');

const DAY = /^\d{4}-\d{2}-\d{2}$/;
// A date alone is taken as 10 am India time.
const at = (day) => new Date(`${day}T10:00:00+05:30`).toISOString();

function dates(input) {
  const reg = String(input.past_registered || '').trim();
  const col = String(input.past_collected || '').trim() || reg;
  const rec = String(input.past_received || '').trim();
  const today = istDate();
  if (!DAY.test(reg)) throw new UserError('Enter the date the old sample was registered.');
  for (const [label, d] of [['registered', reg], ['collected', col], ['received at the lab', rec]]) {
    if (!d) continue;
    if (!DAY.test(d)) throw new UserError(`Check the date it was ${label}.`);
    if (d > today) throw new UserError(`The date it was ${label} is in the future.`);
    if (d < '2000-01-01') throw new UserError(`Check the date it was ${label}.`);
  }
  if (rec && rec < col) throw new UserError('The lab received it before it was collected. Please check the dates.');
  if (rec && rec < reg) throw new UserError('The lab received it before it was registered. Please check the dates.');
  return { reg, col, rec };
}

function register(db, user, input) {
  if (!['admin', 'lab'].includes(user.role)) throw new UserError('Only MyDNAPedia staff can register old samples.');
  const d = dates(input);
  return db.tx(() => {
    const out = samples.register(db, user, { ...input, collected_now: 'yes', collected_at: at(d.col) }, { registeredAt: at(d.reg) });
    if (out.duplicate) return out;
    const s = out.sample;
    db.run("UPDATE sample_events SET at = ? WHERE sample_pk = ? AND to_status = 'REGISTERED'", at(d.reg), s.id);
    db.run("UPDATE sample_events SET at = ? WHERE sample_pk = ? AND to_status = 'COLLECTED'", at(d.col), s.id);
    if (d.rec) {
      tracking.receive(db, user, s.sample_id, { condition: 'Acceptable', note: 'Old sample entered later', receivedAt: at(d.rec) });
      // No overdue alert to staff for a TAT that ran out before it was entered.
      db.run("UPDATE samples SET tat_warned = 'red' WHERE id = ?", s.id);
    }
    db.run('UPDATE bills SET created_at = ? WHERE sample_pk = ?', at(d.reg), s.id);
    db.run('UPDATE supplier_bills SET created_at = ? WHERE sample_pk = ?', at(d.reg), s.id);
    // The registration and receipt messages are about the past: keep them, skipped.
    db.run("UPDATE notifications SET status = 'skipped', sent_by = ?, sent_at = ? WHERE sample_pk = ? AND status = 'pending'", user.id, new Date().toISOString(), s.id);
    audit(db, user.id, 'old_sample_registered', 'sample', s.sample_id, d);
    return { sample: db.get('SELECT * FROM samples WHERE id = ?', s.id) };
  });
}

module.exports = { register, dates };
