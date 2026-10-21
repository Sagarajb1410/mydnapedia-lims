const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const db_ = require('../src/db');
const seed = require('../src/seed');
const samples = require('../src/samples');
const counselling = require('../src/counselling');
const form = require('../src/counselling-form');
const reports = require('../src/reports');
const doctext = require('../src/doctext');
const pdfwrite = require('../src/pdfwrite');

function memStorage() {
  const files = new Map();
  return { put(k, b) { files.set(k, Buffer.from(b)); return { key: k, sha256: require('node:crypto').createHash('sha256').update(b).digest('hex') }; }, get: (k) => files.get(k), exists: (k) => files.has(k), files };
}
function fresh() {
  const db = db_.open(':memory:');
  const store = memStorage();
  seed.demo(db, store);
  const user = (email) => db.get('SELECT u.*, a.type AS account_type FROM users u LEFT JOIN accounts a ON a.id = u.account_id WHERE u.email = ?', email);
  // The demo leaves one released, unbooked sample.
  const s = db.get("SELECT * FROM samples WHERE status = 'REPORT_RELEASED' ORDER BY id LIMIT 1");
  return { db, store, s, admin: user('admin@mydnapedia.example'), lab: user('lab@demo.example'), counsellor: user('counsellor@demo.example') };
}
const future = (h = '10:30') => `${new Date(Date.now() + 2 * 86400000 + 5.5 * 3600000).toISOString().slice(0, 10)}T${h}`;
const status = (db, s) => db.get('SELECT status FROM samples WHERE id = ?', s.id).status;
const FORM = {
  heightCm: '175', weightKg: '82', bp: '134/86', 'life.diet': 'Non-veg', 'life.actType': 'Walking', 'life.sleepHours': '6-7',
  'life.tobacco': 'Never', 'life.alcohol': 'Occasional', conditions: ['hypertension', 'gastric'], priorities: 'Lower LDL\nWalk daily',
};

// A minimal .docx (stored, uncompressed parts are enough for the reader).
function docx(text, props = {}) {
  const parts = {
    '[Content_Types].xml': '<?xml version="1.0"?><Types/>',
    'word/document.xml': `<w:document><w:body>${text.split('\n').map((l) => `<w:p><w:r><w:t>${l.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</w:t></w:r></w:p>`).join('')}</w:body></w:document>`,
    'docProps/core.xml': `<cp:coreProperties><dc:creator>${props.creator || 'MyDNAPedia'}</dc:creator></cp:coreProperties>`,
  };
  const local = [];
  const central = [];
  let offset = 0;
  for (const [name, content] of Object.entries(parts)) {
    const data = zlib.deflateRawSync(Buffer.from(content));
    const n = Buffer.from(name);
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(8, 8); h.writeUInt32LE(data.length, 18); h.writeUInt32LE(content.length, 22); h.writeUInt16LE(n.length, 26);
    local.push(h, n, data);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(8, 10); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(content.length, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(offset, 42);
    central.push(c, n);
    offset += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(parts).length, 8); end.writeUInt16LE(Object.keys(parts).length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, cd, end]);
}

test('Word reader returns text and file properties', () => {
  const d = doctext.extract(docx('Hello & welcome\nSecond line', { creator: 'Someone' }));
  assert.match(d.text, /Hello & welcome\nSecond line/);
  assert.equal(d.info.creator, 'Someone');
  assert.throws(() => doctext.extract(Buffer.from('nope')), /not a Word document/);
});

test('form keeps Report Studio keys and validates values', () => {
  const d = form.fromBody({ ...FORM, conditions: ['hypertension', 'made-up'] });
  assert.deepEqual(d.conditions, ['hypertension']);
  assert.equal(d.life.diet, 'Non-veg');
  assert.equal(form.bmi(d), 26.8);
  assert.throws(() => form.fromBody({ 'life.diet': 'Paleo' }), /listed option/);
  assert.throws(() => form.fromBody({ heightCm: '900' }), /between 50 and 250/);
  assert.throws(() => form.fromBody({ bp: '120-80' }), /like 120\/80/);
  assert.equal(form.missing(form.fromBody({})).length, 9);
  assert.deepEqual(form.missing(d), []);
});

test('full counselling flow to a delivered plan, with the Report Studio case file', () => {
  const { db, store, s, admin, counsellor } = fresh();
  assert.ok(s, 'demo has a released sample');
  assert.throws(() => counselling.schedule(db, counsellor, s.sample_id, { when: '2020-01-01T10:00', mode: 'Video call' }), /in the past/);
  assert.throws(() => counselling.schedule(db, counsellor, s.sample_id, { when: future(), mode: 'Video call', link: 'http://x' }), /https/);
  counselling.schedule(db, counsellor, s.sample_id, { when: future(), mode: 'Video call', link: 'https://meet.google.com/abc' });
  assert.equal(status(db, s), 'COUNSELLING_SCHEDULED');
  assert.ok(db.get("SELECT 1 FROM notifications WHERE code = 'N14' AND sample_pk = ? AND body LIKE '%meet.google.com/abc%'", s.id));

  // Rebooking cancels the earlier session.
  counselling.schedule(db, counsellor, s.sample_id, { when: future('16:00'), mode: 'Phone call' });
  assert.equal(db.get("SELECT COUNT(*) c FROM counselling_sessions WHERE sample_pk = ? AND status = 'cancelled'", s.id).c, 1);

  counselling.saveForm(db, counsellor, s.sample_id, { heightCm: '170' });
  assert.throws(() => counselling.saveForm(db, counsellor, s.sample_id, { heightCm: '170' }, { complete: true }), /Fill in before completing/);
  counselling.sessionOutcome(db, counsellor, s.sample_id, { outcome: 'done' });
  const p = db.get('SELECT * FROM patients WHERE id = ?', s.patient_id);
  const planFile = (extra = '') => ({ filename: 'plan.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', data: docx(`Personalised Action Plan\n${p.full_name}\nWalk daily and recheck lipids.\n${extra}`) });
  assert.throws(() => counselling.uploadPlan(db, store, counsellor, s.sample_id, planFile()), /Complete the counselling form/);
  counselling.saveForm(db, counsellor, s.sample_id, FORM, { complete: true });

  const cf = counselling.caseFile(db, counsellor, s.sample_id);
  assert.equal(cf.app, 'mdp-report-studio-case');
  assert.equal(cf.version, 1);
  assert.equal(cf.patient.name, p.full_name);
  assert.equal(cf.patient.sampleId, s.sample_id);
  assert.match(cf.patient.reportDate, /^\d{2}-[A-Z][a-z]{2}-\d{4} \d{2}:\d{2}$/);
  assert.match(cf.patient.dob, /^\d{2}\/\d{2}\/\d{4}$/);
  assert.ok(Number(cf.patient.age) > 0);
  assert.equal(cf.clinical, null);
  assert.equal(cf.form.life.diet, 'Non-veg');
  assert.deepEqual(cf.form.conditions, ['hypertension', 'gastric']);
  assert.equal(cf.form.counsellor, 'Counsellor Demo');
  assert.match(cf.form.sessionDate, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(cf.mail.when, /^\d{4}-\d{2}-\d{2}T16:00$/);

  const blocked = counselling.uploadPlan(db, store, counsellor, s.sample_id, planFile('Genotyped at Acme Genomics'));
  assert.equal(blocked.check.ok, false);
  assert.equal(status(db, s), 'COUNSELLING_DONE');
  const ok = counselling.uploadPlan(db, store, counsellor, s.sample_id, planFile());
  assert.equal(ok.check.ok, true, JSON.stringify(ok.check));
  assert.equal(status(db, s), 'ACTION_PLAN_DRAFTED');
  assert.throws(() => counselling.reviewPlan(db, store, counsellor, ok.id, { approve: true, pagesChecked: true }), /Only the admin/);
  assert.throws(() => counselling.deliver(db, store, counsellor, ok.id), /Only an approved/);
  counselling.reviewPlan(db, store, admin, ok.id, { approve: true, pagesChecked: true });
  counselling.deliver(db, store, counsellor, ok.id);
  assert.equal(status(db, s), 'DELIVERED');
  const mail = db.get("SELECT * FROM notifications WHERE code = 'N17' AND channel = 'email' AND sample_pk = ?", s.id);
  assert.match(mail.attachment_name, /_Action_Plan\.docx$/);
  assert.throws(() => counselling.closeCase(db, counsellor, s.sample_id), /Only the admin/);
  counselling.closeCase(db, admin, s.sample_id, 'All done');
  assert.equal(status(db, s), 'CLOSED');
});

test('a plan for another client is blocked, and a no-show returns the client to booking', () => {
  const { db, store, s, counsellor } = fresh();
  counselling.schedule(db, counsellor, s.sample_id, { when: future(), mode: 'In person' });
  counselling.sessionOutcome(db, counsellor, s.sample_id, { outcome: 'no_show' });
  assert.equal(status(db, s), 'REPORT_RELEASED');
  counselling.schedule(db, counsellor, s.sample_id, { when: future(), mode: 'In person' });
  counselling.sessionOutcome(db, counsellor, s.sample_id, { outcome: 'done' });
  counselling.saveForm(db, counsellor, s.sample_id, FORM, { complete: true });
  const r = counselling.uploadPlan(db, store, counsellor, s.sample_id, { filename: 'p.pdf', type: 'application/pdf', data: pdfwrite.write([['Action plan for Somebody Else', 'MDP00020269999 long enough text for checking']]) });
  assert.match(r.check.problems.join(), /neither this sample's ID/);
});

test('counsellors see only counselling-stage clients, their own or unassigned, and no source report of others', () => {
  const { db, s, admin, counsellor } = fresh();
  const list = (u) => db.all(`SELECT s.sample_id, s.status FROM samples s WHERE ${samples.scope(u).sql}`, ...samples.scope(u).params);
  const seen = list(counsellor);
  assert.ok(seen.length >= 1);
  assert.ok(seen.every((r) => counselling.STAGES.includes(r.status)));
  assert.throws(() => samples.load(db, counsellor, db.get("SELECT sample_id FROM samples WHERE status = 'REGISTERED' LIMIT 1").sample_id));
  // Another counsellor's client is hidden.
  const other = Number(db.run("INSERT INTO users (name, email, role, password_hash, must_change_password, created_at) VALUES ('Other', 'o@demo.example', 'counsellor', 'x', 0, ?)", new Date().toISOString()).lastInsertRowid);
  counselling.schedule(db, admin, s.sample_id, { when: future(), mode: 'Phone call', counsellorId: other });
  assert.ok(!list(counsellor).some((r) => r.sample_id === s.sample_id));
  const src = db.get("SELECT * FROM reports WHERE sample_pk = ? AND kind = 'source'", s.id);
  assert.equal(reports.canOpen(counsellor, src, db.get('SELECT * FROM samples WHERE id = ?', s.id)), false);
  assert.equal(reports.canOpen({ ...counsellor, id: other }, src, db.get('SELECT * FROM samples WHERE id = ?', s.id)), true);
});

test('counsellor availability: slots, staff booking, patient booking, rebooking frees the old slot', () => {
  const { db, s, admin, counsellor } = fresh();
  const day = new Date(Date.now() + 3 * 86400000 + 5.5 * 3600000).toISOString().slice(0, 10);
  const before = db.get("SELECT COUNT(*) AS n FROM counsellor_slots WHERE counsellor_id = ? AND status = 'open'", counsellor.id).n;
  const added = counselling.addSlots(db, counsellor, { dates: [day], from: '15:00', to: '17:00', minutes: '30', mode: 'Phone call' });
  assert.equal(added, 4);
  // Adding the same hours again adds nothing.
  assert.equal(counselling.addSlots(db, counsellor, { dates: [day], from: '15:00', to: '17:00', minutes: '30', mode: 'Phone call' }), 0);
  assert.throws(() => counselling.addSlots(db, counsellor, { dates: [day], from: '17:00', to: '15:00', minutes: '30', mode: 'Phone call' }), /start time/);
  const mine = db.all("SELECT * FROM counsellor_slots WHERE counsellor_id = ? AND status = 'open' AND starts_at >= ? ORDER BY starts_at", counsellor.id, new Date(`${day}T15:00:00+05:30`).toISOString()).slice(0, 4);
  assert.equal(db.get("SELECT COUNT(*) AS n FROM counsellor_slots WHERE counsellor_id = ? AND status = 'open'", counsellor.id).n, before + 4);

  // The patient sees open times and books one.
  const open = counselling.openSlots(db, s);
  assert.ok(open.some((x) => x.id === mine[0].id));
  const b = counselling.bookByPatient(db, s.sample_id, mine[0].id);
  assert.equal(b.when, mine[0].starts_at);
  assert.equal(status(db, s), 'COUNSELLING_SCHEDULED');
  assert.equal(db.get('SELECT status FROM counsellor_slots WHERE id = ?', mine[0].id).status, 'booked');
  assert.ok(!counselling.openSlots(db, s).some((x) => x.id === mine[0].id));

  // Moving to another time frees the first one.
  counselling.bookByPatient(db, s.sample_id, mine[1].id);
  assert.equal(db.get('SELECT status FROM counsellor_slots WHERE id = ?', mine[0].id).status, 'open');
  assert.equal(db.get('SELECT status FROM counsellor_slots WHERE id = ?', mine[1].id).status, 'booked');
  assert.equal(db.get("SELECT COUNT(*) AS n FROM counselling_sessions WHERE sample_pk = ? AND status = 'scheduled'", s.id).n, 1);

  // A booked time cannot be taken twice, and cannot be removed.
  const other = db.get("SELECT * FROM samples WHERE status = 'REPORT_RELEASED' AND id != ? LIMIT 1", s.id);
  if (other) assert.throws(() => counselling.schedule(db, admin, other.sample_id, { slotId: mine[1].id }), UserErrorLike);
  assert.throws(() => counselling.removeSlot(db, counsellor, mine[1].id), UserErrorLike);
  counselling.removeSlot(db, counsellor, mine[2].id);
  assert.equal(db.get('SELECT status FROM counsellor_slots WHERE id = ?', mine[2].id).status, 'removed');

  // Staff can book an open slot from the sample page too.
  counselling.schedule(db, admin, s.sample_id, { slotId: mine[3].id });
  assert.equal(db.get('SELECT status FROM counsellor_slots WHERE id = ?', mine[3].id).status, 'booked');
  assert.equal(db.get('SELECT status FROM counsellor_slots WHERE id = ?', mine[1].id).status, 'open');
});
const UserErrorLike = (e) => e.name === 'UserError' || e.constructor.name === 'UserError';
