// Module 3: sample tracking screens for admin and lab staff.
const { html, raw, field, select, statusPill } = require('./views');
const tracking = require('../tracking');
const samples = require('../samples');
const { fmtDateTime, fmtDate, UserError, istDate } = require('../util');

const LEG_LABEL = { 1: 'To central lab', 2: 'To partner lab' };
const SHIP_STATUS = { scheduled: 'Scheduled', picked_up: 'Picked up', delivered: 'Delivered', cancelled: 'Cancelled' };
const SHIP_TONE = { scheduled: '', picked_up: 'warn', delivered: 'good', cancelled: 'bad' };
const TAT_TONE = { green: 'good', amber: 'warn', red: 'bad' };

function staffOnly(ctx) {
  if (!['admin', 'lab'].includes(ctx.user.role)) throw new UserError('This page is for MyDNAPedia staff.');
}

function tatPill(t) {
  if (!t) return '';
  const days = Math.abs(t.daysLeft);
  const text = t.paused ? 'Paused (on hold)' : t.level === 'red' ? `Overdue by ${days.toFixed(1)} days` : `${days.toFixed(1)} days left`;
  return html`<span class="pill ${t.paused ? '' : TAT_TONE[t.level]}">${text}</span>`;
}

function tabs(path) {
  const items = [['/tracking', 'TAT board'], ['/tracking/pickups', 'Pickups'], ['/tracking/receive', 'Lab receipt'], ['/tracking/onward', 'Partner lab dispatch']];
  return html`<div class="filters noprint">${items.map(([href, label]) => html`<a class="btn ${href === path ? '' : 'light'} small" href="${href}">${label}</a>`)}</div>`;
}

function pickupFields(withAwb = true) {
  return html`<div class="grid">${field('Pickup date', 'pickup_date', istDate(), { type: 'date', required: true })}
${select('Time window', 'window', tracking.WINDOWS, tracking.WINDOWS[0], { required: true })}
${withAwb ? field('Tracking (AWB) number', 'awb', '', { opt: true }) : ''}</div>`;
}

module.exports = function (router, { db }, h) {
  // ---------- TAT board ----------
  router.get('/tracking', (ctx) => {
    staffOnly(ctx);
    const board = tracking.tatBoard(db);
    const count = (lvl) => board.filter((r) => !r.tat.paused && r.tat.level === lvl).length;
    const expected = tracking.expectedAtLab(db).length;
    const pickups = tracking.pendingPickups(db).length;
    const onward = tracking.pendingOnward(db).length;
    const held = db.all(`SELECT s.sample_id, s.hold_reason, s.hold_started_at, s.hold_from_status FROM samples s WHERE s.status = 'ON_HOLD' ORDER BY s.hold_started_at`);
    const rejected = db.all(`SELECT s.sample_id, s.reject_reason, s.received_at, a.name AS account_name FROM samples s JOIN accounts a ON a.id = s.account_id WHERE s.status = 'REJECTED' ORDER BY s.received_at`);
    h.send(ctx, 'Tracking', html`<h1>Sample tracking</h1><p class="sub">The turnaround clock starts when the central lab receives a sample.</p>${tabs('/tracking')}
<div class="stats">
<div class="stat"><b>${pickups}</b><span><a href="/tracking/pickups">Samples waiting for a pickup</a></span></div>
<div class="stat"><b>${expected}</b><span><a href="/tracking/receive">Expected at the lab</a></span></div>
<div class="stat"><b>${onward}</b><span><a href="/tracking/onward">Waiting to go to the partner lab</a></span></div>
<div class="stat"><b>${count('amber')}</b><span>Past 75% of TAT</span></div>
<div class="stat"><b>${count('red')}</b><span>Overdue</span></div>
</div>
${rejected.length ? html`<h2>Rejected, fresh sample needed</h2><div class="table-wrap"><table><tr><th>Sample</th><th>From</th><th>Reason</th><th>Received</th></tr>
${rejected.map((r) => html`<tr><td><a class="mono" href="/samples/${r.sample_id}">${r.sample_id}</a></td><td>${r.account_name}</td><td>${r.reject_reason}</td><td>${fmtDateTime(r.received_at)}</td></tr>`)}</table></div>` : ''}
${held.length ? html`<h2>On hold</h2><div class="table-wrap"><table><tr><th>Sample</th><th>Reason</th><th>Held since</th><th>Was</th></tr>
${held.map((r) => html`<tr><td><a class="mono" href="/samples/${r.sample_id}">${r.sample_id}</a></td><td>${r.hold_reason}</td><td>${fmtDateTime(r.hold_started_at)}</td><td>${samples.STATUSES[r.hold_from_status]}</td></tr>`)}</table></div>` : ''}
<h2>In the lab, by due date</h2><div class="table-wrap"><table><tr><th>Sample</th><th>Test</th><th>From</th><th>Status</th><th>Received</th><th>Due</th><th>TAT</th></tr>
${board.map((r) => html`<tr><td><a class="mono" href="/samples/${r.sample_id}">${r.sample_id}</a><br><span class="muted">${r.full_name}</span></td><td>${r.test_name}</td><td>${r.account_name}</td>
<td>${statusPill(r.status, samples.STATUSES[r.status])}</td><td>${fmtDate(r.received_at)}</td><td>${fmtDate(r.tat_due_at)}</td><td>${tatPill(r.tat)}</td></tr>`)}
${board.length ? '' : html`<tr><td colspan="7" class="muted">No samples in the lab right now.</td></tr>`}</table></div>`);
  });

  // ---------- Pickups (leg 1) and the shipment list ----------
  router.get('/tracking/pickups', (ctx) => {
    staffOnly(ctx);
    const isAdmin = ctx.user.role === 'admin';
    const pending = tracking.pendingPickups(db);
    const byAccount = new Map();
    for (const s of pending) {
      if (!byAccount.has(s.account_id)) byAccount.set(s.account_id, { name: s.account_name, city: s.account_city, rows: [] });
      byAccount.get(s.account_id).rows.push(s);
    }
    const ships = db.all(
      `SELECT sh.*, a.name AS account_name, (SELECT COUNT(*) FROM shipment_items i WHERE i.shipment_id = sh.id) AS n
         FROM shipments sh LEFT JOIN accounts a ON a.id = sh.account_id
        WHERE sh.status IN ('scheduled', 'picked_up') OR sh.created_at >= ? ORDER BY sh.id DESC LIMIT 100`,
      new Date(Date.now() - 14 * 86400000).toISOString());
    h.send(ctx, 'Pickups', html`<h1>Courier pickups</h1><p class="sub">Partner and supplier samples are picked up and brought to the central lab. Samples collected at the central lab skip this step.</p>${tabs('/tracking/pickups')}
<h2>Waiting for a pickup</h2>
${byAccount.size ? [...byAccount.entries()].map(([accountId, g]) => html`<form method="post" action="/tracking/pickups" class="card">
<b>${g.name}</b> <span class="muted">${g.city || ''}</span>
<div class="table-wrap" style="margin-top:8px"><table><tr><th></th><th>Sample</th><th>Test</th><th>Status</th><th>Registered</th></tr>
${g.rows.map((s) => html`<tr><td><input type="checkbox" name="samples[]" value="${s.id}" checked ${isAdmin ? '' : raw('disabled')} aria-label="Include ${s.sample_id}"></td>
<td><a class="mono" href="/samples/${s.sample_id}">${s.sample_id}</a></td><td>${s.test_name}</td><td>${statusPill(s.status, samples.STATUSES[s.status])}</td><td>${fmtDateTime(s.registered_at)}</td></tr>`)}</table></div>
${isAdmin ? html`<input type="hidden" name="account" value="${accountId}">${pickupFields()}<div class="actions"><button>Book pickup and message the courier</button></div>` : html`<p class="muted">The admin books pickups.</p>`}
</form>`) : html`<div class="card muted">No samples are waiting for a pickup.</div>`}
<h2>Shipments</h2><div class="table-wrap"><table><tr><th>Shipment</th><th>Route</th><th>From</th><th class="num">Samples</th><th>Pickup</th><th>AWB</th><th>Status</th></tr>
${ships.map((s) => html`<tr><td><a class="mono" href="/tracking/shipments/${s.id}">${s.shipment_no}</a></td><td>${LEG_LABEL[s.leg]}</td><td>${s.leg === 1 ? s.account_name : 'Central lab'}</td>
<td class="num">${s.n}</td><td>${fmtDate(s.pickup_date)}<br><span class="muted">${s.pickup_window}</span></td><td class="mono">${s.awb || '—'}</td><td><span class="pill ${SHIP_TONE[s.status]}">${SHIP_STATUS[s.status]}</span></td></tr>`)}
${ships.length ? '' : html`<tr><td colspan="7" class="muted">No shipments yet.</td></tr>`}</table></div>`);
  });

  router.post('/tracking/pickups', (ctx) => {
    staffOnly(ctx);
    const r = tracking.scheduleLeg1(db, ctx.user, { samplePks: ctx.body.samples, pickupDate: ctx.body.pickup_date, window: ctx.body.window, awb: ctx.body.awb });
    h.redirect(ctx, `/tracking/shipments/${r.shipmentId}`, { type: 'ok', text: `Pickup ${r.shipmentNo} booked. The courier and partner messages are waiting in the outbox.` });
  });

  router.get('/tracking/shipments/:id', (ctx) => {
    staffOnly(ctx);
    const sh = tracking.shipment(db, ctx.params.id);
    const items = tracking.shipmentSamples(db, sh.id);
    const account = sh.account_id ? db.get('SELECT * FROM accounts WHERE id = ?', sh.account_id) : null;
    const creator = db.get('SELECT name FROM users WHERE id = ?', sh.created_by);
    const waiting = sh.leg === 1 ? ['PICKUP_SCHEDULED', 'IN_TRANSIT_TO_LAB'] : ['DISPATCH_TO_PARTNER_SCHEDULED', 'IN_TRANSIT_TO_PARTNER'];
    const missing = sh.status === 'picked_up' ? items.filter((s) => waiting.includes(s.status)) : [];
    const courierMsg = db.get("SELECT id FROM notifications WHERE code = 'N7' AND body LIKE ? ORDER BY id DESC LIMIT 1", `%${sh.shipment_no}%`);
    h.send(ctx, sh.shipment_no, html`<p class="noprint"><a href="/tracking/pickups">← Pickups</a></p>
<h1 class="mono">${sh.shipment_no}</h1><p class="sub">${LEG_LABEL[sh.leg]} · <span class="pill ${SHIP_TONE[sh.status]}">${SHIP_STATUS[sh.status]}</span></p>
<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(320px,1fr));align-items:start">
<div class="card"><dl class="facts"><dt>From</dt><dd>${sh.leg === 1 ? sh.origin : 'Central lab'}</dd>
${account ? html`<dt>Contact</dt><dd>${account.contact_name || '—'}${account.phone ? ` · ${account.phone}` : ''}</dd>` : ''}
<dt>To</dt><dd>${sh.leg === 1 ? 'Central lab' : 'Partner lab'}</dd><dt>Courier</dt><dd>${sh.courier}</dd>
<dt>Pickup</dt><dd>${fmtDate(sh.pickup_date)}, ${sh.pickup_window}</dd><dt>Booked</dt><dd>${fmtDateTime(sh.created_at)}${creator ? ` by ${creator.name}` : ''}</dd>
${sh.picked_up_at ? html`<dt>Picked up</dt><dd>${fmtDateTime(sh.picked_up_at)}</dd>` : ''}${sh.delivered_at ? html`<dt>All received</dt><dd>${fmtDateTime(sh.delivered_at)}</dd>` : ''}
<dt>Courier message</dt><dd>${courierMsg ? html`<a href="/outbox">In the outbox</a>` : html`<span class="muted">No courier WhatsApp number in settings</span>`}</dd></dl>
${sh.status !== 'cancelled' ? html`<form method="post" action="/tracking/shipments/${sh.id}/awb" class="noprint" style="margin-top:12px"><div class="grid">${field('Tracking (AWB) number', 'awb', sh.awb || '', { opt: true })}</div><div class="actions"><button class="light small">Save AWB</button></div></form>` : ''}
${sh.status === 'scheduled' ? html`<form method="post" action="/tracking/shipments/${sh.id}/picked-up" class="noprint"><div class="actions"><button>Mark picked up by courier</button></div></form>` : ''}
${sh.status === 'scheduled' && ctx.user.role === 'admin' ? html`<details class="noprint" style="margin-top:12px"><summary>Cancel this pickup</summary>
<form method="post" action="/tracking/shipments/${sh.id}/cancel"><div class="grid">${field('Reason', 'reason', '', { required: true })}</div><div class="actions"><button class="danger">Cancel pickup</button></div></form></details>` : ''}</div>
<div class="card"><h2 style="margin-top:0">Samples (${items.length})</h2>
${missing.length ? html`<div class="flash warn">Not received yet: ${missing.map((s) => s.sample_id).join(', ')}</div>` : ''}
<div class="table-wrap"><table><tr><th>Sample</th><th>Test</th><th>Status</th></tr>
${items.map((s) => html`<tr><td><a class="mono" href="/samples/${s.sample_id}">${s.sample_id}</a></td><td>${s.test_name}</td><td>${statusPill(s.status, samples.STATUSES[s.status])}</td></tr>`)}</table></div></div></div>`);
  });

  router.post('/tracking/shipments/:id/awb', (ctx) => {
    tracking.setAwb(db, ctx.user, ctx.params.id, ctx.body.awb);
    h.redirect(ctx, `/tracking/shipments/${ctx.params.id}`, { type: 'ok', text: 'Tracking number saved.' });
  });
  router.post('/tracking/shipments/:id/picked-up', (ctx) => {
    tracking.markPickedUp(db, ctx.user, ctx.params.id);
    h.redirect(ctx, `/tracking/shipments/${ctx.params.id}`, { type: 'ok', text: 'Marked as picked up. The samples are now in transit.' });
  });
  router.post('/tracking/shipments/:id/cancel', (ctx) => {
    tracking.cancelShipment(db, ctx.user, ctx.params.id, ctx.body.reason);
    h.redirect(ctx, `/tracking/shipments/${ctx.params.id}`, { type: 'ok', text: 'Pickup cancelled. The samples are back in the waiting list.' });
  });

  // ---------- Central lab receipt ----------
  router.get('/tracking/receive', (ctx) => {
    staffOnly(ctx);
    const expected = tracking.expectedAtLab(db);
    const last = ctx.query.last ? db.get(
      `SELECT s.sample_id, s.status, s.tat_due_at, s.reject_reason, p.full_name, t.name AS test_name, t.route FROM samples s
         JOIN patients p ON p.id = s.patient_id JOIN tests t ON t.id = s.test_id WHERE s.sample_id = ?`, ctx.query.last) : null;
    h.send(ctx, 'Lab receipt', html`<h1>Lab receipt</h1><p class="sub">Scan each barcode as the box is opened. A barcode scanner types the ID and presses Enter for you.</p>${tabs('/tracking/receive')}
${last ? html`<div class="card" style="border-color:${last.status === 'REJECTED' ? 'var(--bad)' : 'var(--good)'}"><b class="mono">${last.sample_id}</b> · ${last.full_name} · ${last.test_name}<br>
${last.status === 'REJECTED' ? html`<span class="pill bad">Rejected</span> ${last.reject_reason}. <a href="/samples/${last.sample_id}">Request a fresh sample</a>`
    : html`<span class="pill good">Received</span> TAT due ${fmtDate(last.tat_due_at)}. Next: ${last.route === 'in_house' ? 'start in-house processing' : html`<a href="/tracking/onward">send to the partner lab</a>`}.`}</div>` : ''}
<form method="post" action="/tracking/receive" class="card"><div class="grid">
${field('Sample ID', 'sample_id', '', { required: true, attrs: 'autofocus autocomplete="off"' })}
${select('Condition', 'condition', tracking.CONDITIONS, 'Acceptable', { required: true })}
${field('Note', 'note', '', { opt: true })}</div><div class="actions"><button>Record receipt</button></div></form>
<h2>Expected at the lab (${expected.length})</h2><div class="table-wrap"><table><tr><th>Sample</th><th>From</th><th>Shipment</th><th>Pickup</th><th>Status</th></tr>
${expected.map((r) => html`<tr><td class="mono">${r.sample_id}</td><td>${r.account_name}</td><td>${r.shipment_no}</td><td>${fmtDate(r.pickup_date)}</td><td>${statusPill(r.status, samples.STATUSES[r.status])}</td></tr>`)}
${expected.length ? '' : html`<tr><td colspan="5" class="muted">Nothing is on its way.</td></tr>`}</table></div>`);
  });

  router.post('/tracking/receive', (ctx) => {
    staffOnly(ctx);
    const r = tracking.receive(db, ctx.user, ctx.body.sample_id, { condition: ctx.body.condition, note: ctx.body.note });
    const flash = r.status === 'REJECTED'
      ? { type: 'error', text: `${r.sampleId} rejected. The partner and patient messages are in the outbox.` }
      : { type: r.unexpected ? 'warn' : 'ok', text: r.unexpected ? `${r.sampleId} received, but it had no booked pickup. Check how it arrived.` : `${r.sampleId} received. The TAT clock has started.` };
    h.redirect(ctx, `/tracking/receive?last=${encodeURIComponent(r.sampleId)}`, flash);
  });

  // ---------- Onward dispatch (leg 2) ----------
  router.get('/tracking/onward', (ctx) => {
    staffOnly(ctx);
    const pending = tracking.pendingOnward(db);
    const away = tracking.atPartnerLab(db);
    h.send(ctx, 'Partner lab dispatch', html`<h1>Partner lab dispatch</h1><p class="sub">Tests processed at the partner lab go onward after the central lab receives them. Messages never name the partner lab.</p>${tabs('/tracking/onward')}
<h2>Waiting to be sent (${pending.length})</h2>
${pending.length ? html`<form method="post" action="/tracking/onward" class="card"><div class="table-wrap"><table><tr><th></th><th>Sample</th><th>Test</th><th>Received</th><th>TAT</th></tr>
${pending.map((s) => html`<tr><td><input type="checkbox" name="samples[]" value="${s.id}" checked aria-label="Include ${s.sample_id}"></td><td><a class="mono" href="/samples/${s.sample_id}">${s.sample_id}</a></td>
<td>${s.test_name}</td><td>${fmtDateTime(s.received_at)}</td><td>${tatPill(tracking.tatState(s))}</td></tr>`)}</table></div>
${pickupFields()}<div class="actions"><button>Book dispatch and message the courier</button></div></form>` : html`<div class="card muted">Nothing is waiting to go to the partner lab.</div>`}
<h2>At or on the way to the partner lab</h2><div class="table-wrap"><table><tr><th>Sample</th><th>Test</th><th>Status</th><th>TAT</th><th>Partner lab receipt</th></tr>
${away.map((s) => html`<tr><td><a class="mono" href="/samples/${s.sample_id}">${s.sample_id}</a></td><td>${s.test_name}</td><td>${statusPill(s.status, samples.STATUSES[s.status])}</td><td>${tatPill(tracking.tatState(s))}</td>
<td>${s.status === 'RECEIVED_AT_PARTNER' ? html`${fmtDate(s.partner_received_at)}${s.partner_lab_ref ? html`<br><span class="muted">Ref ${s.partner_lab_ref}</span>` : ''}`
    : html`<form method="post" action="/samples/${s.sample_id}/partner-received" style="display:flex;gap:6px;flex-wrap:wrap"><input type="date" name="received_on" value="${istDate()}" max="${istDate()}" required aria-label="Date received">
<input name="ref" placeholder="Their reference" aria-label="Partner lab reference" style="width:140px"><button class="small">Received</button></form>`}</td></tr>`)}
${away.length ? '' : html`<tr><td colspan="5" class="muted">None.</td></tr>`}</table></div>`);
  });

  router.post('/tracking/onward', (ctx) => {
    staffOnly(ctx);
    const r = tracking.scheduleLeg2(db, ctx.user, { samplePks: ctx.body.samples, pickupDate: ctx.body.pickup_date, window: ctx.body.window, awb: ctx.body.awb });
    h.redirect(ctx, `/tracking/shipments/${r.shipmentId}`, { type: 'ok', text: `Dispatch ${r.shipmentNo} booked. The courier message is waiting in the outbox.` });
  });

  // ---------- Per-sample actions (buttons on the sample page) ----------
  router.post('/samples/:id/partner-received', (ctx) => {
    tracking.partnerReceived(db, ctx.user, ctx.params.id, { receivedOn: ctx.body.received_on, ref: ctx.body.ref });
    h.redirect(ctx, ctx.body.back === 'sample' ? `/samples/${ctx.params.id}` : '/tracking/onward', { type: 'ok', text: `${ctx.params.id} marked as received at the partner lab.` });
  });
  router.post('/samples/:id/start-in-house', (ctx) => {
    tracking.startInHouse(db, ctx.user, ctx.params.id);
    h.redirect(ctx, `/samples/${ctx.params.id}`, { type: 'ok', text: 'In-house processing started.' });
  });
  router.post('/samples/:id/recollect', (ctx) => {
    const newId = tracking.recollect(db, ctx.user, ctx.params.id);
    h.redirect(ctx, `/samples/${newId}`, { type: 'ok', text: `Fresh sample ${newId} registered at no charge. Print its label and arrange collection.` });
  });
  router.post('/samples/:id/hold', (ctx) => {
    tracking.hold(db, ctx.user, ctx.params.id, ctx.body.reason);
    h.redirect(ctx, `/samples/${ctx.params.id}`, { type: 'ok', text: 'Sample put on hold. The TAT clock is paused.' });
  });
  router.post('/samples/:id/release', (ctx) => {
    tracking.release(db, ctx.user, ctx.params.id);
    h.redirect(ctx, `/samples/${ctx.params.id}`, { type: 'ok', text: 'Hold released.' });
  });
};
