// Sample registration, collection, cancellation and the status timeline.
const { nowIso, istDate, audit, nextCounter, UserError, getSetting } = require('./util');
const billing = require('./billing');
const notify = require('./notify');
const track = require('./track');

// Full lifecycle from guideline section 4. Modules 1 and 2 use the first two
// and the side statuses; the rest are switched on as later modules are built.
const STATUSES = {
  REGISTERED: 'Registered',
  COLLECTED: 'Collected',
  PICKUP_SCHEDULED: 'Pickup scheduled',
  IN_TRANSIT_TO_LAB: 'In transit to lab',
  RECEIVED_AT_LAB: 'Received at lab',
  DISPATCH_TO_PARTNER_SCHEDULED: 'Dispatch to partner lab scheduled',
  IN_TRANSIT_TO_PARTNER: 'In transit to partner lab',
  RECEIVED_AT_PARTNER: 'Received at partner lab',
  PARTNER_REPORT_RECEIVED: 'Partner report received',
  IN_HOUSE_PROCESSING: 'In-house processing',
  RESULT_READY: 'Result ready',
  REPORT_WHITE_LABELLED: 'Report white-labelled',
  REPORT_APPROVED: 'Report approved',
  REPORT_RELEASED: 'Report released',
  COUNSELLING_SCHEDULED: 'Counselling scheduled',
  COUNSELLING_DONE: 'Counselling done',
  ACTION_PLAN_DRAFTED: 'Action plan drafted',
  ACTION_PLAN_APPROVED: 'Action plan approved',
  DELIVERED: 'Delivered',
  CLOSED: 'Closed',
  REJECTED: 'Rejected',
  RECOLLECTION_REQUESTED: 'Recollection requested',
  ON_HOLD: 'On hold',
  CANCELLED: 'Cancelled',
};

// Before the central lab receives a sample, the registering account may still
// edit patient details and a cancellation returns the full amount.
const BEFORE_LAB = ['REGISTERED', 'COLLECTED', 'PICKUP_SCHEDULED', 'IN_TRANSIT_TO_LAB'];

const GENDERS = ['Male', 'Female', 'Other'];
const STATES = [
  'Andaman and Nicobar Islands', 'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chandigarh', 'Chhattisgarh',
  'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jammu and Kashmir',
  'Jharkhand', 'Karnataka', 'Kerala', 'Ladakh', 'Lakshadweep', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya',
  'Mizoram', 'Nagaland', 'Odisha', 'Puducherry', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura',
  'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
];

// Which samples a user may see. Partner and supplier users see only their own
// account's samples; this filter is applied to every query that lists or opens one.
const COUNSELLING_STAGES = ['REPORT_RELEASED', 'COUNSELLING_SCHEDULED', 'COUNSELLING_DONE', 'ACTION_PLAN_DRAFTED', 'ACTION_PLAN_APPROVED', 'DELIVERED', 'CLOSED'];

function scope(user) {
  if (user.role === 'partner') return { sql: 's.account_id = ?', params: [user.account_id] };
  // Counsellors see clients from report release onwards, unassigned or their own.
  if (user.role === 'counsellor') {
    return { sql: `s.status IN (${COUNSELLING_STAGES.map(() => '?').join(',')}) AND (s.counsellor_id IS NULL OR s.counsellor_id = ?)`, params: [...COUNSELLING_STAGES, user.id] };
  }
  return { sql: '1 = 1', params: [] };
}

function canRegister(user) {
  return ['admin', 'lab', 'partner'].includes(user.role);
}

function registeringAccount(db, user) {
  if (user.role === 'partner') return db.get('SELECT * FROM accounts WHERE id = ? AND active = 1', user.account_id);
  return db.get("SELECT * FROM accounts WHERE type = 'main' ORDER BY id LIMIT 1");
}

function clean(v) {
  return v == null ? '' : String(v).trim();
}

function validatePatient(p) {
  const out = {
    full_name: clean(p.full_name).replace(/\s+/g, ' '),
    gender: clean(p.gender),
    dob: clean(p.dob),
    mobile: clean(p.mobile).replace(/\D/g, '').replace(/^91(?=\d{10}$)/, ''),
    email: clean(p.email).toLowerCase(),
    address: clean(p.address),
    city: clean(p.city),
    state: clean(p.state),
    pincode: clean(p.pincode),
  };
  if (out.full_name.length < 2) throw new UserError("Enter the patient's full name.");
  if (!GENDERS.includes(out.gender)) throw new UserError('Choose the gender.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(out.dob)) throw new UserError('Enter the date of birth.');
  const today = istDate();
  if (out.dob >= today) throw new UserError('The date of birth is today or in the future. Please check it.');
  const oneYearAgo = String(Number(today.slice(0, 4)) - 1) + today.slice(4);
  if (out.dob > oneYearAgo) throw new UserError('The patient must be at least 1 year old. Please check the date of birth.');
  if (out.dob < '1900-01-01') throw new UserError('Please check the date of birth.');
  if (!/^[6-9]\d{9}$/.test(out.mobile)) throw new UserError('Enter a 10-digit Indian mobile number.');
  if (out.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.email)) throw new UserError('The email address does not look right.');
  if (!out.city) throw new UserError('Enter the city.');
  if (!STATES.includes(out.state)) throw new UserError('Choose the state.');
  if (!/^[1-9]\d{5}$/.test(out.pincode)) throw new UserError('Enter a 6-digit pincode.');
  return out;
}

function newSampleId(db) {
  const yy = istDate().slice(2, 4);
  const n = nextCounter(db, 'sample-' + yy);
  return `${getSetting(db, 'sampleIdPrefix')}${yy}-${String(n).padStart(6, '0')}`;
}

function addEvent(db, samplePk, from, to, userId, note) {
  db.run('INSERT INTO sample_events (sample_pk, from_status, to_status, at, user_id, note) VALUES (?, ?, ?, ?, ?, ?)',
    samplePk, from, to, nowIso(), userId, note || null);
}

// Same mobile, date of birth and test in the last 90 days.
function findDuplicate(db, user, patient, testId) {
  const since = new Date(Date.now() - 90 * 86400000).toISOString();
  const sc = scope(user);
  return db.get(
    `SELECT s.sample_id, s.registered_at FROM samples s JOIN patients p ON p.id = s.patient_id
      WHERE p.mobile = ? AND p.dob = ? AND s.test_id = ? AND s.registered_at >= ? AND s.status != 'CANCELLED' AND ${sc.sql}
      ORDER BY s.id DESC LIMIT 1`,
    patient.mobile, patient.dob, testId, since, ...sc.params,
  );
}

// input: patient fields, test_id, consent, optional collection, and billing extras.
// Returns { sample } or { duplicate } when a duplicate needs a reason first.
function register(db, user, input) {
  if (!canRegister(user)) throw new UserError('You cannot register samples.');
  const account = registeringAccount(db, user);
  if (!account) throw new UserError('Your account is not active. Contact the admin.');
  const patient = validatePatient(input);
  const test = db.get('SELECT * FROM tests WHERE id = ? AND active = 1', Number(input.test_id));
  if (!test) throw new UserError('Choose a test.');
  if (input.consent_testing !== 'yes') throw new UserError('The patient must consent to the test before it can be registered.');
  const consentMethod = clean(input.consent_method);
  if (!['Signed form', 'Confirmed verbally by patient'].includes(consentMethod)) throw new UserError('Choose how consent was taken.');

  const duplicate = findDuplicate(db, user, patient, test.id);
  const dupReason = clean(input.duplicate_reason);
  if (duplicate && !dupReason) return { duplicate };

  const collectedNow = input.collected_now === 'yes';
  const collector = clean(input.collector);
  if (collectedNow && !collector) throw new UserError('Enter who collected the sample.');

  return db.tx(() => {
    const now = nowIso();
    const patientId = Number(db.run(
      `INSERT INTO patients (full_name, gender, dob, mobile, email, address, city, state, pincode, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      patient.full_name, patient.gender, patient.dob, patient.mobile, patient.email || null, patient.address || null,
      patient.city, patient.state, patient.pincode, user.id, now,
    ).lastInsertRowid);
    const sampleId = newSampleId(db);
    const pk = Number(db.run(
      `INSERT INTO samples (sample_id, patient_id, test_id, account_id, registered_by, registered_at, status, partner_ref,
         referring_doctor, clinical_notes, consent_testing, consent_data_use, consent_method, duplicate_reason)
       VALUES (?, ?, ?, ?, ?, ?, 'REGISTERED', ?, ?, ?, 1, ?, ?, ?)`,
      sampleId, patientId, test.id, account.id, user.id, now, clean(input.partner_ref) || null,
      clean(input.referring_doctor) || null, clean(input.clinical_notes) || null,
      input.consent_data_use === 'yes' ? 1 : 0, consentMethod, duplicate ? dupReason : null,
    ).lastInsertRowid);
    addEvent(db, pk, null, 'REGISTERED', user.id, duplicate ? `Possible duplicate of ${duplicate.sample_id}: ${dupReason}` : null);
    const sample = db.get('SELECT * FROM samples WHERE id = ?', pk);

    billing.chargeRegistration(db, {
      sample, account, test, user,
      supplier: input.supplier,
      direct: input.direct,
    });

    if (collectedNow) collect(db, user, sample.sample_id, { collector, collectedAt: now });

    const lab = getSetting(db, 'labName');
    const msg = `${lab}: Dear ${patient.full_name}, your ${test.name} test has been registered. Your sample ID is ${sampleId}. Track your sample any time at ${track.link(sampleId)} using this ID and the last 4 digits of your mobile. For help contact ${getSetting(db, 'supportPhone')}.`;
    notify.queue(db, { code: 'N1', channel: 'whatsapp', recipient: patient.mobile, recipientName: patient.full_name, body: msg, samplePk: pk });
    notify.queue(db, { code: 'N1', channel: 'email', recipient: patient.email, recipientName: patient.full_name, subject: `Your ${test.name} test is registered`, body: msg, samplePk: pk });

    audit(db, user.id, 'sample_registered', 'sample', sampleId, { test: test.code, account: account.code });
    return { sample: db.get('SELECT * FROM samples WHERE id = ?', pk) };
  });
}

function load(db, user, sampleId) {
  const sc = scope(user);
  const s = db.get(`SELECT s.* FROM samples s WHERE s.sample_id = ? AND ${sc.sql}`, sampleId, ...sc.params);
  if (!s) throw new UserError('Sample not found.');
  return s;
}

function collect(db, user, sampleId, { collector, collectedAt }) {
  return db.tx(() => {
    const s = load(db, user, sampleId);
    if (s.status !== 'REGISTERED') throw new UserError(`This sample is already "${STATUSES[s.status]}".`);
    if (!clean(collector)) throw new UserError('Enter who collected the sample.');
    // A form's datetime-local value ("2026-10-05T14:30") is India time.
    const raw = collectedAt || nowIso();
    const when = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(raw) ? new Date(raw + ':00+05:30') : new Date(raw);
    if (Number.isNaN(when.getTime())) throw new UserError('Enter the collection date and time.');
    if (when > new Date(Date.now() + 5 * 60000)) throw new UserError('Collection time cannot be in the future.');
    if (when < new Date(new Date(s.registered_at).getTime() - 60000)) throw new UserError('Collection cannot be before registration.');
    db.run("UPDATE samples SET status = 'COLLECTED', collected_at = ?, collector = ? WHERE id = ?", when.toISOString(), clean(collector), s.id);
    addEvent(db, s.id, s.status, 'COLLECTED', user.id, `Collected by ${clean(collector)}`);
    audit(db, user.id, 'sample_collected', 'sample', s.sample_id, { collector });
  });
}

function canEditPatient(user, sample) {
  if (user.role === 'admin' || user.role === 'lab') return true;
  return user.role === 'partner' && sample.account_id === user.account_id && BEFORE_LAB.includes(sample.status);
}

function editPatient(db, user, sampleId, input) {
  return db.tx(() => {
    const s = load(db, user, sampleId);
    if (!canEditPatient(user, s)) throw new UserError('Patient details can no longer be changed from your account. Contact the lab.');
    const before = db.get('SELECT * FROM patients WHERE id = ?', s.patient_id);
    const p = validatePatient(input);
    db.run('UPDATE patients SET full_name = ?, gender = ?, dob = ?, mobile = ?, email = ?, address = ?, city = ?, state = ?, pincode = ? WHERE id = ?',
      p.full_name, p.gender, p.dob, p.mobile, p.email || null, p.address || null, p.city, p.state, p.pincode, s.patient_id);
    const changed = {};
    for (const k of Object.keys(p)) if ((before[k] || '') !== (p[k] || '')) changed[k] = { from: before[k], to: p[k] };
    if (Object.keys(changed).length) audit(db, user.id, 'patient_edited', 'sample', s.sample_id, changed);
    return changed;
  });
}

// Partners, suppliers and lab staff can cancel only before the central lab has
// received the sample (full credit back). After that only an admin can, and the
// admin chooses how much to give back.
function cancel(db, user, sampleId, { reason, refundPaise }) {
  return db.tx(() => {
    const s = load(db, user, sampleId);
    if (['CANCELLED', 'CLOSED', 'DELIVERED'].includes(s.status)) throw new UserError('This sample cannot be cancelled.');
    if (!clean(reason)) throw new UserError('Give a reason for cancelling.');
    const early = BEFORE_LAB.includes(s.status);
    if (!early && user.role !== 'admin') throw new UserError('The lab has already received this sample. Only an admin can cancel it now.');
    if (user.role === 'counsellor') throw new UserError('You cannot cancel samples.');
    const amount = early ? null : refundPaise;
    billing.reverseForCancellation(db, { sample: s, user, amountPaise: amount, reason: clean(reason) });
    db.run("UPDATE samples SET status = 'CANCELLED', cancel_reason = ? WHERE id = ?", clean(reason), s.id);
    addEvent(db, s.id, s.status, 'CANCELLED', user.id, clean(reason));
    audit(db, user.id, 'sample_cancelled', 'sample', s.sample_id, { reason, amount });
  });
}

module.exports = {
  STATUSES, BEFORE_LAB, GENDERS, STATES, scope, canRegister, registeringAccount, validatePatient,
  register, load, collect, canEditPatient, editPatient, cancel,
};
