// Nightly backup: a consistent copy of the database plus every stored file,
// in DATA_DIR/backups/YYYY-MM-DD/. Keeps the last 14 days. On the live server
// a nightly job runs this and then copies the folder to the S3 backup bucket.
//   node src/backup.js
const fs = require('node:fs');
const path = require('node:path');
const config = require('./config');
const { DatabaseSync } = require('node:sqlite');
const { istDate } = require('./util');

const KEEP_DAYS = 14;

function backup(dataDir = config.dataDir, day = istDate()) {
  const root = path.join(dataDir, 'backups');
  const dest = path.join(root, day);
  fs.mkdirSync(dest, { recursive: true });
  const dbFile = path.join(dest, 'lims.sqlite');
  fs.rmSync(dbFile, { force: true });
  // VACUUM INTO writes a clean, consistent copy even while the LIMS is running.
  const db = new DatabaseSync(path.join(dataDir, 'lims.sqlite'));
  try { db.exec(`VACUUM INTO '${dbFile.replace(/'/g, "''")}'`); } finally { db.close(); }
  const files = path.join(dataDir, 'files');
  if (fs.existsSync(files)) fs.cpSync(files, path.join(dest, 'files'), { recursive: true });
  // Old days are removed; the S3 copy keeps its own history.
  const days = fs.readdirSync(root).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  for (const d of days.slice(0, Math.max(0, days.length - KEEP_DAYS))) fs.rmSync(path.join(root, d), { recursive: true, force: true });
  return dest;
}

if (require.main === module) {
  const dest = backup();
  console.log(`Backup written to ${dest}`);
}

module.exports = { backup };
