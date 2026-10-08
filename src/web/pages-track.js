// The public "Track your sample" page for patients. No sign-in: the sample ID
// plus the last four digits of the registered mobile open it.
const { html, raw, icon, field } = require('./views');
const track = require('../track');
const counselling = require('../counselling');
const config = require('../config');
const { getSetting, UserError } = require('../util');

const CSS = `
.trk{min-height:100vh;display:flex;flex-direction:column;align-items:center;padding:28px 16px 40px;background:linear-gradient(180deg,#fff6dc 0,#f2f4f6 260px)}
.trk .brand{display:flex;flex-direction:column;align-items:center;gap:4px;margin-bottom:22px;text-align:center}
.trk .brand img{height:42px;width:auto}.trk .brand small{color:var(--quiet);font-size:12px}
.trk .box{width:100%;max-width:520px;background:#fff;border:1px solid var(--line);border-radius:16px;box-shadow:var(--shadow);padding:24px}
.trk h1{font-size:22px;margin:0 0 4px}.trk .sub{margin:0 0 18px;color:var(--quiet)}
.trk form .grid{grid-template-columns:1fr}.trk form button{width:100%;margin-top:6px}
.trk .who{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap}
.trk .who b{display:block;font-size:20px}.trk .who span{color:var(--quiet)}
.trk .tag{font:600 12px/1 ui-monospace,Menlo,monospace;background:var(--hover);border:1px solid var(--line);padding:6px 9px;border-radius:999px;white-space:nowrap}
.trk .msg{margin:18px 0;padding:14px 16px;border-radius:12px;background:var(--teal-bg);color:#0b4f66;font-weight:600}
.trk .msg.stop{background:var(--honey-bg);color:var(--honey-ink)}.trk .msg.off{background:var(--hover);color:var(--ink2)}
.trk .eta{display:flex;gap:14px;align-items:center;padding:16px;border:1px solid var(--line);border-radius:12px;margin-bottom:20px}
.trk .eta .ic{width:42px;height:42px;flex:none;border-radius:50%;display:grid;place-items:center;background:var(--honey-bg);color:var(--honey2)}
.trk .eta.ready .ic{background:#e7f6ec;color:#1e7a3c}
.trk .eta span{display:block;color:var(--quiet);font-size:13px}.trk .eta b{display:block;font-size:19px}.trk .eta em{display:block;font-style:normal;font-size:12px;color:var(--quiet);margin-top:2px}
.trk ol{list-style:none;margin:0;padding:0}
.trk li{position:relative;display:flex;gap:14px;padding:0 0 18px}
.trk li:before{content:"";position:absolute;left:11px;top:24px;bottom:-2px;width:2px;background:var(--line)}
.trk li:last-child{padding-bottom:0}.trk li:last-child:before{display:none}
.trk li i{flex:none;width:24px;height:24px;border-radius:50%;border:2px solid var(--line2);background:#fff;z-index:1;display:grid;place-items:center}
.trk li.done i{background:var(--teal);border-color:var(--teal)}.trk li.done:before{background:var(--teal)}
.trk li.done i:after{content:"";width:9px;height:5px;border:2px solid #fff;border-top:0;border-right:0;transform:translateY(-1px) rotate(-45deg)}
.trk li.now i{border-color:var(--honey);box-shadow:0 0 0 5px var(--honey-bg)}.trk li.now i:after{content:"";width:10px;height:10px;border-radius:50%;background:var(--honey)}
.trk li.stop i{border-color:var(--honey2);background:var(--honey-bg)}
.trk li div{padding-top:2px}.trk li b{display:block;font-weight:600}.trk li.todo b{color:var(--quiet);font-weight:500}
.trk li span{font-size:12px;color:var(--quiet)}
.trk .book{margin:0 0 20px;padding:16px;border:1px solid #f6dd9a;background:#fffaf0;border-radius:12px}.trk .book>b{display:block;font-size:16px}.trk .book p{margin:4px 0 12px;color:var(--ink2);font-size:13px}
.trk .day{display:flex;gap:10px;align-items:flex-start;padding:8px 0;border-top:1px solid #f3e6c4}.trk .day>span{flex:none;width:92px;font-weight:600;font-size:13px;padding-top:7px}
.trk .day>div{display:flex;flex-wrap:wrap;gap:6px}.trk .slot{display:block;margin:0;cursor:pointer}.trk .slot input{position:absolute;opacity:0;width:1px;height:1px}
.trk .slot span{display:block;padding:6px 10px;border:1px solid var(--line2);border-radius:8px;background:#fff;font-weight:600;font-size:13px;line-height:1.2;text-align:center}
.trk .slot small{display:block;font-weight:400;font-size:10.5px;color:var(--quiet)}.trk .slot input:checked+span{background:var(--honey);border-color:var(--honey2)}
.trk .slot input:focus-visible+span{outline:2px solid var(--teal)}.trk .book button{width:100%;margin-top:12px}
.trk .help{margin-top:20px;padding-top:16px;border-top:1px solid var(--line);font-size:13px;color:var(--ink2)}
.trk .again{display:inline-block;margin-top:14px;font-weight:600}
.trk .foot{margin-top:18px;font-size:12px;color:var(--quiet);text-align:center;max-width:520px}
`;

module.exports = function routes(router, { db }, h) {
  const limit = track.limiter();
  // Behind the web server the real address is the last X-Forwarded-For entry.
  const clientIp = (ctx) => {
    const xf = config.live && ctx.req.headers['x-forwarded-for'];
    return xf ? xf.split(',').pop().trim() : ctx.req.socket.remoteAddress || '';
  };

  const shell = (ctx, body, status = 200) => {
    const lab = getSetting(db, 'labName');
    h.send(ctx, 'Track your sample', html`<style>${raw(CSS)}</style><div class="trk">
<div class="brand"><img src="/static/logo-sm.png" alt="${lab}"><small>${getSetting(db, 'unitLine')}</small></div>
<div class="box">${body}</div>
<p class="foot">Your details are private. This page shows only the progress of your sample.${config.live ? '' : html`<br><span class="testflag" style="margin:8px 0 0">Test version · dummy data only</span>`}</p></div>`, { bare: true, status });
  };

  const form = (ctx, id = '', error = '') => html`<h1>Track your sample</h1>
<p class="sub">Enter the sample ID from your registration message and the last four digits of your mobile number.</p>
${error ? html`<div class="flash error">${icon('alert')}<div>${error}</div></div>` : ''}
<form method="post" action="/track"><div class="grid">
${field('Sample ID', 'id', id, { required: true, attrs: 'autocomplete="off" autocapitalize="characters" spellcheck="false"' })}
${field('Last 4 digits of your mobile', 'm', '', { required: true, attrs: 'inputmode="numeric" pattern="[0-9]{4}" maxlength="4" autocomplete="off"' })}
</div><button>${icon('search')}Show my sample</button></form>`;

  // Counselling times the client can choose, grouped by day.
  const booking = (v, m) => {
    const slots = counselling.openSlots(db, { counsellor_id: v.counsellorId });
    const day = (iso) => new Intl.DateTimeFormat('en-IN', { timeZone: config.timeZone, weekday: 'short', day: '2-digit', month: 'short' }).format(new Date(iso));
    const time = (iso) => new Intl.DateTimeFormat('en-IN', { timeZone: config.timeZone, hour: '2-digit', minute: '2-digit', hour12: true }).format(new Date(iso));
    const byDay = new Map();
    for (const sl of slots) { const d = day(sl.starts_at); if (!byDay.has(d)) byDay.set(d, []); byDay.get(d).push(sl); }
    return html`<div class="book"><b>${v.session ? 'Change your counselling time' : 'Choose your counselling time'}</b>
${slots.length ? html`<p>Pick a time that suits you. The session is with our genetic counsellor${v.counsellorId && slots[0] ? `, ${slots[0].counsellor_name}` : ''}.</p>
<form method="post" action="/track/book"><input type="hidden" name="id" value="${v.sampleId}"><input type="hidden" name="m" value="${m}">
${[...byDay].map(([d, list]) => html`<div class="day"><span>${d}</span><div>${list.map((sl) => html`<label class="slot"><input type="radio" name="slot" value="${sl.id}" required><span>${time(sl.starts_at)}<small>${sl.mode}</small></span></label>`)}</div></div>`)}
<button>Book this time</button></form>` : html`<p>No times are open right now. Our counsellor will call you to book, or check again tomorrow.</p>`}</div>`;
  };

  const result = (v, m = '') => {
    const e = v.eta;
    return html`<div class="who"><div><b>Hello ${v.firstName}</b><span>${v.test} · registered ${v.registered}</span></div><span class="tag">${v.sampleId}</span></div>
<div class="msg ${v.tone}" role="status">${v.now}</div>
${e ? html`<div class="eta ${e.kind}"><div class="ic">${icon(e.kind === 'ready' ? 'check' : 'clock')}</div><div>
${e.date ? html`<span>${e.text}</span><b>${e.date}</b>` : html`<b style="font-size:15px">${e.text}</b>`}
${e.kind === 'due' ? html`<em>About ${e.days} ${e.days === 1 ? 'day' : 'days'} from today</em>` : ''}${e.note ? html`<em>${e.note}</em>` : ''}
${v.session ? html`<em>Counselling session: ${new Intl.DateTimeFormat('en-IN', { timeZone: config.timeZone, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true }).format(new Date(v.session.scheduled_at))}</em>` : ''}
</div></div>` : ''}
${v.bookable ? booking(v, m) : ''}
<ol>${v.steps.map((s) => html`<li class="${s.state}"><i></i><div><b>${s.label}</b>${s.date ? html`<span>${s.date}</span>` : s.state === 'now' ? html`<span>In progress</span>` : ''}</div></li>`)}</ol>
<div class="help">Questions? Call or WhatsApp ${v.support.phone} or email ${v.support.email}, quoting your sample ID.</div>
<a class="again" href="/track">Track another sample</a>`;
  };

  router.get('/track', (ctx) => shell(ctx, form(ctx, String(ctx.query.id || '').slice(0, 40))));

  router.post('/track', (ctx) => {
    const ip = clientIp(ctx);
    const id = String(ctx.body.id || '').trim().slice(0, 40);
    if (limit.blocked(ip)) return shell(ctx, form(ctx, id, 'Too many tries. Please wait 15 minutes and try again, or contact us.'), 429);
    const v = track.lookup(db, id, ctx.body.m);
    if (!v) {
      limit.fail(ip);
      return shell(ctx, form(ctx, id, 'We could not find a sample with that ID and mobile number. Please check both and try again.'), 404);
    }
    shell(ctx, result(v, String(ctx.body.m || '').replace(/\D/g, '').slice(-4)));
  });

  router.post('/track/book', (ctx) => {
    const ip = clientIp(ctx);
    const id = String(ctx.body.id || '').trim().slice(0, 40);
    if (limit.blocked(ip)) return shell(ctx, form(ctx, id, 'Too many tries. Please wait 15 minutes and try again, or contact us.'), 429);
    const m = String(ctx.body.m || '').replace(/\D/g, '').slice(-4);
    let v = track.lookup(db, id, m);
    if (!v) { limit.fail(ip); return shell(ctx, form(ctx, id, 'We could not find a sample with that ID and mobile number. Please check both and try again.'), 404); }
    let note;
    try {
      if (!v.bookable) throw new UserError('A counselling time cannot be chosen for this sample now.');
      const b = counselling.bookByPatient(db, v.sampleId, ctx.body.slot);
      note = html`<div class="flash ok" style="margin:0 0 14px">Booked for ${new Intl.DateTimeFormat('en-IN', { timeZone: config.timeZone, weekday: 'long', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true }).format(new Date(b.when))} with ${b.counsellor} (${b.mode.toLowerCase()}). We have sent you the details.</div>`;
    } catch (e) {
      if (!(e instanceof UserError)) throw e;
      note = html`<div class="flash error" style="margin:0 0 14px">${e.message}</div>`;
    }
    v = track.lookup(db, id, m);
    shell(ctx, html`${note}${result(v, m)}`);
  });
};
