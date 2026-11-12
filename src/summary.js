// The short client report: the long genetic report summarised in a few pages.
// Every parameter gets a colour (red: act on it, yellow: keep an eye on it,
// green: no raised risk), a meaning in plain words and, only for red and
// yellow results, steps that fit that result and the client's diet.
//
// It is made from the case Report Centre saves when it converts a report
// (results read from the partner's pages: section, group, name, result text and
// level 0 / 1 / 2 from the result's colour). Everything runs inside the LIMS;
// no client data goes to any outside service.
const fs = require('node:fs');
const path = require('node:path');
const { Doc } = require('./pdfdoc');
const lib = require('./summary-library');

const C = {
  navy: '#1f2a44', ink: '#2b3445', muted: '#6b7385', line: '#dfe3ea', accent: '#F9B300', soft: '#f4f5f8',
  red: '#d6453d', redTint: '#fdeeed', yellow: '#e5a400', yellowTint: '#fff6dc', green: '#2f9e5f', greenTint: '#e9f6ee',
  blue: '#2b7bb9', blueTint: '#eaf3fa',
};
const LEVEL = [
  { key: 'green', color: C.green, tint: C.greenTint, title: 'All clear', label: 'No raised risk' },
  { key: 'yellow', color: C.yellow, tint: C.yellowTint, title: 'Keep an eye on these', label: 'Keep an eye on' },
  { key: 'red', color: C.red, tint: C.redTint, title: 'Act on these first', label: 'Act on these' },
];
const AREA_ORDER = Object.keys(lib.AREAS);

const PRODUCTS = [
  [/fitness/i, 'MDP Fitness'],
  [/cardiac|heart/i, 'MDP Cardiac Health'],
  [/skin/i, 'MDP Skin Health'],
  [/.*/, 'MDP 360 Premium'],
];
const productName = (test) => PRODUCTS.find(([re]) => re.test(String(test || '')))[1];

const DIETS = { vegetarian: 'veg', veg: 'veg', 'non-veg': 'nonveg', nonveg: 'nonveg', 'non vegetarian': 'nonveg', eggetarian: 'egg', egg: 'egg', vegan: 'vegan' };
const dietOf = (c) => DIETS[String(((c.form || {}).life || {}).diet || '').trim().toLowerCase()] || 'any';
const sexOf = (p) => (/^f/i.test(String(p.gender || '')) ? 'F' : /^m/i.test(String(p.gender || '')) ? 'M' : '');

const clean = (s) => String(s || '').replace(/\s+/g, ' ').replace(/\s+([.,;:])/g, '$1').trim();
const sentence = (s, max = 170) => {
  const t = clean(s);
  const first = (/^(.+?[.!?])(\s|$)/.exec(t) || [null, t])[1];
  return first.length > max ? `${first.slice(0, max - 1).replace(/\s+\S*$/, '')}…` : first;
};
const resolve = (tip, diet) => (typeof tip === 'function' ? tip(diet) : tip);

// Where a parameter the library does not know goes, from the partner's group heading.
const GROUP_AREAS = [
  [/cardi|heart|risk factor|diabet|thyroid|health monitor/i, 'heart'],
  [/weight|metabol/i, 'weight'],
  [/nutri|vitamin|mineral/i, 'food'],
  [/allerg|sensitiv|intoler/i, 'allergy'],
  [/sport|exercise|fitness|injur|recovery/i, 'fitness'],
  [/mental|mind|behav|sleep|personality/i, 'mind'],
  [/habit|addict|lifestyle/i, 'habits'],
  [/skin|hair/i, 'skin'],
];
const areaOf = (row) => (GROUP_AREAS.find(([re]) => re.test(row.group || '')) || [null, 'health'])[1];

// Check-ups named by several results are listed once each, in one wording.
const CHECKS = [
  [/blood pressure/i, 'Blood pressure, every month'],
  [/lipid/i, 'Lipid profile (cholesterol and triglycerides), every year'],
  [/hba1c|fasting sugar|\bsugar\b/i, 'Fasting sugar and HbA1c, every year'],
  [/\becg\b/i, 'ECG, every year'],
  [/echocardiogram/i, 'Echocardiogram, if your doctor advises it'],
  [/weight, waist|\bbmi\b/i, 'Weight, waist and BMI, at every check-up'],
  [/vitamin d/i, 'Vitamin D (25-OH) blood test'],
  [/bone density/i, 'Bone density scan, after age 50'],
  [/\bb12\b/i, 'Vitamin B12 blood test'],
  [/homocysteine/i, 'Homocysteine blood test'],
  [/folate/i, 'Folate blood test'],
  [/cbc|ferritin and iron|cbc and ferritin/i, 'CBC and ferritin (iron) blood test'],
  [/transferrin/i, 'Ferritin and transferrin saturation (iron overload) test'],
  [/serum calcium/i, 'Serum calcium'],
  [/thyroid|tsh/i, 'Thyroid test (TSH), every year'],
  [/liver function/i, 'Liver function test, every year'],
  [/creatinine/i, 'Creatinine and urine test (kidneys), every year'],
];
function checkList(list) {
  const out = [];
  for (const ch of list) {
    const hits = CHECKS.filter(([re]) => re.test(ch)).map(([, label]) => label);
    for (const label of hits.length ? hits : [ch.charAt(0).toUpperCase() + ch.slice(1)]) if (!out.includes(label)) out.push(label);
  }
  return out;
}

// Medicines: what the partner's result means, in plain words.
function drugMeaning(result) {
  const r = String(result || '');
  if (/ultra.?rapid/i.test(r)) return 'Your body clears this medicine very fast, so it may work less well for you.';
  if (/poor metaboli|slow acetylator/i.test(r)) return 'Your body clears this medicine slowly, so the usual dose may cause side effects.';
  if (/intermediate metaboli/i.test(r)) return 'Your body clears this medicine a little slowly; your doctor may choose another dose or medicine.';
  if (/decreased (drug )?response|less effective|reduced response|poor response/i.test(r)) return 'This medicine may work less well for you.';
  if (/bleeding/i.test(r)) return 'You may have a higher chance of bleeding with this medicine.';
  if (/myopathy|muscle/i.test(r)) return 'You may have a higher chance of muscle pain with this medicine.';
  if (/side effect|toxicity/i.test(r)) return 'You may have a higher chance of side effects with this medicine.';
  return sentence(r);
}

// Turns a saved case into what the short report shows.
function build(caseObj, { test } = {}) {
  const c = typeof caseObj === 'string' ? JSON.parse(caseObj) : caseObj;
  const clinical = c && c.clinical;
  if (!clinical || !Array.isArray(clinical.rows) || !clinical.rows.length) throw new Error('This case has no results. Convert the report in Report Centre first.');
  const p = c.patient || {};
  const diet = dietOf(c);
  const sex = sexOf(p);
  const details = {};
  for (const [k, d] of Object.entries(clinical.details || {})) details[lib.norm(d.title || k)] = d;

  const items = [];
  const insights = [];
  const strengths = [];
  const drugs = [];
  const carriers = [];
  const seen = new Set();
  for (const row of clinical.rows) {
    const key = lib.norm(row.name);
    if (!key || seen.has(`${row.section}:${key}`)) continue;
    seen.add(`${row.section}:${key}`);
    const level = Math.max(0, Math.min(2, Number(row.level) || 0));
    if (row.section === 'drug') { drugs.push({ name: clean(row.name), level, meaning: level ? drugMeaning(row.result) : '' }); continue; }
    if (row.section === 'carrier') { carriers.push({ name: clean(row.name), level }); continue; }
    const e = lib.lookup(row.name);
    if (e && e.sex && sex && e.sex !== sex) continue;
    if (e && e.info) { const tip = resolve(e.info(row.result || ''), diet); if (tip) insights.push({ name: clean(row.name), text: tip }); }
    if (e && !e.yes) continue; // descriptive only (muscle type, eyebrows)
    if (e && level === 0 && e.ok) { const s = e.ok(row.result || ''); if (s) strengths.push(s); }
    const d = details[key] || {};
    const item = {
      name: clean(row.name), level, section: row.section || 'trait',
      area: e ? e.area : areaOf(row), w: e ? e.w : 1,
      what: e ? e.what : '',
      meaning: e ? (level === 2 && e.high) || (level ? e.yes : e.no) : sentence(row.result),
      tips: [], check: level && e ? e.check : null,
      foods: e && e.foods ? e.foods(diet) : null,
    };
    if (level) {
      item.allTips = (e ? (e.tips || []).map((t) => resolve(t, diet)) : (d.recs || []).slice(0, 2).map((t) => sentence(t, 190))).filter(Boolean);
      if (!item.allTips.length) item.allTips = [row.section === 'disease' ? 'Mention this result to your doctor at your yearly check-up.' : 'Talk to your counsellor about simple steps for this result.'];
    }
    items.push(item);
  }

  const byPriority = (a, b) => b.level - a.level || b.w - a.w;
  const byArea = (a, b) => AREA_ORDER.indexOf(a.area) - AREA_ORDER.indexOf(b.area) || b.w - a.w;
  const red = items.filter((i) => i.level === 2).sort(byArea);
  const yellow = items.filter((i) => i.level === 1).sort(byArea);
  // Steps, in reading order. A step already given for an earlier result is not
  // repeated (sunscreen for every skin result); the next step is used instead,
  // or a pointer back when there is none.
  const given = new Map();
  for (const i of [...red, ...yellow]) {
    if (i.foods && i.level === 1) { i.tips = i.allTips.slice(0, 1); continue; }
    const want = i.level === 2 ? (i.w >= 1.5 ? 3 : 2) : 1;
    const fresh = i.allTips.filter((t) => !given.has(t));
    i.tips = fresh.slice(0, want);
    if (!i.tips.length) i.tips = [`The steps for ${given.get(i.allTips[0])} above help with this too.`];
    for (const t of i.tips) if (!given.has(t)) given.set(t, i.name);
  }
  const flagged = [...red, ...yellow].sort(byPriority);
  const steps = [];
  for (const i of flagged) {
    const t = i.allTips[0];
    if (t && !steps.includes(t)) steps.push(t);
    if (steps.length >= 5) break;
  }
  const checks = checkList(flagged.map((i) => i.check).filter(Boolean)).slice(0, 9);
  return {
    patient: { name: clean(p.name), sampleId: clean(p.sampleId), age: p.age, gender: clean(p.gender), reportDate: clean(p.reportDate) },
    product: productName(test || (c.plan && c.plan.tier) || ''),
    red, yellow,
    // A green parameter with its own "good to know" line is shown there only.
    green: items.filter((i) => i.level === 0 && !insights.some((n) => n.name === i.name)),
    insights, strengths: [...new Set(strengths)], drugs, carriers, steps, checks,
  };
}

// ---------- Drawing ----------
const M = 42; // page margin
const TOP = 92; // first line under the header
const BOTTOM = 770; // last line above the footer

function render(model, { logo } = {}) {
  const doc = new Doc({ title: `${model.patient.name || 'Client'}: ${model.product} report at a glance`, subject: 'Short genetic report' });
  const logoId = doc.png(logo || fs.readFileSync(path.join(__dirname, 'web', 'static', 'logo-sm.png')));
  const W = doc.W - 2 * M;
  let y = TOP;

  const newPage = () => {
    doc.addPage();
    doc.rect(0, 0, doc.W, 6, { fill: C.accent });
    doc.image(logoId, M, 24, 132, 35);
    const [mdp, ...rest] = model.product.split(' ');
    const restText = ` ${rest.join(' ').toUpperCase()}`;
    const right = doc.W - M;
    doc.text(right, 40, restText, { size: 10, bold: true, color: C.navy, align: 'right' });
    doc.text(right - doc.width(restText, 10, true), 40, mdp, { size: 10, bold: true, color: C.accent, align: 'right' });
    doc.text(right, 53, 'Your report at a glance', { size: 8, color: C.muted, align: 'right' });
    doc.line(M, 70, doc.W - M, 70, { color: C.line });
    y = TOP;
  };
  const room = (h) => { if (y + h > BOTTOM) newPage(); };

  const heading = (title, color, count, note) => {
    room(note ? 64 : 46);
    y += 8;
    if (color) doc.circle(M + 6, y + 9, 6, { fill: color });
    doc.text(M + (color ? 18 : 0), y + 14, title, { size: 14, bold: true, color: C.navy });
    if (count != null) doc.text(doc.W - M, y + 14, `${count} ${count === 1 ? 'result' : 'results'}`, { size: 9, color: C.muted, align: 'right' });
    y += 22;
    if (note) y += doc.para(M, y, note, W, { size: 9, color: C.muted }) + 2;
    y += 4;
  };

  const card = (item, lv) => {
    const pad = 10;
    const inner = W - 2 * pad - 6;
    const tipLines = item.tips.map((t) => doc.wrap(t, inner - 12, 9));
    const mh = doc.paraHeight(item.meaning, inner, { size: 9.5 });
    const th = tipLines.reduce((s, l) => s + l.length * 9 * 1.38, 0);
    const h = pad + 14 + mh + (item.tips.length ? 14 + th : 0) + pad - 2;
    room(h + 8);
    doc.rect(M, y, W, h, { fill: lv.tint, r: 6 });
    doc.rect(M, y, 5, h, { fill: lv.color });
    const x = M + pad + 6;
    let cy = y + pad;
    doc.text(x, cy + 10, item.name, { size: 11, bold: true, color: C.navy });
    doc.text(M + W - pad, cy + 10, lib.AREAS[item.area] || '', { size: 7.5, color: C.muted, align: 'right' });
    cy += 14;
    cy += doc.para(x, cy, item.meaning, inner, { size: 9.5, color: C.ink });
    if (item.tips.length) {
      doc.text(x, cy + 10, 'What you can do', { size: 8, bold: true, color: lv.color });
      cy += 14;
      for (const lines of tipLines) {
        doc.circle(x + 3, cy + 6, 1.6, { fill: C.ink });
        lines.forEach((l, i) => doc.text(x + 12, cy + 9 + i * 9 * 1.38, l, { size: 9, color: C.ink }));
        cy += lines.length * 9 * 1.38;
      }
    }
    y += h + 8;
  };

  // A yellow result in one compact row: name on the left, meaning and one step on the right.
  const row = (item, lv) => {
    const lw = 150;
    const rw = W - lw - 24;
    const tip = item.tips[0] ? `What you can do: ${item.tips[0]}` : '';
    const nameLines = doc.wrap(item.name, lw - 16, 10, true);
    const mh = doc.paraHeight(item.meaning, rw, { size: 9.5 });
    const th = tip ? doc.paraHeight(tip, rw, { size: 9 }) : 0;
    const h = Math.max(nameLines.length * 13.8 + 16, mh + th + 14);
    room(h + 6);
    doc.rect(M, y, W, h, { fill: lv.tint, r: 5 });
    doc.rect(M, y, 4, h, { fill: lv.color });
    nameLines.forEach((l, i) => doc.text(M + 12, y + 16 + i * 13.8, l, { size: 10, bold: true, color: C.navy }));
    doc.text(M + 12, y + 16 + nameLines.length * 13.8 - 2, lib.AREAS[item.area] || '', { size: 7, color: C.muted });
    const x = M + lw + 12;
    let cy = y + 5;
    cy += doc.para(x, cy, item.meaning, rw, { size: 9.5, color: C.ink });
    if (tip) {
      const lines = doc.wrap(tip, rw, 9);
      lines.forEach((l, i) => {
        if (i === 0) { doc.text(x, cy + 9, 'What you can do:', { size: 9, bold: true, color: '#9a6d00' }); doc.text(x + doc.width('What you can do: ', 9, true), cy + 9, l.slice('What you can do: '.length), { size: 9, color: C.ink }); }
        else doc.text(x, cy + 9 + i * 9 * 1.38, l, { size: 9, color: C.ink });
      });
    }
    y += h + 6;
  };

  // ---- Page 1: who, the counts, how to read, the top steps ----
  newPage();
  doc.text(M, y + 20, 'Your genetic report at a glance', { size: 21, bold: true, color: C.navy });
  y += 30;
  y += doc.para(M, y, `A short summary of your ${model.product} report in plain words. Each result has a colour, so you can see at once what needs attention.`, W, { size: 10, color: C.muted }) + 10;

  const p = model.patient;
  const info = [['Name', p.name], ['Sample ID', p.sampleId], ['Age / Gender', [p.age, p.gender].filter((v) => v !== '' && v != null).join(' / ')], ['Report date', p.reportDate]];
  doc.rect(M, y, W, 50, { fill: C.soft, r: 6 });
  info.forEach(([k, v], i) => {
    const x = M + 14 + i * (W / 4);
    doc.text(x, y + 19, k, { size: 7.5, color: C.muted });
    doc.text(x, y + 35, doc.wrap(v || '-', W / 4 - 18, 10, true)[0], { size: 10, bold: true, color: C.navy });
  });
  y += 64;

  const tiles = [[2, model.red.length], [1, model.yellow.length], [0, model.green.length]];
  const tw = (W - 20) / 3;
  tiles.forEach(([lvIdx, n], i) => {
    const lv = LEVEL[lvIdx];
    const x = M + i * (tw + 10);
    doc.rect(x, y, tw, 62, { fill: lv.tint, r: 8 });
    doc.circle(x + 20, y + 22, 8, { fill: lv.color });
    doc.text(x + 36, y + 30, String(n), { size: 22, bold: true, color: lv.color });
    doc.text(x + 14, y + 50, lv.label, { size: 9.5, bold: true, color: C.navy });
  });
  y += 76;

  doc.text(M, y + 10, 'How to read the colours', { size: 11, bold: true, color: C.navy });
  y += 18;
  const legend = [
    [2, 'Red: your genes raise the chance more than for most people. Follow the steps for these first.'],
    [1, 'Yellow: a small rise. Simple changes in food, activity or habits help.'],
    [0, 'Green: no raised risk found in your genes. Keep up your healthy habits.'],
  ];
  for (const [lvIdx, text] of legend) {
    doc.circle(M + 5, y + 7, 4.5, { fill: LEVEL[lvIdx].color });
    y += doc.para(M + 16, y, text, W - 16, { size: 9.5, color: C.ink }) + 3;
  }
  y += 4;
  y += doc.para(M, y, 'A colour shows a tendency in your genes, not a disease. Most people with a red or yellow result never get the condition, especially when they act on it early.', W, { size: 8.5, color: C.muted }) + 6;

  if (model.steps.length) {
    const lines = model.steps.map((s) => doc.wrap(s, W - 50, 9.5));
    const h = 34 + lines.reduce((s, l) => s + l.length * 9.5 * 1.38 + 5, 0);
    room(h + 10);
    doc.rect(M, y, W, h, { fill: '#fff8e6', r: 8 });
    doc.rect(M, y, W, 4, { fill: C.accent, r: 2 });
    doc.text(M + 14, y + 22, 'Your most important steps', { size: 12, bold: true, color: C.navy });
    let sy = y + 32;
    lines.forEach((l, i) => {
      doc.circle(M + 22, sy + 7, 8, { fill: C.navy });
      doc.text(M + 22, sy + 10.5, String(i + 1), { size: 8.5, bold: true, color: '#ffffff', align: 'center' });
      l.forEach((t, j) => doc.text(M + 38, sy + 10 + j * 9.5 * 1.38, t, { size: 9.5, color: C.ink }));
      sy += l.length * 9.5 * 1.38 + 5;
    });
    y += h + 12;
  }

  // ---- Red and yellow results ----
  if (model.red.length) {
    heading(LEVEL[2].title, C.red, model.red.length, 'Your genes raise the chance for these more than for most people. Start with these steps.');
    model.red.forEach((i) => card(i, LEVEL[2]));
  }
  if (model.yellow.length) {
    heading(LEVEL[1].title, C.yellow, model.yellow.length, 'A small rise for these. One simple change for each is enough to start.');
    // Nutrients go together in one list of foods, instead of one row each.
    const nuts = model.yellow.filter((i) => i.foods);
    model.yellow.filter((i) => !i.foods).forEach((i) => row(i, LEVEL[1]));
    if (nuts.length) {
      const lw = 150;
      const rw = W - lw - 24;
      const intro = 'Your body may need a little more of these than most people. Add these foods to your day:';
      const hs = nuts.map((n) => Math.max(16, doc.paraHeight(n.foods, rw, { size: 9 }) + 4));
      const h = 16 + doc.paraHeight(intro, W - 24, { size: 9.5 }) + hs.reduce((a, b) => a + b, 0) + 10;
      if (h < BOTTOM - TOP) room(h + 6);
      doc.rect(M, y, W, h, { fill: LEVEL[1].tint, r: 5 });
      doc.rect(M, y, 4, h, { fill: LEVEL[1].color });
      doc.text(M + 12, y + 16, 'Nutrients to top up', { size: 10, bold: true, color: C.navy });
      let cy = y + 20;
      cy += doc.para(M + 12, cy, intro, W - 24, { size: 9.5, color: C.ink }) + 4;
      nuts.forEach((n, i) => {
        doc.circle(M + 16, cy + 6, 3, { fill: LEVEL[1].color });
        doc.text(M + 24, cy + 9, n.name, { size: 9, bold: true, color: C.navy });
        doc.para(M + lw + 12, cy - 0.5, n.foods.replace(/^./, (ch) => ch.toUpperCase()), rw, { size: 9, color: C.ink });
        cy += hs[i];
      });
      y += h + 6;
      room(30);
      y += doc.para(M, y, 'Take a supplement only if a blood test shows you need it. The tests are listed at the end.', W, { size: 8.5, color: C.muted }) + 8;
    }
  }

  // ---- Good to know ----
  if (model.insights.length) {
    heading('Good to know about you', C.blue, null, 'What your genes say about how your body works best.');
    for (const ins of model.insights) {
      const names = doc.wrap(ins.name, 120, 9.5, true);
      const h = Math.max(names.length * 13 + 11, doc.paraHeight(ins.text, W - 150, { size: 9.5 }) + 12);
      room(h + 4);
      doc.rect(M, y, W, h, { fill: C.blueTint, r: 5 });
      names.forEach((l, i) => doc.text(M + 10, y + 16 + i * 13, l, { size: 9.5, bold: true, color: C.navy }));
      doc.para(M + 138, y + 4, ins.text, W - 150, { size: 9.5, color: C.ink });
      y += h + 5;
    }
    y += 4;
  }

  // ---- Medicines ----
  if (model.drugs.length) {
    const flaggedDrugs = model.drugs.filter((d) => d.level).sort((a, b) => b.level - a.level);
    heading('Medicines: show this to your doctor', C.navy, null, 'Your genes change how your body handles some medicines. Do not start, stop or change any medicine yourself.');
    for (const d of flaggedDrugs) {
      const lv = LEVEL[d.level];
      const names = doc.wrap(d.name, 135, 9.5, true);
      const h = Math.max(names.length * 13 + 11, doc.paraHeight(d.meaning, W - 175, { size: 9.5 }) + 12);
      room(h + 4);
      doc.rect(M, y, W, h, { fill: lv.tint, r: 5 });
      doc.circle(M + 12, y + 16 - 3.5, 4.5, { fill: lv.color });
      names.forEach((l, i) => doc.text(M + 24, y + 16 + i * 13, l, { size: 9.5, bold: true, color: C.navy }));
      doc.para(M + 165, y + 4, d.meaning, W - 175, { size: 9.5, color: C.ink });
      y += h + 5;
    }
    const ok = model.drugs.length - flaggedDrugs.length;
    if (ok) { room(20); y += doc.para(M, y + 2, `${ok} other ${ok === 1 ? 'medicine shows' : 'medicines show'} no concern: ${model.drugs.filter((d) => !d.level).map((d) => d.name).join(', ')}.`, W, { size: 9, color: C.muted }) + 8; }
  }

  // ---- Carrier status ----
  if (model.carriers.length) {
    const found = model.carriers.filter((x) => x.level);
    heading('Genes you could pass on', found.length ? C.yellow : C.green, null, null);
    const text = found.length
      ? `You carry one copy of a gene change for ${found.map((x) => x.name).join(', ')}. You are healthy and this does not affect you, but if your partner carries the same change, a child could be affected. Your partner can take a simple test before you plan a family.`
      : `No carrier gene changes were found for the ${model.carriers.length} conditions tested. Nothing to pass on from these.`;
    room(40);
    y += doc.para(M, y, text, W, { size: 9.5, color: C.ink }) + 10;
  }

  // ---- Green results ----
  if (model.green.length) {
    heading(LEVEL[0].title, C.green, model.green.length, 'No raised risk was found for these. Keep up your healthy habits.');
    const groups = {};
    for (const g of model.green) (groups[g.area] = groups[g.area] || []).push(g.name);
    for (const area of AREA_ORDER.concat(Object.keys(groups).filter((a) => !AREA_ORDER.includes(a)))) {
      if (!groups[area]) continue;
      const names = groups[area];
      // Chips laid out in rows.
      const rows = [[]];
      let rowW = 0;
      for (const n of names) {
        const cw = doc.width(n, 8) + 20;
        if (rowW + cw > W && rows[rows.length - 1].length) { rows.push([]); rowW = 0; }
        rows[rows.length - 1].push([n, cw]);
        rowW += cw + 4;
      }
      room(18 + rows.length * 18);
      doc.text(M, y + 10, lib.AREAS[area] || 'Other', { size: 9, bold: true, color: C.navy });
      y += 15;
      for (const r of rows) {
        let x = M;
        for (const [n, cw] of r) {
          doc.rect(x, y, cw, 15, { fill: C.greenTint, r: 7.5 });
          doc.circle(x + 7.5, y + 7.5, 2.8, { fill: C.green });
          doc.text(x + 14, y + 10.5, n, { size: 8, color: C.ink });
          x += cw + 4;
        }
        y += 18;
      }
      y += 4;
    }
    if (model.strengths.length) { room(24); y += doc.para(M, y + 2, `Your strengths: ${model.strengths.join(', ').toLowerCase().replace(/^./, (ch) => ch.toUpperCase())}.`, W, { size: 9.5, bold: true, color: C.green }) + 8; }
  }

  // ---- Check-ups ----
  if (model.checks.length) {
    heading('Check-ups to ask your doctor about', C.navy, null, 'Based only on your red and yellow results.');
    for (const ch of model.checks) {
      const text = ch.charAt(0).toUpperCase() + ch.slice(1);
      const h = doc.paraHeight(text, W - 16, { size: 9.5 });
      room(h + 4);
      doc.circle(M + 4, y + 7, 2, { fill: C.navy });
      y += doc.para(M + 14, y, text, W - 16, { size: 9.5, color: C.ink }) + 3;
    }
    y += 6;
  }

  // ---- Closing note ----
  const note = 'This summary is for your wellness and is not a diagnosis or medical advice. Genes are only part of the story: food, activity, sleep and regular check-ups shape your health far more. Your full report has the science behind each result. Please talk to your MyDNAPedia counsellor before making big changes, and to your doctor before starting or stopping any medicine or supplement.';
  const nh = doc.paraHeight(note, W - 28, { size: 8.5 }) + 34;
  room(nh + 6);
  y += 6;
  doc.rect(M, y, W, nh, { fill: C.soft, r: 8 });
  doc.text(M + 14, y + 18, 'Please remember', { size: 10, bold: true, color: C.navy });
  doc.para(M + 14, y + 24, note, W - 28, { size: 8.5, color: C.muted });
  y += nh;

  // Footers, now that the page count is known.
  doc.pages.forEach((pg, i) => {
    doc.page = pg;
    doc.rect(0, 792, doc.W, 50, { fill: C.soft });
    doc.text(M, 810, `${p.name || ''}${p.sampleId ? `  |  Sample ID ${p.sampleId}` : ''}`, { size: 8, bold: true, color: C.navy });
    doc.text(M, 824, 'Know Your DNA - Make Better Choices - Live Healthier', { size: 7.5, color: C.muted });
    doc.text(doc.W - M, 810, `Page ${i + 1} of ${doc.pages.length}`, { size: 8, bold: true, color: C.navy, align: 'right' });
    doc.text(doc.W - M, 824, 'MyDNAPedia', { size: 7.5, color: C.muted, align: 'right' });
  });
  return doc.save();
}

function shortReport(caseObj, opts = {}) {
  return render(build(caseObj, opts), opts);
}

module.exports = { build, render, shortReport, productName, drugMeaning };
