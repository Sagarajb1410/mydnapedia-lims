const test = require('node:test');
const assert = require('node:assert/strict');
const db_ = require('../src/db');
const seed = require('../src/seed');
const samples = require('../src/samples');
const tracking = require('../src/tracking');
const receipts = require('../src/receipts');
const { istDate } = require('../src/util');

function fresh() {
  const db = db_.open(':memory:');
  seed.demo(db);
  const user = (email) => db.get('SELECT u.*, a.type AS account_type FROM users u LEFT JOIN accounts a ON a.id = u.account_id WHERE u.email = ?', email);
  const reg = (u, code, over = {}) => samples.register(db, u, {
    full_name: 'Track Person', gender: 'Male', dob: '1985-02-11', mobile: `98765${String(Math.floor(Math.random() * 1e5)).padStart(5, '0')}`,
    city: 'Pune', state: 'Maharashtra', pincode: '411001', consent_testing: 'yes', consent_method: 'Signed form',
    test_id: String(db.get('SELECT id FROM tests WHERE code = ?', code).id), ...over,
  }).sample;
  return { db, user, reg, admin: user('admin@mydnapedia.example'), lab: user('lab@demo.example'), sun: user('sunrise@demo.example') };
}
const status = (db, s) => db.get('SELECT status FROM samples WHERE id = ?', s.id).status;
const pickup = { pickupDate: istDate(), window: tracking.WINDOWS[1] };

test('partner sample goes pickup, transit, receipt and starts the TAT clock', () => {
  const { db, admin, lab, sun, reg } = fresh();
  const s = reg(sun, 'MDPFIT', { collected_now: 'yes', collector: 'Raj' });
  assert.ok(tracking.pendingPickups(db).some((x) => x.id === s.id));
  assert.throws(() => tracking.scheduleLeg1(db, lab, { ...pickup, samplePks: [s.id] }), /admin/);
  const { shipmentId, shipmentNo } = tracking.scheduleLeg1(db, admin, { ...pickup, samplePks: [s.id] });
  assert.equal(status(db, s), 'PICKUP_SCHEDULED');
  assert.ok(!tracking.pendingPickups(db).some((x) => x.id === s.id));
  const n7 = db.get("SELECT * FROM notifications WHERE code = 'N7' AND body LIKE ?", `%${shipmentNo}%`);
  assert.ok(n7, 'courier message queued');
  assert.ok(!n7.body.includes('Track Person') && !n7.body.includes('Fitness'), 'courier message has no patient or test name');
  tracking.markPickedUp(db, lab, shipmentId);
  assert.equal(status(db, s), 'IN_TRANSIT_TO_LAB');
  const r = tracking.receive(db, lab, s.sample_id.toLowerCase(), { condition: 'Acceptable' });
  assert.equal(r.status, 'RECEIVED_AT_LAB');
  const row = db.get('SELECT * FROM samples WHERE id = ?', s.id);
  const days = (new Date(row.tat_due_at) - new Date(row.received_at)) / 86400000;
  assert.equal(days, 21);
  assert.equal(db.get('SELECT status FROM shipments WHERE id = ?', shipmentId).status, 'delivered');
  assert.throws(() => tracking.receive(db, lab, s.sample_id, {}), /cannot be received/);
});

test('pickup cannot be marked picked up while a sample is not collected', () => {
  const { db, admin, lab, sun, reg } = fresh();
  const s = reg(sun, 'MDPSKIN');
  const { shipmentId } = tracking.scheduleLeg1(db, admin, { ...pickup, samplePks: [s.id] });
  assert.throws(() => tracking.markPickedUp(db, lab, shipmentId), /not marked collected/);
  tracking.cancelShipment(db, admin, shipmentId, 'Courier did not come');
  assert.equal(status(db, s), 'REGISTERED');
  assert.ok(tracking.pendingPickups(db).some((x) => x.id === s.id));
});

test('rejected sample gets a free linked recollection', () => {
  const { db, lab, reg } = fresh();
  const s = reg(lab, 'MDP360P', { direct: { paymentMode: 'Cash' }, collected_now: 'yes', collector: 'Lab' });
  const r = tracking.receive(db, lab, s.sample_id, { condition: 'Insufficient' });
  assert.equal(r.status, 'REJECTED');
  const newId = tracking.recollect(db, lab, s.sample_id);
  assert.equal(status(db, s), 'RECOLLECTION_REQUESTED');
  const n = db.get('SELECT * FROM samples WHERE sample_id = ?', newId);
  assert.equal(n.recollection_of, s.id);
  assert.equal(n.status, 'REGISTERED');
  assert.equal(db.get('SELECT net_paise FROM bills WHERE sample_pk = ?', n.id).net_paise, 0);
  assert.throws(() => tracking.recollect(db, lab, s.sample_id), /Only a rejected/);
});

test('partner-lab test goes onward; in-house test starts processing', () => {
  const { db, lab, reg } = fresh();
  const a = reg(lab, 'MDPCARD', { direct: { paymentMode: 'UPI' }, collected_now: 'yes', collector: 'Lab' });
  const b = reg(lab, 'DEMOIH', { direct: { paymentMode: 'UPI' }, collected_now: 'yes', collector: 'Lab' });
  tracking.receive(db, lab, a.sample_id, {});
  tracking.receive(db, lab, b.sample_id, {});
  assert.throws(() => tracking.startInHouse(db, lab, a.sample_id), /partner lab/);
  tracking.startInHouse(db, lab, b.sample_id);
  assert.equal(status(db, b), 'IN_HOUSE_PROCESSING');
  const { shipmentId, shipmentNo } = tracking.scheduleLeg2(db, lab, { ...pickup, samplePks: [a.id] });
  assert.equal(status(db, a), 'DISPATCH_TO_PARTNER_SCHEDULED');
  const sh = tracking.shipment(db, shipmentId);
  assert.equal(sh.destination, 'Partner lab');
  tracking.markPickedUp(db, lab, shipmentId);
  assert.equal(status(db, a), 'IN_TRANSIT_TO_PARTNER');
  assert.throws(() => tracking.partnerReceived(db, lab, a.sample_id, { receivedOn: '2999-01-01' }), /future/);
  tracking.partnerReceived(db, lab, a.sample_id, { receivedOn: istDate(), ref: 'X1' });
  assert.equal(status(db, a), 'RECEIVED_AT_PARTNER');
  assert.equal(tracking.shipment(db, shipmentId).status, 'delivered');
  assert.ok(shipmentNo.startsWith('SH'));
});

test('hold pauses the TAT clock and release moves the due date', () => {
  const { db, lab, reg } = fresh();
  const s = reg(lab, 'MDPFIT', { direct: { paymentMode: 'UPI' }, collected_now: 'yes', collector: 'Lab' });
  tracking.receive(db, lab, s.sample_id, {});
  const due = db.get('SELECT tat_due_at FROM samples WHERE id = ?', s.id).tat_due_at;
  assert.throws(() => tracking.hold(db, lab, s.sample_id, ''), /reason/);
  tracking.hold(db, lab, s.sample_id, 'Consent query');
  // Pretend the hold started two days ago.
  db.run('UPDATE samples SET hold_started_at = ? WHERE id = ?', new Date(Date.now() - 2 * 86400000).toISOString(), s.id);
  assert.equal(tracking.tatState(db.get('SELECT * FROM samples WHERE id = ?', s.id)).paused, true);
  tracking.release(db, lab, s.sample_id);
  const after = db.get('SELECT * FROM samples WHERE id = ?', s.id);
  assert.equal(after.status, 'RECEIVED_AT_LAB');
  const moved = (new Date(after.tat_due_at) - new Date(due)) / 86400000;
  assert.ok(moved > 1.99 && moved < 2.01, `moved ${moved}`);
});

test('TAT alerts go once per level', () => {
  const { db } = fresh();
  db.run("UPDATE samples SET tat_warned = NULL");
  const first = tracking.tatAlerts(db);
  assert.ok(first >= 2, 'demo has one amber and one red sample');
  assert.equal(tracking.tatAlerts(db), 0);
});

test('the partner lab is never named in code-facing text', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const dir = path.join(__dirname, '..', 'src');
  const files = fs.readdirSync(dir, { recursive: true }).filter((f) => f.endsWith('.js'));
  for (const f of files) assert.ok(!/\bMMG\b/i.test(fs.readFileSync(path.join(dir, f), 'utf8')), f);
});

test('receipt acknowledgement lists the day\'s accepted and rejected samples for the partner', () => {
  const { db, lab, sun, user, reg } = fresh();
  const a = reg(sun, 'MDPFIT', { collected_now: 'yes', collector: 'Raj' });
  const b = reg(sun, 'MDPSKIN', { collected_now: 'yes', collector: 'Raj' });
  tracking.receive(db, lab, a.sample_id, { condition: 'Acceptable' });
  tracking.receive(db, lab, b.sample_id, { condition: 'Leaked' });
  const day = istDate();
  const ack = receipts.forDay(db, sun, sun.account_id, day);
  assert.match(ack.number, /^ACK-.+-\d{8}$/);
  const mine = ack.rows.filter((r) => [a.sample_id, b.sample_id].includes(r.sample_id));
  assert.equal(mine.length, 2);
  assert.ok(mine.find((r) => r.sample_id === a.sample_id).accepted);
  assert.match(mine.find((r) => r.sample_id === b.sample_id).reject_reason, /Leaked/);
  assert.ok(mine.every((r) => r.received_by), 'who received it is shown');
  assert.ok(receipts.list(db, sun).some((r) => r.day === day && r.account.id === sun.account_id));
  assert.throws(() => receipts.forDay(db, user('carewell@demo.example'), sun.account_id, day), /not found/);
  assert.throws(() => receipts.forDay(db, sun, sun.account_id, '1999-01-01'), /Nothing was received/);
  const mail = db.get("SELECT body FROM notifications WHERE code = 'N8' AND channel = 'email' AND account_id = ? AND body LIKE ?", sun.account_id, `%${a.sample_id}%`);
  assert.match(mail.body, new RegExp(`/receipts/${sun.account_id}/${day}`));
});

test('one-click steps from the Samples list: collected, courier, reached lab', () => {
  const quick = require('../src/quick');
  const { db, admin, lab, sun, reg } = fresh();
  const a = reg(sun, 'MDPFIT');
  const b = reg(sun, 'MDPSKIN');
  const row = (s) => db.get('SELECT s.*, a.type AS account_type FROM samples s JOIN accounts a ON a.id = s.account_id WHERE s.id = ?', s.id);
  assert.equal(quick.nextStep(sun, row(a)), 'collect');
  assert.deepEqual(quick.run(db, sun, 'collect', [a.sample_id, b.sample_id]).done.length, 2);
  assert.equal(quick.nextStep(admin, row(a)), 'courier');
  assert.equal(quick.nextStep(lab, row(a)), 'receive');
  assert.throws(() => quick.run(db, lab, 'courier', [a.sample_id]), /admin/);
  const c = quick.run(db, admin, 'courier', [a.sample_id, b.sample_id]);
  assert.equal(c.done.length, 2);
  assert.equal(c.messages.length, 1, 'one courier message for one location');
  assert.match(quick.openMessage(db, admin, c.messages[0]), /^https:\/\/wa\.me\//);
  assert.equal(db.get('SELECT status FROM notifications WHERE id = ?', c.messages[0]).status, 'sent');
  const r = quick.run(db, lab, 'receive', [a.sample_id, b.sample_id, 'NOPE']);
  assert.equal(r.done.length, 2);
  assert.equal(r.skipped.length, 1);
  assert.equal(status(db, a), 'RECEIVED_AT_LAB');
  assert.ok(['9 am to 12 noon', '12 noon to 3 pm', '3 pm to 6 pm'].includes(quick.nextPickup().window));
});
