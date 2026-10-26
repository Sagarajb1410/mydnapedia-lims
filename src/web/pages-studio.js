// Report Centre: the conversion, counselling form and action plan tool, opened
// from the LIMS and linked to it (see src/studio.js).
const { html, icon } = require('./views');
const auth = require('../auth');
const studio = require('../studio');
const reports = require('../reports');
const samples = require('../samples');
const { UserError } = require('../util');

const ROLES = ['admin', 'lab', 'counsellor'];
const STEPS = ['convert', 'form', 'plan'];

module.exports = function (router, { db, storage }, h) {
  router.get('/studio', (ctx) => {
    if (!ROLES.includes(ctx.user.role)) throw new UserError('Report Centre is for MyDNAPedia staff and counsellors.');
    const sample = /^[A-Za-z0-9-]{4,30}$/.test(ctx.query.sample || '') ? ctx.query.sample.toUpperCase() : '';
    if (sample) samples.load(db, ctx.user, sample);
    const step = STEPS.includes(ctx.query.step) ? ctx.query.step : (ctx.user.role === 'counsellor' ? 'form' : 'convert');
    const test = /^[A-Za-z0-9]{2,20}$/.test(ctx.query.test || '') ? ctx.query.test.toUpperCase() : '';
    const page = studio.page(db, storage, ctx.user, { sample, step, test, tool: ctx.query.tool === 'skin' || /SKIN/.test(test) ? 'skin' : '' });
    if (!page) {
      return h.send(ctx, studio.NAME, html`<h1>${studio.NAME} is not installed yet</h1>
<p class="sub">${ctx.user.role === 'admin' ? html`Install it once under <a href="/admin#report-centre">Admin, Report Centre</a>.` : 'Ask the admin to install it under Admin.'}</p>`);
    }
    h.raw(ctx, 'text/html; charset=utf-8', page, { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
  });

  // The partner's original PDF, fetched by the tool when it opens on a sample.
  router.get('/studio/source/:id', (ctx) => {
    if (!ROLES.includes(ctx.user.role)) throw new UserError('Not allowed.');
    const s = samples.load(db, ctx.user, ctx.params.id);
    const r = reports.forSample(db, s.id).find((x) => x.kind === 'source' && x.status !== 'superseded');
    if (!r || !reports.canOpen(ctx.user, r, s)) { ctx.res.writeHead(404); ctx.res.end(); return; }
    h.raw(ctx, 'application/pdf', storage.get(r.file_key), { 'X-File-Name': encodeURIComponent(r.file_name || 'partner-report.pdf'), 'X-Content-Type-Options': 'nosniff' });
  });

  // Our white-labelled report, read by the action plan window for the results.
  router.get('/studio/branded/:id', (ctx) => {
    if (!ROLES.includes(ctx.user.role)) throw new UserError('Not allowed.');
    const s = samples.load(db, ctx.user, ctx.params.id);
    const r = reports.forSample(db, s.id).find((x) => x.kind === 'branded' && !['superseded', 'blocked'].includes(x.status) && reports.canOpen(ctx.user, x, s));
    if (!r) { ctx.res.writeHead(404); ctx.res.end(); return; }
    h.raw(ctx, 'application/pdf', storage.get(r.file_key), { 'X-File-Name': encodeURIComponent(r.file_name || `${s.sample_id}.pdf`), 'X-Content-Type-Options': 'nosniff' });
  });

  // The tool's own LIMS protocol. It sends a sign-in key instead of the cookie.
  router.post('/studio/api', (ctx) => {
    const reply = (obj, status = 200) => {
      ctx.res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      ctx.res.end(JSON.stringify(obj));
    };
    let req;
    try { req = JSON.parse((ctx.raw || Buffer.alloc(0)).toString('utf8')); } catch { return reply({ ok: false, error: 'The request could not be read.' }, 400); }
    const user = auth.userForToken(db, String(req.key || ''));
    if (!user || !ROLES.includes(user.role)) return reply({ ok: false, error: 'Your sign-in has expired. Open Report Centre again from the LIMS.' });
    try {
      reply({ ok: true, data: studio.api(db, storage, { ...req, user }) });
    } catch (e) {
      if (e instanceof UserError) return reply({ ok: false, error: e.message });
      console.error(e);
      reply({ ok: false, error: 'The LIMS hit an error. It has been written to the server window.' });
    }
  });

  router.post('/admin/studio', (ctx) => {
    const r = studio.install(db, storage, ctx.user, ctx.files.file);
    h.redirect(ctx, '/admin#report-centre', r.linked
      ? { type: 'ok', text: `${r.tool} is installed and linked to the LIMS.` }
      : { type: 'warn', text: `${r.tool} is installed, but this version could not be linked to the LIMS. Staff can still use it and upload files by hand.` });
  });

  // Button used on the sample page and the Report Centre pages.
  h.studioButton = (label, sampleId, step, cls = 'light') => html`<a class="btn ${cls}" href="/studio?${sampleId ? `sample=${sampleId}&` : ''}step=${step}" target="_blank" rel="noopener">${icon('reports')}${label}</a>`;
};

// The heading shared by the three Report Centre pages.
module.exports.head = function head(user, active, sub, db) {
  const tabs = [['/reports', 'Reports', ['admin', 'lab']], ['/counselling', 'Counselling', ['admin', 'counsellor']], ['/counselling/availability', 'Availability', ['admin', 'counsellor']], ['/plans', 'Action plans', ['admin', 'counsellor']]]
    .filter(([, , roles]) => roles.includes(user.role));
  return html`<div class="head"><div><h1>${studio.NAME}</h1><p class="sub">${sub}</p></div>
<div class="actions" style="margin:0"><a class="btn" href="/studio" target="_blank" rel="noopener">${icon('reports')}Open ${studio.NAME}</a></div></div>
${['admin', 'lab'].includes(user.role) && db ? html`<div class="actions noprint" style="margin:0 0 10px;align-items:center"><b>White-label a report:</b>${db.all("SELECT code, name FROM tests WHERE route = 'partner_lab' AND active = 1 ORDER BY id")
    .map((t) => html`<a class="btn light small" href="/studio?test=${t.code}" target="_blank" rel="noopener">${t.name}</a>`)}<span class="muted">Opened from a sample, the test is picked for you.</span></div>` : ''}
${['admin', 'counsellor'].includes(user.role) ? html`<form method="get" action="/studio" target="_blank" class="actions noprint" style="margin:0 0 14px"><input type="hidden" name="step" value="plan"><input name="sample" placeholder="Sample ID (optional)" pattern="[A-Za-z0-9-]{4,30}" style="max-width:240px"><button>${icon('plan')}Action plan window</button><span class="muted">Add the white-labelled report and the counsellor's filled form there; it creates the plan.</span></form>` : ''}
${tabs.length > 1 ? html`<nav class="seg">${tabs.map(([href, label]) => html`<a href="${href}" class="${href === active ? 'on' : ''}">${label}</a>`)}</nav>` : ''}`;
};
