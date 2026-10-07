// Module 1: sample registration, collection, labels, bills and the sample page.
const { html, raw, field, select, statusPill, icon, initials, STATUS_TONE } = require('./views');
const journey = require('./journey');
const samples = require('../samples');
const billing = require('../billing');
const barcode = require('../barcode');
const tracking = require('../tracking');
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
    if (u.role === 'counsellor') return h.redirect(ctx, '/counselling');
    const counts = Object.fromEntries(db.all('SELECT status, COUNT(*) c FROM samples GROUP BY status').map((r) => [r.status, r.c]));
    const n = (st) => st.reduce((t, k) => t + (counts[k] || 0), 0);
    const active = n(Object.keys(samples.STATUSES).filter((k) => !['DELIVERED', 'CLOSED', 'CANCELLED'].includes(k)));
    const lastDay = db.get('SELECT COUNT(*) c FROM samples WHERE registered_at >= ?', new Date(Date.now() - 86400000).toISOString()).c;
    const pendingOutbox = db.get("SELECT COUNT(*) c FROM notifications WHERE status = 'pending'").c;
    const board = tracking.tatBoard(db);
    const red = board.filter((r) => !r.tat.paused && r.tat.level === 'red');
    const amber = board.filter((r) => !r.tat.paused && r.tat.level === 'amber');
    const watch = [...red, ...amber, ...board.filter((r) => !r.tat.paused && r.tat.level === 'green')].slice(0, 6);
    const toApprove = db.get("SELECT COUNT(*) c FROM reports WHERE status = 'pending'").c + db.get("SELECT COUNT(*) c FROM action_plans WHERE status = 'pending'").c;
    const low = u.role === 'admin' ? db.all("SELECT * FROM accounts WHERE type = 'partner' AND active = 1").map((a) => ({ ...a, bal: billing.balance(db, a.id) })).filter((a) => a.bal < a.low_balance_paise) : [];
    const pendingRecharges = u.role === 'admin' ? db.get("SELECT COUNT(*) c FROM recharge_requests WHERE status = 'submitted'").c : 0;
    const total = Math.max(1, journey.PHASES.reduce((t, p) => t + n(p.statuses), 0));
    const hour = Number(new Intl.DateTimeFormat('en-IN', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Asia/Kolkata' }).format(new Date()));
    const hello = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
    const exceptions = journey.EXCEPTIONS.filter((k) => counts[k]);
    const kpi = (href, ic, label, value, note, cls = '') => html`<a class="kpi ${cls}" href="${href}"><span class="k">${icon(ic)}${label}</span><b>${value}</b><small>${note}</small></a>`;
    h.send(ctx, 'Dashboard', html`<div class="head"><div><h1>${hello}, ${u.name.split(' ')[0]}</h1><p class="sub">${fmtDate(istDate())} · Here is where every sample stands.</p></div>
<div class="actions" style="margin:0"><a class="btn" href="/samples/new">${icon('plus')}Register a sample</a></div></div>
<div class="kpis">
${kpi('/samples', 'samples', 'Active samples', active, `${lastDay} registered in the last 24 hours`)}
${kpi('/tracking', 'clock', 'Overdue', red.length, red.length ? 'Past their turnaround time' : 'Nothing is late', red.length ? 'alert' : '')}
${kpi('/tracking', 'alert', 'At risk', amber.length, 'Used 75% of their turnaround', amber.length ? 'attn' : '')}
${kpi('/reports', 'reports', u.role === 'admin' ? 'To approve' : 'Waiting for approval', toApprove, 'Reports and action plans')}
${kpi('/outbox', 'outbox', 'Outbox', pendingOutbox, 'Messages waiting to be sent')}
</div>
<h2 style="margin-top:0">Sample journey</h2>
<div class="flow">${journey.PHASES.map((p) => {
    const c = n(p.statuses);
    return html`<div class="phase"><div class="t"><i style="background:${p.color}"></i>${p.label}</div><div class="n">${c}</div>
<ul>${p.statuses.map((k) => html`<li class="${counts[k] ? '' : 'z'}"><a href="/samples?status=${k}" title="${samples.STATUSES[k]}">${journey.SHORT[k] || samples.STATUSES[k]}</a><span>${counts[k] || 0}</span></li>`)}</ul>
<div class="bar"><i style="width:${Math.round((c / total) * 100)}%;background:${p.color}"></i></div></div>`;
  })}</div>
${exceptions.length ? html`<div class="chips" style="margin-top:14px">${exceptions.map((k) => html`<a class="chip ${STATUS_TONE[k]}" href="/samples?status=${k}"><i></i>${samples.STATUSES[k]}<span>${counts[k]}</span></a>`)}</div>` : ''}
<div class="cols">
<div class="card"><div class="head" style="margin-bottom:6px"><h2 style="margin:0">Turnaround watch</h2><a href="/tracking" style="font-size:13px;font-weight:600">Open the TAT board</a></div>
${watch.length ? html`<ul class="list">${watch.map((r) => {
    const pct = Math.min(100, Math.round(r.tat.used * 100));
    const col = { red: 'var(--bad)', amber: 'var(--honey2)', green: 'var(--good)' }[r.tat.level];
    return html`<li><div class="grow"><b><a class="mono" href="/samples/${r.sample_id}">${r.sample_id}</a> · ${r.full_name}</b><span>${r.test_name} · ${samples.STATUSES[r.status]} · due ${fmtDate(r.tat_due_at)}</span></div>
<div class="meter" title="${pct}% of the turnaround used"><i style="width:${pct}%;background:${col}"></i></div>
<span class="pill ${{ red: 'bad', amber: 'warn', green: 'good' }[r.tat.level]}">${r.tat.level === 'red' ? `${Math.abs(r.tat.daysLeft).toFixed(1)} d late` : `${r.tat.daysLeft.toFixed(1)} d left`}</span></li>`;
  })}</ul>` : html`<div class="empty">${icon('check')}No samples are in the lab right now.</div>`}</div>
<div>
${u.role === 'admin' ? html`<div class="card"><div class="head" style="margin-bottom:6px"><h2 style="margin:0">Partner credit</h2><a href="/billing" style="font-size:13px;font-weight:600">Billing</a></div>
${low.length ? html`<ul class="list">${low.map((a) => html`<li><div class="grow"><b><a href="/billing/ledger/${a.id}">${a.name}</a></b><span>Reminder level ${rupees(a.low_balance_paise)}</span></div><b class="num ${a.bal < 0 ? 'neg' : ''}">${rupees(a.bal)}</b></li>`)}</ul>` : html`<div class="empty">${icon('check')}Every partner has enough credit.</div>`}
${pendingRecharges ? html`<div class="flash warn" style="margin:12px 0 0">${icon('info')}<div><a href="/billing">${pendingRecharges} recharge request${pendingRecharges === 1 ? '' : 's'}</a> waiting for your review.</div></div>` : ''}</div>` : ''}
<div class="card"><h2>Quick actions</h2><div class="actions" style="margin:0;display:grid;grid-template-columns:1fr 1fr;gap:10px">
<a class="btn light" href="/tracking/pickups">${icon('tracking')}Pickups</a><a class="btn light" href="/tracking/receive">${icon('samples')}Lab receipt</a>
<a class="btn light" href="/tracking/onward">${icon('arrow')}Partner dispatch</a><a class="btn light" href="/reports">${icon('reports')}Reports</a></div></div>
</div></div>`);
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
    const base = [...where];
    const baseParams = [...params];
    const phase = journey.PHASES.find((p) => p.key === ctx.query.phase);
    const status = samples.STATUSES[ctx.query.status] ? ctx.query.status : '';
    if (status) { where.push('s.status = ?'); params.push(status); } else if (phase) { where.push(`s.status IN (${phase.statuses.map(() => '?').join(',')})`); params.push(...phase.statuses); }
    if (isStaff(u) && ctx.query.account) { where.push('s.account_id = ?'); params.push(Number(ctx.query.account)); }
    const rows = db.all(
      `SELECT s.*, p.full_name, p.mobile, p.gender, p.dob, p.city, t.name AS test_name, a.name AS account_name, a.type AS account_type, b.net_paise, b.status AS bill_status
         FROM samples s JOIN patients p ON p.id = s.patient_id JOIN tests t ON t.id = s.test_id
         JOIN accounts a ON a.id = s.account_id LEFT JOIN bills b ON b.sample_pk = s.id
        WHERE ${where.join(' AND ')} ORDER BY s.id DESC LIMIT 200`, ...params);
    // A scanned barcode or an exact sample ID opens the sample straight away.
    if (q && rows.length === 1 && rows[0].sample_id.toUpperCase() === q.toUpperCase()) return h.redirect(ctx, `/samples/${rows[0].sample_id}`);
    // Counts for the chips follow the search box but not the chip itself.
    const byStatus = Object.fromEntries(db.all(`SELECT s.status, COUNT(*) c FROM samples s JOIN patients p ON p.id = s.patient_id WHERE ${base.join(' AND ')} GROUP BY s.status`, ...baseParams).map((r) => [r.status, r.c]));
    const cnt = (st) => st.reduce((t, k) => t + (byStatus[k] || 0), 0);
    const all = cnt(Object.keys(byStatus));
    const accounts = isStaff(u) ? db.all('SELECT id, name FROM accounts ORDER BY type, name') : [];
    const link = (extra) => {
      const qs = new URLSearchParams({ ...(q ? { q } : {}), ...(ctx.query.account ? { account: ctx.query.account } : {}), ...extra });
      return `/samples${qs.toString() ? `?${qs}` : ''}`;
    };
    const age = (dob) => {
      if (!dob) return '';
      const d = new Date(dob); const now = new Date();
      let y = now.getFullYear() - d.getFullYear();
      if (now < new Date(now.getFullYear(), d.getMonth(), d.getDate())) y--;
      return `${y} y`;
    };
    const title = u.role === 'partner' ? 'Your samples' : u.role === 'counsellor' ? 'Clients' : 'Samples';
    h.send(ctx, title, html`<div class="head"><div><h1>${title}</h1><p class="sub">${q ? html`Results for “${q}” · ` : ''}${rows.length} shown${rows.length === 200 ? ' (latest 200)' : ''}</p></div>
${samples.canRegister(u) ? html`<a class="btn" href="/samples/new">${icon('plus')}Register a sample</a>` : ''}</div>
<div class="chips"><a class="chip ${!phase && !status ? 'on' : ''}" href="${link({})}">All<span>${all}</span></a>
${journey.PHASES.filter((p) => cnt(p.statuses) || phase === p).map((p) => html`<a class="chip ${phase === p && !status ? 'on' : ''}" href="${link({ phase: p.key })}">${p.label}<span>${cnt(p.statuses)}</span></a>`)}
${journey.EXCEPTIONS.filter((k) => byStatus[k] || status === k).map((k) => html`<a class="chip ${status === k ? 'on' : ''}" href="${link({ status: k })}">${samples.STATUSES[k]}<span>${byStatus[k] || 0}</span></a>`)}
${status && !journey.EXCEPTIONS.includes(status) ? html`<a class="chip on" href="${link({ status })}">${samples.STATUSES[status]}<span>${byStatus[status] || 0}</span></a>` : ''}</div>
<form class="filters" method="get">${phase && !status ? html`<input type="hidden" name="phase" value="${phase.key}">` : ''}${status ? html`<input type="hidden" name="status" value="${status}">` : ''}
<input name="q" value="${q}" placeholder="Sample ID, name, mobile or reference" aria-label="Search">
${isStaff(u) ? html`<select name="account" aria-label="Registered by"><option value="">All accounts</option>${accounts.map((a) => html`<option value="${a.id}" ${String(a.id) === ctx.query.account ? raw('selected') : ''}>${a.name}</option>`)}</select>` : ''}
<button class="light">Apply</button>${q || ctx.query.account ? html`<a class="btn light" href="${link({}).replace(/\?.*/, '')}">Clear</a>` : ''}</form>
<div class="table-wrap"><table class="stack"><thead><tr><th>Sample ID</th><th>${u.role === 'counsellor' ? 'Client' : 'Patient'}</th><th>Test</th>${isStaff(u) ? html`<th>Registered by</th>` : ''}<th>Status</th><th>Registered</th>${u.role === 'counsellor' ? '' : html`<th class="num">Billed</th>`}</tr></thead><tbody>
${rows.map((r) => html`<tr data-href="/samples/${r.sample_id}"><td><a class="mono" href="/samples/${r.sample_id}">${r.sample_id}</a></td>
<td><b>${r.full_name}</b><br><span class="muted">${[r.gender, age(r.dob), r.city].filter(Boolean).join(' · ')}</span></td><td>${r.test_name}</td>
${isStaff(u) ? html`<td>${r.account_name}${r.partner_ref ? html`<br><span class="muted">Ref ${r.partner_ref}</span>` : ''}</td>` : ''}<td>${statusPill(r.status, samples.STATUSES[r.status])}</td><td class="nw">${fmtDate(r.registered_at)}<br><span class="muted">${r.mobile}</span></td>
${u.role === 'counsellor' ? '' : html`<td class="num">${r.net_paise == null ? '' : rupees(r.net_paise)}${r.bill_status === 'reversed' ? html`<br><span class="pill">reversed</span>` : ''}</td>`}</tr>`)}
${rows.length ? '' : html`<tr><td colspan="7"><div class="empty">${icon('search')}No samples match.${samples.canRegister(u) && !q ? html` <a href="/samples/new">Register the first one</a>.` : ''}</div></td></tr>`}</tbody></table></div>`);
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
    const canCancel = !['CANCELLED', 'CLOSED', 'DELIVERED'].includes(s.status) && (early ? u.role !== 'counsellor' : u.role === 'admin');
    const patientCard = html`<div class="card"><h2>${u.role === 'counsellor' ? 'Client' : 'Patient'}</h2><dl class="facts">
<dt>Name</dt><dd>${p.full_name}</dd><dt>Gender</dt><dd>${p.gender}</dd><dt>Date of birth</dt><dd>${fmtDate(p.dob)}</dd>
<dt>Mobile</dt><dd>${p.mobile}</dd><dt>Email</dt><dd>${p.email || '—'}</dd><dt>Address</dt><dd>${[p.address, p.city, p.state, p.pincode].filter(Boolean).join(', ')}</dd>
<dt>Consent</dt><dd>Test: yes · Data use: ${s.consent_data_use ? 'yes' : 'no'} · ${s.consent_method}</dd>
${s.clinical_notes ? html`<dt>Clinical notes</dt><dd>${s.clinical_notes}</dd>` : ''}</dl></div>`;
    const sampleCard = html`<div class="card"><h2>Sample</h2><dl class="facts">
<dt>Test</dt><dd>${t.name}</dd><dt>Sample type</dt><dd>${t.sample_type}</dd>
${isStaff(u) ? html`<dt>Processing</dt><dd>${ROUTE_LABEL[t.route]} · TAT ${t.tat_days} days from lab receipt</dd>` : ''}
<dt>Registered by</dt><dd>${a.name} · ${regBy ? regBy.name : ''}</dd><dt>Registered</dt><dd>${fmtDateTime(s.registered_at)}</dd>
<dt>Collected</dt><dd>${s.collected_at ? html`${fmtDateTime(s.collected_at)} by ${s.collector}` : 'Not yet'}</dd>
${s.partner_ref ? html`<dt>Reference</dt><dd>${s.partner_ref}</dd>` : ''}${s.referring_doctor ? html`<dt>Doctor</dt><dd>${s.referring_doctor}</dd>` : ''}
${s.duplicate_reason ? html`<dt>Repeat reason</dt><dd>${s.duplicate_reason}</dd>` : ''}${s.cancel_reason ? html`<dt>Cancelled</dt><dd>${s.cancel_reason}</dd>` : ''}</dl>
${s.status === 'REGISTERED' && u.role !== 'counsellor' ? html`<form method="post" action="/samples/${s.sample_id}/collect" class="noprint" style="margin-top:16px;border-top:1px solid var(--line);padding-top:14px">
<b>Mark as collected</b><div class="grid" style="margin-top:10px">${field('Collected by', 'collector', '', { required: true })}${field('Date and time', 'collected_at', '', { type: 'datetime-local', required: true })}</div>
<div class="actions"><button>Mark collected</button></div></form>` : ''}</div>`;
    const billingCard = u.role === 'counsellor' ? '' : html`<div class="card"><h2>Billing</h2>${bill ? html`<dl class="facts">
<dt>Bill number</dt><dd class="mono">${bill.bill_no}</dd>
<dt>${billing.PRICE_LIST_LABEL[bill.price_list]}</dt><dd>${rupees(bill.list_price_paise)}</dd>
${bill.discount_paise ? html`<dt>Discount</dt><dd>${rupees(bill.discount_paise)}</dd>` : ''}
<dt>${bill.payer === 'credit' ? 'Deducted from credit' : bill.payer === 'supplier' ? 'Charged to supplier' : 'Patient pays'}</dt><dd><b>${rupees(bill.net_paise)}</b> · ${bill.status}</dd>
${bill.payment_mode ? html`<dt>Paid by</dt><dd>${bill.payment_mode}${bill.payment_ref ? ` (${bill.payment_ref})` : ''}</dd>` : ''}
${sbill ? html`<dt>Patient bill</dt><dd>${sbill.bill_no}: ${rupees(sbill.patient_price_paise)} − ${rupees(sbill.discount_paise)} + GST ${rupees(sbill.gst_paise)} = <b>${rupees(sbill.total_paise)}</b></dd>` : ''}
</dl>` : html`<p class="muted">No bill.</p>`}</div>`;
    const timelineCard = html`<div class="card"><h2>Timeline</h2><ul class="timeline">${events.map((e) => html`<li><b>${samples.STATUSES[e.to_status]}</b><br><span class="muted">${fmtDateTime(e.at)}${e.user_name ? ` · ${e.user_name}` : ''}</span>${e.note ? html`<br>${e.note}` : ''}</li>`)}</ul></div>`;
    const cancelCard = canCancel ? html`<details class="card noprint"><summary><b>Cancel this sample</b></summary>
<form method="post" action="/samples/${s.sample_id}/cancel" style="margin-top:12px"><p class="muted">${early ? (bill && bill.payer === 'credit' ? `The full ${rupees(bill.net_paise)} goes back to the partner's credit.` : 'The bill is reversed.') : 'The lab has already received this sample. Choose how much to give back.'}</p>
<div class="grid">${field('Reason', 'reason', '', { required: true })}${early ? '' : field('Amount to give back (₹)', 'refund', bill ? (bill.net_paise / 100).toFixed(2) : '0')}</div>
<div class="actions"><button class="danger">Cancel sample</button></div></form></details>` : '';
    const steps = journey.steps(s, t.route);
    h.send(ctx, s.sample_id, html`<a class="crumb noprint" href="/samples">${icon('back')}${u.role === 'counsellor' ? 'Clients' : 'Samples'}</a>
<div class="hero"><div class="who2"><div class="avatar">${initials(p.full_name)}</div><div style="min-width:0"><h1>${p.full_name}</h1>
<div class="meta"><b class="mono" style="color:var(--ink)">${s.sample_id}</b><span>${t.name}</span>${statusPill(s.status, samples.STATUSES[s.status])}${isStaff(u) ? html`<span>${a.name}</span>` : ''}</div></div></div>
<div class="actions noprint" style="margin:0"><a class="btn light" href="/samples/${s.sample_id}/label" target="_blank">${icon('print')}Label</a>${u.role === 'counsellor' ? '' : html`<a class="btn light" href="/samples/${s.sample_id}/bill" target="_blank">${icon('print')}Bill</a>`}
${samples.canEditPatient(u, s) && s.status !== 'CANCELLED' ? html`<a class="btn light" href="/samples/${s.sample_id}/edit">Edit patient</a>` : ''}</div></div>
${s.status === 'CANCELLED' ? '' : html`<div class="steps" aria-label="Progress">${steps.map((st, i) => html`<div class="step ${st.state} ${i === 0 ? 'first' : ''}">${st.label}</div>`)}</div>`}
<div class="detail"><div>
${sampleCard}
${isStaff(u) ? trackingCard(s, t) : ''}
${isStaff(u) ? h.reportCard(u, s, t) : ''}
${h.counsellingCard(u, s, t)}
</div><div>
${patientCard}${billingCard}${timelineCard}${cancelCard}
</div></div>`);
  });

  // Tracking facts and the next lab action for staff.
  function trackingCard(s, t) {
    const tat = tracking.tatState(s);
    const ship = db.all(`SELECT sh.id, sh.shipment_no, sh.leg, sh.status FROM shipment_items i JOIN shipments sh ON sh.id = i.shipment_id WHERE i.sample_pk = ? ORDER BY sh.id`, s.id);
    const recollection = db.get('SELECT sample_id FROM samples WHERE recollection_of = ?', s.id);
    const original = s.recollection_of ? db.get('SELECT sample_id FROM samples WHERE id = ?', s.recollection_of) : null;
    const today = istDate();
    return html`<div class="card"><h2 style="margin-top:0">Tracking</h2><dl class="facts">
${ship.map((x) => html`<dt>${x.leg === 1 ? 'Pickup' : 'Onward dispatch'}</dt><dd><a class="mono" href="/tracking/shipments/${x.id}">${x.shipment_no}</a> · ${x.status.replace('_', ' ')}</dd>`)}
${s.received_at ? html`<dt>Lab receipt</dt><dd>${fmtDateTime(s.received_at)} · ${s.receipt_condition}</dd>` : ''}
${s.tat_due_at && s.released_at ? html`<dt>TAT due</dt><dd>${fmtDate(s.tat_due_at)} · <span class="pill ${s.tat_met ? 'good' : 'bad'}">${s.tat_met ? 'report released within TAT' : 'report released late'}</span></dd>` : ''}
${s.tat_due_at && !s.released_at ? html`<dt>TAT due</dt><dd>${fmtDate(s.tat_due_at)} · <span class="pill ${tat.paused ? '' : { green: 'good', amber: 'warn', red: 'bad' }[tat.level]}">${tat.paused ? 'paused' : tat.level === 'red' ? 'overdue' : `${tat.daysLeft.toFixed(1)} days left`}</span></dd>` : ''}
${s.partner_received_at ? html`<dt>Partner lab receipt</dt><dd>${fmtDate(s.partner_received_at)}${s.partner_lab_ref ? ` · ref ${s.partner_lab_ref}` : ''}</dd>` : ''}
${s.reject_reason ? html`<dt>Rejected</dt><dd>${s.reject_reason}</dd>` : ''}
${s.hold_reason ? html`<dt>On hold</dt><dd>${s.hold_reason} (since ${fmtDateTime(s.hold_started_at)})</dd>` : ''}
${original ? html`<dt>Recollection of</dt><dd><a class="mono" href="/samples/${original.sample_id}">${original.sample_id}</a></dd>` : ''}
${recollection ? html`<dt>Fresh sample</dt><dd><a class="mono" href="/samples/${recollection.sample_id}">${recollection.sample_id}</a></dd>` : ''}
${!ship.length && !s.received_at ? html`<dt>Next step</dt><dd>${['REGISTERED', 'COLLECTED'].includes(s.status) ? 'Waiting for pickup or lab receipt' : '—'}</dd>` : ''}</dl>
<div class="actions noprint">
${s.status === 'RECEIVED_AT_LAB' && t.route === 'in_house' ? html`<form method="post" action="/samples/${s.sample_id}/start-in-house"><button>Start in-house processing</button></form>` : ''}
${s.status === 'RECEIVED_AT_LAB' && t.route === 'partner_lab' ? html`<a class="btn" href="/tracking/onward">Send to partner lab</a>` : ''}
${s.status === 'REJECTED' && !recollection ? html`<form method="post" action="/samples/${s.sample_id}/recollect"><button>Register fresh sample (no charge)</button></form>` : ''}
${s.status === 'ON_HOLD' ? html`<form method="post" action="/samples/${s.sample_id}/release"><button>Release hold</button></form>` : ''}</div>
${['IN_TRANSIT_TO_PARTNER', 'DISPATCH_TO_PARTNER_SCHEDULED'].includes(s.status) ? html`<form method="post" action="/samples/${s.sample_id}/partner-received" class="noprint" style="margin-top:12px"><input type="hidden" name="back" value="sample">
<b>Partner lab received it</b><div class="grid" style="margin-top:8px">${field('Date received', 'received_on', today, { type: 'date', required: true, attrs: `max="${today}"` })}${field('Their reference', 'ref', '', { opt: true })}</div>
<div class="actions"><button>Mark received at partner lab</button></div></form>` : ''}
${!['ON_HOLD', 'CANCELLED', 'CLOSED', 'DELIVERED', 'REJECTED', 'RECOLLECTION_REQUESTED'].includes(s.status) ? html`<details class="noprint" style="margin-top:12px"><summary>Put on hold</summary>
<form method="post" action="/samples/${s.sample_id}/hold"><div class="grid">${field('Reason', 'reason', '', { required: true })}</div><div class="actions"><button class="light">Put on hold</button></div></form></details>` : ''}</div>`;
  }

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
    if (ctx.user.role === 'counsellor') throw new UserError('Bills are not available to counsellors.');
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
