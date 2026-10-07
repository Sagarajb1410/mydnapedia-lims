// The public "Track your sample" page for patients. No sign-in: the sample ID
// plus the last four digits of the registered mobile open it.
const { html, raw, icon, field } = require('./views');
const track = require('../track');
const config = require('../config');
const { getSetting } = require('../util');

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

  const result = (v) => {
    const e = v.eta;
    return html`<div class="who"><div><b>Hello ${v.firstName}</b><span>${v.test} · registered ${v.registered}</span></div><span class="tag">${v.sampleId}</span></div>
<div class="msg ${v.tone}" role="status">${v.now}</div>
${e ? html`<div class="eta ${e.kind}"><div class="ic">${icon(e.kind === 'ready' ? 'check' : 'clock')}</div><div>
${e.date ? html`<span>${e.text}</span><b>${e.date}</b>` : html`<b style="font-size:15px">${e.text}</b>`}
${e.kind === 'due' ? html`<em>About ${e.days} ${e.days === 1 ? 'day' : 'days'} from today</em>` : ''}${e.note ? html`<em>${e.note}</em>` : ''}
${v.session ? html`<em>Counselling session: ${new Intl.DateTimeFormat('en-IN', { timeZone: config.timeZone, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true }).format(new Date(v.session.scheduled_at))}</em>` : ''}
</div></div>` : ''}
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
    shell(ctx, result(v));
  });
};
