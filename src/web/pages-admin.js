// Admin pages (tests, prices, accounts, users, settings, audit) and the outbox.
const { html, raw, field, select, roleLabel, icon } = require('./views');
const admin = require('../admin');
const notify = require('../notify');
const samples = require('../samples');
const studio = require('../studio');
const { fmtDateTime, rupees, UserError, getSetting, setSetting, SETTING_DEFAULTS, istDate } = require('../util');

const SETTING_LABELS = {
  labName: 'Lab name (in messages and bills)',
  unitLine: 'Company line on bills',
  supportEmail: 'Admin and support email',
  supportPhone: 'Support phone (in patient messages)',
  sampleIdPrefix: 'Sample ID prefix',
  companyGstin: 'MyDNAPedia GSTIN',
  companyAddress: 'Company address',
  companyLegalName: 'Company legal name (on invoices)',
  companyState: 'Company state (decides CGST + SGST or IGST)',
  companyPan: 'Company PAN',
  invoiceSac: 'SAC code for tests (confirm with your accountant)',
  invoiceGstRate: 'GST rate % included in test prices (0 = bill of supply)',
  bankName: 'Bank name (on invoices)',
  bankAccount: 'Bank account number',
  bankIfsc: 'Bank branch and IFSC',
  jurisdiction: 'Jurisdiction city (invoice footer)',
  courierName: 'Main courier vendor',
  courierWhatsapp: 'Courier vendor WhatsApp number',
  partnerLabAddress: 'Partner lab address (for onward dispatch; shown only to the courier)',
  leakTerms: 'Names that must never appear in a released report (partner lab names and brands, comma separated)',
};

module.exports = function (router, { db, storage }, h) {
  const onlyAdmin = (ctx) => admin.requireAdmin(ctx.user);
  const price = (testId, list) => db.get(
    'SELECT price_paise FROM prices WHERE test_id = ? AND price_list = ? AND effective_from <= ? ORDER BY effective_from DESC, id DESC LIMIT 1',
    testId, list, istDate(),
  );

  router.get('/admin', (ctx) => {
    onlyAdmin(ctx);
    const tile = (href, ic, title, text) => html`<a class="tile" href="${href}"><span class="ti">${icon(ic)}</span><span><b>${title}</b><small>${text}</small></span></a>`;
    h.send(ctx, 'Admin', html`<div class="head"><div><h1>Admin</h1><p class="sub">Tests, prices, accounts, people and system settings.</p></div></div>
<div class="tiles">${tile('/admin/tests', 'samples', 'Tests and prices', 'Test catalogue, price lists, TAT and processing route')}
${tile('/admin/accounts', 'billing', 'B2B partners and suppliers', 'Accounts, GSTIN, contacts, reminder levels')}
${tile('/admin/users', 'register', 'People', 'Sign-ins and roles')}
${tile('/audit', 'reports', 'Audit trail', 'Every change, who and when')}</div>
<h2 id="report-centre">Report Centre</h2><div class="card">${(() => {
  const st = studio.status(storage);
  return html`<p style="margin-top:0">${st.installed
    ? html`<span class="pill ${st.linked ? 'good' : 'warn'}">${st.linked ? 'Installed and linked' : 'Installed, not linked'}</span> ${st.from === 'bundled' ? 'Using the copy that came with the LIMS.' : 'Using the copy you installed.'}`
    : html`<span class="pill warn">Not installed</span> Staff cannot open Report Centre until it is installed.`}</p>
<p class="muted">Report Centre converts the partner's report, holds the counselling form and drafts the action plan. It runs in the browser, so client data stays inside our system. Install a new version by choosing the Report Studio HTML file; its built-in partner names are removed and the names under Settings are used instead.</p>
<form method="post" action="/admin/studio" enctype="multipart/form-data"><label for="studio-file">Report Studio HTML file</label><input id="studio-file" type="file" name="file" accept=".html,text/html" required>
<div class="actions"><button class="light">Install</button></div></form>`;
})()}</div>
<h2>Settings</h2><form method="post" action="/admin/settings" class="card"><div class="grid">
${Object.keys(SETTING_DEFAULTS).map((k) => field(SETTING_LABELS[k] || k, k, getSetting(db, k)))}
</div><div class="actions"><button>Save settings</button></div></form>`);
  });

  router.post('/admin/settings', (ctx) => {
    onlyAdmin(ctx);
    const prefix = (ctx.body.sampleIdPrefix || '').trim().toUpperCase();
    if (!/^[A-Z]{2,5}$/.test(prefix)) throw new UserError('The sample ID prefix must be 2 to 5 letters.');
    if ('invoiceGstRate' in ctx.body && !['0', '5', '12', '18', '28'].includes(String(ctx.body.invoiceGstRate).trim())) throw new UserError('The GST rate must be 0, 5, 12, 18 or 28.');
    for (const k of Object.keys(SETTING_DEFAULTS)) if (k in ctx.body) setSetting(db, k, k === 'sampleIdPrefix' ? prefix : String(ctx.body[k]).trim());
    require('../util').audit(db, ctx.user.id, 'settings_changed', 'settings', null, ctx.body);
    h.redirect(ctx, '/admin', { type: 'ok', text: 'Settings saved.' });
  });

  // ---------- Tests ----------
  router.get('/admin/tests', (ctx) => {
    onlyAdmin(ctx);
    const tests = db.all('SELECT * FROM tests ORDER BY active DESC, name');
    const p = (t, l) => { const r = price(t.id, l); return r ? rupees(r.price_paise) : '—'; };
    h.send(ctx, 'Tests and prices', html`<p><a href="/admin">← Admin</a></p><div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px"><h1>Tests and prices</h1><a class="btn" href="/admin/tests/new">Add a test</a></div>
<p class="sub">Prices are inclusive of taxes in this test version. A price change applies from its effective date; bills already made keep their price.</p>
<div class="table-wrap"><table><tr><th>Code</th><th>Test</th><th>Sample</th><th>Processing</th><th>TAT</th><th class="num">Standard</th><th class="num">B2B partner</th><th class="num">Supplier transfer</th><th></th></tr>
${tests.map((t) => html`<tr><td class="mono">${t.code}</td><td>${t.name}${t.active ? '' : html` <span class="pill">inactive</span>`}<br><span class="muted">Label: ${t.short_name}</span></td><td>${t.sample_type}</td>
<td>${t.route === 'partner_lab' ? 'Partner lab' : 'In-house'}</td><td>${t.tat_days} days</td><td class="num">${p(t, 'direct')}</td><td class="num">${p(t, 'partner')}</td><td class="num">${p(t, 'supplier')}</td>
<td><a href="/admin/tests/${t.id}">Edit</a></td></tr>`)}</table></div>`);
  });

  function testForm(ctx, t) {
    const v = (k, d = '') => t[k] ?? d;
    const cur = (l) => { if (!t.id) return t['price_' + l] || ''; const r = price(t.id, l); return t['price_' + l] ?? (r ? (r.price_paise / 100).toFixed(2).replace(/\.00$/, '') : ''); };
    h.send(ctx, t.id ? 'Edit test' : 'Add a test', html`<p><a href="/admin/tests">← Tests</a></p><h1>${t.id ? `Edit ${t.name}` : 'Add a test'}</h1>
<form method="post" class="card"><input type="hidden" name="id" value="${v('id')}"><div class="grid">
${field('Code', 'code', v('code'), { required: true })}${field('Test name', 'name', v('name'), { required: true })}
${field('Name on label (max 24)', 'short_name', v('short_name'), { required: true, attrs: 'maxlength="24"' })}${field('Sample type', 'sample_type', v('sample_type', 'Saliva'), { required: true })}
${select('Processing', 'route', [['in_house', 'In-house'], ['partner_lab', 'Partner lab']], v('route', 'in_house'), { required: true })}
${field('TAT (days from lab receipt)', 'tat_days', v('tat_days', '21'), { type: 'number', required: true })}
${select('Active', 'active', [['yes', 'Yes'], ['no', 'No']], t.active === 0 ? 'no' : 'yes')}</div>
<h2>Prices (₹)</h2><div class="grid">
${field('Standard price (direct patients)', 'price_direct', cur('direct'))}${field('B2B partner price', 'price_partner', cur('partner'))}
${field('Supplier transfer price', 'price_supplier', cur('supplier'))}${field('Price changes apply from', 'effective_from', v('effective_from', istDate()), { type: 'date' })}</div>
<div class="actions"><button>Save</button></div></form>`);
  }
  router.get('/admin/tests/new', (ctx) => { onlyAdmin(ctx); testForm(ctx, {}); });
  router.get('/admin/tests/:id', (ctx) => {
    onlyAdmin(ctx);
    const t = db.get('SELECT * FROM tests WHERE id = ?', Number(ctx.params.id));
    if (!t) throw new UserError('Test not found.');
    testForm(ctx, t);
  });
  const saveTest = (ctx) => {
    onlyAdmin(ctx);
    ctx.retry = (msg) => { ctx.flash = { type: 'error', text: msg }; testForm(ctx, { ...ctx.body, id: ctx.body.id || undefined, active: ctx.body.active === 'no' ? 0 : 1 }); };
    admin.saveTest(db, ctx.user, ctx.body);
    h.redirect(ctx, '/admin/tests', { type: 'ok', text: 'Test saved.' });
  };
  router.post('/admin/tests/new', saveTest);
  router.post('/admin/tests/:id', saveTest);

  // ---------- Accounts ----------
  router.get('/admin/accounts', (ctx) => {
    onlyAdmin(ctx);
    const rows = db.all("SELECT a.*, (SELECT COUNT(*) FROM samples s WHERE s.account_id = a.id) AS n FROM accounts a WHERE type != 'main' ORDER BY type, name");
    h.send(ctx, 'Partners and suppliers', html`<p><a href="/admin">← Admin</a></p><div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px"><h1>B2B partners and suppliers</h1><a class="btn" href="/admin/accounts/new">Add an account</a></div>
<p class="sub">B2B partners (franchises included) pay in advance by credit. B2B suppliers bill patients under their own name and GSTIN and pay the transfer price.</p>
<div class="table-wrap"><table><tr><th>Code</th><th>Name</th><th>Type</th><th>Contact</th><th class="num">Samples</th><th></th></tr>
${rows.map((a) => html`<tr><td class="mono">${a.code}</td><td>${a.name}${a.active ? '' : html` <span class="pill">inactive</span>`}</td><td>${a.type === 'partner' ? 'B2B partner' : 'B2B supplier'}</td>
<td>${a.contact_name || ''}<br><span class="muted">${a.phone || ''} ${a.email || ''}</span></td><td class="num">${a.n}</td><td><a href="/admin/accounts/${a.id}">Edit</a></td></tr>`)}</table></div>`);
  });
  function accountForm(ctx, a) {
    const v = (k, d = '') => a[k] ?? d;
    const low = a.low_balance ?? (a.low_balance_paise != null ? String(a.low_balance_paise / 100) : '20000');
    h.send(ctx, a.id ? 'Edit account' : 'Add an account', html`<p><a href="/admin/accounts">← Accounts</a></p><h1>${a.id ? a.name : 'Add an account'}</h1>
<form method="post" class="card"><input type="hidden" name="id" value="${v('id')}"><div class="grid">
${a.id ? html`<input type="hidden" name="type" value="${a.type}"><div><label>Type</label><p style="margin:6px 0">${a.type === 'partner' ? 'B2B partner (prepaid credit)' : 'B2B supplier (own billing)'}</p></div>`
    : select('Type', 'type', [['partner', 'B2B partner (prepaid credit)'], ['supplier', 'B2B supplier (own billing)']], v('type'), { required: true })}
${field('Code (short, for bill numbers)', 'code', v('code'), { required: true })}${field('Display name', 'name', v('name'), { required: true })}
${field('Legal name', 'legal_name', v('legal_name'), { opt: true })}${field('GSTIN', 'gstin', v('gstin'), { opt: true })}
${field('Address', 'address', v('address'), { opt: true })}${field('City', 'city', v('city'), { opt: true })}${select('State', 'state', samples.STATES, v('state'))}
${field('Contact person', 'contact_name', v('contact_name'), { opt: true })}${field('Contact mobile (WhatsApp)', 'phone', v('phone'), { opt: true })}${field('Contact email', 'email', v('email'), { type: 'email', required: true })}
${field('Daily reminder when credit falls below (₹, partners only)', 'low_balance', low)}
${select('Active', 'active', [['yes', 'Yes'], ['no', 'No']], a.active === 0 || a.active === 'no' ? 'no' : 'yes')}</div>
<p class="muted">Suppliers need legal name, address and GSTIN, because these print on their patient bills.</p><div class="actions"><button>Save</button></div></form>`);
  }
  router.get('/admin/accounts/new', (ctx) => { onlyAdmin(ctx); accountForm(ctx, {}); });
  router.get('/admin/accounts/:id', (ctx) => {
    onlyAdmin(ctx);
    const a = db.get("SELECT * FROM accounts WHERE id = ? AND type != 'main'", Number(ctx.params.id));
    if (!a) throw new UserError('Account not found.');
    accountForm(ctx, a);
  });
  const saveAccount = (ctx) => {
    onlyAdmin(ctx);
    ctx.retry = (msg) => { ctx.flash = { type: 'error', text: msg }; accountForm(ctx, ctx.body); };
    admin.saveAccount(db, ctx.user, ctx.body);
    h.redirect(ctx, '/admin/accounts', { type: 'ok', text: 'Account saved.' });
  };
  router.post('/admin/accounts/new', saveAccount);
  router.post('/admin/accounts/:id', saveAccount);

  // ---------- People ----------
  router.get('/admin/users', (ctx) => {
    onlyAdmin(ctx);
    const users = db.all('SELECT u.*, a.name AS account_name, a.type AS account_type FROM users u LEFT JOIN accounts a ON a.id = u.account_id ORDER BY u.active DESC, u.role, u.name');
    const accounts = db.all("SELECT id, name, type FROM accounts WHERE type != 'main' AND active = 1 ORDER BY name");
    h.send(ctx, 'People', html`<p><a href="/admin">← Admin</a></p><h1>People</h1><p class="sub">Each person gets a one-time password, shown once. Pass it on privately; they choose their own at first sign-in.</p>
<div class="table-wrap"><table><tr><th>Name</th><th>Email</th><th>Role</th><th>Last sign-in</th><th></th></tr>
${users.map((u) => html`<tr><td>${u.name}${u.active ? '' : html` <span class="pill bad">cannot sign in</span>`}</td><td>${u.email}</td><td>${roleLabel(u)}${u.account_name ? html`<br><span class="muted">${u.account_name}</span>` : ''}</td>
<td>${fmtDateTime(u.last_login_at) || '—'}</td><td><form method="post" action="/admin/users/${u.id}" style="display:flex;gap:6px;flex-wrap:wrap">
<button class="small light" name="do" value="reset">New password</button><button class="small light" name="do" value="${u.active ? 'disable' : 'enable'}">${u.active ? 'Stop sign-in' : 'Allow sign-in'}</button></form></td></tr>`)}</table></div>
<h2>Add a person</h2><form method="post" action="/admin/users" class="card"><div class="grid">
${field('Name', 'name', '', { required: true })}${field('Email', 'email', '', { type: 'email', required: true })}${field('Mobile', 'phone', '', { opt: true })}
${select('Role', 'role', [['lab', 'Lab staff'], ['counsellor', 'Counsellor'], ['partner', 'B2B partner or supplier user'], ['admin', 'Admin']], '', { required: true })}
${select('Account (for partner or supplier users)', 'account_id', accounts.map((a) => [a.id, `${a.name} (${a.type === 'partner' ? 'partner' : 'supplier'})`]), '', { placeholder: 'Not needed for staff' })}
</div><div class="actions"><button>Add person</button></div></form>`);
  });
  router.post('/admin/users', (ctx) => {
    onlyAdmin(ctx);
    const { password } = admin.createUser(db, ctx.user, ctx.body);
    h.redirect(ctx, '/admin/users', { type: 'ok', text: `Added ${ctx.body.email}. One-time password: ${password} (shown only now).` });
  });
  router.post('/admin/users/:id', (ctx) => {
    onlyAdmin(ctx);
    const id = Number(ctx.params.id);
    const target = db.get('SELECT email FROM users WHERE id = ?', id);
    if (!target) throw new UserError('Person not found.');
    if (ctx.body.do === 'reset') {
      const pw = admin.resetPassword(db, ctx.user, id);
      return h.redirect(ctx, '/admin/users', { type: 'ok', text: `New one-time password for ${target.email}: ${pw} (shown only now).` });
    }
    admin.setUserActive(db, ctx.user, id, ctx.body.do === 'enable');
    h.redirect(ctx, '/admin/users', { type: 'ok', text: 'Saved.' });
  });

  // ---------- Audit ----------
  router.get('/audit', (ctx) => {
    onlyAdmin(ctx);
    const q = (ctx.query.q || '').trim();
    const rows = q
      ? db.all('SELECT l.*, u.name AS user_name FROM audit_log l LEFT JOIN users u ON u.id = l.user_id WHERE l.entity_id = ? OR l.action LIKE ? ORDER BY l.id DESC LIMIT 300', q, `%${q}%`)
      : db.all('SELECT l.*, u.name AS user_name FROM audit_log l LEFT JOIN users u ON u.id = l.user_id ORDER BY l.id DESC LIMIT 300');
    h.send(ctx, 'Audit trail', html`<h1>Audit trail</h1><p class="sub">Entries cannot be changed or deleted, by anyone.</p>
<form class="filters"><input name="q" value="${q}" placeholder="Sample ID or action"><button class="light">Search</button></form>
<div class="table-wrap"><table><tr><th>When</th><th>Who</th><th>Action</th><th>Record</th><th>Details</th></tr>
${rows.map((r) => html`<tr><td>${fmtDateTime(r.at)}</td><td>${r.user_name || ''}</td><td>${r.action.replace(/_/g, ' ')}</td><td class="mono">${r.entity} ${r.entity_id || ''}</td>
<td class="mono" style="font-size:12px;max-width:420px;word-break:break-word">${r.detail || ''}</td></tr>`)}</table></div>`);
  });

  // ---------- Outbox ----------
  // No WhatsApp API: staff open each message pre-filled and press Send themselves.
  router.get('/outbox', (ctx) => {
    if (!['admin', 'lab'].includes(ctx.user.role)) throw new UserError('The outbox is for staff.');
    const show = ctx.query.show === 'done' ? 'done' : 'pending';
    const rows = db.all(
      `SELECT n.*, s.sample_id, u.name AS sent_by_name FROM notifications n LEFT JOIN samples s ON s.id = n.sample_pk LEFT JOIN users u ON u.id = n.sent_by
        WHERE ${show === 'pending' ? "n.status = 'pending'" : "n.status != 'pending'"} ORDER BY n.id DESC LIMIT 200`);
    h.send(ctx, 'Outbox', html`<h1>Outbox</h1>
<p class="sub">Nothing is sent automatically. Open a message to see it ready in WhatsApp or your mail app, send it, then mark it sent. Only send to your own test numbers while using dummy data.</p>
<nav class="seg"><a class="${show === 'pending' ? 'on' : ''}" href="/outbox">Waiting</a><a class="${show === 'done' ? 'on' : ''}" href="/outbox?show=done">Sent or skipped</a></nav>
<div class="table-wrap"><table><tr><th>Created</th><th>Message</th><th>To</th><th>Text</th><th></th></tr>
${rows.map((n) => html`<tr><td>${fmtDateTime(n.created_at)}<br><span class="muted">${n.code} · ${notify.CODES[n.code] || ''}</span></td>
<td>${n.channel === 'whatsapp' ? 'WhatsApp' : 'Email'}${n.sample_id ? html`<br><a class="mono" href="/samples/${n.sample_id}">${n.sample_id}</a>` : ''}</td>
<td>${n.recipient_name || ''}<br><span class="muted">${n.recipient}</span></td><td style="max-width:420px;white-space:pre-line">${n.subject ? html`<b>${n.subject}</b><br>` : ''}${n.body}${n.attachment_key ? html`<br><a href="/outbox/${n.id}/attachment">📎 Download ${n.attachment_name} to attach</a>` : ''}</td>
<td>${n.status === 'pending' ? html`<div style="display:flex;flex-direction:column;gap:6px">
<a class="btn small" target="_blank" rel="noopener" href="${n.channel === 'whatsapp' ? notify.whatsappLink(n.recipient, n.body) : notify.mailtoLink(n.recipient, n.subject, n.body)}">Open ${n.channel === 'whatsapp' ? 'WhatsApp' : 'email'}</a>
<form method="post" action="/outbox/${n.id}"><button class="small light" name="do" value="sent">Mark sent</button> <button class="small light" name="do" value="skip">Skip</button></form></div>`
    : html`<span class="pill ${n.status === 'sent' ? 'good' : ''}">${n.status}</span><br><span class="muted">${n.sent_by_name || ''} ${fmtDateTime(n.sent_at)}</span>`}</td></tr>`)}
${rows.length ? '' : html`<tr><td colspan="5" class="muted">Nothing here.</td></tr>`}</table></div>`);
  });
  router.get('/outbox/:id/attachment', (ctx) => {
    if (!['admin', 'lab'].includes(ctx.user.role)) throw new UserError('The outbox is for staff.');
    const n = db.get('SELECT * FROM notifications WHERE id = ?', Number(ctx.params.id));
    if (!n || !n.attachment_key) throw new UserError('This message has no attachment.');
    h.raw(ctx, 'application/pdf', storage.get(n.attachment_key), {
      'Content-Disposition': `attachment; filename="${n.attachment_name.replace(/[^A-Za-z0-9._-]/g, '_')}"`, 'X-Content-Type-Options': 'nosniff',
    });
  });
  router.post('/outbox/:id', (ctx) => {
    if (!['admin', 'lab'].includes(ctx.user.role)) throw new UserError('The outbox is for staff.');
    if (ctx.body.do === 'sent') notify.markSent(db, Number(ctx.params.id), ctx.user.id);
    else notify.skip(db, Number(ctx.params.id), ctx.user.id);
    h.redirect(ctx, '/outbox');
  });
};
