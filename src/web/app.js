// The web application: sign-in, session handling, and wiring of all pages.
const http = require('node:http');
const { Router, parseRequest } = require('./http');
const { html, page, field } = require('./views');
const auth = require('../auth');
const { UserError } = require('../util');

const COOKIE = 'lims_session';

function createApp({ db, storage }) {
  const router = new Router();
  const ctxBase = { db, storage };

  // Response helpers shared by every page module.
  const helpers = {
    send(ctx, title, body, opts = {}) {
      const flash = ctx.flash;
      const out = page({ title, user: ctx.user, path: ctx.path, flash, body, bare: opts.bare });
      ctx.res.writeHead(opts.status || 200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      ctx.res.end(out.toString());
    },
    redirect(ctx, to, flash) {
      const headers = { Location: to };
      if (flash) headers['Set-Cookie'] = `lims_flash=${encodeURIComponent(JSON.stringify(flash))}; Path=/; HttpOnly; SameSite=Lax`;
      ctx.res.writeHead(303, headers);
      ctx.res.end();
    },
    raw(ctx, type, body, extra = {}) {
      ctx.res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store', ...extra });
      ctx.res.end(body);
    },
  };

  // Public routes
  router.get('/login', (ctx) => loginPage(ctx));
  router.post('/login', (ctx) => {
    try {
      const { token, user } = auth.login(db, ctx.body.email || '', ctx.body.password || '');
      ctx.res.writeHead(303, {
        Location: user.must_change_password ? '/password' : '/',
        'Set-Cookie': `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${12 * 3600}`,
      });
      ctx.res.end();
    } catch (e) {
      if (!(e instanceof UserError)) throw e;
      ctx.flash = { type: 'error', text: e.message };
      loginPage(ctx, ctx.body.email);
    }
  });

  function loginPage(ctx, email = '') {
    helpers.send(ctx, 'Sign in', html`<div class="login card"><h1>Sign in</h1><p class="sub">MyDNAPedia LIMS</p>
<form method="post" action="/login"><div class="grid" style="grid-template-columns:1fr">
${field('Email', 'email', email, { type: 'email', required: true, attrs: 'autocomplete="username" autofocus' })}
${field('Password', 'password', '', { type: 'password', required: true, attrs: 'autocomplete="current-password"' })}
</div><div class="actions"><button>Sign in</button></div></form>
<p class="muted" style="font-size:13px;margin-top:16px">Five wrong tries lock the account for ten minutes. Your admin gives you your first password.</p></div>`);
  }

  router.post('/logout', (ctx) => {
    auth.logout(db, ctx.cookies[COOKIE]);
    ctx.res.writeHead(303, { Location: '/login', 'Set-Cookie': `${COOKIE}=; Path=/; HttpOnly; Max-Age=0` });
    ctx.res.end();
  });

  router.get('/password', (ctx) => passwordPage(ctx));
  router.post('/password', (ctx) => {
    if (ctx.body.next !== ctx.body.confirm) throw new UserError('The two new passwords do not match.');
    auth.changePassword(db, ctx.user, ctx.body.current || '', ctx.body.next || '');
    helpers.redirect(ctx, '/', { type: 'ok', text: 'Your password has been changed.' });
  });
  function passwordPage(ctx) {
    helpers.send(ctx, 'Change password', html`<h1>Change password</h1>
${ctx.user.must_change_password ? html`<p class="sub">Please choose your own password before you continue.</p>` : ''}
<form method="post" class="card" style="max-width:420px"><div class="grid" style="grid-template-columns:1fr">
${field('Current password', 'current', '', { type: 'password', required: true })}
${field('New password (at least 8 characters)', 'next', '', { type: 'password', required: true })}
${field('New password again', 'confirm', '', { type: 'password', required: true })}
</div><div class="actions"><button>Save</button></div></form>`);
  }

  require('./pages-samples')(router, ctxBase, helpers);
  require('./pages-billing')(router, ctxBase, helpers);
  require('./pages-admin')(router, ctxBase, helpers);

  const PUBLIC = new Set(['/login']);

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
      if (!ctx.user && !PUBLIC.has(ctx.path)) return helpers.redirect(ctx, '/login');
      if (ctx.user && ctx.user.must_change_password && !['/password', '/logout'].includes(ctx.path)) return helpers.redirect(ctx, '/password');
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
