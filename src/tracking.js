// Module 3: sample tracking (guideline section 3.3).
// Leg 1 takes samples from a partner's location to the central lab; leg 2 takes
// partner-lab tests onward. The TAT clock starts at central lab receipt.
// The partner lab is only ever called "Partner lab".
const { nowIso, istDate, audit, nextCounter, UserError, getSetting } = require('./util');
const notify = require('./notify');
const samples = require('./samples');

const CONDITIONS = ['Acceptable', 'Leaked', 'Insufficient', 'Unlabelled', 'Damaged', 'Wrong sample type'];
const WINDOWS = ['9 am to 12 noon', '12 noon to 3 pm', '3 pm to 6 pm'];

// Statuses during which the lab TAT clock runs (receipt to report release).
const TAT_RUNNING = [
  'RECEIVED_AT_LAB', 'DISPATCH_TO_PARTNER_SCHEDULED', 'IN_TRANSIT_TO_PARTNER', 'RECEIVED_AT_PARTNER',
  'PARTNER_REPORT_RECEIVED', 'IN_HOUSE_PROCESSING', 'RESULT_READY', 'REPORT_WHITE_LABELLED', 'REPORT_APPROVED',
];
const NOT_HOLDABLE = ['ON_HOLD', 'CANCELLED', 'CLOSED', 'DELIVERED', 'REJECTED', 'RECOLLECTION_REQUESTED'];

function requireStaff(user) {
  if (!['admin', 'lab'].includes(user.role)) throw new UserError('Only admin and lab staff can do this.');
}
function requireAdmin(user) {
  if (user.role !== 'admin') throw new UserError('Only the admin (main branch) schedules pickups.');
}

const clean = (v) => (v == null ? '' : String(v).trim());

function setStatus(db, sample, to, user, note, extra = {}) {
  const cols = Object.keys(extra);
  db.run(`UPDATE samples SET status = ?${cols.map((c) => `, ${c} = ?`).join('')} WHERE id = ?`, to, ...cols.map((c) => extra[c]), sample.id);
  db.run('INSERT INTO sample_events (sample_pk, from_status, to_status, at, user_id, note) VALUES (?, ?, ?, ?, ?, ?)',
    sample.id, sample.status, to, nowIso(), user.id, note || null);
}

function sampleByPk(db, pk) {
  return db.get('SELECT * FROM samples WHERE id = ?', pk);
}

function newShipmentNo(db) {
  const yy = istDate().slice(2, 4);
  return `SH${yy}-${String(nextCounter(db, 'shipment-' + yy)).padStart(5, '0')}`;
}

function validPickup(input) {
  const date = clean(input.pickupDate);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new UserError('Choose the pickup date.');
  if (date < istDate()) throw new UserError('The pickup date cannot be in the past.');
  const window = clean(input.window);
  if (!WINDOWS.includes(window)) throw new UserError('Choose the pickup time window.');
  return { date, window };
}

function courierMessage(db, { shipmentNo, leg, from, contact, phone, count, date, window, to }) {
  // Never includes patient names or test names.
  return `${getSetting(db, 'labName')} pickup request ${shipmentNo}. ` +
    `Pick up from: ${from}. Contact: ${contact || '-'}${phone ? `, ${phone}` : ''}. ` +
    `Packages: 1 box, ${count} sample${count === 1 ? '' : 's'}. Date: ${date}, ${window}. Deliver to: ${to}. ` +
    `${leg === 2 ? 'Biological samples, keep upright and away from heat.' : 'Please confirm with the tracking number.'}`;
}

function centralLab(db) {
  return getSetting(db, 'companyAddress') || 'MyDNAPedia Central Lab';
}

// ---------- Leg 1: partner location to central lab ----------

// Samples registered by partners and suppliers that have no pickup yet.
function pendingPickups(db) {
  return db.all(
    `SELECT s.*, a.name AS account_name, a.city AS account_city, p.full_name, t.name AS test_name
       FROM samples s JOIN accounts a ON a.id = s.account_id JOIN patients p ON p.id = s.patient_id JOIN tests t ON t.id = s.test_id
      WHERE a.type != 'main' AND s.status IN ('REGISTERED', 'COLLECTED')
        AND NOT EXISTS (SELECT 1 FROM shipment_items i JOIN shipments sh ON sh.id = i.shipment_id
                         WHERE i.sample_pk = s.id AND sh.leg = 1 AND sh.status != 'cancelled')
      ORDER BY a.name, s.id`);
}

function scheduleLeg1(db, user, input) {
  requireAdmin(user);
  const { date, window } = validPickup(input);
  const pks = (input.samplePks || []).map(Number).filter(Boolean);
  if (!pks.length) throw new UserError('Tick at least one sample for this pickup.');
  return db.tx(() => {
    const pending = new Map(pendingPickups(db).map((s) => [s.id, s]));
    const chosen = pks.map((pk) => pending.get(pk));
    if (chosen.some((s) => !s)) throw new UserError('One of the ticked samples already has a pickup or can no longer be picked up. Refresh the page.');
    const accountId = chosen[0].account_id;
    if (chosen.some((s) => s.account_id !== accountId)) throw new UserError('One pickup can only collect from one location.');
    const account = db.get('SELECT * FROM accounts WHERE id = ?', accountId);
    const from = [account.name, account.address, account.name.includes(account.city) ? '' : account.city].filter(Boolean).join(', ');
    const courier = getSetting(db, 'courierName');
    const shipmentNo = newShipmentNo(db);
    const shipmentId = Number(db.run(
      `INSERT INTO shipments (shipment_no, leg, account_id, origin, destination, courier, awb, pickup_date, pickup_window, status, created_by, created_at)
       VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, 'scheduled', ?, ?)`,
      shipmentNo, accountId, from, centralLab(db), courier, clean(input.awb) || null, date, window, user.id, nowIso(),
    ).lastInsertRowid);
    for (const s of chosen) {
      db.run('INSERT INTO shipment_items (shipment_id, sample_pk) VALUES (?, ?)', shipmentId, s.id);
      setStatus(db, s, 'PICKUP_SCHEDULED', user, `Pickup ${shipmentNo} on ${date}, ${window}`);
    }
    notify.toAccount(db, account, {
      code: 'N6',
      subject: `Courier pickup ${shipmentNo} on ${date}`,
      body: `${getSetting(db, 'labName')}: a courier will collect ${chosen.length} sample${chosen.length === 1 ? '' : 's'} from you on ${date}, ${window} (pickup ${shipmentNo}). Please keep them packed with the labels visible.`,
    });
    notify.queue(db, {
      code: 'N7', channel: 'whatsapp', recipient: getSetting(db, 'courierWhatsapp'), recipientName: courier,
      body: courierMessage(db, { shipmentNo, leg: 1, from, contact: account.contact_name, phone: account.phone, count: chosen.length, date, window, to: centralLab(db) }),
    });
    audit(db, user.id, 'pickup_scheduled', 'shipment', shipmentNo, { leg: 1, samples: chosen.map((s) => s.sample_id), date, window });
    return { shipmentId, shipmentNo };
  });
}

function shipment(db, id) {
  const sh = db.get('SELECT * FROM shipments WHERE id = ?', Number(id));
  if (!sh) throw new UserError('Pickup not found.');
  return sh;
}

function shipmentSamples(db, shipmentId) {
  return db.all(
    `SELECT s.*, p.full_name, t.name AS test_name FROM shipment_items i JOIN samples s ON s.id = i.sample_pk
       JOIN patients p ON p.id = s.patient_id JOIN tests t ON t.id = s.test_id WHERE i.shipment_id = ? ORDER BY s.id`, shipmentId);
}

function setAwb(db, user, shipmentId, awb) {
  requireStaff(user);
  const sh = shipment(db, shipmentId);
  db.run('UPDATE shipments SET awb = ? WHERE id = ?', clean(awb) || null, sh.id);
  audit(db, user.id, 'awb_set', 'shipment', sh.shipment_no, { awb });
}

function markPickedUp(db, user, shipmentId) {
  requireStaff(user);
  return db.tx(() => {
    const sh = shipment(db, shipmentId);
    if (sh.status !== 'scheduled') throw new UserError('This pickup has already been marked picked up.');
    const items = shipmentSamples(db, sh.id).filter((s) => s.status !== 'CANCELLED');
    const expected = sh.leg === 1 ? 'PICKUP_SCHEDULED' : 'DISPATCH_TO_PARTNER_SCHEDULED';
    if (sh.leg === 1) {
      const notCollected = items.filter((s) => !s.collected_at);
      if (notCollected.length) {
        throw new UserError(`These samples are not marked collected yet: ${notCollected.map((s) => s.sample_id).join(', ')}. Mark them collected first.`);
      }
    }
    db.run("UPDATE shipments SET status = 'picked_up', picked_up_at = ? WHERE id = ?", nowIso(), sh.id);
    for (const s of items) {
      if (s.status !== expected) continue;
      setStatus(db, s, sh.leg === 1 ? 'IN_TRANSIT_TO_LAB' : 'IN_TRANSIT_TO_PARTNER', user, `Picked up by courier (${sh.shipment_no}${sh.awb ? `, AWB ${sh.awb}` : ''})`);
    }
    audit(db, user.id, 'picked_up', 'shipment', sh.shipment_no);
  });
}

function cancelShipment(db, user, shipmentId, reason) {
  requireAdmin(user);
  if (!clean(reason)) throw new UserError('Give a reason for cancelling the pickup.');
  return db.tx(() => {
    const sh = shipment(db, shipmentId);
    if (sh.status !== 'scheduled') throw new UserError('Only a pickup that has not been picked up can be cancelled.');
    db.run("UPDATE shipments SET status = 'cancelled' WHERE id = ?", sh.id);
    for (const s of shipmentSamples(db, sh.id)) {
      if (sh.leg === 1 && s.status === 'PICKUP_SCHEDULED') setStatus(db, s, s.collected_at ? 'COLLECTED' : 'REGISTERED', user, `Pickup ${sh.shipment_no} cancelled: ${clean(reason)}`);
      if (sh.leg === 2 && s.status === 'DISPATCH_TO_PARTNER_SCHEDULED') setStatus(db, s, 'RECEIVED_AT_LAB', user, `Dispatch ${sh.shipment_no} cancelled: ${clean(reason)}`);
    }
    audit(db, user.id, 'pickup_cancelled', 'shipment', sh.shipment_no, { reason });
  });
}

function closeShipmentIfDone(db, sh) {
  const open = shipmentSamples(db, sh.id).filter((s) =>
    (sh.leg === 1 && ['PICKUP_SCHEDULED', 'IN_TRANSIT_TO_LAB'].includes(s.status)) ||
    (sh.leg === 2 && ['DISPATCH_TO_PARTNER_SCHEDULED', 'IN_TRANSIT_TO_PARTNER'].includes(s.status)));
  if (!open.length && sh.status !== 'delivered') db.run("UPDATE shipments SET status = 'delivered', delivered_at = ? WHERE id = ?", nowIso(), sh.id);
}

// ---------- Central lab receipt ----------

function tatDue(receivedIso, days) {
  return new Date(new Date(receivedIso).getTime() + days * 86400000).toISOString();
}

// Scanning a barcode at the central lab. Samples collected at the central lab
// itself (main account) are received straight from Registered or Collected.
function receive(db, user, sampleId, input) {
  requireStaff(user);
  const condition = clean(input.condition) || 'Acceptable';
  if (!CONDITIONS.includes(condition)) throw new UserError('Choose the condition of the sample.');
  const note = clean(input.note);
  return db.tx(() => {
    const s = db.get('SELECT * FROM samples WHERE sample_id = ?', clean(sampleId).toUpperCase());
    if (!s) throw new UserError(`No sample with ID "${clean(sampleId)}". Check the label.`);
    const account = db.get('SELECT * FROM accounts WHERE id = ?', s.account_id);
    const fromTransit = ['PICKUP_SCHEDULED', 'IN_TRANSIT_TO_LAB'].includes(s.status);
    const local = account.type === 'main' && ['REGISTERED', 'COLLECTED'].includes(s.status);
    if (!fromTransit && !local) {
      if (account.type !== 'main' && ['REGISTERED', 'COLLECTED'].includes(s.status)) {
        // Arrived without a scheduled pickup (for example dropped off by hand). Accept it, but say so.
      } else {
        throw new UserError(`${s.sample_id} is "${samples.STATUSES[s.status]}" and cannot be received now.`);
      }
    }
    if (!s.collected_at) {
      db.run('UPDATE samples SET collected_at = ?, collector = ? WHERE id = ?', s.registered_at, 'Not recorded before receipt', s.id);
    }
    const now = nowIso();
    const inShipment = db.get(
      `SELECT sh.* FROM shipment_items i JOIN shipments sh ON sh.id = i.shipment_id
        WHERE i.sample_pk = ? AND sh.leg = 1 AND sh.status != 'cancelled' ORDER BY sh.id DESC LIMIT 1`, s.id);
    const test = db.get('SELECT * FROM tests WHERE id = ?', s.test_id);
    const patient = db.get('SELECT * FROM patients WHERE id = ?', s.patient_id);
    const lab = getSetting(db, 'labName');
    let result;
    if (condition === 'Acceptable') {
      const due = tatDue(now, test.tat_days);
      setStatus(db, s, 'RECEIVED_AT_LAB', user, `Received in acceptable condition${note ? `. ${note}` : ''}. TAT due ${due.slice(0, 10)}.`,
        { received_at: now, receipt_condition: condition, tat_due_at: due });
      const msg = `${lab}: Dear ${patient.full_name}, your sample ${s.sample_id} has reached our lab and testing has started. We will let you know when your report is ready.`;
      notify.queue(db, { code: 'N8', channel: 'whatsapp', recipient: patient.mobile, recipientName: patient.full_name, body: msg, samplePk: s.id });
      notify.queue(db, { code: 'N8', channel: 'email', recipient: patient.email, recipientName: patient.full_name, subject: 'Your sample has reached our lab', body: msg, samplePk: s.id });
      if (account.type !== 'main') {
        notify.queue(db, { code: 'N8', channel: 'email', recipient: account.email, recipientName: account.contact_name || account.name, accountId: account.id, samplePk: s.id,
          subject: `Sample ${s.sample_id} received at the lab`, body: `${lab}: sample ${s.sample_id} has been received at our lab in good condition.` });
      }
      result = { status: 'RECEIVED_AT_LAB', route: test.route };
    } else {
      const reason = `${condition}${note ? `: ${note}` : ''}`;
      setStatus(db, s, 'REJECTED', user, reason, { received_at: now, receipt_condition: condition, reject_reason: reason });
      const msg = `${lab}: sample ${s.sample_id} (${patient.full_name}) could not be tested because it arrived ${condition.toLowerCase()}. A fresh sample is needed; there is no extra charge. We will arrange the recollection.`;
      if (account.type !== 'main') notify.toAccount(db, account, { code: 'N9', subject: `Fresh sample needed for ${s.sample_id}`, body: msg, samplePk: s.id });
      const pmsg = `${lab}: Dear ${patient.full_name}, we are sorry, your sample ${s.sample_id} could not be tested and a fresh sample is needed, at no extra cost. We will contact you to collect it.`;
      notify.queue(db, { code: 'N9', channel: 'whatsapp', recipient: patient.mobile, recipientName: patient.full_name, body: pmsg, samplePk: s.id });
      result = { status: 'REJECTED' };
    }
    if (inShipment) closeShipmentIfDone(db, inShipment);
    audit(db, user.id, 'sample_received', 'sample', s.sample_id, { condition, note });
    return { ...result, sampleId: s.sample_id, unexpected: !fromTransit && !local, patient: patient.full_name, test: test.name };
  });
}

// Samples expected at the central lab: picked up or scheduled, not yet received.
function expectedAtLab(db) {
  return db.all(
    `SELECT s.sample_id, s.status, a.name AS account_name, sh.shipment_no, sh.pickup_date, sh.status AS shipment_status
       FROM samples s JOIN accounts a ON a.id = s.account_id
       JOIN shipment_items i ON i.sample_pk = s.id JOIN shipments sh ON sh.id = i.shipment_id AND sh.leg = 1 AND sh.status != 'cancelled'
      WHERE s.status IN ('PICKUP_SCHEDULED', 'IN_TRANSIT_TO_LAB') ORDER BY sh.pickup_date, sh.id, s.id`);
}

// ---------- Rejection and recollection ----------

// The original stays on record; a new sample is linked to it at no charge.
function recollect(db, user, sampleId) {
  requireStaff(user);
  return db.tx(() => {
    const s = db.get('SELECT * FROM samples WHERE sample_id = ?', sampleId);
    if (!s) throw new UserError('Sample not found.');
    if (s.status !== 'REJECTED') throw new UserError('Only a rejected sample can be recollected.');
    const yy = istDate().slice(2, 4);
    const newId = `${getSetting(db, 'sampleIdPrefix')}${yy}-${String(nextCounter(db, 'sample-' + yy)).padStart(6, '0')}`;
    const now = nowIso();
    const pk = Number(db.run(
      `INSERT INTO samples (sample_id, patient_id, test_id, account_id, registered_by, registered_at, status, partner_ref, referring_doctor,
         clinical_notes, consent_testing, consent_data_use, consent_method, recollection_of)
       VALUES (?, ?, ?, ?, ?, ?, 'REGISTERED', ?, ?, ?, 1, ?, ?, ?)`,
      newId, s.patient_id, s.test_id, s.account_id, user.id, now, s.partner_ref, s.referring_doctor, s.clinical_notes,
      s.consent_data_use, s.consent_method, s.id,
    ).lastInsertRowid);
    db.run('INSERT INTO sample_events (sample_pk, from_status, to_status, at, user_id, note) VALUES (?, NULL, ?, ?, ?, ?)',
      pk, 'REGISTERED', now, user.id, `Recollection of ${s.sample_id} (${s.reject_reason}). No charge.`);
    const orig = db.get('SELECT * FROM bills WHERE sample_pk = ?', s.id);
    db.run(
      `INSERT INTO bills (bill_no, sample_pk, account_id, price_list, list_price_paise, discount_paise, net_paise, payer, payment_mode, payment_ref, status, created_at)
       VALUES (?, ?, ?, ?, 0, 0, 0, ?, NULL, ?, 'paid', ?)`,
      `B${yy}-${String(nextCounter(db, 'bill-' + yy)).padStart(6, '0')}`, pk, s.account_id, orig ? orig.price_list : 'direct',
      orig ? orig.payer : 'patient', `Free recollection of ${s.sample_id}`, now,
    );
    setStatus(db, s, 'RECOLLECTION_REQUESTED', user, `Fresh sample registered as ${newId}`);
    audit(db, user.id, 'recollection_created', 'sample', s.sample_id, { newSample: newId });
    return newId;
  });
}

// ---------- In-house processing ----------

function startInHouse(db, user, sampleId) {
  requireStaff(user);
  return db.tx(() => {
    const s = db.get('SELECT s.*, t.route FROM samples s JOIN tests t ON t.id = s.test_id WHERE s.sample_id = ?', sampleId);
    if (!s) throw new UserError('Sample not found.');
    if (s.route !== 'in_house') throw new UserError('This test is processed at the partner lab. Send it with an onward dispatch.');
    if (s.status !== 'RECEIVED_AT_LAB') throw new UserError('Only a sample received at the lab can start processing.');
    setStatus(db, s, 'IN_HOUSE_PROCESSING', user, 'In-house processing started');
    audit(db, user.id, 'in_house_started', 'sample', s.sample_id);
  });
}

// ---------- Leg 2: central lab to partner lab ----------

function pendingOnward(db) {
  return db.all(
    `SELECT s.*, p.full_name, t.name AS test_name FROM samples s JOIN tests t ON t.id = s.test_id JOIN patients p ON p.id = s.patient_id
      WHERE s.status = 'RECEIVED_AT_LAB' AND t.route = 'partner_lab' ORDER BY s.received_at`);
}

function scheduleLeg2(db, user, input) {
  requireStaff(user);
  const { date, window } = validPickup(input);
  const pks = (input.samplePks || []).map(Number).filter(Boolean);
  if (!pks.length) throw new UserError('Tick at least one sample to send.');
  return db.tx(() => {
    const ready = new Map(pendingOnward(db).map((s) => [s.id, s]));
    const chosen = pks.map((pk) => ready.get(pk));
    if (chosen.some((s) => !s)) throw new UserError('One of the ticked samples is no longer waiting to be sent. Refresh the page.');
    const to = getSetting(db, 'partnerLabAddress') || 'Partner lab';
    const courier = getSetting(db, 'courierName');
    const shipmentNo = newShipmentNo(db);
    const shipmentId = Number(db.run(
      `INSERT INTO shipments (shipment_no, leg, account_id, origin, destination, courier, awb, pickup_date, pickup_window, status, created_by, created_at)
       VALUES (?, 2, NULL, ?, ?, ?, ?, ?, ?, 'scheduled', ?, ?)`,
      shipmentNo, centralLab(db), 'Partner lab', courier, clean(input.awb) || null, date, window, user.id, nowIso(),
    ).lastInsertRowid);
    for (const s of chosen) {
      db.run('INSERT INTO shipment_items (shipment_id, sample_pk) VALUES (?, ?)', shipmentId, s.id);
      setStatus(db, s, 'DISPATCH_TO_PARTNER_SCHEDULED', user, `Onward dispatch ${shipmentNo} on ${date}, ${window}`);
    }
    notify.queue(db, {
      code: 'N7', channel: 'whatsapp', recipient: getSetting(db, 'courierWhatsapp'), recipientName: courier,
      body: courierMessage(db, { shipmentNo, leg: 2, from: centralLab(db), contact: user.name, phone: user.phone, count: chosen.length, date, window, to }),
    });
    notify.toAdmin(db, { code: 'N10', subject: `Onward dispatch ${shipmentNo}`, body: `${chosen.length} sample(s) booked to go to the partner lab on ${date}, ${window}: ${chosen.map((s) => s.sample_id).join(', ')}.` });
    audit(db, user.id, 'onward_dispatch_scheduled', 'shipment', shipmentNo, { samples: chosen.map((s) => s.sample_id), date, window });
    return { shipmentId, shipmentNo };
  });
}

function partnerReceived(db, user, sampleId, input) {
  requireStaff(user);
  return db.tx(() => {
    const s = db.get('SELECT * FROM samples WHERE sample_id = ?', sampleId);
    if (!s) throw new UserError('Sample not found.');
    if (!['IN_TRANSIT_TO_PARTNER', 'DISPATCH_TO_PARTNER_SCHEDULED'].includes(s.status)) throw new UserError('This sample is not on its way to the partner lab.');
    const raw = clean(input.receivedOn);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || raw > istDate()) throw new UserError('Enter the date the partner lab received it (not in the future).');
    const when = new Date(raw + 'T12:00:00+05:30').toISOString();
    setStatus(db, s, 'RECEIVED_AT_PARTNER', user, `Partner lab received it on ${raw}${clean(input.ref) ? `, their reference ${clean(input.ref)}` : ''}`,
      { partner_received_at: when, partner_lab_ref: clean(input.ref) || null });
    const sh = db.get(`SELECT sh.* FROM shipment_items i JOIN shipments sh ON sh.id = i.shipment_id WHERE i.sample_pk = ? AND sh.leg = 2 AND sh.status != 'cancelled' ORDER BY sh.id DESC LIMIT 1`, s.id);
    if (sh) closeShipmentIfDone(db, sh);
    audit(db, user.id, 'partner_lab_received', 'sample', s.sample_id, input);
  });
}

function atPartnerLab(db) {
  return db.all(
    `SELECT s.*, p.full_name, t.name AS test_name FROM samples s JOIN tests t ON t.id = s.test_id JOIN patients p ON p.id = s.patient_id
      WHERE s.status IN ('DISPATCH_TO_PARTNER_SCHEDULED', 'IN_TRANSIT_TO_PARTNER', 'RECEIVED_AT_PARTNER') ORDER BY s.tat_due_at`);
}

// ---------- Hold ----------

// While on hold the TAT clock stops; on release the due date moves by the paused time.
function hold(db, user, sampleId, reason) {
  requireStaff(user);
  if (!clean(reason)) throw new UserError('Give a reason for the hold.');
  return db.tx(() => {
    const s = db.get('SELECT * FROM samples WHERE sample_id = ?', sampleId);
    if (!s) throw new UserError('Sample not found.');
    if (NOT_HOLDABLE.includes(s.status)) throw new UserError(`A sample that is "${samples.STATUSES[s.status]}" cannot be put on hold.`);
    setStatus(db, s, 'ON_HOLD', user, clean(reason), { hold_from_status: s.status, hold_reason: clean(reason), hold_started_at: nowIso() });
    audit(db, user.id, 'sample_on_hold', 'sample', s.sample_id, { reason });
  });
}

function release(db, user, sampleId) {
  requireStaff(user);
  return db.tx(() => {
    const s = db.get('SELECT * FROM samples WHERE sample_id = ?', sampleId);
    if (!s || s.status !== 'ON_HOLD') throw new UserError('This sample is not on hold.');
    const paused = Date.now() - new Date(s.hold_started_at).getTime();
    const due = s.tat_due_at ? new Date(new Date(s.tat_due_at).getTime() + paused).toISOString() : null;
    const days = Math.round((paused / 86400000) * 10) / 10;
    setStatus(db, s, s.hold_from_status, user, `Hold released after ${days} day(s)${due ? `; TAT due moved to ${due.slice(0, 10)}` : ''}`,
      { hold_from_status: null, hold_reason: null, hold_started_at: null, tat_due_at: due });
    audit(db, user.id, 'sample_hold_released', 'sample', s.sample_id, { pausedMs: paused });
  });
}

// ---------- TAT ----------

function tatState(s, now = Date.now()) {
  if (!s.tat_due_at || !s.received_at) return null;
  const start = new Date(s.received_at).getTime();
  const due = new Date(s.tat_due_at).getTime();
  const at = s.status === 'ON_HOLD' && s.hold_started_at ? new Date(s.hold_started_at).getTime() : now;
  const used = (at - start) / Math.max(due - start, 1);
  const daysLeft = (due - at) / 86400000;
  const level = at > due ? 'red' : used >= 0.75 ? 'amber' : 'green';
  return { used, daysLeft, level, paused: s.status === 'ON_HOLD' };
}

function tatBoard(db) {
  const rows = db.all(
    `SELECT s.*, p.full_name, t.name AS test_name, t.route, a.name AS account_name FROM samples s
       JOIN tests t ON t.id = s.test_id JOIN patients p ON p.id = s.patient_id JOIN accounts a ON a.id = s.account_id
      WHERE s.tat_due_at IS NOT NULL AND (s.status IN (${TAT_RUNNING.map(() => '?').join(',')}) OR (s.status = 'ON_HOLD' AND s.hold_from_status IN (${TAT_RUNNING.map(() => '?').join(',')})))
      ORDER BY s.tat_due_at`, ...TAT_RUNNING, ...TAT_RUNNING);
  return rows.map((r) => ({ ...r, tat: tatState(r) }));
}

// One internal alert when a sample reaches 75% of its TAT, and one when it breaches.
function tatAlerts(db) {
  let sent = 0;
  for (const s of tatBoard(db)) {
    if (s.tat.paused || s.tat.level === 'green') continue;
    if (s.tat_warned === s.tat.level || (s.tat_warned === 'red')) continue;
    db.tx(() => {
      const breach = s.tat.level === 'red';
      notify.toAdmin(db, {
        code: 'N11', samplePk: s.id,
        subject: `${breach ? 'TAT breached' : 'TAT warning'}: ${s.sample_id}`,
        body: `${s.sample_id} (${s.test_name}) ${breach ? 'has passed' : 'has used 75% of'} its TAT. Due ${s.tat_due_at.slice(0, 10)}; now "${samples.STATUSES[s.status]}".`,
      });
      db.run('UPDATE samples SET tat_warned = ? WHERE id = ?', s.tat.level, s.id);
    });
    sent++;
  }
  return sent;
}

module.exports = {
  CONDITIONS, WINDOWS, TAT_RUNNING, pendingPickups, scheduleLeg1, shipment, shipmentSamples, setAwb, markPickedUp, cancelShipment,
  receive, expectedAtLab, recollect, startInHouse, pendingOnward, scheduleLeg2, partnerReceived, atPartnerLab,
  hold, release, tatState, tatBoard, tatAlerts,
};
