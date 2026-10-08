// Registering many samples from an Excel sheet.
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const db_ = require('../src/db');
const seed = require('../src/seed');
const storage = require('../src/storage');
const xlsx = require('../src/xlsx');
const bulk = require('../src/bulk');
const billing = require('../src/billing');
const { createApp } = require('../src/web/app');

function fresh() {
  const db = db_.open(':memory:');
  seed.demo(db);
  const user = (email) => db.get('SELECT u.*, a.type AS account_type FROM users u LEFT JOIN accounts a ON a.id = u.account_id WHERE u.email = ?', email);
  return { db, sun: user('sunrise@demo.example'), admin: user('admin@mydnapedia.example'), sup: user('healthplus@demo.example') };
}

// Fills the template the way a person would: header row from the template, then rows.
function filled(db, user, rows) {
  const header = xlsx.read(bulk.template(db, user))[0];
  const cols = bulk.columns(user).map(([k]) => k);
  return { filename: 'samples.xlsx', data: xlsx.workbook([{ name: 'Samples', rows: [header, ...rows.map((r) => cols.map((k) => r[k] ?? ''))] }]) };
}
const row = (over = {}) => ({
  full_name: 'Meena Rao', gender: 'F', dob: '11/02/1990', mobile: '98220 11111', city: 'Pune', state: 'maharashtra', pincode: '411001',
  test: 'MDP Fitness', consent: 'Signed form', ...over,
});

test('dates in Indian order, ISO and Excel numbers are read', () => {
  assert.equal(bulk.parseDob('11/02/1990'), '1990-02-11');
  assert.equal(bulk.parseDob('1990-2-11'), '1990-02-11');
  assert.equal(bulk.parseDob('32874'), '1990-01-01');
  assert.equal(bulk.parseDob('31/02/1990'), '31/02/1990');
});

test('a franchise checks, then registers the good rows with credit billing', () => {
  const { db, sun } = fresh();
  const before = billing.balance(db, sun.account_id);
  const rows = bulk.check(db, sun, filled(db, sun, [
    row(), row({ full_name: 'Ravi Shah', mobile: '9822022222', collected_by: 'Raj' }),
    row({ full_name: 'X', test: 'Unknown test' }), row(),
  ]));
  assert.deepEqual(rows.map((r) => r.errors.length > 0), [false, false, true, true]);
  assert.match(rows[2].errors.join(' '), /Unknown test/);
  assert.match(rows[3].errors.join(' '), /row 2/);
  const token = bulk.hold(sun, rows);
  const out = bulk.confirm(db, sun, token);
  assert.equal(out.sampleIds.length, 2);
  assert.equal(out.skipped, 2);
  const statuses = out.sampleIds.map((id) => db.get('SELECT status FROM samples WHERE sample_id = ?', id).status);
  assert.deepEqual(statuses, ['REGISTERED', 'COLLECTED']);
  const late = bulk.check(db, sun, filled(db, sun, [
    row({ full_name: 'Late One', mobile: '9822055555', collected_by: 'Raj', collected_on: new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10) }),
    row({ full_name: 'Late Two', mobile: '9822066666', collected_by: 'Raj', collected_on: '01/01/2020' }),
  ]));
  assert.equal(late[0].errors.length, 0);
  assert.match(late[1].errors.join(' '), /30 days/);
  const [lateId] = bulk.confirm(db, sun, bulk.hold(sun, late)).sampleIds;
  const lateRow = db.get('SELECT collected_at FROM samples WHERE sample_id = ?', lateId);
  assert.ok(Date.now() - new Date(lateRow.collected_at) > 86400000);
  assert.ok(billing.balance(db, sun.account_id) < before);
  assert.throws(() => bulk.confirm(db, sun, token), /expired/);
  // The same rows again are now repeats.
  const again = bulk.check(db, sun, filled(db, sun, [row()]));
  assert.match(again[0].errors.join(' '), /last 90 days/);
});

test('the central lab needs payment; suppliers need their price', () => {
  const { db, admin, sup } = fresh();
  const a = bulk.check(db, admin, filled(db, admin, [row(), row({ full_name: 'Paid One', mobile: '9822033333', payment: 'upi' })]));
  assert.match(a[0].errors.join(' '), /Payment/);
  assert.equal(a[1].errors.length, 0);
  const s = bulk.check(db, sup, filled(db, sup, [row({ patient_price: '9,000', gst: '18' }), row({ full_name: 'No Price', mobile: '9822044444', gst: '18' })]));
  assert.equal(s[0].errors.length, 0);
  assert.ok(s[1].errors.length);
  assert.throws(() => bulk.check(db, sup, { filename: 'x.xlsx', data: xlsx.workbook([{ name: 'S', rows: [['Name']] }]) }), /Missing columns/);
  assert.throws(() => bulk.check(db, sup, { filename: 'x.xlsx', data: Buffer.from('not excel') }), /not an Excel/);
});

test('upload pages and the labels sheet work', async () => {
  const { db, sun } = fresh();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lims-bulk-'));
  const server = createApp({ db, storage: storage.localAdapter(dir) }).server();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const login = await fetch(`${base}/login`, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'email=sunrise%40demo.example&password=test1234' });
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const get = (p) => fetch(base + p, { headers: { cookie } });
    assert.match(await (await get('/samples/bulk')).text(), /Download the Excel template/);
    const tpl = await get('/samples/bulk/template');
    assert.equal(tpl.status, 200);
    assert.match(xlsx.read(Buffer.from(await tpl.arrayBuffer()))[0][0], /Patient full name/);
    const fd = new FormData();
    const f = filled(db, sun, [row(), row({ full_name: 'Ravi Shah', mobile: '9822022222' })]);
    fd.append('file', new Blob([f.data]), 'samples.xlsx');
    const check = await (await fetch(`${base}/samples/bulk`, { method: 'POST', headers: { cookie }, body: fd })).text();
    assert.match(check, /2 of 2 rows are ready/);
    const token = check.match(/name="token" value="([0-9a-f]+)"/)[1];
    const done = await (await fetch(`${base}/samples/bulk/confirm`, { method: 'POST', headers: { cookie, 'Content-Type': 'application/x-www-form-urlencoded' }, body: `token=${token}` })).text();
    assert.match(done, /2 samples registered/);
    const ids = [...done.matchAll(/href="\/samples\/(MDP[\w-]+)"/g)].map((m) => m[1]);
    assert.equal(ids.length, 2);
    const labels = await (await get(`/samples/labels?ids=${ids.join(',')}`)).text();
    assert.equal((labels.match(/class="label"/g) || []).length, 4);
  } finally { server.close(); }
});
