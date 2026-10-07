// Nightly backup: a readable copy of the database and the stored files, 14 days kept.
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');
const db = require('../src/db');
const seed = require('../src/seed');
const { backup } = require('../src/backup');

test('backup copies the database and files, and keeps 14 days', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lims-backup-'));
  const d = db.open(path.join(dir, 'lims.sqlite'));
  seed.demo(d, null);
  fs.mkdirSync(path.join(dir, 'files', 'reports'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'files', 'reports', 'a.pdf'), '%PDF-1.4 test');
  for (let i = 1; i <= 15; i++) fs.mkdirSync(path.join(dir, 'backups', `2026-01-${String(i).padStart(2, '0')}`), { recursive: true });
  const dest = backup(dir, '2026-10-07');
  const copy = new DatabaseSync(path.join(dest, 'lims.sqlite'));
  assert.strictEqual(copy.prepare('SELECT COUNT(*) n FROM samples').get().n, d.get('SELECT COUNT(*) n FROM samples').n);
  copy.close();
  assert.strictEqual(fs.readFileSync(path.join(dest, 'files', 'reports', 'a.pdf'), 'utf8'), '%PDF-1.4 test');
  const days = fs.readdirSync(path.join(dir, 'backups')).sort();
  assert.strictEqual(days.length, 14);
  assert.strictEqual(days.at(-1), '2026-10-07');
});
