// Patient sample tracking. A patient enters the sample ID and the last four
// digits of the registered mobile, and sees where the sample is and when the
// report is expected, in plain words. Only the first name, the test name, the
// stage and dates are shown: no partner lab, no references, no other details.
const config = require('./config');
const { fmtDate, getSetting } = require('./util');

// Days from collection to lab receipt, used to estimate before the lab has the sample.
const TRANSIT_DAYS = 2;

// The patient's steps, and the statuses that count as each.
const STEPS = [
  ['Test registered', ['REGISTERED']],
  ['Sample collected', ['COLLECTED', 'PICKUP_SCHEDULED', 'IN_TRANSIT_TO_LAB']],
  ['Received at our lab', ['RECEIVED_AT_LAB']],
  ['Testing', ['IN_HOUSE_PROCESSING', 'DISPATCH_TO_PARTNER_SCHEDULED', 'IN_TRANSIT_TO_PARTNER', 'RECEIVED_AT_PARTNER', 'PARTNER_REPORT_RECEIVED', 'RESULT_READY']],
  ['Expert review', ['REPORT_WHITE_LABELLED', 'REPORT_APPROVED']],
  ['Report ready', ['REPORT_RELEASED']],
  ['Counselling and action plan', ['COUNSELLING_SCHEDULED', 'COUNSELLING_DONE', 'ACTION_PLAN_DRAFTED', 'ACTION_PLAN_APPROVED', 'DELIVERED', 'CLOSED']],
];

const NOW = {
  REGISTERED: 'Your test is registered. Your sample will be collected soon.',
  COLLECTED: 'Your sample has been collected and will be sent to our lab.',
  PICKUP_SCHEDULED: 'A courier pickup is booked to bring your sample to our lab.',
  IN_TRANSIT_TO_LAB: 'Your sample is on its way to our lab.',
  RECEIVED_AT_LAB: 'Our lab has received your sample and checked it in.',
  IN_HOUSE_PROCESSING: 'Your sample is being tested.',
  DISPATCH_TO_PARTNER_SCHEDULED: 'Your sample is being tested.',
  IN_TRANSIT_TO_PARTNER: 'Your sample is being tested.',
  RECEIVED_AT_PARTNER: 'Your sample is being tested.',
  PARTNER_REPORT_RECEIVED: 'Testing is complete. Your report is being prepared.',
  RESULT_READY: 'Testing is complete. Your report is being prepared.',
  REPORT_WHITE_LABELLED: 'Our experts are reviewing your report.',
  REPORT_APPROVED: 'Your report has been approved and will be sent to you shortly.',
  REPORT_RELEASED: 'Your report is ready and has been sent to your email. Next, choose a time for your counselling session.',
  COUNSELLING_SCHEDULED: 'Your report is ready. Your counselling session is booked.',
  COUNSELLING_DONE: 'Counselling is done. Your personalised action plan is being prepared.',
  ACTION_PLAN_DRAFTED: 'Counselling is done. Your personalised action plan is being prepared.',
  ACTION_PLAN_APPROVED: 'Your personalised action plan is ready and will be sent to you shortly.',
  DELIVERED: 'All done. Your report and action plan have been sent to you.',
  CLOSED: 'All done. Your report and action plan have been sent to you.',
  ON_HOLD: 'Your sample is briefly on hold. Our team is on it and will contact you if anything is needed.',
  RECOLLECTION_REQUESTED: 'We need a fresh sample to complete your test. Our team will contact you to arrange it, at no extra cost.',
  REJECTED: 'We need a fresh sample to complete your test. Our team will contact you to arrange it, at no extra cost.',
  CANCELLED: 'This test has been cancelled. Please contact us if you have any questions.',
};

const REPORT_OUT = ['REPORT_RELEASED', 'COUNSELLING_SCHEDULED', 'COUNSELLING_DONE', 'ACTION_PLAN_DRAFTED', 'ACTION_PLAN_APPROVED', 'DELIVERED', 'CLOSED'];

const digits = (s) => String(s || '').replace(/\D/g, '');
const addDays = (d, n) => new Date(d.getTime() + n * 86400000);

// The public link printed in messages.
function link(sampleId) {
  return `${config.publicUrl}/track?id=${encodeURIComponent(sampleId)}`;
}

// Returns the patient view, or null when the ID and mobile digits do not match.
function lookup(db, sampleId, last4, now = new Date()) {
  const id = String(sampleId || '').trim().toUpperCase();
  const tail = digits(last4);
  if (!id || tail.length !== 4) return null;
  const row = db.get(`SELECT s.*, p.full_name, p.mobile, t.name AS test_name, t.tat_days
    FROM samples s JOIN patients p ON p.id = s.patient_id JOIN tests t ON t.id = s.test_id WHERE UPPER(s.sample_id) = ?`, id);
  if (!row || !digits(row.mobile).endsWith(tail)) return null;
  return view(db, row, now);
}

function view(db, s, now) {
  const events = db.all('SELECT to_status, at FROM sample_events WHERE sample_pk = ? ORDER BY at, id', s.id);
  // Where the sample stands on the patient's steps. A sample on hold sits where it was.
  const status = s.status === 'ON_HOLD' ? s.hold_from_status : ['REJECTED', 'RECOLLECTION_REQUESTED'].includes(s.status) ? 'RECEIVED_AT_LAB' : s.status;
  const at = s.status === 'CANCELLED' ? -1 : STEPS.findIndex(([, st]) => st.includes(status));
  const stopped = ['ON_HOLD', 'REJECTED', 'RECOLLECTION_REQUESTED'].includes(s.status);
  const finished = ['DELIVERED', 'CLOSED'].includes(s.status);
  const steps = STEPS.map(([label, st], i) => {
    const first = events.find((e) => st.includes(e.to_status));
    const state = at < 0 ? 'todo' : i < at || (finished && i === at) ? 'done' : i === at ? (stopped ? 'stop' : 'now') : 'todo';
    return { label, state, date: state === 'todo' ? '' : fmtDate(first ? first.at : i === 0 ? s.registered_at : '') };
  });

  // When the report is expected.
  let eta;
  if (s.status === 'CANCELLED') eta = null;
  else if (REPORT_OUT.includes(s.status)) eta = { kind: 'ready', text: 'Your report is ready', date: fmtDate(s.released_at) };
  else if (['REJECTED', 'RECOLLECTION_REQUESTED'].includes(s.status)) eta = { kind: 'wait', text: 'A new date will be shared once we receive the fresh sample' };
  else if (s.tat_due_at) {
    const due = new Date(s.tat_due_at);
    eta = due < now
      ? { kind: 'late', text: 'Taking a little longer than usual. Our team is on it and will update you soon', date: '' }
      : { kind: 'due', text: 'Expected by', date: fmtDate(s.tat_due_at), days: Math.max(1, Math.ceil((due - now) / 86400000)) };
  } else {
    // Lab receipt is expected a couple of days after collection (or from today if not yet collected).
    let arrive = addDays(s.collected_at ? new Date(s.collected_at) : now, TRANSIT_DAYS);
    if (arrive < now) arrive = now;
    const due = addDays(arrive, s.tat_days);
    eta = { kind: 'estimate', text: 'Expected around', date: fmtDate(due.toISOString()), note: 'We confirm the exact date once our lab receives your sample.' };
  }

  const session = REPORT_OUT.includes(s.status)
    ? db.get("SELECT scheduled_at, mode FROM counselling_sessions WHERE sample_pk = ? AND status = 'scheduled' ORDER BY scheduled_at DESC LIMIT 1", s.id)
    : null;

  return {
    sampleId: s.sample_id,
    firstName: s.full_name.trim().split(/\s+/)[0],
    test: s.test_name,
    registered: fmtDate(s.registered_at),
    now: NOW[s.status] || '',
    // 'stop' for hold or a new sample needed, 'off' when cancelled. The internal status is not shown.
    tone: stopped ? 'stop' : s.status === 'CANCELLED' ? 'off' : '',
    steps, eta, session,
    // Used by the page to offer counselling times; not shown.
    bookable: s.status === 'REPORT_RELEASED' || (s.status === 'COUNSELLING_SCHEDULED' && (!session || new Date(session.scheduled_at) - now > 12 * 3600000)),
    counsellorId: s.counsellor_id || null,
    support: { phone: getSetting(db, 'supportPhone'), email: getSetting(db, 'supportEmail') },
  };
}

// Wrong guesses are limited per address so sample IDs cannot be tried one by one.
function limiter({ max = 10, windowMs = 15 * 60000 } = {}) {
  const hits = new Map();
  return {
    blocked(key, now = Date.now()) {
      const h = hits.get(key);
      if (h && now - h.start > windowMs) hits.delete(key);
      return (hits.get(key)?.n || 0) >= max;
    },
    fail(key, now = Date.now()) {
      const h = hits.get(key);
      if (!h || now - h.start > windowMs) hits.set(key, { n: 1, start: now });
      else h.n += 1;
      if (hits.size > 5000) for (const [k, v] of hits) if (now - v.start > windowMs) hits.delete(k);
    },
  };
}

module.exports = { lookup, link, limiter, STEPS, TRANSIT_DAYS };
