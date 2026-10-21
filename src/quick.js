// One-click steps from the Samples list: mark collected, message the courier,
// and mark reached at the central lab, for one sample or every ticked one.
// Each step uses the same rules as the full screens; the defaults (now, the
// person clicking, the next pickup window, acceptable condition) are what the
// full screens would most often be filled with.
const samples = require('./samples');
const tracking = require('./tracking');
const notify = require('./notify');
const config = require('./config');
const { UserError, istDate } = require('./util');

const STEPS = ['collect', 'courier', 'receive'];

// The next pickup slot: the window now running or next, or tomorrow morning.
function nextPickup(now = new Date()) {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: config.timeZone, hour: '2-digit', hour12: false }).format(now));
  if (hour < 12) return { pickupDate: istDate(now), window: tracking.WINDOWS[0] };
  if (hour < 15) return { pickupDate: istDate(now), window: tracking.WINDOWS[1] };
  if (hour < 18) return { pickupDate: istDate(now), window: tracking.WINDOWS[2] };
  return { pickupDate: istDate(new Date(now.getTime() + 86400000)), window: tracking.WINDOWS[0] };
}

// The step a sample is waiting for, as the list shows it to this user.
function nextStep(user, s) {
  const staff = ['admin', 'lab'].includes(user.role);
  if (s.status === 'REGISTERED' && samples.canRegister(user)) return 'collect';
  if (s.status === 'COLLECTED' && s.account_type !== 'main' && user.role === 'admin') return 'courier';
  if (['COLLECTED', 'PICKUP_SCHEDULED', 'IN_TRANSIT_TO_LAB'].includes(s.status) && staff) return 'receive';
  return null;
}

// Runs one step on the given sample IDs. Returns what happened, sample by sample.
function run(db, user, step, sampleIds) {
  if (!STEPS.includes(step)) throw new UserError('Choose a step.');
  const ids = [...new Set((Array.isArray(sampleIds) ? sampleIds : [sampleIds]).map((x) => String(x || '').trim()).filter(Boolean))];
  if (!ids.length) throw new UserError('Tick at least one sample.');
  const done = [];
  const skipped = [];
  const messages = [];
  if (step === 'courier') {
    if (user.role !== 'admin') throw new UserError('Only an admin books courier pickups.');
    const waiting = new Map(tracking.pendingPickups(db).map((s) => [s.sample_id, s]));
    const byAccount = new Map();
    for (const id of ids) {
      const s = waiting.get(id);
      if (!s) { skipped.push({ id, why: 'already has a pickup or does not need one' }); continue; }
      if (!byAccount.has(s.account_id)) byAccount.set(s.account_id, []);
      byAccount.get(s.account_id).push(s);
    }
    // One pickup per location, so the courier gets one message per address.
    for (const list of byAccount.values()) {
      const r = tracking.scheduleLeg1(db, user, { ...nextPickup(), samplePks: list.map((s) => s.id) });
      const n = db.get("SELECT id FROM notifications WHERE code = 'N7' AND status = 'pending' AND body LIKE ? ORDER BY id DESC LIMIT 1", `%${r.shipmentNo}%`);
      if (n) messages.push(n.id);
      done.push(...list.map((s) => s.sample_id));
    }
    return { step, done, skipped, messages };
  }
  for (const id of ids) {
    try {
      if (step === 'collect') samples.collect(db, user, id, {});
      else tracking.receive(db, user, id, { condition: 'Acceptable' });
      done.push(id.toUpperCase());
    } catch (e) {
      if (!(e instanceof UserError)) throw e;
      skipped.push({ id, why: e.message });
    }
  }
  return { step, done, skipped, messages };
}

// The courier's WhatsApp message, opened once: marking it sent as it opens.
function openMessage(db, user, id) {
  if (!['admin', 'lab'].includes(user.role)) throw new UserError('Messages are for staff.');
  const n = db.get("SELECT * FROM notifications WHERE id = ? AND channel = 'whatsapp'", Number(id));
  if (!n) throw new UserError('Message not found.');
  notify.markSent(db, n.id, user.id);
  return notify.whatsappLink(n.recipient, n.body);
}

module.exports = { STEPS, nextPickup, nextStep, run, openMessage };
