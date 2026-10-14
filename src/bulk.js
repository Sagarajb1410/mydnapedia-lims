// Registering many samples from one Excel sheet. The user downloads a template,
// fills one row per sample, uploads it, checks the preview and confirms. Every
// row goes through the same checks and billing as the registration form.
const crypto = require('node:crypto');
const xlsx = require('./xlsx');
const samples = require('./samples');
const { UserError, toPaise, istDate } = require('./util');

const MAX_ROWS = 500;
const PAYMENTS = ['Cash', 'UPI', 'Card', 'Bank transfer', 'Pending'];
const GST = { 0: 0, 5: 500, 12: 1200, 18: 1800 };

// Columns depend on who registers: suppliers bill the patient themselves and
// the central lab records how the patient paid.
function columns(user) {
  const supplier = user.role === 'partner' && user.account_type === 'supplier';
  const direct = user.role !== 'partner';
  return [
    ['full_name', 'Patient full name', true], ['gender', 'Gender (Male/Female/Other)', true], ['dob', 'Date of birth (DD/MM/YYYY)', true],
    ['mobile', 'Mobile', true], ['email', 'Email', false], ['address', 'Address', false], ['city', 'City', true], ['state', 'State', true],
    ['pincode', 'Pincode', true], ['test', 'Test', true], ['consent', 'Consent (Signed form/Verbal)', true], ['data_use', 'Data use for research (Yes/No)', false],
    ['collected_by', 'Collected by (leave empty if not collected yet)', false], ['collected_on', 'Collected on (DD/MM/YYYY, empty = today)', false], ['partner_ref', 'Your reference', false], ['doctor', 'Referring doctor', false],
    ...(supplier ? [['patient_price', 'Your price to patient (Rs)', true], ['patient_discount', 'Your discount (Rs)', false], ['gst', 'GST % on your bill (0/5/12/18)', true]] : []),
    ...(direct ? [['payment', 'Payment (Cash/UPI/Card/Bank transfer/Pending)', true], ['payment_ref', 'Payment reference', false]] : []),
    ['repeat_reason', 'Repeat reason (only if the same test was done in the last 90 days)', false],
  ];
}

function template(db, user) {
  const cols = columns(user);
  const tests = db.all('SELECT name, short_name FROM tests WHERE active = 1 ORDER BY name');
  return xlsx.workbook([
    { name: 'Samples', textCols: true, freezeRow: 1, widths: cols.map(([, l]) => Math.min(Math.max(l.length + 2, 14), 34)), rows: [{ cells: cols.map(([, l, req]) => (req ? `${l} *` : l)), style: 'header' }] },
    {
      name: 'How to fill', widths: [30, 70], rows: [
        { cells: ['How to fill the Samples sheet'], style: 'title' },
        ['One row per sample.', 'Columns marked * are required. Leave the header row as it is.'],
        ['Date of birth', 'Day/month/year, for example 11/02/1990.'],
        ['Mobile', '10-digit Indian mobile number.'],
        ['Test', 'The test name or short name exactly as listed below.'],
        ['Consent', 'Write "Signed form" or "Verbal". The patient must have consented to the test.'],
        ['Collected by', 'Fill this in only if the sample has already been collected.'],
        [`Up to ${MAX_ROWS} rows`, 'You will see a check of every row before anything is registered.'],
        { cells: ['Tests'], style: 'header' },
        ...tests.map((t) => [t.name, t.short_name]),
        { cells: ['States'], style: 'header' },
        ...samples.STATES.map((s) => [s]),
      ],
    },
  ]);
}

const low = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

// Day/month/year (Indian order), year-month-day, or an Excel date number.
function parseDob(v) {
  const s = String(v || '').trim();
  let m;
  if (/^\d{5}(\.\d+)?$/.test(s)) return new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(s)) * 86400000).toISOString().slice(0, 10);
  if ((m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/))) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/))) {
    const out = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    const d = new Date(out + 'T00:00:00Z');
    if (!Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === out) return out;
  }
  return s;
}

// Reads the uploaded file and checks every row without registering anything.
// Returns { rows: [{ line, input, label, errors, duplicate }], headerError }.
function check(db, user, file) {
  if (!samples.canRegister(user)) throw new UserError('You cannot register samples.');
  if (!file) throw new UserError('Choose the filled Excel file.');
  let grid;
  if (/\.csv$/i.test(file.filename)) grid = file.data.toString('utf8').replace(/^﻿/, '').split(/\r?\n/).map(csvLine);
  else {
    try { grid = xlsx.read(file.data); } catch (e) { throw new UserError(e.message); }
  }
  const cols = columns(user);
  const head = (grid[0] || []).map((h) => low(h).replace(/\s*\*$/, ''));
  const at = {};
  for (const [key, label] of cols) at[key] = head.indexOf(low(label));
  const missing = cols.filter(([k, , req]) => req && at[k] < 0).map(([, l]) => l);
  if (missing.length) throw new UserError(`The file does not match the template. Missing columns: ${missing.join(', ')}. Please download the template again and copy your rows into it.`);
  const body = grid.slice(1).map((r, i) => ({ r, line: i + 2 })).filter(({ r }) => r.some((c) => String(c || '').trim()));
  if (!body.length) throw new UserError('The sheet has no sample rows.');
  if (body.length > MAX_ROWS) throw new UserError(`The sheet has ${body.length} rows. Please upload at most ${MAX_ROWS} at a time.`);

  const tests = db.all('SELECT id, name, short_name, code FROM tests WHERE active = 1');
  const seen = new Map();
  return body.map(({ r, line }) => {
    const v = (k) => (at[k] >= 0 ? String(r[at[k]] ?? '').trim() : '');
    const errors = [];
    const gender = ['Male', 'Female', 'Other'].find((g) => low(g) === low(v('gender')) || low(g)[0] === low(v('gender')));
    const state = samples.STATES.find((s) => low(s) === low(v('state')));
    const test = tests.find((t) => [t.name, t.short_name, t.code].some((n) => low(n) === low(v('test'))));
    const consent = /^signed/i.test(v('consent')) ? 'Signed form' : /^(verbal|confirmed verbally)/i.test(v('consent')) ? 'Confirmed verbally by patient' : '';
    const input = {
      full_name: v('full_name'), gender: gender || v('gender'), dob: parseDob(v('dob')), mobile: v('mobile'), email: v('email'), address: v('address'),
      city: v('city'), state: state || v('state'), pincode: v('pincode').replace(/\.0+$/, ''), test_id: test ? String(test.id) : '',
      consent_testing: 'yes', consent_method: consent, consent_data_use: /^y/i.test(v('data_use')) ? 'yes' : 'no',
      collected_now: v('collected_by') ? 'yes' : '', collector: v('collected_by'), collected_at: collectedOn(v('collected_on')),
      partner_ref: v('partner_ref'), referring_doctor: v('doctor'), duplicate_reason: v('repeat_reason'),
    };
    if (v('collected_on') && !v('collected_by')) errors.push('Enter who collected the sample, or leave "Collected on" empty.');
    if (input.collected_at === 'bad') errors.push('Write the collection date as DD/MM/YYYY.');
    else if (input.collected_at) {
      const day = input.collected_at.slice(0, 10);
      const earliest = new Date(Date.now() - 30 * 86400000 + 330 * 60000).toISOString().slice(0, 10);
      if (day > istDate()) errors.push('The collection date is in the future.');
      else if (day < earliest) errors.push('The collection date is more than 30 days ago.');
    }
    let patient;
    try { patient = samples.validatePatient(input); } catch (e) { errors.push(e.message); }
    if (!test) errors.push(v('test') ? `Unknown test "${v('test')}".` : 'Enter the test.');
    if (!consent) errors.push('Write "Signed form" or "Verbal" for consent.');
    if (at.patient_price >= 0) {
      try {
        input.supplier = { patientPricePaise: toPaise(v('patient_price')), discountPaise: v('patient_discount') ? toPaise(v('patient_discount')) : 0, gstRateBp: GST[Number(v('gst').replace('%', ''))] };
        if (input.supplier.gstRateBp == null) errors.push('GST must be 0, 5, 12 or 18.');
        if (input.supplier.discountPaise > input.supplier.patientPricePaise) errors.push('Your discount is more than your price.');
      } catch (e) { errors.push(e.message); }
    }
    if (at.payment >= 0) {
      const pay = PAYMENTS.find((p) => low(p) === low(v('payment')));
      if (!pay) errors.push('Payment must be Cash, UPI, Card, Bank transfer or Pending.');
      input.direct = { paymentMode: pay === 'Pending' ? 'pending' : pay, paymentRef: v('payment_ref'), discountPaise: 0 };
    }
    let duplicate = null;
    if (patient && test) {
      const key = `${patient.mobile}|${patient.dob}|${test.id}`;
      if (seen.has(key) && !input.duplicate_reason) errors.push(`Same patient and test as row ${seen.get(key)}. Remove one, or give a repeat reason.`);
      seen.set(key, line);
      duplicate = samples.findDuplicate(db, user, patient, test.id);
      if (duplicate && !input.duplicate_reason) errors.push(`Same patient and test as ${duplicate.sample_id} in the last 90 days. Give a repeat reason to register it again.`);
    }
    return { line, input, errors, label: { name: input.full_name, test: test ? test.name : v('test'), mobile: v('mobile') } };
  });
}

// A collection day from the sheet, as noon India time that day (the time is
// rarely known; noon keeps the day right). Today means now.
function collectedOn(v) {
  if (!v) return '';
  const day = parseDob(v);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return 'bad';
  return day === istDate() ? '' : `${day}T12:00`;
}

function csvLine(line) {
  const out = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
    else if (ch === '"') q = true; else if (ch === ',') { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out;
}

// Checked uploads wait here until the user confirms (30 minutes, per user).
const pending = new Map();
function hold(user, rows) {
  const now = Date.now();
  for (const [k, v] of pending) if (now - v.at > 30 * 60000) pending.delete(k);
  const token = crypto.randomBytes(12).toString('hex');
  pending.set(token, { userId: user.id, rows, at: now });
  return token;
}

// Registers the rows that passed the check. All or nothing: if any row fails
// now (for example a price changed), nothing is registered.
function confirm(db, user, token) {
  const p = pending.get(token);
  if (!p || p.userId !== user.id) throw new UserError('This upload has expired. Please upload the file again.');
  const good = p.rows.filter((r) => !r.errors.length);
  if (!good.length) throw new UserError('No rows are ready to register.');
  const out = db.tx(() => good.map((r) => {
    try {
      const res = samples.register(db, user, r.input);
      if (res.duplicate) throw new UserError(`Same patient and test as ${res.duplicate.sample_id}. Give a repeat reason.`);
      return res.sample.sample_id;
    } catch (e) {
      if (e instanceof UserError) throw new UserError(`Row ${r.line}: ${e.message} Nothing was registered.`);
      throw e;
    }
  }));
  pending.delete(token);
  return { sampleIds: out, skipped: p.rows.length - good.length, day: istDate() };
}

module.exports = { columns, template, check, hold, confirm, parseDob, MAX_ROWS, _pending: pending };
