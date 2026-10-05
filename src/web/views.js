// HTML building blocks. Every value put into a page goes through html``, which
// escapes it unless it is already trusted markup (raw / nested html``).
class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
const raw = (s) => new Raw(String(s));

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

const CSS = `
:root{--ink:#14232b;--quiet:#5b6b73;--line:#d9e1e5;--bg:#f5f8f9;--card:#fff;--brand:#0d6e78;--brand-ink:#fff;--warn:#9a5b00;--warn-bg:#fff4e0;--bad:#b42318;--bad-bg:#fdecea;--good:#18794e;--good-bg:#e6f4ec}
*{box-sizing:border-box}body{margin:0;font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--ink);background:var(--bg)}
a{color:var(--brand)}header{background:var(--brand);color:var(--brand-ink)}
.top{display:flex;align-items:center;gap:20px;max-width:1200px;margin:0 auto;padding:10px 16px;flex-wrap:wrap}
.brand{font-weight:700;font-size:18px;color:#fff;text-decoration:none}.brand small{font-weight:400;opacity:.8;margin-left:6px}
nav{display:flex;gap:4px;flex-wrap:wrap;flex:1}nav a{color:#fff;text-decoration:none;padding:6px 10px;border-radius:6px}nav a.on,nav a:hover{background:rgba(255,255,255,.18)}
.who{font-size:13px;opacity:.9}.who a{color:#fff}
.stage{background:#fff4e0;color:#7a4a00;text-align:center;font-size:13px;padding:4px}
main{max-width:1200px;margin:0 auto;padding:20px 16px 60px}
h1{font-size:24px;margin:0 0 4px}h2{font-size:18px;margin:28px 0 8px}.sub{color:var(--quiet);margin:0 0 18px}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:18px;margin-bottom:16px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px 16px}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin-bottom:16px}
.stat{background:#fff;border:1px solid var(--line);border-radius:10px;padding:14px}.stat b{display:block;font-size:24px}.stat span{color:var(--quiet);font-size:13px}
label{display:block;font-size:13px;font-weight:600;margin-bottom:4px}label .opt{font-weight:400;color:var(--quiet)}
input,select,textarea{width:100%;padding:8px 10px;border:1px solid #b9c5cb;border-radius:6px;font:inherit;background:#fff}
textarea{min-height:70px}input[type=checkbox],input[type=radio]{width:auto;margin-right:6px}
.check{display:flex;align-items:flex-start;gap:4px;font-weight:400;font-size:14px;margin:6px 0}
button,.btn{display:inline-block;background:var(--brand);color:#fff;border:0;border-radius:6px;padding:9px 16px;font:inherit;font-weight:600;cursor:pointer;text-decoration:none}
.btn.light,button.light{background:#fff;color:var(--brand);border:1px solid var(--brand)}.btn.small,button.small{padding:5px 10px;font-size:13px}
button.danger{background:var(--bad)}.actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:14px}
table{width:100%;border-collapse:collapse;background:#fff}th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line);vertical-align:top}
th{font-size:12px;text-transform:uppercase;letter-spacing:.03em;color:var(--quiet);background:#fafcfc}
td.num,th.num{text-align:right;white-space:nowrap}.table-wrap{overflow-x:auto;border:1px solid var(--line);border-radius:10px}
.pill{display:inline-block;padding:2px 8px;border-radius:999px;font-size:12px;font-weight:600;background:#e8eef1;color:#33444c;white-space:nowrap}
.pill.good{background:var(--good-bg);color:var(--good)}.pill.warn{background:var(--warn-bg);color:var(--warn)}.pill.bad{background:var(--bad-bg);color:var(--bad)}
.flash{padding:10px 14px;border-radius:8px;margin-bottom:14px}.flash.error{background:var(--bad-bg);color:var(--bad)}.flash.ok{background:var(--good-bg);color:var(--good)}.flash.warn{background:var(--warn-bg);color:var(--warn)}
.neg{color:var(--bad)}.muted{color:var(--quiet)}.mono{font-family:ui-monospace,Menlo,Consolas,monospace}
dl.facts{display:grid;grid-template-columns:180px 1fr;gap:6px 12px;margin:0}dl.facts dt{color:var(--quiet)}dl.facts dd{margin:0}
.timeline{list-style:none;padding:0;margin:0}.timeline li{padding:8px 0 8px 18px;border-left:2px solid var(--line);position:relative}
.timeline li:before{content:"";position:absolute;left:-6px;top:13px;width:10px;height:10px;border-radius:50%;background:var(--brand)}
.filters{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}.filters input,.filters select{width:auto;min-width:160px}
.login{max-width:380px;margin:60px auto}
@media (max-width:640px){dl.facts{grid-template-columns:1fr}}
@media print{header,.stage,.noprint{display:none}main{padding:0}body{background:#fff}}
`;

const NAV = {
  admin: [['/', 'Dashboard'], ['/samples', 'Samples'], ['/samples/new', 'Register'], ['/tracking', 'Tracking'], ['/billing', 'Billing'], ['/outbox', 'Outbox'], ['/admin', 'Admin'], ['/audit', 'Audit']],
  lab: [['/', 'Dashboard'], ['/samples', 'Samples'], ['/samples/new', 'Register'], ['/tracking', 'Tracking'], ['/outbox', 'Outbox']],
  partner: [['/samples', 'Registration'], ['/samples/new', 'New sample'], ['/billing', 'Billing']],
  counsellor: [['/', 'Dashboard']],
};

const ROLE_LABEL = { admin: 'Admin', lab: 'Lab staff', partner: 'B2B partner', counsellor: 'Counsellor' };

function roleLabel(user) {
  if (user.role === 'partner') return user.account_type === 'supplier' ? 'B2B supplier' : 'B2B partner';
  return ROLE_LABEL[user.role];
}

function page({ title, user, path = '', flash, body, bare }) {
  const nav = user ? NAV[user.role] || [] : [];
  const active = (href) => (href === '/' ? path === '/' : path === href || (href !== '/samples' && path.startsWith(href + '/')) || (href === '/samples' && /^\/samples(\/(?!new)|$)/.test(path)));
  return html`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} · MyDNAPedia LIMS</title><style>${raw(CSS)}</style></head><body>
${bare ? '' : html`<header><div class="top"><a class="brand" href="/">MyDNAPedia <small>LIMS</small></a>
${user ? html`<nav>${nav.map(([h, l]) => html`<a href="${h}" class="${active(h) ? 'on' : ''}">${l}</a>`)}</nav>
<div class="who">${user.name} · ${roleLabel(user)}${user.account_name && user.role === 'partner' ? html` · ${user.account_name}` : ''} · <a href="/password">Password</a> · <form method="post" action="/logout" style="display:inline"><button class="small light" style="padding:2px 8px">Sign out</button></form></div>` : ''}
</div></header><div class="stage">Test version: dummy data only. Nothing is sent to patients or partners.</div>`}
<main>${flash ? html`<div class="flash ${flash.type}">${flash.text}</div>` : ''}${body}</main></body></html>`;
}

const STATUS_TONE = { CANCELLED: 'bad', REJECTED: 'bad', RECEIVED_AT_LAB: 'good', ON_HOLD: 'warn', RECOLLECTION_REQUESTED: 'warn', DELIVERED: 'good', CLOSED: 'good', COLLECTED: '', REGISTERED: '' };

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

module.exports = { html, raw, esc, page, statusPill, field, select, roleLabel };
