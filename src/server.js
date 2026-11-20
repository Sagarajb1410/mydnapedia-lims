// Starts the LIMS. Usage:
//   node src/server.js          normal start (creates the first admin on first run)
//   node src/server.js --demo   first run fills the database with dummy data
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 13)) {
  console.error(`\n  This LIMS needs Node.js 22.13 or newer, and this computer has ${process.versions.node}.\n  Install the LTS version from https://nodejs.org and start again.\n`);
  process.exit(1);
}
const path = require('node:path');
const fs = require('node:fs');
const config = require('./config');
const dbm = require('./db');
const seed = require('./seed');
const storage = require('./storage');
const billing = require('./billing');
const tracking = require('./tracking');
const { createApp } = require('./web/app');

const db = dbm.open(path.join(config.dataDir, 'lims.sqlite'));

if (process.argv.includes('--demo') && config.live) {
  console.error('\n  Dummy data cannot be added to the live LIMS (LIMS_STAGE=live).\n');
  process.exit(1);
}
if (process.argv.includes('--demo')) {
  if (seed.demo(db, storage.create())) {
    console.log('\nDummy data added. Every demo account uses the password: ' + seed.DEMO_PASSWORD);
    console.log('  admin@mydnapedia.example  (admin)');
    console.log('  lab@demo.example          (lab staff)');
    console.log('  sunrise@demo.example      (B2B partner, franchise)');
    console.log('  carewell@demo.example     (B2B partner, clinic)');
    console.log('  healthplus@demo.example   (B2B supplier)');
    console.log('  counsellor@demo.example   (counsellor)\n');
  }
} else {
  const adminEmail = process.env.FIRST_ADMIN_EMAIL || 'admin@mydnapedia.example';
  const pw = seed.firstRun(db, { adminEmail });
  if (pw) {
    const note = path.join(config.dataDir, 'FIRST-SIGN-IN.txt');
    fs.writeFileSync(note, `First admin sign-in\nEmail: ${adminEmail}\nOne-time password: ${pw}\nChange it after signing in, then delete this file.\n`, { mode: 0o600 });
    console.log(`\nFirst run. Sign in as ${adminEmail} with the one-time password: ${pw}`);
    console.log(`(also saved in ${note})\n`);
  }
}

// Daily low-balance reminders: checked at start and every hour; each partner
// gets at most one reminder per day.
const runReminders = () => {
  try { billing.lowBalanceReminders(db); } catch (e) { console.error('Reminder check failed:', e); }
  try { tracking.tatAlerts(db); } catch (e) { console.error('TAT check failed:', e); }
};
runReminders();
setInterval(runReminders, 3600 * 1000).unref();

// The LIMS writes today's backup itself once a day (checked at start and every
// hour), on a computer as well as online. NIGHTLY_BACKUP=0 turns it off; the
// demo data is never backed up.
if (process.env.NIGHTLY_BACKUP !== '0' && !process.argv.includes('--demo')) {
  const { backup } = require('./backup');
  const { istDate } = require('./util');
  const daily = () => {
    try {
      if (!fs.existsSync(path.join(config.dataDir, 'backups', istDate(), 'lims.sqlite'))) console.log('Backup written to ' + backup());
    } catch (e) { console.error('Backup failed:', e); }
  };
  daily();
  setInterval(daily, 3600 * 1000).unref();
}

const app = createApp({ db, storage: storage.create() });
const urlFor = (port) => `http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${port}`;

// --open starts the browser once the LIMS is ready (used by the start files).
function openBrowser(url) {
  const { spawn } = require('node:child_process');
  const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try { spawn(cmd, args, { detached: true, stdio: 'ignore' }).on('error', () => {}).unref(); } catch { /* open it by hand */ }
}

// Windows can reserve port 3000 for itself (Hyper-V, WSL or Docker), and then
// refuses it with EACCES. Unless a PORT was set on purpose, the LIMS then moves
// to another port and remembers it in DATA_DIR/port.txt, so it keeps the same
// address next time and a second window still finds the first one running.
const portFile = path.join(config.dataDir, 'port.txt');
const fixedPort = Boolean(process.env.PORT);
const remembered = fixedPort ? null : Number((() => { try { return fs.readFileSync(portFile, 'utf8').trim(); } catch { return ''; } })()) || null;
const SPARE_PORTS = [8080, 8088, 8800, 9090, 4300, 5080, 18080];
const tries = fixedPort ? [config.port] : [...new Set([remembered || config.port, config.port, ...SPARE_PORTS])];

function start(i) {
  const port = tries[i];
  const server = app.server();
  server.once('error', (e) => {
    const refused = e.code === 'EACCES' || (e.code === 'EADDRINUSE' && port !== remembered && port !== config.port);
    if (refused && i + 1 < tries.length) {
      if (e.code === 'EACCES') console.log(`  Windows does not allow port ${port} on this computer. Trying another port...`);
      return start(i + 1);
    }
    const url = urlFor(port);
    if (e.code === 'EADDRINUSE') {
      console.error(`\n  Port ${port} is already in use. The LIMS is probably already running in another window:\n  open ${url} in your browser, or close the other window and start again.\n  To switch between the demo and your own data, close the other LIMS window first.\n`);
    } else if (e.code === 'EACCES') {
      console.error(`\n  This computer does not allow the LIMS to use port ${port}${fixedPort ? '' : ' or any of the spare ports'}.\n  Choose another: add the line  set PORT=8123  above the "node" line in the start file, then start again.\n`);
    } else {
      console.error(e);
    }
    process.exit(1);
  });
  server.listen(port, config.host, () => {
    const url = urlFor(port);
    config.port = port;
    if (!process.env.PUBLIC_URL) config.publicUrl = `http://localhost:${port}`;
    if (!fixedPort) {
      try { if (port === 3000) fs.rmSync(portFile, { force: true }); else fs.writeFileSync(portFile, String(port)); } catch { /* not important */ }
    }
    console.log(`  MyDNAPedia LIMS${config.live ? '' : ' (test version)'} is running at ${url}`);
    console.log('  Keep this window open while you use it. Press Ctrl+C to stop.');
    if (process.argv.includes('--open')) openBrowser(url);
  });
}
start(0);
