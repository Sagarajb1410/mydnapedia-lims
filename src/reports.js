// Module 4: reports (guideline section 3.4).
// 1. The partner lab's report (or the in-house result) is stored as the source.
// 2. The white-labelled report, made in Report Studio, is uploaded and checked:
//    any partner name, the partner's sample reference, a missing sample ID or an
//    unreadable file blocks it. Nothing here can override a block.
// 3. The admin approves it after looking at every page, then releases it. The
//    check runs again at release. Release stops the TAT clock.
const crypto = require('node:crypto');
const { nowIso, audit, UserError, getSetting } = require('./util');
const notify = require('./notify');
const pdftext = require('./pdftext');
const doctext = require('./doctext');
const samples = require('./samples');

const SOURCE_FROM = {
  partner_lab: ['RECEIVED_AT_PARTNER', 'PARTNER_REPORT_RECEIVED'],
  in_house: ['IN_HOUSE_PROCESSING', 'RESULT_READY'],
};
const COUNSELLING_STAGES = ['REPORT_RELEASED', 'COUNSELLING_SCHEDULED', 'COUNSELLING_DONE', 'ACTION_PLAN_DRAFTED', 'ACTION_PLAN_APPROVED', 'DELIVERED', 'CLOSED'];
const SOURCE_TO = { partner_lab: 'PARTNER_REPORT_RECEIVED', in_house: 'RESULT_READY' };
const BRANDED_FROM = ['PARTNER_REPORT_RECEIVED', 'RESULT_READY', 'REPORT_WHITE_LABELLED'];
const MAX_BYTES = 40 * 1024 * 1024;

function requireStaff(user) {
  if (!['admin', 'lab'].includes(user.role)) throw new UserError('Only admin and lab staff can do this.');
}
function requireAdmin(user) {
  if (user.role !== 'admin') throw new UserError('Only the admin can approve or release reports.');
}

function sampleWithTest(db, sampleId) {
  const s = db.get(
    `SELECT s.*, t.route, t.name AS test_name, t.code AS test_code FROM samples s JOIN tests t ON t.id = s.test_id WHERE s.sample_id = ?`,
    String(sampleId || '').trim().toUpperCase());
  if (!s) throw new UserError('Sample not found.');
  return s;
}

function setStatus(db, s, to, user, note, extra = {}) {
  const cols = Object.keys(extra);
  db.run(`UPDATE samples SET status = ?${cols.map((c) => `, ${c} = ?`).join('')} WHERE id = ?`, to, ...cols.map((c) => extra[c]), s.id);
  db.run('INSERT INTO sample_events (sample_pk, from_status, to_status, at, user_id, note) VALUES (?, ?, ?, ?, ?, ?)', s.id, s.status, to, nowIso(), user.id, note || null);
}

function checkPdfFile(file) {
  if (!file || !file.data || !file.data.length) throw new UserError('Choose the PDF file to upload.');
  if (file.data.length > MAX_BYTES) throw new UserError('The file is larger than 40 MB.');
  if (!file.data.slice(0, 1024).toString('latin1').includes('%PDF')) throw new UserError('The file must be a PDF.');
}

function store(db, storage, s, kind, file) {
  const version = (db.get('SELECT MAX(version) v FROM reports WHERE sample_pk = ? AND kind = ?', s.id, kind).v || 0) + 1;
  const key = `reports/${s.sample_id}/${kind}-v${version}-${crypto.randomBytes(4).toString('hex')}.pdf`;
  const { sha256 } = storage.put(key, file.data);
  return { version, key, sha256 };
}

const norm = (t) => String(t || '').toLowerCase().replace(/\s+/g, '');

function leakTerms(db) {
  return getSetting(db, 'leakTerms').split(/[,\n]/).map((t) => t.trim()).filter((t) => norm(t).length >= 2);
}

// Reads a PDF or Word file into page texts and file properties.
function readDocument(buffer) {
  if (buffer.slice(0, 4).toString('latin1') === 'PK\x03\x04') {
    const d = doctext.extract(buffer);
    return {
      format: 'Word', encrypted: false,
      pages: d.parts.map((p) => ({ text: p.text, label: p.name.replace(/^word\/|\.xml$/g, ''), images: 0 })),
      meta: [...Object.values(d.info), d.alt].join(' '), images: d.images,
    };
  }
  const d = pdftext.extract(buffer);
  return { format: 'PDF', encrypted: d.encrypted, pages: d.pages, meta: [...Object.values(d.info), d.xmp].join(' ') };
}

// The release check, for reports and action plans. Every "problem" blocks;
// "warnings" are for the reviewer.
function checkReport(db, buffer, s, { noun = 'report' } = {}) {
  const problems = [];
  const warnings = [];
  let doc;
  try { doc = readDocument(buffer); } catch (e) {
    return { ok: false, problems: [`The file could not be read (${e.message}).`], warnings, pages: 0 };
  }
  if (doc.encrypted) problems.push('The PDF is password-protected or encrypted, so it cannot be checked. Save it again without protection.');
  const terms = leakTerms(db);
  if (!terms.length) problems.push('No partner names are set up to check against. The admin must fill in "Names that must never appear in a released report" under Admin, Settings.');
  const pages = doc.pages;
  const flat = norm(pages.map((p) => p.text).join('\n'));
  if (!pages.length) problems.push(`The ${noun} has no pages.`);
  else if (flat.length < 40) problems.push(`No readable text was found. A scanned or picture-only ${noun} cannot be checked.`);

  // Partner names in the text; whitespace is ignored so split words still match.
  pages.forEach((p, i) => {
    const pflat = norm(p.text);
    const where = doc.format === 'Word' ? `The ${p.label}` : `Page ${i + 1}`;
    for (const t of terms) {
      const at = pflat.indexOf(norm(t));
      if (at >= 0) problems.push(`${where} contains "${t}" (…${pflat.slice(Math.max(0, at - 25), at + norm(t).length + 25)}…).`);
    }
  });

  // File properties, embedded metadata and picture descriptions.
  for (const t of [...terms, 'Jasper', 'iText']) {
    if (norm(doc.meta).includes(norm(t))) problems.push(`The file properties mention "${t}". Re-save it from Report Studio, which rewrites them.`);
  }

  if (s.partner_lab_ref && norm(s.partner_lab_ref).length >= 4 && flat.includes(norm(s.partner_lab_ref))) {
    problems.push(`The partner lab's own reference (${s.partner_lab_ref}) is still in the ${noun}.`);
  }
  const patient = db.get('SELECT full_name FROM patients WHERE id = ?', s.patient_id);
  if (noun === 'report') {
    if (!flat.includes(norm(s.sample_id))) problems.push(`The report does not show this sample's ID (${s.sample_id}). It may belong to another client.`);
  } else if (!flat.includes(norm(s.sample_id)) && !(patient && flat.includes(norm(patient.full_name)))) {
    problems.push(`The ${noun} shows neither this sample's ID (${s.sample_id}) nor the client's name. It may belong to another client.`);
  }
  if (patient && !flat.includes(norm(patient.full_name))) warnings.push(`The client's name "${patient.full_name}" was not found in the text. Check the first page.`);
  if (doc.format === 'PDF') {
    const sizes = new Set(pages.map((p) => `${p.width}x${p.height}`));
    if (sizes.size > 1) warnings.push('The pages are not all the same size.');
    const pictures = pages.map((p, i) => ({ i: i + 1, p })).filter(({ p }) => p.images > 0 && norm(p.text).length < 200).map(({ i }) => i);
    if (pictures.length) warnings.push(`Pages ${pictures.join(', ')} are mostly pictures. Text inside a picture cannot be checked, so look at these pages closely.`);
  } else if (doc.images) {
    warnings.push(`The document has ${doc.images} picture(s). Text inside a picture cannot be checked, so look at them closely.`);
  }
  return { ok: problems.length === 0, problems, warnings, pages: doc.format === 'PDF' ? pages.length : null, format: doc.format };
}

// Step 1: the partner lab's report or the in-house result.
function uploadSource(db, storage, user, sampleId, file) {
  requireStaff(user);
  checkPdfFile(file);
  return db.tx(() => {
    const s = sampleWithTest(db, sampleId);
    if (!(SOURCE_FROM[s.route] || []).includes(s.status)) {
      throw new UserError(`A ${s.route === 'in_house' ? 'result' : 'partner lab report'} cannot be added while the sample is "${samples.STATUSES[s.status]}".`);
    }
    const { version, key, sha256 } = store(db, storage, s, 'source', file);
    db.run("UPDATE reports SET status = 'superseded' WHERE sample_pk = ? AND kind = 'source' AND status = 'received'", s.id);
    db.run(`INSERT INTO reports (sample_pk, kind, version, file_key, file_name, sha256, size, uploaded_by, uploaded_at, status)
            VALUES (?, 'source', ?, ?, ?, ?, ?, ?, ?, 'received')`, s.id, version, key, file.filename || 'report.pdf', sha256, file.data.length, user.id, nowIso());
    const to = SOURCE_TO[s.route];
    if (s.status !== to) setStatus(db, s, to, user, s.route === 'in_house' ? 'In-house result uploaded' : 'Partner lab report uploaded');
    audit(db, user.id, 'source_report_uploaded', 'sample', s.sample_id, { version, sha256 });
    return { version };
  });
}

// Step 2: the white-labelled report, checked on upload.
function uploadBranded(db, storage, user, sampleId, file) {
  requireStaff(user);
  checkPdfFile(file);
  return db.tx(() => {
    const s = sampleWithTest(db, sampleId);
    if (!BRANDED_FROM.includes(s.status)) {
      throw new UserError(`The white-labelled report can be added once the ${s.route === 'in_house' ? 'result' : 'partner lab report'} is in. The sample is "${samples.STATUSES[s.status]}".`);
    }
    const check = checkReport(db, file.data, s);
    const { version, key, sha256 } = store(db, storage, s, 'branded', file);
    db.run("UPDATE reports SET status = 'superseded' WHERE sample_pk = ? AND kind = 'branded' AND status IN ('pending','blocked')", s.id);
    const id = Number(db.run(
      `INSERT INTO reports (sample_pk, kind, version, file_key, file_name, sha256, size, pages, uploaded_by, uploaded_at, status, check_json)
       VALUES (?, 'branded', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      s.id, version, key, `${s.sample_id}.pdf`, sha256, file.data.length, check.pages, user.id, nowIso(), check.ok ? 'pending' : 'blocked', JSON.stringify(check),
    ).lastInsertRowid);
    if (check.ok) {
      if (s.status !== 'REPORT_WHITE_LABELLED') setStatus(db, s, 'REPORT_WHITE_LABELLED', user, `White-labelled report v${version} passed the check; waiting for approval`);
      else db.run('INSERT INTO sample_events (sample_pk, from_status, to_status, at, user_id, note) VALUES (?, ?, ?, ?, ?, ?)', s.id, s.status, s.status, nowIso(), user.id, `Replaced with v${version}; waiting for approval`);
      notify.toAdmin(db, { code: 'N12', samplePk: s.id, subject: `Report ${s.sample_id} waiting for approval`, body: `The white-labelled ${s.test_name} report for ${s.sample_id} passed the check and is waiting for your approval.` });
    } else if (s.status === 'REPORT_WHITE_LABELLED') {
      // A blocked replacement leaves nothing approvable.
      setStatus(db, s, s.route === 'in_house' ? 'RESULT_READY' : 'PARTNER_REPORT_RECEIVED', user, `Replacement v${version} was blocked by the check`);
    }
    audit(db, user.id, check.ok ? 'branded_report_uploaded' : 'branded_report_blocked', 'sample', s.sample_id, { version, sha256, problems: check.problems });
    return { id, version, check };
  });
}

function report(db, id) {
  const r = db.get('SELECT * FROM reports WHERE id = ?', Number(id));
  if (!r) throw new UserError('Report not found.');
  return r;
}

// Step 3: the admin approves or sends it back.
function review(db, storage, user, reportId, { approve, note, pagesChecked }) {
  requireAdmin(user);
  return db.tx(() => {
    const r = report(db, reportId);
    if (r.status !== 'pending') throw new UserError('This report is not waiting for approval.');
    const s = db.get('SELECT s.*, t.route FROM samples s JOIN tests t ON t.id = s.test_id WHERE s.id = ?', r.sample_pk);
    if (approve) {
      if (!pagesChecked) throw new UserError('Tick the box to confirm you looked at every page.');
      const check = checkReport(db, storage.get(r.file_key), s);
      if (!check.ok) throw new UserError(`The check now fails: ${check.problems[0]}`);
      db.run("UPDATE reports SET status = 'approved', reviewed_by = ?, reviewed_at = ?, review_note = ? WHERE id = ?", user.id, nowIso(), String(note || '').trim() || null, r.id);
      setStatus(db, s, 'REPORT_APPROVED', user, `Report v${r.version} approved`);
    } else {
      if (!String(note || '').trim()) throw new UserError('Say what needs fixing so the lab can correct it.');
      db.run("UPDATE reports SET status = 'rejected', reviewed_by = ?, reviewed_at = ?, review_note = ? WHERE id = ?", user.id, nowIso(), String(note).trim(), r.id);
      setStatus(db, s, s.route === 'in_house' ? 'RESULT_READY' : 'PARTNER_REPORT_RECEIVED', user, `Report v${r.version} sent back: ${String(note).trim()}`);
    }
    audit(db, user.id, approve ? 'report_approved' : 'report_rejected', 'sample', s.sample_id, { version: r.version, note });
  });
}

// Step 4: release to the client. The check runs once more on the stored file.
function release(db, storage, user, reportId) {
  requireAdmin(user);
  return db.tx(() => {
    const r = report(db, reportId);
    if (r.status !== 'approved') throw new UserError('Only an approved report can be released.');
    const s = db.get('SELECT * FROM samples WHERE id = ?', r.sample_pk);
    if (s.status !== 'REPORT_APPROVED') throw new UserError(`The sample is "${samples.STATUSES[s.status]}", so the report cannot be released.`);
    const buf = storage.get(r.file_key);
    if (crypto.createHash('sha256').update(buf).digest('hex') !== r.sha256) throw new UserError('The stored file has changed since it was checked. Upload it again.');
    const check = checkReport(db, buf, s);
    if (!check.ok) throw new UserError(`Release blocked: ${check.problems[0]}`);
    const now = nowIso();
    const met = s.tat_due_at ? (now <= s.tat_due_at ? 1 : 0) : null;
    db.run("UPDATE reports SET status = 'released', released_by = ?, released_at = ? WHERE id = ?", user.id, now, r.id);
    setStatus(db, s, 'REPORT_RELEASED', user, `Report v${r.version} released${met === null ? '' : met ? ' within TAT' : ' after the TAT due date'}`, { released_at: now, tat_met: met });
    const p = db.get('SELECT * FROM patients WHERE id = ?', s.patient_id);
    const test = db.get('SELECT name FROM tests WHERE id = ?', s.test_id);
    const lab = getSetting(db, 'labName');
    const fileName = `${s.sample_id}_${p.full_name.replace(/[^A-Za-z0-9]+/g, '_')}.pdf`;
    notify.queue(db, {
      code: 'N13', channel: 'email', recipient: p.email, recipientName: p.full_name, samplePk: s.id,
      attachmentKey: r.file_key, attachmentName: fileName,
      subject: `Your ${lab} report is ready`,
      body: `Dear ${p.full_name},\n\nYour ${test.name} report (sample ${s.sample_id}) is ready and attached to this email.\n\nOur genetic counsellor will contact you to book your counselling session, where we explain your results and give you a personalised action plan.\n\nFor help, call ${getSetting(db, 'supportPhone')} or write to ${getSetting(db, 'supportEmail')}.\n\n${lab}`,
    });
    notify.queue(db, {
      code: 'N13', channel: 'whatsapp', recipient: p.mobile, recipientName: p.full_name, samplePk: s.id,
      body: `${lab}: Dear ${p.full_name}, your ${test.name} report (sample ${s.sample_id}) is ready. We have emailed it to you${p.email ? '' : ' (please share your email address)'}. Our counsellor will call you to book your counselling session.`,
    });
    const account = db.get('SELECT * FROM accounts WHERE id = ?', s.account_id);
    if (account.type !== 'main') {
      notify.queue(db, { code: 'N13', channel: 'email', recipient: account.email, recipientName: account.contact_name || account.name, accountId: account.id, samplePk: s.id,
        subject: `Report released for ${s.sample_id}`, body: `${lab}: the report for sample ${s.sample_id} has been sent to the client.` });
    }
    audit(db, user.id, 'report_released', 'sample', s.sample_id, { version: r.version, tatMet: met });
    return { tatMet: met };
  });
}

function forSample(db, samplePk) {
  return db.all(
    `SELECT r.*, u.name AS uploaded_by_name, rv.name AS reviewed_by_name FROM reports r
       LEFT JOIN users u ON u.id = r.uploaded_by LEFT JOIN users rv ON rv.id = r.reviewed_by
      WHERE r.sample_pk = ? ORDER BY r.kind ASC, r.version DESC`, samplePk)
    .map((r) => ({ ...r, check: r.check_json ? JSON.parse(r.check_json) : null }));
}

// Who may open a stored report file.
function canOpen(user, r, s) {
  if (['admin', 'lab'].includes(user.role)) return true;
  if (user.role !== 'counsellor') return false;
  if (r.kind === 'branded') return r.status === 'released';
  // The partner's original PDF is needed in Report Studio to draft the action plan.
  return !!s && COUNSELLING_STAGES.includes(s.status) && (!s.counsellor_id || s.counsellor_id === user.id);
}

function queues(db) {
  const base = `SELECT s.*, t.name AS test_name, t.route, p.full_name, a.name AS account_name FROM samples s
    JOIN tests t ON t.id = s.test_id JOIN patients p ON p.id = s.patient_id JOIN accounts a ON a.id = s.account_id`;
  const by = (statuses, order = 's.tat_due_at') => db.all(`${base} WHERE s.status IN (${statuses.map(() => '?').join(',')}) ORDER BY ${order}`, ...statuses);
  return {
    awaitingSource: by(['RECEIVED_AT_PARTNER', 'IN_HOUSE_PROCESSING']),
    awaitingBranded: by(['PARTNER_REPORT_RECEIVED', 'RESULT_READY']),
    awaitingApproval: by(['REPORT_WHITE_LABELLED']),
    awaitingRelease: by(['REPORT_APPROVED']),
    released: db.all(`${base} WHERE s.released_at >= ? ORDER BY s.released_at DESC`, new Date(Date.now() - 30 * 86400000).toISOString()),
  };
}

module.exports = {
  SOURCE_FROM, BRANDED_FROM, COUNSELLING_STAGES, leakTerms, readDocument, checkReport, uploadSource, uploadBranded, review, release, report, forSample, canOpen, queues,
};
