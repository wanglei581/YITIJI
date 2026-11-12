/* motion-1112.js：一体机动效与少点几下 · 第 1 版（2026-11-12）
 * 依据：产品负责人 11/12 19:55 在设计窗口看过说明后回「可以，你们继续」。说明里的范围：
 *   没人用时有动画、小青主动招呼；点下去有反馈、换页有过渡；AI 改简历和出纸有跟真实进度走的动画；
 *   放纸、扫码这类操作用动画演示。底线：不做假进度；保留「减弱动效」开关。
 * 做法：只动 transform 和 opacity；全部挂在 #app.m-on 下（说明栏「动效第 1 版」，关掉就是第二批合并稿原样）。
 *   「减弱动效」沿用原稿 .reduced 规则（动画 1ms、只播一次），本文件加的元素都在舞台里，同样受管；循环动画的
 *   最后一帧都是能看懂的静止样子。
 * 不做：假进度条、假百分比、按时间自己走到下一步、打印张数（打印机不回报逐页张数，c94a589dd 源码查过）。
 * 本文件在 app.js 之前加载：先改屏定义（演示事件、渲染后处理），load 之后再挂舞台上的钩子。 */
(function () {
  'use strict';
  const S = () => window.S || {};
  const Q = new URLSearchParams(location.search);

  const css = document.createElement('style');
  css.textContent = `
/* 1 换页：意图带不动、标题淡入上移；主体按方向滑入；底部按区淡入；底部导航不动 */
.m-on .stage .screen.enter{animation:none}
.m-on .stage .screen.enter>main.body{animation:m-in-r 300ms var(--ease) both}
.m-on .stage .screen.enter.back>main.body{animation-name:m-in-l}
.m-on .stage .screen.enter>.band .ask,.m-on .stage .screen.enter>.band .greet,.m-on .stage .screen.enter>.band .rail,.m-on .stage .screen.enter>.band .pathline{animation:m-up 280ms var(--ease) both}
.m-on .stage .screen.enter>.dock{animation:m-fade 220ms ease both}
.m-on .stage .screen.enter>.standby{animation:m-fade 420ms ease both}
.m-on .stage .screen.leave{animation:m-fade-out 160ms ease-in both}
@keyframes m-in-r{from{opacity:0;transform:translateX(64px)}to{opacity:1;transform:none}}
@keyframes m-in-l{from{opacity:0;transform:translateX(-64px)}to{opacity:1;transform:none}}
@keyframes m-up{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
@keyframes m-fade{from{opacity:0}to{opacity:1}}
@keyframes m-fade-out{from{opacity:1}to{opacity:0}}

/* 2 按下反馈：原稿的按下缩放保留，另在手指落点出一圈水波（不进可点元素内部，不改布局） */
.m-touch{position:absolute;inset:0;pointer-events:none;z-index:90;overflow:hidden}
.m-rip{position:absolute;left:0;top:0;width:200px;height:200px;margin:-100px 0 0 -100px;border-radius:50%;
  background:radial-gradient(closest-side,rgba(46,230,168,.45),rgba(46,230,168,.18) 62%,rgba(46,230,168,0));animation:m-rip 480ms cubic-bezier(.2,.7,.3,1) both}
@keyframes m-rip{from{opacity:1;transform:scale(.22)}to{opacity:0;transform:scale(1.3)}}
.reduced .m-rip{display:none}

/* 3 首页：小青招呼——印章轻轻摆两下、问候一字一字出来、之后每 4 秒一圈淡淡的光 */
.m-on .greet .seal.m-wave{animation:m-wave 1.3s ease-in-out 2}
@keyframes m-wave{0%,100%{transform:rotate(0)}20%{transform:rotate(-9deg)}40%{transform:rotate(7deg)}60%{transform:rotate(-5deg)}80%{transform:rotate(3deg)}}
.m-on .greet .seal.m-breathe::before{animation:ring 4s ease-out infinite}
.m-type .ch{opacity:0;animation:m-ch 1ms linear both;animation-delay:calc(450ms + var(--k) * 60ms)}
@keyframes m-ch{to{opacity:1}}

/* 4 待机：小青半身像在右侧轻轻浮动，旁边的话每 3.5 秒换一句 */
.m-xq{position:absolute;right:44px;top:880px;width:340px;height:460px;pointer-events:none;z-index:3}
.m-xq-card{position:absolute;inset:0;border-radius:40px;overflow:hidden;background:linear-gradient(180deg,#eef0f6,#f8f8fa);
  box-shadow:0 0 0 2px rgba(46,230,168,.55),0 0 0 14px rgba(46,230,168,.1),0 30px 70px rgba(0,0,0,.45);animation:m-float 5.2s ease-in-out infinite alternate}
.m-xq-card img{position:absolute;left:50%;bottom:0;width:100%;transform:translateX(-50%)}
.m-xq-tag{position:absolute;left:18px;top:16px;padding:4px 14px;border-radius:999px;background:rgba(11,36,30,.78);color:#dff7ee;font:600 20px/1.5 var(--sans)}
@keyframes m-float{from{transform:translateY(0)}to{transform:translateY(-12px)}}
.m-say-wrap{position:absolute;right:408px;top:960px;width:330px;min-height:150px;z-index:3;pointer-events:none}
.m-say{position:absolute;left:0;right:0;top:0;padding:24px 28px;border-radius:30px 30px 6px 30px;background:#fdfbf4;color:#10291f;font:600 28px/1.45 var(--sans);
  box-shadow:0 18px 40px rgba(0,0,0,.35);opacity:0;transform:translateY(10px) scale(.97);transition:opacity 360ms ease,transform 360ms var(--ease)}
.m-say.on{opacity:1;transform:none}
.m-say small{display:block;margin-top:6px;font-size:21px;font-weight:500;color:#4c6a60}

/* 5 扫码演示：手机从二维码右边靠近、取景框里一道光扫过，再退回；收到文件后整段拿掉 */
.m-scan{position:absolute;right:-6px;top:50%;width:150px;height:250px;margin-top:-125px;pointer-events:none;animation:m-scan-move 3.6s var(--ease) infinite}
.m-scan .beam{animation:m-beam 3.6s ease-in-out infinite}
@keyframes m-scan-move{0%,12%{transform:translateX(70px) rotate(10deg);opacity:0}24%{opacity:1}40%,70%{transform:translateX(0) rotate(-6deg);opacity:1}88%,100%{transform:translateX(70px) rotate(10deg);opacity:0}}
@keyframes m-beam{0%,40%{transform:translateY(0);opacity:0}45%{opacity:1}68%{transform:translateY(92px);opacity:1}72%,100%{opacity:0;transform:translateY(92px)}}
.reduced .m-scan{animation:none;opacity:1;transform:translateX(0) rotate(-6deg)}

/* 6 放纸演示：纸从上方滑进进纸口（字朝上），循环；文字说法照运行页 PrintScanFeatureInfoPage.tsx:73 */
.m-feed .sheet{animation:m-feed 2.8s var(--ease) infinite}
.m-feed .sheet.s2{animation-delay:.35s}
@keyframes m-feed{0%{transform:translate(0,-70px);opacity:0}18%{opacity:1}55%,80%{transform:translate(0,0);opacity:1}100%{transform:translate(0,0);opacity:0}}
.m-feed .arrow{animation:m-bob 1.4s ease-in-out infinite alternate}
@keyframes m-bob{from{transform:translateY(-6px)}to{transform:translateY(6px)}}
.reduced .m-feed .sheet{opacity:1;transform:none}

/* 7 读简历：解析请求在路上时，缩略图上有一道光往下扫；不画阶段完成，不画百分比 */
.reader{position:relative}
.m-sweep{position:absolute;left:4%;right:4%;top:6%;height:90px;pointer-events:none;border-radius:14px;
  background:linear-gradient(180deg,rgba(46,230,168,0),rgba(46,230,168,.28) 60%,rgba(46,230,168,.6) 92%,rgba(46,230,168,0));animation:m-sweep 2.6s ease-in-out infinite}
@keyframes m-sweep{0%{transform:translateY(0);opacity:0}12%{opacity:1}88%{opacity:1}100%{transform:translateY(560px);opacity:0}}
.reduced .m-sweep{display:none}

/* 8 出纸：只在打印服务回报「打印中」之后出现，一张接一张从出纸口出来；不数第几张 */
.printer-wrap{position:relative}
.m-paper{position:absolute;left:50%;top:57%;width:150px;height:110px;margin-left:-75px;border-radius:6px;background:#fffef9;
  box-shadow:0 6px 16px rgba(11,36,30,.18);border:1.5px solid #d9d3c2;animation:m-out 1.9s ease-in infinite;pointer-events:none}
.m-paper.p2{animation-delay:.95s}
.m-paper::before{content:"";position:absolute;left:16px;right:30px;top:20px;height:6px;border-radius:3px;background:#cfd8d3;box-shadow:0 16px 0 #dfe5e1,0 32px 0 #dfe5e1,0 48px 0 #dfe5e1}
@keyframes m-out{0%{transform:translateY(-36px) scaleY(.2);opacity:0}25%{opacity:1}70%{transform:translateY(70px) scaleY(1);opacity:1}100%{transform:translateY(120px);opacity:0}}
.reduced .m-paper.p2{display:none}
.reduced .m-paper{opacity:1;transform:translateY(70px)}

/* 9 说明栏：点按计数 */
.m-count{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:10px 14px;border-radius:12px;background:#0f2a23;border:1px solid #23493e;color:#cfeee2;font-size:14px;line-height:1.5}
.m-count b{font:700 22px/1 var(--sans);color:#4ff0b9;min-width:1.4em;text-align:center}
.m-count .m-k{color:#8fb9aa}
`;
  document.head.appendChild(css);

  /* ───── 屏定义：出纸屏加「服务端回报：打印中」这件演示事件（运行页 PrintProgressPage 按服务端状态切换） ───── */
  const byIdLate = (id) => (window.SCREENS || []).find((s) => s.id === id);
  (function patchPrinting() {
    const d = byIdLate('printing'); if (!d) return;
    const r0 = d.render, m0 = d.mount, demo0 = d.demo || [];
    d.render = () => {
      let h = r0();
      if (!S().mPrinting) return h;
      h = h.replace('<h1>正在确认任务状态</h1>', '<h1>正在出纸</h1>')
        .replace('任务已提交，正在读取终端状态，请留在机器旁', '打印服务已回报「打印中」，纸从出纸口出来，请留在机器旁')
        .replace(/>正在确认任务状态</g, '>打印中<');
      h = h.replace(/<div class="s now"><span class="n">2<\/span><b>排队等待<\/b><em>确认中<\/em>/, '<div class="s on"><span class="n">2</span><b>排队等待</b><em>完成</em>')
        .replace(/<div class="s"><span class="n">3<\/span><b>打印中<\/b><em>未开始<\/em>/, '<div class="s now"><span class="n">3</span><b>打印中</b><em>进行中</em>');
      return h;
    };
    d.demo = [{ label: '演示：服务端回报「打印中」', ev: 'm-printing' }].concat(demo0);
    d.mount = (el) => {
      const c0 = m0 ? m0(el) : null;
      const on = (e) => { if (e.detail === 'm-printing') { S().mPrinting = true; window.__proto.refresh(); } };
      el.addEventListener('proto-demo', on);
      return () => { el.removeEventListener('proto-demo', on); if (c0) c0(); };
    };
  })();

  /* ───── 舞台钩子（app.js 跑完之后） ───── */
  function boot() {
    const app = document.getElementById('app'), stage = document.getElementById('stage');
    if (!app || !stage || !window.__proto) return;
    if (Q.get('m') !== '0') app.classList.add('m-on');

    /* 说明栏开关与计数 */
    const row = document.createElement('div'); row.className = 'row';
    row.innerHTML = `<button class="tg" id="tg-m" aria-pressed="${app.classList.contains('m-on')}">动效第 1 版（11/12）</button>
      <div class="m-count" id="mCount"><span class="m-k">从首页起，屏上点了</span><b id="mTaps">0</b><span class="m-k">下</span><span class="m-k" id="mPath"></span></div>`;
    const tgl = document.querySelector('.toggles');
    if (tgl) tgl.insertBefore(row, tgl.firstChild);
    document.getElementById('tg-m').addEventListener('click', (e) => { const on = app.classList.toggle('m-on'); e.currentTarget.setAttribute('aria-pressed', on); });

    const touch = document.createElement('div'); touch.className = 'm-touch'; stage.appendChild(touch);
    const HIT = 'button,[data-go],[data-act],input,label,.slab,.task,.tile,.choice,.persona,.cat,.gi';
    let taps = 0, trail = [];
    const setCount = () => { const b = document.getElementById('mTaps'); if (b) b.textContent = taps; const p = document.getElementById('mPath'); if (p) p.textContent = trail.length ? '· ' + trail.slice(-6).join(' → ') : ''; };
    stage.addEventListener('pointerdown', (e) => {
      const t = e.target.closest(HIT); if (!t || !stage.contains(t)) return;
      if (!app.classList.contains('m-on')) return;
      const r = stage.getBoundingClientRect(), k = r.width / 1080;
      const d = document.createElement('i'); d.className = 'm-rip';
      d.style.left = ((e.clientX - r.left) / k) + 'px'; d.style.top = ((e.clientY - r.top) / k) + 'px';
      touch.appendChild(d); setTimeout(() => d.remove(), 520);
    }, true);
    stage.addEventListener('click', (e) => {
      if (window.__mSynthetic) return; /* 省步版替人按的不算 */
      const t = e.target.closest(HIT); if (!t || !stage.contains(t) || t.disabled) return;
      if (t.closest('.nav')) return; /* 底部导航不算办事步数 */
      taps += 1;
      const lab = (t.getAttribute('aria-label') || t.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 10);
      if (lab) trail.push(lab);
      setCount();
    }, true);

    /* 每次换屏或刷新后，按屏号补动效元素 */
    let greeted = false, lastId = null;
    const typeOut = (p) => {
      if (!p || p.dataset.mTyped) return; p.dataset.mTyped = '1';
      const txt = p.textContent; p.classList.add('m-type');
      p.innerHTML = [...txt].map((c, i) => `<span class="ch" style="--k:${i}">${c}</span>`).join('');
    };
    const PHONE = `<svg class="m-scan" viewBox="0 0 150 250" aria-hidden="true"><rect x="10" y="6" width="130" height="238" rx="24" fill="#10291f"/><rect x="20" y="30" width="110" height="180" rx="10" fill="#e9f7f1"/>
      <path d="M38 52h18M38 52v18M112 52H94M112 52v18M38 188h18M38 188v-18M112 188H94M112 188v-18" stroke="#1f9e86" stroke-width="5" fill="none" stroke-linecap="round"/>
      <rect class="beam" x="34" y="66" width="82" height="6" rx="3" fill="#2ee6a8"/><circle cx="75" cy="228" r="7" fill="#2a4a40"/></svg>`;
    const FEED = (w, mini) => `<svg class="m-feed" viewBox="0 0 360 290" width="${w}" aria-hidden="true">
      <rect x="40" y="120" width="280" height="130" rx="22" fill="#d6dcd8"/><rect x="40" y="120" width="280" height="40" rx="18" fill="#c3cbc6"/>
      <path d="M70 120l40-42h140l40 42z" fill="#e7ebe8" stroke="#b6bfba" stroke-width="2"/><rect x="96" y="200" width="168" height="10" rx="5" fill="#1f5a4b"/>
      <g class="sheet"><path d="M120 34h120l16 50H104z" fill="#fffef9" stroke="#cfc8b6" stroke-width="2"/><path d="M128 48h76M126 58h96M124 68h70" stroke="#9fb3aa" stroke-width="4" stroke-linecap="round"/></g>
      <g class="sheet s2"><path d="M120 34h120l16 50H104z" fill="#fffef9" stroke="#cfc8b6" stroke-width="2"/><path d="M128 48h76M126 58h96M124 68h70" stroke="#9fb3aa" stroke-width="4" stroke-linecap="round"/></g>
      <g class="arrow"><path d="M300 22v40" stroke="#1f9e86" stroke-width="7" stroke-linecap="round"/><path d="M286 50l14 16 14-16" fill="none" stroke="#1f9e86" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/></g>
      ${mini ? '' : '<text x="180" y="282" text-anchor="middle" font-size="24" font-weight="700" fill="#1f5a4b">字朝上，放进上方进纸口</text>'}</svg>`;

    function decorate() {
      const el = stage.querySelector('.screen:not(.leave)'); if (!el) return;
      const id = el.dataset.id;
      if (id === 'home' || id === 'standby' || id === 'cleared') { if (id !== lastId) { taps = 0; trail = []; setCount(); } }
      if (id === 'standby' || id === 'cleared') { greeted = false; S().mPrinting = false; }
      lastId = id;
      if (id !== 'printing') S().mPrinting = false;

      if (id === 'home') {
        const seal = el.querySelector('.greet .seal');
        if (seal && !seal.classList.contains('m-breathe')) {
          seal.classList.add('m-breathe');
          if (!greeted) { seal.classList.add('m-wave'); typeOut(el.querySelector('.greet p')); greeted = true; }
        }
      }
      if (id === 'standby') {
        const sb = el.querySelector('.standby');
        if (sb && !sb.querySelector('.m-xq')) {
          sb.insertAdjacentHTML('beforeend', `<div class="m-xq" aria-hidden="true"><div class="m-xq-card"><img src="xq-figure.webp" alt=""><span class="m-xq-tag">小青 · AI 顾问</span></div></div>
            <div class="m-say-wrap" aria-live="polite"><div class="m-say on">${greetWord()}，我是小青<small>想改简历、练面试，都可以找我</small></div><div class="m-say">带上简历来，<br>当场帮你看改法<small>打印、扫描材料也在这台机器上</small></div><div class="m-say">轻触屏幕，<br>我们就开始<small>不用排队，也不用找人</small></div></div>`);
          const says = [...sb.querySelectorAll('.m-say')]; let k = 0;
          const tm = setInterval(() => { if (!sb.isConnected) { clearInterval(tm); return; } if (document.getElementById('app').classList.contains('reduced')) return; says[k].classList.remove('on'); k = (k + 1) % says.length; says[k].classList.add('on'); }, 3500);
        }
      }
      if (id === 'upload' || id === 'phone-upload' || id === 'phone-login' || id === 'scan-save') {
        const box = el.querySelector('.qr-card.waiting .qr-box') || el.querySelector('.qr-box');
        if (box && !box.querySelector('.m-scan') && !S().fmUp) { box.style.position = 'relative'; box.insertAdjacentHTML('beforeend', PHONE.replace('class="m-scan"', 'class="m-scan" style="right:-170px"')); }
      }
      if (id === 'scan-guide') {
        const body = el.querySelector(':scope > main.body'); const art = [...(body ? body.querySelectorAll('svg') : [])].filter((s) => s.getBoundingClientRect().width > 120).sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width)[0];
        if (art && !el.querySelector('.m-feed')) { const w = Math.round(art.getBoundingClientRect().width / (stage.getBoundingClientRect().width / 1080)); art.outerHTML = FEED(Math.max(260, w)); }
      }
      if (id === 'copy') {
        const s1 = [...el.querySelectorAll(':scope > main.body *')].find((n) => n.children.length === 0 && /^放原件$/.test((n.textContent || '').trim()));
        const row1 = s1 && s1.closest('div');
        if (row1 && !el.querySelector('.m-feed')) { row1.style.position = 'relative'; row1.insertAdjacentHTML('beforeend', `<span style="position:absolute;right:6px;top:-6px;width:150px">${FEED(150, 1)}</span>`); }
      }
      if (id === 'reading') {
        const rd = el.querySelector('.reader');
        if (rd && !rd.querySelector('.m-sweep')) rd.insertAdjacentHTML('beforeend', '<i class="m-sweep" aria-hidden="true"></i>');
      }
      if (id === 'printing' && S().mPrinting) {
        const pw = el.querySelector('.printer-wrap');
        if (pw && !pw.querySelector('.m-paper')) pw.insertAdjacentHTML('beforeend', '<i class="m-paper" aria-hidden="true"></i><i class="m-paper p2" aria-hidden="true"></i>');
      }
    }
    function greetWord() { const h = new Date().getHours(); return h < 11 ? '上午好' : h < 13 ? '中午好' : h < 18 ? '下午好' : '晚上好'; }
    let raf = 0;
    new MutationObserver(() => { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; decorate(); }); }).observe(stage, { childList: true, subtree: true });
    decorate();
    window.__motion = { decorate, taps: () => taps };
  }
  if (document.readyState === 'complete') setTimeout(boot, 0); else window.addEventListener('load', () => setTimeout(boot, 0));
})();
