// Master data kept by the admin: tests, price lists, accounts and users.
const { nowIso, istDate, audit, UserError, toPaise } = require('./util');
const auth = require('./auth');

function requireAdmin(user) {
  if (user.role !== 'admin') throw new UserError('Only an admin can do this.');
}

const clean = (v) => (v == null ? '' : String(v).trim());

function saveTest(db, user, input) {
  requireAdmin(user);
  const t = {
    code: clean(input.code).toUpperCase(),
    name: clean(input.name),
    short_name: clean(input.short_name),
    sample_type: clean(input.sample_type),
    route: input.route === 'partner_lab' ? 'partner_lab' : 'in_house',
    tat_days: Number(input.tat_days),
    active: input.active === 'no' ? 0 : 1,
  };
  if (!/^[A-Z0-9-]{2,20}$/.test(t.code)) throw new UserError('The test code must be 2 to 20 letters, numbers or dashes.');
  if (!t.name) throw new UserError('Enter the test name.');
  if (!t.short_name || t.short_name.length > 24) throw new UserError('Enter a label name of up to 24 characters.');
  if (!t.sample_type) throw new UserError('Enter the sample type.');
  if (!Number.isInteger(t.tat_days) || t.tat_days < 1 || t.tat_days > 120) throw new UserError('TAT must be between 1 and 120 days.');
  return db.tx(() => {
    let id = Number(input.id) || null;
    if (id) {
      db.run('UPDATE tests SET code = ?, name = ?, short_name = ?, sample_type = ?, route = ?, tat_days = ?, active = ? WHERE id = ?',
        t.code, t.name, t.short_name, t.sample_type, t.route, t.tat_days, t.active, id);
    } else {
      if (db.get('SELECT id FROM tests WHERE code = ?', t.code)) throw new UserError('A test with this code already exists.');
      id = Number(db.run('INSERT INTO tests (code, name, short_name, sample_type, route, tat_days, active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        t.code, t.name, t.short_name, t.sample_type, t.route, t.tat_days, t.active, nowIso()).lastInsertRowid);
    }
    for (const list of ['direct', 'partner', 'supplier']) {
      const v = clean(input['price_' + list]);
      if (v === '') continue;
      setPrice(db, user, id, list, toPaise(v), clean(input.effective_from) || istDate());
    }
    audit(db, user.id, input.id ? 'test_updated' : 'test_created', 'test', id, t);
    return id;
  });
}

// Prices are never overwritten: a new row with an effective date keeps history,
// and bills already made keep the price they were made with.
function setPrice(db, user, testId, priceList, pricePaise, effectiveFrom) {
  const current = db.get(
    'SELECT price_paise FROM prices WHERE test_id = ? AND price_list = ? AND effective_from <= ? ORDER BY effective_from DESC, id DESC LIMIT 1',
    testId, priceList, effectiveFrom,
  );
  if (current && current.price_paise === pricePaise) return;
  db.run('INSERT INTO prices (test_id, price_list, price_paise, effective_from, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    testId, priceList, pricePaise, effectiveFrom, user.id, nowIso());
  audit(db, user.id, 'price_set', 'test', testId, { priceList, pricePaise, effectiveFrom });
}

function saveAccount(db, user, input) {
  requireAdmin(user);
  const a = {
    type: input.type,
    code: clean(input.code).toUpperCase(),
    name: clean(input.name),
    legal_name: clean(input.legal_name) || null,
    gstin: clean(input.gstin).toUpperCase() || null,
    address: clean(input.address) || null,
    city: clean(input.city) || null,
    state: clean(input.state) || null,
    contact_name: clean(input.contact_name) || null,
    phone: clean(input.phone).replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '') || null,
    email: clean(input.email).toLowerCase() || null,
    low_balance_paise: clean(input.low_balance) === '' ? 2000000 : toPaise(input.low_balance),
    active: input.active === 'no' ? 0 : 1,
  };
  if (!['partner', 'supplier'].includes(a.type)) throw new UserError('Choose B2B partner or B2B supplier.');
  if (!/^[A-Z0-9]{2,10}$/.test(a.code)) throw new UserError('The account code must be 2 to 10 letters or numbers.');
  if (!a.name) throw new UserError('Enter the account name.');
  if (a.gstin && !/^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/.test(a.gstin)) throw new UserError('The GSTIN does not look right (15 characters, for example 27ABCDE1234F1Z5).');
  if (a.type === 'supplier' && (!a.gstin || !a.legal_name || !a.address)) throw new UserError('A B2B supplier needs its legal name, address and GSTIN, because they print on the patient bill.');
  if (a.phone && !/^[6-9]\d{9}$/.test(a.phone)) throw new UserError('Enter a 10-digit mobile number for WhatsApp.');
  if (!a.email) throw new UserError('Enter the contact email.');
  return db.tx(() => {
    let id = Number(input.id) || null;
    if (id) {
      const before = db.get('SELECT * FROM accounts WHERE id = ?', id);
      if (!before || before.type === 'main') throw new UserError('Account not found.');
      if (before.type !== a.type) throw new UserError('The account type cannot be changed after creation.');
      db.run(`UPDATE accounts SET code = ?, name = ?, legal_name = ?, gstin = ?, address = ?, city = ?, state = ?, contact_name = ?,
              phone = ?, email = ?, low_balance_paise = ?, active = ? WHERE id = ?`,
        a.code, a.name, a.legal_name, a.gstin, a.address, a.city, a.state, a.contact_name, a.phone, a.email, a.low_balance_paise, a.active, id);
    } else {
      if (db.get('SELECT id FROM accounts WHERE code = ?', a.code)) throw new UserError('An account with this code already exists.');
      id = Number(db.run(`INSERT INTO accounts (type, code, name, legal_name, gstin, address, city, state, contact_name, phone, email, low_balance_paise, active, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        a.type, a.code, a.name, a.legal_name, a.gstin, a.address, a.city, a.state, a.contact_name, a.phone, a.email, a.low_balance_paise, a.active, nowIso()).lastInsertRowid);
    }
    audit(db, user.id, input.id ? 'account_updated' : 'account_created', 'account', id, a);
    return id;
  });
}

// Returns the one-time password so the admin can pass it on privately.
function createUser(db, user, input) {
  requireAdmin(user);
  const u = {
    name: clean(input.name),
    email: clean(input.email).toLowerCase(),
    phone: clean(input.phone) || null,
    role: input.role,
    account_id: Number(input.account_id) || null,
  };
  if (!u.name) throw new UserError('Enter the name.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(u.email)) throw new UserError('Enter a valid email address.');
  if (!['admin', 'lab', 'partner', 'counsellor'].includes(u.role)) throw new UserError('Choose a role.');
  if (u.role === 'partner') {
    const acc = db.get("SELECT id FROM accounts WHERE id = ? AND type IN ('partner','supplier')", u.account_id);
    if (!acc) throw new UserError('Choose the partner or supplier account this person belongs to.');
  } else {
    u.account_id = null;
  }
  if (db.get('SELECT id FROM users WHERE email = ? COLLATE NOCASE', u.email)) throw new UserError('A user with this email already exists.');
  const pw = auth.tempPassword();
  const id = Number(db.run('INSERT INTO users (name, email, phone, role, account_id, password_hash, must_change_password, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)',
    u.name, u.email, u.phone, u.role, u.account_id, auth.hashPassword(pw), nowIso()).lastInsertRowid);
  audit(db, user.id, 'user_created', 'user', id, u);
  return { id, password: pw };
}

function resetPassword(db, user, id) {
  requireAdmin(user);
  const pw = auth.tempPassword();
  db.run('UPDATE users SET password_hash = ?, must_change_password = 1, failed_logins = 0, locked_until = NULL WHERE id = ?', auth.hashPassword(pw), id);
  db.run('DELETE FROM sessions WHERE user_id = ?', id);
  audit(db, user.id, 'password_reset', 'user', id);
  return pw;
}

function setUserActive(db, user, id, active) {
  requireAdmin(user);
  if (id === user.id && !active) throw new UserError('You cannot switch off your own sign-in.');
  db.run('UPDATE users SET active = ? WHERE id = ?', active ? 1 : 0, id);
  if (!active) db.run('DELETE FROM sessions WHERE user_id = ?', id);
  audit(db, user.id, active ? 'user_enabled' : 'user_disabled', 'user', id);
}

module.exports = { requireAdmin, saveTest, setPrice, saveAccount, createUser, resetPassword, setUserActive };
