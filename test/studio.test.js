// Report Centre: installing the tool, how it is served, and its LIMS protocol.
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const db = require('../src/db');
const storage = require('../src/storage');
const seed = require('../src/seed');
const pdfwrite = require('../src/pdfwrite');
const studio = require('../src/studio');
const { createApp } = require('../src/web/app');

// A stand-in for the Report Studio file with the pieces the LIMS adjusts.
const FAKE = `<!doctype html><html><head><title>Report Studio</title></head><body><input type="file" id="pick">
<script>var app="mdp-report-studio";var cfg={lims:{url:"",key:"",afterReport:"none"},partnerTerms:["Zeta Labs","ZetaGx"]};
${studio.LINK_PATCHES.map(([from]) => `/*${from}*/`).join('\n')}</script></body></html>`;

async function withApp(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lims-studio-'));
  const d = db.open(':memory:');
  const store = storage.localAdapter(dir);
  seed.demo(d, store);
  const server = createApp({ db: d, storage: store }).server();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await fn({ d, store, base }); } finally { server.close(); }
}

async function signIn(base, email) {
  const res = await fetch(`${base}/login`, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `email=${encodeURIComponent(email)}&password=test1234` });
  return res.headers.get('set-cookie').split(';')[0];
}

test('Report Centre is installed, renamed and linked to the LIMS', async () => {
  await withApp(async ({ d, store, base }) => {
    const admin = d.get("SELECT * FROM users WHERE email = 'admin@mydnapedia.example'");
    assert.throws(() => studio.install(d, store, admin, { data: Buffer.from('<html>hello</html>') }), /not the Report Studio/);
    assert.deepStrictEqual(studio.install(d, store, admin, { data: Buffer.from(FAKE) }), { linked: true });
    assert.ok(!store.get('studio/report-studio.html').toString().includes('Zeta'), 'built-in partner names are removed when stored');

    const cookie = await signIn(base, 'lab@demo.example');
    const page = await (await fetch(`${base}/studio?sample=MDP26-000008&step=convert`, { headers: { cookie } })).text();
    assert.match(page, /<title>Report Centre<\/title>/);
    assert.match(page, /partnerTerms:\["Acme Genomics","AcmeGx"\]/, 'the admin\'s names are used');
    assert.match(page, /window\.__LIMS=\{"url":"\/studio\/api","key":"[0-9a-f]{64}","sample":"MDP26-000008","step":"convert"/);
    for (const [, to] of studio.LINK_PATCHES) assert.ok(page.includes(to));
    const partner = await signIn(base, 'sunrise@demo.example');
    assert.notStrictEqual((await fetch(`${base}/studio`, { headers: { cookie: partner }, redirect: 'manual' })).status, 200);

    // The tool's protocol, with the key it was given.
    const key = /"key":"([0-9a-f]{64})"/.exec(page)[1];
    const call = async (body) => (await fetch(`${base}/studio/api`, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ ...body, key }) })).json();
    assert.deepStrictEqual(await call({ action: 'ping' }), { ok: true, data: { lab: 'MyDNAPedia' } });
    const found = await call({ action: 'find', sampleId: 'mdp26-000008' });
    assert.ok(found.ok);
    assert.strictEqual(found.data.sample.sampleId, 'MDP26-000008');
    assert.strictEqual(found.data.stage, 'Partner report received');
    assert.deepStrictEqual((await call({ action: 'find', sampleId: 'MDP26-999999' })).ok, false);
    assert.match((await (await fetch(`${base}/studio/api`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ action: 'ping', key: 'nope' }) })).json()).error, /expired/);

    const s = d.get("SELECT * FROM samples WHERE sample_id = 'MDP26-000008'");
    const p = d.get('SELECT * FROM patients WHERE id = ?', s.patient_id);
    const pdf = (lines) => pdfwrite.write([lines], { title: 'MDP Skin Health', author: 'MyDNAPedia' }).toString('base64');
    const leak = await call({ action: 'push', sampleId: s.sample_id, kind: 'report', name: 'r.pdf', mime: 'application/pdf', b64: pdf(['MyDNAPedia', `Name: ${p.full_name}  Sample ID: ${s.sample_id}`, 'Analysed by Acme Genomics']) });
    assert.strictEqual(leak.ok, false);
    assert.match(leak.error, /Blocked by the LIMS check/);
    const good = await call({ action: 'push', sampleId: s.sample_id, kind: 'report', name: 'r.pdf', mime: 'application/pdf', b64: pdf(['MyDNAPedia', `Name: ${p.full_name}  Sample ID: ${s.sample_id}`, 'Your Genetic Result']) });
    assert.ok(good.ok, good.error);
    assert.strictEqual(d.get('SELECT status FROM samples WHERE id = ?', s.id).status, 'REPORT_WHITE_LABELLED');
  });
});

test('a case sent from Report Centre is stored and fills in the counselling form', async () => {
  await withApp(async ({ d, store, base }) => {
    const admin = d.get("SELECT * FROM users WHERE email = 'admin@mydnapedia.example'");
    studio.install(d, store, admin, { data: Buffer.from(FAKE) });
    const cookie = await signIn(base, 'counsellor@demo.example');
    const page = await (await fetch(`${base}/studio?sample=MDP26-000014&step=form`, { headers: { cookie } })).text();
    const key = /"key":"([0-9a-f]{64})"/.exec(page)[1];
    const call = async (body) => (await fetch(`${base}/studio/api`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ ...body, key }) })).json();
    const before = await call({ action: 'loadCase', sampleId: 'MDP26-000014' });
    assert.ok(before.data.found, 'a case is built from the LIMS when none was saved');
    const c = JSON.parse(before.data.json);
    c.form = { ...c.form, heightCm: '170', weightKg: '70', bp: '120/80', priorities: 'Walk daily', life: { diet: 'Vegetarian', actType: 'Walking', sleepHours: '7-8', tobacco: 'Never', alcohol: 'Never' } };
    const sent = await call({ action: 'push', sampleId: 'MDP26-000014', kind: 'case', name: 'case.json', mime: 'application/json', b64: Buffer.from(JSON.stringify(c)).toString('base64') });
    assert.ok(sent.ok, sent.error);
    assert.match(sent.data.skipped, /complete/);
    const s = d.get("SELECT id FROM samples WHERE sample_id = 'MDP26-000014'");
    const f = d.get('SELECT * FROM counselling_forms WHERE sample_pk = ?', s.id);
    assert.strictEqual(f.status, 'complete');
    assert.strictEqual(String(JSON.parse(f.data_json).heightCm), '170');
    const after = await call({ action: 'loadCase', sampleId: 'MDP26-000014' });
    assert.strictEqual(JSON.parse(after.data.json).form.heightCm, '170', 'the saved case comes back');
  });
});
