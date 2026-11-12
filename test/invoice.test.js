// Tally-style invoices: amounts in words, tax split, and CGST/SGST against IGST.
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const db = require('../src/db');
const storage = require('../src/storage');
const seed = require('../src/seed');
const invoice = require('../src/invoice');
const { createApp } = require('../src/web/app');

test('amounts in Indian words', () => {
  assert.strictEqual(invoice.amountInWords(299900), 'INR Two Thousand Nine Hundred Ninety Nine Only');
  assert.strictEqual(invoice.amountInWords(1234567805), 'INR One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight and Five paise Only');
  assert.strictEqual(invoice.amountInWords(10000000), 'INR One Lakh Only');
  assert.strictEqual(invoice.amt(1774550), '17,745.50');
  assert.deepStrictEqual(invoice.splitInclusive(1180000, 18), { taxable: 1000000, tax: 180000 });
  assert.strictEqual(invoice.stateCode('Tamil Nadu'), '33');
  assert.strictEqual(invoice.stateCode('maharashtra'), '27');
});

test('bills print as Tally-style tax invoices', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lims-inv-'));
  const d = db.open(':memory:');
  seed.demo(d, storage.localAdapter(dir));
  const load = (id) => {
    const s = d.get('SELECT * FROM samples WHERE sample_id = ?', id);
    return { s, p: d.get('SELECT * FROM patients WHERE id = ?', s.patient_id), t: d.get('SELECT * FROM tests WHERE id = ?', s.test_id),
      a: d.get('SELECT * FROM accounts WHERE id = ?', s.account_id), bill: d.get('SELECT * FROM bills WHERE sample_pk = ?', s.id),
      sbill: d.get('SELECT * FROM supplier_bills WHERE sample_pk = ?', s.id) };
  };
  for (const s of d.all('SELECT sample_id FROM samples s JOIN bills b ON b.sample_pk = s.id')) {
    const f = load(s.sample_id);
    const v = invoice.build(d, f);
    assert.strictEqual(v.taxable + v.tax, v.total, s.sample_id);
    assert.strictEqual(v.taxes.reduce((n, x) => n + x.amount, 0), v.tax, s.sample_id);
    assert.strictEqual(v.total, f.sbill ? f.sbill.total_paise : f.bill.net_paise, 'the invoice total is what was charged');
    assert.strictEqual(v.taxes.map((x) => x.name).join(), v.inter ? 'IGST' : 'CGST,SGST');
    if (f.sbill) assert.strictEqual(v.seller.gstin, f.a.gstin, 'supplier bills are issued under the supplier GSTIN');
    else if (f.bill.payer === 'credit') assert.strictEqual(v.buyer.name, f.a.legal_name || f.a.name, 'partner bills are made out to the partner');
  }
  const server = createApp({ db: d, storage: storage.localAdapter(dir) }).server();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const res = await fetch(`${base}/login`, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'email=admin@mydnapedia.example&password=test1234' });
    const cookie = res.headers.get('set-cookie').split(';')[0];
    for (const id of ['MDP00020260001', 'MDP00020260009', 'MDP00020260011', 'MDP00020260012']) {
      const page = await fetch(`${base}/samples/${id}/bill`, { headers: { cookie } });
      assert.strictEqual(page.status, 200, id);
      const body = await page.text();
      for (const want of ['Tax Invoice', 'HSN/SAC', 'Amount Chargeable (in words)', 'Authorised Signatory', 'Computer Generated Invoice']) assert.ok(body.includes(want), `${id} ${want}`);
      assert.doesNotMatch(body, /undefined|NaN|\[object Object\]/, id);
    }
  } finally { server.close(); }
});
