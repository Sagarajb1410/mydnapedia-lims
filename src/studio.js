// Report Centre: the Report Studio tool (convert the partner report, counselling
// form, action plan) served from the LIMS and linked to it.
//
// The tool is one HTML file that runs entirely in the browser, so client data
// stays inside our system. It is not kept in the code: the admin installs it
// once (Admin, Report Centre), or it sits in studio/report-studio.html next to
// the code. Before serving it, the LIMS:
//  - names it "Report Centre",
//  - replaces its built-in partner name list with the admin's leakTerms setting,
//  - points its LIMS tab at this LIMS, with a sign-in key for the person
//    opening it, so documents go straight onto the right sample.
// The tool talks to the LIMS with its own small protocol (ping, find,
// loadCase, push), handled by api() below.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const config = require('./config');
const samples = require('./samples');
const reports = require('./reports');
const counselling = require('./counselling');
const form = require('./counselling-form');
const { FORM_PATCHES } = require('./studio-form');
const { nowIso, audit, UserError, getSetting } = require('./util');

const STORE_KEY = 'studio/report-studio.html';
const FILE = path.resolve(__dirname, '..', 'studio', 'report-studio.html');
const NAME = 'Report Centre';

// Exact pieces of the tool's code that the LIMS adjusts. If a new version of
// the tool changes them, linking is switched off and the admin is told.
const LINK_PATCHES = [
  ['$o=e=>!!(e?.lims?.url&&e?.lims?.key)', '$o=e=>!!(window.__LIMS||e?.lims?.url&&e?.lims?.key)'],
  ['let r=o2(e.lims.url);if(r)throw new Error(r);', 'let r=window.__LIMS?"":o2(e.lims.url);if(r)throw new Error(r);'],
  ['fetch(e.lims.url.trim(),', 'fetch((window.__LIMS?window.__LIMS.url:e.lims.url).trim(),'],
  ['key:e.lims.key.trim()', 'key:(window.__LIMS?window.__LIMS.key:e.lims.key).trim()'],
];
const TERMS_RE = /partnerTerms:\[[^\]]*\]/;

function looksLikeStudio(text) {
  return text.includes('mdp-report-studio') && TERMS_RE.test(text) && text.includes('id="pick"');
}

// The built-in partner names are taken out before the file is stored.
function scrub(text) {
  return text.replace(TERMS_RE, 'partnerTerms:[]');
}

function install(db, storage, user, file) {
  if (user.role !== 'admin') throw new UserError('Only the admin can install the Report Centre tool.');
  const text = file && file.data ? file.data.toString('utf8') : '';
  if (!looksLikeStudio(text)) throw new UserError('That file is not the Report Studio HTML file.');
  const clean = scrub(text);
  storage.put(STORE_KEY, Buffer.from(clean, 'utf8'));
  const linked = LINK_PATCHES.every(([from]) => clean.includes(from));
  audit(db, user.id, 'report_centre_installed', 'settings', null, { size: clean.length, linked });
  cache = null;
  return { linked };
}

let cache = null; // { source, base, linked, terms }

function source(storage) {
  if (storage.exists(STORE_KEY)) return { from: 'installed', text: storage.get(STORE_KEY).toString('utf8') };
  if (fs.existsSync(FILE)) return { from: 'bundled', text: scrub(fs.readFileSync(FILE, 'utf8')) };
  return null;
}

function status(storage) {
  const s = source(storage);
  if (!s) return { installed: false };
  return { installed: true, from: s.from, linked: LINK_PATCHES.every(([from]) => s.text.includes(from)) };
}

const js = (v) => JSON.stringify(v).replace(/</g, '\\u003c');

function base(db, storage) {
  const terms = reports.leakTerms(db);
  const s = source(storage);
  if (!s) return null;
  if (cache && cache.raw === s.text && cache.terms === terms.join('|')) return cache;
  let text = s.text.replace(TERMS_RE, `partnerTerms:${js(terms)}`);
  const linked = LINK_PATCHES.every(([from]) => text.includes(from));
  if (linked) for (const [from, to] of LINK_PATCHES) text = text.replace(from, () => to);
  // Reads counselling forms whose layout was changed in Word (see studio-form.js).
  if (FORM_PATCHES.every(([from]) => text.includes(from))) for (const [from, to] of FORM_PATCHES) text = text.replace(from, () => to);
  text = text.replace(/Report Studio/g, NAME);
  cache = { raw: s.text, terms: terms.join('|'), text, linked };
  return cache;
}

// A sign-in key for the tool, valid as long as a normal sign-in.
function keyFor(db, user) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + config.sessionHours * 3600000).toISOString();
  db.run('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)', token, user.id, nowIso(), expires);
  return token;
}

// The page for one person, optionally opened on one sample.
function page(db, storage, user, { sample, step } = {}) {
  const b = base(db, storage);
  if (!b) return null;
  const head = b.linked
    ? `<script>window.__LIMS=${js({ url: '/studio/api', key: keyFor(db, user), sample: sample || '', step: step || '', role: user.role })};</script>`
    : '';
  const tail = b.linked && sample ? `<script>${OPENER}</script>` : '';
  return b.text.replace('<head>', () => `<head>${head}`).replace('</body>', () => `${tail}</body>`);
}

// Runs inside the tool when it is opened on a sample: loads the partner's PDF
// (for lab staff) and the client's details or saved case from the LIMS, so
// nobody downloads and re-uploads files by hand.
const OPENER = `(function(){
var L=window.__LIMS,$=function(s){return document.querySelector(s)};
function wait(test,ms){return new Promise(function(ok,no){var t0=Date.now();(function loop(){var v=test();if(v)return ok(v);if(Date.now()-t0>ms)return no(new Error('timeout'));setTimeout(loop,150)})()})}
function tab(name){var b=document.querySelector('[role=tab][data-tab="'+name+'"]');if(b)b.click()}
function pause(ms){return new Promise(function(ok){setTimeout(ok,ms)})}
async function loadPdf(){
  var r=await fetch('/studio/source/'+encodeURIComponent(L.sample),{credentials:'same-origin'});
  if(!r.ok)return false;
  var blob=await r.blob(),name=decodeURIComponent(r.headers.get('X-File-Name')||'partner-report.pdf');
  var dt=new DataTransfer();dt.items.add(new File([blob],name,{type:'application/pdf'}));
  var pick=$('#pick');pick.files=dt.files;pick.dispatchEvent(new Event('change',{bubbles:true}));await pause(3000);return true;
}
async function run(){
  await wait(function(){var b=$('#boot');return !b||b.hidden||getComputedStyle(b).display==='none'},60000);
  if(L.step==='convert')await loadPdf();
  tab('lims');var id=await wait(function(){return $('#l-id')},5000);id.value=L.sample;
  $('#l-find').click();await wait(function(){var f=$('#l-found');return f&&!f.hidden},15000);
  if(L.step==='convert'){$('#l-use').click();tab('convert');return;}
  var c=$('#l-case');if(c&&!c.hidden){c.click();await pause(300);if(c.dataset.armed)c.click();await pause(1500);}
  else $('#l-use').click();
  if(await loadPdf()&&/No client open/.test(($('#caseName')||{}).textContent||'')&&c&&!c.hidden){
    tab('lims');c.click();await pause(300);if(c.dataset.armed)c.click();await pause(1500);
  }
  tab(L.step==='plan'?'plan':'form');
}
run().catch(function(e){console.warn('Report Centre: could not open the sample automatically',e)});
})();`;

// ---------- The tool's LIMS protocol ----------

function ageOf(dob) {
  const d = new Date(dob + 'T00:00:00+05:30');
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  let a = now.getUTCFullYear() - d.getUTCFullYear();
  if (now < new Date(Date.UTC(now.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))) a -= 1;
  return String(a);
}

function docs(db, samplePk) {
  return db.all('SELECT * FROM studio_docs WHERE sample_pk = ? ORDER BY id DESC', samplePk);
}

// The latest case saved from the tool, else one built from the LIMS form.
function caseFor(db, storage, user, s) {
  const saved = db.get("SELECT * FROM studio_docs WHERE sample_pk = ? AND kind = 'case' ORDER BY id DESC LIMIT 1", s.id);
  if (saved) return storage.get(saved.file_key).toString('utf8');
  if (['admin', 'counsellor'].includes(user.role) && counselling.STAGES.includes(s.status)) return JSON.stringify(counselling.caseFile(db, user, s.sample_id));
  return null;
}

function saveDoc(db, storage, user, s, kind, name, mime, data) {
  const ext = { form: 'docx', case: 'json' }[kind] || 'bin';
  const key = `studio/${s.sample_id}/${kind}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}.${ext}`;
  storage.put(key, data);
  db.run('INSERT INTO studio_docs (sample_pk, kind, file_key, file_name, mime, size, uploaded_by, uploaded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    s.id, kind, key, String(name || `${kind}.${ext}`).slice(0, 200), mime || '', data.length, user.id, nowIso());
}

// A counselling form saved in the tool fills the LIMS form too, while the
// LIMS form is still open for changes.
function formFromCase(db, user, s, caseJson) {
  if (!['admin', 'counsellor'].includes(user.role) || !counselling.FORM_OPEN.includes(s.status)) return '';
  const existing = counselling.loadForm(db, s.id);
  if (existing && existing.status === 'complete') return '';
  let c;
  try { c = JSON.parse(caseJson); } catch { return ''; }
  if (!c || !c.form) return '';
  const body = {};
  for (const f of form.FIELDS) {
    const v = form.get(c.form, f.key);
    if (v != null && v !== '') body[f.key] = Array.isArray(v) ? v.map(String) : String(v);
  }
  const done = form.missing(form.fromBody(body)).length === 0;
  try {
    counselling.saveForm(db, user, s.sample_id, body, { complete: done });
    return done ? 'The LIMS counselling form is filled in and complete.' : 'The LIMS counselling form is filled in as a draft.';
  } catch (e) {
    if (e instanceof UserError) return `The LIMS counselling form was not updated: ${e.message}`;
    throw e;
  }
}

function api(db, storage, req) {
  const user = req.user;
  const id = String(req.sampleId || '').trim().toUpperCase();
  if (req.action === 'ping') return { lab: getSetting(db, 'labName') };
  if (!id) throw new UserError('Type or scan the sample ID first.');
  const s = samples.load(db, user, id);
  const p = db.get('SELECT * FROM patients WHERE id = ?', s.patient_id);
  if (req.action === 'find') {
    const files = [...reports.forSample(db, s.id).map((r) => r.file_name), ...counselling.plansFor(db, s.id).map((r) => r.file_name), ...docs(db, s.id).map((d) => d.file_name)];
    return {
      sample: { sampleId: s.sample_id, name: p.full_name, gender: p.gender, age: ageOf(p.dob), dob: p.dob, phone: p.mobile, email: p.email || '', address: p.address || '', city: [p.city, p.state, p.pincode].filter(Boolean).join(', '), files },
      stage: samples.STATUSES[s.status],
      hasCase: Boolean(caseFor(db, storage, user, s)),
    };
  }
  if (req.action === 'loadCase') {
    const json = caseFor(db, storage, user, s);
    return json ? { found: true, json } : { found: false };
  }
  if (req.action === 'push') {
    const data = Buffer.from(String(req.b64 || ''), 'base64');
    if (!data.length) throw new UserError('The document was empty.');
    const file = { filename: req.name, type: req.mime, data };
    const stage = () => samples.STATUSES[db.get('SELECT status FROM samples WHERE id = ?', s.id).status];
    let r;
    switch (req.kind) {
      case 'report':
        r = reports.uploadBranded(db, storage, user, s.sample_id, file);
        if (!r.check.ok && !r.check.pictureOnly) throw new UserError(`Blocked by the LIMS check: ${r.check.problems.join(' ')}`);
        audit(db, user.id, 'report_centre_push', 'sample', s.sample_id, { kind: 'report', version: r.version });
        return { status: true, stage: stage(), skipped: `Stored as v${r.version}. ${r.check.ok ? 'It passed the check' : 'It is pictures only, so the admin checks it by eye,'} and waits for the admin's approval in the LIMS` };
      case 'partner_report':
        r = reports.uploadSource(db, storage, user, s.sample_id, file);
        return { status: true, stage: stage() };
      case 'plan':
        r = counselling.uploadPlan(db, storage, user, s.sample_id, file);
        if (!r.check.ok) throw new UserError(`Blocked by the LIMS check: ${r.check.problems.join(' ')}`);
        return { status: true, stage: stage(), skipped: `Stored as v${r.version}. It waits for the admin's approval in the LIMS` };
      case 'form':
      case 'case': {
        if (!['admin', 'counsellor'].includes(user.role) && req.kind === 'form') throw new UserError('Only counsellors and the admin can store the counselling form.');
        saveDoc(db, storage, user, s, req.kind, req.name, req.mime, data);
        const note = req.kind === 'case' ? formFromCase(db, user, s, data.toString('utf8')) : '';
        audit(db, user.id, 'report_centre_push', 'sample', s.sample_id, { kind: req.kind });
        return { status: Boolean(note), stage: stage(), skipped: note };
      }
      default:
        throw new UserError('The LIMS does not know that kind of document.');
    }
  }
  throw new UserError('Unknown request.');
}

module.exports = { install, status, page, api, docs, scrub, looksLikeStudio, NAME, LINK_PATCHES };
