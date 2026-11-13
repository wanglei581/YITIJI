/* fix-ivscan-1111.js：第二批补稿 · 甲二路（2026-11-11）——练面试防误触与「回到这一场」、扫描件手机扫码保存。
 * 改已有屏（默认状态原样返回原 render，或在原 HTML 上做带断言的替换，目标不是恰好一处就 throw）：
 *   iv-run 离开确认（b2v=leave）· interview 去掉两句内部说法、回到这一场（running）/ 上一场时间到了（timeup）
 *   · xq 练面试进行中提示条（iv-running）· iv-report 结束使用 · scan-result 2×2 下一步与结束使用
 *   · my-docs 行操作层（row / row-del / row-docx）
 * 新屏：scan-save（默认 ready，另有 loading / hidden / used / used-notme / expired / error / gone）。类名一律 b2i-。 */
(function () {
  'use strict';
  /* 三路共用状态键。window.S 由 app.js 在本文件之后整个赋值建出来，加载时还不存在，所以默认值在每次取状态时补。 */
  function initKeys() {
    const s = window.S;
    if (!s) return null;
    if (s.mini === undefined) s.mini = /[?&]mini=1/.test(location.search);
    if (s.scanner === undefined) s.scanner = !/[?&]scanner=0/.test(location.search);
    return s;
  }
  initKeys();
  document.addEventListener('DOMContentLoaded', initKeys);
  const S = () => initKeys() || {};
  const { icon, band, dock, nav, qr } = UI;
  const refresh = () => { if (window.__proto) window.__proto.refresh(); };
  const PHONE = '183-6916-1921';
  const HELP = '需要帮助？拨打服务电话 ' + PHONE;
  const SHORT = '链接短时有效，请仅在本人手机上打开';

  const css = document.createElement('style');
  css.textContent = `
.b2i-scrim{position:absolute;inset:0;z-index:29;background:rgba(7,24,20,.6);animation:fadein 200ms ease both}
.b2i-sheet{position:absolute;left:0;right:0;bottom:0;z-index:30;display:flex;flex-direction:column;gap:16px;padding:16px 48px 36px;border-radius:44px 44px 0 0;background:var(--paper);box-shadow:0 -16px 48px rgba(7,24,20,.28);animation:sheetup 320ms var(--ease) both}
.b2i-grab{flex:none;width:96px;height:8px;border-radius:4px;background:var(--line);align-self:center}
.b2i-sheet h2{margin:0;font:700 46px/1.3 var(--serif);color:var(--ink)}
.b2i-lead{margin:0;font-size:24px;line-height:1.5;color:var(--ink-2)}
.b2i-left{display:flex;align-items:center;gap:16px;min-height:96px;padding:10px 22px;border-radius:24px;background:var(--clay-wash);color:var(--clay-ink)}
.b2i-left .big{flex:1;min-width:0;font:700 30px/1.2 var(--sans);color:var(--ink)}
.b2i-left .big em{font-style:normal;font-size:52px;font-variant-numeric:tabular-nums;color:var(--clay-ink);margin:0 4px}
.b2i-left .chip{background:var(--card);color:var(--ink-2)}
.b2i-opts{display:flex;flex-direction:column;gap:12px}
.b2i-opt{display:flex;align-items:center;gap:18px;width:100%;min-height:104px;padding:14px 20px 14px 16px;border-radius:28px;background:var(--card);border:1.5px solid var(--edge);text-align:left;color:var(--ink);transition:transform var(--t-press)}
.b2i-opt:active{transform:scale(.985)}
.b2i-opt .ic{width:68px;height:68px;border-radius:20px;background:var(--teal-wash);color:var(--teal-ink);display:grid;place-items:center;flex:none}
.b2i-opt .tx{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px}
.b2i-opt b{font-size:30px;line-height:1.3}
.b2i-opt small{font-size:22px;line-height:1.4;color:var(--ink-2);font-weight:500}
.b2i-opt .go{flex:none;color:var(--ink-3)}
.b2i-opt.pri{background:var(--deep);border-color:var(--deep);color:var(--cream)}
.b2i-opt.pri .ic{background:rgba(46,230,168,.16);color:var(--glow)}
.b2i-opt.pri small{color:var(--mint)}
.b2i-opt.pri .go{color:var(--glow)}
.b2i-opt.quiet{min-height:88px;background:transparent}
.b2i-opt.quiet .ic{background:var(--well);color:var(--ink-2)}
.b2i-opt.danger{background:var(--cinnabar);border-color:var(--cinnabar);color:#fff}
.b2i-opt.danger .ic{background:rgba(255,255,255,.16);color:#fff}
.b2i-opt.danger .go{color:#fff}
.b2i-opt[disabled]{background:var(--well);border-style:dashed;cursor:default}
.b2i-opt[disabled]:active{transform:none}
.b2i-opt[disabled] b{color:var(--ink-2)}
.b2i-opt[disabled] small{color:var(--clay-ink);font-weight:700}
.b2i-opt[disabled] .ic{background:var(--paper-2);color:var(--ink-3)}
.b2i-opt[disabled] .go{visibility:hidden}
.screen:has(.b2i-sheet) .dock,.screen:has(.b2i-sheet) .nav,.screen:has(.b2i-leave) .fi-acts,.screen:has(.b2i-leave) .fi-answer{visibility:hidden}
.b2i-dochead{display:flex;align-items:center;gap:20px}
.b2i-ft{width:80px;height:100px;border-radius:14px;background:#fdecea;color:var(--cinnabar);display:grid;place-items:center;font:700 20px var(--sans);flex:none}
.b2i-ft.doc{background:#e7eef9;color:var(--slate-ink)}
.b2i-ft.img{background:var(--teal-wash);color:var(--teal-ink)}
.b2i-dochead .tx{flex:1;min-width:0;display:flex;flex-direction:column;align-items:flex-start;gap:6px}
.b2i-dochead b{font:700 34px/1.3 var(--serif);word-break:break-all}
.b2i-dochead small{font-size:22px;line-height:1.4;color:var(--ink-3);font-weight:600}
.b2i-x{width:72px;height:72px;border-radius:50%;background:var(--card);border:1.5px solid var(--edge);display:grid;place-items:center;flex:none;color:var(--ink-2)}
.b2i-keep{min-height:64px;padding:0 20px;border-radius:20px;background:var(--teal-wash);color:var(--teal-ink);font:700 22px/1 var(--sans)}
.b2i-warn{display:flex;align-items:center;gap:16px;min-height:96px;padding:16px 22px;border-radius:24px;background:var(--cin-wash);color:var(--cinnabar);font:700 30px/1.35 var(--sans)}
.b2i-ivcard{flex:none;display:flex;align-items:center;gap:20px;width:100%;min-height:168px;padding:18px 22px;border-radius:28px;background:var(--teal-wash);border:2px solid var(--teal);text-align:left;color:var(--ink);transition:transform var(--t-press)}
.b2i-ivcard:active{transform:scale(.985)}
.b2i-ivcard .ic{position:relative;width:84px;height:84px;border-radius:24px;background:var(--card);color:var(--teal-ink);display:grid;place-items:center;flex:none}
.b2i-ivcard .tx{flex:1;min-width:0;display:flex;flex-direction:column;gap:6px}
.b2i-ivcard b{font:700 40px/1.25 var(--serif);color:var(--deep)}
.b2i-ivcard small{font-size:24px;line-height:1.4;color:var(--ink-2);font-weight:600}
.b2i-ivcard .go{width:72px;height:72px;border-radius:50%;background:var(--deep);color:var(--cream);display:grid;place-items:center;flex:none}
.b2i-ivcard.over{background:var(--slate-wash);border-color:rgba(63,104,176,.45)}
.b2i-ivcard.over .ic{color:var(--slate-ink)}
.b2i-live{position:absolute;right:-6px;top:-6px;width:20px;height:20px;border-radius:50%;background:var(--glow);box-shadow:0 0 0 4px rgba(46,230,168,.25);animation:b2i-breathe 1.6s ease-in-out infinite alternate}
@keyframes b2i-breathe{from{opacity:.35}to{opacity:1}}
.fi-hub.b2i-hubfree .fi-grid{gap:12px}
.fi-hub.b2i-hubfree .fi-grid .tile{min-height:176px}
.b2i-ivbar{flex:none;display:flex;align-items:center;gap:16px;width:100%;min-height:80px;padding:8px 10px 8px 12px;border-radius:24px;background:var(--teal-wash);border:2px solid var(--teal);text-align:left;color:var(--ink)}
.b2i-ivbar:active{transform:scale(.985)}
.b2i-ivbar .ic{position:relative;width:60px;height:60px;border-radius:18px;background:var(--card);color:var(--teal-ink);display:grid;place-items:center;flex:none}
.b2i-ivbar .tx{flex:1;min-width:0;font-size:26px;line-height:1.3;font-weight:700}
.b2i-ivbar .tx em{font-style:normal;font-variant-numeric:tabular-nums;color:var(--teal-ink)}
.b2i-ivbar .pill{display:inline-flex;align-items:center;gap:8px;height:64px;padding:0 22px;border-radius:20px;background:var(--deep);color:var(--cream);font:700 24px/1 var(--sans);flex:none}
.b2i-xqrun .fp-split.fp-fill>.fp-hit.fp-theme-card{min-height:456px}
.screen[data-id="xq"] .b2i-xqrun .fp-aidown .fp-exits .slab.row{min-height:196px}
.b2i-endrow{flex:none;display:flex;align-items:center;gap:16px;width:100%;min-height:88px;padding:10px 18px 10px 12px;border-radius:24px;background:var(--cin-wash);border:1.5px solid rgba(178,58,46,.25);text-align:left;color:var(--ink);transition:transform var(--t-press)}
.b2i-endrow:active{transform:scale(.985)}
.b2i-endrow .ic{width:64px;height:64px;border-radius:18px;background:var(--cinnabar);color:#fff;display:grid;place-items:center;flex:none}
.b2i-endrow .tx{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.b2i-endrow b{font-size:28px;line-height:1.25;color:var(--cinnabar)}
.b2i-endrow small{font-size:22px;line-height:1.35;color:var(--ink-2)}
.b2i-endrow .go{flex:none;color:var(--cinnabar)}
.screen:has(.b2i-endrow) .fi-page{gap:7px}
.screen:has(.b2i-endrow) .fi-ab{padding:5px 0}
.b2i-next4{flex:none;display:grid;grid-template-columns:1fr 1fr;gap:10px}
.b2i-next4>.fs-row{height:100%;min-height:112px}
.b2i-qrbox{position:relative;flex:none;display:flex;flex-direction:column;align-items:center;gap:10px;padding:16px 16px 14px;border-radius:30px;background:var(--card);box-shadow:0 14px 34px rgba(0,0,0,.28);color:var(--ink)}
.b2i-qrbox .chip{height:36px;font-size:20px}
.b2i-qrslot{width:248px;height:248px;display:grid;place-items:center}
.b2i-qrhold{width:248px;height:294px;border-radius:22px;border:2.5px dashed rgba(11,36,30,.22);background:var(--well);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:18px;text-align:center;font:700 24px/1.4 var(--sans);color:var(--ink-2)}
.b2i-qrhold span{text-wrap:balance}
.b2i-qrhold small{font-size:22px;font-weight:600;line-height:1.4}
.b2i-qrhold.warn{border-color:rgba(178,58,46,.4);background:var(--cin-wash);color:var(--cinnabar)}
.b2i-qrhold.ok{border-color:rgba(31,158,134,.45);background:var(--teal-wash);color:var(--teal-ink)}
.b2i-reshow{width:248px;height:294px;border-radius:22px;background:var(--deep);color:var(--cream);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;padding:16px;font:700 30px/1.3 var(--sans);text-align:center;transition:transform var(--t-press)}
.b2i-reshow:active{transform:scale(.97)}
.b2i-reshow .ic{width:96px;height:96px;border-radius:26px;background:rgba(46,230,168,.16);color:var(--glow);display:grid;place-items:center}
.b2i-ss.body{justify-content:flex-start;gap:16px;padding:24px 48px 20px}
.b2i-qrstate{flex:none;display:flex;align-items:center;gap:20px;padding:16px 22px;border-radius:26px;background:var(--teal-wash);color:var(--teal-ink)}
.b2i-qrstate>.ic{width:72px;height:72px;border-radius:22px;background:var(--card);display:grid;place-items:center;flex:none}
.b2i-qrstate .tx{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px}
.b2i-qrstate b{font:700 44px/1.15 var(--sans);font-variant-numeric:tabular-nums;color:var(--deep)}
.b2i-qrstate span{font-size:24px;line-height:1.4;font-weight:700}
.b2i-qrstate small{font-size:22px;line-height:1.4;color:var(--ink-2)}
.b2i-qrstate.hold{background:var(--well);color:var(--ink-2)}
.b2i-qrstate.hold b{color:var(--ink-2);font-size:36px}
.b2i-qrstate.over{background:var(--cin-wash);color:var(--cinnabar)}
.b2i-qrstate.over b{color:var(--cinnabar)}
.b2i-how{flex:1;min-height:0;display:grid;grid-template-columns:330px minmax(0,1fr);gap:22px;padding:18px;border-radius:30px;background:var(--card);border:1.5px solid var(--edge)}
.b2i-how .pv{min-height:0;border-radius:22px;background:var(--well);display:grid;place-items:center;overflow:hidden}
.b2i-how .pv svg{height:86%;width:auto;max-width:90%}
.b2i-how .rt{min-width:0;display:flex;flex-direction:column;gap:12px}
.b2i-fhead{display:flex;align-items:center;gap:16px;padding-bottom:14px;border-bottom:1px solid var(--line)}
.b2i-fhead .tx{min-width:0}
.b2i-fhead b{display:block;font-size:28px;line-height:1.3;word-break:break-all}
.b2i-fhead small{display:block;font-size:22px;line-height:1.4;color:var(--ink-3)}
.b2i-steps{flex:1;display:flex;flex-direction:column;justify-content:space-around;gap:10px}
.b2i-step{display:grid;grid-template-columns:52px minmax(0,1fr);column-gap:16px;row-gap:2px;align-items:start}
.b2i-step i{grid-row:1 / span 3;width:52px;height:52px;border-radius:50%;background:var(--deep);color:var(--cream);display:grid;place-items:center;font:700 24px/1 var(--sans);font-style:normal}
.b2i-step b{font-size:28px;line-height:1.3}
.b2i-step small{font-size:22px;line-height:1.4;color:var(--ink-3)}
.b2i-step small.tip{color:var(--teal-ink);font-weight:700}
.b2i-orig{flex:none;display:flex;align-items:center;gap:16px;min-height:84px;padding:14px 24px;border-radius:24px;background:var(--well);color:var(--ink);font-size:25px;font-weight:700;line-height:1.4}
.b2i-orig .i{color:var(--teal-ink);flex:none}
.b2i-ss .remind{flex:none}
.b2i-fill>.slab.row{flex:1;min-height:180px;align-items:stretch}
.b2i-fill>.slab.row .vis{min-height:0}
.b2i-fill>.slab.row .vis svg{width:auto;height:auto;max-width:86%;max-height:86%}
.b2i-fill>.slab.row .txt{align-self:center}
.b2i-fill>.slab.row h3{font-size:36px}
.b2i-file{flex:none;display:flex;align-items:center;gap:24px;min-height:140px;padding:20px 28px;border-radius:28px;background:var(--card);border:1.5px solid var(--edge)}
.b2i-file.off{background:var(--well);border-style:dashed}
.b2i-file .tx{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px}
.b2i-file b{font-size:28px;line-height:1.35;word-break:break-all}
.b2i-file.off b{color:var(--ink-2)}
.b2i-file small{font-size:22px;color:var(--ink-3)}
.b2i-void{flex:none;display:flex;align-items:center;gap:20px;padding:24px 28px;border-radius:28px;background:var(--cin-wash);color:var(--cinnabar)}
.b2i-void .tx{display:flex;flex-direction:column;gap:6px}
.b2i-void b{font:700 36px/1.3 var(--serif)}
.b2i-void span{font-size:26px;line-height:1.45;font-weight:700;color:var(--ink)}
`;
  document.head.appendChild(css);

  /* ── 公共小件 ── */
  const list = window.SCREENS;
  const byId = (id) => list.find((x) => x.id === id);
  function once(html, needle, label) {
    const i = html.indexOf(needle);
    if (i < 0 || html.indexOf(needle, i + needle.length) >= 0) throw new Error('fix-ivscan-1111：「' + label + '」在原稿里不是恰好出现一次');
    return i;
  }
  function swap(html, needle, repl, label) { const i = once(html, needle, label); return html.slice(0, i) + repl + html.slice(i + needle.length); }
  function wrap(id, fn) {
    const def = byId(id);
    if (!def) throw new Error('fix-ivscan-1111：找不到屏 ' + id);
    const orig = def.render;
    def.render = function () { return fn(() => orig.call(def)); };
    return def;
  }
  function renote(id, add) {
    const def = byId(id);
    const base = def.notes || {};
    const pick = (k) => { try { return base[k] || ''; } catch (e) { return ''; } };
    def.notes = {
      get does() { return '【第二批补稿】' + add.does + (pick('does') ? '　｜原说明：' + pick('does') : ''); },
      get motion() { return '【第二批补稿】' + add.motion + (pick('motion') ? '　｜原说明：' + pick('motion') : ''); },
      get keep() { return '【第二批补稿】' + add.keep + (pick('keep') ? '　｜原说明：' + pick('keep') : ''); }
    };
    def.name = def.name + '（第二批补稿）';
  }
  /* 变体：S().b2v 是「当前屏」的变体名。第一次被认得它的屏读到时记下归属（b2vOwner），别的屏读到一律当默认，避免带到下一屏。 */
  const VARIANTS = {
    'iv-run': ['leave'], interview: ['running', 'timeup'], xq: ['iv-running'],
    'scan-save': ['ready', 'loading', 'hidden', 'used', 'used-notme', 'expired', 'error', 'gone'],
    'my-docs': ['row', 'row-del', 'row-docx']
  };
  function variant(id) {
    const s = S();
    const v = s.b2v;
    if (v === undefined || v === null || v === '' || (VARIANTS[id] || []).indexOf(String(v)) < 0) return '';
    if (s.b2vOwner === undefined || s.b2vOwner === null) s.b2vOwner = id;
    return s.b2vOwner === id ? String(v) : '';
  }
  function setVariant(id, v) { const s = S(); if (v) { s.b2v = v; s.b2vOwner = id; } else { delete s.b2v; delete s.b2vOwner; } }
  const opt = (o) => `<button type="button" class="b2i-opt ${o.cls || ''}" ${o.attrs || ''}${o.off ? ' disabled' : ''}><span class="ic">${icon(o.ic, 34, 2)}</span><span class="tx"><b>${o.t}</b>${o.d ? `<small>${o.d}</small>` : ''}</span><span class="go">${icon('chevR', 30, 2.2)}</span></button>`;
  const rowCard = (o) => `<button type="button" class="slab row ${o.dark ? 'dark' : ''} rise" style="--i:${o.i || 0}" ${o.attrs}><div class="vis">${o.vis || ''}</div><div class="txt"><h3>${o.t}</h3><p>${o.d}</p><div class="take"><span class="go">${icon('arrowR', 30, 2.4)}</span></div></div></button>`;
  const remind = (ic, t, i) => `<div class="remind rise" style="--i:${i || 0}">${icon(ic, 34, 2)}<span>${t}</span></div>`;
  const endRow = (sub) => `<button type="button" class="b2i-endrow rise" style="--i:9" data-b2="end-use"><span class="ic">${icon('erase', 32, 2.2)}</span><span class="tx"><b>结束使用</b><small>${sub}</small></span><span class="go">${icon('chevR', 30, 2.2)}</span></button>`;
  function endUse() {
    const s = S();
    Object.keys(s).forEach((k) => { if (/^(fi|fs|b2)/.test(k)) delete s[k]; });
    window.doClear();
  }
  function phoneSave(w, warn) {
    return `<svg class="illus" width="${w}" height="${Math.round(w * 1.9)}" viewBox="0 0 150 285" aria-hidden="true">
      <rect x="6" y="4" width="138" height="277" rx="24" fill="#13231e"/><rect x="14" y="20" width="122" height="245" rx="14" fill="#f5f2e9"/><rect x="58" y="10" width="34" height="5" rx="2.5" fill="#33423d"/>
      <rect x="30" y="40" width="64" height="86" rx="8" fill="#fff" stroke="#c9d1cd" stroke-width="2"/><path d="M78 40v18h16" fill="none" stroke="#c9d1cd" stroke-width="2"/>
      <rect x="38" y="66" width="34" height="6" rx="2" fill="#13231e"/><rect x="38" y="80" width="46" height="4" rx="2" fill="#d9ded9"/><rect x="38" y="90" width="40" height="4" rx="2" fill="#d9ded9"/><rect x="38" y="100" width="44" height="4" rx="2" fill="#d9ded9"/>
      <rect x="38" y="110" width="22" height="10" rx="3" fill="#fdecea"/>
      ${warn ? '<circle cx="102" cy="164" r="24" fill="#b23a2e"/><path d="M102 151v15M102 175v1" stroke="#fff" stroke-width="5" fill="none" stroke-linecap="round"/>' : '<circle cx="102" cy="164" r="24" fill="#1f9e86"/><path d="M102 150v26M91 166l11 11 11-11" stroke="#fff" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'}
      <rect x="30" y="222" width="90" height="26" rx="13" fill="#0b241e"/><text x="75" y="235" dy=".35em" text-anchor="middle" fill="#f6f3ea" font-size="13" font-weight="700" font-family="sans-serif">下载</text></svg>`;
  }

  /* ── 练面试这一场：题号、剩余时间读 S（与 fix-interview.js 同一组键）；还没开过一场时用示例「第 2 题 / 目标 6 题 · 剩余 3:12」 ── */
  const WHO = { hr: 'HR 面试', manager: '业务主管', tech: '技术面试官', campus: '校招面试官', final: '终面负责人' };
  const fmt = (sec) => { const n = Math.max(0, sec | 0); return Math.floor(n / 60) + ':' + String(n % 60).padStart(2, '0'); };
  function ivNow() {
    const s = S();
    const fresh = s.fiQ === undefined;
    const dur = s.fiDur || 5;
    return {
      who: WHO[s.fiWho || 'hr'] || WHO.hr,
      q: fresh ? 2 : (s.fiQ || 1),
      tgt: ({ 3: 4, 5: 6, 8: 8 })[dur] || 6,
      left: fmt(fresh ? 192 : (typeof s.fiLeft === 'number' ? s.fiLeft : dur * 60))
    };
  }
  function ivSample() {
    const s = S();
    if (s.fiQ !== undefined) return;
    s.fiQ = 2; s.fiLeft = 192;
    if (!s.fiAnswers) s.fiAnswers = 1;
    if (!Array.isArray(s.fiMsgs) || !s.fiMsgs.length) s.fiMsgs = [{ role: 'you', text: '我在学生会负责来访登记，把当天的访客、院系和离开时间写在同一本上。', skipped: false }];
  }
  function ivGuard() {
    const s = S();
    const p = s.fiPhase || '';
    return s.ai !== 'down' && !s.fiTimeUp && p !== 'expired' && p !== 'aidown' && p !== 'noanswer';
  }

  /* 1. iv-run：离开确认 */
  function leaveSheet() {
    const iv = ivNow();
    return `<div class="b2i-scrim" data-b2="leave-stay"></div><section class="b2i-sheet b2i-leave" role="dialog" aria-modal="true" aria-labelledby="b2LeaveT">
      <div class="b2i-grab" aria-hidden="true"></div>
      <h2 id="b2LeaveT">这一场还没结束</h2>
      <div class="b2i-left">${icon('clock', 40, 2.2)}<span class="big">还剩<em>${iv.left}</em>，离开期间照常走</span><span class="chip">第 ${iv.q} 题 / 目标 ${iv.tgt} 题</span></div>
      <p class="b2i-lead">到点会自动结束，到点前提交的回答会保存。</p>
      <div class="b2i-opts">
        ${opt({ cls: 'pri', attrs: 'data-b2="leave-stay"', ic: 'pen', t: '继续作答' })}
        ${opt({ attrs: 'data-b2="leave-go"', ic: 'clock', t: '暂时离开（时间不会停）', d: '在练面试服务台点「回到这一场」' })}
        ${opt({ attrs: 'data-b2="leave-end" data-fi="end"', ic: 'receipt', t: '结束本场，生成练习报告' })}
      </div></section>`;
  }
  wrap('iv-run', (orig) => {
    if (variant('iv-run') !== 'leave' || !ivGuard()) return orig();
    ivSample();
    return orig() + leaveSheet();
  });

  /* 2. interview：去掉两句内部说法；回到这一场 / 上一场时间到了 */
  wrap('interview', (orig) => {
    let html = orig();
    const s = S();
    const v = variant('interview');
    const ready = (s.fiHub || 'ready') === 'ready';
    if (ready) html = swap(html, '<b>进入具体服务后再确认实时能力。</b><span>本页只负责分流，不预报在线、名额、价格或办理结果。</span>', '', '服务台两句内部说法');
    const MAIN = '<main class="body fi-page fi-hub">';
    if (v === 'running' || v === 'timeup') {
      const iv = ivNow();
      const card = v === 'running'
        ? `<button type="button" class="b2i-ivcard rise" style="--i:0" data-go="iv-run"><span class="ic">${icon('mic', 42, 2)}<i class="b2i-live" aria-hidden="true"></i></span><span class="tx"><b>回到这一场</b><small>${iv.who} · 第 ${iv.q} 题 / 目标 ${iv.tgt} 题 · 剩余 ${iv.left} · 时间照常在走</small></span><span class="go">${icon('arrowR', 34, 2.4)}</span></button>`
        : `<button type="button" class="b2i-ivcard over rise" style="--i:0" data-go="iv-report"><span class="ic">${icon('receipt', 42, 2)}</span><span class="tx"><b>上一场时间到了</b><small>到点前提交的回答已保存，可以看这一场的练习报告</small></span><span class="go">${icon('arrowR', 34, 2.4)}</span></button>`;
      return swap(html, MAIN, MAIN.replace('fi-hub', 'fi-hub b2i-hubrun') + card, '服务台主体');
    }
    return ready ? swap(html, MAIN, MAIN.replace('fi-hub', 'fi-hub b2i-hubfree'), '服务台主体') : html;
  });

  /* 3. xq：练面试进行中提示条 */
  wrap('xq', (orig) => {
    const html = orig();
    if (variant('xq') !== 'iv-running') return html;
    const iv = ivNow();
    const bar = `<button type="button" class="b2i-ivbar rise" style="--i:0" data-go="iv-run"><span class="ic">${icon('mic', 32, 2)}<i class="b2i-live" aria-hidden="true"></i></span><span class="tx">练面试进行中 · 剩余 <em>${iv.left}</em></span><span class="pill">回到这一场${icon('arrowR', 26, 2.4)}</span></button>`;
    return swap(html, '<main class="body fp-fill">', '<main class="body fp-fill b2i-xqrun">' + bar, '问小青主体');
  });

  /* 4. iv-report：结束使用（已登录、报告已读到时） */
  wrap('iv-report', (orig) => {
    const html = orig();
    if (!S().logged || html.indexOf('打印不会先假装成功') < 0) return html;
    return swap(html, '</main>', endRow('退出登录，并清掉这台机器上这一次的内容。报告已存在你的账号里。') + '</main>', '练习报告主体结尾');
  });

  /* 5. scan-result：下一步 2×2，已登录加结束使用 */
  wrap('scan-result', (orig) => {
    const html = orig();
    const s = S();
    if (html.indexOf('<b>AI 简历识别</b>') < 0) return html; /* 三张失败帧不改 */
    const ai = once(html, '<b>AI 简历识别</b>', 'AI 简历识别');
    const start = html.lastIndexOf('<button class="fs-row"', ai);
    const doc = once(html, s.logged ? '<b>前往我的文档</b>' : '<b>本次不进入我的文档</b>', '我的文档那一张');
    const docStart = html.lastIndexOf('<button class="fs-row"', doc);
    const end = html.indexOf('</button>', doc) + '</button>'.length;
    if (start < 0 || docStart <= start || end <= doc) throw new Error('fix-ivscan-1111：扫描完成的下一步排法和原稿对不上');
    const third = s.logged
      ? `<button class="fs-row" data-go="scan-save"><span><b>手机扫码保存</b><small>把这份扫描件存到手机，二维码限时有效</small></span><span class="go">${icon('chevR', 28, 2.2)}</span></button>`
      : `<button class="fs-row" data-go="login"><span><b>登录后可存到手机</b><small>登录后这份扫描件记到你名下，再扫码保存</small></span><span class="go">${icon('chevR', 28, 2.2)}</span></button>`;
    let out = html.slice(0, start) + '<div class="b2i-next4">' + html.slice(start, docStart) + third + html.slice(docStart, end) + '</div>' + html.slice(end);
    if (s.logged) out = swap(out, '</main>', endRow('退出登录，并清掉这台机器上这一次的内容。扫描件已在你的「我的文档」里。') + '</main>', '扫描完成主体结尾');
    return out;
  });

  /* 6. scan-save：手机扫码保存（新屏） */
  const DOCS = {
    d1: { name: '毕业生就业推荐表.pdf', ft: 'PDF', base: 'PDF · 468 KB · 2 页', policy: 'system_short' },
    d2: { name: '个人简历-秋招.pdf', ft: 'PDF', base: 'PDF · 186 KB · 1 页', policy: 'months_3' },
    d5: { name: '成绩单-2026春.pdf', ft: 'PDF', base: 'PDF · 890 KB · 3 页', policy: 'months_6' },
    d3: { name: '求职信-新媒体运营.docx', ft: 'DOCX', ftc: 'doc', base: 'DOCX · 54 KB', policy: 'months_3', why: '这种格式暂不支持打印' },
    d6: { name: '证件照-蓝底.jpg', ft: 'JPG', ftc: 'img', base: 'JPG · 240 KB · 1 页', policy: 'months_3' },
    d7: { name: '实习协议扫描.png', ft: 'PNG', ftc: 'img', base: 'PNG · 1.2 MB · 4 页', policy: 'long_term' },
    d4: { name: '合同风险审查报告.pdf', ft: 'PDF', base: 'PDF · 220 KB · 4 页', policy: 'months_3', why: '该报告仅可查看，不可打印' }
  };
  const KEEP = { system_short: '短期保存，约 24 小时', months_3: '保存 3 个月', months_6: '保存 6 个月', long_term: '长期保存' };
  const docMeta = (id) => DOCS[id].base + ' · ' + (KEEP[(S().feKeep && S().feKeep[id]) || DOCS[id].policy] || '保存期限未注明');
  function ssFile() {
    const id = S().b2SaveDoc;
    if (id && DOCS[id]) return { scan: false, done: 'my-docs', what: '这份文件', name: DOCS[id].name, ft: DOCS[id].ft, ftc: DOCS[id].ftc || '', meta: docMeta(id) };
    return { scan: true, done: 'scan-result', what: '扫描件', name: '王晓婷-产品运营简历.pdf', ft: 'PDF', ftc: '', meta: 'PDF · 486 KB · 2 页' };
  }
  function ssQr(st) {
    const hold = (cls, ic, t, sub) => `<div class="b2i-qrhold ${cls}">${icon(ic, 96, 1.6)}<span>${t}</span>${sub ? `<small>${sub}</small>` : ''}</div>`;
    let inner;
    if (st === 'ready') inner = `<div class="b2i-qrslot">${qr(13, 248)}</div><span class="chip clay">示例码</span>`;
    else if (st === 'hidden') inner = `<button type="button" class="b2i-reshow" data-b2="qr-show"><span class="ic">${icon('qr', 52, 2)}</span>再显示二维码</button>`;
    else if (st === 'loading') inner = hold('', 'qr', '正在生成', '生成好就显示');
    else if (st === 'expired') inner = hold('warn', 'clock', '二维码已过期，请重新生成后再扫码带走');
    else if (st === 'used') inner = hold('ok', 'check', '已下载', '二维码已收起');
    else if (st === 'used-notme') inner = hold('warn', 'alert', '已作废', '扫了也下载不了');
    else if (st === 'error') inner = hold('warn', 'alert', '没生成出来', '可以再试一次');
    else inner = hold('', 'erase', '已清理', '这一份没有了');
    return `<div class="b2i-qrbox">${inner}</div>`;
  }
  function renderScanSave() {
    const st = variant('scan-save') || 'ready';
    const f = ssFile();
    const fileHead = `<span class="b2i-ft ${f.ftc}">${f.ft}</span><div class="tx"><b>${f.name}</b><small>${f.meta}</small></div>`;
    const orig = f.scan ? `<div class="b2i-orig rise" style="--i:6">${icon('scan', 34, 2)}<span>别忘了取走扫描仪里的原件</span></div>` : '';
    const ask = f.scan ? '问小青：扫描件还能怎么带走' : '问小青：这份文件还能怎么带走';
    const done = { label: `${icon('check', 30, 2.6)}完成`, go: f.done, noArrow: true };
    const B = {
      ready: ['用手机扫码，把' + (f.scan ? '扫描件' : '这份文件') + '存下来', '用微信或手机浏览器扫码，下载这一份文件。', { text: '二维码限时有效' }],
      hidden: ['用手机扫码，把' + (f.scan ? '扫描件' : '这份文件') + '存下来', '二维码每次只亮 60 秒，要扫时再点开。', { text: '二维码已收起' }],
      loading: ['正在生成二维码', '生成好之前，这里先不显示二维码。', { text: '正在生成二维码' }],
      expired: ['二维码已过期', '这一份还在，点「重新生成」换一个新码。', { text: '二维码已过期', warn: 1 }],
      used: ['已有一部手机下载了这一份', '是你下载的吗？', { text: '已被下载', warn: 1 }],
      'used-notme': ['这一份被别的手机下载了', f.what + '还能接着打印。', { text: '二维码已作废', warn: 1 }],
      error: ['二维码没生成出来', '这一份还在，可以再试一次。', { text: '二维码没生成出来', warn: 1 }],
      gone: [f.scan ? '这份扫描件已经按保存规则清理了' : '这份文件已经按保存期限清理了', f.scan ? '清理后找不回来。可以重新扫描一份。' : '清理后找不回来。', { text: f.scan ? '扫描件已清理' : '文件已清理', warn: 1 }]
    }[st];
    let body, pri;
    if (st === 'ready' || st === 'hidden' || st === 'loading' || st === 'expired') {
      const qs = {
        ready: ['', 'clock', '还亮 41 秒', '每次只亮 60 秒，到时自动收起', SHORT],
        hidden: ['', 'eye', '二维码已收起', '点右上角「再显示二维码」，再亮 60 秒', SHORT],
        loading: ['hold', 'qr', '正在生成', '生成好后亮 60 秒，到时自动收起', SHORT],
        expired: ['over', 'alert', '已过期', '链接已过期，重新生成后可再扫码', '过期的码扫了也下载不了']
      }[st];
      body = `<div class="b2i-qrstate ${qs[0]} rise" style="--i:0"><span class="ic">${icon(qs[1], 40, 2.2)}</span><div class="tx"><b>${qs[2]}</b><span>${qs[3]}</span><small>${qs[4]}</small></div></div>
        <div class="b2i-how rise" style="--i:1"><div class="pv">${phoneSave(260)}</div><div class="rt"><div class="b2i-fhead">${fileHead}</div><div class="b2i-steps">
          <div class="b2i-step"><i>1</i><b>手机扫码</b><small>微信或手机浏览器都行</small></div>
          <div class="b2i-step"><i>2</i><b>在手机上点下载</b><small>下载的就是这一份</small><small class="tip">微信里打不开时，点右上角选「在浏览器打开」</small></div>
          <div class="b2i-step"><i>3</i><b>存好后回来点完成</b><small>点了「完成」，屏幕上的码随之收起</small></div>
        </div></div></div>
        ${remind('shield', '二维码限时有效，只能下载这一份，别人拿到也只在有效期内能用，离开前请点完成。', 2)}${orig}`;
      pri = st === 'loading' ? { label: '正在生成二维码…', disabled: true, noArrow: true } : st === 'expired' ? { label: '重新生成', id: 'b2QrRetry' } : done;
    } else if (st === 'used') {
      body = `<div class="b2i-file rise" style="--i:0">${fileHead}</div>
        <div class="dsec rise" style="--i:1"><h4>${icon('phone', 30, 2)}刚才发生了什么</h4><p class="b2i-lead" style="font-size:26px">刚才有一部手机扫了这个二维码，下载了这一份。二维码已经收起，别的手机不能再扫。</p></div>
        ${rowCard({ i: 2, dark: 1, attrs: `data-go="${f.done}"`, t: '是我，完成', d: '回到' + (f.scan ? '扫描完成，接着打印或识别' : '我的文档'), vis: phoneSave(124) })}${rowCard({ i: 3, attrs: 'data-b2="used-notme"', t: '不是我下载的', d: '看看接下来怎么办，需要时拨服务电话', vis: phoneSave(124, 1) })}${orig}`;
      pri = { label: '是我，完成', go: f.done };
    } else if (st === 'used-notme') {
      body = `<div class="b2i-void rise" style="--i:0">${icon('alert', 56, 2)}<div class="tx"><b>这个二维码已作废。</b><span>${HELP}</span></div></div>
        <div class="b2i-file rise" style="--i:1">${fileHead}</div>
        ${rowCard({ i: 2, attrs: `data-go="${f.done}"`, t: f.scan ? '回到扫描完成' : '回到我的文档', d: f.what + '还在，可以接着打印', vis: UI.resume(150) })}${rowCard({ i: 3, attrs: 'data-go="pii"', t: '改为打印', d: '先检查个人信息，再打一份纸质版带走', vis: UI.mfp().replace('width="620" height="600"', 'width="186" height="180"') })}${orig}`;
      pri = { label: f.scan ? '回到扫描完成' : '回到我的文档', go: f.done };
    } else if (st === 'error') {
      body = `<div class="b2i-file rise" style="--i:0">${fileHead}</div>
        <div class="dsec rise" style="--i:1"><h4>${icon('alert', 30, 2)}原因</h4><p class="b2i-lead" style="font-size:26px">这次没拿到下载链接，所以没有二维码。可以再试一次；也可以改为打印，拿纸质版带走。</p></div>
        ${rowCard({ i: 2, attrs: 'data-b2="qr-retry"', t: '再试一次', d: '重新生成这一份的二维码', vis: phoneSave(124) })}${rowCard({ i: 3, attrs: 'data-go="pii"', t: '改为打印', d: '先检查个人信息，再打一份纸质版带走', vis: UI.mfp().replace('width="620" height="600"', 'width="186" height="180"') })}
        ${remind('call', HELP, 4)}${orig}`;
      pri = { label: '再试一次', id: 'b2QrRetry' };
    } else {
      const again = f.scan ? { attrs: 'data-go="scan-type"', t: '重新扫描', d: '把原件再扫一次，生成新的扫描件', vis: UI.scanPaper(184) } : { attrs: 'data-go="my-docs"', t: '回到我的文档', d: '看看别的文件', vis: UI.stack(130, 3) };
      body = `<div class="b2i-file off rise" style="--i:0">${fileHead}<span class="chip slate">已清理</span></div>
        <div class="dsec rise" style="--i:1"><h4>${icon('erase', 30, 2)}为什么没有了</h4><p class="b2i-lead" style="font-size:26px">${f.scan ? '扫描件只留一段时间，到期按保存规则自动清理，清理后不能再生成二维码。' : '文件到了保存期限就自动清理，清理后不能再生成二维码。'}</p></div>
        ${rowCard(Object.assign({ i: 2 }, again))}${rowCard({ i: 3, attrs: 'data-go="print"', t: '回打印扫描', d: '打印、扫描、复印都从这里开始', vis: UI.mfp().replace('width="620" height="600"', 'width="186" height="180"') })}
        ${remind('call', HELP, 4)}`;
      pri = f.scan ? { label: '重新扫描', go: 'scan-type' } : { label: '回到我的文档', go: 'my-docs' };
    }
    return band({ eyebrow: (f.scan ? '扫描完成' : '我的文档') + ' · 存到手机', title: B[0], sub: B[1], sealHtml: ssQr(st), place: ' ', status: B[2] })
      + `<main class="body b2i-ss b2i-fill">${body}</main>` + dock({ ask, pri }) + nav(null);
  }
  list.push({
    id: 'scan-save', group: '打印扫描', name: '扫描件：手机扫码保存（第二批补稿）',
    notes: {
      does: '把这一份扫描件存到手机：屏上出一个限时二维码，用微信或手机浏览器扫码下载。从扫描完成屏（已登录）的「手机扫码保存」进来；我的文档里点开一份文件的「手机扫码保存」也进这一屏（换成那份文件的名字，完成回我的文档）。防后排的人隔着扫走：二维码每次只亮 60 秒，到时自动收起，原位置换成大按钮「再显示二维码」。状态 S().b2v：默认 ready；loading 正在生成；hidden 已收起；used 已有一部手机下载（是我，完成 / 不是我下载的）；used-notme 不是我下载的；expired 链接过期；error 没生成出来；gone 扫描件已清理。',
      motion: '各块依次浮入。生成中二维码位置是浅底虚线占位，不转圈。「还亮 41 秒」只改数字，到 0 换成已收起；不做倒计时演示，结果都由演示事件触发（生成好了、没生成出来、亮满 60 秒、有手机下载了、链接到期、已清理）。',
      keep: '复用 K/components/FilePreviewDialog.tsx 的扫码保存（phoneDownloadUrl + expiresAt），原句「链接短时有效，请仅在本人手机上打开」「二维码已过期，请重新生成后再扫码带走」「链接已过期，重新生成后可再扫码」。有效期读服务端给的值，不写死分钟数；下载链接只认这一次签出来的地址。60 秒是屏上显示时长，不是链接有效期；再显示二维码用的仍是同一条链接，链接过期才进 expired 重新生成。链接用过一次就失效、屏上回显「已被下载」（used）要后端配合：现有手机下载链接是否一次有效待核，核实之前不能上线 used / used-notme 两态。「不是我下载的」之后屏上写「这个二维码已作废。需要帮助？拨打服务电话 183-6916-1921」，不承诺收回已下载的文件。手机上下没下好这台机器不知道，屏上不写「已保存」。「完成」回 scan-result（已登录那一屏）。只给已登录的人用，游客在扫描完成屏先去登录。「别忘了取走扫描仪里的原件」和 scan-result「扫完请取回原件」同义，只在扫描件来路出现。二维码是示例，不能扫。服务电话号码与服务时间从后台读，读不到不显示。普通页约 3 分钟无操作清除。'
    },
    render: renderScanSave,
    mount(el) {
      const MAP = { 'b2i-qr-ready': '', 'b2i-qr-fail': 'error', 'b2i-qr-hide': 'hidden', 'b2i-qr-used': 'used', 'b2i-qr-expire': 'expired', 'b2i-file-gone': 'gone' };
      const on = (e) => { if (!(e.detail in MAP)) return; setVariant('scan-save', MAP[e.detail]); refresh(); };
      el.addEventListener('proto-demo', on);
      return () => el.removeEventListener('proto-demo', on);
    },
    demo: () => [
      { label: '演示：二维码生成好了', ev: 'b2i-qr-ready' }, { label: '演示：二维码没生成出来', ev: 'b2i-qr-fail' },
      { label: '演示：亮满 60 秒，自动收起', ev: 'b2i-qr-hide' }, { label: '演示：有一部手机下载了', ev: 'b2i-qr-used' },
      { label: '演示：链接到期', ev: 'b2i-qr-expire' }, { label: '演示：扫描件已按规则清理', ev: 'b2i-file-gone' }
    ]
  });
  (function moveAfter(id, afterId) {
    const from = list.findIndex((x) => x.id === id);
    const [item] = list.splice(from, 1);
    const at = list.findIndex((x) => x.id === afterId);
    list.splice(at < 0 ? list.length : at + 1, 0, item);
  })('scan-save', 'scan-result');
  (window.FLOWS || []).forEach((fl) => { const i = fl.ids.indexOf('scan-result'); if (i >= 0 && fl.ids.indexOf('scan-save') < 0) fl.ids.splice(i + 1, 0, 'scan-save'); });

  /* 7. my-docs：点开一行出操作层 */
  function docSheet(v) {
    const s = S();
    const id = (s.b2Doc && DOCS[s.b2Doc]) ? s.b2Doc : (v === 'row-docx' ? 'd3' : 'd1');
    const d = DOCS[id];
    const canKeep = ['system_short', 'months_3', 'months_6'].indexOf((s.feKeep && s.feKeep[id]) || d.policy) >= 0;
    const head = `<div class="b2i-dochead"><span class="b2i-ft ${d.ftc || ''}">${d.ft}</span><div class="tx"><b>${d.name}</b><small>${docMeta(id)}</small>${v !== 'row-del' && canKeep ? `<button type="button" class="b2i-keep" data-fe="retain" data-arg="${id}">改保存期限</button>` : ''}</div><button type="button" class="b2i-x" data-b2="row-close" aria-label="收起">${icon('x', 32, 2.4)}</button></div>`;
    const inner = v === 'row-del'
      ? `<div class="b2i-warn">${icon('alert', 40, 2.2)}<span>删除后找不回来</span></div><div class="b2i-opts">${opt({ cls: 'danger', attrs: 'data-b2="row-delete"', ic: 'erase', t: '确认删除' })}${opt({ attrs: 'data-b2="row-keep"', ic: 'x', t: '不删了' })}</div>`
      : `<div class="b2i-opts">${d.why ? opt({ off: 1, ic: 'printer', t: '打印这一份', d: d.why }) : opt({ cls: 'pri', attrs: 'data-go="pii"', ic: 'printer', t: '打印这一份', d: '先检查文件和个人信息' })}${opt({ attrs: `data-go="scan-save" data-b2save="${id}"`, ic: 'qr', t: '手机扫码保存', d: '把这份文件存到手机，二维码限时有效' })}${opt({ cls: 'quiet', attrs: 'data-b2="row-del"', ic: 'erase', t: '删除' })}</div>`;
    return `<div class="b2i-scrim" data-b2="row-close"></div><section class="b2i-sheet b2i-docsheet" role="dialog" aria-modal="true" aria-label="${d.name}"><div class="b2i-grab" aria-hidden="true"></div>${head}${inner}</section>`;
  }
  wrap('my-docs', (orig) => {
    const html = orig();
    const s = S();
    const v = variant('my-docs');
    if (!v || !s.logged || s.feError || s.feLoading || s.feEmpty || s.ctx === 'print') return html;
    const id = (s.b2Doc && DOCS[s.b2Doc]) ? s.b2Doc : (v === 'row-docx' ? 'd3' : 'd1');
    if (s.feGone && s.feGone[id]) return html;
    return html + docSheet(v);
  });

  /* ── 点击：本文件的按钮、作答页离开确认、我的文档行操作层；本文件管的屏上换屏时清掉变体 ── */
  const MINE = new Set(['iv-run', 'interview', 'xq', 'iv-report', 'scan-result', 'scan-save', 'my-docs']);
  function onB2(k) {
    const s = S();
    if (k === 'leave-stay') { setVariant(null, ''); delete s.b2LeaveTo; refresh(); return true; }
    if (k === 'leave-go') {
      const to = s.b2LeaveTo || 'interview';
      delete s.b2LeaveTo;
      setVariant(null, '');
      if (to === 'interview') setVariant('interview', 'running');
      else if (to === 'xq') setVariant('xq', 'iv-running');
      window.go(to);
      return true;
    }
    if (k === 'leave-end') { setVariant(null, ''); delete s.b2LeaveTo; return false; } /* 交给 fix-interview 的 data-fi="end"：先「正在生成练习报告…」 */
    if (k === 'end-use') { endUse(); return true; }
    if (k === 'row-close') { setVariant(null, ''); delete s.b2Doc; refresh(); return true; }
    if (k === 'row-del') { setVariant('my-docs', 'row-del'); refresh(); return true; }
    if (k === 'row-keep') { const id = s.b2Doc && DOCS[s.b2Doc] ? s.b2Doc : 'd1'; setVariant('my-docs', DOCS[id].why ? 'row-docx' : 'row'); refresh(); return true; }
    if (k === 'row-delete') {
      const id = s.b2Doc && DOCS[s.b2Doc] ? s.b2Doc : 'd1';
      if (!s.feDelFail) { s.feGone = Object.assign({}, s.feGone, { [id]: 1 }); s.feDelNote = 1; }
      setVariant(null, ''); delete s.b2Doc; refresh(); return true;
    }
    if (k === 'qr-retry') { setVariant('scan-save', 'loading'); refresh(); return true; }
    if (k === 'qr-show') { setVariant('scan-save', ''); refresh(); return true; }
    if (k === 'used-notme') { setVariant('scan-save', 'used-notme'); refresh(); return true; }
    return false;
  }
  function leaveTarget(t, scr) {
    const el = t.closest('button,[data-go],[data-act]');
    if (!el || !scr.contains(el) || el.closest('.b2i-sheet')) return '';
    if (el.dataset.act === 'back') return 'interview';
    if (el.classList.contains('askq')) return 'xq';
    if (el.closest('.nav') && el.dataset.go) return el.dataset.go;
    return '';
  }
  document.addEventListener('click', (e) => {
    const t = e.target && e.target.closest ? e.target : null;
    const scr = t && t.closest('.screen');
    if (!scr || scr.classList.contains('leave') || !scr.parentElement || scr.parentElement.id !== 'stage' || !MINE.has(scr.dataset.id)) return;
    const id = scr.dataset.id;
    const s = S();
    const stop = () => { e.preventDefault(); e.stopPropagation(); };
    const mine = t.closest('[data-b2],#b2QrRetry');
    if (mine && scr.contains(mine) && !mine.disabled) {
      if (onB2(mine.id === 'b2QrRetry' ? 'qr-retry' : mine.dataset.b2)) { stop(); return; }
    }
    if (id === 'iv-run' && !variant('iv-run') && ivGuard()) {
      const to = leaveTarget(t, scr);
      if (to) { stop(); s.b2LeaveTo = to; ivSample(); setVariant('iv-run', 'leave'); refresh(); return; }
    }
    if (id === 'my-docs' && !variant('my-docs') && s.ctx !== 'print') {
      const row = t.closest('.fe-open[data-fe="open"]');
      if (row && scr.contains(row) && DOCS[row.dataset.arg]) { stop(); s.b2Doc = row.dataset.arg; setVariant('my-docs', DOCS[row.dataset.arg].why ? 'row-docx' : 'row'); refresh(); return; }
    }
    if (t.closest('.b2i-sheet [data-fe]')) { setVariant(null, ''); return; } /* 层里的「改保存期限」交给 fix-me 的原弹层 */
    const save = t.closest('[data-go="scan-save"]');
    if (save && scr.contains(save)) { if (save.dataset.b2save) s.b2SaveDoc = save.dataset.b2save; else delete s.b2SaveDoc; }
    const go = t.closest('[data-go],[data-act="back"]');
    if (go && scr.contains(go) && !go.disabled) { setVariant(null, ''); if (id === 'my-docs') delete s.b2Doc; }
  }, true);

  /* ── 说明栏 ── */
  renote('iv-run', {
    does: '作答页加「离开确认」一层（S().b2v=leave）：点返回（顶栏和底栏）、底部中间问小青、底部导航，都先出这一层，不直接走。原因：运行页这三处直接离开（InterviewSessionBar.tsx:74-79 返回去 /interview-service；AssistantPage.tsx:567 问小青页没有回到这一场的入口），离开后服务台只有「马上练一场」，回不到这一场，次数照扣、时间照走。三个选项：继续作答（收起这一层，点压暗处同样）；暂时离开（时间不会停）——去刚才要去的地方：返回去练面试服务台并出「回到这一场」卡，问小青去问小青并出顶部提示条，底部导航去对应页；结束本场，生成练习报告——走原来的结束本场（本屏先「正在生成练习报告…」，演示事件 report 才去 iv-report；没有记下回答时停在「这一场还没有记下的回答」）。默认状态逐字不变。',
    motion: '这一层从下往上滑入 320ms，背后作答页压暗、题目和剩余时间看得见；剩余时间只改数字。',
    keep: '计时不暂停，屏上照实写「还剩 3:12，离开期间照常走」（数字 52px）；到点会自动结束（InterviewTimeUp.tsx），到点前提交的回答会保存（原句「报告现在生成不了。到点前提交的回答已保存，可以再试一次。」只在本场亲眼见过非跳过回答时说）。输入框里没提交的字，选「暂时离开」时留着，回来还在（interviewWorkbenchSession 已按场次存题号、剩余时间、对话，草稿要一起存）。第几题、目标题数、剩余时间读这一场的真实值；稿上直接打开这一层时用示例「第 2 题 / 目标 6 题 · 剩余 3:12」，背后作答页同步成第 2 题。时长只有 3 / 5 / 8 分钟三档。练习已过期、AI 停用、还没记下回答、时间已到这几态不出这一层（那几态本身就有出口）。'
  });
  renote('interview', {
    does: '去掉屏上两句内部说法（「进入具体服务后再确认实时能力。」「本页只负责分流，不预报在线、名额、价格或办理结果。」），原位置只留边界声明；空出来的高度给了四张小卡（每张加高、间距放宽）。新增两态：S().b2v=running 最上面多一张「回到这一场」去 iv-run，「马上练一场」退到第二位、样子和文字不变；S().b2v=timeup 那张卡换成「上一场时间到了」去 iv-report。',
    motion: '「回到这一场」卡上的圆点慢呼吸（这一场确实在计时）；剩余时间每秒改一次数字。减弱动效时圆点不动。',
    keep: '这张卡只在本人有一场没结束、或刚到点还没看报告时出现；数字（面试官、第几题、目标题数、剩余时间）都读这一场的真实值，示例「HR 面试 · 第 2 题 / 目标 6 题 · 剩余 3:12」。这两张卡在「还是你吗」确认之后才显示（进练面试服务台先过换人确认），不会把上一位的场次直接摆给下一位；换人清场后不再出现。到点那张只在本场有非跳过的回答时出现（没有回答就没有报告，运行页到点停住页 no-answers 一态照旧）。一台机器同一时间只有一场，不画多张。'
  });
  renote('xq', {
    does: 'S().b2v=iv-running：练面试还没结束时，意图带下面加一条提示条「练面试进行中 · 剩余 3:12 · 回到这一场」，整条可点，去 iv-run。默认状态逐字不变。',
    motion: '提示条随页面浮入，圆点慢呼吸，剩余时间每秒改数字。',
    keep: '只有本机本次办理里有一场没结束才出现；剩余时间读这一场的截止时刻（服务端 deadlineAt，interviewDeadline.ts）。条高 80，不小于 72。出现时四个主题卡各矮一点让位，卡里内容不变。到点或结束后不再出现。运行页问小青（AssistantPage.tsx:567）现在没有这一条。'
  });
  renote('iv-report', {
    does: '已登录时在报告页底部（底部按区上方）加一行「结束使用」，副句「退出登录，并清掉这台机器上这一次的内容。报告已存在你的账号里。」，按一下就结束、回首页。其余逐字不变。',
    motion: '无。',
    keep: '照打印完成页「结束使用」的做法（K/pages/print/PrintDonePage.tsx，endKioskUse(\'end_use\')，产品负责人 10/26 定一步结束）：结束人次 → 清本机数据 → 退出登录 → 回首页，不弹二次确认。只在已登录、报告已读到时出现；游客、读取中、报告不可用三态不加这一行（游客那句「报告已存在你的账号里」不成立）。为了放下这一行只收了空白，报告正文字号不变。'
  });
  renote('scan-result', {
    does: '下一步改成 2×2 四张：AI 简历识别 / 拿去打印 / 手机扫码保存（去 scan-save）/ 前往我的文档。游客第三张是「登录后可存到手机」（去 login），第四张照原稿「本次不进入我的文档」停用。已登录时底部按区上方加一行「结束使用」（副句「退出登录，并清掉这台机器上这一次的内容。扫描件已在你的「我的文档」里。」），按一下就结束、回首页；游客不加。',
    motion: '无。',
    keep: '游客登录后扫描件要留着，这依赖「由流程发起的登录保留草稿和文件」那一项一起做（现在登录会清掉扫描件：K/auth/AuthContext.tsx:55-64 的 clearGuestScanBeforeMemberLogin）；那一项没做之前，游客这张卡不能上线。手机扫码保存复用 K/components/FilePreviewDialog.tsx。结束使用照 PrintDonePage.tsx 一步结束（endKioskUse）。'
  });
  renote('my-docs', {
    does: '点开一份文档出一层操作层（S().b2v=row，第一行「毕业生就业推荐表.pdf」）：上面是文件信息，三个选项：打印这一份（去 pii）、手机扫码保存（去 scan-save）、删除（次要样式，点了在本层换成二次确认「删除后找不回来」，b2v=row-del）。不支持打印的格式（DOCX）「打印这一份」变灰并写「这种格式暂不支持打印」（b2v=row-docx）。默认状态逐字不变。',
    motion: '操作层从下往上滑入，背后列表压暗；二次确认在本层原地换内容。',
    keep: '原来点开一行在行内展开的「查看」「签名」「转 PDF」不在这一层里（签名默认本机暂未开通、转 PDF 暂未开放），「改保存期限」放在文件信息下面一个小按钮（打印件默认约 24 小时、本人可改 3 或 6 个月是已定的可配项，不能丢）；这几项最后放哪待定。稿上点开任何一行都出这一层，选文件打印（S().ctx=print）时仍是原来的行内展开。删除仍是两步，失败时列表还在（演示事件 delfail）。手机扫码保存复用 K/components/FilePreviewDialog.tsx。'
  });
})();
