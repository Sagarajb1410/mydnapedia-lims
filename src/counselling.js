// Module 5: counselling and the actionable report (guideline section 3.5).
// Released report → session booked → session held and form completed →
// action plan (drafted in Report Studio from the case file) uploaded and
// checked → admin approval → sent to the client → case closed.
const crypto = require('node:crypto');
const { nowIso, audit, UserError, getSetting, fmtDateTime } = require('./util');
const notify = require('./notify');
const reports = require('./reports');
const samples = require('./samples');
const form = require('./counselling-form');

const MODES = ['Video call', 'Phone call', 'In person'];
const STAGES = reports.COUNSELLING_STAGES;
const FORM_OPEN = ['COUNSELLING_SCHEDULED', 'COUNSELLING_DONE', 'ACTION_PLAN_DRAFTED'];
const PLAN_TYPES = { 'application/pdf': 'pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx' };

function requireCounselling(user) {
  if (!['admin', 'counsellor'].includes(user.role)) throw new UserError('Only counsellors and the admin can do this.');
}
function requireAdmin(user) {
  if (user.role !== 'admin') throw new UserError('Only the admin can do this.');
}

function sampleFor(db, sampleId) {
  const s = db.get('SELECT * FROM samples WHERE sample_id = ?', String(sampleId || '').trim().toUpperCase());
  if (!s) throw new UserError('Sample not found.');
  return s;
}

function setStatus(db, s, to, user, note, extra = {}) {
  const cols = Object.keys(extra);
  db.run(`UPDATE samples SET status = ?${cols.map((c) => `, ${c} = ?`).join('')} WHERE id = ?`, to, ...cols.map((c) => extra[c]), s.id);
  db.run('INSERT INTO sample_events (sample_pk, from_status, to_status, at, user_id, note) VALUES (?, ?, ?, ?, ?, ?)', s.id, s.status, to, nowIso(), user.id, note || null);
}

function counsellors(db) {
  return db.all("SELECT id, name, email, phone FROM users WHERE role = 'counsellor' AND active = 1 ORDER BY name");
}

// "2026-10-07T15:30" typed in India time.
function istInput(value) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(String(value || ''))) return null;
  const d = new Date(`${value}:00+05:30`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// ---------- Sessions ----------

function schedule(db, user, sampleId, input) {
  requireCounselling(user);
  return db.tx(() => book(db, user, sampleFor(db, sampleId), input));
}

// Books (or rebooks) the session. actor is a staff user, or { id: null, patient: true }
// when the patient picks a slot from the tracking page.
function book(db, actor, s, input) {
  if (!['REPORT_RELEASED', 'COUNSELLING_SCHEDULED'].includes(s.status)) throw new UserError(`A session cannot be booked while the sample is "${samples.STATUSES[s.status]}".`);
  let when, mode, counsellorId, slot = null;
  if (input.slotId) {
    slot = db.get("SELECT * FROM counsellor_slots WHERE id = ? AND status = 'open'", Number(input.slotId));
    if (!slot) throw new UserError('That time has just been taken. Please choose another.');
    if (slot.starts_at < nowIso()) throw new UserError('That time has already passed. Please choose another.');
    ({ starts_at: when, mode, counsellor_id: counsellorId } = slot);
  } else {
    when = istInput(input.when);
    if (!when) throw new UserError('Choose the date and time of the session.');
    if (when < nowIso()) throw new UserError('The session time is in the past.');
    mode = input.mode;
    counsellorId = actor.role === 'counsellor' ? actor.id : Number(input.counsellorId) || s.counsellor_id;
  }
  if (!MODES.includes(mode)) throw new UserError('Choose how the session will happen.');
  if (actor.role === 'counsellor' && counsellorId !== actor.id) throw new UserError('Choose one of your own slots.');
  const link = String(input.link || '').trim();
  if (link && !/^https:\/\/\S+$/.test(link)) throw new UserError('The meeting link must start with https://');
  const c = db.get("SELECT * FROM users WHERE id = ? AND role = 'counsellor' AND active = 1", counsellorId);
  if (!c) throw new UserError('Choose the counsellor.');
  const old = db.get("SELECT * FROM counselling_sessions WHERE sample_pk = ? AND status = 'scheduled'", s.id);
  if (old) {
    db.run("UPDATE counselling_sessions SET status = 'cancelled', outcome_note = 'Rebooked' WHERE id = ?", old.id);
    // The old time becomes free again for other clients.
    db.run("UPDATE counsellor_slots SET status = 'open', session_id = NULL WHERE session_id = ? AND starts_at > ?", old.id, nowIso());
  }
  const sessionId = Number(db.run(`INSERT INTO counselling_sessions (sample_pk, counsellor_id, scheduled_at, mode, meeting_link, status, created_by, created_at)
          VALUES (?, ?, ?, ?, ?, 'scheduled', ?, ?)`, s.id, c.id, when, mode, link || null, actor.id, nowIso()).lastInsertRowid);
  if (slot) db.run("UPDATE counsellor_slots SET status = 'booked', session_id = ? WHERE id = ?", sessionId, slot.id);
  else db.run("UPDATE counsellor_slots SET status = 'booked', session_id = ? WHERE counsellor_id = ? AND starts_at = ? AND status = 'open'", sessionId, c.id, when);
  const label = `${fmtDateTime(when)} (${mode.toLowerCase()})`;
  const by = actor.patient ? ' by the client' : '';
  setStatus(db, s, 'COUNSELLING_SCHEDULED', actor, `${old ? 'Rebooked' : 'Booked'}${by} with ${c.name} on ${label}`, { counsellor_id: c.id });
  const p = db.get('SELECT * FROM patients WHERE id = ?', s.patient_id);
  const lab = getSetting(db, 'labName');
  const how = mode === 'Video call' ? (link ? `Join here: ${link}` : 'We will send the video link before the session.') : mode === 'Phone call' ? `${c.name} will call you on ${p.mobile}.` : 'Please come to our centre.';
  const msg = `${lab}: Dear ${p.full_name}, your genetic counselling session is booked for ${fmtDateTime(when)} with ${c.name} (${mode.toLowerCase()}). ${how} Keep your report handy.`;
  notify.queue(db, { code: 'N14', channel: 'whatsapp', recipient: p.mobile, recipientName: p.full_name, samplePk: s.id, body: msg });
  notify.queue(db, { code: 'N14', channel: 'email', recipient: p.email, recipientName: p.full_name, samplePk: s.id, subject: 'Your genetic counselling session', body: msg });
  if (actor.patient) {
    notify.queue(db, { code: 'N14', channel: 'email', recipient: c.email, recipientName: c.name, samplePk: s.id, subject: `New booking: ${s.sample_id} on ${fmtDateTime(when)}`,
      body: `${p.full_name} (${s.sample_id}) ${old ? 'moved their session to' : 'booked'} ${label} from the tracking page.` });
  }
  audit(db, actor.id, old ? 'counselling_rebooked' : 'counselling_booked', 'sample', s.sample_id, { when, mode, counsellor: c.id, byPatient: Boolean(actor.patient), slot: slot && slot.id });
  return { when, counsellor: c.name, mode };
}

// ---------- Counsellor availability ----------
const SLOT_MINUTES = [30, 45, 60];
const DAY = 86400000;
const istDay = (iso) => new Date(new Date(iso).getTime() + 330 * 60000).toISOString().slice(0, 10);

// Adds open slots on the chosen days between from and to (India time), one every
// `minutes`. Times already in the past or already added are skipped.
function addSlots(db, user, { counsellorId, dates, from, to, minutes, mode }) {
  requireCounselling(user);
  const cid = user.role === 'counsellor' ? user.id : Number(counsellorId);
  if (!db.get("SELECT id FROM users WHERE id = ? AND role = 'counsellor' AND active = 1", cid)) throw new UserError('Choose the counsellor.');
  const len = Number(minutes);
  if (!SLOT_MINUTES.includes(len)) throw new UserError('Choose the session length.');
  if (!MODES.includes(mode)) throw new UserError('Choose how the sessions will happen.');
  if (!/^\d{2}:\d{2}$/.test(from || '') || !/^\d{2}:\d{2}$/.test(to || '') || from >= to) throw new UserError('Choose a start time before the end time.');
  const days = [...new Set((dates || []).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)))];
  if (!days.length) throw new UserError('Choose at least one day.');
  const now = nowIso();
  let added = 0;
  db.tx(() => {
    for (const d of days) {
      const end = new Date(`${d}T${to}:00+05:30`).getTime();
      for (let t = new Date(`${d}T${from}:00+05:30`).getTime(); t + len * 60000 <= end; t += len * 60000) {
        const at = new Date(t).toISOString();
        if (at <= now || db.get("SELECT id FROM counsellor_slots WHERE counsellor_id = ? AND starts_at = ? AND status != 'removed'", cid, at)) continue;
        db.run(`INSERT INTO counsellor_slots (counsellor_id, starts_at, minutes, mode, status, created_by, created_at) VALUES (?, ?, ?, ?, 'open', ?, ?)`,
          cid, at, len, mode, user.id, now);
        added++;
      }
    }
    audit(db, user.id, 'counsellor_slots_added', 'user', cid, { added, days: days.length, from, to, minutes: len, mode });
  });
  return added;
}

function removeSlot(db, user, slotId) {
  requireCounselling(user);
  const slot = db.get('SELECT * FROM counsellor_slots WHERE id = ?', Number(slotId));
  if (!slot || (user.role === 'counsellor' && slot.counsellor_id !== user.id)) throw new UserError('Slot not found.');
  if (slot.status !== 'open') throw new UserError('A booked slot cannot be removed. Rebook or cancel the session from the client page.');
  db.run("UPDATE counsellor_slots SET status = 'removed' WHERE id = ?", slot.id);
  audit(db, user.id, 'counsellor_slot_removed', 'user', slot.counsellor_id, { at: slot.starts_at });
}

// Upcoming slots for the availability page, with the client on booked ones.
function upcomingSlots(db, counsellorId) {
  return db.all(`SELECT sl.*, u.name AS counsellor_name, s.sample_id, p.full_name
    FROM counsellor_slots sl JOIN users u ON u.id = sl.counsellor_id
    LEFT JOIN counselling_sessions cs ON cs.id = sl.session_id LEFT JOIN samples s ON s.id = cs.sample_pk LEFT JOIN patients p ON p.id = s.patient_id
    WHERE sl.status != 'removed' AND sl.starts_at > ? ${counsellorId ? 'AND sl.counsellor_id = ?' : ''}
    ORDER BY sl.starts_at, u.name LIMIT 500`, nowIso(), ...(counsellorId ? [counsellorId] : []));
}

// Open slots a client may choose: from a couple of hours ahead, for three weeks.
// A client already linked to a counsellor sees only that counsellor's slots.
function openSlots(db, s) {
  const from = new Date(Date.now() + 2 * 3600000).toISOString();
  const to = new Date(Date.now() + 21 * DAY).toISOString();
  return db.all(`SELECT sl.id, sl.starts_at, sl.minutes, sl.mode, u.name AS counsellor_name FROM counsellor_slots sl JOIN users u ON u.id = sl.counsellor_id
    WHERE sl.status = 'open' AND u.active = 1 AND sl.starts_at > ? AND sl.starts_at < ? ${s && s.counsellor_id ? 'AND sl.counsellor_id = ?' : ''}
    ORDER BY sl.starts_at, u.name LIMIT 300`, from, to, ...(s && s.counsellor_id ? [s.counsellor_id] : []));
}

// The patient books from the tracking page (identity already checked there).
function bookByPatient(db, sampleId, slotId) {
  return db.tx(() => {
    const s = sampleFor(db, sampleId);
    if (s.status === 'COUNSELLING_SCHEDULED') {
      const cur = db.get("SELECT scheduled_at FROM counselling_sessions WHERE sample_pk = ? AND status = 'scheduled'", s.id);
      if (cur && new Date(cur.scheduled_at) - Date.now() < 12 * 3600000) throw new UserError('Your session is less than 12 hours away, so it cannot be moved here. Please call us.');
    }
    if (s.counsellor_id) {
      const slot = db.get('SELECT counsellor_id FROM counsellor_slots WHERE id = ?', Number(slotId));
      if (slot && slot.counsellor_id !== s.counsellor_id) throw new UserError('Please choose one of the times shown.');
    }
    return book(db, { id: null, patient: true }, s, { slotId });
  });
}

function currentSession(db, samplePk) {
  return db.get(`SELECT cs.*, u.name AS counsellor_name FROM counselling_sessions cs JOIN users u ON u.id = cs.counsellor_id
                  WHERE cs.sample_pk = ? ORDER BY cs.id DESC LIMIT 1`, samplePk);
}

function canActOn(user, s) {
  return user.role === 'admin' || (user.role === 'counsellor' && (!s.counsellor_id || s.counsellor_id === user.id));
}

function sessionOutcome(db, user, sampleId, { outcome, note }) {
  requireCounselling(user);
  return db.tx(() => {
    const s = sampleFor(db, sampleId);
    if (!canActOn(user, s)) throw new UserError('This client is booked with another counsellor.');
    const cs = db.get("SELECT * FROM counselling_sessions WHERE sample_pk = ? AND status = 'scheduled' ORDER BY id DESC LIMIT 1", s.id);
    if (!cs || s.status !== 'COUNSELLING_SCHEDULED') throw new UserError('There is no booked session for this client.');
    if (outcome === 'done') {
      db.run("UPDATE counselling_sessions SET status = 'done', outcome_note = ?, completed_at = ? WHERE id = ?", String(note || '').trim() || null, nowIso(), cs.id);
      setStatus(db, s, 'COUNSELLING_DONE', user, 'Counselling session held');
    } else if (outcome === 'no_show') {
      db.run("UPDATE counselling_sessions SET status = 'no_show', outcome_note = ?, completed_at = ? WHERE id = ?", String(note || '').trim() || null, nowIso(), cs.id);
      setStatus(db, s, 'REPORT_RELEASED', user, 'Client did not attend; book again');
    } else throw new UserError('Choose what happened.');
    audit(db, user.id, `counselling_${outcome}`, 'sample', s.sample_id, { note });
  });
}

// ---------- Counselling form ----------

function loadForm(db, samplePk) {
  const row = db.get('SELECT * FROM counselling_forms WHERE sample_pk = ?', samplePk);
  return row ? { ...row, data: JSON.parse(row.data_json) } : null;
}

function saveForm(db, user, sampleId, body, { complete = false } = {}) {
  requireCounselling(user);
  return db.tx(() => {
    const s = sampleFor(db, sampleId);
    if (!canActOn(user, s)) throw new UserError('This client is booked with another counsellor.');
    if (!FORM_OPEN.includes(s.status)) throw new UserError(`The form cannot be changed while the sample is "${samples.STATUSES[s.status]}".`);
    const data = form.fromBody(body);
    if (complete) {
      const missing = form.missing(data);
      if (missing.length) throw new UserError(`Fill in before completing: ${missing.join(', ')}.`);
    }
    const now = nowIso();
    const existing = loadForm(db, s.id);
    const status = complete ? 'complete' : existing && existing.status === 'complete' ? 'complete' : 'draft';
    if (existing) {
      db.run('UPDATE counselling_forms SET data_json = ?, status = ?, updated_by = ?, updated_at = ?, completed_at = COALESCE(completed_at, ?) WHERE id = ?',
        JSON.stringify(data), status, user.id, now, status === 'complete' ? now : null, existing.id);
    } else {
      db.run('INSERT INTO counselling_forms (sample_pk, data_json, status, updated_by, updated_at, completed_at) VALUES (?, ?, ?, ?, ?, ?)',
        s.id, JSON.stringify(data), status, user.id, now, status === 'complete' ? now : null);
    }
    audit(db, user.id, complete ? 'counselling_form_completed' : 'counselling_form_saved', 'sample', s.sample_id);
    return { status };
  });
}

// The case file Report Studio opens to draft the action plan.
function caseFile(db, user, sampleId) {
  requireCounselling(user);
  const s = sampleFor(db, sampleId);
  if (!STAGES.includes(s.status)) throw new UserError('The case file is available once the report is released.');
  const p = db.get('SELECT * FROM patients WHERE id = ?', s.patient_id);
  const t = db.get('SELECT * FROM tests WHERE id = ?', s.test_id);
  const f = loadForm(db, s.id);
  audit(db, user.id, 'case_file_downloaded', 'sample', s.sample_id);
  const session = db.get("SELECT * FROM counselling_sessions WHERE sample_pk = ? AND status IN ('scheduled','done') ORDER BY id DESC LIMIT 1", s.id);
  const c = s.counsellor_id ? db.get('SELECT name FROM users WHERE id = ?', s.counsellor_id) : null;
  return form.toCaseFile({ sample: s, patient: p, test: t, form: f ? f.data : {}, reportDate: s.released_at, session, counsellorName: c ? c.name : '' });
}

// ---------- Action plan ----------

function plan(db, id) {
  const r = db.get('SELECT * FROM action_plans WHERE id = ?', Number(id));
  if (!r) throw new UserError('Action plan not found.');
  return r;
}

function uploadPlan(db, storage, user, sampleId, file) {
  requireCounselling(user);
  if (!file || !file.data || !file.data.length) throw new UserError('Choose the action plan file to upload.');
  const head = file.data.slice(0, 4).toString('latin1');
  const type = head === '%PDF' ? 'pdf' : head === 'PK\x03\x04' ? 'docx' : null;
  if (!type || (file.type && file.type !== 'application/octet-stream' && !PLAN_TYPES[file.type])) throw new UserError('The action plan must be a Word (.docx) or PDF file.');
  return db.tx(() => {
    const s = sampleFor(db, sampleId);
    if (!canActOn(user, s)) throw new UserError('This client is booked with another counsellor.');
    if (!['COUNSELLING_DONE', 'ACTION_PLAN_DRAFTED'].includes(s.status)) throw new UserError('The action plan is added after the counselling session.');
    const f = loadForm(db, s.id);
    if (!f || f.status !== 'complete') throw new UserError('Complete the counselling form first.');
    const check = reports.checkReport(db, file.data, s, { noun: 'action plan' });
    const version = (db.get('SELECT MAX(version) v FROM action_plans WHERE sample_pk = ?', s.id).v || 0) + 1;
    const key = `plans/${s.sample_id}/plan-v${version}-${crypto.randomBytes(4).toString('hex')}.${type}`;
    const { sha256 } = storage.put(key, file.data);
    db.run("UPDATE action_plans SET status = 'superseded' WHERE sample_pk = ? AND status IN ('pending','blocked')", s.id);
    const id = Number(db.run(
      `INSERT INTO action_plans (sample_pk, version, file_key, file_name, file_type, sha256, size, uploaded_by, uploaded_at, status, check_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      s.id, version, key, file.filename || `plan.${type}`, type, sha256, file.data.length, user.id, nowIso(), check.ok ? 'pending' : 'blocked', JSON.stringify(check),
    ).lastInsertRowid);
    if (check.ok) {
      if (s.status !== 'ACTION_PLAN_DRAFTED') setStatus(db, s, 'ACTION_PLAN_DRAFTED', user, `Action plan v${version} passed the check; waiting for approval`);
      notify.toAdmin(db, { code: 'N15', samplePk: s.id, subject: `Action plan ${s.sample_id} waiting for approval`, body: `The action plan for ${s.sample_id} passed the check and is waiting for your approval.` });
    } else if (s.status === 'ACTION_PLAN_DRAFTED') {
      setStatus(db, s, 'COUNSELLING_DONE', user, `Replacement plan v${version} was blocked by the check`);
    }
    audit(db, user.id, check.ok ? 'action_plan_uploaded' : 'action_plan_blocked', 'sample', s.sample_id, { version, sha256, problems: check.problems });
    return { id, version, check };
  });
}

function reviewPlan(db, storage, user, planId, { approve, note, pagesChecked }) {
  requireAdmin(user);
  return db.tx(() => {
    const r = plan(db, planId);
    if (r.status !== 'pending') throw new UserError('This action plan is not waiting for approval.');
    const s = db.get('SELECT * FROM samples WHERE id = ?', r.sample_pk);
    if (approve) {
      if (!pagesChecked) throw new UserError('Tick the box to confirm you read the whole plan.');
      const check = reports.checkReport(db, storage.get(r.file_key), s, { noun: 'action plan' });
      if (!check.ok) throw new UserError(`The check now fails: ${check.problems[0]}`);
      db.run("UPDATE action_plans SET status = 'approved', reviewed_by = ?, reviewed_at = ?, review_note = ? WHERE id = ?", user.id, nowIso(), String(note || '').trim() || null, r.id);
      setStatus(db, s, 'ACTION_PLAN_APPROVED', user, `Action plan v${r.version} approved`);
    } else {
      if (!String(note || '').trim()) throw new UserError('Say what needs changing so the counsellor can fix it.');
      db.run("UPDATE action_plans SET status = 'rejected', reviewed_by = ?, reviewed_at = ?, review_note = ? WHERE id = ?", user.id, nowIso(), String(note).trim(), r.id);
      setStatus(db, s, 'COUNSELLING_DONE', user, `Action plan v${r.version} sent back: ${String(note).trim()}`);
    }
    audit(db, user.id, approve ? 'action_plan_approved' : 'action_plan_rejected', 'sample', s.sample_id, { version: r.version, note });
  });
}

// Sends the approved plan to the client; the check runs once more first.
function deliver(db, storage, user, planId) {
  requireCounselling(user);
  return db.tx(() => {
    const r = plan(db, planId);
    if (r.status !== 'approved') throw new UserError('Only an approved action plan can be sent.');
    const s = db.get('SELECT * FROM samples WHERE id = ?', r.sample_pk);
    if (!canActOn(user, s)) throw new UserError('This client is booked with another counsellor.');
    if (s.status !== 'ACTION_PLAN_APPROVED') throw new UserError(`The sample is "${samples.STATUSES[s.status]}", so the plan cannot be sent.`);
    const buf = storage.get(r.file_key);
    if (crypto.createHash('sha256').update(buf).digest('hex') !== r.sha256) throw new UserError('The stored file has changed since it was checked. Upload it again.');
    const check = reports.checkReport(db, buf, s, { noun: 'action plan' });
    if (!check.ok) throw new UserError(`Sending blocked: ${check.problems[0]}`);
    const now = nowIso();
    db.run("UPDATE action_plans SET status = 'delivered', delivered_by = ?, delivered_at = ? WHERE id = ?", user.id, now, r.id);
    setStatus(db, s, 'DELIVERED', user, `Action plan v${r.version} sent to the client`);
    const p = db.get('SELECT * FROM patients WHERE id = ?', s.patient_id);
    const lab = getSetting(db, 'labName');
    const fileName = `${p.full_name.replace(/[^A-Za-z0-9]+/g, '_')}_${lab.replace(/[^A-Za-z0-9]+/g, '')}_Action_Plan.${r.file_type}`;
    notify.queue(db, {
      code: 'N17', channel: 'email', recipient: p.email, recipientName: p.full_name, samplePk: s.id, attachmentKey: r.file_key, attachmentName: fileName,
      subject: `Your ${lab} personalised action plan`,
      body: `Dear ${p.full_name},\n\nThank you for your counselling session. Your personalised action plan is attached. It brings together your genetic results and what you told us, with the steps we agreed.\n\nShare it with your doctor before changing any medicine. For help, call ${getSetting(db, 'supportPhone')} or write to ${getSetting(db, 'supportEmail')}.\n\n${lab}`,
    });
    notify.queue(db, { code: 'N17', channel: 'whatsapp', recipient: p.mobile, recipientName: p.full_name, samplePk: s.id,
      body: `${lab}: Dear ${p.full_name}, your personalised action plan has been emailed to you. Thank you for choosing ${lab}.` });
    audit(db, user.id, 'action_plan_delivered', 'sample', s.sample_id, { version: r.version });
  });
}

function closeCase(db, user, sampleId, note) {
  requireAdmin(user);
  return db.tx(() => {
    const s = sampleFor(db, sampleId);
    if (s.status !== 'DELIVERED') throw new UserError('Only a delivered case can be closed.');
    setStatus(db, s, 'CLOSED', user, String(note || '').trim() || 'Case closed');
    audit(db, user.id, 'case_closed', 'sample', s.sample_id, { note });
  });
}

function plansFor(db, samplePk) {
  return db.all(`SELECT a.*, u.name AS uploaded_by_name, rv.name AS reviewed_by_name FROM action_plans a
    LEFT JOIN users u ON u.id = a.uploaded_by LEFT JOIN users rv ON rv.id = a.reviewed_by WHERE a.sample_pk = ? ORDER BY a.version DESC`, samplePk)
    .map((r) => ({ ...r, check: r.check_json ? JSON.parse(r.check_json) : null }));
}

function canOpenPlan(user, r, s) {
  return user.role === 'admin' || (user.role === 'counsellor' && canActOn(user, s));
}

// Work lists for the counselling screen; a counsellor sees unassigned and their own clients.
function queues(db, user) {
  const mine = user.role === 'counsellor' ? 'AND (s.counsellor_id IS NULL OR s.counsellor_id = ?)' : '';
  const params = user.role === 'counsellor' ? [user.id] : [];
  const q = (statuses, order) => db.all(
    `SELECT s.*, p.full_name, p.mobile, t.name AS test_name, u.name AS counsellor_name,
            (SELECT scheduled_at FROM counselling_sessions cs WHERE cs.sample_pk = s.id AND cs.status = 'scheduled' ORDER BY cs.id DESC LIMIT 1) AS session_at,
            (SELECT status FROM counselling_forms f WHERE f.sample_pk = s.id) AS form_status
       FROM samples s JOIN patients p ON p.id = s.patient_id JOIN tests t ON t.id = s.test_id LEFT JOIN users u ON u.id = s.counsellor_id
      WHERE s.status IN (${statuses.map(() => '?').join(',')}) ${mine} ORDER BY ${order}`, ...statuses, ...params);
  return {
    toBook: q(['REPORT_RELEASED'], 's.released_at'),
    booked: q(['COUNSELLING_SCHEDULED'], 'session_at'),
    planToDo: q(['COUNSELLING_DONE'], 's.id'),
    awaitingApproval: q(['ACTION_PLAN_DRAFTED'], 's.id'),
    toSend: q(['ACTION_PLAN_APPROVED'], 's.id'),
    delivered: q(['DELIVERED'], 's.id DESC'),
  };
}

module.exports = {
  SLOT_MINUTES, addSlots, removeSlot, upcomingSlots, openSlots, bookByPatient, istDay,
  MODES, STAGES, FORM_OPEN, counsellors, schedule, currentSession, canActOn, sessionOutcome, loadForm, saveForm, caseFile,
  plan, uploadPlan, reviewPlan, deliver, closeCase, plansFor, canOpenPlan, queues,
};
