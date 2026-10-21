// Small shared helpers: time, money, ids, audit and settings.
const config = require('./config');

class UserError extends Error {}

const nowIso = () => new Date().toISOString();

// YYYY-MM-DD of the given instant in India time.
function istDate(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: config.timeZone }).format(d);
}

function fmtDateTime(iso) {
  if (!iso) return '';
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: config.timeZone, day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true,
  }).format(new Date(iso));
}

function fmtDate(isoOrDay) {
  if (!isoOrDay) return '';
  const d = /^\d{4}-\d{2}-\d{2}$/.test(isoOrDay) ? new Date(isoOrDay + 'T00:00:00+05:30') : new Date(isoOrDay);
  return new Intl.DateTimeFormat('en-IN', { timeZone: config.timeZone, day: '2-digit', month: 'short', year: 'numeric' }).format(d);
}

// Rupees as typed in a form ("7,000" or "7000.50") to paise.
function toPaise(input) {
  const s = String(input ?? '').replace(/[₹,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) throw new UserError(`"${input}" is not a valid amount in rupees.`);
  const [r, p = ''] = s.split('.');
  return Number(r) * 100 + Number((p + '00').slice(0, 2));
}

function rupees(paise) {
  const neg = paise < 0;
  const abs = Math.abs(paise);
  const r = Math.floor(abs / 100);
  const p = abs % 100;
  const s = r.toLocaleString('en-IN') + (p ? '.' + String(p).padStart(2, '0') : '');
  return (neg ? '-₹' : '₹') + s;
}

function nextCounter(db, name) {
  const row = db.get('SELECT value FROM counters WHERE name = ?', name);
  const value = (row ? row.value : 0) + 1;
  if (row) db.run('UPDATE counters SET value = ? WHERE name = ?', value, name);
  else db.run('INSERT INTO counters (name, value) VALUES (?, ?)', name, value);
  return value;
}

function audit(db, userId, action, entity, entityId, detail) {
  db.run(
    'INSERT INTO audit_log (at, user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?, ?)',
    nowIso(), userId ?? null, action, entity, entityId == null ? null : String(entityId),
    detail == null ? null : JSON.stringify(detail),
  );
}

const SETTING_DEFAULTS = {
  labName: 'MyDNAPedia',
  unitLine: 'A Unit of TVASTI Health and Wellness Private Limited',
  supportEmail: 'support@mydnapedia.example',
  supportPhone: '+91 00000 00000',
  sampleIdPrefix: 'MDP',
  // {PREFIX}000{YYYY}{N4} gives MDP00020260001. See samples.formatSampleId.
  sampleIdFormat: '{PREFIX}000{YYYY}{N4}',
  companyGstin: '',
  companyAddress: '',
  companyLegalName: 'TVASTI Health and Wellness Private Limited',
  companyState: 'Maharashtra',
  companyPan: '',
  invoiceSac: '9993',
  invoiceGstRate: '18',
  bankName: '',
  bankAccount: '',
  bankIfsc: '',
  jurisdiction: 'Pune',
  courierName: 'Main courier vendor',
  courierWhatsapp: '',
  partnerLabAddress: '',
  leakTerms: '',
};

function getSetting(db, key) {
  const row = db.get('SELECT value FROM settings WHERE key = ?', key);
  return row ? row.value : SETTING_DEFAULTS[key] ?? '';
}

function setSetting(db, key, value) {
  db.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, String(value));
}

module.exports = {
  UserError, nowIso, istDate, fmtDateTime, fmtDate, toPaise, rupees,
  nextCounter, audit, getSetting, setSetting, SETTING_DEFAULTS,
};
