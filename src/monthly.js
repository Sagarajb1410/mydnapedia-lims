// Monthly figures: how many samples the lab processed in a month and how many
// came from each franchise, B2B partner, supplier and the lab itself.
// "Processed" means accepted at the central lab that month (the day the TAT
// clock starts). Months follow India time.
const { fmtDate } = require('./util');
const xlsx = require('./xlsx');

const TYPE_LABEL = { partner: 'Franchise / B2B partner', supplier: 'B2B supplier', main: 'MyDNAPedia direct' };
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const validMonth = (m) => /^\d{4}-(0[1-9]|1[0-2])$/.test(m || '');
const monthLabel = (m) => `${MONTHS[Number(m.slice(5)) - 1]} ${m.slice(0, 4)}`;
const addMonths = (m, n) => {
  const t = Number(m.slice(0, 4)) * 12 + Number(m.slice(5)) - 1 + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
};
// The instant an India-time month starts, as stored (UTC ISO).
const startOf = (m) => new Date(`${m}-01T00:00:00+05:30`).toISOString();

// Indian financial year (April to March) holding the month, up to that month.
function fyMonths(m) {
  const y = Number(m.slice(0, 4)) - (Number(m.slice(5)) < 4 ? 1 : 0);
  const out = [];
  for (let x = `${y}-04`; x <= m; x = addMonths(x, 1)) out.push(x);
  return out;
}

function report(db, month) {
  const from = startOf(month);
  const to = startOf(addMonths(month, 1));
  const accounts = db.all(`SELECT a.id, a.code, a.name, a.type, a.city, a.active,
      (SELECT COUNT(*) FROM samples s WHERE s.account_id = a.id AND s.registered_at >= ?1 AND s.registered_at < ?2) AS registered,
      (SELECT COUNT(*) FROM samples s WHERE s.account_id = a.id AND s.received_at >= ?1 AND s.received_at < ?2 AND s.reject_reason IS NULL) AS processed,
      (SELECT COUNT(*) FROM samples s WHERE s.account_id = a.id AND s.received_at >= ?1 AND s.received_at < ?2 AND s.reject_reason IS NOT NULL) AS rejected,
      (SELECT COUNT(*) FROM samples s WHERE s.account_id = a.id AND s.released_at >= ?1 AND s.released_at < ?2) AS released
    FROM accounts a ORDER BY CASE a.type WHEN 'partner' THEN 0 WHEN 'supplier' THEN 1 ELSE 2 END, a.name`, from, to)
    // Inactive accounts with nothing that month stay out of the way.
    .filter((a) => a.registered + a.processed + a.rejected + a.released > 0 || a.active);
  const total = (k) => accounts.reduce((n, a) => n + a[k], 0);
  const totals = { registered: total('registered'), processed: total('processed'), rejected: total('rejected'), released: total('released') };

  const tests = db.all('SELECT id, name FROM tests ORDER BY name');
  const byTestRows = db.all(`SELECT account_id, test_id, COUNT(*) AS n FROM samples
    WHERE received_at >= ? AND received_at < ? AND reject_reason IS NULL GROUP BY account_id, test_id`, from, to);
  const byTest = new Map(byTestRows.map((r) => [`${r.account_id}:${r.test_id}`, r.n]));
  const usedTests = tests.filter((t) => byTestRows.some((r) => r.test_id === t.id));

  const months = fyMonths(month);
  const yearRows = db.all(`SELECT account_id, received_at FROM samples
    WHERE received_at >= ? AND received_at < ? AND reject_reason IS NULL`, startOf(months[0]), to);
  const ym = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit' }).format(new Date(iso)).slice(0, 7);
  const year = new Map();
  for (const r of yearRows) { const k = `${r.account_id}:${ym(r.received_at)}`; year.set(k, (year.get(k) || 0) + 1); }

  // No patient names: the file is meant to be shared with the team.
  const list = db.all(`SELECT s.sample_id, s.status, s.registered_at, s.received_at, s.released_at, a.name AS account, a.type AS account_type, t.name AS test
    FROM samples s JOIN accounts a ON a.id = s.account_id JOIN tests t ON t.id = s.test_id
    WHERE s.received_at >= ? AND s.received_at < ? AND s.reject_reason IS NULL ORDER BY a.name, s.received_at`, from, to);

  return { month, label: monthLabel(month), accounts, totals, tests: usedTests, byTest, months, year, list };
}

function toXlsx(r, labName = 'MyDNAPedia') {
  const n = r.accounts.length;
  const sumCol = (col) => ({ f: `SUM(${col}4:${col}${n + 3})`, v: r.totals[{ D: 'registered', E: 'processed', F: 'rejected', G: 'released' }[col]], style: 'total' });
  const summary = {
    name: 'Summary', widths: [34, 24, 16, 14, 14, 16, 18], freezeRow: 3,
    rows: [
      { cells: [`${labName}: samples for ${r.label}`], style: 'title' },
      { cells: ['Processed = accepted at the central lab this month. Registered and reports released are counted by their own dates.'], style: 'note' },
      { cells: ['Franchise / account', 'Type', 'City', 'Registered', 'Processed', 'Rejected at lab', 'Reports released'], style: 'header' },
      ...r.accounts.map((a) => [a.name, TYPE_LABEL[a.type] || a.type, a.city || '', a.registered, a.processed, a.rejected, a.released]),
      { cells: ['Total', '', '', sumCol('D'), sumCol('E'), sumCol('F'), sumCol('G')], style: 'total' },
    ],
  };

  const testCols = r.tests.map((t) => t.name);
  const lastTest = xlsx.colName(testCols.length);
  const byTest = {
    name: 'By test', widths: [34, ...testCols.map(() => 18), 12], freezeRow: 2,
    rows: [
      { cells: [`Samples processed in ${r.label}, by test`], style: 'title' },
      { cells: ['Franchise / account', ...testCols, 'Total'], style: 'header' },
      ...r.accounts.filter((a) => a.processed).map((a, i) => [a.name, ...r.tests.map((t) => r.byTest.get(`${a.id}:${t.id}`) || 0),
        testCols.length ? { f: `SUM(B${i + 3}:${lastTest}${i + 3})`, v: a.processed } : a.processed]),
    ],
  };
  if (byTest.rows.length === 2) byTest.rows.push({ cells: ['No samples were processed this month.'], style: 'note' });

  const fyLabel = `${r.months[0].slice(0, 4)}-${String(Number(r.months[0].slice(0, 4)) + 1).slice(2)}`;
  const lastMonthCol = xlsx.colName(r.months.length);
  const yearRows = r.accounts.map((a) => [a.name, ...r.months.map((m) => r.year.get(`${a.id}:${m}`) || 0)]);
  const year = {
    name: 'Month by month', widths: [34, ...r.months.map(() => 11), 12], freezeRow: 2,
    rows: [
      { cells: [`Samples processed each month, financial year ${fyLabel}`], style: 'title' },
      { cells: ['Franchise / account', ...r.months.map((m) => monthLabel(m).replace(/^(\w{3})\w* /, '$1 ')), 'Total'], style: 'header' },
      ...yearRows.map((row, i) => [...row, { f: `SUM(B${i + 3}:${lastMonthCol}${i + 3})`, v: row.slice(1).reduce((x, y) => x + y, 0) }]),
      { cells: ['Total', ...r.months.map((m, j) => {
        const col = xlsx.colName(j + 1);
        return { f: `SUM(${col}3:${col}${n + 2})`, v: yearRows.reduce((x, row) => x + row[j + 1], 0), style: 'total' };
      }), { f: `SUM(B${n + 3}:${lastMonthCol}${n + 3})`, v: yearRows.reduce((x, row) => x + row.slice(1).reduce((p, q) => p + q, 0), 0), style: 'total' }], style: 'total' },
    ],
  };

  const samples = {
    name: 'Samples', widths: [16, 34, 24, 26, 14, 16, 16, 26], freezeRow: 2,
    rows: [
      { cells: [`Samples processed in ${r.label}`], style: 'title' },
      { cells: ['Sample ID', 'Franchise / account', 'Type', 'Test', 'Registered', 'Received at lab', 'Report released', 'Status now'], style: 'header' },
      ...r.list.map((s) => [s.sample_id, s.account, TYPE_LABEL[s.account_type] || s.account_type, s.test, fmtDate(s.registered_at), fmtDate(s.received_at), fmtDate(s.released_at), s.status.replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase())]),
    ],
  };
  return xlsx.workbook([summary, byTest, year, samples]);
}

module.exports = { report, toXlsx, validMonth, monthLabel, addMonths, TYPE_LABEL };
