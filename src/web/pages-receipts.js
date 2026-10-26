// Sample receipt acknowledgements: the list, and the printable one-page
// acknowledgement a partner keeps for each day the lab received its samples.
const { html } = require('./views');
const receipts = require('../receipts');
const { fmtDateTime, fmtDate } = require('../util');

module.exports = function (router, { db }, h) {
  router.get('/receipts', (ctx) => {
    const staff = ['admin', 'lab'].includes(ctx.user.role);
    const rows = receipts.list(db, ctx.user, { accountId: ctx.query.account });
    const tabs = staff ? html`<nav class="seg noprint" aria-label="Tracking">${[['/tracking', 'TAT board'], ['/tracking/pickups', 'Pickups'], ['/tracking/receive', 'Lab receipt'], ['/receipts', 'Acknowledgements'], ['/tracking/onward', 'Partner lab dispatch']]
      .map(([href, label]) => html`<a class="${href === '/receipts' ? 'on' : ''}" href="${href}">${label}</a>`)}</nav>` : '';
    h.send(ctx, 'Lab receipts', html`<h1>${staff ? 'Receipt acknowledgements' : 'Lab receipts'}</h1>
<p class="sub">${staff ? 'One acknowledgement per partner per day, listing every sample the central lab received, its condition and the expected report date.'
      : 'Each time our central lab receives your samples, you get an acknowledgement listing what arrived, its condition and when to expect the report. Open one to print or save it as a PDF.'}</p>${tabs}
<div class="table-wrap"><table><tr><th>Acknowledgement</th><th>Received on</th>${staff ? html`<th>From</th>` : ''}<th>Accepted</th><th>Rejected</th><th></th></tr>
${rows.map((r) => html`<tr><td class="mono">${r.number}</td><td>${fmtDate(r.day)}</td>${staff ? html`<td>${r.account.name}</td>` : ''}<td>${r.accepted}</td>
<td>${r.rejected ? html`<span class="pill bad">${r.rejected}</span>` : '0'}</td><td><a class="btn small" href="/receipts/${r.account.id}/${r.day}">Open</a></td></tr>`)}
${rows.length ? '' : html`<tr><td colspan="${staff ? 6 : 5}" class="muted">No samples have been received at the lab yet.</td></tr>`}</table></div>`);
  });

  router.get('/receipts/:account/:day', (ctx) => {
    const a = receipts.forDay(db, ctx.user, ctx.params.account, ctx.params.day);
    const acc = a.account;
    h.raw(ctx, 'text/html; charset=utf-8', html`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sample receipt ${a.number}</title><style>
@page{size:A4;margin:12mm}
body{font:12px/1.45 Arial,Helvetica,sans-serif;color:#1b2a35;margin:0;background:#e9ecef}
.sheet{max-width:190mm;margin:16px auto;background:#fff;padding:8mm;box-shadow:0 1px 6px rgba(0,0,0,.15)}
.head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;border-bottom:2px solid #1b2a35;padding-bottom:8px}
.head img{height:44px}.head small{display:block;color:#555}.head .r{text-align:right}
h1{font-size:17px;margin:14px 0 4px}.sub{color:#555;margin:0 0 12px}
.meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:6px 18px;margin-bottom:12px}.meta span{display:block;font-size:10px;color:#666;text-transform:uppercase;letter-spacing:.03em}
.tw{overflow-x:auto}table{width:100%;border-collapse:collapse}th,td{border:1px solid #c8d0d6;padding:4px 6px;text-align:left;vertical-align:top}th{background:#f1f4f6;font-size:11px}
.mono{font-family:ui-monospace,Menlo,Consolas,monospace}.ok{color:#17703a;font-weight:bold}.bad{color:#b3261e;font-weight:bold}
.tot{margin:10px 0}.note{font-size:11px;color:#555;margin-top:12px}.sign{display:flex;justify-content:space-between;margin-top:28px;font-size:11px}
.bar{font:13px system-ui;padding:10px;background:#1b2a35;color:#fff;display:flex;gap:12px;align-items:center;justify-content:center;flex-wrap:wrap}.bar button,.bar a{font:inherit;padding:5px 14px;border-radius:6px;border:0;background:#f9b300;color:#1b2a35;font-weight:600;cursor:pointer;text-decoration:none}
@media print{body{background:#fff}.sheet{margin:0;box-shadow:none;padding:0;max-width:none}.bar{display:none}}
</style></head><body><div class="bar"><a href="/receipts">Back</a><button onclick="print()">Print or save as PDF</button></div>
<div class="sheet"><div class="head"><div><img src="/static/logo-sm.png" alt="${a.lab}"><small>${a.unit}</small></div>
<div class="r"><b>${a.company || a.lab}</b>${a.address ? html`<small>${a.address}</small>` : ''}${a.email ? html`<small>${a.email}</small>` : ''}</div></div>
<h1>Sample receipt acknowledgement</h1><p class="sub">The central lab confirms it received the samples below.</p>
<div class="meta"><div><span>Acknowledgement no.</span><b class="mono">${a.number}</b></div><div><span>Received on</span><b>${fmtDate(a.day)}</b></div>
<div><span>From</span><b>${acc.legal_name || acc.name}</b> <span style="display:inline;text-transform:none">(${acc.code})</span></div>
<div><span>Samples</span><b>${a.rows.length}</b> (${a.accepted} accepted${a.rejected ? `, ${a.rejected} rejected` : ''})</div></div>
<div class="tw"><table><tr><th>#</th><th>Sample ID</th><th>Patient</th><th>Test</th><th>Received at</th><th>Condition</th><th>Expected report</th><th>Received by</th></tr>
${a.rows.map((r, i) => html`<tr><td>${i + 1}</td><td class="mono">${r.sample_id}${r.partner_ref ? html`<br><small>Your ref ${r.partner_ref}</small>` : ''}</td><td>${r.full_name}</td><td>${r.test_name}</td>
<td>${fmtDateTime(r.received_at)}</td><td>${r.accepted ? html`<span class="ok">Accepted</span>` : html`<span class="bad">Rejected</span><br>${r.reject_reason}`}</td>
<td>${r.accepted ? fmtDate(r.tat_due_at) : 'Fresh sample needed'}</td><td>${r.received_by || ''}</td></tr>`)}</table></div>
${a.rejected ? html`<p class="note">A rejected sample cannot be tested. A fresh sample is needed at no extra charge, and we will arrange the recollection.</p>` : ''}
<p class="note">The expected report date counts from the time the sample reached the lab. This acknowledgement is generated by the lab system and needs no signature.</p>
</div></body></html>`.toString());
  });
};
