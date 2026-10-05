// Starts the LIMS. Usage:
//   node src/server.js          normal start (creates the first admin on first run)
//   node src/server.js --demo   first run fills the database with dummy data
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 13)) {
  console.error(`This LIMS needs Node.js 22.13 or newer (you have ${process.versions.node}). Install the LTS version from https://nodejs.org and start again.`);
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
  const pw = seed.firstRun(db);
  if (pw) {
    const note = path.join(config.dataDir, 'FIRST-SIGN-IN.txt');
    fs.writeFileSync(note, `First admin sign-in\nEmail: admin@mydnapedia.example\nOne-time password: ${pw}\nChange it after signing in, then delete this file.\n`);
    console.log(`\nFirst run. Sign in as admin@mydnapedia.example with the one-time password: ${pw}`);
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

const app = createApp({ db, storage: storage.create() });
app.server().listen(config.port, config.host, () => {
  console.log(`MyDNAPedia LIMS (test version) is running. Open http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port} in your browser.`);
  console.log('Keep this window open while you use it. Press Ctrl+C to stop.');
});
