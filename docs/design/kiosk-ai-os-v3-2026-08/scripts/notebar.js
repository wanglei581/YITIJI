/* ============================================================
   V3 · 信息与边界条（Notebar）· 事件委托 + 声明式标记
   ------------------------------------------------------------
   页面只需要写标记，开合 / 无障碍 / Esc / 点外部收起 全部由本文件负责：

     <div class="nb-bar" data-notebar>
       <button type="button" class="nb-sum">
         <svg class="ic"><use href="#i-shield"/></svg>
         <span class="nb-sum-t">信息与边界 · 隐私 · 来源口径</span>
         <span class="nb-x">展开</span>
         <svg class="ic nb-cue"><use href="#i-chevron"/></svg>
       </button>
       <div class="nb-body" hidden>
         <div class="nb-sec"><div class="nb-h">合规边界</div><p class="nb-p">…</p></div>
         …
       </div>
     </div>

   .nb-sum 也可以是 <div>；那样本文件会补 role="button" + tabindex="0"，
   并接管 Enter / Space。用 <button> 更省事，也天然满足 48px 触控判定。

   ── 收起态口径（硬约束）──────────────────────────────────────
   收起 = 给 .nb-body 加 [hidden]（base.css: display:none !important）。
   不用 height:0 / opacity:0 / visibility:hidden —— 那些写法矩形不为 0，
   审计器会把面板里的说明当成"页面上可见的常驻文字"，等于没收起。

   ── 与四态机制（stage.js 的 data-when / data-at）的关系 ──────────
   applyVisibility() 也用 hidden，但它只动带 data-when/data-at/data-pay/data-job
   的元素。因此：**不要**给 .nb-body 本身加这些属性（会互相覆盖）；
   需要分态显示的说明，把属性写在面板内部的 .nb-sec 上，两套机制互不打架。

   ── 面板高度 ────────────────────────────────────────────────
   CSS 给上限 560px；打开时本文件按"横条上沿到内容区天花板"的实际可用空间
   再收紧一次，写进 --nb-max。天花板依次取：
     [data-nb-ceiling] → .topbar → .ph-top → .screen 顶边
   舞台整体 transform:scale() 会让 getBoundingClientRect 返回缩放后的像素，
   所以测量结果要先除以缩放比，才是 1080×1920 下的布局像素。

   API（window.v3Notebar）：
     open(t) / close(t) / toggle(t) / closeAll() / isOpen(t) / refresh()
     t 可以是元素、选择器字符串，或省略（取页面第一条）。
   事件：横条上派发 'nb:toggle'，detail = { open: Boolean }。
   ============================================================ */
;(function (window, document) {
  'use strict';

  var SEL_BAR = '[data-notebar]';
  var SEL_SUM = '.nb-sum';
  var SEL_BODY = '.nb-body';
  var uid = 0;

  function closest(node, selector) {
    while (node && node.nodeType === 1) {
      if (node.matches ? node.matches(selector)
        : node.msMatchesSelector && node.msMatchesSelector(selector)) return node;
      node = node.parentElement;
    }
    return null;
  }

  function bars() {
    return Array.prototype.slice.call(document.querySelectorAll(SEL_BAR));
  }

  /** t: 元素 / 选择器 / 省略 —— 统一解析成一条横条 */
  function resolve(t) {
    if (!t) return document.querySelector(SEL_BAR);
    if (typeof t === 'string') {
      var el = document.querySelector(t);
      return el ? (closest(el, SEL_BAR) || el.querySelector(SEL_BAR) || el) : null;
    }
    if (t.nodeType === 1) return closest(t, SEL_BAR) || t;
    return null;
  }

  function sumOf(bar) { return bar && bar.querySelector(SEL_SUM); }
  function bodyOf(bar) { return bar && bar.querySelector(SEL_BODY); }
  function isOpen(bar) { return !!bar && bar.getAttribute('data-nb-open') === '1'; }

  /* 舞台缩放比：1080×1920 舞台被 scale() 塞进窗口，量出来的是屏幕像素 */
  function stageScale() {
    var st = document.querySelector('.stage');
    var s = (st && st.offsetHeight) ? st.getBoundingClientRect().height / st.offsetHeight : 1;
    return (!s || !isFinite(s) || s <= 0) ? 1 : s;
  }

  /* 面板可用高度：横条上沿 → 内容区天花板，减一点呼吸；再与 CSS 上限取小 */
  function clampHeight(bar, body) {
    var host = closest(bar, '.screen') || document.body;
    var ceiling =
      host.querySelector('[data-nb-ceiling]') ||
      host.querySelector('.topbar') ||
      host.querySelector('.ph-top');
    var sc = stageScale();
    var topPx = ceiling
      ? ceiling.getBoundingClientRect().bottom
      : host.getBoundingClientRect().top;
    var avail = (bar.getBoundingClientRect().top - topPx) / sc - 22;
    /* CSS 里的默认上限（560px）由 --nb-max 的初始值给出；这里只做"再收紧" */
    var cap = parseFloat(
      window.getComputedStyle(bar).getPropertyValue('--nb-max')
    ) || 560;
    var max = Math.floor(Math.min(cap, avail));
    if (!isFinite(max) || max < 160) max = 160;
    body.style.setProperty('--nb-max', max + 'px');
  }

  function setState(bar, open) {
    var sum = sumOf(bar);
    var body = bodyOf(bar);
    if (!bar || !body) return;

    if (open) clampHeight(bar, body);

    /* 收起只用 hidden —— 见文件头「收起态口径」 */
    body.hidden = !open;
    bar.setAttribute('data-nb-open', open ? '1' : '0');
    if (sum) {
      sum.setAttribute('aria-expanded', open ? 'true' : 'false');
      var x = sum.querySelector('.nb-x');
      if (x) x.textContent = open ? '收起' : '展开';
    }

    if (typeof window.CustomEvent === 'function') {
      bar.dispatchEvent(new window.CustomEvent('nb:toggle', {
        bubbles: true, detail: { open: !!open }
      }));
    }
  }

  function open(t) { var b = resolve(t); if (b) setState(b, true); }
  function close(t) { var b = resolve(t); if (b) setState(b, false); }
  function toggle(t) { var b = resolve(t); if (b) setState(b, !isOpen(b)); }
  function closeAll() {
    bars().forEach(function (b) { if (isOpen(b)) setState(b, false); });
  }

  /* 声明式初始化：补 id / aria / 非 button 时的键盘可达性 */
  function refresh() {
    bars().forEach(function (bar) {
      var sum = sumOf(bar);
      var body = bodyOf(bar);
      if (!sum || !body) return;
      if (bar.getAttribute('data-nb-ready') === '1') return;

      uid += 1;
      if (!sum.id) sum.id = 'nb-sum-' + uid;
      if (!body.id) body.id = 'nb-body-' + uid;

      sum.setAttribute('aria-controls', body.id);
      sum.setAttribute('aria-expanded', isOpen(bar) ? 'true' : 'false');
      if (sum.tagName.toLowerCase() !== 'button') {
        if (!sum.getAttribute('role')) sum.setAttribute('role', 'button');
        if (!sum.hasAttribute('tabindex')) sum.setAttribute('tabindex', '0');
      }
      body.setAttribute('role', 'region');
      body.setAttribute('aria-labelledby', sum.id);

      if (!bar.hasAttribute('data-nb-open')) bar.setAttribute('data-nb-open', '0');
      /* 默认收起：即使页面忘了写 hidden，也强制回到收起态 */
      if (!isOpen(bar)) body.hidden = true;

      bar.setAttribute('data-nb-ready', '1');
    });
  }

  /* ---------- 事件委托：一处监听，管所有横条 ---------- */
  document.addEventListener('click', function (e) {
    var hit = closest(e.target, SEL_SUM + ',[data-nb-toggle]');
    if (hit && closest(hit, SEL_BAR)) {
      e.preventDefault();
      toggle(hit);
      return;
    }
    /* 点面板内部不收起；点面板外任意处收起 */
    if (!closest(e.target, SEL_BAR)) closeAll();
  }, false);

  /* .nb-sum 若不是 <button>，Enter / Space 也要能开合 */
  document.addEventListener('keydown', function (e) {
    var key = e.key || e.keyCode;
    if (key === 'Escape' || key === 'Esc' || key === 27) {
      closeAll();
      return;
    }
    if (key !== 'Enter' && key !== ' ' && key !== 'Spacebar' && key !== 13 && key !== 32) return;
    var hit = closest(e.target, SEL_SUM + ',[data-nb-toggle]');
    if (!hit || hit.tagName.toLowerCase() === 'button') return;
    if (!closest(hit, SEL_BAR)) return;
    e.preventDefault();
    toggle(hit);
  }, false);

  /* 窗口尺寸变化 → 舞台缩放变化 → 已展开的面板重算高度上限 */
  window.addEventListener('resize', function () {
    bars().forEach(function (b) {
      if (isOpen(b)) clampHeight(b, bodyOf(b));
    });
  }, false);

  window.v3Notebar = {
    open: open,
    close: close,
    toggle: toggle,
    closeAll: closeAll,
    isOpen: function (t) { return isOpen(resolve(t)); },
    refresh: refresh
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', refresh, false);
  } else {
    refresh();
  }
}(window, document));
