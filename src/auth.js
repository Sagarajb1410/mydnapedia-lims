// Passwords, sign-in and sessions.
const crypto = require('node:crypto');
const config = require('./config');
const { nowIso, audit, UserError } = require('./util');

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  const [kind, saltHex, hashHex] = String(stored).split('$');
  if (kind !== 'scrypt') return false;
  const hash = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), 64);
  return crypto.timingSafeEqual(hash, Buffer.from(hashHex, 'hex'));
}

function checkNewPassword(pw) {
  if (String(pw).length < 8) throw new UserError('The password must be at least 8 characters.');
}

// Readable one-time password for a new user, e.g. "kite-4821-moon".
function tempPassword() {
  const words = ['kite', 'moon', 'river', 'leaf', 'stone', 'cloud', 'tiger', 'lotus', 'pearl', 'amber', 'cedar', 'delta'];
  const pick = () => words[crypto.randomInt(words.length)];
  return `${pick()}-${crypto.randomInt(1000, 9999)}-${pick()}`;
}

const MAX_FAILS = 5;
const LOCK_MINUTES = 10;

function login(db, email, password) {
  const user = db.get('SELECT * FROM users WHERE email = ? COLLATE NOCASE', String(email).trim());
  const fail = new UserError('Email or password is wrong.');
  if (!user || !user.active) throw fail;
  if (user.locked_until && user.locked_until > nowIso()) {
    throw new UserError(`Too many wrong tries. This account is locked for ${LOCK_MINUTES} minutes.`);
  }
  if (!verifyPassword(password, user.password_hash)) {
    const fails = user.failed_logins + 1;
    const lock = fails >= MAX_FAILS ? new Date(Date.now() + LOCK_MINUTES * 60000).toISOString() : null;
    db.run('UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?', lock ? 0 : fails, lock, user.id);
    audit(db, user.id, 'login_failed', 'user', user.id, lock ? { locked: true } : null);
    throw fail;
  }
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + config.sessionHours * 3600000).toISOString();
  db.tx(() => {
    db.run('UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = ? WHERE id = ?', nowIso(), user.id);
    db.run('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)', token, user.id, nowIso(), expires);
    audit(db, user.id, 'login', 'user', user.id);
  });
  return { token, user };
}

function userForToken(db, token) {
  if (!token) return null;
  const row = db.get(
    `SELECT u.*, a.type AS account_type, a.name AS account_name, a.code AS account_code
       FROM sessions s JOIN users u ON u.id = s.user_id LEFT JOIN accounts a ON a.id = u.account_id
      WHERE s.token = ? AND s.expires_at > ? AND u.active = 1`,
    token, nowIso(),
  );
  return row || null;
}

function logout(db, token) {
  db.run('DELETE FROM sessions WHERE token = ?', token);
}

function changePassword(db, user, current, next) {
  const row = db.get('SELECT password_hash FROM users WHERE id = ?', user.id);
  if (!verifyPassword(current, row.password_hash)) throw new UserError('The current password is wrong.');
  checkNewPassword(next);
  db.run('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?', hashPassword(next), user.id);
  audit(db, user.id, 'password_changed', 'user', user.id);
}

module.exports = { hashPassword, verifyPassword, tempPassword, checkNewPassword, login, userForToken, logout, changePassword };
