// The web application: sign-in, session handling, and wiring of all pages.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { Router, parseRequest } = require('./http');
const { html, page, field, icon } = require('./views');
const auth = require('../auth');
const { UserError } = require('../util');

const COOKIE = 'lims_session';
const config = require('../config');
const SECURE = config.secureCookies ? '; Secure' : '';

// Logo, fonts and artwork, read once at start-up.
const STATIC_TYPES = { '.png': 'image/png', '.svg': 'image/svg+xml', '.ttf': 'font/ttf' };
const STATIC = new Map(fs.readdirSync(path.join(__dirname, 'static'))
  .filter((f) => STATIC_TYPES[path.extname(f)])
  .map((f) => [f, { type: STATIC_TYPES[path.extname(f)], body: fs.readFileSync(path.join(__dirname, 'static', f)) }]));

function createApp({ db, storage }) {
  const router = new Router();
  const ctxBase = { db, storage };

  // Response helpers shared by every page module.
  const helpers = {
    send(ctx, title, body, opts = {}) {
      const flash = ctx.flash;
      const out = page({ title, user: ctx.user, path: ctx.path, query: ctx.query, flash, body, bare: opts.bare });
      ctx.res.writeHead(opts.status || 200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      ctx.res.end(out.toString());
    },
    redirect(ctx, to, flash) {
      const headers = { Location: to };
      if (flash) headers['Set-Cookie'] = `lims_flash=${encodeURIComponent(JSON.stringify(flash))}; Path=/; HttpOnly; SameSite=Lax${SECURE}`;
      ctx.res.writeHead(303, headers);
      ctx.res.end();
    },
    raw(ctx, type, body, extra = {}) {
      ctx.res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store', ...extra });
      ctx.res.end(body);
    },
  };

  // Public routes
  router.get('/static/:file', (ctx) => {
    const f = STATIC.get(ctx.params.file);
    if (!f) { ctx.res.writeHead(404); ctx.res.end(); return; }
    ctx.res.writeHead(200, { 'Content-Type': f.type, 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff' });
    ctx.res.end(f.body);
  });
  router.get('/login', (ctx) => loginPage(ctx));
  router.post('/login', (ctx) => {
    try {
      const { token, user } = auth.login(db, ctx.body.email || '', ctx.body.password || '');
      ctx.res.writeHead(303, {
        Location: user.must_change_password ? '/password' : '/',
        'Set-Cookie': `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax${SECURE}; Max-Age=${12 * 3600}`,
      });
      ctx.res.end();
    } catch (e) {
      if (!(e instanceof UserError)) throw e;
      ctx.flash = { type: 'error', text: e.message };
      loginPage(ctx, ctx.body.email);
    }
  });

  // Test version only (the LIMS listens on this computer alone): say which data
  // is open and, on an empty LIMS, show the first admin sign-in until it is used.
  function testHelp() {
    if (config.live) return '';
    if (db.get("SELECT id FROM users WHERE email = 'sunrise@demo.example'")) {
      return html`<div class="flash warn" style="margin-bottom:14px"><div><b>Demo data is open.</b> Sign in as admin@mydnapedia.example (or any demo account) with the password <b>test1234</b>.</div></div>`;
    }
    const first = db.get("SELECT email FROM users WHERE role = 'admin' AND must_change_password = 1 ORDER BY id LIMIT 1");
    const note = path.join(config.dataDir, 'FIRST-SIGN-IN.txt');
    const pw = first && fs.existsSync(note) ? (fs.readFileSync(note, 'utf8').match(/One-time password: (\S+)/) || [])[1] : null;
    return html`<div class="flash ok" style="margin-bottom:14px"><div><b>Your own data is open</b> (folder ${path.basename(config.dataDir)}).${pw ? html` First sign-in: <b>${first.email}</b> with the one-time password <b>${pw}</b>. You will then choose your own password.` : ''}</div></div>`;
  }

  function loginPage(ctx, email = '') {
    const flash = ctx.flash;
    helpers.send(ctx, 'Sign in', html`<div class="auth"><div class="art"><div class="q"><i></i><b>Every sample, from collection to counselling, in one place.</b><span>Know your DNA · Make better choices</span></div></div>
<div class="pane"><form method="post" action="/login"><img src="/static/logo-sm.png" alt="MyDNAPedia">
<h1>Welcome back</h1><p class="sub">Sign in to the MyDNAPedia laboratory system.</p>
${testHelp()}
${flash ? html`<div class="flash ${flash.type}">${icon('alert')}<div>${flash.text}</div></div>` : ''}
<div class="grid">
${field('Email', 'email', email, { type: 'email', required: true, attrs: 'autocomplete="username" autofocus' })}
${field('Password', 'password', '', { type: 'password', required: true, attrs: 'autocomplete="current-password"' })}
</div><div class="actions"><button>Sign in</button></div></form>
<p class="foot">Five wrong tries lock the account for ten minutes. Your admin gives you your first password.${config.live ? '' : html`<br><br><span class="testflag" style="margin:0">Test version · dummy data only</span>`}</p></div></div>`, { bare: true });
  }

  router.post('/logout', (ctx) => {
    auth.logout(db, ctx.cookies[COOKIE]);
    ctx.res.writeHead(303, { Location: '/login', 'Set-Cookie': `${COOKIE}=; Path=/; HttpOnly${SECURE}; Max-Age=0` });
    ctx.res.end();
  });

  router.get('/password', (ctx) => passwordPage(ctx));
  router.post('/password', (ctx) => {
    if (ctx.body.next !== ctx.body.confirm) throw new UserError('The two new passwords do not match.');
    auth.changePassword(db, ctx.user, ctx.body.current || '', ctx.body.next || '');
    helpers.redirect(ctx, '/', { type: 'ok', text: 'Your password has been changed.' });
  });
  function passwordPage(ctx) {
    helpers.send(ctx, 'Change password', html`<div class="head"><div><h1>Change password</h1>
<p class="sub">${ctx.user.must_change_password ? 'Please choose your own password before you continue.' : 'Use at least 8 characters. You stay signed in on this computer.'}</p></div></div>
<form method="post" class="card" style="max-width:420px"><div class="grid" style="grid-template-columns:1fr">
${field('Current password', 'current', '', { type: 'password', required: true })}
${field('New password (at least 8 characters)', 'next', '', { type: 'password', required: true })}
${field('New password again', 'confirm', '', { type: 'password', required: true })}
</div><div class="actions"><button>Save</button></div></form>`);
  }

  require('./pages-bulk')(router, ctxBase, helpers);
  require('./pages-samples')(router, ctxBase, helpers);
  require('./pages-tracking')(router, ctxBase, helpers);
  require('./pages-reports')(router, ctxBase, helpers);
  require('./pages-counselling')(router, ctxBase, helpers);
  require('./pages-billing')(router, ctxBase, helpers);
  require('./pages-admin')(router, ctxBase, helpers);
  require('./pages-monthly')(router, ctxBase, helpers);
  require('./pages-studio')(router, ctxBase, helpers);
  require('./pages-track')(router, ctxBase, helpers);

  const PUBLIC = new Set(['/login', '/studio/api', '/track', '/track/book']);
  const isPublic = (p) => PUBLIC.has(p) || p.startsWith('/static/');

  async function handle(req, res) {
    const ctx = { ...ctxBase, req, res };
    try {
      Object.assign(ctx, await parseRequest(req));
      if (ctx.cookies.lims_flash) {
        try { ctx.flash = JSON.parse(ctx.cookies.lims_flash); } catch { /* ignore */ }
        res.setHeader('Set-Cookie', 'lims_flash=; Path=/; Max-Age=0');
      }
      // Forms must come from this site.
      if (req.method === 'POST') {
        const origin = req.headers.origin;
        if (origin && new URL(origin).host !== req.headers.host) {
          res.writeHead(403); res.end('Forbidden'); return;
        }
      }
      ctx.user = auth.userForToken(db, ctx.cookies[COOKIE]);
      if (!ctx.user && !isPublic(ctx.path)) return helpers.redirect(ctx, '/login');
      if (ctx.user && ctx.user.must_change_password && !['/password', '/logout'].includes(ctx.path) && !isPublic(ctx.path)) return helpers.redirect(ctx, '/password');
      const m = router.match(req.method, ctx.path);
      if (!m) {
        return helpers.send(ctx, 'Not found', html`<h1>Page not found</h1><p><a href="/">Go to the start page</a></p>`, { status: 404 });
      }
      ctx.params = m.params;
      await m.handler(ctx);
    } catch (e) {
      if (e instanceof UserError) {
        // Show the message on the page the form came from.
        if (req.method === 'POST' && ctx.retry) return ctx.retry(e.message);
        const back = req.method === 'POST' ? (req.headers.referer ? new URL(req.headers.referer).pathname + new URL(req.headers.referer).search : '/') : null;
        if (back) return helpers.redirect(ctx, back, { type: 'error', text: e.message });
        return helpers.send(ctx, 'Problem', html`<h1>Something needs attention</h1><div class="flash error">${e.message}</div><p><a href="/">Back to the start page</a></p>`, { status: 400 });
      }
      console.error(e);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Something went wrong. The error has been written to the server window.');
      }
    }
  }

  return { handle, server: () => http.createServer(handle) };
}

module.exports = { createApp };
