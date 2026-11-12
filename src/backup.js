// Nightly backup: a consistent copy of the database plus every stored file,
// in DATA_DIR/backups/YYYY-MM-DD/. Keeps the last 14 days. The LIMS writes it
// itself once a day; on the AWS server a nightly job also copies it to S3.
//   node src/backup.js
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const config = require('./config');
const { DatabaseSync } = require('node:sqlite');
const { istDate } = require('./util');
const { zip } = require('./xlsx');

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

// One downloadable file for the admin: the database plus every stored file,
// as a zip (lims.sqlite at the top, the files under files/).
function backupZip(db, filesDir) {
  const tmp = path.join(os.tmpdir(), `lims-download-${process.pid}-${Date.now()}.sqlite`);
  try {
    db.raw.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
    const entries = [['lims.sqlite', fs.readFileSync(tmp)]];
    if (filesDir && fs.existsSync(filesDir)) {
      for (const f of fs.readdirSync(filesDir, { recursive: true })) {
        const full = path.join(filesDir, f);
        if (fs.statSync(full).isFile()) entries.push([`files/${f.split(path.sep).join('/')}`, fs.readFileSync(full)]);
      }
    }
    return zip(entries);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

if (require.main === module) {
  const dest = backup();
  console.log(`Backup written to ${dest}`);
}

module.exports = { backup, backupZip };
