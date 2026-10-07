// HTML building blocks. Every value put into a page goes through html``, which
// escapes it unless it is already trusted markup (raw / nested html``).
class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
const raw = (s) => new Raw(String(s));
const config = require('../config');

function esc(v) {
  return String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function render(v) {
  if (v == null || v === false) return '';
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(render).join('');
  return esc(v);
}

function html(strings, ...values) {
  let out = strings[0];
  values.forEach((v, i) => { out += render(v) + strings[i + 1]; });
  return new Raw(out);
}

// Line icons (24 × 24, drawn with the current text colour).
const ICON_PATHS = {
  dashboard: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  samples: '<path d="M14.5 2.5l7 7"/><path d="M19.5 7.5L8.5 18.5a3.5 3.5 0 0 1-5-5L14.5 2.5"/><path d="M6.5 11.5h7"/>',
  register: '<circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 14 0"/><path d="M19 8v6M16 11h6"/>',
  tracking: '<path d="M2 6h12v10H2z"/><path d="M14 9h4.5l3.5 3.5V16h-8"/><circle cx="6.5" cy="18" r="2"/><circle cx="17.5" cy="18" r="2"/>',
  reports: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 14.5l2 2 4-4"/>',
  counselling: '<path d="M21 11.5a8.4 8.4 0 0 1-12.3 7.5L3 21l1.9-5.4A8.5 8.5 0 1 1 21 11.5z"/><path d="M8.5 10.5h7M8.5 14h4"/>',
  chart: '<path d="M3 3v18h18"/><path d="M7.5 16v-4M12 16V8M16.5 16v-6"/>',
  plan: '<path d="M9 4h6v3H9z"/><path d="M15 5.5h2.5A1.5 1.5 0 0 1 19 7v12.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 19.5V7a1.5 1.5 0 0 1 1.5-1.5H9"/><path d="M9 13.5l2 2 4-4"/>',
  billing: '<rect x="2.5" y="5.5" width="19" height="14" rx="2"/><path d="M2.5 10h19"/><path d="M16 15h2.5"/>',
  outbox: '<path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4z"/>',
  admin: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  key: '<circle cx="7.5" cy="15.5" r="4.5"/><path d="M10.7 12.3L21 2M16 7l3 3M18.5 4.5l2 2"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>',
  alert: '<path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  check: '<circle cx="12" cy="12" r="9.5"/><path d="M8 12.5l2.7 2.7L16 10"/>',
  info: '<circle cx="12" cy="12" r="9.5"/><path d="M12 16v-4.5M12 8h.01"/>',
  clock: '<circle cx="12" cy="12" r="9.5"/><path d="M12 7v5l3 2"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  back: '<path d="M19 12H5M11 18l-6-6 6-6"/>',
  print: '<path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M6 14h12v7H6z"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>',
  download: '<path d="M12 4v12M7 11l5 5 5-5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
};
function icon(name, cls = '') {
  return raw(`<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name] || ''}</svg>`);
}

const CSS = `
@font-face{font-family:Montserrat;src:url(/static/montserrat-400.ttf) format("truetype");font-weight:400 500;font-display:swap}
@font-face{font-family:Montserrat;src:url(/static/montserrat-700.ttf) format("truetype");font-weight:600 800;font-display:swap}
:root{--bg:#f2f4f6;--card:#fff;--ink:#16232c;--ink2:#3a4851;--quiet:#68757e;--line:#e3e8eb;--line2:#cdd5da;--hover:#f7f9fa;
--honey:#f9b300;--honey2:#e3a200;--honey-bg:#fff6dc;--honey-ink:#7a5300;--navy:#1b2a35;--teal:#12789a;--teal-bg:#e5f2f7;
--blue:#3657c8;--blue-bg:#ecf0fd;--violet:#6a4bc4;--violet-bg:#f1edfc;--good:#177a4b;--good-bg:#e4f4ea;--warn:#9c5900;--warn-bg:#fff0d9;
--bad:#b42318;--bad-bg:#fdeceb;--brand:var(--teal);--r:12px;--r2:8px;--shadow:0 1px 2px rgba(20,32,40,.05),0 2px 6px rgba(20,32,40,.04)}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;font:14px/1.55 Montserrat,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--ink);background:var(--bg);-webkit-font-smoothing:antialiased}
a{color:var(--teal);text-decoration-thickness:1px;text-underline-offset:2px}a:hover{color:#0c5c77}
.ic{width:18px;height:18px;flex:none;vertical-align:-4px}
:focus-visible{outline:3px solid rgba(249,179,0,.55);outline-offset:2px;border-radius:6px}
/* ---------- App shell ---------- */
.app{display:grid;grid-template-columns:252px minmax(0,1fr);min-height:100vh}
.side{position:sticky;top:0;height:100vh;display:flex;flex-direction:column;background:#fff;border-right:1px solid var(--line);padding:18px 14px 14px;overflow-y:auto;z-index:30}
.logo{display:block;padding:4px 10px 16px;text-decoration:none}.logo img{display:block;height:34px;width:auto}
.logo small{display:block;margin-top:6px;font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--quiet)}
.side nav{display:flex;flex-direction:column;gap:2px;flex:1}
.side .grp{font-size:10.5px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#98a3aa;padding:16px 12px 6px}
.side nav a{display:flex;align-items:center;gap:11px;padding:9px 12px;border-radius:var(--r2);color:var(--ink2);text-decoration:none;font-weight:600;position:relative}
.side nav a .ic{color:#8996a0}.side nav a:hover{background:var(--hover);color:var(--ink)}
.side nav a.on{background:var(--honey-bg);color:var(--ink)}.side nav a.on .ic{color:var(--honey2)}
.side nav a.on:before{content:"";position:absolute;left:-14px;top:8px;bottom:8px;width:4px;border-radius:0 4px 4px 0;background:var(--honey)}
.me{display:flex;align-items:center;gap:10px;margin-top:16px;padding:12px 10px 4px;border-top:1px solid var(--line)}
.avatar{width:36px;height:36px;border-radius:50%;background:var(--navy);color:#fff;display:grid;place-items:center;font-weight:700;font-size:13px;flex:none}
.me .who{min-width:0;flex:1;line-height:1.3}.me .who b{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:13px}
.me .who span{font-size:12px;color:var(--quiet);display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.iconbtn{display:inline-grid;place-items:center;width:34px;height:34px;border-radius:var(--r2);color:var(--quiet);background:none;border:0;padding:0;cursor:pointer;text-decoration:none}
.iconbtn:hover{background:var(--hover);color:var(--ink)}
.topbar{position:sticky;top:0;z-index:20;display:flex;align-items:center;gap:14px;padding:12px 32px;background:rgba(242,244,246,.88);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);border-bottom:1px solid transparent}
.find{flex:1;max-width:460px;position:relative}.find .ic{position:absolute;left:12px;top:11px;color:var(--quiet)}
.find input{padding-left:38px;background:#fff;height:40px;border-radius:999px;border-color:var(--line)}
.testflag{margin-left:auto;display:inline-flex;align-items:center;gap:7px;font-size:12px;font-weight:600;color:var(--honey-ink);background:var(--honey-bg);border:1px solid #f6dd9a;padding:5px 11px;border-radius:999px;white-space:nowrap}
.testflag:before{content:"";width:7px;height:7px;border-radius:50%;background:var(--honey)}
.menu{display:none}#navt{position:absolute;opacity:0;pointer-events:none}.scrim{display:none}
main{max-width:1240px;margin:0 auto;padding:8px 32px 64px}
/* ---------- Type ---------- */
h1{font-size:25px;line-height:1.25;letter-spacing:-.015em;margin:6px 0 4px;font-weight:700}
h2{font-size:16px;line-height:1.35;margin:30px 0 10px;font-weight:700;letter-spacing:-.005em}
h1.mono{font-size:24px;letter-spacing:.01em}
.sub{color:var(--quiet);margin:0 0 20px}.muted{color:var(--quiet)}
.mono{font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace;font-size:.93em;letter-spacing:.01em;white-space:nowrap}a.mono{font-weight:600;text-decoration:none}a.mono:hover{text-decoration:underline}
.num{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}.neg{color:var(--bad)}
.head{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;flex-wrap:wrap;margin-bottom:18px}.head h1{margin-bottom:2px}.head .sub{margin:0}
.crumb{display:inline-flex;align-items:center;gap:6px;font-size:13px;font-weight:600;color:var(--quiet);text-decoration:none;margin:6px 0 4px}.crumb:hover{color:var(--ink)}
/* ---------- Surfaces ---------- */
.card{background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:20px 22px;margin-bottom:16px;box-shadow:var(--shadow)}
.card>h2:first-child{margin-top:0}.card h2{font-size:15px}
details.card>summary{cursor:pointer;list-style:none;display:flex;align-items:center;gap:8px}
details.card>summary::-webkit-details-marker{display:none}details.card>summary:after{content:"";margin-left:auto;width:8px;height:8px;border-right:2px solid var(--quiet);border-bottom:2px solid var(--quiet);transform:rotate(45deg);transition:transform .15s}
details.card[open]>summary:after{transform:rotate(-135deg)}
details:not(.card)>summary{cursor:pointer;font-weight:600;color:var(--ink2)}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px 18px}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;margin-bottom:20px}
.stat{background:#fff;border:1px solid var(--line);border-radius:var(--r);padding:16px 18px;box-shadow:var(--shadow)}
.stat b{display:block;font-size:26px;line-height:1.2;letter-spacing:-.02em;font-variant-numeric:tabular-nums}.stat span{color:var(--quiet);font-size:13px}
/* ---------- Forms ---------- */
label{display:block;font-size:13px;font-weight:600;margin-bottom:6px;color:var(--ink2)}label .opt{font-weight:500;color:var(--quiet)}
input,select,textarea{width:100%;padding:9px 12px;border:1px solid var(--line2);border-radius:var(--r2);font:inherit;color:inherit;background:#fff;transition:border-color .12s,box-shadow .12s}
input,select{min-height:40px}textarea{min-height:84px;resize:vertical}
input:focus,select:focus,textarea:focus{outline:0;border-color:var(--honey2);box-shadow:0 0 0 3px rgba(249,179,0,.22)}
input[type=checkbox],input[type=radio]{width:18px;height:18px;min-height:0;margin:2px 8px 0 0;accent-color:var(--honey2);flex:none}
input[type=file]{padding:7px;background:var(--hover);border-style:dashed}
.check{display:flex;align-items:flex-start;gap:2px;font-weight:500;font-size:14px;margin:8px 0;color:var(--ink)}
button,.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:40px;background:var(--honey);color:var(--navy);border:1px solid var(--honey2);border-radius:var(--r2);padding:8px 18px;font:inherit;font-weight:700;cursor:pointer;text-decoration:none;white-space:nowrap;transition:background .12s,box-shadow .12s}
button:hover,.btn:hover{background:#ffc226;color:var(--navy)}
.btn.light,button.light{background:#fff;color:var(--ink);border-color:var(--line2)}.btn.light:hover,button.light:hover{background:var(--hover);border-color:#aeb9c0}
.btn.small,button.small{min-height:32px;padding:4px 12px;font-size:13px}
button.danger,.btn.danger{background:#fff;color:var(--bad);border-color:#f0b7b2}button.danger:hover{background:var(--bad-bg)}
.actions{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-top:16px}
.filters{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px}.filters input,.filters select{width:auto;min-width:180px;flex:1 1 180px;max-width:320px}
/* ---------- Link tiles ---------- */
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:14px;margin-bottom:8px}
.tile{display:flex;gap:14px;align-items:flex-start;background:#fff;border:1px solid var(--line);border-radius:var(--r);padding:18px;box-shadow:var(--shadow);color:var(--ink);text-decoration:none;transition:border-color .12s,transform .12s}
.tile:hover{border-color:var(--honey2);color:var(--ink);transform:translateY(-1px)}.tile b{display:block}.tile small{display:block;color:var(--quiet);font-size:12.5px;margin-top:2px}
.tile .ti{display:grid;place-items:center;width:40px;height:40px;border-radius:10px;background:var(--honey-bg);color:var(--honey-ink);flex:none}
.stat span a{color:var(--ink2);font-weight:600;text-decoration:none}.stat span a:hover{color:var(--teal);text-decoration:underline}
td button,td .btn{min-height:30px;padding:3px 12px;font-size:12.5px}
input[type=file]::file-selector-button{font:inherit;font-weight:600;border:1px solid var(--line2);background:#fff;border-radius:6px;padding:5px 12px;margin-right:10px;cursor:pointer}
/* ---------- Segmented tabs ---------- */
.seg{display:inline-flex;gap:2px;padding:4px;background:#e7ebee;border-radius:10px;margin:0 0 18px;max-width:100%;overflow-x:auto}
.seg a{padding:7px 14px;border-radius:7px;font-weight:600;font-size:13px;color:var(--ink2);text-decoration:none;white-space:nowrap}
.seg a:hover{color:var(--ink)}.seg a.on{background:#fff;color:var(--ink);box-shadow:0 1px 2px rgba(20,32,40,.12)}
/* ---------- Tables ---------- */
.table-wrap{overflow-x:auto;background:#fff;border:1px solid var(--line);border-radius:var(--r);box-shadow:var(--shadow)}
.card .table-wrap{box-shadow:none}
table{width:100%;border-collapse:collapse;background:#fff}
th,td{text-align:left;padding:12px 14px;border-bottom:1px solid var(--line);vertical-align:top}
th{font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--quiet);background:#f8fafb;white-space:nowrap}
tr:last-child td{border-bottom:0}tbody tr:hover td,tr[data-href]:hover td{background:#fafbfc}tr[data-href]{cursor:pointer}
td .muted{font-size:12.5px}td.nw{white-space:nowrap}td b{font-weight:600}
/* ---------- Pills, notices ---------- */
.pill{display:inline-flex;align-items:center;gap:6px;padding:3px 10px 3px 9px;border-radius:999px;font-size:12px;font-weight:600;line-height:1.5;background:#edf0f2;color:#3e4b53;white-space:nowrap}
.pill:before{content:"";width:6px;height:6px;border-radius:50%;background:currentColor;opacity:.85}
.pill.good{background:var(--good-bg);color:var(--good)}.pill.warn{background:var(--warn-bg);color:var(--warn)}.pill.bad{background:var(--bad-bg);color:var(--bad)}
.pill.lab{background:var(--teal-bg);color:var(--teal)}.pill.move{background:var(--blue-bg);color:var(--blue)}.pill.rep{background:var(--honey-bg);color:var(--honey-ink)}.pill.couns{background:var(--violet-bg);color:var(--violet)}
.flash{display:flex;gap:10px;align-items:flex-start;padding:12px 16px;border-radius:var(--r2);margin-bottom:16px;overflow-wrap:anywhere;border:1px solid transparent;font-weight:500}
.flash.error{background:var(--bad-bg);color:#8f1c13;border-color:#f6c9c4}.flash.ok{background:var(--good-bg);color:#145c3a;border-color:#bfe3cd}.flash.warn{background:var(--warn-bg);color:#7a4500;border-color:#f6d6a5}
.flash .ic{margin-top:1px}
/* ---------- Facts and timeline ---------- */
dl.facts{display:grid;grid-template-columns:150px 1fr;gap:9px 14px;margin:0}dl.facts dt{color:var(--quiet);font-size:13px}dl.facts dd{margin:0;font-weight:500;min-width:0;overflow-wrap:anywhere}
.timeline{list-style:none;padding:0;margin:0}.timeline li{padding:0 0 16px 22px;position:relative}
.timeline li:before{content:"";position:absolute;left:5px;top:16px;bottom:-2px;width:2px;background:var(--line)}.timeline li:last-child:before{display:none}
.timeline li:after{content:"";position:absolute;left:0;top:5px;width:12px;height:12px;border-radius:50%;background:#fff;border:3px solid var(--honey)}
.timeline li:last-child:after{background:var(--honey)}
/* ---------- Dashboard ---------- */
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:14px;margin-bottom:22px}
.kpi{display:block;background:#fff;border:1px solid var(--line);border-radius:var(--r);padding:16px 18px;box-shadow:var(--shadow);color:inherit;text-decoration:none;position:relative;overflow:hidden}
a.kpi:hover{border-color:var(--line2);color:inherit}
.kpi .k{display:flex;align-items:center;gap:8px;font-size:12.5px;font-weight:600;color:var(--quiet)}.kpi .k .ic{width:16px;height:16px}
.kpi b{display:block;font-size:30px;line-height:1.15;margin-top:8px;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.kpi small{display:block;color:var(--quiet);font-size:12px;margin-top:2px}
.kpi.alert{border-color:#f3c3bd;background:linear-gradient(180deg,#fff 0,#fff7f6 100%)}.kpi.alert b{color:var(--bad)}
.kpi.attn b{color:var(--warn)}
.flow{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:0;background:#fff;border:1px solid var(--line);border-radius:var(--r);box-shadow:var(--shadow);overflow:hidden}
.phase{padding:16px 16px 14px;border-right:1px solid var(--line);position:relative;min-width:0}.phase:last-child{border-right:0}
.phase:after{content:"";position:absolute;right:-7px;top:24px;width:12px;height:12px;background:#fff;border-top:1px solid var(--line);border-right:1px solid var(--line);transform:rotate(45deg);z-index:1}.phase:last-child:after{display:none}
.phase .t{font-size:11.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--quiet);display:flex;align-items:center;gap:7px}
.phase .t i{width:8px;height:8px;border-radius:50%;display:inline-block}
.phase .n{font-size:30px;font-weight:700;letter-spacing:-.02em;line-height:1.2;margin:6px 0 8px;font-variant-numeric:tabular-nums}
.phase ul{list-style:none;margin:0;padding:0;font-size:12.5px}.phase li{display:flex;justify-content:space-between;gap:6px;padding:2px 0}
.phase li a{color:var(--ink2);text-decoration:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.phase li a:hover{color:var(--teal);text-decoration:underline}
.phase li span{color:var(--quiet);font-variant-numeric:tabular-nums}.phase li.z a,.phase li.z span{color:#a6b0b6}
.bar{height:6px;border-radius:999px;background:#edf0f2;overflow:hidden;margin-top:12px}.bar i{display:block;height:100%;border-radius:999px}
.cols{display:grid;grid-template-columns:minmax(0,1.6fr) minmax(0,1fr);gap:18px;align-items:start;margin-top:22px}
.list{list-style:none;margin:0;padding:0}.list li{display:flex;align-items:center;gap:12px;padding:11px 0;border-bottom:1px solid var(--line)}.list li:last-child{border-bottom:0}
.list .grow{flex:1;min-width:0}.list .grow b{display:block;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.list .grow span{font-size:12.5px;color:var(--quiet)}
.meter{width:80px;height:6px;border-radius:999px;background:#edf0f2;overflow:hidden;flex:none}.meter i{display:block;height:100%}
.empty{text-align:center;color:var(--quiet);padding:22px 10px}.empty .ic{width:28px;height:28px;color:var(--good);display:block;margin:0 auto 6px}
.chips{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px}
.chip{display:inline-flex;align-items:center;gap:7px;border:1px solid var(--line2);background:#fff;border-radius:999px;padding:6px 13px;font-size:13px;font-weight:600;color:var(--ink2);text-decoration:none}
.chip span{font-size:12px;color:var(--quiet);font-variant-numeric:tabular-nums}.chip:hover{border-color:#aeb9c0;color:var(--ink)}
.chip.on{background:var(--navy);border-color:var(--navy);color:#fff}.chip.on span{color:var(--honey)}
.chip i{width:7px;height:7px;border-radius:50%;display:inline-block;background:currentColor}.chip.bad{color:var(--bad);border-color:#f0c2bd}.chip.warn{color:var(--warn);border-color:#f2d3a3}
/* ---------- Sample page ---------- */
.hero{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap;margin-bottom:18px}
.hero .who2{display:flex;gap:16px;align-items:center;min-width:0}
.hero .avatar{width:52px;height:52px;font-size:17px;background:var(--honey);color:var(--navy)}
.hero h1{margin:0}.hero .meta{display:flex;gap:8px 14px;flex-wrap:wrap;align-items:center;color:var(--quiet);font-size:13px;margin-top:4px}
.steps{display:flex;margin:0 0 18px;padding:18px 10px 14px;background:#fff;border:1px solid var(--line);border-radius:var(--r);box-shadow:var(--shadow);overflow-x:auto}
.step{flex:1;min-width:92px;text-align:center;font-size:12px;font-weight:600;color:#9aa5ab;position:relative;padding-top:30px}
.step:before{content:"";position:absolute;top:10px;left:0;right:0;height:3px;background:var(--line)}.step:first-child:before{left:50%}.step:last-child:before{right:50%}
.step:after{content:"";position:absolute;top:3px;left:50%;margin-left:-9px;width:18px;height:18px;border-radius:50%;background:#fff;border:3px solid var(--line2);box-sizing:border-box}
.step.past{color:var(--ink2)}.step.past:before,.step.now:before{background:var(--honey)}.step.now:before{background:linear-gradient(90deg,var(--honey) 50%,var(--line) 50%)}
.step.first.now:before{background:var(--line)}
.step.past:after{background:var(--honey);border-color:var(--honey);background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%231b2a35' stroke-width='3.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M6 12.5l4 4 8-9'/%3E%3C/svg%3E");background-size:12px;background-repeat:no-repeat;background-position:center}
.step.now{color:var(--ink)}.step.now:after{border-color:var(--honey);box-shadow:0 0 0 5px rgba(249,179,0,.22)}
.step.stop{color:var(--bad)}.step.stop:after{border-color:var(--bad);background:var(--bad-bg)}
.detail{display:grid;grid-template-columns:minmax(0,1.55fr) minmax(300px,1fr);gap:18px;align-items:start}
.detail>div>.card:last-child{margin-bottom:0}
/* ---------- Sign-in ---------- */
.auth{min-height:100vh;display:grid;grid-template-columns:minmax(0,1.05fr) minmax(380px,1fr)}
.auth .art{position:relative;background:#16252f url(/static/art.svg) center/cover no-repeat;overflow:hidden;color:#fff}
.auth .art:before{content:"";position:absolute;inset:0;background:linear-gradient(180deg,rgba(18,30,39,0) 35%,rgba(18,30,39,.94) 82%)}
.auth .art .q{position:absolute;z-index:1;left:clamp(28px,5vw,64px);right:clamp(28px,5vw,64px);bottom:clamp(28px,6vh,64px);max-width:520px}
.auth .art .q i{display:block;width:48px;height:4px;border-radius:4px;background:var(--honey);margin-bottom:18px}
.auth .art .q b{display:block;font-size:clamp(24px,2.4vw,34px);line-height:1.22;letter-spacing:-.02em}
.auth .art .q span{display:block;margin-top:14px;color:#ffd666;font-weight:700;font-size:12px;letter-spacing:.14em;text-transform:uppercase}
.auth .pane{display:flex;flex-direction:column;justify-content:center;padding:48px clamp(24px,6vw,88px);background:#fff}
.auth .pane form{width:100%;max-width:380px}.auth .pane img{height:40px;width:auto;margin-bottom:34px}
.auth h1{font-size:26px;margin:0 0 6px}.auth .grid{grid-template-columns:1fr}.auth button{width:100%;margin-top:6px}
.auth .foot{margin-top:28px;font-size:12.5px;color:var(--quiet);max-width:380px}
/* ---------- Small screens ---------- */
@media (max-width:1100px){.flow{grid-template-columns:repeat(3,minmax(0,1fr))}.phase:nth-child(3n){border-right:0}.phase:nth-child(-n+3){border-bottom:1px solid var(--line)}.phase:nth-child(3n):after{display:none}
.cols,.detail{grid-template-columns:minmax(0,1fr)}}
@media (max-width:860px){.app{grid-template-columns:minmax(0,1fr)}
.side{position:fixed;left:0;top:0;bottom:0;width:272px;transform:translateX(-100%);transition:transform .2s ease;box-shadow:0 10px 40px rgba(0,0,0,.18)}
#navt:checked~.side{transform:none}#navt:checked~.scrim{display:block;position:fixed;inset:0;background:rgba(22,35,44,.4);z-index:25}
.menu{display:inline-grid}.topbar{padding:10px 16px}main{padding:6px 16px 48px}.testflag{padding:5px 9px}.testflag b{display:none}
.auth{grid-template-columns:1fr}.auth .art{display:none}}
@media (max-width:640px){dl.facts{grid-template-columns:1fr;gap:2px 0}dl.facts dd{margin-bottom:8px}
.flow{grid-template-columns:repeat(2,minmax(0,1fr))}.phase{border-right:1px solid var(--line)!important;border-bottom:1px solid var(--line)}.phase:nth-child(2n){border-right:0!important}.phase:after{display:none}
h1{font-size:22px}.card{padding:16px}.kpis,.stats{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.stat{padding:12px 14px}.kpi{padding:12px 14px}.kpi b{font-size:24px}.kpi small{display:none}
table.stack thead{display:none}table.stack tr{display:block;padding:12px 14px;border-bottom:1px solid var(--line)}table.stack tr:last-child{border-bottom:0}table.stack td{display:block;padding:1px 0;border:0;text-align:left}table.stack td.num{text-align:left}table.stack td br{display:none}table.stack td .muted:before{content:" · "}table.stack td:first-child{float:right}
.list .meter{display:none}th,td{padding:10px 12px}.find{max-width:none}}
@media print{.side,.topbar,.noprint,.scrim{display:none!important}.app{display:block}main{padding:0;max-width:none}body{background:#fff}.card,.table-wrap,.steps{box-shadow:none}}
`;

const NAV = {
  admin: [['Overview', [['/', 'Dashboard', 'dashboard']]],
    ['Samples', [['/samples', 'Samples', 'samples'], ['/samples/new', 'Register', 'register']]],
    ['Lab', [['/tracking', 'Tracking', 'tracking']]],
    ['Report Centre', [['/reports', 'Reports', 'reports'], ['/counselling', 'Counselling', 'counselling'], ['/plans', 'Action plans', 'plan']]],
    ['Business', [['/billing', 'Billing', 'billing'], ['/monthly', 'Monthly report', 'chart'], ['/outbox', 'Outbox', 'outbox']]],
    ['Settings', [['/admin', 'Admin', 'admin']]]],
  lab: [['Overview', [['/', 'Dashboard', 'dashboard']]],
    ['Samples', [['/samples', 'Samples', 'samples'], ['/samples/new', 'Register', 'register']]],
    ['Lab', [['/tracking', 'Tracking', 'tracking']]],
    ['Report Centre', [['/reports', 'Reports', 'reports']]],
    ['Messages', [['/outbox', 'Outbox', 'outbox']]]],
  partner: [['Your work', [['/samples', 'Registration', 'samples'], ['/samples/new', 'New sample', 'register'], ['/billing', 'Billing', 'billing']]]],
  counsellor: [['Report Centre', [['/counselling', 'Counselling', 'counselling'], ['/plans', 'Action plans', 'plan']]], ['Clients', [['/samples', 'Clients', 'samples']]]],
};

const ROLE_LABEL = { admin: 'Admin', lab: 'Lab staff', partner: 'B2B partner', counsellor: 'Counsellor' };

function roleLabel(user) {
  if (user.role === 'partner') return user.account_type === 'supplier' ? 'B2B supplier' : 'B2B partner';
  return ROLE_LABEL[user.role];
}

function initials(name) {
  return String(name || '?').trim().split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
}

const FAVICON = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Cpath d='M16 1.5 29 9v14l-13 7.5L3 23V9z' fill='%23f9b300'/%3E%3Cpath d='M16 9v14M9 16h14' stroke='%231b2a35' stroke-width='3.2' stroke-linecap='round'/%3E%3C/svg%3E";

// Clicking anywhere on a row with data-href opens it; links and buttons inside keep working.
const SCRIPT = `document.addEventListener('click',function(e){var r=e.target.closest('tr[data-href]');if(!r||e.target.closest('a,button,input,select,textarea,label,summary'))return;if(e.ctrlKey||e.metaKey)window.open(r.dataset.href);else location.href=r.dataset.href});`;

function page({ title, user, path = '', flash, body, bare, query = {} }) {
  const head = html`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} · MyDNAPedia LIMS</title><link rel="icon" href="${raw(FAVICON)}"><meta name="theme-color" content="#f2f4f6"><style>${raw(CSS)}</style></head>`;
  const flashBox = flash ? html`<div class="flash ${flash.type}">${icon(flash.type === 'ok' ? 'check' : flash.type === 'error' ? 'alert' : 'info')}<div>${flash.text}</div></div>` : '';
  if (bare || !user) return html`${head}<body>${flashBox && !bare ? html`<main>${flashBox}</main>` : ''}${body}</body></html>`;
  const groups = NAV[user.role] || [];
  const active = (href) => (href === '/' ? path === '/' : path === href || (href !== '/samples' && path.startsWith(href + '/')) || (href === '/samples' && /^\/samples(\/(?!new)|$)/.test(path)));
  const flat = groups.length === 1;
  return html`${head}<body><div class="app">
<input type="checkbox" id="navt" aria-hidden="true" tabindex="-1">
<aside class="side" aria-label="Main menu">
<a class="logo" href="/"><img src="/static/logo-sm.png" alt="MyDNAPedia"><small>Laboratory system</small></a>
<nav>${groups.map(([g, items]) => html`${flat ? '' : html`<div class="grp">${g}</div>`}${items.map(([h, l, ic]) => html`<a href="${h}" class="${active(h) ? 'on' : ''}" ${active(h) ? raw('aria-current="page"') : ''}>${icon(ic)}${l}</a>`)}`)}</nav>
<div class="me"><div class="avatar">${initials(user.name)}</div><div class="who"><b>${user.name}</b><span>${roleLabel(user)}${user.account_name && user.role === 'partner' ? ` · ${user.account_name}` : ''}</span></div>
<a class="iconbtn" href="/password" title="Change password">${icon('key')}</a>
<form method="post" action="/logout" style="margin:0"><button class="iconbtn" title="Sign out" aria-label="Sign out">${icon('logout')}</button></form></div>
</aside><label for="navt" class="scrim" aria-hidden="true"></label>
<div class="content"><div class="topbar">
<label for="navt" class="menu iconbtn" aria-label="Menu">${icon('menu')}</label>
<form class="find" method="get" action="/samples" role="search">${icon('search')}<input name="q" value="${query.q || ''}" placeholder="Find a sample" aria-label="Find a sample" autocomplete="off"></form>
${config.live ? '' : html`<span class="testflag" title="Test version: dummy data only. Nothing is sent to patients or partners.">Test version<b> · dummy data</b></span>`}</div>
<main>${flashBox}${body}</main></div></div><script>${raw(SCRIPT)}</script></body></html>`;
}

// Each status gets the colour of its part of the journey.
const STATUS_TONE = {
  REGISTERED: '', COLLECTED: '',
  PICKUP_SCHEDULED: 'move', IN_TRANSIT_TO_LAB: 'move', DISPATCH_TO_PARTNER_SCHEDULED: 'move', IN_TRANSIT_TO_PARTNER: 'move',
  RECEIVED_AT_LAB: 'lab', RECEIVED_AT_PARTNER: 'lab', PARTNER_REPORT_RECEIVED: 'lab', IN_HOUSE_PROCESSING: 'lab', RESULT_READY: 'lab',
  REPORT_WHITE_LABELLED: 'rep', REPORT_APPROVED: 'rep', REPORT_RELEASED: 'rep',
  COUNSELLING_SCHEDULED: 'couns', COUNSELLING_DONE: 'couns', ACTION_PLAN_DRAFTED: 'couns', ACTION_PLAN_APPROVED: 'couns',
  DELIVERED: 'good', CLOSED: 'good',
  ON_HOLD: 'warn', RECOLLECTION_REQUESTED: 'warn', REJECTED: 'bad', CANCELLED: 'bad',
};

function statusPill(code, label) {
  return html`<span class="pill ${STATUS_TONE[code] || ''}">${label}</span>`;
}

function field(label, name, value = '', { type = 'text', required = false, opt = false, attrs = '' } = {}) {
  return html`<div><label for="${name}">${label}${opt ? html` <span class="opt">(optional)</span>` : ''}</label>
<input id="${name}" name="${name}" type="${type}" value="${value ?? ''}" ${required ? raw('required') : ''} ${raw(attrs)}></div>`;
}

function select(label, name, options, value = '', { required = false, placeholder = 'Choose…' } = {}) {
  return html`<div><label for="${name}">${label}</label><select id="${name}" name="${name}" ${required ? raw('required') : ''}>
<option value="">${placeholder}</option>${options.map((o) => {
    const [v, l] = Array.isArray(o) ? o : [o, o];
    return html`<option value="${v}" ${String(v) === String(value) ? raw('selected') : ''}>${l}</option>`;
  })}</select></div>`;
}

module.exports = { html, raw, esc, page, statusPill, field, select, roleLabel, icon, initials, STATUS_TONE };
