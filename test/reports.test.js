const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const db_ = require('../src/db');
const seed = require('../src/seed');
const samples = require('../src/samples');
const tracking = require('../src/tracking');
const reports = require('../src/reports');
const pdftext = require('../src/pdftext');
const pdfwrite = require('../src/pdfwrite');
const { istDate } = require('../src/util');

function memStorage() {
  const files = new Map();
  return { put(k, b) { files.set(k, Buffer.from(b)); return { key: k, sha256: require('node:crypto').createHash('sha256').update(b).digest('hex') }; }, get: (k) => files.get(k), exists: (k) => files.has(k), files };
}

function fresh() {
  const db = db_.open(':memory:');
  const store = memStorage();
  seed.demo(db, store);
  const user = (email) => db.get('SELECT u.*, a.type AS account_type FROM users u LEFT JOIN accounts a ON a.id = u.account_id WHERE u.email = ?', email);
  return { db, store, admin: user('admin@mydnapedia.example'), lab: user('lab@demo.example'), counsellor: user('counsellor@demo.example') };
}

// A partner-lab sample taken to "received at partner lab".
function atPartner(db, lab) {
  const s = samples.register(db, lab, {
    full_name: 'Report Person', gender: 'Female', dob: '1990-01-01', mobile: '9876512345', email: 'r@demo.example', city: 'Pune', state: 'Maharashtra', pincode: '411001',
    consent_testing: 'yes', consent_method: 'Signed form', test_id: String(db.get("SELECT id FROM tests WHERE code = 'MDPFIT'").id),
    direct: { paymentMode: 'UPI' }, collected_now: 'yes', collector: 'Lab',
  }).sample;
  tracking.receive(db, lab, s.sample_id, {});
  const { shipmentId } = tracking.scheduleLeg2(db, lab, { samplePks: [s.id], pickupDate: istDate(), window: tracking.WINDOWS[0] });
  tracking.markPickedUp(db, lab, shipmentId);
  tracking.partnerReceived(db, lab, s.sample_id, { receivedOn: istDate(), ref: 'PLREF-7788' });
  return s;
}
const file = (lines) => ({ filename: 'x.pdf', data: pdfwrite.write([lines]) });

test('text extraction handles simple fonts, Type0 fonts with ToUnicode and compressed streams', () => {
  const simple = pdftext.extract(pdfwrite.write([['Hello (World) MDP26-000001'], ['Second page']]));
  assert.equal(simple.pages.length, 2);
  assert.match(simple.pages[0].text, /Hello \(World\) MDP26-000001/);
  const chrome = pdftext.extract(fs.readFileSync(path.join(__dirname, 'fixtures', 'chrome-cid.pdf')));
  const flat = chrome.pages.map((p) => p.text).join(' ').replace(/\s+/g, '');
  assert.ok(flat.includes('AcmeGenomicsLabs'), 'Type0 text decoded');
  assert.ok(flat.includes('naïvecafé') && flat.includes('₹'), 'non-ASCII via ToUnicode');
  assert.equal(chrome.pages[0].width, 596);
  assert.throws(() => pdftext.extract(Buffer.from('not a pdf')), /not a PDF/);
});

test('a CMap with ranges and arrays maps codes to text', () => {
  const { map, codeLen } = pdftext.parseCMap('1 begincodespacerange <0000> <FFFF> endcodespacerange 2 beginbfrange <0003> <0005> <0041> <0010> <0011> [<0061> <0062>] endbfrange 1 beginbfchar <0020> <00E9> endbfchar');
  assert.equal(codeLen, 2);
  assert.equal(map.get(4), 'B');
  assert.equal(map.get(0x11), 'b');
  assert.equal(map.get(0x20), 'é');
});

test('source, check, approval and release stop the TAT clock', () => {
  const { db, store, admin, lab, counsellor } = fresh();
  const s = atPartner(db, lab);
  assert.throws(() => reports.uploadBranded(db, store, lab, s.sample_id, file([s.sample_id])), /once the partner lab report is in/);
  reports.uploadSource(db, store, lab, s.sample_id, file(['Acme Genomics partner report', 'PLREF-7788']));
  assert.equal(db.get('SELECT status FROM samples WHERE id = ?', s.id).status, 'PARTNER_REPORT_RECEIVED');

  const r = reports.uploadBranded(db, store, lab, s.sample_id, file(['MyDNAPedia', `Report Person  ${s.sample_id}`, 'Vitamin D: likely to need a higher intake of vitamin D']));
  assert.equal(r.check.ok, true, JSON.stringify(r.check));
  assert.equal(db.get('SELECT status FROM samples WHERE id = ?', s.id).status, 'REPORT_WHITE_LABELLED');
  assert.throws(() => reports.review(db, store, lab, r.id, { approve: true, pagesChecked: true }), /Only the admin/);
  assert.throws(() => reports.review(db, store, admin, r.id, { approve: true }), /every page/);
  assert.throws(() => reports.release(db, store, admin, r.id), /Only an approved/);
  reports.review(db, store, admin, r.id, { approve: true, pagesChecked: true });
  const rep = reports.report(db, r.id);
  assert.equal(reports.canOpen(counsellor, rep), false, 'counsellor sees only released reports');
  const out = reports.release(db, store, admin, r.id);
  assert.equal(out.tatMet, 1);
  const row = db.get('SELECT * FROM samples WHERE id = ?', s.id);
  assert.equal(row.status, 'REPORT_RELEASED');
  assert.ok(row.released_at);
  assert.ok(!tracking.tatBoard(db).some((x) => x.id === s.id), 'off the TAT board');
  assert.equal(reports.canOpen(counsellor, reports.report(db, r.id)), true);
  const mail = db.get("SELECT * FROM notifications WHERE code = 'N13' AND channel = 'email' AND sample_pk = ?", s.id);
  assert.equal(mail.attachment_key, rep.file_key);
});

test('the check blocks partner names, split names, metadata, the partner reference and a wrong sample ID', () => {
  const { db, store, lab } = fresh();
  const s = atPartner(db, lab);
  reports.uploadSource(db, store, lab, s.sample_id, file(['partner report']));
  const check = (lines, opts) => reports.checkReport(db, pdfwrite.write([lines], opts), db.get('SELECT * FROM samples WHERE id = ?', s.id));
  const ok = [`Report Person ${s.sample_id}`, 'Result text long enough to be a real report page for checking.'];
  assert.equal(check(ok).ok, true);
  assert.match(check([...ok, 'Tested by ACME   genomics']).problems.join(), /Acme Genomics/);
  assert.match(check([...ok, 'Ref PLREF-7788']).problems.join(), /partner lab's own reference/);
  assert.match(check(['Report Person MDP26-999999', ok[1]]).problems.join(), /does not show this sample's ID/);
  assert.match(check(ok, { author: 'AcmeGx' }).problems.join(), /file properties/);
  assert.match(check(ok, { producer: 'iText 5.5' }).problems.join(), /iText/);
  assert.match(check(['', '']).problems.join(), /No readable text/);
  // A blocked upload is stored but cannot be approved.
  const r = reports.uploadBranded(db, store, lab, s.sample_id, file([...ok, 'Acme Genomics Labs']));
  assert.equal(r.check.ok, false);
  assert.equal(reports.report(db, r.id).status, 'blocked');
  assert.equal(db.get('SELECT status FROM samples WHERE id = ?', s.id).status, 'PARTNER_REPORT_RECEIVED');
});

test('no partner names configured means nothing can pass', () => {
  const { db, store, lab } = fresh();
  db.run("UPDATE settings SET value = '' WHERE key = 'leakTerms'");
  const s = atPartner(db, lab);
  reports.uploadSource(db, store, lab, s.sample_id, file(['partner report']));
  const r = reports.uploadBranded(db, store, lab, s.sample_id, file([`Report Person ${s.sample_id}`, 'Result text long enough to be a real report page.']));
  assert.match(r.check.problems.join(), /No partner names are set up/);
});

test('a report sent back returns the sample for a new upload, and release re-checks the stored file', () => {
  const { db, store, admin, lab } = fresh();
  const s = atPartner(db, lab);
  reports.uploadSource(db, store, lab, s.sample_id, file(['partner report']));
  const good = [`Report Person ${s.sample_id}`, 'Result text long enough to be a real report page.'];
  const r1 = reports.uploadBranded(db, store, lab, s.sample_id, file(good));
  assert.throws(() => reports.review(db, store, admin, r1.id, { approve: false }), /what needs fixing/);
  reports.review(db, store, admin, r1.id, { approve: false, note: 'Typo on page 1' });
  assert.equal(db.get('SELECT status FROM samples WHERE id = ?', s.id).status, 'PARTNER_REPORT_RECEIVED');
  const r2 = reports.uploadBranded(db, store, lab, s.sample_id, file(good));
  assert.equal(r2.version, 2);
  reports.review(db, store, admin, r2.id, { approve: true, pagesChecked: true });
  // A new partner name added after approval is caught at release.
  db.run("UPDATE settings SET value = value || ', Report Person' WHERE key = 'leakTerms'");
  assert.throws(() => reports.release(db, store, admin, r2.id), /Release blocked/);
  // Tampering with the stored file is caught too.
  db.run("UPDATE settings SET value = 'Acme Genomics' WHERE key = 'leakTerms'");
  const rep = reports.report(db, r2.id);
  store.files.set(rep.file_key, pdfwrite.write([[...good, 'changed']]));
  assert.throws(() => reports.release(db, store, admin, r2.id), /changed since it was checked/);
});

test('demo data shows a released, a pending and a blocked report', () => {
  const { db } = fresh();
  const st = new Set(db.all("SELECT status FROM reports WHERE kind = 'branded'").map((r) => r.status));
  assert.deepEqual([...st].sort(), ['blocked', 'pending', 'released']);
});
