/* fast-1112.js：少点几下（省步版）· 第 1 版（2026-11-12）
 * 说明栏「省步版」默认开；关掉就是第二批合并稿原来的走法，可以来回比。地址加 ?fast=0 默认关。
 * 只改「怎么走」：省掉的是确认式的中转屏和重复的「下一步」；屏上已定的字、合规句、要本人做决定的地方都不省。
 *   打印：首页「手机传文件」→ 文件到了且隐私检查没发现问题 → 直接到预览；预览上「打印 · 本单 0 元」直接出纸
 *         （收费点位照旧走核对价格与收银台；检查发现身份证号等照旧进材料检查逐处决定）。
 *   改简历：首页「改简历」直接到「你的简历在哪里？」（二维码就在这屏，意图带写三步：导入、出初稿、确认）；
 *         简历到了按通用诊断直接开始；优化屏「打印改好的这份」→ 打印前核对（待确认的新内容逐条定）→ 出纸。
 *   练面试：设置第 1 屏选好岗位和经验后「按下面的设置开始」，面试官、难度、时长用屏上已写明的默认值。
 * 每一处都按真实回报走：文件到了、检查结果出来了才往下走，不按时间自己跳。 */
(function () {
  'use strict';
  const S = () => window.S || {};
  const fast = () => S().mFast !== false;
  const find = (id) => (window.SCREENS || []).find((s) => s.id === id);
  const wrapRender = (id, fn) => { const d = find(id); if (!d) return; const r0 = d.render; d.render = () => { const h = r0(); return fast() ? fn(h) : h; }; };
  const wrapMount = (id, fn) => { const d = find(id); if (!d) return; const m0 = d.mount; d.mount = (el) => { const c0 = m0 ? m0(el) : null; const c1 = fast() ? fn(el) : null; return () => { if (c1) c1(); if (c0) c0(); }; }; };
  const addDemo = (id, list) => { const d = find(id); if (!d) return; const d0 = d.demo; d.demo = () => { const base = typeof d0 === 'function' ? (d0() || []) : (d0 || []); const extra = typeof list === 'function' ? list() : list; return fast() ? extra.concat(base) : base; }; };
  const onDemo = (el, fn) => { const h = (e) => fn(e.detail); el.addEventListener('proto-demo', h); return () => el.removeEventListener('proto-demo', h); };
  const ARR = '<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
  const toast = (t) => { const st = document.getElementById('stage'); if (!st) return; const d = document.createElement('div'); d.className = 'toast'; d.textContent = t;
    d.style.cssText = 'position:absolute;left:50%;bottom:300px;transform:translateX(-50%);z-index:50;max-width:900px;padding:22px 34px;border-radius:999px;background:rgba(11,36,30,.92);color:#f6f3ea;font:600 25px/1.4 var(--sans);text-align:center;animation:fadein 200ms ease both';
    st.appendChild(d); setTimeout(() => d.remove(), 3800); };

  const css = document.createElement('style');
  css.textContent = `
.m-scrim{position:absolute;inset:0;z-index:29;background:rgba(7,24,20,.6);animation:fadein 200ms ease both}
.m-sheet{position:absolute;left:0;right:0;bottom:0;z-index:30;display:flex;flex-direction:column;gap:20px;padding:20px 48px 40px;border-radius:44px 44px 0 0;background:var(--paper);box-shadow:0 -16px 48px rgba(7,24,20,.28);animation:sheetup 320ms var(--ease) both}
.m-sheet .grab{width:96px;height:8px;border-radius:4px;background:var(--line);align-self:center}
.m-sheet h2{margin:0;font:700 44px/1.3 var(--serif, var(--sans));color:var(--ink)}
.m-sheet .lead{margin:0;font-size:25px;color:var(--ink-2)}
.m-item{display:flex;flex-direction:column;gap:14px;padding:24px 28px;border-radius:26px;background:var(--card);border:1.5px solid var(--edge)}
.m-item b{font-size:27px}.m-item p{margin:0;font-size:24px;color:var(--ink-2)}.m-item p em{font-style:normal;background:#fff3c9;padding:0 6px;border-radius:6px}
.m-item .two{display:flex;gap:16px}.m-item .two button{flex:1;min-height:80px;border-radius:22px;border:2px solid var(--edge);background:#fff;font:700 25px var(--sans);color:var(--ink)}
.m-item .two button.on{background:var(--deep);border-color:var(--deep);color:#fff}
.m-sheet .acts{display:flex;gap:16px}.m-sheet .acts .btn{flex:1}
.m-sheet .fine{margin:0}
`;
  document.head.appendChild(css);

  /* ── 打印 ── */
  addDemo('upload', () => (S().ctx === 'print' ? [{ label: '演示：手机传来文件，隐私检查没发现问题', ev: 'm-clean' }, { label: '演示：手机传来文件，隐私检查发现身份证号', ev: 'm-pii' }] : []));
  wrapMount('upload', (el) => onDemo(el, (ev) => {
    if (S().ctx !== 'print') return;
    if (ev === 'm-clean') { S().fmUp = true; S().mPiiClean = true; window.go('preview'); setTimeout(() => toast('文件收到了。隐私检查没发现身份证号、手机号，直接到预览'), 360); }
    if (ev === 'm-pii') { S().fmUp = true; S().mPiiClean = false; window.go('pii'); }
  }));
  wrapRender('preview', (h) => {
    if (S().fee) return h; /* 收费点位：照旧核对价格、收银台 */
    return h.replace(/(<button class="btn pri[^"]*"[^>]*?)data-go="confirm"([^>]*>)下一步：核对价格/, '$1data-go="printing"$2打印 · 本单 0 元');
  });

  /* ── 改简历 ── */
  wrapRender('resume-src', (h) => h.replace(/<div class="rail">[\s\S]*?<\/div><\/div>(?=\s*<\/header>)|<div class="rail">(?:<div class="st[^"]*"><div class="bar"><\/div><span>[^<]*<\/span><\/div>)+<\/div>/,
    '<div class="pathline"><span class="pl-k">一共 3 步</span><span class="pl"><b>1</b>导入</span><i>→</i><span class="pl"><b>2</b>出初稿</span><i>→</i><span class="pl"><b>3</b>确认</span></div>'));
  addDemo('resume-src', [{ label: '演示：手机传来简历，按通用诊断直接开始', ev: 'm-go' }]);
  wrapMount('resume-src', (el) => {
    const b = [...el.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === '只想打印原件');
    if (b && !el.querySelector('#mMoreRs')) { const c = b.cloneNode(false); c.id = 'mMoreRs'; c.textContent = '其他简历服务'; c.removeAttribute('data-go'); c.removeAttribute('data-act'); c.setAttribute('data-go', 'resume'); b.after(c);
      const d2 = c.cloneNode(false); d2.id = 'mDirRs'; d2.textContent = '按岗位诊断'; d2.setAttribute('data-go', 'resume-direction'); c.after(d2); }
    return onDemo(el, (ev) => { if (ev === 'm-go') { S().fmUp = true; S().fmFile = true; S().fmDoc = window.FM && window.FM.resumeDoc; S().directed = false; window.go('reading'); } });
  });
  wrapRender('optimize', (h) => h.replace(/(<button class="btn pri[^"]*")([^>]*?)data-go="compare"([^>]*>)逐条看（从第 1 条）/, '$1 id="mPrintRs"$2$3打印改好的这份'));
  wrapMount('optimize', (el) => {
    const open = (e) => {
      const b = e.target.closest('#mPrintRs'); if (!b || !el.contains(b)) return;
      e.stopPropagation(); e.preventDefault();
      el.insertAdjacentHTML('beforeend', `<div class="m-scrim overlay" data-m="close"></div><div class="m-sheet overlay" role="dialog" aria-label="打印前核对">
        <i class="grab"></i><h2>打印前核对一下</h2><p class="lead">下面这一处是 AI 改写里新加的内容，核对是真的再打印；不是真的就点「回去再看」改掉。</p>
        <div class="m-item"><b>工作经历</b><p>负责学院公众号的选题、撰写和排版，<em>周更 2 篇</em></p>
          <div class="two"><button data-m="real">已核对</button></div></div>
        <p class="fine">AI 生成，仅供参考，请对照原文核对。打印默认 1 份、黑白、单面。</p>
        <div class="acts"><button class="btn sec" data-m="close">回去再看</button><button class="btn pri" id="mGoPrint" disabled>确认无误，打印 · 本单 0 元${ARR}</button></div></div>`);
    };
    const act = (e) => {
      const t = e.target.closest('[data-m]'); if (!t || !el.contains(t)) return;
      const m = t.dataset.m;
      if (m === 'close') { el.querySelectorAll('.m-scrim,.m-sheet').forEach((n) => n.remove()); return; }
      if (m === 'keep' || m === 'real') { t.parentElement.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === t)); const g = el.querySelector('#mGoPrint'); if (g) g.disabled = false; }
    };
    const goPrint = (e) => { const g = e.target.closest('#mGoPrint'); if (!g || g.disabled || !el.contains(g)) return; S().ctx = 'resume'; window.go('printing'); };
    el.addEventListener('click', open, true); el.addEventListener('click', act); el.addEventListener('click', goPrint);
    return () => { el.removeEventListener('click', open, true); el.removeEventListener('click', act); el.removeEventListener('click', goPrint); };
  });

  /* ── 练面试：设置第 1 屏直接开始（面试官、难度、时长用屏上「后面不改的话」写明的默认值；开练前的年龄等确认照旧要本人点） ── */
  wrapRender('iv-1', (h) => h.replace(/(<button class="btn pri[^"]*"[^>]*>)下一步/, '$1按下面的设置开始'));
  wrapMount('iv-1', (el) => {
    const h = (e) => {
      const b = e.target.closest('.dock .btn.pri'); if (!b || !el.contains(b) || b.disabled) return;
      e.stopPropagation(); e.preventDefault();
      /* 不跳过开练前的确认：转到设置第 3 屏并替他按「创建并开始练习」，年满 14 周岁等确认弹层照原样出来，要本人点 */
      window.go('iv-3');
      setTimeout(() => { const c = document.querySelector('#stage .screen:not(.leave)[data-id="iv-3"] .dock .btn.pri'); if (c) { window.__mSynthetic = true; try { c.click(); } finally { window.__mSynthetic = false; } } }, 60);
    };
    el.addEventListener('click', h, true);
    return () => el.removeEventListener('click', h, true);
  });

  /* ── 舞台钩子：首页两处入口改去向；说明栏开关 ── */
  function boot() {
    const stage = document.getElementById('stage'); if (!stage || !window.S) return;
    if (S().mFast === undefined) S().mFast = new URLSearchParams(location.search).get('fast') !== '0';
    /* 挂在 window 的捕获阶段：先改去向，再让第二批的游客拦截（document 捕获阶段）按新去向判断要不要先登录 */
    window.addEventListener('click', (e) => {
      if (!fast() || !e.target || !e.target.closest) return;
      const t = e.target.closest('[data-go]'); if (!t || !stage.contains(t)) return;
      const sc = t.closest('.screen'); if (!sc || sc.dataset.id !== 'home') return;
      if (t.dataset.go === 'resume') t.dataset.go = 'resume-src';
      if (t.dataset.go === 'upload' && !t.dataset.arg) t.dataset.arg = 'print';
    }, true);
    const tgl = document.querySelector('.toggles .row'); if (!tgl) return;
    const b = document.createElement('button'); b.className = 'tg'; b.id = 'tg-fast'; b.textContent = '省步版（11/12）'; b.setAttribute('aria-pressed', fast());
    b.addEventListener('click', () => { S().mFast = !fast(); b.setAttribute('aria-pressed', fast()); window.__proto.render('home'); });
    tgl.insertBefore(b, tgl.children[1] || null);
  }
  if (document.readyState === 'complete') setTimeout(boot, 5); else window.addEventListener('load', () => setTimeout(boot, 5));
})();
