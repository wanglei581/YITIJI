/* ============================================================
   青序流光 · 政策服务 / 校园招聘 共享工作台 —— 壳层运行时（静态原型）
   宿主：48-policy-workspace.html（body[data-host="policy"]）—— /renshi，台账 034
        49-campus-workspace.html（body[data-host="campus"]）—— /campus 035、/campus/welcome 036
   本文件只做两个宿主都要用的事：图标、片段构造、路由参数、统一状态渲染与元信息同步、
   来源二维码弹层（含焦点陷阱）、演示面板、按压反馈、时钟与取证模式。
   业务视图与状态注册表拆到 policy-workspace.js / campus-workspace.js —— 三个手写文件
   都远低于 800 行硬上限，不用压缩或单行规避行数。
   边界：不发任何请求、不读文件、不生成 AI 结果、不推进业务状态；
        服务端返回的名称 / 条数 / 日期 / 原文 / 统计一律占位（.slot）。
   隐私：条件核对的作答只放在 DOM 临时态，既不写 URL、也不写 localStorage / sessionStorage。
        ?src= 只带**非敏感的来源标识**（政策条目 id / 内置指引 id / 场馆导航），
        用来保证「点 A 打开的就是 A 的来源」，不携带任何一项个人作答。
   取证：?capture=1 钉住顶栏时钟与 .dots / .breathe 两个循环动画的相位；
        阴影、过渡、进场动画与按压反馈一概保留（整页降级是 ?flat=1 的职责）。
   ============================================================ */
(function () {
'use strict'

/* ── 图标：本地内联 SVG，零外部请求 ─────────────────────── */
var ICO = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/>',
  chat: '<path d="M21 12a8 8 0 1 1-3.5-6.6"/><path d="M8.5 12h.01M12 12h.01M15.5 12h.01"/>',
  doc: '<path d="M14 2H6.5A2.5 2.5 0 0 0 4 4.5v15A2.5 2.5 0 0 0 6.5 22h11a2.5 2.5 0 0 0 2.5-2.5V8z"/><path d="M14 2v6h6"/>',
  scale: '<path d="M12 3.5v17"/><path d="M6 20.5h12"/><path d="M4 9h6l-3 5.5A3 3 0 0 1 4 9z"/><path d="M14 9h6l-3 5.5A3 3 0 0 1 14 9z"/><path d="m5 8 7-2.5L19 8"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>',
  clipboard: '<rect x="5" y="4.5" width="14" height="17" rx="2.5"/><path d="M9 4.5V3.5h6v1"/><path d="m9 13 2 2 4-4"/>',
  scroll: '<path d="M6 3.5h12v14a3 3 0 0 0 3 3H7a3 3 0 0 1-3-3V5.5a2 2 0 0 1 2-2z"/><path d="M9 8h6M9 12h6"/>',
  cap: '<path d="m3 8.5 9-4 9 4-9 4z"/><path d="M7 10.5V16c0 1.4 2.2 2.5 5 2.5s5-1.1 5-2.5v-5.5"/>',
  brief: '<rect x="3" y="7.5" width="18" height="13" rx="2.5"/><path d="M8.5 7.5V5.8A1.8 1.8 0 0 1 10.3 4h3.4a1.8 1.8 0 0 1 1.8 1.8v1.7"/>',
  pin: '<path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z"/><circle cx="12" cy="10" r="2.6"/>',
  build: '<rect x="4" y="3.5" width="16" height="17" rx="2"/><path d="M8.5 8h3M8.5 12h3M14 8h1.5M14 12h1.5M9.5 20.5v-4h5v4"/>',
  heart: '<path d="M12 20.5S3.5 15 3.5 9.2A4.7 4.7 0 0 1 12 6.4a4.7 4.7 0 0 1 8.5 2.8c0 5.8-8.5 11.3-8.5 11.3z"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 5.2a3.5 3.5 0 0 1 0 5.6M17.5 20a6.4 6.4 0 0 0-2-4.6"/>',
  qr: '<rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1"/><rect x="14" y="3.5" width="6.5" height="6.5" rx="1"/><rect x="3.5" y="14" width="6.5" height="6.5" rx="1"/><path d="M14 14h3v3h-3zm3.5 3.5h3v3h-3zM14 20.5h1.5M20.5 14v1.5"/>',
  print: '<path d="M7 9V3.5h10V9"/><rect x="3" y="9" width="18" height="8" rx="2.5"/><path d="M7 14h10v6.5H7z"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.6h.01"/>',
  alert: '<path d="M12 3.5 21 20H3z"/><path d="M12 10v4.5M12 17.4h.01"/>',
  lock: '<rect x="4.5" y="10" width="15" height="10.5" rx="2.5"/><path d="M8 10V7.5a4 4 0 0 1 8 0V10"/>',
  check: '<path d="m4.5 12.5 5 5 10-11"/>',
  ok: '<circle cx="12" cy="12" r="9"/><path d="m8 12.2 2.6 2.6L16 9.4"/>',
  no: '<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.4 9.4A2.6 2.6 0 0 1 14.6 10c0 1.7-2.6 2-2.6 3.6M12 17.2h.01"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.2 5.6"/><path d="M20 5v6h-6"/>',
  chevron: '<path d="m6 9.5 6 6 6-6"/>',
  arrow: '<path d="M5 12h13M13 6.5 18.5 12 13 17.5"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  sparkle: '<path d="M12 3.5 13.8 9 19 10.8 13.8 12.6 12 18l-1.8-5.4L5 10.8 10.2 9z"/><path d="M18.5 16.5l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z"/>',
  layers: '<path d="m12 3.5 8.5 4.2-8.5 4.2-8.5-4.2z"/><path d="m4 12.5 8 4 8-4"/><path d="m4 16.8 8 4 8-4"/>',
  nav: '<path d="m3.5 11 17-7-7 17-2.4-7.6z"/>',
  map: '<path d="m3.5 6.5 5.5-2.5 6 3 5.5-2.5v13.5l-5.5 2.5-6-3-5.5 2.5z"/><path d="M9 4v13.5M15 7v13.5"/>',
  cal: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  book: '<path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H19v15.5H5.5A1.5 1.5 0 0 0 4 20z"/><path d="M4 20a1.5 1.5 0 0 0 1.5 1.5H19"/><path d="M8 7.5h7M8 11h5"/>',
  badge: '<circle cx="12" cy="9" r="5.5"/><path d="m8.4 13.6-1.4 7 5-2.6 5 2.6-1.4-7"/>',
  list: '<path d="M4 6.5h16M4 12h16M4 17.5h10"/>',
  filter: '<path d="M3.5 5.5h17l-6.5 7.5v6l-4 2v-8z"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  chart: '<path d="M4 20.5V10M10 20.5V4.5M16 20.5v-7M22 20.5H2"/>'
}
function svg (name, size, stroke) {
  return '<svg width="' + (size || 26) + '" height="' + (size || 26) + '" viewBox="0 0 24 24" fill="none" stroke="' +
    (stroke || 'currentColor') + '" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    ICO[name] + '</svg>'
}

/* ── 路由参数 ───────────────────────────────────────────── */
var HOST = document.body.getAttribute('data-host')            // 'policy' | 'campus'
var KEYPARAM = HOST === 'policy' ? 'tab' : 'screen'
var query = new URLSearchParams(location.search)
var FLAT = query.get('flat') === '1'
var DEBUG = query.get('debug') === '1'
/* ?capture=1：取证截图专用的确定性模式。本页只有两处不确定量 —— 顶栏实时时间，
   以及 .dots / .breathe 两个 infinite 动画当时跑到哪一帧；两者都会让同一份源码重跑
   产出不同 PNG 与不同 sha256。capture 只钉这两处，其余动效一律保留。 */
var CAPTURE = query.get('capture') === '1'
var CAPTURE_CLOCK = '09:30'                                   // 写死的常量，不表示任何业务时刻
/* 必须赶在首次样式计算之前落到 <html> 上：晚一步再加，循环动画会先跑起来再被暂停。 */
if (CAPTURE) document.documentElement.setAttribute('data-capture', '1')

var PAGES = null, CHROME = null, STRIP = null, QRS = null
var key = '', state = '', SCREENID = '', SRC = ''
var page = null

/* 内部状态链接必须原样带走 flat / debug / capture：漏掉 capture，验证里点一步
   就掉回实时时钟与运行中的动画。src 只在需要指明来源对象时出现。 */
function url (k, st, src) {
  return '?' + KEYPARAM + '=' + k + '&state=' + st + (src ? '&src=' + src : '') +
    (FLAT ? '&flat=1' : '') + (DEBUG ? '&debug=1' : '') + (CAPTURE ? '&capture=1' : '')
}
function tid (suffix) { return SCREENID + '-' + suffix }
function srcKey () { return SRC }

/* ── 通用片段 ───────────────────────────────────────────── */
function slot (label, cls) { return '<span class="slot' + (cls ? ' ' + cls : '') + '">' + label + '</span>' }
function sec (no, title, hint, inner, cls) {
  return '<section class="sec' + (cls ? ' ' + cls : '') + '">' +
    (title ? '<div class="sec-label">' + (no ? '<span class="no serif">' + no + '</span>' : '') +
      '<span class="t">' + title + '</span>' +
      (hint ? '<span class="hint">' + hint + '</span>' : '') + '</div>' : '') + inner + '</section>'
}
function box (kind, icon, id, head, paras, cls) {
  return '<div class="state' + (cls ? ' ' + cls : '') + '" data-kind="' + kind + '" data-testid="' + tid(id) + '">' +
    '<div class="state-h"><span class="state-ic">' + svg(icon, 30) + '</span>' + head + '</div>' +
    paras.map(function (p) { return '<p class="state-p">' + p + '</p>' }).join('') + '</div>'
}
function link (href, route, id, cls, inner, label) {
  return '<a class="' + cls + ' press" href="' + href + '" data-route="' + route + '" data-testid="' + tid(id) + '"' +
    (label ? ' aria-label="' + label + '"' : '') + '>' + inner + '</a>'
}
/** 置灰控件：真正的 <button>，没有 href，点击由壳层再拦一次；原因常显并被 aria-describedby 指到 */
function off (id, cls, inner, reasonId) {
  return '<button type="button" class="' + cls + '" aria-disabled="true" data-testid="' + tid(id) + '"' +
    (reasonId ? ' aria-describedby="' + reasonId + '"' : '') + '>' + inner + '</button>'
}
function why (id, text) { return '<span class="reason" id="' + id + '">' + text + '</span>' }
function noteline (icon, html, kind, id) {
  return '<div class="noteline' + (kind ? ' ' + kind : '') + '"' + (id ? ' id="' + id + '"' : '') + '>' +
    svg(icon, 24) + '<span>' + html + '</span></div>'
}
function exit (href, route, id, icon, title, desc) {
  return link(href, route, id, 'exit',
    '<span class="eic">' + svg(icon, 24) + '</span>' +
    '<span class="etx"><b>' + title + '</b><span>' + desc + '</span></span>')
}
function exitOff (id, icon, title, desc, reasonId) {
  return '<button type="button" class="exit" aria-disabled="true" data-testid="' + tid(id) + '"' +
    ' aria-describedby="' + reasonId + '"><span class="eic">' + svg(icon, 24) + '</span>' +
    '<span class="etx"><b>' + title + '</b><span>' + desc + '</span></span></button>'
}
function cta (parts) { return '<div class="ctabar" data-testid="' + tid('ctabar') + '">' + parts.join('') + '</div>' }
function rows (items) {
  return '<div class="rows">' + items.map(function (it) {
    return '<div><span>' + it[0] + '</span><b>' + it[1] + '</b></div>'
  }).join('') + '</div>'
}
/** 死路 / 受限屏统一骨架：发生了什么 → 现在可以做什么 →（必要时）一句就地说明。
    只写用户下一步用得上的话，不摊开系统内部构造；余高由 .scroll.spread 摊进段间呼吸区。 */
function deadend (kind, icon, id, head, paras, exits, hint, note) {
  return sec('', '', '', box(kind, icon, id, head, paras)) +
    sec('', '现在可以做什么', hint || '', '<div class="strip">' + exits + '</div>') +
    (note ? sec('', '', '', note) : '')
}
function srcRow (extra) {
  return '<div class="srcrow">' +
    '<span class="chip slate">来源机构 <b>' + slot('—') + '</b></span>' +
    '<span class="chip">同步时间 <b>' + slot('—') + '</b></span>' +
    '<span class="chip">外部编号 <b>' + slot('—') + '</b></span>' +
    (extra || '') + '</div>'
}
/** mode: '' 勾选单列 | 'cols' 勾选双列 | 'num' 编号单列 | 'numcols' 编号双列。
    1080 宽的竖屏放得下双列；办理步骤用双列能省掉小半屏纵向高度，编号仍然按顺序读。 */
function dsec (icon, title, items, mode) {
  var cols = mode === 'cols' || mode === 'numcols'
  var num = mode === 'num' || mode === 'numcols'
  return '<div class="dsec' + (cols ? ' cols' : '') + '">' +
    '<div class="dh">' + svg(icon, 22) + title + '</div><ul>' +
    items.map(function (t, i) {
      return '<li>' + (num ? '<span class="sn">' + (i + 1) + '</span>' : svg('check', 22)) +
        '<span>' + t + '</span></li>'
    }).join('') + '</ul></div>'
}
/** 来源二维码触发钮：真 <button>，就地开层，不跳页；srcKey 决定层里显示哪一条来源。 */
function qrBtn (srcId, id, title, desc) {
  return '<button type="button" class="exit press" data-qr-open="' + srcId + '" data-testid="' + tid(id) + '">' +
    '<span class="eic">' + svg('qr', 24) + '</span>' +
    '<span class="etx"><b>' + title + '</b><span>' + desc + '</span></span></button>'
}
function qrBtnSm (srcId, id, label) {
  return '<button type="button" class="btn ghost sm press" data-qr-open="' + srcId + '" data-testid="' + tid(id) + '">' +
    svg('qr', 22) + label + '</button>'
}
/** 无 href 的置灰任务分区：没有选定对象时不给可点的分区入口，也不给假链接。 */
function tabOff (id, icon, label, reasonId) {
  return '<button type="button" class="tab" aria-disabled="true" data-testid="' + id +
    '" aria-describedby="' + reasonId + '">' + svg(icon, 24) + label + '</button>'
}

/* ── 来源二维码弹层：焦点进层 → Tab 循环 → Escape 关闭并还原焦点 ── */
var qrTrigger = null
function qrHtml (cfg) {
  return '<div class="qrlayer" data-testid="' + tid('qr-layer') + '" data-qr-src="' + cfg.id + '"' +
    ' role="dialog" aria-modal="true" aria-labelledby="' + tid('qr-title') + '">' +
    '<div class="qrcard"><h2 id="' + tid('qr-title') + '">' + svg('qr', 28) + cfg.title + '</h2>' +
    '<div class="qrmid"><div class="qrslot" data-testid="' + tid('qr-slot') + '">' + svg('qr', 120) +
    '<span>扫码图形按这条来源的地址显示</span></div>' +
    '<div class="qrside"><div class="rows" data-testid="' + tid('qr-meta') + '">' +
    '<div><span>本次对象</span><b>' + cfg.subject + '</b></div>' +
    cfg.metas.map(function (m) { return '<div><span>' + m[0] + '</span><b>' + m[1] + '</b></div>' }).join('') +
    '</div></div></div>' +
    '<p class="qr-note">' + cfg.note + '</p>' +
    '<div class="ctarow"><button type="button" class="btn primary qr-close press" data-qr-close="1" data-testid="' +
    tid('qr-close') + '">' + svg('x', 22) + '关闭二维码</button></div></div></div>'
}
function mountQr (srcId, trigger) {
  var cfg = QRS[srcId]
  if (!cfg) return
  var holder = document.createElement('div')
  holder.innerHTML = qrHtml(cfg)
  var layer = holder.firstChild
  root.appendChild(layer)
  qrTrigger = trigger || null
  syncMeta(key, cfg.state, srcId)
  var close = layer.querySelector('[data-qr-close]')
  if (close) close.focus()
}
function closeQr () {
  var layer = root.querySelector('.qrlayer')
  if (!layer) return
  var cfg = QRS[layer.getAttribute('data-qr-src')]
  layer.parentNode.removeChild(layer)
  syncMeta(key, cfg ? cfg.base : page.states[0], '')
  /* 还原触发焦点：就地打开时回到那颗按钮；深链直接进 QR 态时回到本屏里同一条来源的按钮。 */
  var back = qrTrigger && root.contains(qrTrigger)
    ? qrTrigger
    : root.querySelector('[data-qr-open="' + (layer.getAttribute('data-qr-src')) + '"]')
  qrTrigger = null
  if (back) back.focus()
}
/* 焦点陷阱：弹层打开期间 Tab / Shift+Tab 只在卡片内循环，Escape 关闭。 */
var FOCUSABLE = 'a[href],button:not([aria-disabled="true"]),[tabindex]:not([tabindex="-1"])'
document.addEventListener('keydown', function (e) {
  var layer = root && root.querySelector('.qrlayer')
  if (!layer) return
  if (e.key === 'Escape') { e.preventDefault(); return closeQr() }
  if (e.key !== 'Tab') return
  var items = Array.prototype.filter.call(layer.querySelectorAll(FOCUSABLE), function (el) {
    return el.offsetWidth > 0 || el.offsetHeight > 0
  })
  if (!items.length) return
  var first = items[0], last = items[items.length - 1]
  var here = document.activeElement
  if (!layer.contains(here)) { e.preventDefault(); return first.focus() }
  if (e.shiftKey && here === first) { e.preventDefault(); last.focus() }
  else if (!e.shiftKey && here === last) { e.preventDefault(); first.focus() }
})

/* ── 统一状态渲染与元信息同步 ───────────────────────────── */
var stage = document.getElementById('stage')
var root = document.getElementById('body-root')
var tabHost = document.getElementById('tabbar-host')
var stripHost = document.getElementById('fairstrip-host')

/** 只同步元信息：data-screen / data-state / 唯一 testid / 任务副标题 / 胶囊 / 返回键 / URL。
    弹层开合走这一条，正文不重绘，触发按钮因此不会被销毁，焦点才还得回去。 */
function syncMeta (k, st, src) {
  key = k; state = st; SRC = src || ''
  page = PAGES[k]; SCREENID = page.id
  root.setAttribute('data-screen', page.id)
  root.setAttribute('data-state', st)
  root.setAttribute('data-testid', page.id + '-state-' + st)
  document.getElementById('task-title').textContent = page.title
  document.getElementById('task-sub').innerHTML = page.sub[st]
  var pillConf = page.pill[st]
  document.getElementById('pill').className = 'pill' + (pillConf[0] ? ' ' + pillConf[0] : '')
  document.getElementById('pill-txt').textContent = pillConf[1]
  document.getElementById('pill-dot').className = 'dot' +
    (/loading|probing|submitting|retrying/.test(st) ? ' breathe' : '')
  var backEl = document.getElementById('back-link')
  var BACK = page.back()
  backEl.setAttribute('href', BACK[0])
  backEl.setAttribute('data-route', BACK[1])
  backEl.setAttribute('aria-label', BACK[2])
  try { history.replaceState(null, '', url(k, st, SRC)) } catch (err) { /* file:// 下不可用，不影响渲染 */ }
  var open = document.querySelector('.demo-panel a.on')
  if (open) open.classList.remove('on')
  var now = document.querySelector('.demo-panel a[href="' + url(k, st, '') + '"]')
  if (now) now.classList.add('on')
}

/** 内容不满一屏时的余高处置：**先放大版面，再对称留白**，两步都不加一个字。
    逐档从大往小试戴 fit-4 → fit-1，第一个不溢出的档位留下；四档都放不下就只居中
    不放大。段间始终是 .sec 的 18px 常规节奏 —— 余高一律不许摊进段间，那正是旧
    .spread 把一屏撕成孤岛的原因（见 CSS 同名段落）。放大吃不完的余高会变成上下
    对称留白，越过 G11 的 320px 就会被门禁拒绝，不存在「摊平混过去」的退路。 */
var FIT_TIERS = ['fit-4', 'fit-3', 'fit-2', 'fit-1']
function fitScroll (scroll) {
  if (scroll.scrollHeight > scroll.clientHeight + 1) return
  scroll.classList.add('fit')
  for (var i = 0; i < FIT_TIERS.length; i++) {
    scroll.classList.add(FIT_TIERS[i])
    if (scroll.scrollHeight <= scroll.clientHeight + 1) return
    scroll.classList.remove(FIT_TIERS[i])
  }
}

/** 完整重渲：任务分区导航 + 上下文条 + 正文 + 元信息。tab 切换、重试、提交、授权都走这里。 */
function goState (k, st, src) {
  syncMeta(k, st, src)
  tabHost.innerHTML = CHROME ? CHROME(k, st) : ''
  if (stripHost) stripHost.innerHTML = STRIP ? (STRIP(k, st) || '') : ''
  var html = page.render(st)
  root.innerHTML = ''
  var tmp = document.createElement('div')
  tmp.innerHTML = html
  /* 内容组包一层 .scroll：主操作条留在 .body 直属层，其余区块整组吸收余高。 */
  var scroll = document.createElement('div')
  scroll.className = 'scroll'
  scroll.setAttribute('data-testid', page.id + '-scroll')
  var tail = document.createDocumentFragment()
  Array.prototype.slice.call(tmp.children).forEach(function (el) {
    if (el.classList.contains('ctabar')) tail.appendChild(el)
    else scroll.appendChild(el)
  })
  root.appendChild(scroll)
  root.appendChild(tail)
  fitScroll(scroll)
  root.classList.remove('action-enter')
  void root.offsetWidth
  root.classList.add('action-enter')
  /* QR 态：正文是它的基础态，弹层由壳层统一挂载，便于焦点管理与 Escape 还原。
     深链带来的 ?src= 必须属于当前分区，否则回落到本分区的默认来源 —— 不让
     ?tab=social&src=某条政策指引 拼出一个本分区里根本不存在的来源上下文。 */
  if (page.qr && page.qr[st]) {
    var want = SRC && QRS[SRC] && QRS[SRC].page === key && QRS[SRC].state === st ? SRC : page.qr[st]
    mountQr(want, null)
  }
}

/* ── 启动 ───────────────────────────────────────────────── */
function showIllegal (k, requested, reason) {
  page = PAGES[k]; key = k; state = 'illegal'; SRC = ''; SCREENID = page.id
  root.setAttribute('data-screen', page.id)
  root.setAttribute('data-state', 'illegal')
  root.setAttribute('data-testid', page.id + '-state-illegal')
  document.getElementById('task-title').textContent = '链接不可用'
  document.getElementById('task-sub').textContent = '地址参数不属于当前工作台，本机没有静默切换到其他结果。'
  document.getElementById('pill').className = 'pill warn'
  document.getElementById('pill-txt').textContent = '页面参数无效'
  document.getElementById('pill-dot').className = 'dot'
  tabHost.innerHTML = ''
  if (stripHost) stripHost.innerHTML = ''
  var backEl = document.getElementById('back-link'), back = page.back()
  backEl.setAttribute('href', back[0]); backEl.setAttribute('data-route', back[1]); backEl.setAttribute('aria-label', back[2])
  var safe = String(requested || '').replace(/[&<>"']/g, function (c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c] })
  root.innerHTML = '<div class="scroll">' + sec('', '', '', box('warn', 'alert', 'illegal-parameter', '页面参数无效', [
    reason + '「<b>' + safe + '</b>」不在当前页面允许的范围内。',
    '本机不会把坏链接伪装成正常加载、空结果或授权结果，请从有效入口重新选择。'
  ])) + sec('', '可以继续', '', '<div class="exits">' +
    exit(url(k, page.states[0], ''), page.route, 'illegal-default', 'refresh', '打开默认页面', '回到这个分区的正常入口') +
    exit('02-services.html', '/services', 'illegal-services', 'layers', '返回全部服务', '重新选择办理项目') +
    exit('01-home.html', '/', 'illegal-home', 'home', '返回首页', '结束当前错误路径') + '</div>') + '</div>'
  fitScroll(root.querySelector('.scroll'))
}

function boot (pages, first, opts) {
  PAGES = pages
  CHROME = opts.chrome || null
  STRIP = opts.strip || null
  QRS = opts.qr || {}
  /* 状态表规范化：每个分区只维护一张 [state, 任务副标题, 胶囊色, 胶囊文案] 表，
     顺序即状态顺序（第一项是该分区的默认态）。三份平行 map 容易漂移 —— 加了状态
     忘了配副标题，页面就会渲染成 undefined。 */
  Object.keys(PAGES).forEach(function (pk) {
    var p = PAGES[pk]
    p.states = []; p.sub = {}; p.pill = {}
    p.table.forEach(function (row) {
      p.states.push(row[0]); p.sub[row[0]] = row[1]; p.pill[row[0]] = [row[2], row[3]]
    })
  })
  var requestedKey = query.get(KEYPARAM) || ''
  var invalidKey = Boolean(requestedKey && !PAGES[requestedKey])
  var k = invalidKey ? first : (requestedKey || first)
  var requestedState = query.get('state')
  var invalidState = Boolean(requestedState && PAGES[k].states.indexOf(requestedState) < 0)
  var st = invalidState ? PAGES[k].states[0] : (requestedState || PAGES[k].states[0])
  var requestedSrc = query.get('src') || ''
  var invalidSrc = Boolean(requestedSrc && (!QRS[requestedSrc] || QRS[requestedSrc].page !== k || QRS[requestedSrc].state !== st))
  var s = invalidSrc ? '' : requestedSrc

  /* 演示面板：只切 data-state，不驱动任何业务结果 */
  var panel = document.getElementById('demo-panel')
  var panelHtml = '<div class="dp-t">原型演示控制</div>'
  Object.keys(PAGES).forEach(function (pk) {
    PAGES[pk].states.forEach(function (ps) {
      panelHtml += '<a href="' + url(pk, ps, '') + '">' + pk + ' · ' + ps + '</a>'
    })
  })
  panel.innerHTML = panelHtml
  document.getElementById('demo-tab').addEventListener('click', function () { panel.classList.toggle('show') })
  if (DEBUG) document.documentElement.classList.add('debug')

  if (invalidKey) showIllegal(k, requestedKey, '分区参数')
  else if (invalidState) showIllegal(k, requestedState, '状态参数')
  else if (invalidSrc) showIllegal(k, requestedSrc, '来源参数')
  else goState(k, st, s)

  /* 置灰控件真的不放行：捕获阶段拦一次，且它们本身没有 href */
  stage.addEventListener('click', function (e) {
    var blocked = e.target.closest('[aria-disabled="true"]')
    if (!blocked) return
    e.preventDefault()
    e.stopPropagation()
  }, true)

  /* 来源二维码：就地开层 / 关层，不跳页、不写 storage */
  stage.addEventListener('click', function (e) {
    var opener = e.target.closest('[data-qr-open]')
    if (opener) { e.preventDefault(); return mountQr(opener.getAttribute('data-qr-open'), opener) }
    if (e.target.closest('[data-qr-close]')) { e.preventDefault(); return closeQr() }
    /* 状态链接一律走 goState：不整页刷新，元信息与 URL 一起同步 */
    var a = e.target.closest('a[href^="?"]')
    if (a && !a.closest('[data-proto-control]')) {
      e.preventDefault()
      var q = new URLSearchParams(a.getAttribute('href').slice(1))
      var nk = q.get(KEYPARAM), ns = q.get('state')
      if (PAGES[nk] && PAGES[nk].states.indexOf(ns) >= 0) goState(nk, ns, q.get('src') || '')
    }
  })

  /* 触控回馈：只给真正可操作的元素短促按压态，不截获跳转、不伪造完成 */
  var pressSel = 'a[href], button:not([aria-disabled="true"])'
  function releasePress () {
    var active = stage.querySelector('.is-pressing')
    if (active) active.classList.remove('is-pressing')
  }
  stage.addEventListener('pointerdown', function (e) {
    var control = e.target.closest(pressSel)
    if (!control || control.closest('[aria-disabled="true"]')) return
    releasePress()
    control.classList.add('is-pressing')
  })
  stage.addEventListener('pointerup', releasePress)
  stage.addEventListener('pointercancel', releasePress)
  stage.addEventListener('pointerleave', releasePress)

  /* 时钟：只刷新顶栏时间文本，不推进任何业务状态。
     取证模式钉成常量且不起 setInterval —— 留着定时器就等于让截图时刻决定 PNG 内容。 */
  var clockEl = document.getElementById('clock')
  function tick () {
    var d = new Date()
    clockEl.textContent = ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2)
  }
  if (CAPTURE) clockEl.textContent = CAPTURE_CLOCK
  else { tick(); setInterval(tick, 20000) }

  function fit () {
    var s = Math.min(innerWidth / 1080, innerHeight / 1920)
    stage.style.transform = 'translate(-50%,-50%) scale(' + s + ')'
  }
  fit(); addEventListener('resize', fit)
  if (FLAT) { stage.classList.add('flat'); document.documentElement.setAttribute('data-flat', '1') }
}

window.PCW = {
  svg: svg, slot: slot, sec: sec, box: box, link: link, off: off, why: why, noteline: noteline,
  exit: exit, exitOff: exitOff, cta: cta, rows: rows, deadend: deadend, srcRow: srcRow, dsec: dsec,
  qrBtn: qrBtn, qrBtnSm: qrBtnSm, tabOff: tabOff, tid: tid, url: url, srcKey: srcKey,
  boot: boot, goState: goState, stage: stage, root: root
}
})()
