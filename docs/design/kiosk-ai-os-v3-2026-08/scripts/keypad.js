/* ============================================================
   V3 · 屏幕软键盘（一体机没有物理键盘）
   ------------------------------------------------------------
   为什么要有这个文件：
     全站此前没有任何软键盘组件。一体机是 27 寸竖屏触控，机身不带键盘，
     于是「自定义页码」「关键词搜索」「说一句你的处境」这些输入框在真机上
     根本没法填 —— 页面画了输入框，用户却打不出字，是比按钮无反应更硬的断点。

   设计取舍：
     1) 纯事件委托。聚焦或点中 input[type=text|search|number]、textarea、
        或任意 [data-keypad] 元素就弹，页面 DOM 一行不用改。
     2) 两套布局：数字键（页码 / 份数 / 手机号）与 26 键。
        按 data-keypad → type → inputmode 依次判定。
     3) 中文不做拼音候选。真机上拼音候选由 Windows 系统输入法提供，
        原型造一套假候选只会让人以为这是我们实现的能力（CLAUDE.md §9）。
        键盘上直接标注这一点，只演示布局与尺寸。
     4) 键 ≥64×64px（实际 76/84px），弹出时把输入框滚到键盘上方，
        并在键盘头部同步回显当前值 —— 万一那一栏滚不动，用户仍看得见自己打了什么。

   API（window.v3Keypad）：
     open(el)          为指定元素弹出键盘
     close(commit)     关闭；commit=true 时补发 change
     isOpen()          是否打开
     field()           当前绑定的输入元素
     layoutFor(el)     返回 'num' | 'text'

   自检口径：关闭态 hidden（display:none），一切矩形为 0，
   stage.js 与 audit-plus.js 的检查全部跳过；打开态键高 ≥76px、
   不设 overflow:hidden、类名不含 audit-plus 的 [class*=] 命中词。
   ============================================================ */
;(function (window, document) {
  'use strict';

  if (window.v3Keypad) { return; }

  var screen = document.querySelector('.screen');

  /* ---------- 布局定义 ----------
     字符串 = 直接上屏的字符；对象 = 功能键。
     w 是横向权重（flex-grow），用来让 空格 / 确定 占多格又不破坏对齐。 */
  var NUM_ROWS = [
    ['1', '2', '3', { t: '退格', fn: 'back', c: 'fn' }],
    ['4', '5', '6', { t: '清除', fn: 'clear', c: 'fn' }],
    ['7', '8', '9', { t: '-', ch: '-' }],
    [{ t: '，', ch: ',' }, '0', { t: '确定', fn: 'ok', c: 'ok', w: 2 }]
  ];

  var TEXT_ROWS = [
    { pad: 0, keys: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'] },
    { pad: 0, keys: ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'] },
    { pad: 2, keys: ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'] },
    { pad: 2, keys: ['z', 'x', 'c', 'v', 'b', 'n', 'm', { t: '退格', fn: 'back', c: 'fn', w: 2 }] },
    { pad: 0, keys: [
      { t: '清除', fn: 'clear', c: 'fn', w: 2 },
      { t: '空格', ch: ' ', c: 'fn', w: 6 },
      { t: '确定', fn: 'ok', c: 'ok', w: 2 }
    ] }
  ];

  var HINT = {
    num: '数字键盘 · 页码用 - 连成范围，用 ，分隔多段',
    text: '中文由真机系统输入法提供拼音候选，此处只演示布局与尺寸'
  };

  var pad = null;
  var echoEl, lblEl, hintEl, bodyEl;
  var field = null;
  var layout = '';
  var open = false;
  var openedAt = 0;

  function navHeight () {
    var nav = screen && screen.querySelector('.navbar');
    return nav ? nav.offsetHeight : 0;
  }

  /* 舞台会整体 scale() 塞进浏览器窗口；getBoundingClientRect 是缩放后的屏幕像素，
     scrollTop 是布局像素，两者不能直接相减（stage.js 的触控检查踩过同一个坑）。 */
  function stageScale () {
    var st = document.querySelector('.stage');
    var s = st && st.offsetHeight ? st.getBoundingClientRect().height / st.offsetHeight : 1;
    return (!s || !isFinite(s) || s <= 0) ? 1 : s;
  }

  function esc (s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function layoutFor (el) {
    var want, type, mode;
    if (!el) { return 'text'; }
    want = String(el.getAttribute('data-keypad') || '').toLowerCase();
    if (want === 'num' || want === 'number' || want === 'numeric') { return 'num'; }
    if (want === 'text' || want === 'abc') { return 'text'; }
    type = el.tagName === 'INPUT' ? String(el.getAttribute('type') || 'text').toLowerCase() : '';
    if (type === 'number' || type === 'tel') { return 'num'; }
    mode = String(el.getAttribute('inputmode') || '').toLowerCase();
    if (mode === 'numeric' || mode === 'decimal' || mode === 'tel') { return 'num'; }
    return 'text';
  }

  function labelFor (el) {
    var l = el.getAttribute('aria-label') ||
      el.getAttribute('placeholder') ||
      el.getAttribute('data-keypad-label') || '';
    var wrap;
    if (!l) {
      wrap = el.closest('label');
      if (wrap) { l = (wrap.textContent || '').replace(/\s+/g, ' ').replace(/^ | $/g, ''); }
    }
    l = String(l);
    return l.length > 18 ? l.substring(0, 17) + '…' : (l || '正在输入');
  }

  /* ---------- DOM ---------- */
  function keyHtml (k) {
    var cls = 'kio-key';
    var t, attrs;
    if (typeof k === 'string') {
      t = k;
      attrs = ' data-ch="' + esc(k) + '"';
    } else {
      t = k.t;
      if (k.c) { cls += ' kio-key--' + k.c; }
      if (k.w) { cls += ' kio-key--w' + k.w; }
      if (k.fn) { attrs = ' data-fn="' + esc(k.fn) + '"'; }
      else { attrs = ' data-ch="' + esc(k.ch == null ? k.t : k.ch) + '"'; }
    }
    return '<button type="button" class="' + cls + '"' + attrs + '>' + esc(t) + '</button>';
  }

  function rowsHtml (rows, kind) {
    var html = '';
    var i, j, r, keys, cls;
    for (i = 0; i < rows.length; i += 1) {
      r = rows[i];
      keys = kind === 'num' ? r : r.keys;
      cls = 'kio-keys';
      if (kind === 'text' && r.pad) { cls += ' kio-keys--in' + r.pad; }
      html += '<div class="' + cls + '">';
      for (j = 0; j < keys.length; j += 1) { html += keyHtml(keys[j]); }
      html += '</div>';
    }
    return html;
  }

  function build () {
    if (pad) { return; }
    pad = document.createElement('div');
    pad.className = 'kio-pad';
    pad.id = 'kio-pad';
    pad.hidden = true;
    pad.setAttribute('role', 'group');
    pad.setAttribute('aria-label', '屏幕键盘');
    pad.innerHTML =
      '<div class="kio-pad-hd">' +
        '<span class="kio-pad-lbl"></span>' +
        '<span class="kio-pad-echo" data-empty="（还没有输入）"></span>' +
        '<span class="kio-pad-hint"></span>' +
      '</div>' +
      '<div class="kio-pad-bd"></div>';
    (screen || document.body).appendChild(pad);
    lblEl = pad.querySelector('.kio-pad-lbl');
    echoEl = pad.querySelector('.kio-pad-echo');
    hintEl = pad.querySelector('.kio-pad-hint');
    bodyEl = pad.querySelector('.kio-pad-bd');

    /* 按下不夺焦点：输入框要保持"正在输入"的视觉与光标位置。
       只拦 mousedown —— 触屏上 touchstart 会合成 mousedown，拦这一层就够；
       拦 touchstart 反而会连 click 一起吃掉。 */
    pad.addEventListener('mousedown', function (e) { e.preventDefault(); }, false);
    pad.addEventListener('click', onKeyClick, false);
  }

  function renderLayout (kind) {
    if (layout === kind) { return; }
    layout = kind;
    pad.className = 'kio-pad' + (kind === 'num' ? ' kio-pad--num' : '');
    bodyEl.innerHTML = rowsHtml(kind === 'num' ? NUM_ROWS : TEXT_ROWS, kind);
    hintEl.textContent = HINT[kind];
  }

  /* ---------- 取值 / 写值 ----------
     [data-keypad] 也可能挂在非表单元素上（原型里的假输入行），所以两条路都走。 */
  function readVal (el) {
    return el && el.value != null ? String(el.value) : String((el && el.textContent) || '');
  }

  function writeVal (el, v) {
    if (!el) { return; }
    if (el.value != null) { el.value = v; } else { el.textContent = v; }
  }

  function fire (el, type) {
    var ev;
    try {
      ev = new Event(type, { bubbles: true });
    } catch (err) {
      ev = document.createEvent('Event');
      ev.initEvent(type, true, false);
    }
    el.dispatchEvent(ev);
  }

  function setVal (v) {
    if (!field) { return; }
    writeVal(field, v);
    echoEl.textContent = v.length > 42 ? '…' + v.substring(v.length - 41) : v;
    fire(field, 'input');
  }

  function onKeyClick (e) {
    var k = e.target.closest ? e.target.closest('.kio-key') : null;
    var ch, fn, v;
    if (!k || !field) { return; }
    e.preventDefault();
    ch = k.getAttribute('data-ch');
    fn = k.getAttribute('data-fn');
    v = readVal(field);
    if (fn === 'back') { setVal(v.substring(0, v.length - 1)); return; }
    if (fn === 'clear') { setVal(''); return; }
    if (fn === 'ok') { close(true); return; }
    if (ch != null) { setVal(v + ch); }
  }

  /* 把输入框滚到键盘上方。滚的是它自己所在的滚动容器（多为 .main / .work），
     不动窗口 —— 舞台是缩放的，动窗口会把整块舞台推走。
     两点刻意为之：
       · 不要求容器"当前已经溢出"。内容正好填满时也滚不动，那种情况先临时垫一段
         底部内边距造出余量，关闭时还原。
       · 只认 auto / scroll，**不认 hidden**。hidden 容器程序上也能 scrollTop，
         但那会把上方内容推到视口外，自检要按硬缺陷报 —— 见 floatAbove()。 */
  function scrollHost (el) {
    var node = el.parentElement;
    var cs;
    while (node && node !== document.body) {
      try { cs = window.getComputedStyle(node); } catch (err) { return null; }
      if (/auto|scroll/.test(cs.overflowY || '')) { return node; }
      node = node.parentElement;
    }
    return null;
  }

  var padded = null;      // 被垫过内边距的容器
  var paddedPrev = '';    // 它原来的行内 padding-bottom

  function unpad () {
    if (!padded) { return; }
    padded.style.paddingBottom = paddedPrev;
    padded = null; paddedPrev = '';
  }

  function covered () {
    var sc = stageScale();
    return (field.getBoundingClientRect().bottom - pad.getBoundingClientRect().top) / sc;
  }

  /* 兜底：滚不动就把键盘浮到输入行**上方**。
     P25 顾问驾驶舱的输入条挂在 .pane--grow 底部，整条祖先链全是 overflow:hidden、
     没有一格可滚的余量。硬滚 hidden 容器能顶上去，但会把上面的对话内容推到视口外，
     自检立刻按"视口外"报硬缺陷 —— 那是用一个真缺陷换一个假达标。
     把键盘挪开不动页面，才是零副作用的解法。 */
  function floatAbove () {
    var sc = stageScale();
    var scRect = (screen || document.body).getBoundingClientRect();
    var fTop = (field.getBoundingClientRect().top - scRect.top) / sc;
    var padH = pad.offsetHeight;
    var bottom = (scRect.height / sc) - fTop + 12;
    if (fTop - padH - 12 < 0) { return false; }   // 上面也放不下，维持底部停靠
    pad.style.bottom = bottom + 'px';
    return true;
  }

  function reveal () {
    var need, box, room, extra, cs;
    if (!field || !pad) { return; }
    need = covered() + 24;                // 布局像素：还差多少才不被键盘压住
    if (need <= 0) { return; }

    box = scrollHost(field);
    if (box) {
      room = box.scrollHeight - box.clientHeight - box.scrollTop;
      extra = need - room;
      if (extra > 0) {
        /* 容器本身没溢出（内容刚好填满）时滚不动 —— 先临时垫一段底部内边距，
           关闭时还原。P25 之外的页面多数走这一支。 */
        unpad();
        cs = window.getComputedStyle(box);
        padded = box;
        paddedPrev = box.style.paddingBottom;
        box.style.paddingBottom = ((parseFloat(cs.paddingBottom) || 0) + extra + 8) + 'px';
      }
      box.scrollTop += need;
      if (covered() <= 0) { return; }
    }
    floatAbove();
  }

  function openPad (el) {
    if (!el) { return; }
    /* 一次点按会走 focusin → click 两条路，两条都调本函数。
       已经为同一个框开着就直接返回，免得 reveal() 排两次、停靠位置来回跳。 */
    if (open && field === el) { return; }
    build();
    if (field && field !== el) { field.classList.remove('kio-typing'); }
    field = el;
    renderLayout(layoutFor(el));
    lblEl.textContent = labelFor(el);
    echoEl.textContent = readVal(el);
    pad.style.setProperty('--kio-navh', navHeight() + 'px');
    pad.style.bottom = '';                // 先回到底部停靠，reveal() 再决定要不要浮到输入行上方
    if (window.v3Help && window.v3Help.isOpen()) { window.v3Help.close(); }
    pad.hidden = false;
    open = true;
    openedAt = (window.Date.now ? Date.now() : +new Date());
    field.classList.add('kio-typing');
    document.addEventListener('keydown', onKey, false);
    /* 延到 180ms 之后再滚，不能用 setTimeout(0)：
       一次点按是 mousedown → mouseup → click，click 的目标取按下与抬起的公共祖先。
       如果在这中间把内容滚走了，抬手就落在别的元素上，click 目标退化成 .screen ——
       25-advisor 实测就是这么被自己的"点外面收起"规则当场关掉的。 */
    window.setTimeout(reveal, 180);
  }

  function close (commit) {
    if (!pad || !open) { return; }
    pad.hidden = true;
    pad.style.bottom = '';
    open = false;
    unpad();
    document.removeEventListener('keydown', onKey, false);
    if (field) {
      field.classList.remove('kio-typing');
      if (commit) { fire(field, 'change'); }
    }
    field = null;
  }

  function onKey (e) {
    if (e.key === 'Escape' || e.keyCode === 27) { e.preventDefault(); close(false); }
  }

  /* ---------- 触发：事件委托 ---------- */
  var TYPES = { text: 1, search: 1, number: 1, tel: 1 };

  function fieldFrom (target) {
    var el, type;
    if (!target || !target.closest) { return null; }
    el = target.closest('input,textarea,[data-keypad]');
    if (!el) { return null; }
    if (el.closest('.kio-pad') || el.closest('.kio-help') || el.closest('.shell')) { return null; }
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') { return null; }
    if (el.tagName === 'INPUT') {
      type = String(el.getAttribute('type') || 'text').toLowerCase();
      if (!TYPES[type] && !el.hasAttribute('data-keypad')) { return null; }
    }
    return el;
  }

  document.addEventListener('focusin', function (e) {
    var el = fieldFrom(e.target);
    if (el) { openPad(el); }
  }, false);

  document.addEventListener('click', function (e) {
    var el = fieldFrom(e.target);
    if (el) { openPad(el); return; }
    /* 点到键盘和当前输入框以外的地方 —— 收起键盘，不吞掉这一次点击。
       500ms 静默期：刚弹出时 reveal() 会滚动内容，这一次点按的 click 目标
       可能已经不是输入框了；没有静默期就会"弹出即关闭"。 */
    if (!open) { return; }
    if (e.target.closest && e.target.closest('.kio-pad')) { return; }
    if ((window.Date.now ? Date.now() : +new Date()) - openedAt < 500) { return; }
    close(false);
  }, false);

  window.v3Keypad = {
    open: openPad,
    close: close,
    isOpen: function () { return open; },
    field: function () { return field; },
    layoutFor: layoutFor
  };
}(window, document));
