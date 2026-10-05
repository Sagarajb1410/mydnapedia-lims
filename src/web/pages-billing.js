// Module 2: credit ledgers, recharges and supplier statements.
const crypto = require('node:crypto');
const { html, raw, field, select } = require('./views');
const billing = require('../billing');
const { fmtDateTime, fmtDate, rupees, toPaise, UserError, istDate } = require('../util');

const PAY_MODES = ['NEFT', 'RTGS', 'IMPS', 'UPI', 'Cheque'];
const ENTRY_LABEL = { recharge: 'Recharge', deduction: 'Test registered', reversal: 'Reversal', adjustment: 'Adjustment' };
const PROOF_TYPES = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png' };

function monthRange(month) {
  const m = /^\d{4}-\d{2}$/.test(month || '') ? month : istDate().slice(0, 7);
  const [y, mo] = m.split('-').map(Number);
  const start = new Date(Date.UTC(y, mo - 1, 1) - 5.5 * 3600000).toISOString();
  const end = new Date(Date.UTC(y, mo, 1) - 5.5 * 3600000).toISOString();
  return { month: m, start, end };
}

module.exports = function (router, { db, storage }, h) {
  function canSeeAccount(user, accountId) {
    return user.role === 'admin' || (user.role === 'partner' && user.account_id === accountId);
  }

  function ledgerRows(accountId, limit = 500) {
    // Running balance, oldest first, then shown newest first.
    const rows = db.all(
      `SELECT l.*, s.sample_id, u.name AS user_name FROM ledger_entries l LEFT JOIN samples s ON s.id = l.sample_pk
         LEFT JOIN users u ON u.id = l.created_by WHERE l.account_id = ? ORDER BY l.id`, accountId);
    let bal = 0;
    for (const r of rows) { bal += r.amount_paise; r.balance = bal; }
    return rows.reverse().slice(0, limit);
  }

  function ledgerTable(rows) {
    return html`<div class="table-wrap"><table><tr><th>Date</th><th>Entry</th><th>Sample</th><th>Details</th><th class="num">Amount</th><th class="num">Balance</th></tr>
${rows.map((r) => html`<tr><td>${fmtDateTime(r.created_at)}</td><td>${ENTRY_LABEL[r.entry_type]}</td><td>${r.sample_id ? html`<a class="mono" href="/samples/${r.sample_id}">${r.sample_id}</a>` : ''}</td>
<td>${r.reason || ''}${r.user_name ? html`<br><span class="muted">${r.user_name}</span>` : ''}</td><td class="num ${r.amount_paise < 0 ? 'neg' : ''}">${r.amount_paise > 0 ? '+' : ''}${rupees(r.amount_paise)}</td><td class="num ${r.balance < 0 ? 'neg' : ''}">${rupees(r.balance)}</td></tr>`)}
${rows.length ? '' : html`<tr><td colspan="6" class="muted">No entries yet.</td></tr>`}</table></div>`;
  }

  function requestsTable(rows, forAdmin) {
    return html`<div class="table-wrap"><table><tr>${forAdmin ? html`<th>Partner</th>` : ''}<th>Submitted</th><th>Paid on</th><th>Mode and reference</th><th class="num">Amount</th><th>Proof</th><th>Status</th>${forAdmin ? html`<th></th>` : ''}</tr>
${rows.map((r) => html`<tr>${forAdmin ? html`<td>${r.account_name}</td>` : ''}<td>${fmtDateTime(r.submitted_at)}</td><td>${fmtDate(r.payment_date)}</td><td>${r.mode} · <span class="mono">${r.reference}</span></td>
<td class="num">${rupees(r.amount_paise)}</td><td>${r.proof_file ? html`<a href="/billing/recharges/${r.id}/proof" target="_blank">View</a>` : '—'}</td>
<td><span class="pill ${r.status === 'approved' ? 'good' : r.status === 'rejected' ? 'bad' : 'warn'}">${r.status}</span>${r.review_note ? html`<br><span class="muted">${r.review_note}</span>` : ''}</td>
${forAdmin ? html`<td>${r.status === 'submitted' ? html`<form method="post" action="/billing/recharges/${r.id}/review" style="display:flex;gap:6px;flex-wrap:wrap">
<input name="note" placeholder="Note (needed to reject)" style="width:170px"><button class="small" name="decision" value="approve">Approve</button><button class="small light" name="decision" value="reject">Reject</button></form>` : ''}</td>` : ''}</tr>`)}
${rows.length ? '' : html`<tr><td colspan="8" class="muted">None.</td></tr>`}</table></div>`;
  }

  router.get('/billing', (ctx) => {
    const u = ctx.user;
    if (u.role === 'partner' && u.account_type === 'partner') return partnerBilling(ctx);
    if (u.role === 'partner' && u.account_type === 'supplier') return supplierStatement(ctx, u.account_id);
    if (u.role !== 'admin') throw new UserError('Billing is for the admin and partners.');
    const partners = db.all("SELECT * FROM accounts WHERE type = 'partner' ORDER BY name").map((a) => ({ ...a, bal: billing.balance(db, a.id) }));
    const suppliers = db.all("SELECT * FROM accounts WHERE type = 'supplier' ORDER BY name");
    const pending = db.all("SELECT r.*, a.name AS account_name FROM recharge_requests r JOIN accounts a ON a.id = r.account_id WHERE r.status = 'submitted' ORDER BY r.id");
    const recent = db.all("SELECT r.*, a.name AS account_name FROM recharge_requests r JOIN accounts a ON a.id = r.account_id WHERE r.status != 'submitted' ORDER BY r.id DESC LIMIT 20");
    h.send(ctx, 'Billing', html`<h1>Billing</h1><p class="sub">Partner credit ledgers, recharge approvals and supplier statements.</p>
<h2>Recharge requests to review</h2>${requestsTable(pending, true)}
<p class="muted">Check each payment on the bank statement before approving. Approving adds the amount to the partner's credit at once.</p>
<h2>B2B partners</h2><div class="table-wrap"><table><tr><th>Partner</th><th>Contact</th><th class="num">Balance</th><th class="num">Alert level</th><th></th></tr>
${partners.map((a) => html`<tr><td>${a.name}${a.active ? '' : html` <span class="pill">inactive</span>`}</td><td>${a.contact_name || ''}<br><span class="muted">${a.phone || ''}</span></td>
<td class="num ${a.bal < 0 ? 'neg' : ''}"><b>${rupees(a.bal)}</b>${a.bal < a.low_balance_paise ? html`<br><span class="pill warn">low</span>` : ''}</td><td class="num">${rupees(a.low_balance_paise)}</td>
<td><a href="/billing/ledger/${a.id}">Ledger</a></td></tr>`)}</table></div>
<details class="card" style="margin-top:12px"><summary><b>Add a recharge or correct a balance</b></summary>
<form method="post" action="/billing/adjust" style="margin-top:10px"><div class="grid">
${select('Partner', 'account_id', partners.map((a) => [a.id, a.name]), '', { required: true })}
${select('Type', 'kind', [['recharge', 'Recharge received (adds credit)'], ['adjustment', 'Correction (+ or −)']], 'recharge', { required: true })}
${field('Amount (₹, use − for a correction that reduces credit)', 'amount', '', { required: true })}
${field('Reason or payment reference', 'reason', '', { required: true })}</div><div class="actions"><button>Save</button></div></form></details>
<h2>B2B suppliers</h2><div class="table-wrap"><table><tr><th>Supplier</th><th>GSTIN</th><th></th></tr>
${suppliers.map((a) => html`<tr><td>${a.name}</td><td class="mono">${a.gstin || ''}</td><td><a href="/billing/supplier/${a.id}">Monthly statement</a></td></tr>`)}
${suppliers.length ? '' : html`<tr><td colspan="3" class="muted">No suppliers yet.</td></tr>`}</table></div>
<h2>Recently reviewed requests</h2>${requestsTable(recent, true)}`);
  });

  function partnerBilling(ctx) {
    const u = ctx.user;
    const a = db.get('SELECT * FROM accounts WHERE id = ?', u.account_id);
    const bal = billing.balance(db, a.id);
    const requests = db.all('SELECT * FROM recharge_requests WHERE account_id = ? ORDER BY id DESC LIMIT 20', a.id);
    h.send(ctx, 'Billing', html`<h1>Billing</h1><p class="sub">${a.name}</p>
<div class="stats"><div class="stat"><b class="${bal < 0 ? 'neg' : ''}">${rupees(bal)}</b><span>Credit balance</span></div>
<div class="stat"><b>${rupees(a.low_balance_paise)}</b><span>Reminder level</span></div></div>
${bal < a.low_balance_paise ? html`<div class="flash warn">Your balance is below your reminder level. You can still register samples, but please recharge soon. You will get a reminder every day until you do.</div>` : ''}
<div class="card"><h2 style="margin-top:0">Tell us about a payment</h2><p class="muted">Pay MyDNAPedia by bank transfer or UPI first, then enter the details here. Credit is added once our admin confirms the payment.</p>
<form method="post" action="/billing/recharge" enctype="multipart/form-data"><div class="grid">
${field('Amount paid (₹)', 'amount', '', { required: true, attrs: 'inputmode="decimal"' })}
${select('Paid by', 'mode', PAY_MODES, '', { required: true })}
${field('UTR or payment reference', 'reference', '', { required: true })}
${field('Payment date', 'payment_date', istDate(), { type: 'date', required: true, attrs: `max="${istDate()}"` })}
<div><label for="proof">Payment proof <span class="opt">(PDF, JPG or PNG, optional)</span></label><input id="proof" type="file" name="proof" accept=".pdf,.jpg,.jpeg,.png"></div>
</div><div class="actions"><button>Submit</button></div></form></div>
<h2>Your payment submissions</h2>${requestsTable(requests, false)}
<h2>Credit ledger</h2><p><a href="/billing/ledger/${a.id}?format=csv">Download as CSV (opens in Excel)</a></p>${ledgerTable(ledgerRows(a.id, 200))}`);
  }

  router.post('/billing/recharge', (ctx) => {
    const u = ctx.user;
    let proofFile = null;
    const f = ctx.files.proof;
    if (f) {
      const ext = PROOF_TYPES[f.type];
      if (!ext) throw new UserError('The proof must be a PDF, JPG or PNG file.');
      proofFile = `recharges/${u.account_id}/${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
      storage.put(proofFile, f.data);
    }
    billing.submitRecharge(db, u, {
      amountPaise: toPaise(ctx.body.amount), mode: ctx.body.mode, reference: ctx.body.reference,
      paymentDate: ctx.body.payment_date, proofFile,
    });
    h.redirect(ctx, '/billing', { type: 'ok', text: 'Thank you. Our admin will check the payment and add the credit.' });
  });

  router.get('/billing/recharges/:id/proof', (ctx) => {
    const r = db.get('SELECT * FROM recharge_requests WHERE id = ?', Number(ctx.params.id));
    if (!r || !r.proof_file || !canSeeAccount(ctx.user, r.account_id)) throw new UserError('File not found.');
    const ext = r.proof_file.split('.').pop();
    const type = Object.keys(PROOF_TYPES).find((k) => PROOF_TYPES[k] === ext);
    h.raw(ctx, type, storage.get(r.proof_file), { 'Content-Disposition': 'inline', 'X-Content-Type-Options': 'nosniff' });
  });

  router.post('/billing/recharges/:id/review', (ctx) => {
    const approve = ctx.body.decision === 'approve';
    billing.reviewRecharge(db, ctx.user, Number(ctx.params.id), approve, (ctx.body.note || '').trim());
    h.redirect(ctx, '/billing', { type: 'ok', text: approve ? 'Approved. The credit has been added.' : 'Rejected. The partner has been told why.' });
  });

  router.post('/billing/adjust', (ctx) => {
    const raw_ = String(ctx.body.amount || '').trim();
    const neg = raw_.startsWith('-') || raw_.startsWith('−');
    const amount = toPaise(raw_.replace(/^[-−]/, '')) * (neg ? -1 : 1);
    billing.adjust(db, ctx.user, Number(ctx.body.account_id), amount, ctx.body.reason, ctx.body.kind === 'recharge');
    h.redirect(ctx, '/billing', { type: 'ok', text: 'Saved to the ledger.' });
  });

  router.get('/billing/ledger/:id', (ctx) => {
    const id = Number(ctx.params.id);
    if (!canSeeAccount(ctx.user, id)) throw new UserError('Ledger not found.');
    const a = db.get("SELECT * FROM accounts WHERE id = ? AND type = 'partner'", id);
    if (!a) throw new UserError('Ledger not found.');
    const rows = ledgerRows(id, 100000);
    if (ctx.query.format === 'csv') {
      const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const lines = [['Date', 'Entry', 'Sample', 'Details', 'Amount (Rs)', 'Balance (Rs)'].map(q).join(',')]
        .concat(rows.slice().reverse().map((r) => [fmtDateTime(r.created_at), ENTRY_LABEL[r.entry_type], r.sample_id, r.reason, (r.amount_paise / 100).toFixed(2), (r.balance / 100).toFixed(2)].map(q).join(',')));
      return h.raw(ctx, 'text/csv; charset=utf-8', '﻿' + lines.join('\r\n'), { 'Content-Disposition': `attachment; filename="ledger-${a.code}-${istDate()}.csv"` });
    }
    h.send(ctx, `Ledger ${a.name}`, html`<p><a href="/billing">← Billing</a></p><h1>${a.name}</h1>
<p class="sub">Balance <b class="${billing.balance(db, id) < 0 ? 'neg' : ''}">${rupees(billing.balance(db, id))}</b> · <a href="?format=csv">Download as CSV</a></p>${ledgerTable(rows)}`);
  });

  function supplierStatement(ctx, accountId) {
    if (!canSeeAccount(ctx.user, accountId)) throw new UserError('Statement not found.');
    const a = db.get("SELECT * FROM accounts WHERE id = ? AND type = 'supplier'", accountId);
    if (!a) throw new UserError('Statement not found.');
    const { month, start, end } = monthRange(ctx.query.month);
    const rows = db.all(
      `SELECT s.sample_id, s.registered_at, p.full_name, t.name AS test_name, b.net_paise AS transfer, b.status, sb.bill_no, sb.patient_price_paise, sb.discount_paise, sb.total_paise
         FROM samples s JOIN bills b ON b.sample_pk = s.id JOIN patients p ON p.id = s.patient_id JOIN tests t ON t.id = s.test_id
         LEFT JOIN supplier_bills sb ON sb.sample_pk = s.id
        WHERE s.account_id = ? AND s.registered_at >= ? AND s.registered_at < ? ORDER BY s.id`, accountId, start, end);
    const due = rows.filter((r) => r.status !== 'reversed').reduce((t, r) => t + r.transfer, 0);
    h.send(ctx, 'Monthly statement', html`${ctx.user.role === 'admin' ? html`<p><a href="/billing">← Billing</a></p>` : ''}
<h1>${ctx.user.role === 'admin' ? a.name : 'Billing'}</h1><p class="sub">Monthly statement at transfer price. Your own patient bills are shown for reference.</p>
<form class="filters" method="get"><input type="month" name="month" value="${month}"><button class="light">Show</button></form>
<div class="stats"><div class="stat"><b>${rows.length}</b><span>Samples in ${month}</span></div><div class="stat"><b>${rupees(due)}</b><span>Payable to MyDNAPedia (transfer price)</span></div></div>
<div class="table-wrap"><table><tr><th>Sample</th><th>Date</th><th>Patient</th><th>Test</th><th>Your bill</th><th class="num">Your price</th><th class="num">Your discount</th><th class="num">Patient paid (incl. GST)</th><th class="num">Transfer price</th></tr>
${rows.map((r) => html`<tr><td><a class="mono" href="/samples/${r.sample_id}">${r.sample_id}</a></td><td>${fmtDate(r.registered_at)}</td><td>${r.full_name}</td><td>${r.test_name}</td><td class="mono">${r.bill_no || ''}</td>
<td class="num">${r.patient_price_paise == null ? '' : rupees(r.patient_price_paise)}</td><td class="num">${r.discount_paise ? rupees(r.discount_paise) : ''}</td><td class="num">${r.total_paise == null ? '' : rupees(r.total_paise)}</td>
<td class="num">${r.status === 'reversed' ? html`<s>${rupees(r.transfer)}</s> cancelled` : rupees(r.transfer)}</td></tr>`)}
${rows.length ? '' : html`<tr><td colspan="9" class="muted">No samples this month.</td></tr>`}</table></div>
<p class="muted">The GST invoice from MyDNAPedia for this month will be generated here once the invoice format is confirmed with the accountant.</p>`);
  }

  router.get('/billing/supplier/:id', (ctx) => supplierStatement(ctx, Number(ctx.params.id)));
};

module.exports.monthRange = monthRange;
