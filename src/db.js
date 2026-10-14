// Database access. Stage 1 uses SQLite (built into Node, nothing to install).
// The schema sticks to plain SQL types so the same tables can be created in
// PostgreSQL for Stage 2. Money is always stored in paise (integers).
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const MIGRATIONS = [
  // 1: core tables for foundation, registration and billing
  `
  CREATE TABLE accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL CHECK (type IN ('main','partner','supplier')),
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    legal_name TEXT,
    gstin TEXT,
    address TEXT,
    city TEXT,
    state TEXT,
    contact_name TEXT,
    phone TEXT,
    email TEXT,
    low_balance_paise INTEGER NOT NULL DEFAULT 2000000,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );
  CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    phone TEXT,
    role TEXT NOT NULL CHECK (role IN ('admin','lab','partner','counsellor')),
    account_id INTEGER REFERENCES accounts(id),
    password_hash TEXT NOT NULL,
    must_change_password INTEGER NOT NULL DEFAULT 1,
    active INTEGER NOT NULL DEFAULT 1,
    failed_logins INTEGER NOT NULL DEFAULT 0,
    locked_until TEXT,
    last_login_at TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );
  CREATE TABLE tests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    short_name TEXT NOT NULL,
    sample_type TEXT NOT NULL,
    route TEXT NOT NULL CHECK (route IN ('in_house','partner_lab')),
    tat_days INTEGER NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );
  CREATE TABLE prices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    test_id INTEGER NOT NULL REFERENCES tests(id),
    price_list TEXT NOT NULL CHECK (price_list IN ('direct','partner','supplier')),
    price_paise INTEGER NOT NULL CHECK (price_paise >= 0),
    effective_from TEXT NOT NULL,
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL
  );
  CREATE TABLE price_overrides (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL REFERENCES accounts(id),
    test_id INTEGER NOT NULL REFERENCES tests(id),
    price_paise INTEGER NOT NULL CHECK (price_paise >= 0),
    effective_from TEXT NOT NULL,
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL
  );
  CREATE TABLE patients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    full_name TEXT NOT NULL,
    gender TEXT NOT NULL,
    dob TEXT NOT NULL,
    mobile TEXT NOT NULL,
    email TEXT,
    address TEXT,
    city TEXT NOT NULL,
    state TEXT NOT NULL,
    pincode TEXT NOT NULL,
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL
  );
  CREATE TABLE samples (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sample_id TEXT NOT NULL UNIQUE,
    patient_id INTEGER NOT NULL REFERENCES patients(id),
    test_id INTEGER NOT NULL REFERENCES tests(id),
    account_id INTEGER NOT NULL REFERENCES accounts(id),
    registered_by INTEGER NOT NULL REFERENCES users(id),
    registered_at TEXT NOT NULL,
    status TEXT NOT NULL,
    partner_ref TEXT,
    referring_doctor TEXT,
    clinical_notes TEXT,
    consent_testing INTEGER NOT NULL DEFAULT 0,
    consent_data_use INTEGER NOT NULL DEFAULT 0,
    consent_method TEXT,
    duplicate_reason TEXT,
    collected_at TEXT,
    collector TEXT,
    received_at TEXT,
    cancel_reason TEXT
  );
  CREATE INDEX samples_account ON samples(account_id);
  CREATE INDEX samples_status ON samples(status);
  CREATE TABLE sample_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sample_pk INTEGER NOT NULL REFERENCES samples(id),
    from_status TEXT,
    to_status TEXT NOT NULL,
    at TEXT NOT NULL,
    user_id INTEGER REFERENCES users(id),
    note TEXT
  );
  CREATE TABLE bills (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bill_no TEXT NOT NULL UNIQUE,
    sample_pk INTEGER NOT NULL UNIQUE REFERENCES samples(id),
    account_id INTEGER NOT NULL REFERENCES accounts(id),
    price_list TEXT NOT NULL,
    list_price_paise INTEGER NOT NULL,
    discount_paise INTEGER NOT NULL DEFAULT 0,
    net_paise INTEGER NOT NULL,
    payer TEXT NOT NULL CHECK (payer IN ('credit','supplier','patient')),
    payment_mode TEXT,
    payment_ref TEXT,
    status TEXT NOT NULL CHECK (status IN ('paid','open','reversed','refunded')),
    created_at TEXT NOT NULL
  );
  CREATE TABLE supplier_bills (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sample_pk INTEGER NOT NULL UNIQUE REFERENCES samples(id),
    account_id INTEGER NOT NULL REFERENCES accounts(id),
    bill_no TEXT NOT NULL,
    patient_price_paise INTEGER NOT NULL,
    discount_paise INTEGER NOT NULL DEFAULT 0,
    net_paise INTEGER NOT NULL,
    gst_rate_bp INTEGER NOT NULL DEFAULT 0,
    gst_paise INTEGER NOT NULL DEFAULT 0,
    total_paise INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE recharge_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL REFERENCES accounts(id),
    amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
    mode TEXT NOT NULL,
    reference TEXT NOT NULL,
    payment_date TEXT NOT NULL,
    proof_file TEXT,
    status TEXT NOT NULL CHECK (status IN ('submitted','approved','rejected')),
    submitted_by INTEGER REFERENCES users(id),
    submitted_at TEXT NOT NULL,
    reviewed_by INTEGER REFERENCES users(id),
    reviewed_at TEXT,
    review_note TEXT
  );
  CREATE TABLE ledger_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL REFERENCES accounts(id),
    entry_type TEXT NOT NULL CHECK (entry_type IN ('recharge','deduction','reversal','adjustment')),
    amount_paise INTEGER NOT NULL,
    sample_pk INTEGER REFERENCES samples(id),
    recharge_id INTEGER REFERENCES recharge_requests(id),
    reason TEXT,
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL
  );
  CREATE INDEX ledger_account ON ledger_entries(account_id);
  CREATE TABLE notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL,
    channel TEXT NOT NULL CHECK (channel IN ('email','whatsapp')),
    recipient_name TEXT,
    recipient TEXT,
    subject TEXT,
    body TEXT NOT NULL,
    sample_pk INTEGER REFERENCES samples(id),
    account_id INTEGER REFERENCES accounts(id),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','skipped')),
    created_at TEXT NOT NULL,
    day TEXT NOT NULL,
    sent_by INTEGER REFERENCES users(id),
    sent_at TEXT
  );
  CREATE TABLE audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at TEXT NOT NULL,
    user_id INTEGER REFERENCES users(id),
    action TEXT NOT NULL,
    entity TEXT NOT NULL,
    entity_id TEXT,
    detail TEXT
  );
  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE counters (name TEXT PRIMARY KEY, value INTEGER NOT NULL);
  `,
  // 2: sample tracking (courier legs, lab receipt, TAT, holds, recollection)
  `
  ALTER TABLE samples ADD COLUMN tat_due_at TEXT;
  ALTER TABLE samples ADD COLUMN receipt_condition TEXT;
  ALTER TABLE samples ADD COLUMN reject_reason TEXT;
  ALTER TABLE samples ADD COLUMN recollection_of INTEGER REFERENCES samples(id);
  ALTER TABLE samples ADD COLUMN partner_lab_ref TEXT;
  ALTER TABLE samples ADD COLUMN partner_received_at TEXT;
  ALTER TABLE samples ADD COLUMN hold_from_status TEXT;
  ALTER TABLE samples ADD COLUMN hold_reason TEXT;
  ALTER TABLE samples ADD COLUMN hold_started_at TEXT;
  ALTER TABLE samples ADD COLUMN tat_warned TEXT;
  CREATE TABLE shipments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    shipment_no TEXT NOT NULL UNIQUE,
    leg INTEGER NOT NULL CHECK (leg IN (1, 2)),
    account_id INTEGER REFERENCES accounts(id),
    origin TEXT NOT NULL,
    destination TEXT NOT NULL,
    courier TEXT NOT NULL,
    awb TEXT,
    pickup_date TEXT NOT NULL,
    pickup_window TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('scheduled','picked_up','delivered','cancelled')),
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL,
    picked_up_at TEXT,
    delivered_at TEXT
  );
  CREATE TABLE shipment_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    shipment_id INTEGER NOT NULL REFERENCES shipments(id),
    sample_pk INTEGER NOT NULL REFERENCES samples(id),
    UNIQUE (shipment_id, sample_pk)
  );
  CREATE INDEX shipment_items_sample ON shipment_items(sample_pk);
  `,
  // 3: reports (partner or in-house result, white-labelled report, approval, release)
  `
  CREATE TABLE reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sample_pk INTEGER NOT NULL REFERENCES samples(id),
    kind TEXT NOT NULL CHECK (kind IN ('source','branded')),
    version INTEGER NOT NULL,
    file_key TEXT NOT NULL,
    file_name TEXT NOT NULL,
    sha256 TEXT NOT NULL,
    size INTEGER NOT NULL,
    pages INTEGER,
    uploaded_by INTEGER REFERENCES users(id),
    uploaded_at TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('received','blocked','pending','rejected','approved','released','superseded')),
    check_json TEXT,
    reviewed_by INTEGER REFERENCES users(id),
    reviewed_at TEXT,
    review_note TEXT,
    released_by INTEGER REFERENCES users(id),
    released_at TEXT,
    UNIQUE (sample_pk, kind, version)
  );
  CREATE INDEX reports_sample ON reports(sample_pk);
  ALTER TABLE samples ADD COLUMN released_at TEXT;
  ALTER TABLE samples ADD COLUMN tat_met INTEGER;
  ALTER TABLE notifications ADD COLUMN attachment_key TEXT;
  ALTER TABLE notifications ADD COLUMN attachment_name TEXT;
  `,
  // 4: counselling sessions, the counselling form and the action plan
  `
  ALTER TABLE samples ADD COLUMN counsellor_id INTEGER REFERENCES users(id);
  CREATE TABLE counselling_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sample_pk INTEGER NOT NULL REFERENCES samples(id),
    counsellor_id INTEGER NOT NULL REFERENCES users(id),
    scheduled_at TEXT NOT NULL,
    mode TEXT NOT NULL,
    meeting_link TEXT,
    status TEXT NOT NULL CHECK (status IN ('scheduled','done','no_show','cancelled')),
    outcome_note TEXT,
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL,
    completed_at TEXT
  );
  CREATE INDEX counselling_sessions_sample ON counselling_sessions(sample_pk);
  CREATE TABLE counselling_forms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sample_pk INTEGER NOT NULL UNIQUE REFERENCES samples(id),
    data_json TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('draft','complete')),
    updated_by INTEGER REFERENCES users(id),
    updated_at TEXT NOT NULL,
    completed_at TEXT
  );
  CREATE TABLE action_plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sample_pk INTEGER NOT NULL REFERENCES samples(id),
    version INTEGER NOT NULL,
    file_key TEXT NOT NULL,
    file_name TEXT NOT NULL,
    file_type TEXT NOT NULL CHECK (file_type IN ('pdf','docx')),
    sha256 TEXT NOT NULL,
    size INTEGER NOT NULL,
    uploaded_by INTEGER REFERENCES users(id),
    uploaded_at TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('blocked','pending','rejected','approved','delivered','superseded')),
    check_json TEXT,
    reviewed_by INTEGER REFERENCES users(id),
    reviewed_at TEXT,
    review_note TEXT,
    delivered_by INTEGER REFERENCES users(id),
    delivered_at TEXT,
    UNIQUE (sample_pk, version)
  );
  `,
  // 5: documents saved from Report Centre (counselling form, case file)
  `
  CREATE TABLE studio_docs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sample_pk INTEGER NOT NULL REFERENCES samples(id),
    kind TEXT NOT NULL CHECK (kind IN ('form','case')),
    file_key TEXT NOT NULL,
    file_name TEXT NOT NULL,
    mime TEXT,
    size INTEGER NOT NULL,
    uploaded_by INTEGER REFERENCES users(id),
    uploaded_at TEXT NOT NULL
  );
  CREATE INDEX studio_docs_sample ON studio_docs(sample_pk);
  `,
  // 6: counsellors' open slots, which patients or staff book
  `
  CREATE TABLE counsellor_slots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    counsellor_id INTEGER NOT NULL REFERENCES users(id),
    starts_at TEXT NOT NULL,
    minutes INTEGER NOT NULL,
    mode TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('open','booked','removed')),
    session_id INTEGER REFERENCES counselling_sessions(id),
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL
  );
  CREATE INDEX counsellor_slots_time ON counsellor_slots(status, starts_at);
  CREATE UNIQUE INDEX counsellor_slots_one ON counsellor_slots(counsellor_id, starts_at) WHERE status != 'removed';
  `,
];

// Audit rows must never change: block UPDATE and DELETE at database level.
const TRIGGERS = `
  CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit_log
  BEGIN SELECT RAISE(ABORT, 'audit log is append-only'); END;
  CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit_log
  BEGIN SELECT RAISE(ABORT, 'audit log is append-only'); END;
  CREATE TRIGGER IF NOT EXISTS ledger_no_update BEFORE UPDATE ON ledger_entries
  BEGIN SELECT RAISE(ABORT, 'ledger entries cannot be changed; add a reversal or adjustment'); END;
  CREATE TRIGGER IF NOT EXISTS ledger_no_delete BEFORE DELETE ON ledger_entries
  BEGIN SELECT RAISE(ABORT, 'ledger entries cannot be deleted; add a reversal or adjustment'); END;
`;

function open(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)');
  const row = db.prepare('SELECT version FROM schema_version').get();
  let version = row ? row.version : 0;
  if (!row) db.prepare('INSERT INTO schema_version (version) VALUES (0)').run();
  for (; version < MIGRATIONS.length; version++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[version]);
      db.prepare('UPDATE schema_version SET version = ?').run(version + 1);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
  db.exec(TRIGGERS);
  return wrap(db);
}

function wrap(db) {
  const cache = new Map();
  const stmt = (sql) => {
    let s = cache.get(sql);
    if (!s) { s = db.prepare(sql); cache.set(sql, s); }
    return s;
  };
  let depth = 0;
  return {
    raw: db,
    get: (sql, ...p) => stmt(sql).get(...p),
    all: (sql, ...p) => stmt(sql).all(...p),
    run: (sql, ...p) => stmt(sql).run(...p),
    // Runs fn inside one transaction; nested calls join the outer one.
    tx(fn) {
      if (depth > 0) return fn();
      depth++;
      db.exec('BEGIN IMMEDIATE');
      try {
        const out = fn();
        db.exec('COMMIT');
        return out;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      } finally {
        depth--;
      }
    },
    close: () => db.close(),
  };
}

module.exports = { open };
