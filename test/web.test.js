// Smoke test for the web screens: every main page renders for each role,
// the shell carries the menu, and static files are served.
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const db = require('../src/db');
const storage = require('../src/storage');
const seed = require('../src/seed');
const { createApp } = require('../src/web/app');

async function withServer(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lims-web-'));
  const d = db.open(':memory:');
  const store = storage.localAdapter(dir);
  seed.demo(d, store);
  const server = createApp({ db: d, storage: store }).server();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await fn(base); } finally { server.close(); }
}

async function signIn(base, email) {
  const res = await fetch(`${base}/login`, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `email=${encodeURIComponent(email)}&password=test1234` });
  assert.strictEqual(res.status, 303, `sign-in for ${email}`);
  return res.headers.get('set-cookie').split(';')[0];
}

test('main screens render for every role', async () => {
  await withServer(async (base) => {
    const login = await fetch(`${base}/login`);
    assert.strictEqual(login.status, 200);
    assert.match(await login.text(), /Welcome back/);
    for (const f of ['logo-sm.png', 'montserrat-400.ttf', 'art.svg']) assert.strictEqual((await fetch(`${base}/static/${f}`)).status, 200, f);
    assert.strictEqual((await fetch(`${base}/static/nope.js`)).status, 404);
    const roles = {
      'admin@mydnapedia.example': ['/', '/samples', '/samples?phase=lab', '/samples?status=REJECTED', '/samples/new', '/samples/MDP26-000008', '/samples/MDP26-000015', '/tracking', '/tracking/pickups', '/tracking/receive', '/tracking/onward', '/reports', '/counselling', '/plans', '/billing', '/outbox', '/admin', '/admin/tests', '/admin/accounts', '/admin/users', '/audit', '/password'],
      'lab@demo.example': ['/', '/samples', '/tracking', '/reports'],
      'sunrise@demo.example': ['/samples', '/samples/new', '/billing'],
      'counsellor@demo.example': ['/counselling', '/plans', '/samples'],
    };
    for (const [email, paths] of Object.entries(roles)) {
      const cookie = await signIn(base, email);
      for (const p of paths) {
        const res = await fetch(base + p, { headers: { cookie }, redirect: 'manual' });
        assert.strictEqual(res.status, 200, `${email} ${p}`);
        const body = await res.text();
        assert.match(body, /<aside class="side"/, `${email} ${p} has the menu`);
        assert.doesNotMatch(body, /undefined|\[object Object\]/, `${email} ${p} renders cleanly`);
      }
    }
    // An exact sample ID in the search box opens the sample.
    const cookie = await signIn(base, 'admin@mydnapedia.example');
    const jump = await fetch(`${base}/samples?q=mdp26-000008`, { headers: { cookie }, redirect: 'manual' });
    assert.strictEqual(jump.status, 303);
    assert.strictEqual(jump.headers.get('location'), '/samples/MDP26-000008');
  });
});
