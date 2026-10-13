// Report Studio drafts the same action plan for every test (nutrition, fitness,
// mental wellbeing, prevention, a medicines note for the doctor, the annual
// check). Each plan must fit the test the client bought, so before serving the
// tool the LIMS scopes the draft by its report tier:
//  - Skin Health: skin care always has its own section; no fitness, mental
//    wellbeing or medicines sections (the skin report has none of these).
//  - Fitness: no medicines note (the fitness report has no drugs section).
//  - Cardiac Health and 360 Premium: everything, as before.
// Remaining sections are lettered A, B, C... again and the plan's opening lines
// list only them. The tool is minified, so its pieces are found by shape.
const GENERATE = /t\.generate=([\w$]+),t\.fileName=/;
const SKIN_FLAG = /([\w$]+)=([\w$]+)\.length>=3\|\|!!([\w$]+)\.skinComplaints,/;
const TIER = /,[\w$]+=([\w$]+)\.tier\|\|"360 Premium";/;

const DROP = {
  'Skin Health': ['Fitness & Physical Activity Plan', 'Mental Wellbeing Plan', 'Note for Your Physician'],
  Fitness: ['Note for Your Physician'],
};

const SCOPE = String.raw`(_x=>{let R=__GEN__(_x),B=R.blocks,ti=((B.find(b=>b.t==="title")||{}).text||"").split(" Post-Test")[0].trim(),D=__DROP__,drop=D[Object.keys(D).find(k=>new RegExp("\\b"+k+"\\b","i").test(ti))]||[];
if(!drop.length)return R;let out=[],skip=!1;
for(let b of B){if(b.t==="section")skip=drop.some(x=>String(b.title||"").startsWith(x));else if(b.t==="closing")skip=!1;if(!skip)out.push(b)}
let L="ABCDEFGHIJ",n=0,N={"Nutrition Action Plan":"Nutrition","Fitness & Physical Activity Plan":"Fitness","Mental Wellbeing Plan":"Mental Wellbeing","Prevention of Risks":"Prevention of Risks","Skin Health":"Skin Health"},areas=[];
out.forEach(b=>{if(b.t==="section"&&/^Section [A-Z]$/.test(b.kicker||"")){b.kicker="Section "+L[n++];N[b.title]&&areas.push(N[b.title])}});
let list=areas.map(a=>a.toLowerCase()).join(", ").replace(/, ([^,]*)$/," and $1");
out.forEach(b=>{if(b.t==="title"&&b.sub)b.sub=areas.join("  •  ");if(b.t==="p"&&/day-to-day steps for /.test(b.text||""))b.text=b.text.replace(/day-to-day steps for [^.]*\./,"day-to-day steps for "+list+".")});
R.blocks=out;return R})`;

function scopePlan(text) {
  const g = GENERATE.exec(text);
  const sk = SKIN_FLAG.exec(text);
  const tier = TIER.exec(text);
  if (!g || !sk || !tier) return text;
  const scope = SCOPE.replace(/\n/g, '').replace('__GEN__', () => g[1]).replace('__DROP__', () => JSON.stringify(DROP));
  return text
    .replace(SKIN_FLAG, (m, flag, list, h) => `${flag}=${list}.length>=3||!!${h}.skinComplaints||/skin health/i.test(String(${tier[1]}.tier||"")),`)
    .replace(GENERATE, () => `t.generate=${scope},t.fileName=`);
}

module.exports = { scopePlan, DROP };
