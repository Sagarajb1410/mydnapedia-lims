// Registering many samples from an Excel sheet: template, upload and check,
// then confirm. Loaded before the sample pages so /samples/bulk is not read as
// a sample ID.
const { html, icon } = require('./views');
const bulk = require('../bulk');
const samples = require('../samples');
const billing = require('../billing');
const { UserError, rupees, audit } = require('../util');

module.exports = function routes(router, { db }, h) {
  const allowed = (u) => { if (!samples.canRegister(u)) throw new UserError('You cannot register samples.'); };

  const intro = (ctx) => {
    const account = samples.registeringAccount(db, ctx.user);
    const bal = account && account.type === 'partner' ? billing.balance(db, account.id) : null;
    return html`<a class="crumb" href="/samples/new">${icon('back')}Register a sample</a>
<div class="head"><div><h1>Register samples from Excel</h1>
<p class="sub">Registering for <b>${account ? account.name : ''}</b>.${bal != null ? html` Credit balance: <b class="${bal < 0 ? 'neg' : ''}">${rupees(bal)}</b>. Each test price is deducted when you confirm.` : ''}</p></div></div>`;
  };

  router.get('/samples/bulk', (ctx) => {
    allowed(ctx.user);
    h.send(ctx, 'Register from Excel', html`${intro(ctx)}
<div class="card" style="max-width:720px">
<ol style="margin:0;padding-left:20px;display:grid;gap:14px">
<li><b>Download the template.</b> It has one column for each detail on the registration form, and a second sheet listing your tests and the states.<br>
<a class="btn light" href="/samples/bulk/template" style="margin-top:8px">${icon('download')}Download the Excel template</a></li>
<li><b>Fill one row per sample</b> and save the file. Up to ${bulk.MAX_ROWS} rows at a time.</li>
<li><b>Upload it.</b> Every row is checked first. Nothing is registered until you confirm.</li>
</ol>
<form method="post" action="/samples/bulk" enctype="multipart/form-data" style="margin-top:14px;border-top:1px solid var(--line);padding-top:16px">
<label for="file">Filled Excel file (.xlsx) or CSV</label>
<input id="file" type="file" name="file" accept=".xlsx,.csv" required>
<div class="actions"><button>${icon('upload')}Upload and check</button></div></form></div>`);
  });

  router.get('/samples/bulk/template', (ctx) => {
    allowed(ctx.user);
    h.raw(ctx, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', bulk.template(db, ctx.user),
      { 'Content-Disposition': 'attachment; filename="MyDNAPedia-sample-registration-template.xlsx"' });
  });

  router.post('/samples/bulk', (ctx) => {
    allowed(ctx.user);
    let rows;
    try { rows = bulk.check(db, ctx.user, ctx.files.file); } catch (e) {
      if (!(e instanceof UserError)) throw e;
      return h.redirect(ctx, '/samples/bulk', { type: 'error', text: e.message });
    }
    const bad = rows.filter((r) => r.errors.length);
    const good = rows.length - bad.length;
    const token = bulk.hold(ctx.user, rows);
    h.send(ctx, 'Check your upload', html`${intro(ctx)}
<div class="card">
<div class="head" style="margin-bottom:10px"><div><h2 style="margin:0">${good} of ${rows.length} rows are ready</h2>
<p class="sub">${bad.length ? html`${bad.length} ${bad.length === 1 ? 'row needs' : 'rows need'} fixing. You can register the ready rows now and upload the others again after fixing them, or fix the file and upload it again.` : 'Every row passed the checks.'}</p></div>
<div class="actions" style="margin:0"><a class="btn light" href="/samples/bulk">Upload a different file</a>
${good ? html`<form method="post" action="/samples/bulk/confirm" style="margin:0"><input type="hidden" name="token" value="${token}"><button>${icon('check')}Register ${good} ${good === 1 ? 'sample' : 'samples'}</button></form>` : ''}</div></div>
<div class="table-wrap"><table><thead><tr><th>Row</th><th>Patient</th><th>Test</th><th>Result</th></tr></thead><tbody>
${rows.map((r) => html`<tr><td>${r.line}</td><td>${r.label.name || '—'}</td><td>${r.label.test || '—'}</td>
<td>${r.errors.length ? html`<span class="pill bad">Fix</span> ${r.errors.join(' ')}` : html`<span class="pill good">Ready</span>`}</td></tr>`)}
</tbody></table></div></div>`);
  });

  router.post('/samples/bulk/confirm', (ctx) => {
    allowed(ctx.user);
    const out = bulk.confirm(db, ctx.user, String(ctx.body.token || ''));
    audit(db, ctx.user.id, 'samples_bulk_registered', 'sample', null, { count: out.sampleIds.length });
    const ids = out.sampleIds.join(',');
    h.send(ctx, 'Samples registered', html`<div class="flash ok">${icon('check')}<div>${out.sampleIds.length} ${out.sampleIds.length === 1 ? 'sample' : 'samples'} registered.${out.skipped ? ` ${out.skipped} ${out.skipped === 1 ? 'row was' : 'rows were'} left out; fix ${out.skipped === 1 ? 'it' : 'them'} and upload again.` : ''} Each patient gets the registration message with their tracking link.</div></div>
<div class="head"><div><h1>Samples registered</h1><p class="sub">Print the labels and stick one on each tube.</p></div>
<div class="actions" style="margin:0"><a class="btn" href="/samples/labels?ids=${encodeURIComponent(ids)}" target="_blank">${icon('print')}Print all labels</a><a class="btn light" href="/samples">Go to samples</a></div></div>
<div class="card"><div class="table-wrap"><table><thead><tr><th>Sample ID</th><th>Patient</th><th>Test</th></tr></thead><tbody>
${out.sampleIds.map((id) => {
    const r = db.get('SELECT p.full_name, t.name AS test FROM samples s JOIN patients p ON p.id = s.patient_id JOIN tests t ON t.id = s.test_id WHERE s.sample_id = ?', id);
    return html`<tr><td><a href="/samples/${id}"><b>${id}</b></a></td><td>${r.full_name}</td><td>${r.test}</td></tr>`;
  })}</tbody></table></div></div>`);
  });
};
