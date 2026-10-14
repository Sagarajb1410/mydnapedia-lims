// Report Centre: installing the tool, how it is served, and its LIMS protocol.
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const db = require('../src/db');
const storage = require('../src/storage');
const seed = require('../src/seed');
const pdfwrite = require('../src/pdfwrite');
const studio = require('../src/studio');
const counselling = require('../src/counselling');
const { createApp } = require('../src/web/app');

// Tests use only the copies they install, not files sitting in studio/.
for (const t of Object.values(studio.TOOLS)) t.file = path.join(os.tmpdir(), 'lims-test-no-such-studio.html');

// A stand-in for the Report Studio file with the pieces the LIMS adjusts.
const FAKE = `<!doctype html><html><head><title>Report Studio</title></head><body><input type="file" id="pick">
<script>var app="mdp-report-studio";var cfg={lims:{url:"",key:"",afterReport:"none"},partnerTerms:["Zeta Labs","ZetaGx"]};
/*$o=e=>!!(e?.lims?.url&&e?.lims?.key)*/
/*let r=o2(e.lims.url);if(r)throw new Error(r);*/
/*fetch(e.lims.url.trim(),*/
/*key:e.lims.key.trim()*/
/*let n=Mm(r),i=n.findIndex(R=>R[0]&&/parameter/i.test(R[0][0]||"")&&R[0].some(B=>/response/i.test(B)));if(n.length!==18||i!==4)throw new Error("not the form");*/
/*async function vc(e){let t,r;try{t=await ls.default.loadAsync(e)*/
/*}function jf(){return{app:"mdp-report-studio-case",version:1,patient:st.patient(),clinical:Ee.clinical,form:Ee.form}}*/
/*}function jo(e){if(e.app!=="mdp-report-studio-case"||!e.patient)throw 0}*/
/*return{alreadyConverted:a,clinical:a||!n.some(s=>s.footer)?null:wl(r,n)}*/</script></body></html>`;

async function withApp(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lims-studio-'));
  const d = db.open(':memory:');
  const store = storage.localAdapter(dir);
  seed.demo(d, store);
  const server = createApp({ db: d, storage: store }).server();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await fn({ d, store, base }); } finally { server.close(); }
}

async function signIn(base, email) {
  const res = await fetch(`${base}/login`, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `email=${encodeURIComponent(email)}&password=test1234` });
  return res.headers.get('set-cookie').split(';')[0];
}

test('Report Centre is installed, renamed and linked to the LIMS', async () => {
  await withApp(async ({ d, store, base }) => {
    const admin = d.get("SELECT * FROM users WHERE email = 'admin@mydnapedia.example'");
    assert.throws(() => studio.install(d, store, admin, { data: Buffer.from('<html>hello</html>') }), /not the Report Studio/);
    assert.deepStrictEqual(studio.install(d, store, admin, { data: Buffer.from(FAKE) }), { linked: true, tool: 'Report Studio' });
    assert.ok(!store.get('studio/report-studio.html').toString().includes('Zeta'), 'built-in partner names are removed when stored');

    const cookie = await signIn(base, 'lab@demo.example');
    const page = await (await fetch(`${base}/studio?sample=MDP00020260008&step=convert`, { headers: { cookie } })).text();
    assert.match(page, /<title>Report Centre<\/title>/);
    assert.match(page, /partnerTerms:\["Acme Genomics","AcmeGx"\]/, 'the admin\'s names are used');
    assert.match(page, /window\.__LIMS=\{"url":"\/studio\/api","key":"[0-9a-f]{64}","sample":"MDP00020260008","step":"convert"/);
    for (const to of ['$o=e=>!!(window.__LIMS||', 'let r=window.__LIMS?"":o2(e.lims.url)', 'fetch((window.__LIMS?window.__LIMS.url:e.lims.url).trim(),', 'key:(window.__LIMS?window.__LIMS.key:e.lims.key).trim()']) assert.ok(page.includes(to), to);
    assert.ok(page.includes('function mdpFormTables(r)'), 'counselling forms with a changed layout can be read');
    assert.ok(page.includes('window.__mdpCase=()=>({json:jf(),result:Ee.result,stale:Ee.stale});function jf()'), 'the converted case can be read by the LIMS');
    const opener = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).find((t) => t.includes('function keepCase'));
    assert.ok(opener, 'a conversion opened from a sample is saved in the LIMS by itself');
    assert.doesNotThrow(() => new Function(opener), 'the opener script is valid');
    const partner = await signIn(base, 'sunrise@demo.example');
    assert.notStrictEqual((await fetch(`${base}/studio`, { headers: { cookie: partner }, redirect: 'manual' })).status, 200);

    // The tool's protocol, with the key it was given.
    const key = /"key":"([0-9a-f]{64})"/.exec(page)[1];
    const call = async (body) => (await fetch(`${base}/studio/api`, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ ...body, key }) })).json();
    assert.deepStrictEqual(await call({ action: 'ping' }), { ok: true, data: { lab: 'MyDNAPedia' } });
    const found = await call({ action: 'find', sampleId: 'mdp00020260008' });
    assert.ok(found.ok);
    assert.strictEqual(found.data.sample.sampleId, 'MDP00020260008');
    assert.strictEqual(found.data.stage, 'Partner report received');
    assert.deepStrictEqual((await call({ action: 'find', sampleId: 'MDP00020269999' })).ok, false);
    // The action plan window reads the results from our white-labelled report.
    const planPage = await (await fetch(`${base}/studio?sample=MDP00020260008&step=plan`, { headers: { cookie } })).text();
    assert.match(planPage, /"planWindow":true/);
    assert.ok(planPage.includes('window.__mdpPlanWin=true'), 'the plan window shows only the form, plan and LIMS tabs');
    assert.ok(planPage.includes('clinical:(a&&!window.__mdpPlanWin)||!n.some(s=>s.footer)?null:'), 'results are read from a converted report there');
    assert.ok(planPage.includes('window.__mdpOpenCase=e=>jo(e);function jo(e)'));
    assert.ok(!page.includes('window.__mdpPlanWin=true'), 'the full Report Centre is unchanged');
    const alone = await (await fetch(`${base}/studio?step=plan`, { headers: { cookie } })).text();
    assert.ok(alone.includes('window.__mdpPlanWin=true') && alone.includes('function panel()'), 'the action plan window also opens without a sample');
    assert.strictEqual((await fetch(`${base}/studio/branded/MDP00020260008`, { headers: { cookie } })).status, 404, 'no white-labelled report yet');
    assert.match((await (await fetch(`${base}/studio/api`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ action: 'ping', key: 'nope' }) })).json()).error, /expired/);

    const s = d.get("SELECT * FROM samples WHERE sample_id = 'MDP00020260008'");
    const p = d.get('SELECT * FROM patients WHERE id = ?', s.patient_id);
    const pdf = (lines) => pdfwrite.write([lines], { title: 'MDP Skin Health', author: 'MyDNAPedia' }).toString('base64');
    const leak = await call({ action: 'push', sampleId: s.sample_id, kind: 'report', name: 'r.pdf', mime: 'application/pdf', b64: pdf(['MyDNAPedia', `Name: ${p.full_name}  Sample ID: ${s.sample_id}`, 'Analysed by Acme Genomics']) });
    assert.strictEqual(leak.ok, false);
    assert.match(leak.error, /Blocked by the LIMS check/);
    const good = await call({ action: 'push', sampleId: s.sample_id, kind: 'report', name: 'r.pdf', mime: 'application/pdf', b64: pdf(['MyDNAPedia', `Name: ${p.full_name}  Sample ID: ${s.sample_id}`, 'Your Genetic Result']) });
    assert.ok(good.ok, good.error);
    assert.strictEqual(d.get('SELECT status FROM samples WHERE id = ?', s.id).status, 'REPORT_WHITE_LABELLED');
    const branded = await fetch(`${base}/studio/branded/MDP00020260008`, { headers: { cookie } });
    assert.strictEqual(branded.status, 200, 'the plan window can load the white-labelled report');
    assert.strictEqual(branded.headers.get('content-type'), 'application/pdf');
  });
});

test('a case sent from Report Centre is stored and fills in the counselling form', async () => {
  await withApp(async ({ d, store, base }) => {
    const admin = d.get("SELECT * FROM users WHERE email = 'admin@mydnapedia.example'");
    studio.install(d, store, admin, { data: Buffer.from(FAKE) });
    const cookie = await signIn(base, 'counsellor@demo.example');
    const page = await (await fetch(`${base}/studio?sample=MDP00020260014&step=form`, { headers: { cookie } })).text();
    const key = /"key":"([0-9a-f]{64})"/.exec(page)[1];
    const call = async (body) => (await fetch(`${base}/studio/api`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ ...body, key }) })).json();
    const before = await call({ action: 'loadCase', sampleId: 'MDP00020260014' });
    assert.ok(before.data.found, 'a case is built from the LIMS when none was saved');
    const c = JSON.parse(before.data.json);
    c.form = { ...c.form, heightCm: '170', weightKg: '70', bp: '120/80', priorities: 'Walk daily', life: { diet: 'Vegetarian', actType: 'Walking', sleepHours: '7-8', tobacco: 'Never', alcohol: 'Never' } };
    const sent = await call({ action: 'push', sampleId: 'MDP00020260014', kind: 'case', name: 'case.json', mime: 'application/json', b64: Buffer.from(JSON.stringify(c)).toString('base64') });
    assert.ok(sent.ok, sent.error);
    assert.match(sent.data.skipped, /complete/);
    const s = d.get("SELECT id FROM samples WHERE sample_id = 'MDP00020260014'");
    const f = d.get('SELECT * FROM counselling_forms WHERE sample_pk = ?', s.id);
    assert.strictEqual(f.status, 'complete');
    assert.strictEqual(String(JSON.parse(f.data_json).heightCm), '170');
    const after = await call({ action: 'loadCase', sampleId: 'MDP00020260014' });
    assert.strictEqual(JSON.parse(after.data.json).form.heightCm, '170', 'the saved case comes back');
  });
});

test('the action plan reopens with the saved results and the counsellor\'s latest answers', async () => {
  await withApp(async ({ d, store, base }) => {
    const admin = d.get("SELECT * FROM users WHERE email = 'admin@mydnapedia.example'");
    const counsellor = d.get("SELECT u.*, NULL AS account_type FROM users u WHERE email = 'counsellor@demo.example'");
    studio.install(d, store, admin, { data: Buffer.from(FAKE) });
    const cookie = await signIn(base, 'admin@mydnapedia.example');
    const open = async () => (await fetch(`${base}/studio?sample=MDP00020260014&step=plan`, { headers: { cookie } })).text();
    const key = /"key":"([0-9a-f]{64})"/.exec(await open())[1];
    const call = async (body) => (await fetch(`${base}/studio/api`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ ...body, key }) })).json();
    // The report is converted once; its case (results, empty form) is sent to the LIMS.
    const c = JSON.parse((await call({ action: 'loadCase', sampleId: 'MDP00020260014' })).data.json);
    c.clinical = { rows: [{ name: 'Trait A', level: 2 }] };
    c.form = { ...c.form, priorities: 'From the tool', life: {} };
    assert.ok((await call({ action: 'push', sampleId: 'MDP00020260014', kind: 'case', name: 'case.json', mime: 'application/json', b64: Buffer.from(JSON.stringify(c)).toString('base64') })).ok);
    assert.match(await open(), /"results":true/, 'the saved case has the results, so the partner PDF is not read again');
    // Later the counsellor fills in the form in the LIMS.
    await new Promise((r) => setTimeout(r, 20));
    counselling.saveForm(d, counsellor, 'MDP00020260014', { heightCm: '168', weightKg: '64', bp: '118/76', 'life.diet': 'Vegetarian', 'life.actType': 'Walking', 'life.sleepHours': '7-8', 'life.tobacco': 'Never', 'life.alcohol': 'Never', priorities: 'Walk daily' }, { complete: true });
    const back = JSON.parse((await call({ action: 'loadCase', sampleId: 'MDP00020260014' })).data.json);
    assert.deepStrictEqual(back.clinical, c.clinical, 'the results are kept');
    assert.strictEqual(String(back.form.heightCm), '168');
    assert.strictEqual(back.form.life.diet, 'Vegetarian');
    assert.strictEqual(back.form.priorities, 'Walk daily');
    // Converting again saves a newer case with no answers; the counsellor's answers still fill it.
    await new Promise((r) => setTimeout(r, 20));
    assert.ok((await call({ action: 'push', sampleId: 'MDP00020260014', kind: 'case', name: 'case.json', mime: 'application/json', b64: Buffer.from(JSON.stringify({ ...c, form: {} })).toString('base64') })).ok);
    const again = JSON.parse((await call({ action: 'loadCase', sampleId: 'MDP00020260014' })).data.json);
    assert.strictEqual(String(again.form.heightCm), '168');
  });
});

test('a skin sample opens the Skin Health copy for converting', async () => {
  await withApp(async ({ d, store, base }) => {
    const admin = d.get("SELECT * FROM users WHERE email = 'admin@mydnapedia.example'");
    studio.install(d, store, admin, { data: Buffer.from(FAKE) });
    const SKIN = FAKE.replace('<title>Report Studio</title>', '<title>Skin Health Studio</title>').replace('</script>', 't.partnerTerms=[...t.partnerTerms,"Zeta Skin","ZetaDerm"];var Nr={skin:{id:"skin",label:"MDP Skin Health",care:!1}};</script>');
    assert.deepStrictEqual(studio.install(d, store, admin, { data: Buffer.from(SKIN) }), { linked: true, tool: 'Skin Health Studio' });
    assert.ok(!store.get('studio/skin-health-studio.html').toString().includes('Zeta'), 'its extra partner names are removed too');
    const st = studio.status(store);
    assert.ok(st.main.installed && st.skin.installed);
    const cookie = await signIn(base, 'admin@mydnapedia.example');
    const skinSample = d.get("SELECT s.sample_id FROM samples s JOIN tests t ON t.id = s.test_id WHERE t.code = 'MDPSKIN' LIMIT 1").sample_id;
    const other = d.get("SELECT s.sample_id FROM samples s JOIN tests t ON t.id = s.test_id WHERE t.code != 'MDPSKIN' LIMIT 1").sample_id;
    const open = async (q) => (await fetch(`${base}/studio?${q}`, { headers: { cookie } })).text();
    assert.match(await open(`sample=${skinSample}&step=convert`), /<title>Report Centre · Skin Health<\/title>/);
    assert.match(await open(`sample=${other}&step=convert`), /<title>Report Centre<\/title>/);
    assert.match(await open(`sample=${skinSample}&step=plan`), /<title>Report Centre · Skin Health<\/title>/, 'the action plan opens in the Skin Health copy too');
    assert.match(await open('tool=skin'), /Skin Health/);
    const plan = await open(`sample=${skinSample}&step=plan`);
    assert.ok(plan.includes('skin:{id:"skin",label:"MDP Skin Health",care:!0}'), 'the counselling form and action plan tabs are switched on');
    const key = /"key":"([0-9a-f]{64})"/.exec(plan)[1];
    const call = async (body) => (await fetch(`${base}/studio/api`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ ...body, key }) })).json();
    const released = d.get("SELECT s.sample_id FROM samples s JOIN tests t ON t.id = s.test_id WHERE t.code = 'MDPSKIN' AND s.status = 'REPORT_RELEASED' LIMIT 1").sample_id;
    const c = await call({ action: 'loadCase', sampleId: released });
    assert.ok(c.ok && c.data.found, c.error);
    assert.strictEqual(JSON.parse(c.data.json).product, 'skin', 'skin cases open in the Skin Health copy');
  });
});

test('the main copy refuses a skin report instead of labelling it 360 Premium', () => {
  const code = studio.guardSkin('function qa(r){let d={},c=!1;return{pages:r,fields:d,converted:c}}');
  const qa = new Function('window', `${code};return qa`)({});
  const page = (...lines) => ({ body: lines.map((text) => ({ text })) });
  assert.throws(() => qa([page('Skin Damage', 'x'), page(' Hair Care ')]), /Skin Health report/);
  assert.deepStrictEqual(qa([page('Nutrition'), page('Hair Care')]).converted, false, 'one skin-like heading is not enough');
  const win = { __LIMS: { sample: 'MDP00020260008', skin: true }, location: {} };
  const onSample = new Function('window', 'location', `${code};return qa`)(win, win.location);
  assert.throws(() => onSample([page('Skin Damage'), page('Hair Care')]), /Opening Skin Health Studio/);
  assert.strictEqual(win.location.href, '/studio?sample=MDP00020260008&step=convert&tool=skin', 'it hands over to the Skin Health copy');
});

test('Fitness and Cardiac reports carry their own name, from the sample\'s test', async () => {
  // The conversion as the tool writes it, cut down to what the LIMS changes.
  const src = 'function Qa(e,t,r,n,i=()=>{}){let a=[],s=[],o=Zn(e),{pages:l,fields:h,converted:u}=qa(o);if(u)throw new Error("This file has already been converted. Use the original PDF.");return t}';
  const run = (product) => new Function('window', `const Zn=(e)=>e,qa=()=>({pages:[],fields:{},converted:!1});${studio.useProduct(src)};return Qa`)({ __LIMS: { product } });
  const cfg = () => ({ brand: { product: 'MDP 360 PREMIUM' }, foreword: { text: 'your {company} 360 premium report' }, plan: { tier: '360 Premium' } });
  const out = run({ brand: 'MDP CARDIAC HEALTH', short: 'Cardiac Health' })(null, cfg());
  assert.deepStrictEqual(out, { brand: { product: 'MDP CARDIAC HEALTH' }, foreword: { text: 'your {company} Cardiac Health report' }, plan: { tier: 'Cardiac Health' } });
  assert.deepStrictEqual(run(null)(null, cfg()), cfg(), 'a 360 sample keeps the defaults');

  await withApp(async ({ d, store, base }) => {
    const admin = d.get("SELECT * FROM users WHERE email = 'admin@mydnapedia.example'");
    studio.install(d, store, admin, { data: Buffer.from(FAKE) });
    const cookie = await signIn(base, 'admin@mydnapedia.example');
    const product = async (code) => {
      const id = d.get('SELECT s.sample_id FROM samples s JOIN tests t ON t.id = s.test_id WHERE t.code = ? LIMIT 1', code).sample_id;
      const page = await (await fetch(`${base}/studio?sample=${id}&step=convert`, { headers: { cookie } })).text();
      return JSON.parse(/window\.__LIMS=(\{.*?\});<\/script>/.exec(page)[1]).product;
    };
    assert.deepStrictEqual(await product('MDPFIT'), { brand: 'MDP FITNESS', short: 'Fitness' });
    assert.deepStrictEqual(await product('MDPCARD'), { brand: 'MDP CARDIAC HEALTH', short: 'Cardiac Health' });
    assert.strictEqual(await product('MDP360P'), null);
  });
});

test('each action plan fits its own test', () => {
  const { scopePlan } = require('../src/studio-plan');
  const sec = (k, title) => `{t:"section",kicker:"${k}",title:"${title}"},{t:"bullets",items:[1]}`;
  const tool = `(function(e){let t=e.AP={};function d(_){let m=_.client,p={},L=[],$=L.length>=3||!!p.skinComplaints,y=m.tier||"360 Premium";
let v=[{t:"title",text:y+" Post-Test Plan",sub:"all"},{t:"p",text:"It turns your report into day-to-day steps for nutrition, fitness and more."},
${sec('Section A', 'Nutrition Action Plan')},${sec('Section B', 'Fitness & Physical Activity Plan')},${sec('Section C', 'Mental Wellbeing Plan')},${sec('Section D', 'Prevention of Risks')}];
$&&v.push({t:"section",kicker:"Section E",title:"Skin Health"});v.push({t:"section",kicker:"For your doctor",title:"Note for Your Physician \\u2014 Medicines"},{t:"section",kicker:"What to do now",title:"Next Steps"},{t:"closing",text:"Bye"});
return{blocks:v,includeSkin:$}}t.generate=d,t.fileName=0})(G);
let St=(g,r)=>{let i=g.findIndex(b=>b.t==="section"&&r.test(b.title));return i<0?null:[i,i+2]};
G.finish=function(e,t={}){let p=G.AP.generate(e),g=p.blocks;for(let r of[/Fitness & Physical Activity/,/Mental Wellbeing/]){let z=St(g,r);g.splice(z[1],0,{t:"bullets",items:["from the report"]})}return{plan:p,input:e,notes:0}}`;
  const G = {};
  new Function('G', scopePlan(tool))(G);
  const plan = (tier) => G.finish({ client: { tier } }).plan.blocks;
  const sections = (tier) => plan(tier).filter((b) => b.t === 'section').map((b) => `${b.kicker}: ${b.title.split(' —')[0]}`);
  assert.deepStrictEqual(sections('Cardiac Health'), ['Section A: Nutrition Action Plan', 'Section B: Fitness & Physical Activity Plan', 'Section C: Mental Wellbeing Plan', 'Section D: Prevention of Risks', 'For your doctor: Note for Your Physician', 'What to do now: Next Steps']);
  assert.ok(!sections('Fitness').some((s) => s.includes('Physician')), 'fitness reports have no medicines section');
  assert.deepStrictEqual(sections('Skin Health'), ['Section A: Nutrition Action Plan', 'Section B: Prevention of Risks', 'Section C: Skin Health', 'What to do now: Next Steps']);
  const skin = plan('Skin Health');
  assert.strictEqual(skin.find((b) => b.t === 'title').sub, 'Nutrition  •  Prevention of Risks  •  Skin Health');
  assert.match(skin.find((b) => b.t === 'p').text, /steps for nutrition, prevention of risks and skin health\./);
  assert.strictEqual(skin.at(-1).t, 'closing');
});

test('a counselling form saved as PDF goes through the same reader', () => {
  const { patchForm } = require('../src/studio-form');
  const tool = `<label class="btn">Load a form filled in Word (.docx)<input type="file" id="w-import" accept=".docx">
<script>function Zn(e){let t=We.openDocument(e,"application/pdf");return t}function Dp(e){let t=e.getBounds(),r={w:t[2]-t[0],h:t[3]-t[1],lines:[],images:[]};return r}
async function vc(e){let t,r;try{t=await ls.default.loadAsync(e),r=await t.file("word/document.xml").async("string")}catch{throw new Error("That file is not a Word document (.docx).")}let n=mdpFormTables(r);return n}</script>`;
  const out = patchForm(tool);
  assert.ok(out.includes('Load a filled form (Word or PDF)'));
  assert.ok(out.includes('accept=".pdf,application/pdf,.docx"'));
  assert.ok(out.includes('if(e[0]===37&&e[1]===80&&e[2]===68&&e[3]===70)r=mdpFormPdfXml(e);else t=await ls.default.loadAsync(e)'), 'a PDF is recognised by its first bytes');
  const fn = out.slice(out.indexOf('function mdpFormPdfXml'), out.indexOf('async function vc'));
  assert.ok(fn.includes('Zn(bytes)') && fn.includes('Dp(doc.loadPage(i))'), 'the tool\'s own PDF reader is used');
  // Two pages of lines, as the tool's reader gives them: patient details, a heading, the lifestyle table, a free-text answer.
  const line = (t, x, y, bold = false) => ({ text: t, x0: x, y, size: 9, bold });
  const pages = [[line('Patient Details', 54, 100, true), line('Patient Name', 54, 120), line('Asha Rao', 200, 120), line('A2.  Lifestyle', 50, 160, true),
    line('Parameter', 54, 180, true), line('Field', 150, 180, true), line('Response', 300, 180, true), line('Options', 400, 180, true),
    line('Caffeine consumption', 54, 200), line('Cups/day (tea / coffee /', 150, 200), line('3-4', 300, 200), line('0 / 1-2 / 3-4', 400, 200), line('energy)', 150, 212)],
  [line('E1.  Top priorities discussed', 50, 100, true), line('Walk daily', 54, 120), line('Cut salt', 54, 132), line('E2.  Preventive Health Check', 50, 170, true), line('E4.  Consultations advised', 50, 200, true)]];
  const run = new Function('mdpFormPdfXml', 'Zn', 'Dp', `${fn}; return mdpFormPdfXml;`);
  const doc = { countPages: () => pages.length, loadPage: (i) => i };
  const xml = run(null, () => doc, (i) => ({ h: 842, lines: pages[i] }))(new Uint8Array([37, 80, 68, 70]));
  assert.match(xml, /<w:tc><w:p><w:r><w:t xml:space='preserve'>Patient Name<\/w:t><\/w:r><\/w:p><\/w:tc><w:tc><w:p><w:r><w:t xml:space='preserve'>Asha Rao</);
  assert.match(xml, /Cups\/day \(tea \/ coffee \/ energy\)<\/w:t><\/w:r><\/w:p><\/w:tc><w:tc><w:p><w:r><w:t xml:space='preserve'>3-4</, 'a wrapped label stays one row');
  assert.match(xml, /Walk daily<\/w:t><w:br\/><w:t xml:space='preserve'>Cut salt/, 'answer lines keep their line breaks');
  assert.match(xml, /E2\. Preventive Health Check<\/w:t><\/w:r><\/w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t xml:space='preserve'><\/w:t>/, 'an empty answer box keeps its place');
  assert.throws(() => run(null, () => ({ countPages: () => 1, loadPage: () => 0 }), () => ({ h: 842, lines: [] }))(new Uint8Array(4)), /no readable text/);
});
