/* ============================================================
   青序流光 · AI 签约风险提示工作台运行时（静态原型）
   宿主：47-contract-review-workspace.html
   承载 route：/contract-review（103）· /contract-review/processing（104）
              · /contract-review/result（105）
   职责：按 ?screen= 与 ?state= 渲染主体、顶栏、任务标题与演示面板；
        处理就地交互（通道切换、类型选择、同意勾选、移除文件、证据展开、确认与删除）。
   边界：不发任何请求、不读文件、不生成 AI 结果、不推进业务状态；
        服务端返回的名称 / 页数 / 条数 / 摘录 / 依据一律占位（.slot）；
        枚举字段（识别质量 高·中·低、覆盖 完整·部分）按当前状态声明的服务端分支取值。
   取证：?capture=1 是截图专用的确定性模式 —— 顶栏时间固定成常量且不起 setInterval，
        .dots / .breathe 两个无限循环动画由 CSS 停在固定相位；阴影、过渡、进场动画与
        按压反馈一概保留（整页降级是另一条通道 ?flat=1）。普通访问不带这个参数。
   ============================================================ */
(function () {
'use strict'

/* ── 图标：本地内联 SVG，零外部请求 ─────────────────────── */
var ICO = {
  lock: '<rect x="4.5" y="10" width="15" height="10.5" rx="2.5"/><path d="M8 10V7.5a4 4 0 0 1 8 0V10"/>',
  qr: '<rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1"/><rect x="14" y="3.5" width="6.5" height="6.5" rx="1"/><rect x="3.5" y="14" width="6.5" height="6.5" rx="1"/><path d="M14 14h3v3h-3zm3.5 3.5h3v3h-3zM14 20.5h1.5M20.5 14v1.5"/>',
  monitor: '<rect x="2.5" y="4" width="19" height="12.5" rx="2.5"/><path d="M8.5 20.5h7M12 16.5v4"/>',
  doc: '<path d="M14 2H6.5A2.5 2.5 0 0 0 4 4.5v15A2.5 2.5 0 0 0 6.5 22h11a2.5 2.5 0 0 0 2.5-2.5V8z"/><path d="M14 2v6h6"/>',
  upload: '<path d="M12 16.5V4.5"/><path d="m7.5 9 4.5-4.5L16.5 9"/><path d="M4 15.5v3A2.5 2.5 0 0 0 6.5 21h11a2.5 2.5 0 0 0 2.5-2.5v-3"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  check: '<path d="m4.5 12.5 5 5 10-11"/>',
  scanText: '<path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2"/><path d="M8 10h8M8 14h5"/>',
  clipboard: '<rect x="5" y="4.5" width="14" height="17" rx="2.5"/><path d="M9 4.5V3.5h6v1"/><path d="m9 13 2 2 4-4"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>',
  brain: '<path d="M9.5 3.5A2.5 2.5 0 0 0 7 6v.3A2.7 2.7 0 0 0 5 9a2.7 2.7 0 0 0 .8 1.9A2.8 2.8 0 0 0 5 13a2.8 2.8 0 0 0 2 2.7V16a2.5 2.5 0 0 0 5 0V6a2.5 2.5 0 0 0-2.5-2.5z"/><path d="M14.5 3.5A2.5 2.5 0 0 1 17 6v.3A2.7 2.7 0 0 1 19 9a2.7 2.7 0 0 1-.8 1.9A2.8 2.8 0 0 1 19 13a2.8 2.8 0 0 1-2 2.7V16a2.5 2.5 0 0 1-5 0"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5.4l3.4 2"/>',
  alert: '<path d="M12 3.5 21 20H3z"/><path d="M12 10v4.5M12 17.4h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.6h.01"/>',
  print: '<path d="M7 9V3.5h10V9"/><rect x="3" y="9" width="18" height="8" rx="2.5"/><path d="M7 14h10v6.5H7z"/>',
  trash: '<path d="M4 6.5h16"/><path d="M9.5 6.5V4.5h5v2"/><path d="M6.5 6.5 7.5 20a1.5 1.5 0 0 0 1.5 1.4h6a1.5 1.5 0 0 0 1.5-1.4l1-13.5"/>',
  chevron: '<path d="m6 9.5 6 6 6-6"/>',
  book: '<path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H19v15.5H5.5A1.5 1.5 0 0 0 4 20z"/><path d="M4 20a1.5 1.5 0 0 0 1.5 1.5H19"/><path d="M8 7.5h7M8 11h5"/>',
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/>',
  phone: '<rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M10.5 18.5h3"/>',
  scale: '<path d="M12 3.5v17"/><path d="M6 20.5h12"/><path d="M4 9h6l-3 5.5A3 3 0 0 1 4 9z"/><path d="M14 9h6l-3 5.5A3 3 0 0 1 14 9z"/><path d="m5 8 7-2.5L19 8"/>',
  quote: '<path d="M4.5 6.5h6v6a4.5 4.5 0 0 1-4.5 4.5"/><path d="M13.5 6.5h6v6a4.5 4.5 0 0 1-4.5 4.5"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.2 5.6"/><path d="M20 5v6h-6"/>'
}
function svg (name, size, stroke) {
  return '<svg width="' + (size || 28) + '" height="' + (size || 28) + '" viewBox="0 0 24 24" fill="none" stroke="' +
    (stroke || 'currentColor') + '" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    ICO[name] + '</svg>'
}

/* ── 路由参数 ───────────────────────────────────────────── */
var query = new URLSearchParams(location.search)
var FLAT = query.get('flat') === '1'
var DEBUG = query.get('debug') === '1'
/* ?capture=1：取证截图专用的确定性模式。这一页只有两处不确定量 —— 顶栏的实时时间，
   以及 .dots / .breathe 两个 infinite 动画当时跑到哪一帧；两者都会让同一份源码重跑
   产出不同 PNG 与不同 hash。capture 只钉这两处：时间换成下面的固定常量，循环动画由
   CSS 的 html[data-capture="1"] 段落按固定负 delay 暂停。阴影、过渡、进场动画与按压
   反馈一律保留 —— 关掉它们是 ?flat=1 的职责，取证要证明的恰恰是这些动效真实存在。 */
var CAPTURE = query.get('capture') === '1'
/* 取证时刻：写死的常量，不是当前时间，也不表示任何业务时刻。 */
var CAPTURE_CLOCK = '09:30'
/* 必须赶在首次样式计算之前落到 <html> 上：晚一步再加，循环动画会先跑起来再被暂停，
   停住的相位就不再确定，PNG 又会漂。 */
if (CAPTURE) document.documentElement.setAttribute('data-capture', '1')
var screen = query.get('screen') || 'home'
var SCREEN = ''
var state = ''

/* 内部状态链接必须原样带走 flat / debug / capture：漏掉 capture，演示或验证里点一步
   就掉回实时时钟与运行中的动画。replaceState 也走这个函数。 */
function url (s, st) {
  return '?screen=' + s + '&state=' + st + (FLAT ? '&flat=1' : '') + (DEBUG ? '&debug=1' : '') +
    (CAPTURE ? '&capture=1' : '')
}
function tid (suffix) { return 'contract-' + screen + '-' + suffix }

/* ── 通用片段 ───────────────────────────────────────────── */
function slot (label, cls) { return '<span class="slot' + (cls ? ' ' + cls : '') + '">' + label + '</span>' }
function sec (no, title, hint, inner, cls) {
  return '<section class="sec' + (cls ? ' ' + cls : '') + '">' +
    (title ? '<div class="sec-label">' + (no ? '<span class="no serif">' + no + '</span>' : '') +
      '<span class="t">' + title + '</span>' +
      (hint ? '<span class="hint">' + hint + '</span>' : '') + '</div>' : '') + inner + '</section>'
}
function box (kind, icon, id, head, paras, reason) {
  return '<div class="state" data-kind="' + kind + '" data-testid="' + tid(id) + '">' +
    '<div class="state-h"><span class="state-ic">' + svg(icon, 32) + '</span>' + head + '</div>' +
    paras.map(function (p) { return '<p class="state-p">' + p + '</p>' }).join('') +
    (reason ? '<span class="reason">' + reason + '</span>' : '') + '</div>'
}
function link (href, route, id, cls, inner, label) {
  return '<a class="' + cls + ' press" href="' + href + '" data-route="' + route + '" data-testid="' + tid(id) + '"' +
    (label ? ' aria-label="' + label + '"' : '') + '>' + inner + '</a>'
}
function go (s, st, id, cls, inner) { return link(url(s, st), ROUTES[s], id, cls, inner) }
/** 置灰控件：真正的 <button>，没有 href，点击由壳层再拦一次；原因常显并被 aria-describedby 指到 */
function off (id, cls, inner, reasonId) {
  return '<button type="button" class="' + cls + '" aria-disabled="true" data-testid="' + tid(id) + '"' +
    (reasonId ? ' aria-describedby="' + reasonId + '"' : '') + '>' + inner + '</button>'
}
function why (id, text) { return '<span class="reason" id="' + id + '">' + text + '</span>' }
function noteline (icon, html, kind, id) {
  return '<div class="noteline' + (kind ? ' ' + kind : '') + '"' + (id ? ' id="' + id + '"' : '') + '>' +
    svg(icon, 26) + '<span>' + html + '</span></div>'
}
function steps (list) {
  return '<ul class="steps">' + list.map(function (s, i) {
    return '<li><span class="sn">' + (i + 1) + '</span><span>' + s + '</span></li>'
  }).join('') + '</ul>'
}
function exit (href, route, id, icon, title, desc) {
  return link(href, route, id, 'exit',
    '<span class="eic">' + svg(icon, 26) + '</span>' +
    '<span class="etx"><b>' + title + '</b><span>' + desc + '</span></span>')
}
function cta (parts) { return '<div class="ctabar">' + parts.join('') + '</div>' }

var ROUTES = {
  home: '/contract-review',
  processing: '/contract-review/processing',
  result: '/contract-review/result'
}

/* ── 非 AI 退路（AI 不可用 / 失败 / 取消 / 未开放共用） ─────
   通用条文自查只引用公开法条，不针对本人合同，也不给出效力结论。 */
var LAW_ITEMS = [
  ['试用期', '与合同期限挂钩，同一单位只能约定一次，最长不超过六个月', '《劳动合同法》第 19 条'],
  ['书面合同', '用工之日起一个月内订立书面劳动合同', '《劳动合同法》第 10 条'],
  ['证件与财物', '不得扣押身份证等证件，不得要求担保或收取财物', '《劳动合同法》第 9 条'],
  ['竞业限制', '需书面约定，限制期内按月给予经济补偿', '《劳动合同法》第 23、24 条'],
  ['加班工资', '延长工时、休息日与法定节假日工作按规定另计报酬', '《劳动法》第 44 条'],
  ['社会保险', '依法参加社会保险，由单位按时足额申报缴纳', '《社会保险法》第 4、58、60 条']
]
function lawBox (open) {
  return '<details data-testid="' + tid('law-detail') + '"' + (open ? ' open' : '') + '>' +
    '<summary class="detail-sum press" data-testid="' + tid('law-toggle') + '">' + svg('scale', 26) +
    '<span>签约前先自己核对这几条（通用条文，不针对你的合同，也不构成法律意见）</span>' +
    '<span class="dcaret">' + svg('chevron', 24) + '</span></summary>' +
    '<div class="lawlist">' + LAW_ITEMS.map(function (r) {
      return '<div><b>' + r[0] + '</b><span>' + r[1] + '</span><i>' + r[2] + '</i></div>'
    }).join('') + '</div></details>'
}
/** 死路页的「这次没有发生什么」：三条确定性事实，替代含糊安慰 */
function factsRow (items) {
  return '<div class="facts">' + items.map(function (it) {
    return '<div class="fact"><div class="fk">' + it[0] + '</div><div class="fv">' + it[1] + '</div></div>'
  }).join('') + '</div>'
}
function humanHelp () {
  return noteline('info', '重大争议不靠本机判断：可拨打人力资源社会保障服务热线 <b>12333</b>，或咨询执业律师、当地劳动人事争议调解仲裁机构。')
}
function fallbackExits (retryHref, retryRoute, retryTitle, retryDesc) {
  return '<div class="strip">' +
    exit(retryHref, retryRoute, 'exit-retry', 'refresh', retryTitle, retryDesc) +
    exit('16-service-hubs.html?hub=resume', '/resume-service', 'exit-material', 'doc', '返回材料服务', '简历诊断与打印入口') +
    exit('10-print-hub.html', '/print-scan', 'exit-print', 'print', '打印或扫描原件', '不做分析，按普通文件处理') +
    '</div>'
}

/* ── 103 上传合同 ───────────────────────────────────────── */
var TYPES = [
  ['labor_contract', '劳动合同', '正式用工合同', 'doc'],
  ['internship_agreement', '实习协议', '在校生实习用', 'book'],
  ['non_compete', '竞业限制协议', '含竞业 / 保密条款', 'shield'],
  ['offer', '录用通知书', 'Offer Letter', 'clipboard']
]
function channelSeg (active) {
  function one (key, icon, name, hint) {
    return '<button type="button" role="radio" class="seg-b press" aria-checked="' + (active === key ? 'true' : 'false') +
      '" data-channel="' + key + '" data-testid="' + tid('channel-' + key) + '">' +
      '<b>' + svg(icon, 26) + name + '</b><span>' + hint + '</span></button>'
  }
  return '<div class="seg" role="radiogroup" aria-label="上传通道">' +
    one('phone', 'qr', '手机扫码上传', '一体机主通道 · 单个不超过 10MB') +
    one('desktop', 'monitor', '本机文件', '桌面 / E2E 验证通道 · 不超过 15MB') + '</div>'
}
function qrPanel () {
  return '<div class="qrpanel">' +
    '<div class="qrbox" data-testid="' + tid('qr-slot') + '">' + svg('qr', 148) +
    '<span>二维码在运行时由扫码上传会话生成<br>静态原型不生成可扫描图形</span></div>' +
    '<div class="qrside"><h3>用手机把合同传上来</h3>' +
    steps([
      '手机扫码，打开本次上传会话',
      '在手机上选合同文件并上传（单个不超过 10MB）',
      '回到这台机器，确认使用这份合同'
    ]) +
    noteline('phone', '手机只负责上传，<b>确认与分析都在这台机器上完成</b>；换人或刷新会作废这次会话。') +
    '</div></div>'
}
function dropZone () {
  return '<button type="button" class="drop press" data-pick="1" data-testid="' + tid('pick-file') + '">' +
    '<span class="drop-ic">' + svg('upload', 40) + '</span><b>选择本机合同文件</b>' +
    '<span>支持 PDF · Word · 图片（JPG / PNG / WEBP），单个不超过 15MB。<br>本通道用于桌面浏览器与 E2E 验证；一体机现场请用手机扫码上传。</span></button>'
}
function fileCard (channelLabel, bad) {
  return '<div class="filecard" data-testid="' + tid('file-card') + '">' +
    '<span class="fic"' + (bad ? ' style="background:var(--cinnabar-soft);color:var(--cinnabar-d)"' : '') + '>' + svg('doc', 34) + '</span>' +
    '<span class="fmain"><span class="fname">' + slot('合同文件名', 'wide') + '</span>' +
    '<span class="fmeta"><span class="chip">大小 ' + slot('—') + '</span>' +
    '<span class="chip ' + (bad ? 'bad' : 'ok') + '">' + channelLabel + '</span>' +
    '<span class="chip">格式 ' + slot('—') + '</span></span></span>' +
    '<button type="button" class="fdrop press" data-testid="' + tid('remove-file') + '">' + svg('x', 24) + '移除文件</button></div>'
}
function typeGrid (activeKey) {
  return '<div class="typegrid" role="radiogroup" aria-label="合同类型">' + TYPES.map(function (t) {
    return '<button type="button" role="radio" class="type press" aria-checked="' + (t[0] === activeKey ? 'true' : 'false') +
      '" data-type="' + t[0] + '" data-testid="' + tid('type-' + t[0]) + '">' +
      '<span class="tic">' + svg(t[3], 24) + '</span><b>' + t[1] + '</b><span>' + t[2] + '</span></button>'
  }).join('') + '</div>'
}
function consentBlock (mode) {
  var facts = mode === 'loading'
    ? '<div class="facts"><div class="fact"><div class="fk">处理目的与方式</div><div class="fv">' + slot('读取中') + '</div></div>' +
      '<div class="fact"><div class="fk">涉及的数据类别</div><div class="fv">' + slot('读取中') + '</div></div>' +
      '<div class="fact"><div class="fk">最长保留时限</div><div class="fv">' + slot('读取中') + '</div></div></div>'
    : '<div class="facts">' +
      '<div class="fact"><div class="fk">处理目的与方式</div><div class="fv">合同风险提示 · OCR 提取 · 规则检测 · 模型分析</div></div>' +
      '<div class="fact"><div class="fk">涉及的数据类别</div><div class="fv">合同原件 · 合同文字 · AI 审查结果</div></div>' +
      '<div class="fact"><div class="fk">最长保留时限（服务端返回）</div><div class="fv">' + slot('—') + ' 小时</div></div></div>'
  var checked = mode === 'agreed' || mode === 'locked'
  var checkInner = '<span class="cbox">' + svg('check', 24) + '</span>' +
    '<span class="ctxt">我已阅读上述说明，同意本次合同文件用于 AI 签约风险分析</span>'
  var check = mode === 'loading' || mode === 'error'
    ? off('consent-check', 'consent-check', checkInner, tid('consent-reason'))
    : '<button type="button" class="consent-check press" role="checkbox" aria-checked="' + (checked ? 'true' : 'false') +
      '" data-testid="' + tid('consent-check') + '">' + checkInner + '</button>'
  var detail = '<details data-testid="' + tid('consent-detail') + '">' +
    '<summary class="detail-sum press" data-testid="' + tid('consent-toggle') + '">' + svg('book', 26) +
    '<span>展开完整免责声明与知情同意全文</span><span class="dcaret">' + svg('chevron', 24) + '</span></summary>' +
    '<div class="detail-b">' +
    '<div><b>服务性质</b>　本服务仅作风险提示，不构成正式法律意见，也不判断合同是否有效。重大争议请咨询执业律师或官方窗口。</div>' +
    '<div><b>处理链路</b>　合同原件在受控存储中短期用于 OCR 与风险分析，发送模型前脱敏；不向招聘企业或合作机构回传。</div>' +
    '<div><b>受托处理</b>　OCR 与模型推理由服务端登记的受托方处理，具体名单以服务端返回的知情同意为准：' + slot('受托方名单', 'wide') + '</div>' +
    '<div><b>你的权利</b>　可查阅、可要求删除、可撤回同意；删除结果以服务端返回为准，未成功时按最长保留时限自动清理。</div>' +
    '<div><b>版本</b>　知情同意 ' + slot('—') + '　免责声明 ' + slot('—') + '　范围校验值 ' + slot('—') + '</div>' +
    '</div></details>'
  return '<div class="blk">' + facts + check +
    (mode === 'loading' ? why(tid('consent-reason'), '知情同意还没读回来，暂时不能勾选，也不能提交。') : '') +
    detail + '</div>'
}
var HOME_STATES = ['controlled-off', 'consent-loading', 'consent-error', 'ready', 'desktop-channel',
  'file-rejected', 'proof-missing', 'file-ready', 'submit-ready', 'submitting', 'create-failed', 'ai-unavailable']

function homeView (st) {
  if (st === 'controlled-off') {
    return sec('', '', '',
      box('lock', 'lock', 'off-state', '本机未开放 AI 签约风险提示', [
        '这项能力需要终端单独授权后才会出现在服务列表里。当前直接打开合同审查、处理中或结果页，都会回到首页。',
        '未开放期间本机<b>不接收合同文件</b>，也不会保留任何上传记录。'
      ], '开放与否由终端配置决定，本机无法自助开启，也不代表该服务已经上线。') +
      factsRow([['本机是否接收合同', '不接收'], ['是否留下上传记录', '没有记录'], ['是否产生费用', '不产生费用']]) +
      fallbackExits('16-service-hubs.html?hub=resume', '/resume-service', '看看现在能办什么', '简历、材料与打印仍可用') +
      lawBox(true) + humanHelp(),
      'grow centered') +
      cta([link('01-home.html', '/', 'home', 'btn ghost', '回首页'),
        link('16-service-hubs.html?hub=resume', '/resume-service', 'primary', 'btn primary', '返回简历与材料服务')])
  }
  if (st === 'ai-unavailable') {
    return sec('', '', '',
      box('error', 'alert', 'ai-down', 'AI 合同分析服务当前不可用', [
        '服务端这次没有放行新的分析任务，因此<b>不会创建审查任务，也不会上传你的合同</b>。',
        '本机不会用旧结果、示例结果或规则草稿冒充这次分析。'
      ], '服务端未给出可展示原因时，显示：AI 合同分析服务当前未开放，请稍后再试。') +
      factsRow([['合同是否已上传', '没有上传'], ['是否生成了结果', '没有结果'], ['是否产生费用', '不产生费用']]) +
      fallbackExits(url('home', 'ready'), ROUTES.home, '稍后再试一次', '恢复后回到上传合同这一步') +
      lawBox(true) + humanHelp(),
      'grow centered') +
      cta([go('home', 'ready', 'retry', 'btn ghost', '稍后重试'),
        link('16-service-hubs.html?hub=resume', '/resume-service', 'primary', 'btn primary', '返回简历与材料服务')])
  }
  if (st === 'create-failed') {
    return sec('', '', '',
      box('error', 'alert', 'create-failed', '没能创建这次审查任务', [
        '文件已选好，但服务端没有接受这次创建请求。请检查文件格式后重试；<b>本机不会把失败记成已提交</b>。',
        '支持 PDF、Word 与图片；扫描件请尽量拍清楚，或换用文字版 PDF / DOCX。'
      ], '重试仍失败时，先用「打印或扫描纸质合同」把原件处理好再上传。') +
      factsRow([['任务是否已创建', '没有创建'], ['是否开始分析', '没有开始'], ['是否产生费用', '不产生费用']]) +
      fallbackExits(url('home', 'submit-ready'), ROUTES.home, '重新提交这份合同', '回到已选文件与已确认同意的那一步') +
      lawBox(true) + humanHelp(),
      'grow centered') +
      cta([go('home', 'ready', 'reselect', 'btn ghost', '换一份文件'),
        go('home', 'submit-ready', 'primary', 'btn primary', '重新提交')])
  }

  var channel = (st === 'desktop-channel' || st === 'file-rejected') ? 'desktop' : 'phone'
  var hasFile = st === 'file-ready' || st === 'submit-ready' || st === 'submitting' || st === 'proof-missing'
  var consentMode = st === 'consent-loading' ? 'loading'
    : st === 'consent-error' ? 'error'
      : st === 'submit-ready' ? 'agreed'
        : st === 'submitting' ? 'locked' : 'idle'

  var upload
  if (st === 'proof-missing') {
    upload = channelSeg('phone') + fileCard('手机扫码 · 凭证缺失', true) +
      noteline('alert', '<b>这份合同还缺少确认凭证，请重新扫码上传。</b>缺凭证时本机不会把文件发给服务端。', 'warn')
  } else if (hasFile) {
    upload = channelSeg('phone') + fileCard('手机扫码已确认') +
      '<div class="strip">' +
      exit(url('home', 'file-ready'), ROUTES.home, 'flow-1', 'scanText', '1 · 提取文字', '服务端做 OCR，识别合同页面文字') +
      exit(url('home', 'file-ready'), ROUTES.home, 'flow-2', 'clipboard', '2 · 你来确认', '页数与识别质量由你确认后才继续') +
      exit(url('home', 'file-ready'), ROUTES.home, 'flow-3', 'brain', '3 · 风险提示', '每条都要能对回合同原文') +
      '</div>'
  } else if (channel === 'desktop') {
    upload = channelSeg('desktop') + dropZone() +
      (st === 'file-rejected'
        ? noteline('alert', '<b>本机验证文件不能超过 15MB。</b>请压缩后重试，或改用手机扫码上传（单个不超过 10MB）。', 'warn')
        : '')
  } else {
    upload = channelSeg('phone') + qrPanel()
  }

  var consentSection = st === 'consent-error'
    ? sec('03', '知情同意', '读取失败',
      box('error', 'alert', 'consent-error', '无法加载知情同意信息', [
        '没读到本次知情同意的版本与范围，<b>因此不能开始分析</b>。这不代表你的文件有问题。'
      ], '知情同意读不回来时，本机既不上传合同，也不创建任务。') +
      '<div class="strip">' +
      exit(url('home', 'consent-loading'), ROUTES.home, 'consent-retry', 'refresh', '重新读取知情同意', '读到后才允许勾选与提交') +
      exit('08-legal.html', '/legal/privacy', 'consent-legal', 'book', '查看服务与隐私说明', '与本次分析无关的通用条款') +
      '</div>')
    : sec('03', '知情同意', st === 'submitting' ? '本次授权已锁定' : '勾选后才能开始分析', consentBlock(consentMode))

  var primaryReason = ''
  var primaryBtn = ''
  if (st === 'submitting') {
    primaryBtn = off('primary', 'btn primary', '<span class="dots"><i></i><i></i><i></i></span>上传中…', tid('primary-reason'))
    primaryReason = why(tid('primary-reason'), '正在上传并创建审查任务，完成前请不要离开本页。')
  } else if (st === 'submit-ready') {
    primaryBtn = go('processing', 'queued', 'primary', 'btn primary', svg('shield', 26) + '开始风险分析')
  } else {
    var reasonText = st === 'consent-loading' ? '知情同意未就绪，暂时不能提交。'
      : st === 'proof-missing' ? '缺少确认凭证，暂时不能提交。'
        : st === 'file-rejected' ? '这份文件超出本通道上限，请换一份再提交。'
          : hasFile ? '还没有确认本次知情同意。' : '还没有合同文件，也还没有确认知情同意。'
    primaryBtn = off('primary', 'btn primary', svg('shield', 26) + '开始风险分析', tid('primary-reason'))
    primaryReason = why(tid('primary-reason'), reasonText)
  }

  return sec('01', '上传合同', channel === 'phone' ? '手机扫码上传是一体机主通道' : '桌面 / E2E 验证通道',
    '<div class="blk">' + upload + '</div>') +
    sec('02', '合同类型', '决定用哪套规则检测', typeGrid('labor_contract')) +
    consentSection +
    sec('', '', '', noteline('info',
      'AI 只输出<b>可对回原文的风险提示</b>：不判断合同是否有效，不替你决定签或不签，也不改动你的文件。')) +
    cta([link('16-service-hubs.html?hub=resume', '/resume-service', 'back', 'btn ghost', '返回'),
      primaryBtn, primaryReason])
}

/* ── 104 处理中 ─────────────────────────────────────────── */
var STAGES = [
  ['extracting', 'scanText', 'OCR 文字提取', '识别合同页面中的文字内容'],
  ['awaiting_confirmation', 'clipboard', '提取完成确认', '请确认页数与内容覆盖情况'],
  ['rule_checking', 'shield', '规则集检测', '对照劳动法规定逐条检查'],
  ['ai_analyzing', 'brain', 'AI 深度分析', '理解合同语境，识别潜在风险'],
  ['safety_reviewing', 'shield', '安全门审核', '合规性最终核验']
]
var PROC_STATES = ['missing-context', 'queued', 'extracting', 'awaiting-confirmation', 'awaiting-confirmation-low',
  'confirming', 'rule-checking', 'ai-analyzing', 'safety-reviewing', 'completed', 'failed', 'cancelled',
  'expired', 'poll-error', 'delete-failed']

function taskStrip () {
  return '<div class="taskstrip"><span class="tsic">' + svg('doc', 30) + '</span>' +
    '<span class="tsm"><span class="tsn">' + slot('合同文件名', 'wide') +
    '<span class="chip slate">劳动合同</span></span>' +
    '<span class="tsd"><span>任务编号 ' + slot('—') + '</span><span>页数 ' + slot('—') + '</span>' +
    '<span>最长保留剩余 ' + slot('—') + '</span></span></span></div>'
}
function nowBar (title, subtitle, rightLabel, rightValue, busy, icon) {
  return '<div class="nowbar" aria-live="polite"><span class="nbi">' +
    (busy ? '<span class="dots"><i></i><i></i><i></i></span>' : svg(icon || 'check', 32)) + '</span>' +
    '<span class="nbm"><span class="nbt">' + title + '</span><span class="nbs">' + subtitle + '</span></span>' +
    '<span class="nbp"><span>' + rightLabel + '</span><b>' + rightValue + '</b></span></div>'
}
function rail (activeKey, holdKey) {
  var order = STAGES.map(function (s) { return s[0] })
  var activeIdx = activeKey ? order.indexOf(activeKey) : -1
  var holdIdx = holdKey ? order.indexOf(holdKey) : -1
  var cursor = holdIdx >= 0 ? holdIdx : activeIdx
  return '<div class="rail">' + STAGES.map(function (s, i) {
    var done = cursor >= 0 && i < cursor
    var isHold = i === holdIdx
    var isActive = i === activeIdx && !isHold
    var cls = done ? 'done' : isHold ? 'hold' : isActive ? 'active' : ''
    var status = done ? '完成' : isHold ? '等你确认' : isActive ? '进行中' : '待进行'
    var icon = done ? svg('check', 24) : isActive ? '<span class="dots"><i></i><i></i><i></i></span>' : svg(s[1], 24)
    return '<div class="rstep ' + cls + '" data-testid="' + tid('stage-' + s[0]) + '">' +
      '<span class="rsi">' + icon + '</span>' +
      '<span class="rsm"><span class="rsn">' + s[2] + '</span><span class="rsd">' + s[3] + '</span></span>' +
      '<span class="rss">' + status + '</span></div>'
  }).join('') + '</div>'
}
function confirmSheet (low) {
  return '<div class="sheet warn bottom" data-testid="' + tid('confirm-sheet') + '">' +
    '<div class="sheet-h">' + svg('clipboard', 30) + '确认提取结果后再继续</div>' +
    '<p class="sheet-p">文字提取已完成。<b>确认页数与识别质量之前，不会进入 AI 分析。</b>' +
    (low ? '本次部分页面识别置信度偏低，建议先确认原件图像是否清晰。' : '') + '</p>' +
    '<div class="rows">' +
    '<div><span>识别页数</span><b>' + slot('—') + ' / ' + slot('—') + ' 页' +
    (low ? '<span class="chip warn" style="margin-left:12px">已截断</span>' : '') + '</b></div>' +
    '<div><span>识别质量</span><b>' + (low ? '<span class="chip warn">低</span>' : '<span class="chip ok">高</span>') + '</b></div>' +
    '<div><span>合同类型</span><b>劳动合同</b></div>' +
    '</div>' +
    '<div class="ctarow">' +
    go('processing', 'cancelled', 'confirm-cancel', 'btn ghost', '取消审查') +
    go('processing', 'confirming', 'confirm-ok', 'btn primary', svg('check', 26) + '确认，开始分析') +
    '</div></div>'
}
function procView (st) {
  if (st === 'missing-context') {
    return sec('', '', '',
      box('warn', 'clock', 'missing', '本机没有正在进行的审查任务', [
        '本次任务的凭证只存在当前会话里。<b>刷新页面、换用户或直接打开这条地址</b>，都会回到上传页重新开始。',
        '这不代表上一份合同还在服务端等着；未确认的任务会按最长保留时限自动清理。'
      ], '本机不会尝试恢复别人的任务，也不会拿旧任务顶替。') +
      factsRow([['本机有无进行中的任务', '没有'], ['能否恢复上一份合同', '不能恢复'], ['是否产生费用', '不产生费用']]) +
      fallbackExits(url('home', 'ready'), ROUTES.home, '重新上传合同', '回到上传与知情同意这一步') +
      lawBox(true) + humanHelp(),
      'grow centered') +
      cta([link('16-service-hubs.html?hub=resume', '/resume-service', 'back', 'btn ghost', '返回材料服务'),
        go('home', 'ready', 'primary', 'btn primary', '重新上传合同')])
  }
  if (st === 'completed') {
    return sec('01', '本次任务', '服务端已返回完成', taskStrip()) +
      sec('02', '处理阶段', '五个阶段全部结束', rail(null, null).replace(/class="rstep "/g, 'class="rstep done"')
        .replace(/>待进行</g, '>完成<')) +
      sec('', '', '',
        box('ok', 'check', 'completed', '分析已完成', [
          '结果只在<b>本次会话</b>可见：刷新、换用户或结束会话后，本机无法再恢复这次结果。'
        ]) +
        factsRow([['风险提示条数', '在结果页显示'], ['纸质报告', '尚未生成'], ['合同原件', '按最长保留时限清理']]) +
        noteline('scale', '结果只做风险提示：<b>不判断合同是否有效</b>，也不替你决定签或不签。'),
        'grow centered') +
      cta([go('processing', 'cancelled', 'discard', 'btn ghost', '删除并返回'),
        go('result', 'ready', 'primary', 'btn primary', '查看风险提示结果')])
  }
  if (st === 'failed' || st === 'poll-error' || st === 'expired' || st === 'cancelled' || st === 'delete-failed') {
    var conf = {
      failed: ['error', 'alert', '这次分析没有完成', [
        '服务端返回的失败原因：' + slot('由服务端返回具体原因', 'wide'),
        '没有可确认的结果时，本机<b>不会给出任何风险提示条目</b>，也不会进入结果页。'
      ], '未登记的失败码一律走通用文案：分析未能完成，请稍后重试；若反复失败，可换用文字版合同原件（PDF / DOCX）再试一次。'],
      'poll-error': ['error', 'alert', '暂时读不到这次任务的状态', [
        '本机没能取到任务状态。<b>这既不代表已经失败，也不代表已经完成</b>。',
        '恢复网络或稍后重试后，会按服务端返回的真实阶段继续显示。'
      ], '状态读不到时，本机不推测阶段，也不自行跳到结果页。'],
      expired: ['warn', 'clock', '审查任务已超时', [
        '这次任务超过了知情同意中的最长保留时限，<b>已经不会继续分析</b>。请重新上传合同。'
      ], '超时任务不会保留在本机，也无法从本机恢复。'],
      cancelled: ['warn', 'x', '已取消本次审查', [
        '本机已请求删除这次的合同原件、识别文字与中间结果。<b>删除结果以服务端返回为准</b>。'
      ], '若删除请求没有成功，系统仍会按最长保留时限自动清理。'],
      'delete-failed': ['error', 'alert', '删除失败', [
        '合同仍<b>可能处于短期保留状态</b>，请重试删除。',
        '重试仍失败时，系统会按知情同意中的最长保留时限自动清理；失败就是失败，本机不改写这次的删除结果。'
      ], '删除结果只按服务端返回显示，本机不自行判定清理结束。']
    }[st]
    var retry = st === 'delete-failed'
      ? [go('processing', 'cancelled', 'primary', 'btn primary', svg('trash', 26) + '重试删除')]
      : st === 'poll-error'
        ? [go('processing', 'ai-analyzing', 'primary', 'btn primary', svg('refresh', 26) + '重试读取状态')]
        : [go('home', 'ready', 'primary', 'btn primary', '重新上传合同')]
    var facts = {
      failed: [['是否生成了结果', '没有结果'], ['合同原件', '按最长保留时限清理'], ['是否产生费用', '不产生费用']],
      'poll-error': [['任务是否失败', '尚不能确定'], ['任务是否完成', '尚不能确定'], ['本机会不会猜阶段', '不会']],
      expired: [['是否继续分析', '不再继续'], ['本机是否留有副本', '没有副本'], ['是否产生费用', '不产生费用']],
      cancelled: [['是否已请求删除', '已请求'], ['删除是否已确认', '以服务端返回为准'], ['是否产生费用', '不产生费用']],
      'delete-failed': [['删除是否完成', '尚未确认'], ['是否会自动清理', '按最长保留时限'], ['本机是否留有副本', '没有副本']]
    }[st]
    return sec('', '', '',
      box(conf[0], conf[1], st + '-state', conf[2], conf[3], conf[4]) +
      factsRow(facts) +
      fallbackExits(url('home', 'ready'), ROUTES.home, '重新上传合同再试一次', '回到上传与知情同意这一步') +
      lawBox(true) + humanHelp(),
      'grow centered') +
      cta([link('16-service-hubs.html?hub=resume', '/resume-service', 'back', 'btn ghost', '返回材料服务')].concat(retry))
  }

  var map = {
    queued: [null, null, '等待开始', '任务已入队，等待服务端分配处理', '服务端预计用时', slot('—') + ' 秒', true],
    extracting: ['extracting', null, 'OCR 文字提取', '提取完成后会先让你确认页数与识别质量', '已处理', slot('—') + ' / ' + slot('—') + ' 页', true],
    'awaiting-confirmation': [null, 'awaiting_confirmation', '等你确认提取结果', '在你确认之前，本机不会推进到下一阶段', '已提取', slot('—') + ' / ' + slot('—') + ' 页', false, 'clipboard'],
    'awaiting-confirmation-low': [null, 'awaiting_confirmation', '等你确认提取结果', '先核对页数与识别质量，再决定是否继续', '已提取', slot('—') + ' / ' + slot('—') + ' 页', false, 'alert'],
    confirming: ['awaiting_confirmation', null, '正在提交确认', '确认已发出，等待服务端接受后进入规则检测', '已确认页数', slot('—') + ' / ' + slot('—') + ' 页', true],
    'rule-checking': ['rule_checking', null, '规则集检测', '对照劳动法规定逐条检查', '规则集版本', slot('—'), true],
    'ai-analyzing': ['ai_analyzing', null, 'AI 深度分析', '分析结果还要过安全门核验，通过后才会显示', '服务端预计用时', slot('—') + ' 秒', true],
    'safety-reviewing': ['safety_reviewing', null, '安全门审核', '合规性最终核验', '待核验条目', slot('—') + ' 条', true]
  }[st]
  var isHold = st === 'awaiting-confirmation' || st === 'awaiting-confirmation-low'
  var body = sec('01', '本次任务', '文件与凭证只属于这次会话', taskStrip()) +
    sec('02', '处理阶段', '阶段只随服务端返回推进', nowBar(map[2], map[3], map[4], map[5], map[6], map[7]) + rail(map[0], map[1]),
      isHold ? 'grow' : '')
  if (isHold) return body + confirmSheet(st === 'awaiting-confirmation-low')
  return body +
    sec('03', '等待期间', '规则集固定检查这些条款', catGrid() +
      noteline('info', '等待期间不显示百分比、倒计时或预计完成时刻；<b>阶段只在服务端返回新状态时才前进</b>。'), 'grow') +
    cta([go('processing', 'cancelled', 'cancel', 'btn ghost', svg('x', 24) + '取消审查'),
      '<span class="why">阶段由服务端返回推进：本机不跳步、不显示百分比，也不预告完成时间。</span>'])
}

/* ── 105 结果 ───────────────────────────────────────────── */
var CATEGORIES = ['合同主体', '合同期限', '试用期', '薪酬待遇', '岗位与工作地点', '工作时间',
  '社保公积金', '培训服务期', '违约金', '竞业限制', '押金 / 证件', '合同解除 / 终止', '权利义务失衡', '录用条件']
var RESULT_STATES = ['loading', 'ready', 'evidence', 'truncated', 'empty', 'not-found', 'expired',
  'print-enabled', 'print-confirm', 'print-generating', 'print-failed',
  'delete-confirm', 'delete-done', 'delete-failed']
var GROUPS = [
  ['pri', '优先核查', 3],
  ['att', '关注', 4],
  ['inf', '信息不足', 2]
]
/** 规则集固定检查的条款类别（ContractReviewCategory 的全部取值，确定性、非 AI 生成） */
function catGrid () {
  return '<div class="catgrid c4">' + CATEGORIES.map(function (c) { return '<span>' + c + '</span>' }).join('') + '</div>'
}
function statGrid (zero) {
  var v = zero ? '0' : slot('—')
  return '<div class="statgrid">' +
    '<div class="stat pri" data-testid="' + tid('stat-priority') + '"><div class="sv">' + v + '</div><div class="sl">' + svg('alert', 22) + '优先核查</div></div>' +
    '<div class="stat att" data-testid="' + tid('stat-attention') + '"><div class="sv">' + v + '</div><div class="sl">' + svg('info', 22) + '关注</div></div>' +
    '<div class="stat inf" data-testid="' + tid('stat-info') + '"><div class="sv">' + v + '</div><div class="sl">' + svg('info', 22) + '信息不足</div></div></div>'
}
function resultMeta (truncated) {
  return '<div class="meta" style="margin-top:14px">' +
    '<span class="chip ' + (truncated ? 'warn' : 'ok') + '">覆盖 ' + (truncated ? '部分' : '完整') + '</span>' +
    '<span class="chip ok">识别质量 高</span>' +
    '<span class="chip">规则集 ' + slot('—') + '</span>' +
    '<span class="chip">免责声明 ' + slot('—') + '</span>' +
    '<span class="chip slate">由 AI 生成</span></div>'
}
function finding (group, idx, expanded) {
  var id = 'find-' + group + '-' + idx
  return '<div class="find" data-testid="' + tid(id) + '">' +
    '<button type="button" class="find-head press" aria-expanded="' + (expanded ? 'true' : 'false') +
    '" data-find="' + id + '" data-testid="' + tid(id + '-toggle') + '">' +
    '<span class="badge ' + group + '">' + GROUPS.filter(function (g) { return g[0] === group })[0][1] + '</span>' +
    '<span class="find-t">' + slot('风险提示标题', 'wide') + '</span>' +
    '<span class="find-pg">第 ' + slot('—') + ' 页</span>' +
    '<span class="find-caret">' + svg('chevron', 26) + '</span></button>' +
    (expanded
      ? '<div class="find-b swap-in" data-testid="' + tid(id + '-body') + '">' +
        '<div class="excerpt"><span class="ep">' + svg('doc', 20) + ' 合同原文摘录 · 第 ' + slot('—') + ' 页</span>' +
        slot('这里显示合同原文的对应片段', 'full') + '</div>' +
        '<div class="metarows">' +
        '<div><span>说明</span><span>' + slot('为什么值得核查，只依据上面这段原文', 'full') + '</span></div>' +
        '<div><span>法律依据</span><span>' + slot('引用的法律条文出处', 'full') + '</span></div>' +
        '<div><span>条款类别</span><span>' + slot('规则集中的条款分类', 'full') + '</span></div>' +
        '<div><span>局限性</span><span>' + slot('本条不确定在哪里、需要人工核对什么', 'full') + '</span></div>' +
        '</div>' +
        '<div class="ask">' + svg('info', 22) + ' 建议向对方确认：' + slot('可以直接问对方的一句话', 'wide') + '</div>' +
        '</div>'
      : '') + '</div>'
}
function findList (expandedId) {
  var out = ''
  GROUPS.forEach(function (g) {
    out += '<div class="grouphead ' + g[0] + '"><span class="gk"></span>' + g[1] + '（' + slot('—') + ' 项）</div>'
    for (var i = 1; i <= g[2]; i++) out += finding(g[0], i, expandedId === g[0] + '-' + i)
  })
  return '<div class="findbox"><div class="findlist" data-testid="' + tid('list') + '">' + out + '</div></div>'
}
function printReason (enabled) {
  return enabled
    ? noteline('print', '报告只含<b>风险提示，不含合同原件</b>；生成成功后系统会优先清理原合同，随后进入既有报价与打印确认。')
    : noteline('alert', '<b>报告打印暂未开放：</b>本机构建未开启合同报告打印，因此这一步不会生成文件、不产生费用。需要纸质版请到前台咨询。',
      'warn', tid('print-reason'))
}
function resultCta (opts) {
  var printBtn = opts.printEnabled
    ? go('result', 'print-confirm', 'print', 'btn ghost wide', svg('print', 26) + '打印风险提示报告')
    : off('print', 'btn ghost wide', svg('print', 26) + '打印暂未开放', tid('print-reason'))
  return cta([
    go('result', 'not-found', 'restart', 'btn ghost', '重新审查'),
    printBtn,
    go('result', 'delete-confirm', 'primary', 'btn primary', svg('trash', 26) + '结束并删除')
  ])
}
function resultView (st) {
  if (st === 'loading') {
    return sec('', '', '',
      box('info', 'clock', 'loading', '正在打开本次风险提示结果', [
        '读到结果之前，本机<b>不显示任何条数、摘录或依据</b>。'
      ], '结果只在本次会话可见；读取失败会转成对应状态，不会显示上一次的内容。') +
      factsRow([['是否已显示条数', '未显示'], ['是否已显示摘录', '未显示'], ['能否打印或删除', '读到结果后才可']]) +
      '<div class="strip">' + exit(url('processing', 'ai-analyzing'), ROUTES.processing, 'back-processing', 'clock', '回到处理进度', '按服务端返回的阶段继续等待') +
      exit('16-service-hubs.html?hub=resume', '/resume-service', 'exit-material', 'doc', '返回材料服务', '不影响这次任务的保留时限') + '</div>' +
      lawBox(true) + humanHelp(),
      'grow centered') +
      cta([go('processing', 'ai-analyzing', 'back', 'btn ghost', '回到处理进度'),
        off('primary', 'btn primary', '<span class="dots"><i></i><i></i><i></i></span>读取结果中…', tid('primary-reason')),
        why(tid('primary-reason'), '结果还没读到，暂时不能打印或删除。')])
  }
  if (st === 'not-found' || st === 'expired' || st === 'delete-done') {
    var conf = st === 'delete-done'
      ? ['ok', 'check', '已提交删除，服务端已确认', [
        '这次的合同原件与审查结果<b>已按你的要求删除</b>，本机没有留下副本。',
        '删除结论来自服务端返回；本机不自行判定，也不改写这个结果。'
      ], '如需再看一次，请重新上传合同走一遍。']
      : st === 'not-found'
      ? ['warn', 'info', '未找到审查结果', [
        '结果只存在于<b>本次会话</b>。刷新页面、返回上一步或换用户后，本机无法恢复这次结果。',
        '这不代表分析失败；但本机不会拿别的任务或旧结果顶替。'
      ], '需要重新看一次时，请重新上传合同再走一遍。']
      : ['warn', 'clock', '本次会话已到期', [
        '合同与结果已超过知情同意中的<b>最长保留时限</b>，本机不再显示。',
        '到期后不再继续分析，也不会在本机留下副本。'
      ], '到期清理由服务端执行，本机不显示删除完成结论。']
    return sec('', '', '',
      box(conf[0], conf[1], st + '-state', conf[2], conf[3]) +
      factsRow(st === 'delete-done'
        ? [['删除是否完成', '服务端已确认'], ['本机是否留有副本', '没有副本'], ['是否产生费用', '不产生费用']]
        : st === 'not-found'
        ? [['结果是否还在本机', '不在'], ['能否恢复这次结果', '不能恢复'], ['是否产生费用', '不产生费用']]
        : [['是否继续显示结果', '不再显示'], ['本机是否留有副本', '没有副本'], ['清理由谁执行', '服务端按时限执行']]) +
      fallbackExits(url('home', 'ready'), ROUTES.home, '重新上传合同', '回到上传与知情同意这一步') +
      lawBox(true) + humanHelp(),
      'grow centered') +
      cta([link('16-service-hubs.html?hub=resume', '/resume-service', 'back', 'btn ghost', '返回材料服务'),
        go('home', 'ready', 'primary', 'btn primary', '重新上传合同')])
  }
  if (st === 'print-failed' || st === 'delete-failed') {
    var c2 = st === 'print-failed'
      ? ['报告没有生成', [
        '<b>风险提示报告生成或原合同清理未完成，请稍后重试。当前不会进入收费或打印流程。</b>',
        '这次没有生成文件，也没有进入报价、付款或出纸环节；报价与打印仍由既有流程在下一步给出。'
      ], '生成失败时不会创建打印任务，也不会产生费用。', 'print-enabled', svg('refresh', 26) + '重试生成报告']
      : ['立即删除失败', [
        '<b>合同仍可能处于短期保留状态。</b>请重试删除；系统仍会按知情同意中的最长保留时限自动清理。',
        '本机不改写这次的删除结果，也不自行判定清理结束。'
      ], '删除结果只认服务端返回，不由本机推断。', 'delete-confirm', svg('trash', 26) + '重试删除']
    return sec('', '', '',
      box('error', 'alert', st + '-state', c2[0], c2[1], c2[2]) +
      factsRow(st === 'print-failed'
        ? [['是否已创建打印任务', '没有创建'], ['是否产生费用', '不产生费用'], ['结果是否还能看', '本次会话内仍可看']]
        : [['删除是否完成', '尚未确认'], ['是否会自动清理', '按最长保留时限'], ['结果是否还能看', '本次会话内仍可看']]) +
      '<div class="strip">' +
      exit(url('result', 'ready'), ROUTES.result, 'back-result', 'doc', '继续查看风险提示', '结果仍在本次会话内可读') +
      exit('16-service-hubs.html?hub=resume', '/resume-service', 'exit-material', 'doc', '返回材料服务', '保留时限仍按服务端执行') +
      exit('10-print-hub.html', '/print-scan', 'exit-print', 'print', '打印或扫描原件', '不做分析，按普通文件处理') +
      '</div>' + lawBox(true) + humanHelp(),
      'grow centered') +
      cta([go('result', 'ready', 'back', 'btn ghost', '返回结果'),
        go('result', c2[3], 'primary', 'btn primary', c2[4])])
  }
  if (st === 'empty') {
    return sec('01', '本次结果概览', '服务端返回 0 条风险提示', statGrid(true) + resultMeta(false)) +
      sec('02', '风险提示', '本次没有需要优先核查的条款',
        box('ok', 'check', 'empty-state', '未发现明显风险项', [
          'AI 未在这份合同中发现明显风险条款，但仍建议<b>逐条阅读全文</b>；重要条款请咨询执业律师。'
        ], '“没有发现”不等于“没有风险”：识别不到、表述含糊或未覆盖的条款都不会出现在这里。') +
        '<div class="sec-label" style="margin-top:18px;margin-bottom:10px"><span class="t" style="font-size:23px">本次检查覆盖的条款类别</span></div>' +
        catGrid() + lawBox(true),
        'grow') +
      resultCta({ printEnabled: false }).replace('<div class="ctabar">', printReason(false) + '<div class="ctabar">')
  }
  if (st === 'print-confirm' || st === 'print-generating') {
    var busy = st === 'print-generating'
    var sheet = '<div class="sheet bottom" data-testid="' + tid('print-sheet') + '">' +
      '<div class="sheet-h">' + svg('print', 30) + (busy ? '正在生成风险提示报告' : '确认打印风险提示报告') + '</div>' +
      '<p class="sheet-p">' + (busy
        ? '生成成功后才进入报价与打印确认；<b>生成失败不会产生费用，也不会创建打印任务</b>。'
        : '只生成并打印 <b>AI 风险提示报告，不打印合同原件</b>。报告生成成功后，系统会优先清理原合同。') + '</p>' +
      '<div class="rows">' +
      '<div><span>打印内容</span><b>风险提示报告</b></div>' +
      '<div><span>默认参数</span><b>黑白 · A4 · 单面 · 1 份</b></div>' +
      '<div><span>费用</span><b>下一步由服务端报价</b></div>' +
      '</div>' +
      '<div class="ctarow">' + (busy
        ? off('print-busy', 'btn ghost', '暂不打印', tid('print-busy-reason')) +
          off('print-go', 'btn primary', '<span class="dots"><i></i><i></i><i></i></span>生成中…', tid('print-busy-reason')) +
          why(tid('print-busy-reason'), '报告正在生成，完成前不能取消，也还没有进入报价。')
        : go('result', 'print-enabled', 'print-cancel', 'btn ghost', '暂不打印') +
          link('14-print-confirm.html', '/print/confirm', 'print-go', 'btn primary', svg('print', 26) + '生成报告并查看报价')) +
      '</div></div>'
    return sec('01', '本次结果概览', '报告只含风险提示', statGrid(false) + resultMeta(false)) +
      sec('02', '风险提示', '打印前仍可继续查看', findList(null), 'grow') + sheet
  }
  if (st === 'delete-confirm') {
    var sheet2 = '<div class="sheet danger bottom" data-testid="' + tid('delete-sheet') + '">' +
      '<div class="sheet-h">' + svg('trash', 30) + '结束并删除这次合同与结果？</div>' +
      '<p class="sheet-p">确认后本机立即清除本次会话的展示与上下文；<b>服务端删除以真实返回为准</b>。删除失败或未完成时，文件与结果继续按知情同意中的最长保留时限管理。</p>' +
      '<div class="rows">' +
      '<div><span>删除范围</span><b>合同原件 · 识别文字 · 本次风险提示结果</b></div>' +
      '<div><span>删除方式</span><b>立即向服务端发起删除请求</b></div>' +
      '<div><span>删除未成功时</span><b>按知情同意中的最长保留时限自动清理</b></div>' +
      '</div>' +
      '<div class="ctarow">' +
      go('result', 'ready', 'delete-cancel', 'btn ghost', '继续查看结果') +
      go('result', 'delete-done', 'delete-ok', 'btn danger', svg('trash', 26) + '确认删除') +
      '</div></div>'
    return sec('01', '本次结果概览', '删除前最后确认', statGrid(false) + resultMeta(false)) +
      sec('02', '风险提示', '确认删除后本机不再显示', findList(null), 'grow') + sheet2
  }

  var truncated = st === 'truncated'
  var printEnabled = st === 'print-enabled'
  var expanded = st === 'evidence' ? 'pri-1' : null
  return sec('01', '本次结果概览', '条数与版本由服务端返回',
    statGrid(false) + resultMeta(truncated) +
    (truncated
      ? noteline('alert', '<b>合同页数超出本次分析上限，这是部分覆盖。</b>未覆盖的条款不会出现在下面的清单里，请对照纸质原件继续核查。', 'warn')
      : '')) +
    sec('02', '风险提示', st === 'evidence' ? '每条都要能对回合同原文' : '点开任意一条查看原文依据',
      findList(expanded) +
      noteline('scale', '只做风险提示：<b>不判断合同是否有效，也不替你决定签或不签</b>。重大争议请咨询执业律师或官方窗口。'),
      'grow') +
    printReason(printEnabled) +
    resultCta({ printEnabled: printEnabled })
}

/* ── 屏定义 ─────────────────────────────────────────────── */
var SCREENS = {
  home: {
    key: 'contract-home',
    states: HOME_STATES,
    render: homeView,
    back: ['16-service-hubs.html?hub=resume', '/resume-service', '返回简历与材料服务'],
    title: 'AI 签约风险提示',
    sub: {
      'controlled-off': '这项能力尚未在本机开放；下面是现在就能用的替代路径。',
      'consent-loading': '正在读取本次知情同意，读到之后才能勾选并提交。',
      'consent-error': '这一步先停在这里，等知情同意读回来才能继续。',
      ready: '手机扫码把合同传上来，选好类型并确认同意后开始分析。',
      'desktop-channel': '这是桌面验证通道；一体机现场仍以手机扫码为主。',
      'file-rejected': '本机通道有大小上限，这份文件需要换一份或换通道。',
      'proof-missing': '这份合同缺少确认凭证，需要重新扫码上传后才能提交。',
      'file-ready': '合同已确认，接下来确认知情同意就能开始分析。',
      'submit-ready': '文件、类型与授权都齐了，可以开始风险分析。',
      submitting: '任务正在创建；服务端回话之前本机不显示任何结论。',
      'create-failed': '任务没有建起来，可以检查文件后重新提交。',
      'ai-unavailable': '服务端未放行新的分析任务，下面是不依赖 AI 的处理办法。'
    },
    pill: {
      'controlled-off': ['warn', '本机未开放'],
      'consent-loading': ['', '读取知情同意'],
      'consent-error': ['bad', '知情同意读取失败'],
      ready: ['', '等待手机上传合同'],
      'desktop-channel': ['', '等待选择本机文件'],
      'file-rejected': ['warn', '文件超出上限'],
      'proof-missing': ['warn', '缺少确认凭证'],
      'file-ready': ['ok', '合同已确认'],
      'submit-ready': ['ok', '可以开始分析'],
      submitting: ['', '正在创建任务'],
      'create-failed': ['bad', '任务创建失败'],
      'ai-unavailable': ['bad', 'AI 分析不可用']
    }
  },
  processing: {
    key: 'contract-processing',
    states: PROC_STATES,
    render: procView,
    back: null,
    title: 'AI 签约风险提示 · 处理中',
    sub: {
      'missing-context': '本机没有正在进行的任务，请重新上传合同。',
      queued: '任务已入队，阶段只随服务端返回推进。',
      extracting: '正在提取合同文字；页数以服务端返回为准。',
      'awaiting-confirmation': '提取完成，需要你确认页数与识别质量后才继续。',
      'awaiting-confirmation-low': '识别质量偏低，需要你先看清楚再决定继续。',
      confirming: '确认已提交，下一阶段由服务端决定何时开始。',
      'rule-checking': '正在对照规则集逐条检测。',
      'ai-analyzing': 'AI 正在分析合同语境；本机不显示百分比或倒计时。',
      'safety-reviewing': '结果正在做最终核验，通过后才会显示。',
      completed: '分析已完成，结果只在本次会话可见。',
      failed: '这次分析没有完成，下面是不依赖 AI 的处理办法。',
      cancelled: '已取消本次审查，并已请求删除相关内容。',
      expired: '任务超过最长保留时限，不会继续分析。',
      'poll-error': '暂时读不到任务状态；这既不代表失败也不代表完成。',
      'delete-failed': '删除请求没有成功，内容可能仍在短期保留中。'
    },
    pill: {
      'missing-context': ['warn', '没有进行中的任务'],
      queued: ['', '等待开始'],
      extracting: ['', 'OCR 文字提取'],
      'awaiting-confirmation': ['warn', '等你确认'],
      'awaiting-confirmation-low': ['warn', '等你确认 · 置信度偏低'],
      confirming: ['', '正在提交确认'],
      'rule-checking': ['', '规则集检测'],
      'ai-analyzing': ['', 'AI 深度分析'],
      'safety-reviewing': ['', '安全门审核'],
      completed: ['ok', '分析已完成'],
      failed: ['bad', '分析失败'],
      cancelled: ['warn', '已取消'],
      expired: ['warn', '任务已超时'],
      'poll-error': ['bad', '状态读取失败'],
      'delete-failed': ['bad', '删除失败']
    }
  },
  result: {
    key: 'contract-result',
    states: RESULT_STATES,
    render: resultView,
    back: ['16-service-hubs.html?hub=resume', '/resume-service', '返回简历与材料服务'],
    title: '风险提示结果',
    sub: {
      loading: '正在打开本次结果；读到之前不显示任何条数或摘录。',
      ready: '每条提示都能对回合同原文；本页不判断合同效力。',
      evidence: '展开后可看到原文摘录、依据、条款类别与局限性。',
      truncated: '本次为部分覆盖，未覆盖的条款请对照纸质原件核查。',
      empty: '本次没有发现明显风险项，但仍建议逐条阅读全文。',
      'not-found': '这次结果没能打开，只能重新走一遍。',
      expired: '这次会话到期了，需要重新上传才能再看一次。',
      'print-enabled': '这台机器已开启报告打印；费用在下一步给出。',
      'print-confirm': '确认后才生成报告，费用由下一步的服务端报价决定。',
      'print-generating': '报告正在生成，生成失败不会产生费用。',
      'print-failed': '报告这次没做出来，重试之前不会有任何扣费。',
      'delete-confirm': '这一步需要二次确认；取消不会影响本次结果。',
      'delete-done': '服务端已确认删除；本机没有留下副本。',
      'delete-failed': '删除没有成功，内容可能仍在短期保留中。'
    },
    pill: {
      loading: ['', '正在打开结果'],
      ready: ['ok', '结果已就绪'],
      evidence: ['ok', '正在查看原文依据'],
      truncated: ['warn', '部分覆盖'],
      empty: ['ok', '未发现明显风险项'],
      'not-found': ['warn', '未找到结果'],
      expired: ['warn', '会话已到期'],
      'print-enabled': ['ok', '报告打印已开放'],
      'print-confirm': ['', '等待确认打印'],
      'print-generating': ['', '正在生成报告'],
      'print-failed': ['bad', '报告生成失败'],
      'delete-confirm': ['warn', '等待确认删除'],
      'delete-done': ['ok', '已删除'],
      'delete-failed': ['bad', '删除失败']
    }
  }
}

/* ── 渲染 ───────────────────────────────────────────────── */
if (!SCREENS[screen]) screen = 'home'
var page = SCREENS[screen]
SCREEN = page.key
state = query.get('state')
if (page.states.indexOf(state) < 0) state = page.states[0]

var root = document.getElementById('body-root')
root.setAttribute('data-screen', page.key)
root.setAttribute('data-state', state)
root.setAttribute('data-testid', page.key + '-state-' + state)
root.innerHTML = page.render(state)
/* 内容组包一层 .stack：底部主操作条与就地确认台留在 .body 直属层，
   其余区块整组吸收余高或居中，避免把余高变成卡内空洞。 */
;(function () {
  var tail = Array.prototype.filter.call(root.children, function (el) {
    return el.classList.contains('ctabar') || el.classList.contains('sheet')
  })
  var stack = document.createElement('div')
  stack.className = 'stack'
  root.insertBefore(stack, root.firstChild)
  Array.prototype.slice.call(root.children).forEach(function (el) {
    if (el !== stack && tail.indexOf(el) < 0) stack.appendChild(el)
  })
})()
root.classList.add('action-enter')

document.getElementById('task-title').textContent = page.title
document.getElementById('task-sub').innerHTML = page.sub[state]

var capOff = screen === 'home' && state === 'controlled-off'
var capchip = document.getElementById('capchip')
capchip.className = 'capchip' + (capOff ? ' off' : '')
document.getElementById('capchip-txt').textContent = capOff ? '受控能力 · 未开放' : '受控能力 · 本机已授权'

var pillConf = page.pill[state]
document.getElementById('pill').className = 'pill' + (pillConf[0] ? ' ' + pillConf[0] : '')
document.getElementById('pill-txt').textContent = pillConf[1]
document.getElementById('pill-dot').className = 'dot' +
  (/loading|checking|analyzing|reviewing|extracting|confirming|queued|generating/.test(state) ? ' breathe' : '')

/* 处理中不给顶栏返回键：离开必须走「取消审查」，与 React 的 onBack=undefined 一致 */
var backEl = document.getElementById('back-link')
if (!page.back) { backEl.parentNode.removeChild(backEl) } else {
  backEl.setAttribute('href', page.back[0])
  backEl.setAttribute('data-route', page.back[1])
  backEl.setAttribute('aria-label', page.back[2])
}

/* ── 演示面板：只切 data-state，不驱动任何业务结果 ───────── */
var panel = document.getElementById('demo-panel')
var panelHtml = '<div class="dp-t">原型演示控制</div>'
Object.keys(SCREENS).forEach(function (s) {
  SCREENS[s].states.forEach(function (st) {
    panelHtml += '<a href="' + url(s, st) + '"' + (s === screen && st === state ? ' class="on"' : '') + '>' +
      s + ' · ' + st + '</a>'
  })
})
panel.innerHTML = panelHtml
document.getElementById('demo-tab').addEventListener('click', function () { panel.classList.toggle('show') })
if (DEBUG) document.documentElement.classList.add('debug')

/* ── 就地交互 ───────────────────────────────────────────── */
var stage = document.getElementById('stage')

/* 置灰控件真的不放行：捕获阶段拦一次，且它们本身没有 href */
stage.addEventListener('click', function (e) {
  var blocked = e.target.closest('[aria-disabled="true"]')
  if (!blocked) return
  e.preventDefault()
  e.stopPropagation()
}, true)

function replaceState (next) {
  var target = url(screen, next)
  location.replace(target)
}

stage.addEventListener('click', function (e) {
  /* 上传通道切换：就地换通道，不离开本页 */
  var ch = e.target.closest('[data-channel]')
  if (ch) {
    var wanted = ch.getAttribute('data-channel')
    if (wanted === 'desktop' && state !== 'desktop-channel' && state !== 'file-rejected') return replaceState('desktop-channel')
    if (wanted === 'phone' && (state === 'desktop-channel' || state === 'file-rejected')) return replaceState('ready')
    return
  }
  /* 本机通道选文件：静态原型只切到已选文件态，不打开系统文件框 */
  if (e.target.closest('[data-pick]')) return replaceState('file-ready')
  /* 移除文件：回到当前通道的空态 */
  if (e.target.closest('[data-testid="' + tid('remove-file') + '"]')) return replaceState('ready')
  /* 合同类型：就地改选，不跳页 */
  var ty = e.target.closest('[data-type]')
  if (ty) {
    Array.prototype.forEach.call(stage.querySelectorAll('[data-type]'), function (b) {
      b.setAttribute('aria-checked', b === ty ? 'true' : 'false')
    })
    return
  }
  /* 知情同意：勾上才允许提交 —— 勾选后整屏主动作状态随之改变 */
  var cc = e.target.closest('[data-testid="' + tid('consent-check') + '"]')
  if (cc) {
    var on = cc.getAttribute('aria-checked') === 'true'
    if (!on && (state === 'file-ready' || state === 'submit-ready')) return replaceState('submit-ready')
    if (on && state === 'submit-ready') return replaceState('file-ready')
    cc.setAttribute('aria-checked', on ? 'false' : 'true')
    return
  }
  /* 风险提示条：就地展开 / 收起原文依据 */
  var fh = e.target.closest('[data-find]')
  if (fh) {
    var open = fh.getAttribute('aria-expanded') === 'true'
    var card = fh.parentNode
    var body = card.querySelector('.find-b')
    if (open) { if (body) card.removeChild(body) } else {
      var tpl = document.createElement('div')
      tpl.innerHTML = finding(fh.getAttribute('data-find').split('-')[1], fh.getAttribute('data-find').split('-')[2], true)
      var newBody = tpl.firstChild.querySelector('.find-b')
      if (newBody) card.appendChild(newBody)
    }
    fh.setAttribute('aria-expanded', open ? 'false' : 'true')
  }
})

/* 触控回馈：只给真正可操作的元素短促按压态，不截获跳转、不伪造完成 */
var pressSel = 'a[href], button:not([aria-disabled="true"]), summary'
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
})()
