// Monthly report: counts per account by India-time month, and a valid workbook.
const test = require('node:test');
const assert = require('node:assert');
const zlib = require('node:zlib');
const db = require('../src/db');
const seed = require('../src/seed');
const monthly = require('../src/monthly');
const { istDate } = require('../src/util');

// Reads the files back out of a zip made by src/xlsx.js.
function unzip(buf) {
  const out = {};
  let p = 0;
  while (buf.readUInt32LE(p) === 0x04034b50) {
    const size = buf.readUInt32LE(p + 18), nameLen = buf.readUInt16LE(p + 26), extra = buf.readUInt16LE(p + 28);
    const name = buf.slice(p + 30, p + 30 + nameLen).toString();
    const start = p + 30 + nameLen + extra;
    const data = zlib.inflateRawSync(buf.slice(start, start + size));
    assert.strictEqual(zlib.crc32(data), buf.readUInt32LE(p + 14), `crc of ${name}`);
    out[name] = data.toString('utf8');
    p = start + size;
  }
  return out;
}

test('monthly report counts processed samples per account', () => {
  const d = db.open(':memory:');
  seed.demo(d, null);
  const month = istDate().slice(0, 7);
  const r = monthly.report(d, month);
  assert.strictEqual(r.totals.processed, r.accounts.reduce((n, a) => n + a.processed, 0));
  assert.strictEqual(r.list.length, r.totals.processed);
  assert.strictEqual(r.totals.rejected, 1, 'the leaked tube is rejected, not processed');

  // A sample received at 00:10 India time on the 1st belongs to that month, not the one before.
  const s = d.get("SELECT id, account_id FROM samples WHERE status = 'COLLECTED' LIMIT 1");
  d.run('UPDATE samples SET received_at = ? WHERE id = ?', '2026-02-28T18:40:00.000Z', s.id);
  assert.strictEqual(monthly.report(d, '2026-03').totals.processed, 1);
  assert.strictEqual(monthly.report(d, '2026-02').totals.processed, 0);
  // March sits in financial year 2025-26, which starts in April 2025.
  assert.deepStrictEqual(monthly.report(d, '2026-03').months.slice(0, 2), ['2025-04', '2025-05']);

  const files = unzip(monthly.toXlsx(r));
  assert.deepStrictEqual(Object.keys(files).filter((f) => f.includes('worksheets')).length, 4);
  assert.match(files['xl/workbook.xml'], /name="Summary"/);
  assert.match(files['xl/worksheets/sheet1.xml'], /CareWell Clinic/);
  assert.match(files['xl/worksheets/sheet1.xml'], /<f>SUM\(E4:E\d+\)<\/f>/);
  // Patient names never go into the file.
  for (const p of d.all('SELECT full_name FROM patients')) for (const x of Object.values(files)) assert.ok(!x.includes(p.full_name));
});

test('month helpers', () => {
  assert.strictEqual(monthly.addMonths('2026-12', 1), '2027-01');
  assert.strictEqual(monthly.addMonths('2026-01', -1), '2025-12');
  assert.ok(monthly.validMonth('2026-10'));
  assert.ok(!monthly.validMonth('2026-13'));
  assert.strictEqual(monthly.monthLabel('2026-10'), 'October 2026');
});
