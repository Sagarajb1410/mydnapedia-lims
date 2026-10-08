// Patient tracking: the sample ID plus the last 4 mobile digits open a plain,
// patient-friendly view with no partner lab, references or other details.
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const db_ = require('../src/db');
const storage = require('../src/storage');
const seed = require('../src/seed');
const samples = require('../src/samples');
const tracking = require('../src/tracking');
const track = require('../src/track');
const { createApp } = require('../src/web/app');

function fresh() {
  const db = db_.open(':memory:');
  seed.demo(db);
  const user = (email) => db.get('SELECT u.*, a.type AS account_type FROM users u LEFT JOIN accounts a ON a.id = u.account_id WHERE u.email = ?', email);
  const sun = user('sunrise@demo.example');
  const s = samples.register(db, sun, {
    full_name: 'Asha Kulkarni', gender: 'Female', dob: '1990-02-11', mobile: '+91 98220 41234',
    city: 'Pune', state: 'Maharashtra', pincode: '411001', consent_testing: 'yes', consent_method: 'Signed form',
    partner_ref: 'SUN-REF-77', test_id: String(db.get("SELECT id FROM tests WHERE code = 'MDPFIT'").id), collected_now: 'yes', collector: 'Raj',
  }).sample;
  return { db, s, lab: user('lab@demo.example') };
}

test('only the right ID and mobile digits open the sample', () => {
  const { db, s } = fresh();
  assert.equal(track.lookup(db, s.sample_id, '9999'), null);
  assert.equal(track.lookup(db, 'MDP00019999999', '1234'), null);
  assert.equal(track.lookup(db, s.sample_id, '123'), null);
  const v = track.lookup(db, ` ${s.sample_id.toLowerCase()} `, '1234');
  assert.equal(v.firstName, 'Asha');
  assert.equal(v.steps.find((x) => x.state === 'now').label, 'Sample collected');
  assert.equal(v.eta.kind, 'estimate');
  const text = JSON.stringify(v);
  for (const secret of ['Kulkarni', '98220', 'SUN-REF-77', 'Sunrise', 'Pune']) assert.ok(!text.includes(secret), `${secret} is not shown`);
});

test('the expected date follows the lab TAT once the lab has the sample', () => {
  const { db, s, lab } = fresh();
  tracking.receive(db, lab, s.sample_id, { condition: 'Acceptable' });
  const row = db.get('SELECT tat_due_at FROM samples WHERE id = ?', s.id);
  const v = track.lookup(db, s.sample_id, '1234');
  assert.equal(v.eta.kind, 'due');
  assert.equal(v.steps.find((x) => x.state === 'now').label, 'Received at our lab');
  assert.ok(v.steps.slice(0, 2).every((x) => x.state === 'done' && x.date));
  const later = track.lookup(db, s.sample_id, '1234', new Date(new Date(row.tat_due_at).getTime() + 86400000));
  assert.equal(later.eta.kind, 'late');
  db.run("UPDATE samples SET status = 'IN_TRANSIT_TO_PARTNER' WHERE id = ?", s.id);
  const testing = track.lookup(db, s.sample_id, '1234');
  assert.equal(testing.now, 'Your sample is being tested.');
  assert.ok(!/partner/i.test(JSON.stringify(testing)), 'no partner lab wording');
});

test('the registration message carries the tracking link', () => {
  const { db, s } = fresh();
  const n1 = db.get("SELECT body FROM notifications WHERE code = 'N1' AND sample_pk = ?", s.id);
  assert.ok(n1.body.includes(`/track?id=${s.sample_id}`));
});

test('the public page works without sign-in and limits wrong guesses', async () => {
  const { db, s } = fresh();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lims-track-'));
  const server = createApp({ db, storage: storage.localAdapter(dir) }).server();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (id, m) => fetch(`${base}/track`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `id=${encodeURIComponent(id)}&m=${m}` });
  try {
    const page = await fetch(`${base}/track?id=${s.sample_id}`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), new RegExp(`value="${s.sample_id}"`));
    const ok = await post(s.sample_id, '1234');
    assert.equal(ok.status, 200);
    const body = await ok.text();
    assert.match(body, /Hello Asha/);
    assert.ok(!body.includes('Kulkarni'));
    for (let i = 0; i < 10; i++) assert.equal((await post(s.sample_id, '0000')).status, 404);
    assert.equal((await post(s.sample_id, '1234')).status, 429);
  } finally { server.close(); }
});

test('a client books a counselling time from the public page', async () => {
  const db = db_.open(':memory:');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lims-track-'));
  const store = storage.localAdapter(dir);
  seed.demo(db, store);
  const s = db.get("SELECT s.sample_id, p.mobile FROM samples s JOIN patients p ON p.id = s.patient_id WHERE s.status = 'REPORT_RELEASED' LIMIT 1");
  const m = s.mobile.slice(-4);
  const server = createApp({ db, storage: store }).server();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const form = (p, body) => fetch(`${base}${p}`, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  try {
    const page = await (await form('/track', `id=${s.sample_id}&m=${m}`)).text();
    assert.match(page, /Choose your counselling time/);
    const slot = page.match(/name="slot" value="(\d+)"/)[1];
    const res = await form('/track/book', `id=${s.sample_id}&m=${m}&slot=${slot}`);
    assert.equal(res.status, 200);
    assert.match(await res.text(), /Booked for/);
    assert.equal(db.get('SELECT status FROM counsellor_slots WHERE id = ?', Number(slot)).status, 'booked');
    assert.equal((await form('/track/book', `id=${s.sample_id}&m=0000&slot=${slot}`)).status, 404);
  } finally { server.close(); }
});
