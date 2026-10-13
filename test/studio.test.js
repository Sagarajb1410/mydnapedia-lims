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
/*async function vc(e){let t,r;try{t=await ls.default.loadAsync(e)*/</script></body></html>`;

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
  });
});

test('a skin sample opens the Skin Health copy for converting', async () => {
  await withApp(async ({ d, store, base }) => {
    const admin = d.get("SELECT * FROM users WHERE email = 'admin@mydnapedia.example'");
    studio.install(d, store, admin, { data: Buffer.from(FAKE) });
    const SKIN = FAKE.replace('<title>Report Studio</title>', '<title>Skin Health Studio</title>').replace('</script>', 't.partnerTerms=[...t.partnerTerms,"Zeta Skin","ZetaDerm"];</script>');
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
    assert.match(await open(`sample=${skinSample}&step=plan`), /<title>Report Centre<\/title>/, 'the action plan stays in the main copy');
    assert.match(await open('tool=skin'), /Skin Health/);
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
return{blocks:v,includeSkin:$}}t.generate=d,t.fileName=0})(G)`;
  const G = {};
  new Function('G', scopePlan(tool))(G);
  const plan = (tier) => G.AP.generate({ client: { tier } }).blocks;
  const sections = (tier) => plan(tier).filter((b) => b.t === 'section').map((b) => `${b.kicker}: ${b.title.split(' —')[0]}`);
  assert.deepStrictEqual(sections('Cardiac Health'), ['Section A: Nutrition Action Plan', 'Section B: Fitness & Physical Activity Plan', 'Section C: Mental Wellbeing Plan', 'Section D: Prevention of Risks', 'For your doctor: Note for Your Physician', 'What to do now: Next Steps']);
  assert.ok(!sections('Fitness').some((s) => s.includes('Physician')), 'fitness reports have no medicines section');
  assert.deepStrictEqual(sections('Skin Health'), ['Section A: Nutrition Action Plan', 'Section B: Prevention of Risks', 'Section C: Skin Health', 'What to do now: Next Steps']);
  const skin = plan('Skin Health');
  assert.strictEqual(skin.find((b) => b.t === 'title').sub, 'Nutrition  •  Prevention of Risks  •  Skin Health');
  assert.match(skin.find((b) => b.t === 'p').text, /steps for nutrition, prevention of risks and skin health\./);
  assert.strictEqual(skin.at(-1).t, 'closing');
});
