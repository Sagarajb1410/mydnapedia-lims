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
const { patchForm } = require('./studio-form');
const { scopePlan } = require('./studio-plan');
const { nowIso, audit, UserError, getSetting } = require('./util');

// Two copies of the tool: the main one (360 Premium, Fitness, Cardiac) and the
// Skin Health one, which brands, words and checks skin reports as Skin Health.
// Samples of a skin test open the Skin Health copy for converting.
const TOOLS = {
  main: { key: 'studio/report-studio.html', file: path.resolve(__dirname, '..', 'studio', 'report-studio.html'), label: 'Report Studio' },
  skin: { key: 'studio/skin-health-studio.html', file: path.resolve(__dirname, '..', 'studio', 'skin-health-studio.html'), label: 'Skin Health Studio' },
};
const NAME = 'Report Centre';

// Pieces of the tool's code that the LIMS adjusts so its LIMS tab talks to this
// LIMS. The tool is minified, so they are found by shape, not by name. If a new
// version changes them, linking is switched off and the admin is told.
const LINK_PATCHES = [
  [/([\w$]+)=e=>!!\(e\?\.lims\?\.url&&e\?\.lims\?\.key\)/, (m, f) => `${f}=e=>!!(window.__LIMS||e?.lims?.url&&e?.lims?.key)`],
  [/let r=([\w$]+)\(e\.lims\.url\);if\(r\)throw new Error\(r\);/, (m, f) => `let r=window.__LIMS?"":${f}(e.lims.url);if(r)throw new Error(r);`],
  [/fetch\(e\.lims\.url\.trim\(\),/, () => 'fetch((window.__LIMS?window.__LIMS.url:e.lims.url).trim(),'],
  [/key:e\.lims\.key\.trim\(\)/, () => 'key:(window.__LIMS?window.__LIMS.key:e.lims.key).trim()'],
];
const TERMS_RE = /partnerTerms:\[[^\]]*\]/;
// The Skin Health copy adds its own partner product names in code.
const EXTRA_TERMS_RE = /partnerTerms=\[\.\.\.t\.partnerTerms(?:,"[^"]*")*\]/g;

// The main copy reads any partner report as 360 Premium. A skin report (two or
// more of its section headings) is refused there with a pointer to the Skin
// Health copy, instead of coming out labelled 360 Premium.
const SKIN_HEADINGS = /^(Skin Texture and Aging|Skin Damage|Hair Care|Skin Nutrition|Skin Inflammation)$/;
const ANALYSE_RE = /return\{pages:([\w$]+),fields:([\w$]+),converted:([\w$]+)\}\}/;
const SKIN_REFUSAL = 'This is a Skin Health report. Convert it in Skin Health Studio: open it from the client\'s Skin Health sample in the LIMS, or use the Skin Health button on the Reports screen.';
function guardSkin(text) {
  // Opened on a sample, it hands over to the Skin Health copy, which loads the partner's PDF itself.
  const handOver = 'if(window.__LIMS&&window.__LIMS.sample&&window.__LIMS.skin&&!window.__mdpSkinGo){window.__mdpSkinGo=1;location.href="/studio?sample="+encodeURIComponent(window.__LIMS.sample)+"&step=convert&tool=skin";throw new Error("This is a Skin Health report. Opening Skin Health Studio\u2026")}';
  return text.replace(ANALYSE_RE, (m, pages) => `if(new Set(${pages}.flatMap(x=>(x.body||[]).map(g=>String(g.text||"").trim()).filter(g=>${SKIN_HEADINGS}.test(g)))).size>=2){${handOver}throw new Error(${JSON.stringify(SKIN_REFUSAL)})}${m}`);
}

// The main copy brands every report "MDP 360 PREMIUM" unless it recognises the
// layout (only Fitness, by its picture pages). Opened on a sample, the LIMS tells
// it the sample's test, so Fitness and Cardiac reports carry their own name in
// the header and foreword. Inserted at the start of the conversion, after the
// layout check, so the sample's test has the last word.
const CONVERT_RE = /(function [\w$]+\(e,t,r,n,i=\(\)=>\{\}\)\{let a=\[\],s=\[\],o=[\w$]+\(e\),\{pages:([\w$]+),fields:[\w$]+,converted:([\w$]+)\}=[\w$]+\(o\);(?:t=[\w$]+\(\2,t\);)?)(?=if\(\3\)throw new Error\("This file has already been converted)/;
const USE_PRODUCT = 'if(window.__LIMS&&window.__LIMS.product){let P=window.__LIMS.product;t=JSON.parse(JSON.stringify(t));t.brand.product=P.brand;t.foreword.text=String(t.foreword.text||"").replace(/360 premium/gi,P.short);if(t.plan)t.plan.tier=P.short}';
function useProduct(text) {
  return text.replace(CONVERT_RE, (m) => m + USE_PRODUCT);
}

// What the main copy should call a sample's report, or null for 360 Premium
// (its own default) and tests that are not converted from a partner report.
function productFor(db, sampleId) {
  if (!sampleId) return null;
  const t = db.get('SELECT t.code, t.name, t.route FROM samples s JOIN tests t ON t.id = s.test_id WHERE s.sample_id = ?', sampleId);
  if (!t || t.route !== 'partner_lab' || /360/.test(t.name)) return null;
  return { brand: t.name.toUpperCase(), short: t.name.replace(/^MDP\s+/i, '') };
}

const SKIN_CARE_RE = /(skin:\{id:"skin",[^}]*?)care:!1\}/;

const linkable = (text) => LINK_PATCHES.every(([re]) => re.test(text));

function looksLikeStudio(text) {
  return text.includes('mdp-report-studio') && TERMS_RE.test(text) && text.includes('id="pick"');
}

// Which copy a file is.
function toolOf(text) {
  return /<title>Skin Health Studio<\/title>/.test(text) ? 'skin' : 'main';
}

// The built-in partner names are taken out before the file is stored.
function scrub(text) {
  return text.replace(TERMS_RE, 'partnerTerms:[]').replace(EXTRA_TERMS_RE, 'partnerTerms=[...t.partnerTerms]');
}

function install(db, storage, user, file) {
  if (user.role !== 'admin') throw new UserError('Only the admin can install the Report Centre tool.');
  const text = file && file.data ? file.data.toString('utf8') : '';
  if (!looksLikeStudio(text)) throw new UserError('That file is not the Report Studio HTML file.');
  const clean = scrub(text);
  const tool = toolOf(clean);
  storage.put(TOOLS[tool].key, Buffer.from(clean, 'utf8'));
  const linked = linkable(clean);
  audit(db, user.id, 'report_centre_installed', 'settings', null, { tool, size: clean.length, linked });
  cache.delete(tool);
  return { linked, tool: TOOLS[tool].label };
}

const cache = new Map(); // tool -> { raw, terms, text, linked }

function source(storage, tool = 'main') {
  const t = TOOLS[tool];
  if (storage.exists(t.key)) return { from: 'installed', text: storage.get(t.key).toString('utf8') };
  if (fs.existsSync(t.file)) return { from: 'bundled', text: scrub(fs.readFileSync(t.file, 'utf8')) };
  return null;
}

// { main: {...}, skin: {...} }, each { installed, from, linked, label }.
function status(storage) {
  const out = {};
  for (const tool of Object.keys(TOOLS)) {
    const s = source(storage, tool);
    out[tool] = s ? { installed: true, from: s.from, linked: linkable(s.text), label: TOOLS[tool].label } : { installed: false, label: TOOLS[tool].label };
  }
  return out;
}

const js = (v) => JSON.stringify(v).replace(/</g, '\\u003c');

function base(db, storage, tool = 'main') {
  const terms = reports.leakTerms(db);
  const s = source(storage, tool);
  if (!s) return null;
  const hit = cache.get(tool);
  if (hit && hit.raw === s.text && hit.terms === terms.join('|')) return hit;
  let text = s.text.replace(TERMS_RE, `partnerTerms:${js(terms)}`);
  const linked = linkable(text);
  if (linked) for (const [re, to] of LINK_PATCHES) text = text.replace(re, to);
  // Reads counselling forms whose layout was changed in Word (see studio-form.js).
  text = patchForm(text);
  // Each action plan fits its own test (see studio-plan.js).
  text = scopePlan(text);
  if (tool === 'main') text = useProduct(guardSkin(text));
  // The Skin Health copy was made without the counselling form and action plan
  // tabs. Every test gets an action plan, so they are switched on.
  if (tool === 'skin') text = text.replace(SKIN_CARE_RE, '$1care:!0}');
  text = text.replace(/Report Studio/g, NAME).replace(/<title>Skin Health Studio<\/title>/, `<title>${NAME} · Skin Health</title>`);
  const out = { raw: s.text, terms: terms.join('|'), text, linked };
  cache.set(tool, out);
  return out;
}

// The copy to open: the Skin Health one for a skin test's sample (converting,
// counselling form and action plan alike), when it is installed; the main one
// otherwise.
const isSkinTest = (db, sampleId) => {
  const t = db.get('SELECT t.code, t.name FROM samples s JOIN tests t ON t.id = s.test_id WHERE s.sample_id = ?', sampleId);
  return Boolean(t && /skin/i.test(`${t.code} ${t.name}`));
};

function toolFor(db, storage, user, sampleId, step, asked) {
  if (asked === 'skin' && source(storage, 'skin')) return 'skin';
  if (!sampleId) return 'main';
  return isSkinTest(db, sampleId) && source(storage, 'skin') ? 'skin' : 'main';
}

// A sign-in key for the tool, valid as long as a normal sign-in.
function keyFor(db, user) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + config.sessionHours * 3600000).toISOString();
  db.run('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)', token, user.id, nowIso(), expires);
  return token;
}

// Whether the case saved for a sample already holds the converted results.
function hasResults(db, storage, user, sampleId) {
  if (!sampleId) return false;
  try {
    const s = samples.load(db, user, sampleId);
    const saved = db.get("SELECT file_key FROM studio_docs WHERE sample_pk = ? AND kind = 'case' ORDER BY id DESC LIMIT 1", s.id);
    return Boolean(saved && JSON.parse(storage.get(saved.file_key).toString('utf8')).clinical);
  } catch { return false; }
}

// The page for one person, optionally opened on one sample.
function page(db, storage, user, { sample, step, tool } = {}) {
  const b = base(db, storage, toolFor(db, storage, user, sample, step, tool));
  if (!b) return null;
  const head = b.linked
    ? `<script>window.__LIMS=${js({ url: '/studio/api', key: keyFor(db, user), sample: sample || '', step: step || '', role: user.role, results: hasResults(db, storage, user, sample), product: productFor(db, sample), skin: Boolean(source(storage, 'skin')) })};</script>`
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
  // The saved case already has the results: no need to read the partner's PDF again.
  if(!L.results&&await loadPdf()&&/No client open/.test(($('#caseName')||{}).textContent||'')&&c&&!c.hidden){
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

// The latest case saved from the tool (results and answers), else one built
// from the LIMS form. When the counsellor filled in or changed the LIMS form
// after the case was saved, their answers replace the saved ones, so the action
// plan can be made without converting the report again.
function caseFor(db, storage, user, s) {
  const saved = db.get("SELECT * FROM studio_docs WHERE sample_pk = ? AND kind = 'case' ORDER BY id DESC LIMIT 1", s.id);
  const counsellingRole = ['admin', 'counsellor'].includes(user.role);
  if (!saved) return counsellingRole && counselling.STAGES.includes(s.status) ? JSON.stringify(counselling.caseFile(db, user, s.sample_id)) : null;
  const json = storage.get(saved.file_key).toString('utf8');
  const lims = counsellingRole ? counselling.loadForm(db, s.id) : null;
  if (!lims || lims.updated_at <= saved.uploaded_at || !counselling.STAGES.includes(s.status)) return json;
  let c;
  try { c = JSON.parse(json); } catch { return json; }
  const fresh = counselling.caseFile(db, user, s.sample_id);
  const merged = { ...(c.form || {}), life: { ...((c.form || {}).life || {}) } };
  for (const f of form.FIELDS) {
    const v = form.get(fresh.form, f.key);
    if (v == null || v === '' || (Array.isArray(v) && !v.length)) continue;
    const [a, b] = f.key.split('.');
    if (b) merged[a] = { ...(merged[a] || {}), [b]: v }; else merged[a] = v;
  }
  if (fresh.form.counsellor) merged.counsellor = fresh.form.counsellor;
  if (fresh.form.sessionDate) merged.sessionDate = fresh.form.sessionDate;
  return JSON.stringify({ ...c, form: merged, mail: { ...(c.mail || {}), ...Object.fromEntries(Object.entries(fresh.mail).filter(([, v]) => v)) } });
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
    let json = caseFor(db, storage, user, s);
    // The Skin Health copy only opens cases marked as skin.
    if (json && isSkinTest(db, s.sample_id)) {
      try { json = JSON.stringify({ ...JSON.parse(json), product: 'skin' }); } catch { /* leave it as stored */ }
    }
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

module.exports = { install, status, page, api, docs, scrub, looksLikeStudio, toolOf, guardSkin, useProduct, NAME, LINK_PATCHES, TOOLS };
