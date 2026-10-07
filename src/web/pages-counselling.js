// Module 5: counselling screens (work list, booking, form, case file, action plan).
const { html, raw, field, select, statusPill } = require('./views');
const counselling = require('../counselling');
const form = require('../counselling-form');
const reports = require('../reports');
const samples = require('../samples');
const { fmtDateTime, fmtDate, UserError } = require('../util');

const PLAN_STATUS = { blocked: 'Blocked', pending: 'Waiting for approval', rejected: 'Sent back', approved: 'Approved', delivered: 'Sent to client', superseded: 'Replaced' };
const PLAN_TONE = { blocked: 'bad', rejected: 'bad', pending: 'warn', approved: 'good', delivered: 'good' };

function allowed(ctx) {
  if (!['admin', 'counsellor'].includes(ctx.user.role)) throw new UserError('This page is for counsellors and the admin.');
}

function checkBox(check) {
  if (!check) return '';
  return html`${check.problems.length ? html`<div class="flash error" style="margin:8px 0"><b>Blocked.</b> <ul style="margin:4px 0 0 18px;padding:0">${check.problems.map((p) => html`<li>${p}</li>`)}</ul></div>`
    : html`<div class="flash ok" style="margin:8px 0">Passed the check: no partner names, partner reference or other client's details found.</div>`}
${check.warnings.length ? html`<div class="flash warn" style="margin:8px 0"><ul style="margin:0 0 0 18px;padding:0">${check.warnings.map((w) => html`<li>${w}</li>`)}</ul></div>` : ''}`;
}

module.exports = function (router, { db, storage }, h) {
  const loadSample = (ctx) => {
    const s = samples.load(db, ctx.user, ctx.params.id);
    return { s, p: db.get('SELECT * FROM patients WHERE id = ?', s.patient_id), t: db.get('SELECT * FROM tests WHERE id = ?', s.test_id) };
  };

  // ---------- The counselling card on the sample page ----------
  h.counsellingCard = (user, s, t) => {
    if (!['admin', 'counsellor'].includes(user.role) || !counselling.STAGES.includes(s.status)) return '';
    const mayAct = counselling.canActOn(user, s);
    const session = counselling.currentSession(db, s.id);
    const f = counselling.loadForm(db, s.id);
    const plans = counselling.plansFor(db, s.id);
    const pending = plans.find((r) => r.status === 'pending');
    const approved = plans.find((r) => r.status === 'approved');
    const released = db.get("SELECT id FROM reports WHERE sample_pk = ? AND kind = 'branded' AND status = 'released' ORDER BY version DESC LIMIT 1", s.id);
    const source = db.get("SELECT id FROM reports WHERE sample_pk = ? AND kind = 'source' ORDER BY version DESC LIMIT 1", s.id);
    const cs = counselling.counsellors(db);
    const now = new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 16);
    const bookForm = html`<form method="post" action="/samples/${s.sample_id}/counselling/book" class="noprint" style="margin-top:12px">
<div class="grid">${field('Date and time', 'when', '', { type: 'datetime-local', required: true, attrs: `min="${now}"` })}
${select('How', 'mode', counselling.MODES, 'Video call', { required: true })}
${field('Meeting link', 'link', session && session.status === 'scheduled' ? session.meeting_link || '' : '', { opt: true, attrs: 'placeholder="https://meet.google.com/…"' })}
${user.role === 'admin' ? select('Counsellor', 'counsellor', cs.map((c) => [c.id, c.name]), s.counsellor_id || (cs[0] && cs[0].id), { required: true }) : ''}</div>
<div class="actions"><button>${s.status === 'COUNSELLING_SCHEDULED' ? 'Rebook and message the client' : 'Book and message the client'}</button></div></form>`;
    return html`<div class="card"><h2 style="margin-top:0">Counselling</h2><dl class="facts">
<dt>Report</dt><dd>${released ? html`<a href="/reports/${released.id}/file" target="_blank">Open the released report</a>` : '—'}${source && mayAct ? html` · <a href="/reports/${source.id}/file" target="_blank">partner's original (for Report Studio)</a>` : ''}</dd>
${session ? html`<dt>Session</dt><dd>${fmtDateTime(session.scheduled_at)} · ${session.mode} with ${session.counsellor_name}<br><span class="pill ${session.status === 'done' ? 'good' : session.status === 'no_show' ? 'bad' : ''}">${{ scheduled: 'Booked', done: 'Held', no_show: 'Did not attend', cancelled: 'Cancelled' }[session.status]}</span>${session.meeting_link ? html` <a href="${session.meeting_link}" target="_blank" rel="noopener">Meeting link</a>` : ''}</dd>` : ''}
<dt>Counselling form</dt><dd>${f ? html`<span class="pill ${f.status === 'complete' ? 'good' : 'warn'}">${f.status === 'complete' ? 'Complete' : 'Draft'}</span> · updated ${fmtDateTime(f.updated_at)}` : 'Not started'}</dd></dl>
${!mayAct ? html`<p class="muted">This client is booked with another counsellor.</p>` : ''}
${mayAct && ['REPORT_RELEASED', 'COUNSELLING_SCHEDULED'].includes(s.status) ? bookForm : ''}
${mayAct && s.status === 'COUNSELLING_SCHEDULED' ? html`<form method="post" action="/samples/${s.sample_id}/counselling/outcome" class="noprint" style="margin-top:12px;border-top:1px solid var(--line);padding-top:12px">
<b>After the session</b><div style="margin-top:6px">${field('Note', 'note', '', { opt: true })}</div>
<div class="actions"><button name="outcome" value="done">Session held</button><button class="light" name="outcome" value="no_show">Client did not attend</button></div></form>` : ''}
${mayAct && counselling.FORM_OPEN.includes(s.status) ? html`<div class="actions noprint"><a class="btn ${f && f.status === 'complete' ? 'light' : ''}" href="/samples/${s.sample_id}/counselling/form">${f ? 'Open the counselling form' : 'Fill in the counselling form'}</a>
<a class="btn light" href="/samples/${s.sample_id}/counselling/case-file">Download case file for Report Studio</a></div>
<p class="muted" style="margin:6px 0 0">In Report Studio: open the case file, then load the partner's original PDF (the client's name must match), build the action plan and save it as Word.</p>` : ''}
${plans.length ? html`<h3 style="margin:16px 0 6px;font-size:15px">Action plan</h3><div class="table-wrap"><table><tr><th>File</th><th>Uploaded</th><th>Status</th></tr>
${plans.map((r) => html`<tr><td><a href="/plans/${r.id}/file">Action plan v${r.version}</a> <span class="muted">(${r.file_type === 'docx' ? 'Word' : 'PDF'})</span></td><td>${fmtDateTime(r.uploaded_at)}<br><span class="muted">${r.uploaded_by_name || ''}</span></td>
<td><span class="pill ${PLAN_TONE[r.status] || ''}">${PLAN_STATUS[r.status]}</span>${r.review_note ? html`<br><span class="muted">${r.reviewed_by_name}: ${r.review_note}</span>` : ''}</td></tr>`)}</table></div>
${['blocked', 'pending'].includes(plans[0].status) ? checkBox(plans[0].check) : ''}` : ''}
${mayAct && ['COUNSELLING_DONE', 'ACTION_PLAN_DRAFTED'].includes(s.status) ? html`<form method="post" action="/samples/${s.sample_id}/plan" enctype="multipart/form-data" class="noprint" style="margin-top:12px">
<label for="plan-file">Action plan from Report Studio (Word or PDF)</label><input id="plan-file" type="file" name="file" accept=".docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" required>
<p class="muted" style="margin:4px 0 0">${f && f.status === 'complete' ? 'It is checked for partner names and the client\'s details before the admin approves it.' : 'Complete the counselling form before uploading the plan.'}</p>
<div class="actions"><button>Upload and check</button></div></form>` : ''}
${pending && user.role === 'admin' ? html`<form method="post" action="/plans/${pending.id}/review" class="noprint" style="margin-top:14px;border-top:1px solid var(--line);padding-top:12px">
<b>Approve the action plan</b><p class="muted" style="margin:4px 0"><a href="/plans/${pending.id}/file">Download it</a> and read it in full.</p>
<label style="font-weight:400;display:flex;gap:8px;align-items:center"><input type="checkbox" name="pages_checked" value="yes" style="width:auto"> I read the whole plan; the advice is right for this client and names no partner lab.</label>
<div style="margin-top:8px"><label for="plan-note">Note <span class="opt">(needed to send it back)</span></label><input id="plan-note" name="note"></div>
<div class="actions"><button name="do" value="approve">Approve</button><button class="danger" name="do" value="reject">Send back</button></div></form>` : ''}
${pending && user.role !== 'admin' ? html`<p class="muted">Waiting for the admin to approve the plan.</p>` : ''}
${approved && mayAct && s.status === 'ACTION_PLAN_APPROVED' ? html`<form method="post" action="/plans/${approved.id}/deliver" class="noprint" style="margin-top:14px">
<p class="muted" style="margin:0">Sending checks the file once more and puts the client's email (with the plan to attach) and WhatsApp in the outbox.</p>
<div class="actions"><button>Send the plan to the client</button></div></form>` : ''}
${s.status === 'DELIVERED' && user.role === 'admin' ? html`<form method="post" action="/samples/${s.sample_id}/close" class="noprint" style="margin-top:14px"><div class="grid">${field('Closing note', 'note', '', { opt: true })}</div>
<div class="actions"><button class="light">Close the case</button></div></form>` : ''}
</div>`;
  };

  // ---------- Work list ----------
  router.get('/counselling', (ctx) => {
    allowed(ctx);
    const q = counselling.queues(db, ctx.user);
    const table = (rows, empty, col) => html`<div class="table-wrap"><table><tr><th>Client</th><th>Test</th><th>Counsellor</th><th>${col[0]}</th></tr>
${rows.map((r) => html`<tr><td><a href="/samples/${r.sample_id}">${r.full_name}</a><br><span class="mono muted">${r.sample_id}</span> · <span class="muted">${r.mobile}</span></td><td>${r.test_name}</td>
<td>${r.counsellor_name || html`<span class="muted">Not assigned</span>`}</td><td>${col[1](r)}</td></tr>`)}
${rows.length ? '' : html`<tr><td colspan="4" class="muted">${empty}</td></tr>`}</table></div>`;
    const formPill = (r) => html`<span class="pill ${r.form_status === 'complete' ? 'good' : 'warn'}">${r.form_status === 'complete' ? 'Form complete' : r.form_status === 'draft' ? 'Form in draft' : 'Form not started'}</span>`;
    h.send(ctx, 'Counselling', html`<h1>Counselling</h1><p class="sub">${ctx.user.role === 'counsellor' ? 'Your clients and clients not yet assigned.' : 'All clients from report release to the action plan.'}</p>
<div class="stats"><div class="stat"><b>${q.toBook.length}</b><span>To book</span></div><div class="stat"><b>${q.booked.length}</b><span>Sessions booked</span></div>
<div class="stat"><b>${q.planToDo.length}</b><span>Action plans to prepare</span></div><div class="stat"><b>${q.awaitingApproval.length}</b><span>Plans waiting for approval</span></div><div class="stat"><b>${q.toSend.length}</b><span>Plans to send</span></div></div>
<h2>Book a session (${q.toBook.length})</h2>${table(q.toBook, 'Nobody is waiting.', ['Report released', (r) => fmtDate(r.released_at)])}
<h2>Booked (${q.booked.length})</h2>${table(q.booked, 'No sessions booked.', ['Session', (r) => html`${fmtDateTime(r.session_at)}<br>${formPill(r)}`])}
<h2>Prepare the action plan (${q.planToDo.length})</h2>${table(q.planToDo, 'Nothing to prepare.', ['Form', formPill])}
<h2>Waiting for approval (${q.awaitingApproval.length})</h2>${table(q.awaitingApproval, 'Nothing waiting.', ['Status', (r) => statusPill(r.status, samples.STATUSES[r.status])])}
<h2>Approved, send to client (${q.toSend.length})</h2>${table(q.toSend, 'Nothing to send.', ['Status', (r) => statusPill(r.status, samples.STATUSES[r.status])])}
<h2>Delivered (${q.delivered.length})</h2>${table(q.delivered, 'None yet.', ['Status', (r) => statusPill(r.status, samples.STATUSES[r.status])])}`);
  });

  // ---------- Booking and outcome ----------
  router.post('/samples/:id/counselling/book', (ctx) => {
    loadSample(ctx);
    counselling.schedule(db, ctx.user, ctx.params.id, { when: ctx.body.when, mode: ctx.body.mode, link: ctx.body.link, counsellorId: ctx.body.counsellor });
    h.redirect(ctx, `/samples/${ctx.params.id}`, { type: 'ok', text: 'Session booked. The client\'s WhatsApp and email are waiting in the outbox.' });
  });
  router.post('/samples/:id/counselling/outcome', (ctx) => {
    const { s } = loadSample(ctx);
    counselling.sessionOutcome(db, ctx.user, ctx.params.id, { outcome: ctx.body.outcome, note: ctx.body.note });
    const f = counselling.loadForm(db, s.id);
    const formDone = f && f.status === 'complete';
    if (ctx.body.outcome !== 'done') return h.redirect(ctx, `/samples/${ctx.params.id}`, { type: 'ok', text: 'Marked as not attended. Book the session again.' });
    h.redirect(ctx, formDone ? `/samples/${ctx.params.id}` : `/samples/${ctx.params.id}/counselling/form`,
      { type: 'ok', text: formDone ? 'Session marked as held. Download the case file for Report Studio to prepare the action plan.' : 'Session marked as held. Complete the counselling form.' });
  });

  // ---------- Counselling form ----------
  function formPage(ctx, data, flash) {
    const { s, p, t } = loadSample(ctx);
    if (flash) ctx.flash = flash;
    const v = (k) => form.get(data, k) ?? '';
    const bmi = form.bmi(data);
    const bySec = {};
    for (const f of form.FIELDS) (bySec[f.sec] ||= []).push(f);
    const input = (f) => {
      const name = f.key;
      if (f.type === 'select') return select(f.label + (f.opt ? '' : ' *'), name, f.options, v(name));
      if (f.type === 'textarea') return html`<div style="grid-column:1/-1"><label for="${name}">${f.label}${f.opt ? html` <span class="opt">(optional)</span>` : ' *'}</label><textarea id="${name}" name="${name}" rows="3">${v(name)}</textarea></div>`;
      if (f.type === 'checks') {
        const on = new Set(v(name) || []);
        return html`<div style="grid-column:1/-1"><label>${f.label}</label><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:4px 16px">
${f.options.map(([k, l]) => html`<label style="font-weight:400;display:flex;gap:8px;align-items:center"><input type="checkbox" name="${name}[]" value="${k}" ${on.has(k) ? raw('checked') : ''} style="width:auto">${l}</label>`)}</div></div>`;
      }
      return field(f.label + (f.opt ? '' : ' *'), name, v(name), { opt: false, attrs: [f.type === 'number' ? 'inputmode="decimal"' : '', f.placeholder ? `placeholder="${f.placeholder}"` : ''].join(' ') });
    };
    h.send(ctx, 'Counselling form', html`<p class="noprint"><a href="/samples/${s.sample_id}">← ${s.sample_id}</a></p>
<h1>Counselling form</h1><p class="sub">${p.full_name} · ${p.gender} · ${t.name} · <span class="mono">${s.sample_id}</span></p>
<form method="post" action="/samples/${s.sample_id}/counselling/form">
${Object.entries(form.SECTIONS).map(([sec, title]) => html`<div class="card"><h2 style="margin-top:0">${title}</h2>
${sec === 'A1' ? html`<p class="muted" style="margin-top:-4px">BMI: <b>${bmi == null ? '—' : bmi}</b>${bmi == null ? '' : ` (${form.bmiLabel(bmi)}, Asian cut-offs)`}. It is worked out from height and weight when you save.</p>` : ''}
<div class="grid">${(bySec[sec] || []).map(input)}</div></div>`)}
<p class="muted">* needed before the form can be completed. Save a draft at any time.</p>
<div class="actions"><button name="do" value="save" class="light">Save draft</button><button name="do" value="complete">Save and mark complete</button></div></form>`);
  }

  router.get('/samples/:id/counselling/form', (ctx) => {
    allowed(ctx);
    const { s } = loadSample(ctx);
    if (!counselling.canActOn(ctx.user, s)) throw new UserError('This client is booked with another counsellor.');
    const f = counselling.loadForm(db, s.id);
    formPage(ctx, f ? f.data : { life: {} });
  });
  router.post('/samples/:id/counselling/form', (ctx) => {
    allowed(ctx);
    loadSample(ctx);
    ctx.retry = (msg) => formPage(ctx, form.rawFromBody(ctx.body), { type: 'error', text: msg });
    const complete = ctx.body.do === 'complete';
    counselling.saveForm(db, ctx.user, ctx.params.id, ctx.body, { complete });
    h.redirect(ctx, complete ? `/samples/${ctx.params.id}` : `/samples/${ctx.params.id}/counselling/form`,
      { type: 'ok', text: complete ? 'Counselling form complete. Download the case file for Report Studio to prepare the action plan.' : 'Draft saved.' });
  });

  router.get('/samples/:id/counselling/case-file', (ctx) => {
    allowed(ctx);
    const { s } = loadSample(ctx);
    if (!counselling.canActOn(ctx.user, s)) throw new UserError('This client is booked with another counsellor.');
    const c = counselling.caseFile(db, ctx.user, s.sample_id);
    h.raw(ctx, 'application/json; charset=utf-8', JSON.stringify(c, null, 2), { 'Content-Disposition': `attachment; filename="${s.sample_id}_case.json"` });
  });

  // ---------- Action plan ----------
  router.post('/samples/:id/plan', (ctx) => {
    allowed(ctx);
    loadSample(ctx);
    const r = counselling.uploadPlan(db, storage, ctx.user, ctx.params.id, ctx.files.file);
    h.redirect(ctx, `/samples/${ctx.params.id}`, r.check.ok
      ? { type: 'ok', text: 'The action plan passed the check and is waiting for the admin to approve it.' }
      : { type: 'error', text: 'The action plan was blocked. See what was found below, fix it and upload it again.' });
  });
  const planSample = (id) => {
    const r = counselling.plan(db, id);
    return { r, s: db.get('SELECT * FROM samples WHERE id = ?', r.sample_pk) };
  };
  router.post('/plans/:id/review', (ctx) => {
    const { r, s } = planSample(ctx.params.id);
    const approve = ctx.body.do === 'approve';
    counselling.reviewPlan(db, storage, ctx.user, r.id, { approve, note: ctx.body.note, pagesChecked: ctx.body.pages_checked === 'yes' });
    h.redirect(ctx, `/samples/${s.sample_id}`, { type: 'ok', text: approve ? 'Approved. The counsellor can now send it to the client.' : 'Sent back to the counsellor with your note.' });
  });
  router.post('/plans/:id/deliver', (ctx) => {
    const { r, s } = planSample(ctx.params.id);
    counselling.deliver(db, storage, ctx.user, r.id);
    h.redirect(ctx, `/samples/${s.sample_id}`, { type: 'ok', text: 'Sent. The client\'s email (with the plan to attach) and WhatsApp are waiting in the outbox.' });
  });
  router.get('/plans/:id/file', (ctx) => {
    const { r, s } = planSample(ctx.params.id);
    if (!counselling.canOpenPlan(ctx.user, r, s)) throw new UserError('File not found.');
    const type = r.file_type === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    h.raw(ctx, type, storage.get(r.file_key), { 'Content-Disposition': `attachment; filename="${s.sample_id}-action-plan-v${r.version}.${r.file_type}"`, 'X-Content-Type-Options': 'nosniff' });
  });
  router.post('/samples/:id/close', (ctx) => {
    counselling.closeCase(db, ctx.user, ctx.params.id, ctx.body.note);
    h.redirect(ctx, `/samples/${ctx.params.id}`, { type: 'ok', text: 'Case closed.' });
  });
};
