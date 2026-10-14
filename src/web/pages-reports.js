// Module 4: report screens (upload, check, approval, release).
const { html, raw, statusPill } = require('./views');
const reports = require('../reports');
const samples = require('../samples');
const tracking = require('../tracking');
const { fmtDateTime, fmtDate, UserError } = require('../util');
const { head: centreHead } = require('./pages-studio');

const REPORT_STATUS = { received: 'Received', blocked: 'Blocked', pending: 'Waiting for approval', rejected: 'Sent back', approved: 'Approved', released: 'Released', superseded: 'Replaced' };
const REPORT_TONE = { blocked: 'bad', rejected: 'bad', pending: 'warn', approved: 'good', released: 'good' };

function staffOnly(ctx) {
  if (!['admin', 'lab'].includes(ctx.user.role)) throw new UserError('This page is for MyDNAPedia staff.');
}

function checkResult(check) {
  if (!check) return '';
  if (check.pictureOnly) {
    return html`<div class="flash warn" style="margin:8px 0"><div><b>Pictures only.</b> The LIMS cannot read any text in this report, so it could not check it for partner names or the sample ID.
The admin must check all ${check.pages || ''} pages by eye before approving. Tip: a report saved straight from Report Centre has real text and is checked automatically.</div></div>`;
  }
  return html`${check.problems.length ? html`<div class="flash error" style="margin:8px 0"><b>Blocked.</b> ${check.problems.length === 1 ? check.problems[0] : html`<ul style="margin:4px 0 0 18px;padding:0">${check.problems.map((p) => html`<li>${p}</li>`)}</ul>`}</div>`
    : html`<div class="flash ok" style="margin:8px 0">Passed the check: no partner names, partner reference or wrong sample ID found in ${check.pages} pages.</div>`}
${check.warnings.length ? html`<div class="flash warn" style="margin:8px 0"><ul style="margin:0 0 0 18px;padding:0">${check.warnings.map((w) => html`<li>${w}</li>`)}</ul></div>` : ''}`;
}

module.exports = function (router, { db, storage }, h) {
  // The report card on the sample page, for staff.
  h.reportCard = (user, s, t) => {
    const list = reports.forSample(db, s.id);
    const sources = list.filter((r) => r.kind === 'source');
    const branded = list.filter((r) => r.kind === 'branded');
    const canSource = (reports.SOURCE_FROM[t.route] || []).includes(s.status);
    const canBranded = reports.BRANDED_FROM.includes(s.status);
    const pending = branded.find((r) => r.status === 'pending');
    const approved = branded.find((r) => r.status === 'approved');
    if (!list.length && !canSource && !['IN_TRANSIT_TO_PARTNER', 'DISPATCH_TO_PARTNER_SCHEDULED'].includes(s.status)) return '';
    const sourceLabel = t.route === 'in_house' ? 'In-house result' : 'Partner lab report';
    return html`<div class="card"><h2 style="margin-top:0">Report</h2>
${s.status === 'IN_TRANSIT_TO_PARTNER' || s.status === 'DISPATCH_TO_PARTNER_SCHEDULED' ? html`<p class="muted">Mark the sample as received at the partner lab before adding its report.</p>` : ''}
${list.length ? html`<div class="table-wrap"><table><tr><th>File</th><th>Uploaded</th><th>Status</th></tr>
${list.map((r) => html`<tr><td><a href="/reports/${r.id}/file" target="_blank">${r.kind === 'source' ? sourceLabel : 'White-labelled report'} v${r.version}</a>${r.pages ? html`<br><span class="muted">${r.pages} pages</span>` : ''}</td>
<td>${fmtDateTime(r.uploaded_at)}<br><span class="muted">${r.uploaded_by_name || ''}</span></td>
<td><span class="pill ${REPORT_TONE[r.status] || ''}">${REPORT_STATUS[r.status]}</span>${r.review_note ? html`<br><span class="muted">${r.reviewed_by_name}: ${r.review_note}</span>` : ''}</td></tr>`)}</table></div>` : ''}
${branded[0] && ['blocked', 'pending'].includes(branded[0].status) ? checkResult(branded[0].check) : ''}
${canSource ? html`<form method="post" action="/samples/${s.sample_id}/report/source" enctype="multipart/form-data" class="noprint" style="margin-top:12px">
<label for="source-file">${sources.length ? `Replace the ${sourceLabel.toLowerCase()} (saved as v${sources[0].version + 1}; earlier versions are kept)` : `Add the ${sourceLabel.toLowerCase()}`} (PDF)</label><input id="source-file" type="file" name="file" accept="application/pdf" required>
<div class="actions"><button class="${canBranded ? 'light' : ''}">Upload</button></div></form>` : ''}
${canBranded && sources.length ? html`<div class="actions noprint" style="margin-top:12px">${h.studioButton('Convert in Report Centre', s.sample_id, 'convert', '')}</div>
<p class="muted" style="margin:4px 0 0">Report Centre opens with this partner report and the client's details loaded. Send the result back from its LIMS tab.</p>` : ''}
${canBranded ? html`<form method="post" action="/samples/${s.sample_id}/report/branded" enctype="multipart/form-data" class="noprint" style="margin-top:12px">
<label for="branded-file">${branded.length ? `Upload a corrected white-labelled report (saved as v${branded[0].version + 1}; earlier versions are kept)` : 'Or upload the white-labelled report by hand'} (PDF)</label><input id="branded-file" type="file" name="file" accept="application/pdf" required>
<p class="muted" style="margin:4px 0 0">It is checked for partner names, the partner's reference and this sample's ID before anyone can approve it.</p>
<div class="actions"><button>Upload and check</button></div></form>` : ''}
${pending && user.role === 'admin' ? html`<form method="post" action="/reports/${pending.id}/review" class="noprint" style="margin-top:14px;border-top:1px solid var(--line);padding-top:12px">
<b>Approve the white-labelled report</b><p class="muted" style="margin:4px 0"><a href="/reports/${pending.id}/file" target="_blank">Open it</a> and look at every page, including pictures.</p>
<label style="font-weight:400;display:flex;gap:8px;align-items:center"><input type="checkbox" name="pages_checked" value="yes" style="width:auto"> I looked at every page and it shows no partner lab name or logo.</label>
${pending.check && pending.check.pictureOnly ? html`<label style="font-weight:400;display:flex;gap:8px;align-items:center;margin-top:6px"><input type="checkbox" name="pictures_checked" value="yes" style="width:auto"> Pictures only: I also checked that it shows sample ID ${s.sample_id} and the client's name, and no partner reference.</label>` : ''}
<div style="margin-top:8px"><label for="review-note">Note <span class="opt">(needed to send it back)</span></label><input id="review-note" name="note"></div>
<div class="actions"><button name="do" value="approve">Approve</button><button class="danger" name="do" value="reject">Send back</button></div></form>` : ''}
${pending && user.role !== 'admin' ? html`<p class="muted">Waiting for the admin to approve.</p>` : ''}
${approved && user.role === 'admin' && s.status === 'REPORT_APPROVED' ? html`<form method="post" action="/reports/${approved.id}/release" class="noprint" style="margin-top:14px">
<p class="muted" style="margin:0">Releasing checks the file once more, stops the TAT clock and puts the client's email (with the report to attach) and WhatsApp in the outbox.</p>
<div class="actions"><button>Release to client</button></div></form>` : ''}
</div>`;
  };

  // ---------- Report queue ----------
  router.get('/reports', (ctx) => {
    staffOnly(ctx);
    const q = reports.queues(db);
    const table = (rows, empty, extra) => html`<div class="table-wrap"><table><tr><th>Sample</th><th>Test</th><th>From</th><th>Status</th><th>TAT</th></tr>
${rows.map((r) => {
    const t = tracking.tatState(r);
    return html`<tr><td><a class="mono" href="/samples/${r.sample_id}">${r.sample_id}</a><br><span class="muted">${r.full_name}</span></td><td>${r.test_name}</td><td>${r.account_name}</td>
<td>${statusPill(r.status, samples.STATUSES[r.status])}</td><td>${extra ? extra(r) : t ? html`<span class="pill ${t.level === 'red' ? 'bad' : t.level === 'amber' ? 'warn' : 'good'}">${t.level === 'red' ? 'Overdue' : `${t.daysLeft.toFixed(1)} days left`}</span>` : ''}</td></tr>`;
  })}
${rows.length ? '' : html`<tr><td colspan="5" class="muted">${empty}</td></tr>`}</table></div>`;
    const step = (n, title, text) => html`<div class="kpi"><span class="k">Step ${n}</span><b style="font-size:16px;margin-top:6px">${title}</b><small>${text}</small></div>`;
    h.send(ctx, 'Reports', html`${centreHead(ctx.user, '/reports', 'Partner report to a checked, approved MyDNAPedia report, then counselling and the action plan.')}
<div class="kpis">${step(1, 'Partner report in', 'Upload the PDF the partner lab sent, on the sample page.')}
${step(2, 'Convert', `Open the sample in Report Centre. It loads the partner PDF and the client's details for you.`)}
${step(3, 'Send to the LIMS', 'On the LIMS tab in Report Centre, send the report. The LIMS blocks any partner name.')}
${step(4, 'Approve and release', 'The admin looks at every page, then releases it to the client.')}</div>
<h2>1. Waiting for the result (${q.awaitingSource.length})</h2>${table(q.awaitingSource, 'Nothing waiting.')}
<h2>2. Waiting for the white-labelled report (${q.awaitingBranded.length})</h2>${table(q.awaitingBranded, 'Nothing waiting.')}
<h2>3. Waiting for approval (${q.awaitingApproval.length})</h2>${table(q.awaitingApproval, 'Nothing waiting.')}
<h2>4. Approved, not yet released (${q.awaitingRelease.length})</h2>${table(q.awaitingRelease, 'Nothing waiting.')}
<h2>Released in the last 30 days (${q.released.length})</h2>${table(q.released, 'None yet.', (r) => html`${fmtDate(r.released_at)}<br>${r.tat_met === 1 ? html`<span class="pill good">Within TAT</span>` : r.tat_met === 0 ? html`<span class="pill bad">Late</span>` : ''}`)}`);
  });

  // ---------- Uploads and decisions ----------
  router.post('/samples/:id/report/source', (ctx) => {
    reports.uploadSource(db, storage, ctx.user, ctx.params.id, ctx.files.file);
    h.redirect(ctx, `/samples/${ctx.params.id}`, { type: 'ok', text: 'Saved. Next, convert it in Report Centre.' });
  });
  router.post('/samples/:id/report/branded', (ctx) => {
    const r = reports.uploadBranded(db, storage, ctx.user, ctx.params.id, ctx.files.file);
    h.redirect(ctx, `/samples/${ctx.params.id}`, r.check.ok
      ? { type: 'ok', text: `Saved as v${r.version}. It passed the check and is waiting for the admin to approve it.` }
      : r.check.pictureOnly ? { type: 'warn', text: `Saved as v${r.version}. It is pictures only, so the admin must check every page by eye before approving it.` }
      : { type: 'error', text: 'The report was blocked. See what was found below, fix it in Report Centre and send it again.' });
  });
  router.post('/reports/:id/review', (ctx) => {
    const r = reports.report(db, ctx.params.id);
    const s = db.get('SELECT sample_id FROM samples WHERE id = ?', r.sample_pk);
    const approve = ctx.body.do === 'approve';
    reports.review(db, storage, ctx.user, r.id, { approve, note: ctx.body.note, pagesChecked: ctx.body.pages_checked === 'yes', picturesChecked: ctx.body.pictures_checked === 'yes' });
    h.redirect(ctx, `/samples/${s.sample_id}`, { type: 'ok', text: approve ? 'Approved. Release it when you are ready to send it to the client.' : 'Sent back to the lab with your note.' });
  });
  router.post('/reports/:id/release', (ctx) => {
    const r = reports.report(db, ctx.params.id);
    const s = db.get('SELECT sample_id FROM samples WHERE id = ?', r.sample_pk);
    reports.release(db, storage, ctx.user, r.id);
    h.redirect(ctx, `/samples/${s.sample_id}`, { type: 'ok', text: 'Released. The client\'s email and WhatsApp are waiting in the outbox.' });
  });

  router.get('/reports/:id/file', (ctx) => {
    const r = reports.report(db, ctx.params.id);
    const s = db.get('SELECT * FROM samples WHERE id = ?', r.sample_pk);
    if (!reports.canOpen(ctx.user, r, s)) throw new UserError('File not found.');
    const name = `${s.sample_id}-${r.kind === 'source' ? 'source' : 'report'}-v${r.version}.pdf`;
    h.raw(ctx, 'application/pdf', storage.get(r.file_key), { 'Content-Disposition': `inline; filename="${name}"`, 'X-Content-Type-Options': 'nosniff' });
  });
};
