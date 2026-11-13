/* fix-flow-1111.js：第二批补稿 · 甲一路（2026-11-11）：登录先行、到期说明、换人保护、死入口、帮助、输入。
 * 新增 6 屏：session-expired、handover、help-qa、kbd-short（状态样式板）、phone-fill、phone-fill-m。
 * 改 4 屏：login、home、pickup、help。默认状态只动说明里列的几处：包住原 render，在它产出的 HTML 上做带断言的替换
 * （替换目标不是恰好出现一次就 throw）；login 的新状态 sms-down、loading 走新画法。
 * 反方评审后（11/11 总指挥补充）：不另设「用 AI 前先登录」一屏，游客点要用 AI 的入口直接到 login，带来路 S().b2ctx。
 * 状态键：S().mini（小程序已发布，默认 false）、S().scanner（本机有扫码器，默认 true）、S().gate（用 AI 前先登录，默认 true）、
 * S().b2v（当前屏变体）、S().b2ctx（来路：resume / interview / xq / me / jobfit）。类名一律 b2a-。 */
(function () {
  const { icon, band, slab, tile, nav } = UI;
  const S = () => window.S;
  const ic = (n, s) => icon(n, s || 28, 2);
  const PHONE = '需要帮助？拨打服务电话 183-6916-1921';
  const PHONE_NOTE = '号码与服务时间从后台读，读不到不显示。';

  /* window.S 由 app.js 建，app.js 排在本文件之后：加载时它还不存在。所以三个默认值在每次画屏、每次点击时补，
     写法与通用说明给的那一行相同（mini=1 / scanner=0 / gate=0 从地址读）。 */
  function keys() {
    if (!window.S) return {};
    if (window.S.mini === undefined) window.S.mini = /[?&]mini=1/.test(location.search);
    if (window.S.scanner === undefined) window.S.scanner = !/[?&]scanner=0/.test(location.search);
    if (window.S.gate === undefined) window.S.gate = !/[?&]gate=0/.test(location.search);
    return window.S;
  }
  function once(html, from, to, where) {
    const n = html.split(from).length - 1;
    if (n !== 1) throw new Error('fix-flow-1111：' + where + ' 的替换目标出现 ' + n + ' 次（应为 1 次）：' + from.slice(0, 48));
    return html.replace(from, () => to);
  }
  function span(html, start, end, to, where) {
    const a = html.split(start).length - 1;
    const i = html.indexOf(start);
    const j = i < 0 ? -1 : html.indexOf(end, i + start.length);
    if (a !== 1 || j < 0) throw new Error('fix-flow-1111：' + where + ' 的起止标记对不上（起点 ' + a + ' 次）');
    return html.slice(0, i) + to + html.slice(j);
  }
  const def = (id) => {
    const d = window.SCREENS.find((x) => x.id === id);
    if (!d) throw new Error('fix-flow-1111：找不到屏 ' + id);
    return d;
  };
  const placeAfter = (afterId, screen) => {
    const list = window.SCREENS;
    const i = list.findIndex((x) => x.id === afterId);
    if (i < 0) list.push(screen); else list.splice(i + 1, 0, screen);
  };
  const remind = (text) => `<div class="remind">${ic('call', 34)}<span>${text}</span></div>`;
  const backBtn = (label) => `<button class="btn sec" data-act="back">${icon('chevL', 30, 2.4)}${label || '返回'}</button>`;
  const askBtn = (text) => `<button class="askq" data-go="xq" data-ctx="${text.replace(/"/g, '')}"><span class="mic">${icon('mic', 30, 2.2)}</span><span>${text}</span></button>`;
  const priBtn = (label, attrs, o = {}) => `<button class="btn pri${o.wide ? ' wide' : ''}" ${attrs}${o.disabled ? ' disabled' : ''}>${label}${icon('arrowR', 30, 2.4)}</button>`;
  const withAttr = (html, find, extra) => once(html, find, find + ' ' + extra, 'withAttr');
  /* slab() 只认 go / act / arg / id；要带 data-set、data-b2 等就加在开头标签上 */
  const slabWith = (o, at) => {
    const h = slab(o);
    if (h.indexOf('<button ') !== 0) throw new Error('fix-flow-1111：slab 开头不是 <button');
    return '<button ' + at + ' ' + h.slice('<button '.length);
  };

  const css = document.createElement('style');
  css.id = 'b2a-a1-style';
  css.textContent = `
.b2a-ret{display:flex;align-items:center;gap:16px;min-height:84px;padding:10px 20px;border-radius:22px;background:var(--teal-wash);color:var(--teal-ink);flex:none}
.b2a-ret .b2a-ric{width:56px;height:56px;border-radius:16px;background:var(--card);display:grid;place-items:center;flex:none}
.b2a-ret b{display:block;font-size:26px;line-height:1.3;color:var(--ink)}
.b2a-ret small{display:block;font-size:21px;line-height:1.35;color:var(--teal-ink);font-weight:600}
.askq.b2a-askhelp .mic{background:var(--slate)}
.b2a-anon{display:flex;flex-direction:column;gap:8px}
.b2a-anon>.fp-k{margin:2px 0 0}
.b2a-anon-row{display:grid;gap:12px}
.b2a-anon-row.n3{grid-template-columns:repeat(3,minmax(0,1fr))}
.b2a-anon-row.n4{grid-template-columns:repeat(4,minmax(0,1fr))}
.b2a-anon-row .fp-hit{min-height:104px;align-items:center}
.b2a-anon-row .fp-hit b{font-size:26px}
.b2a-hold{background:var(--well)!important;border-style:dashed!important;cursor:default}
.b2a-hold:active{transform:none}
.b2a-hold>.chip{margin-left:auto;flex:none;height:36px;font-size:20px}
.b2a-err{display:flex;align-items:center;gap:16px;min-height:88px;padding:12px 22px;border-radius:22px;background:var(--cin-wash);color:var(--cinnabar);font-size:25px;font-weight:700;line-height:1.45;flex:none}
.b2a-err svg{flex:none}
.b2a-lopts{display:grid;grid-template-columns:1fr 1fr;gap:12px;flex:none}
.b2a-lopt{display:flex;align-items:center;gap:14px;min-height:112px;padding:14px 18px;border-radius:22px;background:var(--card);border:1.5px solid var(--edge);text-align:left;width:100%}
.b2a-lopt.b2a-off{background:var(--well);border-style:dashed;cursor:default}
.b2a-lopt b{display:block;font-size:27px;line-height:1.3;color:var(--ink)}
.b2a-lopt small{display:block;margin-top:4px;font-size:21px;line-height:1.4;color:var(--clay-ink);font-weight:600}
.b2a-lopt:not(.b2a-off) small{color:var(--teal-ink)}
.b2a-lopt .b2a-lic{width:64px;height:64px;border-radius:18px;background:var(--paper-2);color:var(--ink-3);display:grid;place-items:center;flex:none}
.b2a-lopt:not(.b2a-off) .b2a-lic{background:var(--teal-wash);color:var(--teal-ink)}
.b2a-exits{flex:1;min-height:0;display:flex;flex-direction:column;gap:12px}
.b2a-exits>.slab.row{flex:1 1 0;min-height:150px;padding:14px 26px 14px 18px;gap:24px;grid-template-columns:180px minmax(0,1fr)}
.b2a-exits>.slab.row .vis{min-height:0;height:100%;max-height:220px}
.b2a-exits>.slab.row h3{font-size:34px}
.b2a-exits>.slab.row .take{margin-top:4px}
.b2a-fill.body{justify-content:flex-start;gap:12px;padding:14px 40px 12px}
.b2a-pair{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.b2a-pair>.fp-card{display:flex;flex-direction:column;gap:8px;min-height:0;overflow:hidden}
.b2a-opts{display:flex;flex-direction:column;gap:12px;flex:none}
.b2a-opts>.slab.row{min-height:200px;padding:20px 28px 20px 22px}
.b2a-opts>.slab.row .vis{min-height:150px}
.b2a-hand .b2a-lead{margin:0;font-size:24px;line-height:1.5;color:var(--ink-2);flex:none}
.b2a-hcard{flex:1 1 0;min-height:0;display:grid;grid-template-columns:300px minmax(0,1fr) 64px;gap:28px;align-items:center;padding:22px 28px 22px 22px;border-radius:32px;background:var(--card);border:1.5px solid var(--edge);text-align:left;width:100%;transition:transform var(--t-press)}
.b2a-hcard:active{transform:scale(.985)}
.b2a-hcard.b2a-yes{background:linear-gradient(150deg,#174b3e,#0b2a22 70%);color:var(--cream);border-color:transparent}
.b2a-hart{align-self:stretch;min-height:0;border-radius:24px;background:var(--well);display:grid;place-items:center;overflow:hidden}
.b2a-yes .b2a-hart{background:rgba(255,255,255,.07)}
.b2a-htx b{display:block;font:700 44px/1.25 var(--serif)}
.b2a-htx small{display:block;margin-top:14px;font-size:28px;line-height:1.5;color:var(--ink-2)}
.b2a-yes .b2a-htx small{color:var(--mint)}
.b2a-go{width:64px;height:64px;border-radius:50%;background:var(--deep);color:var(--cream);display:grid;place-items:center}
.b2a-yes .b2a-go{background:var(--glow);color:var(--deep)}
.b2a-why{display:flex;align-items:center;gap:18px;min-height:110px;padding:18px 26px;border-radius:26px;background:var(--well);color:var(--ink-2);font-size:24px;line-height:1.55;flex:none}
.b2a-why svg{flex:none;color:var(--teal-ink)}
.b2a-qas{display:flex;flex-direction:column;gap:12px}
.b2a-qa{display:grid;grid-template-columns:56px minmax(0,1fr);gap:18px;align-items:start;padding:22px 26px;border-radius:26px;background:var(--card);border:1.5px solid var(--edge)}
.b2a-qa .b2a-qn{width:52px;height:52px;border-radius:50%;background:var(--deep);color:var(--cream);display:grid;place-items:center;font:700 24px var(--sans);margin-top:2px}
.b2a-qa b{display:block;font:700 30px/1.35 var(--sans);color:var(--ink)}
.b2a-qa p{margin:8px 0 0;font-size:24px;line-height:1.55;color:var(--ink-2)}
.b2a-links .fp-hit{min-height:88px}
.b2a-kbody.body{justify-content:flex-start;gap:14px;padding:16px 40px 14px}
.b2a-field{display:flex;flex-direction:column;gap:8px;padding:18px 24px 20px;border-radius:26px;background:var(--card);border:2.5px solid var(--teal);box-shadow:0 0 0 6px rgba(31,158,134,.10);flex:none}
.b2a-field .b2a-fl{display:flex;align-items:center;gap:12px;font-size:22px;font-weight:700;color:var(--ink-2)}
.b2a-field .b2a-fl .chip{height:34px;font-size:20px}
.b2a-fv{font:500 40px/1.35 var(--sans);color:var(--ink);min-height:56px;word-break:break-all}
.b2a-fv.b2a-long{font-size:30px;line-height:1.6;min-height:200px}
.b2a-fv u{text-decoration:none;border-bottom:3px solid var(--teal);color:var(--teal-ink);margin:0 2px}
.b2a-caret{display:inline-block;width:3px;height:1.1em;background:var(--teal);vertical-align:-0.15em;margin-left:2px;animation:blink 1.1s step-end infinite}
.b2a-next{display:grid;grid-template-columns:1fr 1fr;gap:12px;flex:none}
.b2a-nf{display:flex;flex-direction:column;gap:4px;min-height:96px;padding:12px 18px;border-radius:20px;background:var(--well);border:1.5px dashed var(--line)}
.b2a-nf small{font-size:20px;color:var(--ink-3);font-weight:700}
.b2a-nf b{font-size:24px;line-height:1.35;color:var(--ink-2)}
.b2a-nf b.b2a-done{color:var(--ink)}
.b2a-kb{flex:none;display:flex;flex-direction:column;gap:10px;padding:14px 24px 22px;background:var(--paper-2);border-top:1px solid var(--line);border-radius:34px 34px 0 0;box-shadow:0 -14px 40px rgba(11,36,30,.10)}
.b2a-kb-tip{display:flex;align-items:center;gap:14px;min-height:88px;padding:8px 10px 8px 22px;border-radius:24px;background:var(--teal-wash);color:var(--teal-ink)}
.b2a-kb-tip b{flex:1;font-size:25px;line-height:1.35}
.b2a-kb-tip .btn{height:72px;min-width:0;font-size:24px;padding:0 22px;border-radius:20px}
.b2a-kb-cand{display:flex;align-items:center;gap:8px;min-height:80px;padding:0 10px;border-radius:20px;background:var(--card);border:1.5px solid var(--edge)}
.b2a-kb-cand .b2a-comp{font:600 26px/1 var(--sans);color:var(--teal-ink);padding:0 14px 0 6px;border-right:1.5px solid var(--line);margin-right:4px;letter-spacing:.04em}
.b2a-kb-cand i{font-style:normal;min-width:72px;height:72px;display:grid;place-items:center;font:500 34px/1 var(--sans);color:var(--ink);border-radius:16px}
.b2a-kb-cand i:first-of-type{background:var(--teal-wash);color:var(--teal-ink);font-weight:700}
.b2a-kb-cand .b2a-hint{font-size:22px;color:var(--ink-3);padding-left:8px}
.b2a-kb-row{display:flex;justify-content:center;gap:10px}
.b2a-k{width:88px;height:84px;border-radius:18px;background:var(--card);border:1.5px solid var(--edge);display:grid;place-items:center;font:500 32px/1 var(--sans);color:var(--ink);box-shadow:0 2px 0 rgba(11,36,30,.08)}
.b2a-k.fn{background:var(--well);font-size:24px;font-weight:700;color:var(--ink-2);width:120px}
.b2a-k.space{flex:1;max-width:none;width:auto}
.b2a-k.ok{background:var(--deep);color:var(--cream);width:180px;font-size:26px;font-weight:700;border-color:transparent}
.b2a-k.on{background:var(--deep);color:var(--cream);border-color:transparent}
button.b2a-k{cursor:pointer}
.b2a-bqr{position:relative;flex:none;width:252px;height:252px;padding:16px;border-radius:30px;background:var(--card);display:grid;place-items:center;box-shadow:0 14px 34px rgba(0,0,0,.25)}
.b2a-bqr .qr-box{width:220px;height:220px}
.b2a-bqr .qr-box .pulse{border-radius:20px}
.b2a-bqr.b2a-dim .illus{opacity:.18}
.b2a-bqr .b2a-qrx{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);padding:8px 18px;border-radius:16px;background:var(--clay-wash);color:var(--clay-ink);font-size:24px;font-weight:700;white-space:nowrap}
.b2a-rowx{display:flex;align-items:center;gap:18px;flex:none}
.b2a-rowx .btn{height:80px;min-width:0}
.b2a-rowx .fine{flex:1;text-align:left}
.b2a-got{display:flex;flex-direction:column;gap:10px;padding:22px 26px;border-radius:26px;background:var(--card);border:2px solid rgba(31,158,134,.55);box-shadow:0 10px 30px rgba(31,158,134,.10);flex:none}
.b2a-got .b2a-gl{display:flex;align-items:center;gap:12px;font-size:21px;font-weight:700;color:var(--teal-ink)}
.b2a-got .b2a-gl .chip{height:34px;font-size:20px}
.b2a-got p{margin:0;font-size:27px;line-height:1.6;color:var(--ink)}
.b2a-got ol{margin:0;padding-left:34px;display:flex;flex-direction:column;gap:4px}
.b2a-got li{font-size:26px;line-height:1.55;color:var(--ink)}
.b2a-got small{font-size:20px;color:var(--ink-3)}
.b2a-pfpage.phonepage{padding:12px 28px 0}
.b2a-pfpage .pcap h1{font-size:44px;margin:6px 0 4px}
.b2a-pf{margin-top:14px;width:694px;height:1500px;flex:none;border-radius:96px;background:#050908;padding:21px;box-shadow:0 0 0 3px #2a3632,0 30px 80px rgba(0,0,0,.5)}
.b2a-pfs{width:100%;height:100%;border-radius:78px;background:var(--paper);overflow:hidden;color:var(--ink);display:flex;flex-direction:column}
.b2a-ptop{display:flex;align-items:center;gap:14px;height:104px;padding:24px 34px 0;background:var(--deep);color:var(--cream);flex:none}
.b2a-ptop .pm{width:46px;height:46px;border-radius:14px;background:var(--glow);color:var(--deep);display:grid;place-items:center;font:900 26px var(--serif)}
.b2a-ptop b{font-size:28px}
.b2a-ptop .pc{margin-left:auto;font-size:24px;color:var(--mint)}
.b2a-pbody{flex:1;min-height:0;display:flex;flex-direction:column;gap:18px;padding:26px 30px 20px}
.b2a-pcard{display:flex;flex-direction:column;gap:6px;padding:20px 24px;border-radius:24px;background:var(--card);border:1.5px solid var(--edge)}
.b2a-pcard b{font-size:29px;line-height:1.35}
.b2a-pcard small{font-size:24px;line-height:1.45;color:var(--ink-3)}
.b2a-pcard.ok{background:var(--teal-wash);border-color:transparent}
.b2a-pcard.ok b{color:var(--teal-ink)}
.b2a-pcard.warn{background:var(--clay-wash);border-color:transparent}
.b2a-pcard.warn b{color:var(--clay-ink);font-size:26px;line-height:1.5}
.b2a-plab{font-size:24px;font-weight:700;color:var(--ink-2);margin-bottom:-8px}
.b2a-pinput{flex:none;min-height:380px;padding:20px 24px;border-radius:24px;background:var(--card);border:2px solid rgba(31,158,134,.55);font-size:27px;line-height:1.6;color:var(--ink);overflow:hidden}
.b2a-prows{flex:1;min-height:0;display:flex;flex-direction:column;justify-content:flex-start;gap:12px}
.b2a-pinput.ro{border-color:var(--edge);color:var(--ink-2)}
.b2a-pinput ol{margin:0;padding-left:34px}
.b2a-pcount{font-size:22px;color:var(--ink-3);text-align:right;margin-top:-8px}
.b2a-pbtn{height:96px;border-radius:26px;background:var(--deep);color:var(--cream);font-size:29px;font-weight:700;flex:none;width:100%}
.b2a-pbtn[disabled]{opacity:.42}
.b2a-prow{display:flex;flex-direction:column;gap:4px;padding:14px 20px;border-radius:22px;background:var(--card);border:1px solid var(--edge)}
.b2a-prow b{font-size:25px;line-height:1.3}
.b2a-prow span{font-size:23px;line-height:1.45;color:var(--ink-2)}
.b2a-kbdnote{display:inline-flex;align-items:center;gap:10px;height:72px;padding:0 20px;border-radius:20px;background:var(--well);font:700 24px/1 var(--sans);color:var(--ink-2)}
.b2a-fit{position:relative;overflow:hidden}
.b2a-fit>svg.illus,.b2a-fit>.seal{position:absolute;left:0;right:0;top:0;bottom:0;margin:auto}
.b2a-fit>svg.illus{height:82%;width:auto;max-width:84%}
.b2a-pair .fp-artbox{flex:none;height:300px}
.b2a-pair .fp-ol li{font-size:24px}
.b2a-opts.b2a-grow{flex:1;min-height:0}
.b2a-opts.b2a-grow>.slab.row{flex:1 1 0;min-height:0}
.b2a-opts.b2a-grow>.slab.row .vis{min-height:0;height:100%;max-height:240px}
.b2a-hart.b2a-fit>svg.illus{height:78%}
.b2a-vgrid{flex:1;min-height:0;display:grid;grid-template-columns:1fr 1fr;gap:14px}
.b2a-vcard{min-height:0;display:flex;flex-direction:column;border-radius:28px;background:var(--card);border:1.5px solid var(--edge);overflow:hidden;text-align:left;width:100%;padding:0;transition:transform var(--t-press)}
button.b2a-vcard:active{transform:scale(.985)}
.b2a-vcard.dark{background:linear-gradient(150deg,#174b3e,#0b2a22 70%);color:var(--cream);border-color:transparent}
.b2a-vcard.b2a-target{border:2.5px dashed rgba(31,158,134,.45);background:var(--card)}
.b2a-vcard>.art{flex:1;min-height:0;background:var(--well);display:grid;place-items:center}
.b2a-vcard.dark>.art{background:rgba(255,255,255,.07)}
.b2a-vcard>.tx{flex:none;display:flex;align-items:center;gap:16px;padding:20px 22px 22px 24px}
.b2a-vcard>.tx>div{flex:1;min-width:0}
.b2a-vcard>.tx b{display:block;font:700 34px/1.25 var(--serif)}
.b2a-vcard>.tx small{display:block;margin-top:6px;font-size:22px;line-height:1.4;color:var(--ink-2)}
.b2a-vcard.dark>.tx small{color:var(--mint)}
.b2a-vcard .go{width:64px;height:64px;border-radius:50%;background:var(--deep);color:var(--cream);display:grid;place-items:center;flex:none}
.b2a-vcard.dark .go{background:var(--glow);color:var(--deep)}
.b2a-mock{width:300px;border-radius:40px;background:#13231e;padding:12px;box-shadow:0 14px 30px rgba(11,36,30,.18)}
.b2a-mtop{display:flex;align-items:center;gap:10px;height:64px;padding:0 16px;border-radius:30px 30px 0 0;background:var(--deep);color:var(--cream)}
.b2a-mtop .pm{width:34px;height:34px;border-radius:10px;background:var(--glow);color:var(--deep);display:grid;place-items:center;font:900 20px var(--serif)}
.b2a-mtop b{font-size:22px}
.b2a-mbody{display:flex;flex-direction:column;gap:12px;padding:18px 16px 20px;border-radius:0 0 30px 30px;background:var(--paper)}
.b2a-mbody .b2a-mt{font-size:22px;line-height:1.3}
.b2a-mbody .b2a-ml{font-size:20px;color:var(--ink-3);font-weight:700}
.b2a-mbox{display:flex;flex-direction:column;gap:10px;padding:16px 14px;border-radius:16px;background:var(--card);border:2px solid rgba(31,158,134,.5)}
.b2a-mbox i{display:block;height:12px;border-radius:6px;background:#d9ded9}
.b2a-mbox i.s{width:58%}
.b2a-mbtn{display:grid;place-items:center;height:64px;border-radius:18px;background:var(--deep);color:var(--cream);font-size:22px;font-weight:700}
.b2a-pinput p{margin:0}
.b2a-qas{flex:1;min-height:0}
.b2a-qas>.b2a-qa{flex:1 1 auto;align-content:center}
.d3-home.b2a-home-up:not(.fm-x).body{gap:10px;padding-top:14px}
.d3-home.b2a-home-up:not(.fm-x) .grid2.tasks{gap:18px}
.d3-home.b2a-home-up.fm-x .tiles3 .tile{gap:8px}
.d3-home.b2a-home-up.fm-x .tiles3 .tile .ic{width:60px;height:60px;border-radius:18px}
.b2a-kprev{flex:1;min-height:0;display:grid;grid-template-columns:400px minmax(0,1fr);gap:28px;align-items:center;padding:16px 28px 16px 16px;border-radius:26px;background:var(--card);border:1.5px solid var(--edge)}
.b2a-kprev>.b2a-fit{align-self:stretch;border-radius:20px;background:var(--well)}
.b2a-kprev .tx{display:flex;flex-direction:column;gap:10px;min-width:0}
.b2a-kprev .tx small{font-size:22px;color:var(--teal-ink);font-weight:700}
.b2a-kprev .tx b{font:700 48px/1.25 var(--serif);color:var(--ink)}
.b2a-kprev .tx span{font-size:24px;line-height:1.55;color:var(--ink-2)}
`;
  document.head.appendChild(css);

  /* ── 来路 ── */
  const CTX = {
    resume: { name: '改简历', eyebrow: '改简历 · 开始前', extra: { go: 'scratch', t: '手动填写并导出', d: '自己填、原样排版，不经过 AI', set: 'frSkip=true', free: 1, art: () => UI.resume(110, 'blank') } },
    interview: { name: '练面试', eyebrow: '练面试 · 开始前', extra: { go: 'iv-tips', t: '看面试技巧', d: '公开的准备方法', art: () => UI.report(110) } },
    xq: { name: '问小青', eyebrow: '问小青 · 开始前', extra: { go: 'help', t: '看帮助', d: '常见问题、服务电话', art: () => UI.checklist(110) } }
  };
  const INTERCEPT = { 'resume-src': 'resume', scratch: 'resume', 'iv-1': 'interview', xq: 'xq' };
  const ctxOf = () => { const k = S().b2ctx; return CTX[k] ? k : ''; };
  /* 「回到刚才那个页面」：记最近一次去的办理页（登录、到期、换人这些过场页不算） */
  const NOT_BACK = new Set(['login', 'session-expired', 'handover', 'cleared', 'phone-login', 'phone-fill-m', 'legal', 'help-qa', 'standby']);

  /* 原型的点击拦截（捕获阶段，先于 app.js 的跳转）：游客、S().gate 为真时，点去 resume-src、scratch、iv-1、xq 的入口，
     改成带上来路先去 login；登录成功回到这个入口（fpFrom）。已登录、gate 为假、带 data-b2a-free 的不拦。 */
  document.addEventListener('click', (e) => {
    const s = window.S;
    if (!s || !e.target || !e.target.closest) return;
    const t = e.target.closest('[data-go]');
    if (!t || !t.closest('#stage')) return;
    let goId = '';
    try {
      keys();
      goId = t.dataset.go;
      const scr = t.closest('.screen');
      const from = scr ? scr.dataset.id : '';
      if (goId && !NOT_BACK.has(goId)) s.b2last = goId;
      if (goId === 'login') {
        /* 自己点进登录页：不带来路；上一次拦截留下的回跳也作废 */
        if (s.b2dest && s.fpFrom === s.b2dest) s.fpFrom = '';
        delete s.b2ctx; delete s.b2dest;
        return;
      }
      const ctx = INTERCEPT[goId];
      if (!ctx || s.logged || s.gate === false || t.hasAttribute('data-b2a-free')) return;
      if (t.dataset.set) t.dataset.set.split(';').forEach((kv) => { const [k, v] = kv.split('='); if (k) s[k.trim()] = v === 'true' ? true : v === 'false' ? false : v; });
      if (goId === 'resume-src') { s.ctx = 'resume'; if (from === 'resume') s.intent = t.dataset.arg === 'optimize' ? 'optimize' : 'diagnose'; }
      s.b2ctx = ctx; s.b2dest = goId; s.fpFrom = goId; s.fpLogin = ''; s.fpMsg = ''; s.fpAnon = false; s.b2v = '';
    } catch (err) { return; }
    e.preventDefault();
    e.stopPropagation();
    window.go('login');
  }, true);

  /* ═════════ login（改） ═════════ */
  const login = def('login');
  const loginR = login.render;
  const loginM = login.mount;
  const loginNotes = login.notes || {};
  const loginDemo = Array.isArray(login.demo) ? login.demo : [];
  const loginMode = () => S().fpLogin || 'phone';
  /* 下面几段是 fix-public.js login() 的原样片段，用来做带断言的替换 */
  const ASKQ_LOGIN = askBtn('问小青：不登录能办什么');
  const ASK_HELPQA = `<button class="askq b2a-askhelp" data-go="help-qa"><span class="mic">${icon('help', 30, 2.2)}</span><span>不登录能办什么</span></button>`;
  const ANON = (mini) => `<button class="fp-hit" data-fp="anon"><span><b>不登录也能办</b><small>${mini ? '打印与扫描、到机码、政策' : '打印与扫描、政策'}</small></span></button>`;
  const ANON_PICKUP = '<button class="fp-hit" data-go="pickup"><span><b>到机码</b></span></button>';
  const SMS_PICKUP = '<button class="fp-hit" data-go="pickup"><span><b>到机码</b><small>手机上已经下过的单</small></span></button>';
  const FACT_ORDER = '<p class="fp-note">登录后才能对上你名下的订单。到机码不登录也能取手机上已经下过的单。</p>';
  const ANON_SINK = '<p class="fp-note">打印、到机码和政策不需要登录。</p>';
  const BODY_START = '<main class="body fp-fill"><div class="fp-grow">';
  const phoneTxt = () => (S().fpPhoneOn ? '11 位已填' : '点这里填 11 位手机号');
  const PHONE_BTN = () => `<button class="fp-hit" data-act="type"><span class="fp-ic">${ic('phone', 30)}</span><span><b>${phoneTxt()}</b><small>用屏上键盘填写，不预填号码</small></span></button>`;
  const AGREE_BTN = (agree) => `<button class="fp-hit" data-fp="agree" aria-pressed="${agree ? 'true' : 'false'}"><span><b>${agree ? '已勾选协议' : '请先勾选协议'}</b><small>我已阅读并同意用户服务协议和隐私政策</small></span></button>`;
  const GET_BTN = (agree) => `<button class="fp-hit" data-fp="get" ${agree ? '' : 'disabled'}><span><b>${agree ? '获取验证码' : '勾选协议后才能获取'}</b></span></button>`;
  const SCAN_BTN = '<button class="fp-hit" data-fp="mode" data-k="scan"><span><b>改用扫码登录</b></span></button>';
  const hold = (inner) => `<div class="fp-hit b2a-hold" role="group" aria-disabled="true">${inner}<span class="chip slate">正在确认</span></div>`;

  function retStrip(ctx) {
    return `<div class="b2a-ret"><span class="b2a-ric">${ic('refresh', 30)}</span><span><b>登录后回到：${CTX[ctx].name}</b><small>你点的入口会接着打开</small></span></div>`;
  }
  function anonRow(ctx) {
    const c = CTX[ctx], x = c.extra, mini = !!S().mini;
    const items = [`<button class="fp-hit" data-go="print"><span><b>打印与扫描</b><small>不用登录</small></span></button>`];
    if (mini) items.push('<button class="fp-hit" data-go="pickup"><span><b>到机码</b><small>手机上已经下过的单</small></span></button>');
    items.push('<button class="fp-hit" data-go="policy"><span><b>政策</b><small>不用登录也能查</small></span></button>');
    items.push(`<button class="fp-hit" data-go="${x.go}"${x.set ? ` data-set="${x.set}"` : ''}${x.free ? ' data-b2a-free="1"' : ''}><span><b>${x.t}</b><small>${x.d}</small></span></button>`);
    return `<div class="b2a-anon"><p class="fp-k">不登录也能办</p><div class="b2a-anon-row n${items.length}">${items.join('')}</div></div>`;
  }
  /* 小程序没发布：登录页里提到「到机码」的地方收起 */
  function dropPickup(h, ctx, mode) {
    const s = S();
    if (mode === 'phone' && !ctx) {
      h = once(h, ANON(true), ANON(false), 'login 不登录也能办');
      if (s.fpAnon) { h = once(h, ANON_PICKUP, '', 'login 展开里的到机码'); h = once(h, ANON_SINK, '<p class="fp-note">打印和政策不需要登录。</p>', 'login 展开后的说明'); }
    }
    if (mode === 'sms') h = once(h, SMS_PICKUP, '', 'login 短信不可用里的到机码');
    const facts = (mode === 'phone' && !s.fpAnon) || mode === 'code' || mode === 'verify' || mode === 'sending';
    if (facts) h = once(h, FACT_ORDER, '<p class="fp-note">登录后才能对上你名下的订单。</p>', 'login 打印订单');
    return h;
  }
  /* 有来路、b2v=loading：正在确认这台机器的登录要求（照 st-loading：要等结论的先停，不依赖结论的照常） */
  function loadingize(h, ctx) {
    const agree = !!S().fpAgree;
    h = once(h, '<h1>先登录，再开始</h1>', '<h1>正在确认这台机器的登录要求</h1>', 'login loading 问题');
    h = once(h, '<p>AI 功能按规定要先用手机号登录。打印、扫描、查政策不用登录。</p>', '<p>确认之前，登录先不开始；打印、扫描、查政策照常可用。</p>', 'login loading 一句话');
    h = once(h, UI.status({ text: '等待填写手机号' }), UI.status({ text: '正在读取登录要求' }), 'login loading 状态');
    h = once(h, '<main class="body fp-fill">', '<main class="body fp-fill st3-load">', 'login loading 主体');
    h = once(h, PHONE_BTN(), hold(`<span class="fp-ic">${ic('phone', 30)}</span><span><b>${phoneTxt()}</b><small>用屏上键盘填写，不预填号码</small></span>`), 'login loading 手机号');
    h = once(h, AGREE_BTN(agree), hold(`<span><b>${agree ? '已勾选协议' : '请先勾选协议'}</b><small>我已阅读并同意用户服务协议和隐私政策</small></span>`), 'login loading 协议');
    h = once(h, GET_BTN(agree), hold('<span><b>获取验证码</b></span>'), 'login loading 获取验证码');
    h = once(h, SCAN_BTN, hold('<span><b>改用扫码登录</b></span>'), 'login loading 扫码');
    return h;
  }
  /* b2v=sms-down：短信当天发不出。新画法：两种登录变灰各写原因，「不登录也能办」放大成主体，加服务电话 */
  function loginSmsDown(ctx) {
    const s = S(), c = ctx ? CTX[ctx] : null, mini = !!s.mini;
    const bandHtml = band({
      kind: 'compact', sealHtml: '', back: true,
      eyebrow: c ? c.eyebrow : '登录',
      title: mini ? '短信验证码今天发不出去' : '今天暂时登录不了',
      sub: mini ? '小程序里已登录的，可以用微信扫码确认。打印、扫描、查政策照常。' : 'AI 功能要登录后才能用。打印、扫描、查政策照常。',
      status: { text: '短信暂时发不出', warn: 1 }
    });
    const opt = (ico, t, why, attrs) => attrs
      ? `<button class="b2a-lopt" ${attrs}><span class="b2a-lic">${ic(ico, 32)}</span><span><b>${t}</b><small>${why}</small></span></button>`
      : `<div class="b2a-lopt b2a-off" role="group" aria-disabled="true"><span class="b2a-lic">${ic(ico, 32)}</span><span><b>${t}</b><small>${why}</small></span></div>`;
    const ex = [
      { go: 'print', t: '打印与扫描', d: '手机、U 盘传文件，或扫描原件', vis: UI.stack(120, 3) },
      { go: 'policy', t: '查政策', d: '条件、材料和去哪办', vis: UI.checklist(108) }
    ];
    if (c) ex.push({ go: c.extra.go, t: c.extra.t, d: c.extra.d, vis: c.extra.art(), set: c.extra.set, free: c.extra.free });
    ex.push({ go: 'home', t: '回首页', d: '从首页换一件事办', vis: UI.phone(84) });
    const exits = ex.map((o, i) => {
      let h = slab({ i: 3 + i, row: 1, go: o.go, title: o.t, desc: o.d, vis: o.vis });
      if (o.set) h = withAttr(h, `data-go="${o.go}"`, `data-set="${o.set}"`);
      if (o.free) h = withAttr(h, `data-go="${o.go}"`, 'data-b2a-free="1"');
      return h;
    }).join('');
    const body = `<main class="body fp-fill"><div class="fp-grow">
      <div class="b2a-err">${icon('alert', 34, 2)}<span>${mini ? '短信验证码今天发不出去，用手机号登录暂时不行。' : '短信验证码今天发不出去，暂时登录不了。'}</span></div>
      <div class="b2a-lopts">${opt('phone', '用手机号登录', '短信暂时发不出')}${mini ? opt('qr', '用手机扫码登录', '微信扫码进小程序，已登录的直接确认', 'data-b2="scan"') : opt('qr', '用手机扫码登录', '扫码登录同样要收短信')}</div>
      <p class="fp-k">不登录也能办</p>
      <div class="b2a-exits">${exits}</div>
      ${remind(PHONE)}</div></main>`;
    const dockHtml = `<footer class="dock">${backBtn('返回')}${s.gate !== false ? ASK_HELPQA : ASKQ_LOGIN}</footer>`;
    return bandHtml + body + dockHtml + nav('home');
  }
  login.render = () => {
    const s = keys();
    const ctx = ctxOf();
    const mode = loginMode();
    if (s.b2v === 'sms-down') return loginSmsDown(ctx);
    if (ctx && mode === 'phone' && s.fpAnon) s.fpAnon = false; /* 有来路时「不登录也能办」直接列出，不再有展开开关 */
    let h = loginR();
    if (ctx && mode === 'phone') h = once(h, ANON(true), anonRow(ctx), 'login 来路版不登录也能办');
    if (!s.mini) h = dropPickup(h, ctx, mode);
    if (ctx) {
      h = once(h, '<div class="eyebrow">登录</div>', `<div class="eyebrow">${CTX[ctx].eyebrow}</div>`, 'login 小标');
      if (mode === 'phone') {
        h = once(h, '<h1>用手机号登录</h1>', '<h1>先登录，再开始</h1>', 'login 问题');
        h = once(h, '<p>勾选协议后可获取验证码并登录。</p>', '<p>AI 功能按规定要先用手机号登录。打印、扫描、查政策不用登录。</p>', 'login 一句话');
      }
      h = once(h, BODY_START, BODY_START + retStrip(ctx), 'login 来路条');
      if (s.b2v === 'loading' && mode === 'phone') h = loadingize(h, ctx);
    }
    if (s.gate !== false) h = once(h, ASKQ_LOGIN, ASK_HELPQA, 'login 底部中间');
    return h;
  };
  login.mount = (el) => {
    const onDemo = (e) => {
      const ev = e.detail;
      if (ev === 'code-ok' || ev === 'scan-ok') { delete S().b2ctx; delete S().b2dest; S().b2v = ''; }
      else if (ev === 'b2a-sms') { S().b2v = 'sms-down'; window.__proto.refresh(); }
      else if (ev === 'b2a-loading') { S().b2v = 'loading'; window.__proto.refresh(); }
      else if (ev === 'b2a-ready') { S().b2v = ''; window.__proto.refresh(); }
    };
    const onClick = (e) => {
      const b = e.target.closest('[data-b2]');
      if (!b || !el.contains(b)) return;
      e.stopPropagation();
      if (b.dataset.b2 === 'scan') { S().b2v = ''; S().fpLogin = 'scan'; S().fpMsg = ''; window.__proto.refresh(); }
    };
    el.addEventListener('proto-demo', onDemo);
    el.addEventListener('click', onClick);
    const off = loginM ? loginM(el) : null;
    return () => { el.removeEventListener('proto-demo', onDemo); el.removeEventListener('click', onClick); if (off) off(); };
  };
  login.demo = loginDemo.concat([
    { label: '演示：有来路时正在确认登录要求', ev: 'b2a-loading' },
    { label: '演示：登录要求读到了', ev: 'b2a-ready' },
    { label: '演示：短信今天发不出（第二批）', ev: 'b2a-sms' }
  ]);
  login.name = login.name + '（第二批补稿）';
  login.notes = {
    does: '第二批补稿：（1）游客点改简历、练面试、问小青这些要用 AI 的入口，直接到这一屏并带来路 S().b2ctx（resume / interview / xq）：小标换成「改简历 · 开始前」「练面试 · 开始前」「问小青 · 开始前」，问题「先登录，再开始」，一句话「AI 功能按规定要先用手机号登录。打印、扫描、查政策不用登录。」；意图带下方加来路条「登录后回到：改简历 · 你点的入口会接着打开」；「不登录也能办」直接列出，按来路多一项（resume 手动填写并导出 → scratch、interview 看面试技巧 → iv-tips、xq 看帮助 → help）。为什么改：现在的程序做到 AI 那一步才弹层拦人（K/ai/AiLoginRequiredHost.tsx：标题「这项 AI 功能要先登录」），登录回来文件、填的表、扫的件全没了（K/auth/AuthContext.tsx:55-65）。（2）小程序没发布（S().mini 为假，线上 miniappPublished: false）时，「不登录也能办」改成「打印与扫描、政策」，「打印订单」里去掉「到机码不登录也能取手机上已经下过的单。」（展开列表、旧的短信不可用态里的到机码也一起收起）；mini 为真照原稿。（3）底部中间改成「不登录能办什么」去 help-qa，不经过小青（问小青本身要登录）。（4）新状态 b2v=sms-down：短信当天发不出，两种登录变灰各写原因，「不登录也能办」放大成主体，加服务电话；有来路时 b2v=loading：「正在确认这台机器的登录要求」，照 st-loading，登录几项先停、不登录的照常。没有来路时只改（2）（3）和 sms-down。 原说明：' + (loginNotes.does || ''),
    motion: (loginNotes.motion || '') + ' 第二批补稿：来路条与不登录出路随页面一起出现，不另加动画；正在确认时状态点不转圈，也不演成读完。',
    keep: (loginNotes.keep || '') + ' 第二批补稿：登录档位读终端配置里已下发的那一项（A/terminals/terminals-admin.service.ts:735 的 ai.loginGate），读不到时退回现在的做法（到 AI 那一步弹层），但由流程发起的登录要保留草稿和文件；登录成功回到进来前点的那个入口（本稿拦截时把入口记进 fpFrom）；不登录的出路（打印与扫描、政策、按来路的那一项）都不经过 AI，「手动填写并导出」去 scratch 并带 frSkip，不被拦。S().gate 为假（地址 gate=0）时不拦、不出现来路版，底部中间照原稿。小程序没发布时手机扫码登录走手机网页，照样要收短信验证码（K/pages/auth/MobileQrLoginPage.tsx:154）；发布后微信扫码打开小程序的，已登录直接确认，打开网页的用短信验证（K/copy/miniappLinkCopy.ts:33），所以 mini 为真时 sms-down 里扫码一项不变灰。短信当天发不出时，小程序没发布的机器两种登录都用不了。原型里：游客、gate 为真时，点去 resume-src、scratch、iv-1、xq 的入口在捕获阶段改成带来路去这一屏；已登录或 gate 为假不拦；自己点「登录」进来的不带来路。' + PHONE_NOTE
  };

  /* ═════════ home（改）：小程序没发布时「到机取件」换成「手机传文件」 ═════════ */
  const home = def('home');
  const homeR = home.render;
  const homeNotes = home.notes || {};
  const TILE_PICKUP = tile({ i: 5, go: 'pickup', icon: 'ticket', title: '到机取件', desc: '手机上下了单，来这里取' });
  const TILE_UPLOAD = tile({ i: 5, go: 'upload', arg: 'print', icon: 'phone', title: '手机传文件', desc: '扫码选文件，传到这台机器来打印' });
  home.render = () => {
    keys();
    const h = homeR();
    if (S().mini) return h;
    /* 新磁贴的副句是两行：只在这张磁贴出现时把主体各块的间距收 6px，页脚备案号不被挤出，大卡尺寸不动 */
    return once(once(h, TILE_PICKUP, TILE_UPLOAD, 'home 到机取件'), '<main class="body d3-home', '<main class="body d3-home b2a-home-up', 'home 主体');
  };
  home.name = home.name + '（第二批补稿）';
  home.notes = {
    does: '第二批补稿：只动小磁贴「到机取件」这一张。小程序没发布（S().mini 为假，线上现状）时换成「手机传文件 · 扫码选文件，传到这台机器来打印」，去 upload（打印来路）；mini 为真（地址 mini=1）照原稿「到机取件 · 手机上下了单，来这里取」去 pickup。其余逐字不变。为什么改：到机码是给小程序下单的人用的，小程序没发布时点进去没法用。 原说明：' + (homeNotes.does || ''),
    motion: homeNotes.motion || '无。',
    keep: (homeNotes.keep || '') + ' 第二批补稿：显示哪一张读 support.miniappPublished（K/copy/unattendedCopy.ts，线上 false）；「手机传文件」去打印的手机扫码上传（/print/upload），不新增路由。'
  };

  /* ═════════ pickup（改）：本机没有扫码器时收起扫码枪说明 ═════════ */
  const pickup = def('pickup');
  const pickupR = pickup.render;
  const pickupNotes = pickup.notes || {};
  const HID_BTN = '<button class="d3-mini" data-d3="hid" aria-pressed="false">用扫码枪扫</button>';
  pickup.render = () => {
    const s = keys();
    if (s.scanner !== false) return pickupR();
    if (s.hid) s.hid = false; /* 没有扫码器，就没有「用扫码枪扫」那一态 */
    return once(pickupR(), HID_BTN, `<span class="b2a-kbdnote">${ic('keyboard', 30)}请用屏上键盘输入到机码</span>`, 'pickup 扫码枪');
  };
  pickup.name = pickup.name + '（第二批补稿）';
  pickup.notes = {
    does: '第二批补稿：S().scanner 为假（地址 scanner=0，本机没有扫码器）时，收起「用扫码枪扫」和它展开的「对准机身侧面的扫码区」说明，换成一句「请用屏上键盘输入到机码」；为真时照原稿。 原说明：' + (pickupNotes.does || ''),
    motion: pickupNotes.motion || '无。',
    keep: (pickupNotes.keep || '') + ' 第二批补稿：扫码说明跟终端能力走（K/pages/print/components/PickupHidGuide.tsx:107）；这一屏在小程序发布前从首页进不来（首页那张换成「手机传文件」）。'
  };

  /* ═════════ help（改）：一句话、七个分类 ═════════ */
  const help = def('help');
  const helpR = help.render;
  const helpNotes = help.notes || {};
  const OLD_TOPICS = ['account', 'resume', 'print', 'policy', 'channels', 'records', 'privacy', 'down', 'miss'];
  const CATS = [
    { k: 'qa', ic: 'user', t: '登录与账号', d: '哪些要登录、为什么又让我登录、为什么问「还是你吗」' },
    { k: 'resume', ic: 'file', t: '改简历', d: '能做什么、AI 改的内容怎么核对' },
    { k: 'b2iv', ic: 'mic', t: '练面试', d: '怎么开始、时间到了会怎样、报告在哪看' },
    { k: 'print', ic: 'printer', t: '打印 · 扫描 · 复印', d: '文件怎么传、扫描件怎么带走' },
    { k: 'b2pol', ic: 'landmark', t: '查政策与官方渠道', d: '政策谁发布、能不能代申请' },
    { k: 'records', ic: 'folder', t: '我的记录', d: '文档、订单、AI 记录在哪看' },
    { k: 'more', ic: 'shield', t: '隐私、设备与备案', d: '留多久、怎么删、设备状态、备案号' }
  ];
  function helpCats() {
    return `<div class="fp-list fp-cats">${CATS.map((c) => {
      const at = c.k === 'qa' ? 'data-go="help-qa"' : c.k === 'more' ? 'data-fp="more"' : `data-fp="topic" data-k="${c.k}"`;
      return `<button class="fp-hit" ${at}><span class="fp-ic">${ic(c.ic, 28)}</span><span><b>${c.t}</b><small>${c.d}</small></span></button>`;
    }).join('')}</div>`;
  }
  const TOPICS = {
    b2iv: {
      t: '练面试', d: '怎么开始、时间到了会怎样、报告在哪看',
      qs: () => [
        ['怎么开始？', '在首页点「练面试」，再点「马上练一场」：先记下岗位、面试官和时长，再逐题作答。' + (S().gate !== false ? '要先用手机号登录。' : '')],
        ['时间到了会怎样？', '时间到就结束这一场，不能再补答。到点前提交的回答会生成练习报告；到点时还没提交的文字、没录完的语音，不算进这一场。'],
        ['报告在哪看？', '报告只给你本人看，可以打印。登录后在练面试的「训练报告」里看，也记在「我的 · AI 服务记录」里。']
      ],
      links: [['interview', '去练面试'], ['iv-tips', '看面试技巧']]
    },
    b2pol: {
      t: '查政策与官方渠道', d: '政策谁发布、能不能代申请',
      qs: () => [
        ['政策谁发布？', '政策由发布机构在机构后台自己审核、发布，并对内容负责。每条都写明发布机构，以官方原文为准。'],
        ['能不能代申请？', '不能。这里只提供说明、材料清单、官方入口和打印，不代申请，不承诺发放或审核，也不保存身份证、银行卡、社保材料。结果以官方平台为准。'],
        ['官方渠道的内容谁负责？', '码由运营这台机器的机构自己维护，以机构官网或公众号为准。']
      ],
      links: [['policy', '查政策'], ['official', '本机构官方渠道']]
    }
  };
  function helpTopic(k) {
    const tp = TOPICS[k];
    const qs = tp.qs();
    const bandHtml = band({ kind: 'compact', sealHtml: '', back: true, eyebrow: '帮助', title: tp.t, sub: `${tp.d}。下面 ${qs.length} 条是这一类里常被问到的。`, status: { text: `当前分类 · ${tp.t}` } });
    const body = `<main class="body fp-fill"><div class="fp-grow"><div class="fp-list">${qs.map((q) => `<div class="fp-card"><p class="fp-k">问</p><p class="fp-note"><b>${q[0]}</b></p><p class="fp-note">${q[1]}</p></div>`).join('')}</div><p class="fp-k">直接去办</p><div class="fp-row">${tp.links.map((l) => `<button class="fp-hit" data-go="${l[0]}"><span><b>${l[1]}</b><small>打开</small></span></button>`).join('')}</div><div class="fp-card fp-sink"><p class="fp-note">这里没答上，可以换一个分类，或问小青。</p><div class="fp-artbox">${k === 'b2iv' ? UI.report(160) : UI.checklist(160)}</div></div></div></main>`;
    const dockHtml = `<footer class="dock"><button class="btn sec" data-fp="cats">${ic('chevL', 28)}返回分类</button><button class="askq" data-go="xq"><span class="mic">${ic('mic', 28)}</span><span>问小青：这里没看懂</span></button><button class="btn sec" data-go="home">返回首页</button></footer>`;
    return bandHtml + body + dockHtml + nav('home');
  }
  help.render = () => {
    const s = keys();
    const v = s.fpHelp || '';
    if (TOPICS[v]) return helpTopic(v);
    let h = helpR();
    if (OLD_TOPICS.indexOf(v) >= 0) return h;
    if (s.gate !== false) h = once(h, '<p>先点一个分类，不用打字。</p>', '<p>打印、扫描、查政策不用登录；改简历、练面试、问小青要先登录。</p>', 'help 一句话');
    return span(h, '<div class="fp-list fp-cats">', '<div class="fp-well">', helpCats(), 'help 分类');
  };
  help.name = help.name + '（第二批补稿）';
  help.notes = {
    does: '第二批补稿：意图带一句话改成「打印、扫描、查政策不用登录；改简历、练面试、问小青要先登录。」；七个分类按要办的事排，每行一个标题加一句副句，不写「几问」：登录与账号去 help-qa；改简历、打印 · 扫描 · 复印、我的记录打开原来的分类问答；练面试、查政策与官方渠道是这次补的两页分类问答（在本屏切换，S().fpHelp = b2iv / b2pol）；隐私、设备与备案照原来拉起底部弹层。「卡住了，先自己试这三步」和服务电话那一块照原稿。底部中间「问小青：这里没看懂」保留（游客点它会先到登录页，带来路「问小青」）。 原说明：' + (helpNotes.does || ''),
    motion: helpNotes.motion || '无。',
    keep: (helpNotes.keep || '') + ' 第二批补稿：练面试三问照运行页：入口「马上练一场」（K/pages/interview/touch/InterviewHubTouch.tsx）；时间到自动结束、到点前提交的回答出报告、到点时没提交的不算（K/pages/interview/InterviewSetupPage.tsx:635、session/interviewTurnActions.ts:175、session/InterviewTimeUp.tsx:73）；报告在「训练报告」（/interview/reports）和「我的 · AI 服务记录」（K/pages/profile/me/MyAiRecordsPage.tsx:412）。查政策与官方渠道三问沿用原来「政策服务」「机构官方渠道」两类的原话。gate 为假时一句话照原稿。'
  };

  /* ═════════ 新屏 ═════════ */
  const add = (afterId, id, group, name, o) => placeAfter(afterId, Object.assign({ id, group, name }, o));

  /* session-expired：登录到期说明 */
  function sessionExpired() {
    const s = keys();
    const revoked = s.b2v === 'revoked';
    const ret = revoked ? 'me' : (s.b2last || 'me');
    const set = `fpFrom=${ret};fpLogin=;b2v=`;
    const card = (k, list, art) => `<div class="fp-card fp-sink"><p class="fp-k">${k}</p><ul class="fp-ol">${list.map((t) => `<li>${t}</li>`).join('')}</ul><div class="fp-artbox">${art}</div></div>`;
    const opt1 = withAttr(slab({ i: 2, row: 1, dark: 1, go: 'login', title: revoked ? '换个账号登录' : '重新登录', desc: revoked ? '用手机号登录；没提交的内容要重新填' : '回到刚才那个页面；没提交的内容要重新填', vis: UI.phone(100) }), 'data-go="login"', `data-set="${set}"`);
    const opt2 = slab({ i: 3, row: 1, go: 'home', title: '不登录，回首页', desc: '打印、扫描、查政策不用登录', vis: UI.stack(110, 3) });
    const bandHtml = band({ kind: 'compact', sealHtml: '', back: false, eyebrow: '登录状态', title: '这次登录到期了', sub: revoked ? '这个账号已在别处退出，或已被停用。' : '网络中断了一会儿，登录没能续上。', status: { text: '已退出登录', warn: 1 } });
    const body = `<main class="body b2a-fill">
      <div class="b2a-pair">${card('还在的', ['已经提交的打印任务照常出纸', '已生成的诊断和面试报告在你的账号里', '导出过的文件在「我的文档」'], UI.checklist(150))}${card('这台机器上清掉的', ['没提交的填写内容', '这次上传还没用上的文件', '和小青的对话'], UI.stack(150, 3))}</div>
      <div class="b2a-opts b2a-grow">${opt1}${opt2}</div>
      ${revoked ? remind(PHONE) : ''}</main>`;
    const dockHtml = `<footer class="dock">${priBtn('重新登录', `data-go="login" data-set="${set}"`, { wide: 1 })}</footer>`;
    return bandHtml + body + dockHtml + nav('home');
  }
  add('login', 'session-expired', '公共', '登录到期说明（第二批补稿）', {
    notes: {
      does: '会员登录到期、续不上时的说明。状态 b2v：默认 net（网络中断了一会儿，登录没能续上）、revoked（这个账号已在别处退出，或已被停用）。为什么加：现在 30 分钟到点直接登出、清空在办内容、跳登录页、不说原因（A/member-auth/member-auth.module.ts:36 expiresIn 30m、K/auth/memberSessionExpiryExit.ts:97-115）；要改成还在用就自动续，真到期时说明原因。两栏照闲置提醒 cleared 的「本机会清除 / 不因此清除」版式：「还在的」「这台机器上清掉的」。',
      motion: '两栏和两个选项依次浮入。没有倒计时。',
      keep: '正常使用中登录自动续上，屏上不显示续的过程，不会走到这一屏；只有续不上才到期。到期时先清本机再跳转这个顺序不变（K/auth/memberSessionExpiryExit.ts「先清本机，再谈跳转」），所以清掉的三样照实写，「重新登录」的副句写「回到刚才那个页面；没提交的内容要重新填」，不写「回到刚才那一步」。不放返回（回不去），中间不放问小青，主按钮「重新登录」。revoked 第一项写「换个账号登录」并加服务电话。原型里「回到刚才那个页面」用 S().b2last（最近一次点进去的办理页），没有就去「我的」。' + PHONE_NOTE
    },
    render: sessionExpired
  });

  /* 小青青字圆章的插画版（与 .seal 同色，按卡片高度缩放） */
  function sealArt() {
    return '<svg class="illus" width="240" height="240" viewBox="0 0 240 240" aria-hidden="true"><defs><radialGradient id="b2SealG" cx="34%" cy="28%" r="80%"><stop offset="0" stop-color="#45e3b1"/><stop offset=".48" stop-color="#17a17f"/><stop offset="1" stop-color="#0b5e4b"/></radialGradient></defs><circle cx="120" cy="120" r="116" fill="rgba(46,230,168,.12)"/><circle cx="120" cy="120" r="100" fill="url(#b2SealG)"/><text x="120" y="120" dy=".36em" text-anchor="middle" font-size="108" font-weight="900" fill="#f8f5ec" font-family="Noto Serif SC, Songti SC, serif">青</text></svg>';
  }
  /* handover：还是你吗 */
  function handover() {
    const s = keys();
    const k = ['resume', 'interview', 'xq'].indexOf(s.b2ctx) >= 0 ? s.b2ctx : 'me';
    const H = {
      me: { d: '接着看简历、文档和订单。', go: 'me', art: UI.resume(220) },
      resume: { d: '接着改简历，结果记在这个账号下。', go: 'resume', art: UI.resume(220, 'annot') },
      interview: { d: '接着练面试，结果记在这个账号下。', go: 'interview', art: UI.report(220) },
      xq: { d: '接着问小青，对话记在这个账号下。', go: 'xq', art: sealArt() }
    }[k];
    const bandHtml = band({ kind: 'compact', sealHtml: '', back: false, eyebrow: '继续使用前', title: '还是你吗？', sub: '离开屏幕超过 30 秒后再进来，会先问这一句', status: { text: '待确认是不是你', warn: 1 } });
    const body = `<main class="body b2a-fill b2a-hand">
      <p class="b2a-lead">确认之前不会显示上一位的文件和订单。</p>
      <button class="b2a-hcard b2a-yes rise" style="--i:0" data-go="${H.go}"><span class="b2a-hart b2a-fit">${H.art}</span><span class="b2a-htx"><b>是我，继续</b><small>${H.d}</small></span><span class="b2a-go">${icon('arrowR', 30, 2.4)}</span></button>
      <button class="b2a-hcard rise" style="--i:1" data-act="clear"><span class="b2a-hart b2a-fit">${UI.phone(160)}</span><span class="b2a-htx"><b>不是我，结束上一位的使用</b><small>退出登录，并清掉这台机器上这一次的临时信息。</small></span><span class="b2a-go">${icon('arrowR', 30, 2.4)}</span></button>
      <div class="b2a-why rise" style="--i:2">${icon('clock', 36, 2)}<span>这是公用设备。屏幕超过 30 秒没人碰，再进改简历、练面试、问小青或「我的」，会先问这一句，防止下一位用到上一位的账号。</span></div></main>`;
    const dockHtml = k === 'me' ? `<footer class="dock">${askBtn('问小青：这一页是什么意思？')}</footer>` : '';
    return bandHtml + body + dockHtml;
  }
  add('session-expired', 'handover', '公共', '还是你吗（第二批补稿）', {
    notes: {
      does: '有人登录着、屏幕空了 30 秒以上再进来时先问「还是你吗？」。照运行页现有那一屏画（K/auth/KioskHandoverGate.tsx:54-86），原句不改；「是我，继续」的副句按来路 S().b2ctx：me（默认，原句）「接着看简历、文档和订单。」、resume「接着改简历，结果记在这个账号下。」、interview「接着练面试，结果记在这个账号下。」、xq「接着问小青，对话记在这个账号下。」。为什么改：现在只挡「我的」各页，改简历、练面试、问小青不挡，下一位会用着上一位的账号。',
      motion: '两张卡依次浮入，按下缩小。',
      keep: '这次只是把这一问从「我的」各页扩到改简历、练面试、问小青三个入口，判据仍是 30 秒（K/auth/kioskIdleTiming.ts:13 KIOSK_HANDOVER_CONFIRM_MS）。只在从首页或底部导航进入改简历、练面试、问小青这三个服务台时问；流程里面翻页不问（现在的闸门每换一次地址都重新判，扩到三个服务台时只包服务台入口，不包流程内各步）。先确认、后读取：确认前不挂载后面的页，不显示上一位的文件名、订单号、手机号，也不用上一位的账号开对话。没有返回、没有底部导航；底部中间 me 来路保留原来的「问小青：这一页是什么意思？」，其余三种来路不放问小青。「不是我」走结束使用（endKioskUse(\'handover\')：清掉上一位，回首页）。下面那句「为什么问」是补空的说明，原句来自帮助 help-qa 第 3 问。'
    },
    render: handover
  });

  /* help-qa：帮助 · 登录与账号 */
  function helpQa() {
    const s = keys();
    const gate = s.gate !== false;
    const QA = [
      ['哪些要登录？', gate ? '打印、扫描、复印、查政策不用登录。改简历、练面试、问小青要先用手机号登录：按规定，AI 功能要核实使用者。' : '大部分服务可以游客身份直接使用。登录后，这次的简历、文档、打印订单和收藏会记到你的账号，只有你能看。'],
      ['用着用着，为什么又让我登录？', '正常使用中登录会自动续上。只有网络中断没续上，或账号在别处退出，才会到期。到期时屏上会写明原因；重新登录后回到刚才那个页面，没提交的内容要重新填，已经提交的打印和已生成的报告不受影响。'],
      ['为什么问我「还是你吗」？', '这是公用设备。屏幕超过 30 秒没人碰，再进改简历、练面试、问小青或「我的」，会先问一句，防止下一位用到上一位的账号。'],
      ['用完怎么退出？', '在诊断报告、简历导出完成、练习报告、扫描完成这几屏点「结束使用」，或回首页点「结束上一位的使用」。不点也会自动退出：3 分钟没人操作就退出；打开本人文档、诊断报告或优化结果后是 1 分 30 秒。']
    ];
    const bandHtml = band({ kind: 'std', sealHtml: '', back: true, eyebrow: '帮助 · 登录与账号', title: '登录这几件事', sub: '四个常被问到的问题，不用打字。', status: { text: '常见问题' } });
    const body = `<main class="body b2a-fill">
      <div class="b2a-qas">${QA.map((q, i) => `<div class="b2a-qa rise" style="--i:${i}"><span class="b2a-qn">${i + 1}</span><div><b>${q[0]}</b><p>${q[1]}</p></div></div>`).join('')}</div>
      <p class="fp-k">直接去办</p>
      <div class="fp-row b2a-links"><button class="fp-hit" data-go="login"><span><b>去登录</b><small>手机号或扫码</small></span></button><button class="fp-hit" data-go="print"><span><b>打印 · 扫描</b><small>不用登录</small></span></button><button class="fp-hit" data-go="policy"><span><b>查政策</b><small>不用登录</small></span></button></div>
      ${remind(PHONE)}</main>`;
    const dockHtml = `<footer class="dock">${backBtn('返回')}${priBtn('回首页', 'data-go="home"', { wide: 1 })}</footer>`;
    return bandHtml + body + dockHtml + nav('home');
  }
  add('help', 'help-qa', '公共', '帮助：登录与账号（第二批补稿）', {
    notes: {
      does: '帮助第一个分类「登录与账号」的四条问答：哪些要登录、为什么又让我登录、为什么问「还是你吗」、用完怎么退出。问题 30px、回答 24px，卡片按内容定高；下面「直接去办」三条（去登录、打印 · 扫描、查政策）和服务电话标准句。登录页底部中间「不登录能办什么」也到这里（不经过小青）。',
      motion: '四条依次浮入。',
      keep: '时长照 K/auth/kioskIdleTiming.ts：普通页 180 秒（3 分钟）、打开本人文档 / 诊断报告 / 优化结果后 90 秒（1 分 30 秒）；「还是你吗」判据 30 秒（KIOSK_HANDOVER_CONFIRM_MS）。登录 30 分钟到期（A/member-auth/member-auth.module.ts:36），改程序后还在用就自动续，续不上才到期并说明原因（见 session-expired）。第 4 问的「结束使用」出口按总指挥 11/11 给的原句（诊断报告、简历导出完成、练习报告、扫描完成这几屏，或首页「结束上一位的使用」）。gate 为假时第 1 问换回原来「登录与账号」分类的原话。' + PHONE_NOTE
    },
    render: helpQa
  });

  /* kbd-short：输入样板（状态样式板） */
  const KB_ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
  function kbdShort() {
    const s = keys();
    const v = s.b2v === 'en' || s.b2v === 'long' ? s.b2v : '';
    const long = v === 'long', en = v === 'en';
    const stay = long && s.b2kbdStay === true;
    const caret = '<i class="b2a-caret" aria-hidden="true"></i>';
    let eyebrow = '从零生成 · 基本信息', title = '你的姓名', pill = '第 1 步 / 共 6 步', label = '姓名', tag = '<span class="chip clay">必填</span>';
    let value = `赵<u>lei</u>${caret}`, next = [['联系电话', '可以空着', ''], ['目标岗位', '下一步 · 必填', '']];
    let cand = '<span class="b2a-comp">lei</span>' + ['磊', '雷', '蕾', '累', '类', '泪', '垒'].map((c) => `<i>${c}</i>`).join('');
    const kprev = (art, k, big, line) => `<div class="b2a-kprev"><span class="b2a-fit">${art}</span><div class="tx"><small>${k}</small><b>${big}</b><span>${line}</span></div></div>`;
    let prev = kprev(UI.resume(220), '简历顶部会这样显示', '赵', '选好「磊」就是「赵磊」。公共屏上手机号、邮箱打码显示，导出的简历里是完整的。');
    if (en) {
      title = '你的邮箱'; label = '邮箱'; tag = '<span class="chip slate">可以空着</span>';
      value = `zhaolei.qd@163${caret}`; next = [['姓名', '赵磊', 'done'], ['目标岗位', '下一步 · 必填', '']];
      cand = '<span class="b2a-hint">英文与数字 · 字母直接上屏，点「中/英」换回拼音</span>';
      prev = kprev(UI.resume(220), '简历顶部会这样显示', '赵磊', '邮箱填好后显示在姓名下面。公共屏上打码显示，导出的简历里是完整的。');
    }
    if (long) {
      eyebrow = '从零生成 · 工作经历'; title = '这段经历做了什么'; pill = '第 4 步 / 共 6 步'; label = '工作经历描述'; tag = '<span class="chip slate">可以空着</span>';
      value = `2025 年 7 月到 9 月在青岛海禾文化做新媒体实习生，负责学院合作公众号的选题和排版，<u>meizhou</u>${caret}`;
      next = [['单位名称', '青岛海禾文化', 'done'], ['职位', '新媒体实习生', 'done']];
      cand = '<span class="b2a-comp">meizhou</span>' + ['每周', '美洲', '梅州'].map((c) => `<i>${c}</i>`).join('');
      prev = kprev(UI.resume(220, 'fixed'), '写好后放进简历', '工作经历', '这一段会排在「青岛海禾文化 · 新媒体实习生」下面，导出前还能再改。');
    }
    const fn = `<div class="b2a-kb-row"><button class="b2a-k fn${en ? ' on' : ''}" data-b2="lang" aria-label="中英切换">${en ? '英' : '中'} / ${en ? '中' : '英'}</button><span class="b2a-k fn">123</span>${en ? '<span class="b2a-k">@</span>' : ''}<span class="b2a-k space">空格</span>${en ? '<span class="b2a-k">.</span>' : ''}<span class="b2a-k fn">删除</span><button class="b2a-k ok" data-act="back">完成</button></div>`;
    const tip = long && !stay ? `<div class="b2a-kb-tip">${icon('phone', 34, 2)}<b>这一段比较长，用手机填更快</b><button class="btn pri" data-go="phone-fill" data-set="b2v=wait;b2ctx=resume">用手机填</button><button class="btn sec" data-b2="stay">继续在屏上打</button></div>` : '';
    const kb = `<div class="b2a-kb" role="group" aria-label="屏上键盘">${tip}<div class="b2a-kb-cand">${cand}</div>${KB_ROWS.map((r) => `<div class="b2a-kb-row">${[...r].map((c) => `<span class="b2a-k">${c}</span>`).join('')}</div>`).join('')}${fn}</div>`;
    const bandHtml = band({ kind: 'compact', sealHtml: '', back: true, eyebrow, title, status: { text: pill } });
    const body = `<main class="body b2a-kbody">
      <div class="b2a-field"><div class="b2a-fl">${label}${tag}</div><div class="b2a-fv${long ? ' b2a-long' : ''}">${value}</div></div>
      <div class="b2a-next">${next.map((n) => `<div class="b2a-nf"><small>${n[0]}</small><b class="${n[2] === 'done' ? 'b2a-done' : ''}">${n[1]}</b></div>`).join('')}</div>
      ${prev}</main>`;
    return bandHtml + body + kb;
  }
  add('st-ai-down', 'kbd-short', '状态样式板', '输入：短输入用屏上键盘（第二批补稿）', {
    notes: {
      does: '输入样板，场景是「从零生成 · 基本信息」里填姓名：上面是正在填的这一格（已打出「赵」，正在打拼音 lei），下面两格缩略让人知道后面还有什么，再下面是「简历顶部会这样显示」；下半屏是页面自带的键盘（候选栏一行、三行字母、功能行：中/英、123、空格、删除、完成）。状态 b2v：默认（中文拼音）、en（英文数字，场景换成邮箱，键盘换英文）、long（当前格换成「工作经历描述」，键盘上方出现「这一段比较长，用手机填更快」→ phone-fill，旁边「继续在屏上打」）。',
      motion: '光标每秒闪一次（低于每秒 1 次的上限）；键盘从下面升起 200 毫秒（运行页 kkbUp）；其余静止。',
      keep: '短输入（姓名、学校、岗位名、邮箱）用页面自带键盘，字库要换完整词库（现在约 527 个字，赵、李、陈都打不出，K/components/kiosk-keyboard/pinyinDict.ts；候选栏「磊 雷 蕾 累 类 泪 垒」是换完整词库以后的样子）；长输入给「用手机填」；这一项等竖屏真机验过系统触摸键盘之后再定是否全量替换。页面自带键盘现在只挂在问小青页（K/components/kiosk-keyboard/，用在 pages/assistant/AssistantPage.tsx），数字键盘在登录和到机码页（K/components/kiosk-numpad/）；其余输入框靠系统触摸键盘，竖屏真机没验过。按键不小于 72×72（样板 88×84），候选字不小于 28px（样板 34px）。样板里的字母键只示意、不响应；「中/英」在中文与英文两态之间切，「完成」收起回上一屏。示例里「两格缩略」用表单里真实的格名：联系电话、目标岗位（说明里写作手机号、求职岗位）。'
    },
    render: kbdShort,
    mount: (el) => {
      const on = (e) => {
        const b = e.target.closest('[data-b2]');
        if (!b || !el.contains(b)) return;
        e.stopPropagation();
        if (b.dataset.b2 === 'lang') S().b2v = S().b2v === 'en' ? '' : 'en';
        else if (b.dataset.b2 === 'stay') S().b2kbdStay = true;
        window.__proto.refresh();
      };
      el.addEventListener('click', on);
      return () => el.removeEventListener('click', on);
    }
  });

  /* phone-fill：长输入用手机填（一体机这一侧） */
  const PF = {
    resume: {
      eyebrow: '从零生成 · 工作经历', title: '用手机填这一段', label: '工作经历描述', mtitle: '填好发到一体机',
      sub: '手机上打字更快。填完点发送，内容会出现在这台机器上，由你确认后才用。',
      text: '<p>2025 年 7 月到 9 月在青岛海禾文化做新媒体实习生，负责学院合作公众号的选题和排版，每周推送 3 篇。独立做完「毕业季求职指南」专栏 6 期，并把排版做法整理成一页说明，留给后来的实习生用。</p>',
      plain: '2025 年 7 月到 9 月在青岛海禾文化做新媒体实习生，负责学院合作公众号的选题和排版，每周推送 3 篇。独立做完「毕业季求职指南」专栏 6 期，并把排版做法整理成一页说明，留给后来的实习生用。',
      use: 'data-act="back"', useTo: '填进「工作经历描述」，还能接着改', type: 'data-go="kbd-short" data-set="b2v=long;b2kbdStay=false"', ask: '问小青：这一段写什么？'
    },
    interview: {
      eyebrow: '练面试 · 这一题的回答', title: '用手机填这一段', label: '这一题的回答', mtitle: '填好发到一体机',
      sub: '手机上打字更快。填完点发送，内容会出现在这台机器上，由你确认后才用。',
      text: '<p>我在实习时负责过一个公众号栏目，每周要和老师确认选题。有一次推送前一天临时换题，我当天重新找了素材，晚上把稿子交给老师看过，第二天按时推送。这件事让我养成了每周多备一个选题的习惯。</p>',
      plain: '我在实习时负责过一个公众号栏目，每周要和老师确认选题。有一次推送前一天临时换题，我当天重新找了素材，晚上把稿子交给老师看过，第二天按时推送。这件事让我养成了每周多备一个选题的习惯。',
      use: 'data-go="iv-run"', useTo: '作为这一题的回答，提交前还能改', type: 'data-go="iv-run"', ask: ''
    },
    jobfit: {
      eyebrow: '对照岗位要求 · 岗位要求', title: '用手机把岗位要求贴过来', label: '岗位要求', mtitle: '把岗位要求贴过来',
      sub: '手机上复制、粘贴更快。贴好点发送，内容会出现在这台机器上，由你确认后才用。',
      text: '<ol><li>本科及以上，新闻、中文或市场营销相关专业；</li><li>有公众号或短视频运营经验，能独立完成选题、写稿和排版；</li><li>会用常用的排版和剪辑工具，能看懂阅读和完播数据；</li><li>沟通顺畅，能按周排期推进一个内容栏目。</li></ol>',
      plain: '1. 本科及以上，新闻、中文或市场营销相关专业；2. 有公众号或短视频运营经验，能独立完成选题、写稿和排版；3. 会用常用的排版和剪辑工具，能看懂阅读和完播数据；4. 沟通顺畅，能按周排期推进一个内容栏目。',
      use: 'data-go="jobfit"', useTo: '填进「岗位要求」，还能接着改', type: 'data-go="jobfit"', ask: '问小青：岗位要求怎么贴？'
    }
  };
  const pfCtx = () => (S().b2ctx === 'interview' || S().b2ctx === 'jobfit' ? S().b2ctx : 'resume');
  const charCount = (t) => Array.from(String(t).replace(/\s/g, '')).length;
  /* 屏上键盘的小样（插画） */
  function kbArt() {
    let keys = '';
    [[10, 16], [9, 42], [7, 68]].forEach(([n, y]) => {
      const kw = 16, gap = 4, x0 = (220 - (n * kw + (n - 1) * gap)) / 2;
      for (let i = 0; i < n; i++) keys += `<rect x="${x0 + i * (kw + gap)}" y="${y}" width="${kw}" height="20" rx="4" fill="#fff" stroke="#c9d1cd" stroke-width="1.5"/>`;
    });
    keys += '<rect x="44" y="96" width="132" height="22" rx="6" fill="#fff" stroke="#c9d1cd" stroke-width="1.5"/>';
    return `<svg class="illus" width="220" height="136" viewBox="0 0 220 136" aria-hidden="true"><rect x="2" y="2" width="216" height="132" rx="16" fill="#e2e8e4" stroke="#b9c3bf" stroke-width="2"/>${keys}</svg>`;
  }
  /* 手机上那一页的小样（一体机屏上给人看「手机上会看到什么」） */
  function mock(p) {
    return `<div class="b2a-mock" aria-hidden="true"><div class="b2a-mtop"><span class="pm">职</span><b>职易达</b></div><div class="b2a-mbody"><b class="b2a-mt">${p.mtitle}</b><span class="b2a-ml">${p.label}</span><div class="b2a-mbox"><i></i><i></i><i></i><i></i><i class="s"></i></div><span class="b2a-mbtn">发到一体机</span></div></div>`;
  }
  function phoneFill() {
    const s = keys();
    const k = pfCtx(), p = PF[k];
    const v = ['got', 'expired', 'error'].indexOf(s.b2v) >= 0 ? s.b2v : 'wait';
    const seed = 30 + (s.b2seed || 0);
    const qrBox = v === 'wait'
      ? `<div class="b2a-bqr waiting"><div class="qr-box"><i class="pulse"></i><i class="pulse p2"></i>${UI.qr(seed, 220)}</div></div>`
      : v === 'got'
        ? `<div class="b2a-bqr">${UI.qr(seed, 220)}</div>`
        : `<div class="b2a-bqr b2a-dim">${UI.qr(seed, 220)}<span class="b2a-qrx">${v === 'expired' ? '已过期' : '没连上'}</span></div>`;
    const title = v === 'expired' ? '二维码过期了' : v === 'error' ? '手机那边没连上' : p.title;
    const sub = v === 'expired' ? '刷新二维码后，用手机再扫一次。' : v === 'error' ? '这次没收到手机发来的内容。可以再试一次，或者改在屏上打。' : p.sub;
    const status = v === 'wait' ? { text: '等手机发过来' } : v === 'got' ? { text: '手机发来了，等你确认' } : v === 'expired' ? { text: '二维码已过期', warn: 1 } : { text: '没连上', warn: 1 };
    const bandHtml = band({ kind: 'std', sealHtml: qrBox, back: true, eyebrow: p.eyebrow, title, sub, status, path: ['手机扫码', '在手机上填写', '回到这台机器确认'], pathLabel: '三步' });
    /* 两张并排的大卡：上面是图（按卡片高度缩放），下面一行字 */
    const go = `<span class="go">${icon('arrowR', 30, 2.4)}</span>`;
    const vcard = (o) => `<${o.at ? 'button' : 'div'} class="b2a-vcard${o.cls ? ' ' + o.cls : ''} rise" style="--i:${o.i}"${o.at ? ' ' + o.at : ''}><div class="art b2a-fit">${o.art}</div><div class="tx"><div><b>${o.t}</b><small>${o.d}</small></div>${o.at ? go : ''}</div></${o.at ? 'button' : 'div'}>`;
    const destArt = k === 'interview' ? UI.report(220) : k === 'jobfit' ? UI.checklist(220) : UI.resume(220, 'fixed');
    const typeCard = (i) => vcard({ i, at: p.type, art: kbArt(), t: '改在屏上打', d: '用屏上键盘接着填' });
    let body = '';
    let pri = '';
    if (v === 'wait') {
      body = `<div class="livebox rise" style="--i:0"><span class="spin"></span><div><b>等手机发过来</b><small>发来后会显示在下面，由你确认后才用</small></div></div>
        <div class="b2a-vgrid">${vcard({ i: 1, art: mock(p), t: '手机上会看到这一页', d: '写好点「发到一体机」' })}${vcard({ i: 2, cls: 'b2a-target', art: destArt, t: '发来后先给你看', d: `点「用这一段」才填进「${p.label}」` })}</div>
        <div class="b2a-rowx"><button class="btn sec" ${p.type}>${icon('keyboard', 30, 2)}改在屏上打</button><p class="fine">这段内容只用于这一次办理，不单独保存</p></div>`;
      pri = priBtn('用这一段', 'id="b2pfUse"', { disabled: 1, wide: !p.ask });
    } else if (v === 'got') {
      body = `<div class="b2a-got rise" style="--i:0"><div class="b2a-gl">${icon('phone', 26, 2)}手机发来的这一段<span class="chip">${p.label}</span></div>${p.text}<small>共 ${charCount(p.plain)} 字 · 只用于这一次办理，不单独保存</small></div>
        <div class="b2a-vgrid">${vcard({ i: 1, cls: 'dark', at: p.use, art: destArt, t: '用这一段', d: p.useTo })}${vcard({ i: 2, at: 'data-b2="v:wait"', art: mock(p), t: '重新填', d: '回到手机上改好再发，二维码不变' })}</div>`;
      pri = priBtn('用这一段', p.use, { wide: !p.ask });
    } else if (v === 'expired') {
      body = `<div class="howto rise" style="--i:0">${icon('alert', 34, 2)}<span>这张码已经过期，手机那边发不过来了。刷新后出一张新码。</span></div>
        <div class="b2a-vgrid">${vcard({ i: 1, cls: 'dark', at: 'data-b2="refresh"', art: UI.qr(seed + 1, 220), t: '刷新二维码', d: '出一张新码，再用手机扫一次' })}${typeCard(2)}</div>`;
      pri = priBtn('刷新二维码', 'data-b2="refresh"', { wide: !p.ask });
    } else {
      body = `<div class="howto rise" style="--i:0">${icon('alert', 34, 2)}<span>手机那边没连上，这次没收到内容。手机上写的字还在手机上。</span></div>
        <div class="b2a-vgrid">${vcard({ i: 1, cls: 'dark', at: 'data-b2="refresh"', art: UI.qr(seed + 1, 220), t: '再试一次', d: '出一张新码，再用手机扫一次' })}${typeCard(2)}</div>
        ${remind(PHONE)}`;
      pri = priBtn('再试一次', 'data-b2="refresh"', { wide: !p.ask });
    }
    const dockHtml = `<footer class="dock">${backBtn('上一步')}${p.ask ? askBtn(p.ask) : ''}${pri}</footer>`;
    return bandHtml + `<main class="body b2a-fill">${body}</main>` + dockHtml + nav('home');
  }
  add('phone-login', 'phone-fill', '公共', '长输入用手机填（第二批补稿）', {
    notes: {
      does: '长输入（工作经历描述、面试这一题的回答、对照岗位要求里的岗位要求）用手机填：意图带右侧是二维码，下面三步（手机扫码 → 在手机上填写 → 回到这台机器确认）。来路 S().b2ctx：默认从零生成 · 工作经历；interview「练面试 · 这一题的回答」；jobfit「对照岗位要求 · 岗位要求」，问题「用手机把岗位要求贴过来」。状态 b2v：wait（默认，等手机发过来，可「改在屏上打」）、got（显示手机发来的那一段，「用这一段」/「重新填」）、expired（二维码过期了，主按钮「刷新二维码」）、error（手机那边没连上，「再试一次」「改在屏上打」和服务电话）。',
      motion: '等的时候二维码外圈慢慢扩散（真在等手机）；收到、过期、没连上都静止。手机发来的内容只由演示事件切过去，屏上不演成功。',
      keep: '沿用手机扫码传文件那一套会话与二维码，手机页换成填写框；内容只进这一次办理，不单独保存，确认前不用；练面试里用手机填时，计时照常走。一体机结束使用或清场时，这一次的二维码和会话立即作废，手机再提交也进不了下一位的屏（手机那边见 phone-fill-m 的 ended）。「改在屏上打」：从零生成去 kbd-short 的 long，练面试回作答页，对照岗位要求回对照页。不写二维码剩余时长。' + PHONE_NOTE
    },
    demo: [{ label: '演示：手机发来了', ev: 'got' }, { label: '演示：二维码过期了', ev: 'expired' }, { label: '演示：手机那边没连上', ev: 'error' }],
    render: phoneFill,
    mount: (el) => {
      const set = (v, fresh) => { if (fresh) S().b2seed = (S().b2seed || 0) + 1; S().b2v = v; window.__proto.refresh(); };
      const onClick = (e) => {
        const b = e.target.closest('[data-b2]');
        if (!b || !el.contains(b)) return;
        e.stopPropagation();
        if (b.dataset.b2 === 'refresh') set('wait', true);
        else if (b.dataset.b2 === 'v:wait') set('wait', false);
      };
      const onDemo = (e) => { if (['got', 'expired', 'error'].indexOf(e.detail) >= 0) set(e.detail, false); };
      el.addEventListener('click', onClick);
      el.addEventListener('proto-demo', onDemo);
      return () => { el.removeEventListener('click', onClick); el.removeEventListener('proto-demo', onDemo); };
    }
  });

  /* phone-fill-m：手机上的填写页 */
  function phoneFillM() {
    const s = keys();
    const k = pfCtx(), p = PF[k];
    const v = s.b2v === 'sent' || s.b2v === 'ended' ? s.b2v : '';
    const n = charCount(p.plain);
    const head = `<div class="b2a-pcard"><b>${p.mtitle}</b><small>${k === 'jobfit' ? '把岗位要求粘贴进来，点发送；回到一体机上确认后才用。' : '在这里写好，点发送；回到一体机上确认后才用。'}</small></div>`;
    const note = v === 'sent'
      ? '<div class="b2a-pcard ok"><b>已发到一体机，请回到那台机器上确认</b></div>'
      : v === 'ended' ? '<div class="b2a-pcard warn"><b>一体机上的这次办理已经结束，内容没有送达。你写的字还在上面的框里，可以复制保存。</b></div>' : '';
    const btn = v === 'sent' ? '<button class="b2a-pbtn" disabled>已发出</button>' : v === 'ended' ? '<button class="b2a-pbtn" disabled>发不出去了</button>' : '<button class="b2a-pbtn" data-b2="send">发到一体机</button>';
    const row = (t, d) => `<div class="b2a-prow"><b>${t}</b><span>${d}</span></div>`;
    const rows = v === 'sent'
      ? row('回一体机', '在那台机器上点「用这一段」才会用。') + row('要改的话', '在一体机上点「重新填」，改好再发一次。') + row('只用这一次', '内容只进这一次办理，不单独保存。')
      : v === 'ended'
        ? row('想接着办', '回到一体机重新开始，再扫一次新出的码。') + row('不会串到下一位', '没送达的内容不会出现在下一位的屏上。')
        : row('发出之后', '回到一体机看一眼，点「用这一段」才会用。') + row('只用这一次', '内容只进这一次办理，不单独保存。') + row('写到一半要走', '一体机结束使用后，这一页就发不出去了，字还留在框里。');
    const inner = `${head}<div class="b2a-plab">${p.label}</div><div class="b2a-pinput${v === 'sent' ? ' ro' : ''}">${p.text}</div><div class="b2a-pcount">已写 ${n} 字</div>${note}${btn}<div class="b2a-prows">${rows}</div>`;
    return `<div class="phonepage b2a-pfpage"><div class="pcap"><div class="eyebrow">手机上的页面</div><h1>${p.mtitle}</h1><p>扫一体机上的码之后，在你自己的手机里打开。</p></div>
      <div class="b2a-pf"><div class="b2a-pfs"><div class="b2a-ptop"><span class="pm">职</span><b>职易达</b><span class="pc">手机填写</span></div><div class="b2a-pbody">${inner}</div></div></div></div>`;
  }
  add('phone-fill', 'phone-fill-m', '公共', '手机上：填写（第二批补稿）', {
    notes: {
      does: '扫一体机上的码之后在手机里打开的填写页，照 phone-upload（手机上：传文件）的手机框样式画：标题「填好发到一体机」（对照岗位要求来路是「把岗位要求贴过来」），一个大输入框（已填一段示例）、字数、按钮「发到一体机」。状态 b2v：sent（已发到一体机，请回到那台机器上确认）、ended（一体机上的这次办理已经结束，内容没有送达；字还在框里，可以复制保存）。',
      motion: '无。点「发到一体机」只切到「已发出」，不演一体机那边的结果。',
      keep: '手机上不宣布一体机那边已经用上；一体机结束使用或清场后，这一次的会话作废，手机再提交也进不了下一位的屏，手机上要照实写没送达，并保留已写的字。框里的字只在这一次办理里用，不单独保存。手机框按真实尺寸画（不靠整体缩放），屏上字号都不小于 20px。'
    },
    render: phoneFillM,
    mount: (el) => {
      const on = (e) => {
        const b = e.target.closest('[data-b2]');
        if (!b || !el.contains(b)) return;
        e.stopPropagation();
        if (b.dataset.b2 === 'send') { S().b2v = 'sent'; window.__proto.refresh(); }
      };
      el.addEventListener('click', on);
      return () => el.removeEventListener('click', on);
    }
  });
})();
