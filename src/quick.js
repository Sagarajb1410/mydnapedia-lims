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

// Steps done with one click here, and the steps that open the part of the
// sample page (or the action plan window) where the work is done.
const STEPS = ['collect', 'courier', 'receive', 'onward', 'partner_received', 'in_house'];
const STEP_INFO = {
  collect: { label: 'Collected', hint: 'Mark the sample as collected from the patient.' },
  courier: { label: 'Message courier', hint: 'Book the courier pickup and send them the WhatsApp message.' },
  receive: { label: 'Reached lab', hint: 'Record that the sample has reached the central lab. The TAT clock starts.' },
  onward: { label: 'Send to partner lab', hint: 'Book the dispatch to the partner lab and message the courier.' },
  partner_received: { label: 'Partner lab got it', hint: 'Record that the partner lab has received the sample (today).' },
  in_house: { label: 'Start testing', hint: 'Start in-house processing.' },
  upload_result: { label: 'Upload result', hint: 'Upload the partner lab report or the in-house result PDF.', anchor: 'report' },
  white_label: { label: 'White-label report', hint: 'Convert the result in Report Centre and send the white-labelled report back.', anchor: 'report' },
  approve: { label: 'Approve report', hint: 'Check every page of the white-labelled report and approve it.', anchor: 'report' },
  release: { label: 'Release report', hint: 'Send the approved report to the client.', anchor: 'report' },
  book: { label: 'Book counselling', hint: 'Book the counselling session with the client.', anchor: 'counselling' },
  session: { label: 'Session done', hint: 'After the session, record that it was held and fill the counselling form.', anchor: 'counselling' },
  plan: { label: 'Make action plan', hint: 'Open the action plan window with the report and the counselling form.', plan: true },
  approve_plan: { label: 'Approve plan', hint: 'Check and approve the action plan.', anchor: 'counselling' },
  deliver: { label: 'Send plan', hint: 'Send the approved action plan to the client.', anchor: 'counselling' },
};

// The next pickup slot: the window now running or next, or tomorrow morning.
function nextPickup(now = new Date()) {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: config.timeZone, hour: '2-digit', hour12: false }).format(now));
  if (hour < 12) return { pickupDate: istDate(now), window: tracking.WINDOWS[0] };
  if (hour < 15) return { pickupDate: istDate(now), window: tracking.WINDOWS[1] };
  if (hour < 18) return { pickupDate: istDate(now), window: tracking.WINDOWS[2] };
  return { pickupDate: istDate(new Date(now.getTime() + 86400000)), window: tracking.WINDOWS[0] };
}

// The step a sample is waiting for, as this user sees it. s needs status,
// account_type and the test's route (route or test_route).
function nextStep(user, s) {
  const staff = ['admin', 'lab'].includes(user.role);
  // Counselling is done by the admin and the counsellors.
  const team = ['admin', 'counsellor'].includes(user.role);
  const route = s.route || s.test_route;
  switch (s.status) {
    case 'REGISTERED': return samples.canRegister(user) ? 'collect' : null;
    case 'COLLECTED':
      if (s.account_type !== 'main' && user.role === 'admin') return 'courier';
      return staff ? 'receive' : null;
    case 'PICKUP_SCHEDULED': case 'IN_TRANSIT_TO_LAB': return staff ? 'receive' : null;
    case 'RECEIVED_AT_LAB': return staff ? (route === 'in_house' ? 'in_house' : 'onward') : null;
    case 'DISPATCH_TO_PARTNER_SCHEDULED': case 'IN_TRANSIT_TO_PARTNER': return staff ? 'partner_received' : null;
    case 'RECEIVED_AT_PARTNER': case 'IN_HOUSE_PROCESSING': return staff ? 'upload_result' : null;
    case 'PARTNER_REPORT_RECEIVED': case 'RESULT_READY': return staff ? 'white_label' : null;
    case 'REPORT_WHITE_LABELLED': return user.role === 'admin' ? 'approve' : null;
    case 'REPORT_APPROVED': return user.role === 'admin' ? 'release' : null;
    case 'REPORT_RELEASED': return team ? 'book' : null;
    case 'COUNSELLING_SCHEDULED': return team ? 'session' : null;
    case 'COUNSELLING_DONE': return team ? 'plan' : null;
    case 'ACTION_PLAN_DRAFTED': return user.role === 'admin' ? 'approve_plan' : null;
    case 'ACTION_PLAN_APPROVED': return team ? 'deliver' : null;
    default: return null;
  }
}

// Where an open step's button goes.
function stepHref(step, sampleId) {
  const info = STEP_INFO[step];
  if (info.plan) return `/studio?sample=${encodeURIComponent(sampleId)}&step=plan`;
  return `/samples/${encodeURIComponent(sampleId)}#${info.anchor}`;
}

// Runs one step on the given sample IDs. Returns what happened, sample by sample.
function run(db, user, step, sampleIds) {
  if (!STEPS.includes(step)) throw new UserError('Choose a step.');
  const ids = [...new Set((Array.isArray(sampleIds) ? sampleIds : [sampleIds]).map((x) => String(x || '').trim()).filter(Boolean))];
  if (!ids.length) throw new UserError('Tick at least one sample.');
  const done = [];
  const skipped = [];
  const messages = [];
  if (step === 'onward') {
    const waiting = new Map(tracking.pendingOnward(db).map((s) => [s.sample_id, s]));
    const list = [];
    for (const id of ids) {
      const s = waiting.get(id.toUpperCase());
      if (s) list.push(s); else skipped.push({ id, why: 'is not waiting to go to the partner lab' });
    }
    if (list.length) {
      const r = tracking.scheduleLeg2(db, user, { ...nextPickup(), samplePks: list.map((s) => s.id) });
      const n = db.get("SELECT id FROM notifications WHERE code = 'N7' AND status = 'pending' AND body LIKE ? ORDER BY id DESC LIMIT 1", `%${r.shipmentNo}%`);
      if (n) messages.push(n.id);
      done.push(...list.map((s) => s.sample_id));
    }
    return { step, done, skipped, messages };
  }
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
      const sid = id.toUpperCase();
      if (step === 'collect') samples.collect(db, user, id, {});
      else if (step === 'receive') tracking.receive(db, user, id, { condition: 'Acceptable' });
      else if (step === 'partner_received') tracking.partnerReceived(db, user, sid, { receivedOn: istDate() });
      else tracking.startInHouse(db, user, sid);
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

module.exports = { STEPS, STEP_INFO, nextPickup, nextStep, stepHref, run, openMessage };
