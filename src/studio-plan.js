// Report Studio drafts the same action plan for every test (nutrition, fitness,
// mental wellbeing, prevention, a medicines note for the doctor, the annual
// check). Each plan must fit the test the client bought, so before serving the
// tool the LIMS scopes the draft by its report tier:
//  - Skin Health: skin care always has its own section; no fitness, mental
//    wellbeing or medicines sections (the skin report has none of these).
//  - Fitness: no medicines note (the fitness report has no drugs section).
//  - Cardiac Health and 360 Premium: everything, as before.
// Remaining sections are lettered A, B, C... again and the plan's opening lines
// list only them. Sections are removed from the finished draft, after the tool
// has added the counselling answers and extra findings to every section (it
// expects all of them to be there). The tool is minified, so its pieces are
// found by shape.
const FINISHED = /return\{plan:([\w$]+),input:([\w$]+),notes:/;
const SKIN_FLAG = /([\w$]+)=([\w$]+)\.length>=3\|\|!!([\w$]+)\.skinComplaints,/;
const TIER = /,[\w$]+=([\w$]+)\.tier\|\|"360 Premium";/;
const FORM = /let\{patient:[\w$]+,clinical:[\w$]+,form:([\w$]+)\}=/;

const DROP = {
  'Skin Health': ['Fitness & Physical Activity Plan', 'Mental Wellbeing Plan', 'Note for Your Physician'],
  Fitness: ['Note for Your Physician'],
};

const SCOPE = String.raw`(R=>{let B=R.blocks,ti=((B.find(b=>b.t==="title")||{}).text||"").split(" Post-Test")[0].trim(),D=__DROP__,drop=D[Object.keys(D).find(k=>new RegExp("\\b"+k+"\\b","i").test(ti))]||[];
if(!drop.length)return R;let out=[],skip=!1;
for(let b of B){if(b.t==="section")skip=drop.some(x=>String(b.title||"").startsWith(x));else if(b.t==="closing")skip=!1;if(!skip)out.push(b)}
let L="ABCDEFGHIJ",n=0,N={"Nutrition Action Plan":"Nutrition","Fitness & Physical Activity Plan":"Fitness","Mental Wellbeing Plan":"Mental Wellbeing","Prevention of Risks":"Prevention of Risks","Skin Health":"Skin Health"},areas=[];
out.forEach(b=>{if(b.t==="section"&&/^Section [A-Z]$/.test(b.kicker||"")){b.kicker="Section "+L[n++];N[b.title]&&areas.push(N[b.title])}});
let list=areas.map(a=>a.toLowerCase()).join(", ").replace(/, ([^,]*)$/," and $1");
out.forEach(b=>{if(b.t==="title"&&b.sub)b.sub=areas.join("  •  ");if(b.t==="p"&&/day-to-day steps for /.test(b.text||""))b.text=b.text.replace(/day-to-day steps for [^.]*\./,"day-to-day steps for "+list+".")});
R.blocks=out;return R})`;

// The plan is kept short, in the layout the user sent on 27 Oct 2026 (a
// 360 plan the team had trimmed by hand in Word), for every test:
//  - no Report Date / Action Plan Prepared row;
//  - no "Top Priorities at a Glance" table, and Next Steps no longer repeats
//    it (priorities the counsellor typed on the form, and lines for
//    conditions ticked on it, stay in Next Steps);
//  - no "Gut, liver and gallbladder" block (its food-diary tip moves to the
//    nutrient gaps; the gut advice is already in the Prevention table);
//  - "When to reach out sooner" only when the client reported a mood concern
//    or high stress;
//  - "Also noted" keeps only what needs action (a carrier variant found,
//    current tobacco use, other flagged results); favourable findings move to
//    the end of Mental Wellbeing; the cancer summary, detox and skin lines go
//    (the Prevention table and Skin section already cover them);
//  - the medicines table lists only flagged medicines and ones the client
//    takes; the rest are counted in a sentence and stay in the report.
// It runs inside the tool, so it is written without outside references.
function shortenPlan(R, form) {
  const B = R && R.blocks;
  if (!Array.isArray(B)) return R;
  const f = form || {};
  const life = f.life || {};
  const end = (i, stop) => { const j = B.findIndex((b, k) => k > i && stop(b)); return j < 0 ? B.length : j; };
  const section = (re) => { const i = B.findIndex((b) => b.t === 'section' && re.test(b.title || '')); return i < 0 ? null : [i, end(i, (b) => b.t === 'section')]; };
  const sub = (re) => { const i = B.findIndex((b) => b.t === 'sub' && re.test(b.text || '')); return i < 0 ? null : [i, end(i, (b) => b.t === 'sub' || b.t === 'section')]; };
  const find = (r, t, last) => { if (!r) return null; const xs = B.slice(r[0], r[1]).filter((b) => b.t === t); return xs.length ? xs[last ? xs.length - 1 : 0] : null; };

  const info = B.find((b) => b.t === 'info');
  if (info && Array.isArray(info.rows)) info.rows = info.rows.filter((row) => !row.some((c) => c && (c[0] === 'Report Date' || c[0] === 'Action Plan Prepared')));

  const typed = String(f.priorities || '').split('\n').map((x) => x.replace(/^\s*(\d+[.)]|[-•*])\s*/, '').trim()).filter(Boolean);
  const top = section(/Top Priorities/);
  if (top) {
    const t = find(top, 'table');
    // Lines the tool writes for conditions ticked on the form stay too.
    const ticked = /^(Have your gallbladder problem|Keep your liver under review|Keep a headache diary|Keep your asthma review|Keep your mental-health support)/;
    const auto = t ? t.rows.map((r) => r[1]).filter((x) => !typed.includes(x) && !ticked.test(x)) : [];
    B.splice(top[0], top[1] - top[0]);
    const steps = find(section(/^Next Steps/), 'numbered');
    if (steps) steps.items = steps.items.filter((x) => !auto.includes(x));
  }

  const gut = sub(/^Gut, liver and gallbladder/);
  if (gut) {
    const g = find(gut, 'bullets');
    const diary = g ? g.items.filter((x) => /food diary/i.test(x.label || '')) : [];
    B.splice(gut[0], gut[1] - gut[0]);
    const gaps = find(sub(/^Close your nutrient gaps/), 'bullets');
    if (gaps) gaps.items.push(...diary);
  }

  const moody = (f.conditions || []).includes('mood') || life.stress === 'High';
  const mind = find(section(/^Mental Wellbeing/), 'bullets');
  if (mind && !moody) mind.items = mind.items.filter((x) => !/^When to reach out/i.test(x.label || ''));

  const also = sub(/^Also noted$/);
  if (also) {
    const items = (find(also, 'bullets') || { items: [] }).items;
    const fav = items.filter((x) => x.label === 'Favourable findings');
    const keep = items.filter((x) => (x.label === 'Carrier status' && !/^No variants? found/i.test(x.text || ''))
      || x.label === 'Iron overload'
      || (x.label === 'Tobacco' && /^You reported current/.test(x.text || ''))
      || / \((high|medium)\)$/.test(x.label || ''));
    const into = find(section(/^Mental Wellbeing/), 'bullets', true);
    if (into) into.items.push(...fav); else keep.push(...fav);
    const at = sub(/^Also noted$/);
    B.splice(at[0], at[1] - at[0], ...(keep.length ? [B[at[0]], { t: 'bullets', items: keep }] : []));
  }

  const doc = section(/Pharmacogenomic/);
  const table = find(doc, 'table');
  if (table) {
    const all = table.rows.length;
    table.rows = table.rows.filter((r) => /^\*\*/.test(String(r[0])) || /told us you take/i.test(String(r[2] || '')));
    const left = all - table.rows.length;
    const p = find(doc, 'p');
    if (left && p) {
      const note = left === all
        ? 'None is flagged, so no table is shown here; the full list is in your report. Please show the report to any doctor before a new prescription.'
        : 'Only the flagged medicines' + (table.rows.some((r) => /told us you take/i.test(String(r[2] || ''))) ? ' and the ones you take' : '') + ' are listed below; the other ' + left + (left === 1 ? ' is' : ' are') + ' in your report.';
      p.text = left === all ? p.text.replace(/ ?Please show this table[^.]*\.|$/, ' ' + note) : p.text.replace(/ ?Please show this table/, ' ' + note + ' Please show this table');
      if (left === all) B.splice(B.indexOf(table), 1);
    }
  }
  return R;
}

function scopePlan(text) {
  const sk = SKIN_FLAG.exec(text);
  const tier = TIER.exec(text);
  if (!FINISHED.test(text) || !sk || !tier) return text;
  const form = FORM.exec(text);
  const scope = SCOPE.replace(/\n/g, '').replace('__DROP__', () => JSON.stringify(DROP));
  return text
    .replace(SKIN_FLAG, (m, flag, list, h) => `${flag}=${list}.length>=3||!!${h}.skinComplaints||/skin health/i.test(String(${tier[1]}.tier||"")),`)
    .replace(FINISHED, (m, plan, input) => `return{plan:(${shortenPlan})(${scope}(${plan}),${form ? form[1] : '{}'}),input:${input},notes:`);
}

module.exports = { scopePlan, shortenPlan, DROP };
