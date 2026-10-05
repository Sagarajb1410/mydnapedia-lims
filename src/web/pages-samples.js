// Module 1: sample registration, collection, labels, bills and the sample page.
const { html, raw, field, select, statusPill } = require('./views');
const samples = require('../samples');
const billing = require('../billing');
const barcode = require('../barcode');
const { fmtDateTime, fmtDate, rupees, toPaise, UserError, getSetting, istDate } = require('../util');

const PAY_MODES = ['Cash', 'UPI', 'Card', 'Bank transfer', ['pending', 'Payment pending']];
const GST_RATES = [['0', '0%'], ['500', '5%'], ['1200', '12%'], ['1800', '18%']];
const ROUTE_LABEL = { in_house: 'In-house', partner_lab: 'Partner lab' };

function isStaff(user) {
  return user.role === 'admin' || user.role === 'lab';
}

module.exports = function (router, { db }, h) {
  // ---------- Dashboard ----------
  router.get('/', (ctx) => {
    const u = ctx.user;
    if (u.role === 'partner') return h.redirect(ctx, '/samples');
    if (u.role === 'counsellor') {
      return h.send(ctx, 'Dashboard', html`<h1>Welcome, ${u.name}</h1><div class="card">The counselling module is built after sample tracking and report white-labelling. Your cases will appear here.</div>`);
    }
    const counts = db.all('SELECT status, COUNT(*) c FROM samples GROUP BY status');
    const today = db.get("SELECT COUNT(*) c FROM samples WHERE substr(registered_at, 1, 10) >= ?", new Date(Date.now() - 86400000).toISOString().slice(0, 10)).c;
    const pendingOutbox = db.get("SELECT COUNT(*) c FROM notifications WHERE status = 'pending'").c;
    const low = u.role === 'admin' ? db.all("SELECT * FROM accounts WHERE type = 'partner' AND active = 1").map((a) => ({ ...a, bal: billing.balance(db, a.id) })).filter((a) => a.bal < a.low_balance_paise) : [];
    const pendingRecharges = u.role === 'admin' ? db.get("SELECT COUNT(*) c FROM recharge_requests WHERE status = 'submitted'").c : 0;
    h.send(ctx, 'Dashboard', html`<h1>Dashboard</h1><p class="sub">${fmtDate(istDate())}</p>
<div class="stats">
<div class="stat"><b>${today}</b><span>Registered in the last day</span></div>
${counts.map((c) => html`<div class="stat"><b>${c.c}</b><span><a href="/samples?status=${c.status}">${samples.STATUSES[c.status]}</a></span></div>`)}
<div class="stat"><b>${pendingOutbox}</b><span><a href="/outbox">Messages waiting in the outbox</a></span></div>
${u.role === 'admin' ? html`<div class="stat"><b>${pendingRecharges}</b><span><a href="/billing">Recharge requests to review</a></span></div>` : ''}
</div>
${low.length ? html`<h2>Partners with low credit</h2><div class="table-wrap"><table><tr><th>Partner</th><th class="num">Balance</th><th class="num">Alert level</th></tr>
${low.map((a) => html`<tr><td><a href="/billing/ledger/${a.id}">${a.name}</a></td><td class="num ${a.bal < 0 ? 'neg' : ''}">${rupees(a.bal)}</td><td class="num">${rupees(a.low_balance_paise)}</td></tr>`)}</table></div>` : ''}`);
  });

  // ---------- Sample list ----------
  router.get('/samples', (ctx) => {
    const u = ctx.user;
    const sc = samples.scope(u);
    const where = [sc.sql];
    const params = [...sc.params];
    const q = (ctx.query.q || '').trim();
    if (q) {
      where.push('(s.sample_id LIKE ? OR p.full_name LIKE ? OR p.mobile LIKE ? OR s.partner_ref LIKE ?)');
      params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
    }
    if (ctx.query.status && samples.STATUSES[ctx.query.status]) { where.push('s.status = ?'); params.push(ctx.query.status); }
    if (isStaff(u) && ctx.query.account) { where.push('s.account_id = ?'); params.push(Number(ctx.query.account)); }
    const rows = db.all(
      `SELECT s.*, p.full_name, p.mobile, t.name AS test_name, a.name AS account_name, a.type AS account_type, b.net_paise, b.status AS bill_status
         FROM samples s JOIN patients p ON p.id = s.patient_id JOIN tests t ON t.id = s.test_id
         JOIN accounts a ON a.id = s.account_id LEFT JOIN bills b ON b.sample_pk = s.id
        WHERE ${where.join(' AND ')} ORDER BY s.id DESC LIMIT 200`, ...params);
    const accounts = isStaff(u) ? db.all('SELECT id, name FROM accounts ORDER BY type, name') : [];
    const used = Object.keys(samples.STATUSES).filter((k) => db.get(`SELECT 1 FROM samples s WHERE s.status = ? AND ${sc.sql} LIMIT 1`, k, ...sc.params));
    h.send(ctx, 'Samples', html`<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
<div><h1>${u.role === 'partner' ? 'Your samples' : 'Samples'}</h1><p class="sub">${rows.length} shown${rows.length === 200 ? ' (latest 200)' : ''}</p></div>
<a class="btn" href="/samples/new">Register a new sample</a></div>
<form class="filters" method="get"><input name="q" value="${q}" placeholder="Sample ID, name, mobile or reference">
<select name="status"><option value="">All statuses</option>${used.map((k) => html`<option value="${k}" ${ctx.query.status === k ? raw('selected') : ''}>${samples.STATUSES[k]}</option>`)}</select>
${isStaff(u) ? html`<select name="account"><option value="">All accounts</option>${accounts.map((a) => html`<option value="${a.id}" ${String(a.id) === ctx.query.account ? raw('selected') : ''}>${a.name}</option>`)}</select>` : ''}
<button class="light">Filter</button></form>
<div class="table-wrap"><table><tr><th>Sample ID</th><th>Patient</th><th>Test</th>${isStaff(u) ? html`<th>Registered by</th>` : ''}<th>Status</th><th>Registered</th><th class="num">Billed</th></tr>
${rows.map((r) => html`<tr><td><a class="mono" href="/samples/${r.sample_id}">${r.sample_id}</a></td><td>${r.full_name}<br><span class="muted">${r.mobile}</span></td><td>${r.test_name}</td>
${isStaff(u) ? html`<td>${r.account_name}</td>` : ''}<td>${statusPill(r.status, samples.STATUSES[r.status])}</td><td>${fmtDateTime(r.registered_at)}</td>
<td class="num">${r.net_paise == null ? '' : rupees(r.net_paise)}${r.bill_status === 'reversed' ? html`<br><span class="pill">reversed</span>` : ''}</td></tr>`)}
${rows.length ? '' : html`<tr><td colspan="7" class="muted">No samples yet.</td></tr>`}</table></div>`);
  });

  // ---------- Registration ----------
  function registrationForm(ctx, values = {}, duplicate = null) {
    const u = ctx.user;
    const account = samples.registeringAccount(db, u);
    const tests = db.all('SELECT * FROM tests WHERE active = 1 ORDER BY name');
    const priced = tests.map((t) => {
      try { return { ...t, price: billing.priceFor(db, account, t.id).pricePaise }; } catch { return { ...t, price: null }; }
    });
    const bal = account.type === 'partner' ? billing.balance(db, account.id) : null;
    const v = (k, d = '') => values[k] ?? d;
    const kind = account.type;
    h.send(ctx, 'Register a sample', html`<h1>Register a sample</h1>
<p class="sub">Registering for <b>${account.name}</b>. ${kind === 'partner' ? html`Credit balance: <b class="${bal < 0 ? 'neg' : ''}">${rupees(bal)}</b>. The test price is deducted when you save.` : ''}
${kind === 'supplier' ? 'You bill the patient under your own company name and GST number.' : ''}${kind === 'main' ? 'Direct registration at our standard price.' : ''}</p>
${duplicate ? html`<div class="flash warn">This looks like a repeat: the same mobile, date of birth and test were registered as <b>${duplicate.sample_id}</b> on ${fmtDate(duplicate.registered_at)}. To register again, give a reason below and save.</div>` : ''}
<form method="post" action="/samples/new">
<div class="card"><h2 style="margin-top:0">Test</h2><div class="grid">
${select('Test', 'test_id', priced.filter((t) => t.price != null).map((t) => [t.id, `${t.name} (${rupees(t.price)})`]), v('test_id'), { required: true })}
${field('Your reference number', 'partner_ref', v('partner_ref'), { opt: true })}
${field('Referring doctor', 'referring_doctor', v('referring_doctor'), { opt: true })}
</div></div>
<div class="card"><h2 style="margin-top:0">Patient</h2><div class="grid">
${field('Full name', 'full_name', v('full_name'), { required: true })}
${select('Gender', 'gender', samples.GENDERS, v('gender'), { required: true })}
${field('Date of birth', 'dob', v('dob'), { type: 'date', required: true, attrs: `max="${istDate()}"` })}
${field('Mobile (WhatsApp)', 'mobile', v('mobile'), { required: true, attrs: 'inputmode="numeric" placeholder="10 digits"' })}
${field('Email', 'email', v('email'), { type: 'email', opt: true })}
${field('Address', 'address', v('address'), { opt: true })}
${field('City', 'city', v('city'), { required: true })}
${select('State', 'state', samples.STATES, v('state'), { required: true })}
${field('Pincode', 'pincode', v('pincode'), { required: true, attrs: 'inputmode="numeric"' })}
</div><div style="margin-top:12px"><label for="clinical_notes">Clinical notes <span class="opt">(optional)</span></label><textarea id="clinical_notes" name="clinical_notes">${v('clinical_notes')}</textarea></div></div>
${kind === 'supplier' ? html`<div class="card"><h2 style="margin-top:0">Your bill to the patient</h2><div class="grid">
${field('Your price to the patient (₹)', 'patient_price', v('patient_price'), { required: true, attrs: 'inputmode="decimal"' })}
${field('Your discount (₹)', 'patient_discount', v('patient_discount', '0'), { attrs: 'inputmode="decimal"' })}
${select('GST rate on your bill', 'gst_rate', GST_RATES, v('gst_rate', '1800'), { required: true })}
</div><p class="muted" style="margin-bottom:0">Your discount changes only your bill to the patient. MyDNAPedia's transfer price to you stays the same.</p></div>` : ''}
${kind === 'main' ? html`<div class="card"><h2 style="margin-top:0">Payment</h2><div class="grid">
${select('Paid by', 'payment_mode', PAY_MODES, v('payment_mode'), { required: true })}
${field('Payment reference', 'payment_ref', v('payment_ref'), { opt: true })}
${u.role === 'admin' ? field('Discount (₹)', 'discount', v('discount', '0'), { attrs: 'inputmode="decimal"' }) : ''}
</div></div>` : ''}
<div class="card"><h2 style="margin-top:0">Consent</h2>
<label class="check"><input type="checkbox" name="consent_testing" value="yes" ${v('consent_testing') === 'yes' ? raw('checked') : ''} required> The patient agrees to this genetic test and to MyDNAPedia processing their sample and data for it.</label>
<label class="check"><input type="checkbox" name="consent_data_use" value="yes" ${v('consent_data_use') === 'yes' ? raw('checked') : ''}> The patient also agrees that their anonymised data may be used to improve our services. <span class="muted">(optional)</span></label>
<div class="grid" style="margin-top:8px">${select('How was consent taken?', 'consent_method', ['Signed form', 'Confirmed verbally by patient'], v('consent_method'), { required: true })}</div></div>
<div class="card"><h2 style="margin-top:0">Collection</h2>
<label class="check"><input type="checkbox" name="collected_now" value="yes" ${v('collected_now') === 'yes' ? raw('checked') : ''}> The sample is being collected and labelled now.</label>
<div class="grid">${field('Collected by', 'collector', v('collector'), { opt: true })}</div>
<p class="muted" style="margin-bottom:0">If the sample is collected later, leave this unticked and mark it collected from the sample's page.</p></div>
${duplicate ? html`<div class="card">${field('Reason for registering again', 'duplicate_reason', v('duplicate_reason'), { required: true })}</div>` : ''}
<div class="actions"><button>Save registration</button><a href="/samples">Cancel</a></div></form>`);
  }

  router.get('/samples/new', (ctx) => {
    if (!samples.canRegister(ctx.user)) throw new UserError('You cannot register samples.');
    registrationForm(ctx);
  });

  router.post('/samples/new', (ctx) => {
    const b = ctx.body;
    ctx.retry = (msg) => { ctx.flash = { type: 'error', text: msg }; registrationForm(ctx, b); };
    const input = { ...b };
    if (ctx.user.role === 'partner' && ctx.user.account_type === 'supplier') {
      input.supplier = { patientPricePaise: toPaise(b.patient_price), discountPaise: b.patient_discount ? toPaise(b.patient_discount) : 0, gstRateBp: Number(b.gst_rate) || 0 };
    }
    if (ctx.user.role !== 'partner') {
      input.direct = { paymentMode: b.payment_mode, paymentRef: b.payment_ref, discountPaise: b.discount ? toPaise(b.discount) : 0 };
    }
    const out = samples.register(db, ctx.user, input);
    if (out.duplicate) {
      ctx.flash = null;
      return registrationForm(ctx, b, out.duplicate);
    }
    h.redirect(ctx, `/samples/${out.sample.sample_id}`, { type: 'ok', text: `Registered. Sample ID ${out.sample.sample_id}. Print the label and stick it on the tube.` });
  });

  // ---------- Sample page ----------
  function loadFull(ctx) {
    const s = samples.load(db, ctx.user, ctx.params.id);
    const p = db.get('SELECT * FROM patients WHERE id = ?', s.patient_id);
    const t = db.get('SELECT * FROM tests WHERE id = ?', s.test_id);
    const a = db.get('SELECT * FROM accounts WHERE id = ?', s.account_id);
    const bill = db.get('SELECT * FROM bills WHERE sample_pk = ?', s.id);
    const sbill = db.get('SELECT * FROM supplier_bills WHERE sample_pk = ?', s.id);
    return { s, p, t, a, bill, sbill };
  }

  router.get('/samples/:id', (ctx) => {
    const u = ctx.user;
    const { s, p, t, a, bill, sbill } = loadFull(ctx);
    const events = db.all('SELECT e.*, u.name AS user_name FROM sample_events e LEFT JOIN users u ON u.id = e.user_id WHERE sample_pk = ? ORDER BY e.id', s.id);
    const regBy = db.get('SELECT name FROM users WHERE id = ?', s.registered_by);
    const early = samples.BEFORE_LAB.includes(s.status);
    const canCancel = s.status !== 'CANCELLED' && (early ? u.role !== 'counsellor' : u.role === 'admin');
    h.send(ctx, s.sample_id, html`<p class="noprint"><a href="/samples">← Samples</a></p>
<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap">
<div><h1 class="mono">${s.sample_id}</h1><p class="sub">${t.name} · ${statusPill(s.status, samples.STATUSES[s.status])}</p></div>
<div class="actions" style="margin:0"><a class="btn" href="/samples/${s.sample_id}/label" target="_blank">Print label</a><a class="btn light" href="/samples/${s.sample_id}/bill" target="_blank">Print bill</a>
${samples.canEditPatient(u, s) && s.status !== 'CANCELLED' ? html`<a class="btn light" href="/samples/${s.sample_id}/edit">Edit patient</a>` : ''}</div></div>
<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(320px,1fr));align-items:start">
<div class="card"><h2 style="margin-top:0">Patient</h2><dl class="facts">
<dt>Name</dt><dd>${p.full_name}</dd><dt>Gender</dt><dd>${p.gender}</dd><dt>Date of birth</dt><dd>${fmtDate(p.dob)}</dd>
<dt>Mobile</dt><dd>${p.mobile}</dd><dt>Email</dt><dd>${p.email || '—'}</dd><dt>Address</dt><dd>${[p.address, p.city, p.state, p.pincode].filter(Boolean).join(', ')}</dd>
<dt>Consent</dt><dd>Test: yes · Data use: ${s.consent_data_use ? 'yes' : 'no'} · ${s.consent_method}</dd>
${s.clinical_notes ? html`<dt>Clinical notes</dt><dd>${s.clinical_notes}</dd>` : ''}</dl></div>
<div class="card"><h2 style="margin-top:0">Sample</h2><dl class="facts">
<dt>Test</dt><dd>${t.name}</dd><dt>Sample type</dt><dd>${t.sample_type}</dd>
${isStaff(u) ? html`<dt>Processing</dt><dd>${ROUTE_LABEL[t.route]} · TAT ${t.tat_days} days from lab receipt</dd>` : ''}
<dt>Registered by</dt><dd>${a.name} · ${regBy ? regBy.name : ''}</dd><dt>Registered</dt><dd>${fmtDateTime(s.registered_at)}</dd>
<dt>Collected</dt><dd>${s.collected_at ? html`${fmtDateTime(s.collected_at)} by ${s.collector}` : 'Not yet'}</dd>
${s.partner_ref ? html`<dt>Reference</dt><dd>${s.partner_ref}</dd>` : ''}${s.referring_doctor ? html`<dt>Doctor</dt><dd>${s.referring_doctor}</dd>` : ''}
${s.duplicate_reason ? html`<dt>Repeat reason</dt><dd>${s.duplicate_reason}</dd>` : ''}${s.cancel_reason ? html`<dt>Cancelled</dt><dd>${s.cancel_reason}</dd>` : ''}</dl>
${s.status === 'REGISTERED' && u.role !== 'counsellor' ? html`<form method="post" action="/samples/${s.sample_id}/collect" class="noprint" style="margin-top:14px;border-top:1px solid var(--line);padding-top:12px">
<b>Mark as collected</b><div class="grid" style="margin-top:8px">${field('Collected by', 'collector', '', { required: true })}${field('Date and time', 'collected_at', '', { type: 'datetime-local', required: true })}</div>
<div class="actions"><button>Mark collected</button></div></form>` : ''}</div>
<div class="card"><h2 style="margin-top:0">Billing</h2>${bill ? html`<dl class="facts">
<dt>Bill number</dt><dd class="mono">${bill.bill_no}</dd>
<dt>${billing.PRICE_LIST_LABEL[bill.price_list]}</dt><dd>${rupees(bill.list_price_paise)}</dd>
${bill.discount_paise ? html`<dt>Discount</dt><dd>${rupees(bill.discount_paise)}</dd>` : ''}
<dt>${bill.payer === 'credit' ? 'Deducted from credit' : bill.payer === 'supplier' ? 'Charged to supplier' : 'Patient pays'}</dt><dd><b>${rupees(bill.net_paise)}</b> · ${bill.status}</dd>
${bill.payment_mode ? html`<dt>Paid by</dt><dd>${bill.payment_mode}${bill.payment_ref ? ` (${bill.payment_ref})` : ''}</dd>` : ''}
${sbill ? html`<dt>Patient bill</dt><dd>${sbill.bill_no}: ${rupees(sbill.patient_price_paise)} − ${rupees(sbill.discount_paise)} + GST ${rupees(sbill.gst_paise)} = <b>${rupees(sbill.total_paise)}</b></dd>` : ''}
</dl>` : html`<p class="muted">No bill.</p>`}</div>
<div class="card"><h2 style="margin-top:0">Timeline</h2><ul class="timeline">${events.map((e) => html`<li><b>${samples.STATUSES[e.to_status]}</b><br><span class="muted">${fmtDateTime(e.at)}${e.user_name ? ` · ${e.user_name}` : ''}</span>${e.note ? html`<br>${e.note}` : ''}</li>`)}</ul></div>
</div>
${canCancel ? html`<details class="card noprint"><summary><b>Cancel this sample</b></summary>
<form method="post" action="/samples/${s.sample_id}/cancel" style="margin-top:10px"><p class="muted">${early ? (bill && bill.payer === 'credit' ? `The full ${rupees(bill.net_paise)} goes back to the partner's credit.` : 'The bill is reversed.') : 'The lab has already received this sample. Choose how much to give back.'}</p>
<div class="grid">${field('Reason', 'reason', '', { required: true })}${early ? '' : field('Amount to give back (₹)', 'refund', bill ? (bill.net_paise / 100).toFixed(2) : '0')}</div>
<div class="actions"><button class="danger">Cancel sample</button></div></form></details>` : ''}`);
  });

  router.post('/samples/:id/collect', (ctx) => {
    samples.collect(db, ctx.user, ctx.params.id, { collector: ctx.body.collector, collectedAt: ctx.body.collected_at });
    h.redirect(ctx, `/samples/${ctx.params.id}`, { type: 'ok', text: 'Marked as collected.' });
  });

  router.post('/samples/:id/cancel', (ctx) => {
    samples.cancel(db, ctx.user, ctx.params.id, { reason: ctx.body.reason, refundPaise: ctx.body.refund ? toPaise(ctx.body.refund) : undefined });
    h.redirect(ctx, `/samples/${ctx.params.id}`, { type: 'ok', text: 'The sample has been cancelled.' });
  });

  function editForm(ctx, values) {
    const v = (k) => values[k] ?? '';
    h.send(ctx, 'Edit patient', html`<p><a href="/samples/${ctx.params.id}">← ${ctx.params.id}</a></p><h1>Edit patient details</h1>
<p class="sub">Every change is recorded in the audit trail with the old value.</p>
<form method="post" class="card"><div class="grid">
${field('Full name', 'full_name', v('full_name'), { required: true })}${select('Gender', 'gender', samples.GENDERS, v('gender'), { required: true })}
${field('Date of birth', 'dob', v('dob'), { type: 'date', required: true })}${field('Mobile (WhatsApp)', 'mobile', v('mobile'), { required: true })}
${field('Email', 'email', v('email'), { type: 'email', opt: true })}${field('Address', 'address', v('address'), { opt: true })}
${field('City', 'city', v('city'), { required: true })}${select('State', 'state', samples.STATES, v('state'), { required: true })}
${field('Pincode', 'pincode', v('pincode'), { required: true })}</div><div class="actions"><button>Save changes</button></div></form>`);
  }
  router.get('/samples/:id/edit', (ctx) => {
    const { s, p } = loadFull(ctx);
    if (!samples.canEditPatient(ctx.user, s)) throw new UserError('Patient details can no longer be changed from your account. Contact the lab.');
    editForm(ctx, p);
  });
  router.post('/samples/:id/edit', (ctx) => {
    ctx.retry = (msg) => { ctx.flash = { type: 'error', text: msg }; editForm(ctx, ctx.body); };
    const changed = samples.editPatient(db, ctx.user, ctx.params.id, ctx.body);
    h.redirect(ctx, `/samples/${ctx.params.id}`, { type: 'ok', text: Object.keys(changed).length ? 'Patient details updated.' : 'Nothing was changed.' });
  });

  // ---------- Label ----------
  // 50 x 25 mm label; prints on a label printer or on plain paper.
  router.get('/samples/:id/label', (ctx) => {
    const { s, p, t } = loadFull(ctx);
    const initials = p.full_name.split(/\s+/).map((w) => w[0]).join('').toUpperCase().slice(0, 4);
    const copies = Math.min(Math.max(Number(ctx.query.copies) || 2, 1), 6);
    const label = html`<div class="label"><div class="bc">${raw(barcode.svg(s.sample_id, { height: 46 }))}</div>
<div class="id">${s.sample_id}</div><div class="meta"><span>${t.short_name}</span><span>${initials} · ${fmtDate(s.registered_at)}</span></div></div>`;
    h.raw(ctx, 'text/html; charset=utf-8', html`<!doctype html><html><head><meta charset="utf-8"><title>Label ${s.sample_id}</title><style>
@page{size:50mm 25mm;margin:0}body{margin:0;font-family:Arial,sans-serif}
.label{width:50mm;height:25mm;padding:1.5mm 2mm;box-sizing:border-box;page-break-after:always;overflow:hidden}
.bc svg{width:46mm;height:12mm;display:block}.id{font:bold 9pt monospace;text-align:center;margin-top:.5mm}
.meta{display:flex;justify-content:space-between;font-size:6.5pt;margin-top:.3mm}
.bar{font:14px system-ui;padding:10px;background:#f5f8f9;border-bottom:1px solid #ddd}@media print{.bar{display:none}}
</style></head><body><div class="bar">Label size 50 × 25 mm. <a href="?copies=${copies + 1}">More copies</a> · <button onclick="print()">Print</button></div>
${Array.from({ length: copies }, () => label)}<script>setTimeout(()=>print(),300)</script></body></html>`.toString());
  });

  // ---------- Bill ----------
  router.get('/samples/:id/bill', (ctx) => {
    const { s, p, t, a, bill, sbill } = loadFull(ctx);
    if (!bill) throw new UserError('This sample has no bill.');
    let head;
    let lines;
    if (sbill) {
      // Supplier bills carry the supplier's name and GSTIN, never MyDNAPedia as seller.
      head = html`<h1>${a.legal_name || a.name}</h1><p>${a.address || ''}<br>GSTIN: ${a.gstin || ''}</p><h2>Bill ${sbill.bill_no}</h2>`;
      lines = html`<tr><td>${t.name}</td><td class="num">${rupees(sbill.patient_price_paise)}</td></tr>
${sbill.discount_paise ? html`<tr><td>Discount</td><td class="num">−${rupees(sbill.discount_paise)}</td></tr>` : ''}
<tr><td>Taxable value</td><td class="num">${rupees(sbill.net_paise)}</td></tr><tr><td>GST @ ${sbill.gst_rate_bp / 100}%</td><td class="num">${rupees(sbill.gst_paise)}</td></tr>
<tr><th>Total</th><th class="num">${rupees(sbill.total_paise)}</th></tr>`;
    } else {
      head = html`<h1>${getSetting(db, 'labName')}</h1><p>${getSetting(db, 'unitLine')}${getSetting(db, 'companyGstin') ? html`<br>GSTIN: ${getSetting(db, 'companyGstin')}` : ''}</p>
<h2>${bill.payer === 'credit' ? 'Credit memo' : 'Bill'} ${bill.bill_no}</h2>`;
      lines = html`<tr><td>${t.name}</td><td class="num">${rupees(bill.list_price_paise)}</td></tr>
${bill.discount_paise ? html`<tr><td>Discount</td><td class="num">−${rupees(bill.discount_paise)}</td></tr>` : ''}
<tr><th>${bill.payer === 'credit' ? `Deducted from ${a.name} credit` : 'Total'}</th><th class="num">${rupees(bill.net_paise)}</th></tr>`;
    }
    h.raw(ctx, 'text/html; charset=utf-8', html`<!doctype html><html><head><meta charset="utf-8"><title>Bill ${s.sample_id}</title><style>
body{font:14px/1.5 Arial,sans-serif;max-width:720px;margin:24px auto;padding:0 16px}h1{margin:0;font-size:22px}h2{font-size:16px;margin:16px 0 4px}
table{width:100%;border-collapse:collapse;margin-top:12px}td,th{padding:6px 8px;border-bottom:1px solid #ddd;text-align:left}.num{text-align:right}
.note{color:#666;font-size:12px;margin-top:24px}@media print{button{display:none}}</style></head><body>
<button onclick="print()" style="float:right">Print</button>${head}
<p>Date: ${fmtDate(bill.created_at)}<br>Patient: ${p.full_name} · ${p.gender} · Mobile ${p.mobile}<br>Sample ID: ${s.sample_id}
${bill.status === 'reversed' ? html`<br><b>Cancelled and reversed</b>` : ''}${bill.status === 'refunded' ? html`<br><b>Cancelled and refunded</b>` : ''}</p>
<table>${lines}</table>${bill.payment_mode ? html`<p>Paid by ${bill.payment_mode}${bill.payment_ref ? ` (ref ${bill.payment_ref})` : ''}</p>` : ''}
<p class="note">Test version bill with dummy data. GST invoice format to be confirmed with the accountant before real use.</p></body></html>`.toString());
  });
};
