// Monthly report: samples processed in a month, per franchise and account,
// on screen and as an Excel download.
const { html, icon } = require('./views');
const admin = require('../admin');
const monthly = require('../monthly');
const { istDate, getSetting, audit } = require('../util');

module.exports = function (router, { db }, h) {
  const pick = (ctx) => (monthly.validMonth(ctx.query.month) ? ctx.query.month : istDate().slice(0, 7));

  router.get('/monthly', (ctx) => {
    admin.requireAdmin(ctx.user);
    const month = pick(ctx);
    const r = monthly.report(db, month);
    const prev = monthly.addMonths(month, -1);
    const next = monthly.addMonths(month, 1);
    const thisMonth = istDate().slice(0, 7);
    const kpi = (ic, label, value, note) => html`<div class="kpi"><span class="k">${icon(ic)}${label}</span><b>${value}</b><small>${note}</small></div>`;
    const top = r.accounts.filter((a) => a.processed).sort((a, b) => b.processed - a.processed);
    h.send(ctx, 'Monthly report', html`<div class="head"><div><h1>Monthly report</h1><p class="sub">${r.label}. Processed means accepted at the central lab that month.</p></div>
<div class="actions" style="margin:0"><a class="btn" href="/monthly/export?month=${month}">${icon('billing')}Download Excel</a></div></div>
<form method="get" class="card" style="display:flex;gap:10px;align-items:end;flex-wrap:wrap;margin-bottom:18px">
<a class="btn light small" href="?month=${prev}">${icon('back')}${monthly.monthLabel(prev)}</a>
<label style="margin:0">Month<input type="month" name="month" value="${month}" max="${thisMonth}"></label><button class="small">Show</button>
${next <= thisMonth ? html`<a class="btn light small" href="?month=${next}">${monthly.monthLabel(next)}${icon('arrow')}</a>` : ''}</form>
<div class="kpis">
${kpi('samples', 'Processed', r.totals.processed, `${top.length} account${top.length === 1 ? '' : 's'} sent samples`)}
${kpi('register', 'Registered', r.totals.registered, 'New registrations this month')}
${kpi('alert', 'Rejected at lab', r.totals.rejected, 'Not counted as processed')}
${kpi('reports', 'Reports released', r.totals.released, 'Released this month')}
</div>
<h2>By franchise and account</h2>
<div class="table-wrap"><table><tr><th>Franchise / account</th><th class="num">Registered</th><th class="num">Processed</th><th class="num">Rejected</th><th class="num">Released</th></tr>
${r.accounts.map((a) => html`<tr><td><b>${a.name}</b><br><span class="muted">${monthly.TYPE_LABEL[a.type]}${a.city ? ` · ${a.city}` : ''}</span></td>
<td class="num">${a.registered}</td><td class="num"><b>${a.processed}</b></td><td class="num">${a.rejected}</td><td class="num">${a.released}</td></tr>`)}
<tr><td><b>Total</b></td><td class="num"><b>${r.totals.registered}</b></td><td class="num"><b>${r.totals.processed}</b></td><td class="num"><b>${r.totals.rejected}</b></td><td class="num"><b>${r.totals.released}</b></td></tr></table></div>
<p class="muted">The Excel file has four sheets: this summary, processed samples by test, month by month for the financial year, and the list of processed samples (sample IDs only, no patient names).</p>`);
  });

  router.get('/monthly/export', (ctx) => {
    admin.requireAdmin(ctx.user);
    const month = pick(ctx);
    const file = monthly.toXlsx(monthly.report(db, month), getSetting(db, 'labName'));
    audit(db, ctx.user.id, 'monthly_report_exported', 'report', month, null);
    h.raw(ctx, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', file,
      { 'Content-Disposition': `attachment; filename="MyDNAPedia-samples-${month}.xlsx"` });
  });
};
