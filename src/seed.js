// First-run setup and the Stage 1 dummy data. Every name, number and amount in
// the dummy data is invented.
const { nowIso, istDate, audit, setSetting } = require('./util');
const auth = require('./auth');
const admin = require('./admin');
const billing = require('./billing');
const tracking = require('./tracking');
const samples = require('./samples');
const reports = require('./reports');
const counselling = require('./counselling');
const pdfwrite = require('./pdfwrite');

const TESTS = [
  { code: 'MDP360P', name: 'MDP 360 Premium', short_name: 'MDP 360 PREMIUM', sample_type: 'Saliva', route: 'partner_lab', tat_days: 21, prices: [24999, 14999, 12999] },
  { code: 'MDPFIT', name: 'MDP Fitness', short_name: 'MDP FITNESS', sample_type: 'Saliva', route: 'partner_lab', tat_days: 21, prices: [12999, 7999, 6999] },
  { code: 'MDPSKIN', name: 'MDP Skin Health', short_name: 'MDP SKIN HEALTH', sample_type: 'Saliva', route: 'partner_lab', tat_days: 21, prices: [9999, 5999, 4999] },
  { code: 'MDPCARD', name: 'MDP Cardiac Health', short_name: 'MDP CARDIAC', sample_type: 'Saliva', route: 'partner_lab', tat_days: 21, prices: [14999, 8999, 7999] },
  { code: 'DEMOIH', name: 'Demo In-house Test (dummy)', short_name: 'DEMO IN-HOUSE', sample_type: 'Blood', route: 'in_house', tat_days: 7, prices: [2999, 1999, 1499] },
];

// Creates the main branch account and the first admin if the database is empty.
// Returns the admin's one-time password, or null if setup was already done.
function firstRun(db, { adminEmail = 'admin@mydnapedia.example', adminPassword } = {}) {
  if (db.get('SELECT id FROM users LIMIT 1')) return null;
  const pw = adminPassword || auth.tempPassword();
  db.tx(() => {
    db.run(`INSERT INTO accounts (type, code, name, legal_name, city, state, email, created_at)
            VALUES ('main', 'MAIN', 'MyDNAPedia Central Lab', 'TVASTI Health and Wellness Private Limited', 'Pune', 'Maharashtra', ?, ?)`,
      adminEmail, nowIso());
    const id = Number(db.run(`INSERT INTO users (name, email, role, password_hash, must_change_password, created_at)
            VALUES ('Admin', ?, 'admin', ?, ?, ?)`, adminEmail, auth.hashPassword(pw), adminPassword ? 0 : 1, nowIso()).lastInsertRowid);
    audit(db, id, 'first_run', 'system', null);
  });
  return pw;
}

const DEMO_PASSWORD = 'test1234';

function addUser(db, by, name, email, role, accountId) {
  const { id } = admin.createUser(db, by, { name, email, role, account_id: accountId });
  db.run('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?', auth.hashPassword(DEMO_PASSWORD), id);
  return db.get(`SELECT u.*, a.type AS account_type FROM users u LEFT JOIN accounts a ON a.id = u.account_id WHERE u.id = ?`, id);
}

const FIRST = ['Aarav', 'Priya', 'Rohan', 'Ananya', 'Vikram', 'Sneha', 'Arjun', 'Kavya', 'Rahul', 'Meera', 'Karan', 'Isha', 'Aditya', 'Pooja', 'Nikhil', 'Divya'];
const LAST = ['Sharma', 'Patel', 'Iyer', 'Reddy', 'Kulkarni', 'Nair', 'Gupta', 'Deshmukh', 'Joshi', 'Menon', 'Singh', 'Rao'];
const CITIES = [['Pune', 'Maharashtra', '411001'], ['Mumbai', 'Maharashtra', '400001'], ['Bengaluru', 'Karnataka', '560001'], ['Hyderabad', 'Telangana', '500001'], ['Chennai', 'Tamil Nadu', '600001']];

// Fills an empty database with invented accounts, users and samples so every
// screen can be tried. Safe to run only once.
function demo(db, store = null) {
  if (db.get("SELECT id FROM accounts WHERE code = 'SUNPUN'")) return false;
  firstRun(db, { adminPassword: DEMO_PASSWORD });
  const root = db.get("SELECT u.*, NULL AS account_type FROM users u WHERE role = 'admin' ORDER BY id LIMIT 1");
  setSetting(db, 'courierWhatsapp', '9800000000');
  setSetting(db, 'courierName', 'Demo Courier Services');
  // Invented company details so the demo invoices look complete.
  setSetting(db, 'companyAddress', 'Demo Office, 2nd Floor, Baner Road, Pune 411045');
  setSetting(db, 'companyGstin', '27AAACT0000D1Z5');
  setSetting(db, 'companyPan', 'AAACT0000D');
  setSetting(db, 'bankName', 'Demo Bank');
  setSetting(db, 'bankAccount', '000000000000');
  setSetting(db, 'bankIfsc', 'Baner, Pune & DEMO0000001');

  const day = istDate();
  for (const t of TESTS) {
    admin.saveTest(db, root, {
      ...t, tat_days: String(t.tat_days), effective_from: '2026-01-01',
      price_direct: String(t.prices[0]), price_partner: String(t.prices[1]), price_supplier: String(t.prices[2]),
    });
  }

  const acc = (input) => admin.saveAccount(db, root, input);
  const sun = acc({ type: 'partner', code: 'SUNPUN', name: 'Sunrise Franchise, Pune', contact_name: 'Raj Mehta', phone: '9811111111', email: 'sunrise@demo.example', city: 'Pune', state: 'Maharashtra', low_balance: '20000' });
  const care = acc({ type: 'partner', code: 'CAREBLR', name: 'CareWell Clinic, Bengaluru', contact_name: 'Dr Anil Kumar', phone: '9822222222', email: 'carewell@demo.example', city: 'Bengaluru', state: 'Karnataka', low_balance: '20000' });
  const hp = acc({ type: 'supplier', code: 'HPLUS', name: 'HealthPlus Diagnostics', legal_name: 'HealthPlus Diagnostics Private Limited', gstin: '27AABCH1234K1Z5', address: '12 MG Road, Pune 411001', contact_name: 'Sunita Rao', phone: '9833333333', email: 'healthplus@demo.example', city: 'Pune', state: 'Maharashtra' });

  const lab = addUser(db, root, 'Lab Staff Demo', 'lab@demo.example', 'lab', null);
  addUser(db, root, 'Counsellor Demo', 'counsellor@demo.example', 'counsellor', null);
  const sunUser = addUser(db, root, 'Raj Mehta', 'sunrise@demo.example', 'partner', sun);
  const careUser = addUser(db, root, 'Anil Kumar', 'carewell@demo.example', 'partner', care);
  const hpUser = addUser(db, root, 'Sunita Rao', 'healthplus@demo.example', 'partner', hp);

  billing.adjust(db, root, sun, 5000000, 'Opening recharge (dummy)', true);
  billing.adjust(db, root, care, 2500000, 'Opening recharge (dummy)', true);

  const tests = db.all('SELECT * FROM tests ORDER BY id');
  let n = 0;
  const person = () => {
    n++;
    const [city, state, pincode] = CITIES[n % CITIES.length];
    const year = 1960 + ((n * 7) % 40);
    return {
      full_name: `${FIRST[n % FIRST.length]} ${LAST[(n * 5) % LAST.length]}`,
      gender: n % 2 ? 'Male' : 'Female',
      dob: `${year}-${String((n % 12) + 1).padStart(2, '0')}-${String((n % 27) + 1).padStart(2, '0')}`,
      mobile: `98${String(70000000 + n * 1373).slice(0, 8)}`,
      email: `patient${n}@demo.example`,
      city, state, pincode,
      consent_testing: 'yes', consent_data_use: 'yes', consent_method: 'Signed form',
    };
  };
  const reg = (user, testIdx, extra = {}) => samples.register(db, user, { ...person(), test_id: String(tests[testIdx].id), ...extra }).sample;

  const s1 = reg(sunUser, 1, { collected_now: 'yes', collector: 'Raj Mehta' });
  reg(sunUser, 2);
  const s3 = reg(sunUser, 0, { collected_now: 'yes', collector: 'Raj Mehta' });
  const c1 = reg(careUser, 3, { collected_now: 'yes', collector: 'Nurse Leela' });
  reg(careUser, 0);
  const c3 = reg(careUser, 0, { collected_now: 'yes', collector: 'Nurse Leela' });
  const c4 = reg(careUser, 1, { collected_now: 'yes', collector: 'Nurse Leela' });
  const c5 = reg(careUser, 2, { collected_now: 'yes', collector: 'Nurse Leela' });
  reg(hpUser, 1, { supplier: { patientPricePaise: 1500000, discountPaise: 300000, gstRateBp: 1800 } });
  reg(hpUser, 2, { supplier: { patientPricePaise: 1200000, discountPaise: 0, gstRateBp: 1800 }, collected_now: 'yes', collector: 'Sunita Rao' });
  const d1 = reg(lab, 4, { direct: { paymentMode: 'UPI', paymentRef: 'UPI-DEMO-001' }, collected_now: 'yes', collector: 'Lab Staff Demo' });
  const cancelled = reg(lab, 1, { direct: { paymentMode: 'Cash' } });
  samples.cancel(db, lab, cancelled.sample_id, { reason: 'Patient changed their mind (dummy)' });

  // Tracking: one pickup booked, one delivered with a rejection, samples at each lab stage.
  setSetting(db, 'partnerLabAddress', 'Partner lab, Plot 4, Demo Industrial Area, Bengaluru 560100');
  const win = tracking.WINDOWS[0];
  tracking.scheduleLeg1(db, root, { samplePks: [s1.id, s3.id], pickupDate: day, window: win });
  const leg1 = tracking.scheduleLeg1(db, root, { samplePks: [c1.id, c3.id, c4.id, c5.id], pickupDate: day, window: win, awb: 'DEMO123456' });
  tracking.markPickedUp(db, lab, leg1.shipmentId);
  for (const x of [c1, c4, c5]) tracking.receive(db, lab, x.sample_id, { condition: 'Acceptable' });
  tracking.receive(db, lab, c3.sample_id, { condition: 'Leaked', note: 'Tube cap loose (dummy)' });
  tracking.receive(db, lab, d1.sample_id, { condition: 'Acceptable' });
  tracking.startInHouse(db, lab, d1.sample_id);
  const leg2 = tracking.scheduleLeg2(db, lab, { samplePks: [c4.id, c5.id], pickupDate: day, window: win });
  tracking.markPickedUp(db, lab, leg2.shipmentId);
  tracking.partnerReceived(db, lab, c5.sample_id, { receivedOn: day, ref: 'PL-DEMO-0042' });
  // Pretend two samples arrived weeks ago so the TAT board shows a warning and an overdue case.
  const ago = (days) => new Date(Date.now() - days * 86400000).toISOString();
  db.run('UPDATE samples SET received_at = ?, tat_due_at = ? WHERE id = ?', ago(17), ago(-4), c4.id);
  db.run('UPDATE samples SET received_at = ?, tat_due_at = ? WHERE id = ?', ago(23), ago(2), c5.id);

  // Reports (needs file storage): one fully released, one waiting for approval,
  // one blocked because the partner name was left in. "Acme Genomics" is the
  // invented partner lab name used only in the demo data.
  setSetting(db, 'leakTerms', 'Acme Genomics, AcmeGx');
  if (store) {
    const pdf = (s, branded, leak) => {
      const p = db.get('SELECT * FROM patients WHERE id = ?', s.patient_id);
      const t = db.get('SELECT * FROM tests WHERE id = ?', s.test_id);
      const head = branded
        ? [{ text: 'MyDNAPedia', size: 20, bold: true }, { text: t.name, size: 14 }, `Name: ${p.full_name}    Sample ID: ${s.sample_id}`, `Report date: ${day}`]
        : t.route === 'in_house'
          ? [{ text: 'Central lab in-house result (dummy)', size: 16, bold: true }, `Name: ${p.full_name}    Sample ID: ${s.sample_id}`]
          : [{ text: 'Acme Genomics Labs (dummy partner lab)', size: 16, bold: true }, `Name: ${p.full_name}    Sample ID: AGX-${s.id}9917`];
      const body = ['', { text: 'Your Genetic Result', bold: true }, 'Vitamin D: Likely to need a higher intake', 'Caffeine metabolism: Normal', 'LDL cholesterol: Slightly increased risk', '', 'Dummy report for the test version. Not a real result.'];
      const foot = leak ? ['', 'Analysed by Acme Genomics Labs, Bengaluru'] : ['', 'Know Your DNA - Make Better Choices - Live Healthier', 'A Unit of TVASTI Health and Wellness Private Limited'];
      return { filename: branded ? `${s.sample_id}.pdf` : 'partner-report.pdf', type: 'application/pdf', data: pdfwrite.write([[...head, ...body], foot], { title: t.name, author: branded ? 'MyDNAPedia' : 'Acme Genomics' }) };
    };
    const releaseFull = (x) => {
      const l1 = tracking.scheduleLeg1(db, root, { samplePks: [x.id], pickupDate: day, window: win });
      tracking.markPickedUp(db, lab, l1.shipmentId);
      tracking.receive(db, lab, x.sample_id, { condition: 'Acceptable' });
      const l2 = tracking.scheduleLeg2(db, lab, { samplePks: [x.id], pickupDate: day, window: win });
      tracking.markPickedUp(db, lab, l2.shipmentId);
      tracking.partnerReceived(db, lab, x.sample_id, { receivedOn: day, ref: `PL-DEMO-${x.id}50` });
      reports.uploadSource(db, store, lab, x.sample_id, pdf(x, false));
      const done = reports.uploadBranded(db, store, lab, x.sample_id, pdf(x, true));
      reports.review(db, store, root, done.id, { approve: true, pagesChecked: true });
      reports.release(db, store, root, done.id);
    };
    const c6 = reg(careUser, 2, { collected_now: 'yes', collector: 'Nurse Leela' });
    const c7 = reg(careUser, 0, { collected_now: 'yes', collector: 'Nurse Leela' });
    const c8 = reg(careUser, 1, { collected_now: 'yes', collector: 'Nurse Leela' });
    for (const x of [c6, c7, c8]) releaseFull(x);

    // Counselling: c7 booked for tomorrow; c8 taken all the way to a delivered action plan.
    const counsellor = db.get("SELECT u.*, NULL AS account_type FROM users u WHERE email = 'counsellor@demo.example'");
    const tomorrow = (h) => { const d = new Date(Date.now() + 86400000 + 5.5 * 3600000); return `${d.toISOString().slice(0, 10)}T${h}`; };
    counselling.schedule(db, counsellor, c7.sample_id, { when: tomorrow('11:00'), mode: 'Video call', link: 'https://meet.google.com/demo-link-abc' });
    counselling.schedule(db, counsellor, c8.sample_id, { when: tomorrow('15:30'), mode: 'Phone call' });
    counselling.sessionOutcome(db, counsellor, c8.sample_id, { outcome: 'done' });
    counselling.saveForm(db, counsellor, c8.sample_id, {
      heightCm: '168', weightKg: '74', waist: '88', bp: '128/82', hr: '74', 'life.diet': 'Vegetarian', 'life.actType': 'Walking', 'life.actFreq': '3-4',
      'life.sleepHours': '6-7', 'life.tobacco': 'Never', 'life.alcohol': 'Occasional', 'life.caffeine': '3-4', 'life.stress': 'Moderate',
      conditions: ['cholesterol'], family: ['heart', 'diabetes'], familyNote: 'Father: heart attack at 60 (dummy)',
      priorities: 'Lower LDL cholesterol\nWalk 5 days a week\nVitamin D test', healthChecks: 'Lipid profile in 3 months', consults: ['physician'],
    }, { complete: true });
    const p8 = db.get('SELECT full_name FROM patients WHERE id = ?', c8.patient_id).full_name;
    const planPdf = pdfwrite.write([[{ text: 'MyDNAPedia Personalised Action Plan', size: 16, bold: true }, `${p8}    Sample ID ${c8.sample_id}`, '',
      'Top priorities: lower LDL cholesterol, walk 5 days a week, check vitamin D.', 'Dummy action plan for the test version.']], { title: 'Action plan', author: 'MyDNAPedia' });
    const ap = counselling.uploadPlan(db, store, counsellor, c8.sample_id, { filename: 'plan.pdf', type: 'application/pdf', data: planPdf });
    counselling.reviewPlan(db, store, root, ap.id, { approve: true, pagesChecked: true });
    counselling.deliver(db, store, counsellor, ap.id);

    reports.uploadSource(db, store, lab, c5.sample_id, pdf(c5, false));
    reports.uploadBranded(db, store, lab, c5.sample_id, pdf(c5, true, true));
    reports.uploadSource(db, store, lab, d1.sample_id, pdf(d1, false));
    reports.uploadBranded(db, store, lab, d1.sample_id, pdf(d1, true));
  }

  billing.submitRecharge(db, careUser, { amountPaise: 3000000, mode: 'NEFT', reference: 'UTR-DEMO-7781', paymentDate: day });
  billing.lowBalanceReminders(db);
  return true;
}

module.exports = { firstRun, demo, DEMO_PASSWORD, TESTS };
