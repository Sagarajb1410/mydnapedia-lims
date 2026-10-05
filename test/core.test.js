const test = require('node:test');
const assert = require('node:assert/strict');
const db_ = require('../src/db');
const seed = require('../src/seed');
const billing = require('../src/billing');
const samples = require('../src/samples');
const barcode = require('../src/barcode');
const { toPaise, rupees, istDate } = require('../src/util');

function fresh() {
  const db = db_.open(':memory:');
  seed.demo(db);
  const user = (email) => db.get('SELECT u.*, a.type AS account_type FROM users u LEFT JOIN accounts a ON a.id = u.account_id WHERE u.email = ?', email);
  return { db, user };
}

const patient = (over = {}) => ({
  full_name: 'Test Person', gender: 'Female', dob: '1990-05-17', mobile: '9876500001', email: 't@demo.example',
  city: 'Pune', state: 'Maharashtra', pincode: '411001', consent_testing: 'yes', consent_method: 'Signed form', ...over,
});

test('money helpers', () => {
  assert.equal(toPaise('7,000'), 700000);
  assert.equal(toPaise('12.5'), 1250);
  assert.throws(() => toPaise('abc'));
  assert.equal(rupees(-150000), '-₹1,500');
  assert.equal(rupees(1234567), '₹12,345.67');
});

test('Code 128 patterns are all 11 modules wide and distinct', () => {
  const p = barcode.PATTERNS;
  assert.equal(p.length, 107);
  p.slice(0, 106).forEach((x, i) => assert.equal([...x].reduce((a, b) => a + Number(b), 0), 11, `pattern ${i}`));
  assert.equal(new Set(p).size, 107);
  // Known checksum: "PJJ123C" in set B has check value 55: (104 + 48 + 42*2 + 42*3 + 17*4 + 18*5 + 19*6 + 35*7) mod 103.
  const v = barcode.encode('PJJ123C');
  assert.equal(v.at(-2), 55);
  assert.match(barcode.svg('MDP26-000001'), /^<svg/);
});

test('partner registration deducts the partner price and is never blocked', () => {
  const { db, user } = fresh();
  const care = user('carewell@demo.example');
  const fit = db.get("SELECT id FROM tests WHERE code = 'MDPFIT'");
  const before = billing.balance(db, care.account_id);
  assert.ok(before < 0, 'demo leaves CareWell below zero');
  const { sample } = samples.register(db, care, { ...patient(), test_id: String(fit.id) });
  assert.match(sample.sample_id, /^MDP\d{2}-\d{6}$/);
  assert.equal(billing.balance(db, care.account_id), before - 799900);
  const bill = db.get('SELECT * FROM bills WHERE sample_pk = ?', sample.id);
  assert.equal(bill.price_list, 'partner');
  assert.equal(bill.net_paise, 799900);
});

test('low balance reminder goes once per day per partner', () => {
  const { db } = fresh();
  const tomorrow = '2999-01-01';
  const first = billing.lowBalanceReminders(db, tomorrow);
  const again = billing.lowBalanceReminders(db, tomorrow);
  assert.ok(first >= 1);
  assert.equal(again, 0);
});

test('supplier transfer price never changes with the supplier discount', () => {
  const { db, user } = fresh();
  const hp = user('healthplus@demo.example');
  const fit = db.get("SELECT id FROM tests WHERE code = 'MDPFIT'");
  for (const [price, disc] of [[1500000, 0], [1500000, 750000], [900000, 400000]]) {
    const { sample } = samples.register(db, hp, { ...patient({ mobile: `98765${String(price + disc).slice(0, 5)}` }), test_id: String(fit.id), supplier: { patientPricePaise: price, discountPaise: disc, gstRateBp: 1800 } });
    const bill = db.get('SELECT * FROM bills WHERE sample_pk = ?', sample.id);
    const sb = db.get('SELECT * FROM supplier_bills WHERE sample_pk = ?', sample.id);
    assert.equal(bill.net_paise, 699900);
    assert.equal(sb.net_paise, price - disc);
    assert.equal(sb.gst_paise, Math.round((price - disc) * 0.18));
  }
  assert.equal(db.get('SELECT COUNT(*) c FROM ledger_entries WHERE account_id = ?', hp.account_id).c, 0);
});

test('direct registration needs payment mode and only admin can discount', () => {
  const { db, user } = fresh();
  const lab = user('lab@demo.example');
  const t = db.get("SELECT id FROM tests WHERE code = 'MDPSKIN'");
  assert.throws(() => samples.register(db, lab, { ...patient(), test_id: String(t.id) }), /how the patient paid/);
  assert.throws(() => samples.register(db, lab, { ...patient(), test_id: String(t.id), direct: { paymentMode: 'Cash', discountPaise: 100 } }), /Only an admin/);
  const { sample } = samples.register(db, lab, { ...patient(), test_id: String(t.id), direct: { paymentMode: 'Cash' } });
  assert.equal(db.get('SELECT net_paise FROM bills WHERE sample_pk = ?', sample.id).net_paise, 999900);
});

test('duplicate within 90 days asks for a reason', () => {
  const { db, user } = fresh();
  const sun = user('sunrise@demo.example');
  const t = db.get("SELECT id FROM tests WHERE code = 'MDPFIT'");
  samples.register(db, sun, { ...patient(), test_id: String(t.id) });
  const second = samples.register(db, sun, { ...patient(), test_id: String(t.id) });
  assert.ok(second.duplicate);
  const third = samples.register(db, sun, { ...patient(), test_id: String(t.id), duplicate_reason: 'Re-test requested by doctor' });
  assert.ok(third.sample);
});

test('validation catches bad dates, mobiles and missing consent', () => {
  const { db, user } = fresh();
  const sun = user('sunrise@demo.example');
  const t = String(db.get("SELECT id FROM tests WHERE code = 'MDPFIT'").id);
  assert.throws(() => samples.register(db, sun, { ...patient({ dob: istDate() }), test_id: t }), /future/);
  assert.throws(() => samples.register(db, sun, { ...patient({ mobile: '12345' }), test_id: t }), /mobile/);
  assert.throws(() => samples.register(db, sun, { ...patient({ consent_testing: '' }), test_id: t }), /consent/);
});

test('partners only see their own samples', () => {
  const { db, user } = fresh();
  const sun = user('sunrise@demo.example');
  const careSample = db.get("SELECT s.sample_id FROM samples s JOIN accounts a ON a.id = s.account_id WHERE a.code = 'CAREBLR' LIMIT 1");
  assert.throws(() => samples.load(db, sun, careSample.sample_id), /not found/);
});

test('collection is a separate status and cancellation before receipt refunds credit in full', () => {
  const { db, user } = fresh();
  const sun = user('sunrise@demo.example');
  const t = db.get("SELECT id FROM tests WHERE code = 'MDPSKIN'");
  const { sample } = samples.register(db, sun, { ...patient({ mobile: '9876500077' }), test_id: String(t.id) });
  assert.equal(sample.status, 'REGISTERED');
  samples.collect(db, sun, sample.sample_id, { collector: 'Raj' });
  assert.equal(samples.load(db, sun, sample.sample_id).status, 'COLLECTED');
  const before = billing.balance(db, sun.account_id);
  samples.cancel(db, sun, sample.sample_id, { reason: 'Patient unwell' });
  assert.equal(billing.balance(db, sun.account_id), before + 599900);
  assert.equal(db.get('SELECT status FROM bills WHERE sample_pk = ?', sample.id).status, 'reversed');
});

test('recharge approval adds credit; ledger and audit cannot be edited', () => {
  const { db, user } = fresh();
  const root = user('admin@mydnapedia.example');
  const care = user('carewell@demo.example');
  const req = db.get("SELECT id FROM recharge_requests WHERE status = 'submitted'");
  const before = billing.balance(db, care.account_id);
  billing.reviewRecharge(db, root, req.id, true);
  assert.equal(billing.balance(db, care.account_id), before + 3000000);
  assert.throws(() => billing.reviewRecharge(db, root, req.id, true), /already been reviewed/);
  assert.throws(() => db.run('UPDATE ledger_entries SET amount_paise = 0'), /cannot be changed/);
  assert.throws(() => db.run('DELETE FROM audit_log'), /append-only/);
});

test('the partner lab is never named in stored messages', () => {
  const { db } = fresh();
  const rows = db.all('SELECT body, subject FROM notifications');
  for (const r of rows) assert.doesNotMatch(`${r.subject} ${r.body}`, /MMG/i);
});
