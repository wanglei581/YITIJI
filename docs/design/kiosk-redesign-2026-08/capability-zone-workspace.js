/* ============================================================
   50 · 能力受控专区 —— 视图与状态注册表
   承接四条真实 route：/toolbox（038）、/smart-campus（039）、
   /smart-campus/welcome（040）、/smart-campus/service/:key（042）。
   依赖 policy-campus-workspaces.js 提供的壳层（片段构造、统一渲染、余高四档、
   来源二维码层的焦点陷阱与 Escape 还原、取证模式）；S9 冻结件本批不改一个字节。

   两条贯穿本文件的边界：
   ① 能力没确认之前不给任何业务入口 —— 读取中一屏在真实实现里连返回键都没有，
      本页照实画成任务区零可点元素，不偷偷补一个现实中不存在的出口。
   ② 校园内容一律是通用参考 —— 本机对具体学校一无所知，因此不写学校名、院系名、
      楼栋位置、校历日期与初始密码，办理地点与时间做成诚实空态。
   ============================================================ */
(function () {
'use strict'
var P = window.PCW
var svg = P.svg, slot = P.slot, sec = P.sec, link = P.link, why = P.why
var exit = P.exit, cta = P.cta, rows = P.rows, dsec = P.dsec
var tid = P.tid, url = P.url

/* 壳层的 noteline 形参是 (icon, html, kind)：本文件一度把配色名传进了图标位，
   于是「现场应当开放时⋯」这类提示既拿不到图标（ICO 里没有 warn / slate 这两个名字，
   渲染出一个 24px 的空位），也拿不到 .warn / .slate 的配色。这里按语义收口成三个具名
   构造，调用点不再自己拼 icon 与 kind，也就不会再漂回去。 */
function note (html) { return P.noteline('info', html) }
function noteWarn (html) { return P.noteline('alert', html, 'warn') }
function noteCalm (html) { return P.noteline('info', html, 'slate') }

var HOME = '01-home.html'
var PRINT_UPLOAD = '12-file-source.html'
var RESUME_SOURCE = '21-resume-triage.html'
var JOBS_HOME = '16-service-hubs.html?hub=jobs'

/* ── 本宿主独有的片段 ───────────────────────────────────── */
/** 读取中一屏：屏幕朗读要能播报，但不能有任何出口 —— 真实实现里这一屏没有按钮。 */
function statusState (id, head, paras, extra) {
  return '<div class="state" data-kind="info" data-testid="' + tid(id) + '"' +
    ' role="status" aria-live="polite">' +
    '<div class="state-h"><span class="state-ic">' + svg('refresh', 30) + '</span>' + head + '</div>' +
    paras.map(function (p) { return '<p class="state-p">' + p + '</p>' }).join('') + (extra || '') + '</div>'
}
function state (kind, icon, id, head, paras, extra) {
  return '<div class="state" data-kind="' + kind + '" data-testid="' + tid(id) + '">' +
    '<div class="state-h"><span class="state-ic">' + svg(icon, 30) + '</span>' + head + '</div>' +
    paras.map(function (p) { return '<p class="state-p">' + p + '</p>' }).join('') + (extra || '') + '</div>'
}
function facts (items) {
  return '<div class="facts">' + items.map(function (it) {
    return '<div class="fact"><div class="fk">' + it[0] + '</div><div class="fv">' + it[1] + '</div></div>'
  }).join('') + '</div>'
}
/** 未开放项只占一条紧凑提示，不与可用服务争夺主视野。
    「无入口」不是免责声明，是这一条的事实状态：它在这一屏里既不可点也不会变成卡片。 */
function noEntryStrip (id, icon, head, sub) {
  return '<div class="unavailable-strip" data-testid="' + tid(id) + '">' +
    '<span class="us-ic">' + svg(icon, 24) + '</span>' +
    '<span class="us-copy"><b>' + head + '</b><small>' + sub + '</small></span>' +
    '<span class="us-state">无入口</span></div>'
}
function unavailableStrip (id, count, items) {
  return noEntryStrip(id, 'lock', '另有 ' + count + ' 项暂未开放', items.join(' · '))
}
function emptybox (id, icon, head, body) {
  return '<div class="emptybox" data-testid="' + tid(id) + '">' + svg(icon, 40) +
    '<b>' + head + '</b><span>' + body + '</span></div>'
}
/** 置灰出口：原因写在出口内部并被 aria-describedby 指到，一体机没有 hover，不能靠悬浮提示。 */
function offExit (id, icon, title, reason) {
  var rid = tid(id) + '-why'
  return '<button type="button" class="exit" aria-disabled="true" data-testid="' + tid(id) + '"' +
    ' aria-describedby="' + rid + '"><span class="eic">' + svg(icon, 24) + '</span>' +
    '<span class="etx"><b>' + title + '</b>' +
    '<span class="reason" id="' + rid + '">' + reason + '</span></span></button>'
}

/* ── 扩展项磁贴：站内 / 外部 / 扫码 / 不可用 四种，同一副骨架 ─────────
   标题与说明来自本机配置，静态原型一律占位；能如实读出来的只有启动方式与可用性。
   不预置任何示例第三方服务名 —— 本机没有核验过它们，写出名字就是替第三方背书。 */
var MODE_FACT = {
  internal: ['home', '打开后留在本机'],
  ext: ['nav', '打开后离开本机，先确认目标'],
  qr: ['qr', '在本人手机上打开']
}
function capTile (t) {
  var fact = MODE_FACT[t.mode]
  var head = '<span class="ct-top"><span class="ct-ic">' + svg(t.icon, 30) + '</span>' +
    '<span class="ct-badge">' + t.badge + '</span></span>' +
    '<b>' + t.title + '</b>' +
    '<span class="ct-desc">' + t.desc + '</span>' +
    (fact ? '<span class="ct-mode">' + svg(fact[0], 22) + fact[1] + '</span>' : '')
  if (t.mode === 'off') {
    var rid = tid(t.id) + '-why'
    return '<button type="button" class="captile" aria-disabled="true" data-testid="' + tid(t.id) + '"' +
      ' aria-describedby="' + rid + '">' + head +
      '<span class="reason" id="' + rid + '">' + t.reason + '</span></button>'
  }
  var go = '<span class="ct-go">' + t.go + svg('arrow', 22) + '</span>'
  if (t.mode === 'internal') {
    return '<a class="captile press ' + t.accent + '" href="' + t.href + '" data-route="' + t.route + '"' +
      ' data-testid="' + tid(t.id) + '">' + head + go + '</a>'
  }
  var attr = t.mode === 'qr' ? 'data-qr-open="' + t.open + '"' : 'data-ext-open="' + t.open + '"'
  return '<button type="button" class="captile press ' + t.accent + '" ' + attr +
    ' data-testid="' + tid(t.id) + '">' + head + go + '</button>'
}
function capTiles (list) {
  return '<div class="captiles" data-testid="' + tid('tiles') + '">' + list.map(capTile).join('') + '</div>'
}

/* ── 038 /toolbox ───────────────────────────────────────── */
var TB_TILES = [
  { id: 'item-1', mode: 'internal', icon: 'build', accent: 'a-slate', badge: '站内服务',
    title: '站内扩展服务', desc: '名称与说明按本机配置显示',
    go: '进入服务', href: '10-print-hub.html', route: '/print-scan' },
  { id: 'item-2', mode: 'ext', icon: 'nav', accent: 'a-teal', badge: '外部服务',
    title: '第三方扩展服务', desc: '目标地址需通过本机安全核对',
    go: '打开前会先提示', open: 'tb-ext' },
  { id: 'item-3', mode: 'qr', icon: 'qr', accent: 'a-wheat', badge: '扫码打开',
    title: '手机端扩展服务', desc: '扫码目标由运营方配置提供',
    go: '扫码获取', open: 'tb-qr' },
  { id: 'item-4', mode: 'off', icon: 'qr', badge: '暂不可用',
    title: '未通过核对的配置项', desc: '不展示服务名称，也不生成二维码',
    reason: '这一项的扫码目标没有通过本机的安全核对，所以不打开。' }
]

function toolboxView (st) {
  if (st === 'capability-loading') {
    return sec('', '', '', statusState('loading',
      '百宝箱服务配置检查中 <span class="dots" aria-hidden="true"><i></i><i></i><i></i></span>',
      ['正在读取本机配置。确认完成前不显示扩展服务，也不会沿用上一次的清单。'],
      '<div class="status-skeleton" aria-hidden="true"><i></i><i></i><i></i></div>'))
  }
  if (st === 'capability-disabled') {
    return sec('', '', '', state('lock', 'shield', 'disabled', '本机暂未开启百宝箱服务',
      ['这台机器没有可启动的扩展服务。打印、扫描、简历与岗位信息仍可从首页使用。'])) +
      sec('01', '仍可直接使用', '', unaffectedLinks()) +
      sec('', '', '', noteWarn('现场应当开放时，请向工作人员出示本机编号。')) +
      cta([link(HOME, '/', 'primary', 'btn primary', svg('home', 24) + '返回首页'),
        '<span class="why">其他服务不受影响。</span>'])
  }
  /* ready 与两个启动层共用同一份正文：启动层是盖在这一屏上的，关掉就该看见它。 */
  return sec('01', '本机已上架的扩展服务', '按运营方设定的顺序排列', capTiles(TB_TILES)) +
    sec('02', '打开之前你会知道什么', '三种打开方式都一样',
      '<div class="blk">' + rows([
        ['要去哪里', '打开前先显示目标，由你确认'],
        ['本机记录', '只记录你打开了哪一项'],
        ['第三方页面', '你的输入与办理结果都不记录']
      ]) + '</div>') +
    sec('', '', '', note('外部服务与扫码服务由第三方提供，<b>本机只提供入口，不代办、也不替你确认结果。</b>'))
}

/* ── 039 /smart-campus ──────────────────────────────────── */
var SC_CARDS = [
  { key: 'welcome', module: true, icon: 'cap', accent: 'a-clay', title: '迎新指引',
    desc: '通用报到流程参考与入学准备', to: ['campus-welcome', 'ready'], route: '/smart-campus/welcome' },
  { key: 'luggage', module: true, icon: 'brief', accent: 'a-wheat', title: '行李帮运',
    desc: '服务点、路线与现场协助的通用说明', to: ['campus-service', 'ready-luggage'],
    route: '/smart-campus/service/luggage' },
  { key: 'panorama', module: true, icon: 'map', accent: 'a-slate', title: 'VR校园',
    desc: '全景导览入口，内容接入后才能展示', to: ['campus-service', 'ready-panorama'],
    route: '/smart-campus/service/panorama' },
  { key: 'campus-card', icon: 'badge', accent: 'a-teal', title: '校园卡办理',
    desc: '办卡、补卡与挂失的通用指引', to: ['campus-service', 'ready-campus-card'],
    route: '/smart-campus/service/campus-card' },
  { key: 'all-in-one', icon: 'layers', accent: 'a-clay', title: '一卡通开通',
    desc: '校内消费、门禁与借阅权限说明', to: ['campus-service', 'ready-all-in-one'],
    route: '/smart-campus/service/all-in-one' },
  { key: 'campus-network', icon: 'chart', accent: 'a-deep', title: '校园网开通',
    desc: '上网账号与宿舍网络的通用说明', to: ['campus-service', 'ready-campus-network'],
    route: '/smart-campus/service/campus-network' }
]
var SC_EXT = [
  { id: 'ext-1', mode: 'qr', icon: 'qr', accent: 'a-wheat', badge: '扫码打开',
    title: '校园扩展应用', desc: '名称与目标按本机配置显示',
    go: '扫码获取', open: 'sc-qr' },
  { id: 'ext-2', mode: 'off', icon: 'nav', badge: '暂不可用',
    title: '尚未完成配置', desc: '没有可打开地址时不展示为可用服务',
    reason: '这一项还没有可以打开的地址，运营方补齐后才能启动。' }
]

function scCard (c) {
  return link(url(c.to[0], c.to[1], ''), c.route, 'card-' + c.key, 'capcard press ' + c.accent,
    '<span class="cc-ic">' + svg(c.icon, 28) + '</span><b>' + c.title + '</b>' +
    '<span class="cc-desc">' + c.desc + '</span>' +
    '<span class="cc-go">查看指引' + svg('arrow', 20) + '</span>')
}
function scCards (withModules) {
  var list = SC_CARDS.filter(function (c) { return withModules || !c.module })
  return { n: list.length, html: '<div class="capcards" data-testid="' + tid('cards') + '">' +
    list.map(scCard).join('') + '</div>' }
}
function scBadge (cards, configured) {
  var txt = configured > 0
    ? '可查看指引 ' + cards + ' 项 · 已配置入口 ' + configured + ' 项'
    : '可查看指引 ' + cards + ' 项'
  return '<span class="capcount" data-testid="' + tid('badge') + '">' + svg('list', 22) + txt + '</span>'
}
/** 卡片段的标签行：标题 + 计数徽标。徽标只数这一屏真实渲染出来的东西。 */
function cardsSec (no, title, cards, configured, html) {
  return '<section class="sec"><div class="sec-label"><span class="no serif">' + no + '</span>' +
    '<span class="t">' + title + '</span>' + scBadge(cards, configured) + '</div>' + html + '</section>'
}
/** 校园大数据在真实系统里存在，但这一屏不给它任何入口 —— 那就照实写成一条
    「无入口」的状态条，而不是又一句页脚免责声明，也不是一张点不动的灰卡片。 */
function campusFoot () {
  return sec('', '', '', noEntryStrip('bigdata', 'chart', '校园大数据暂未开放',
    '开放前不展示任何统计数据，本机也不自行估算')) +
    sec('', '', '', noteCalm('本机提供通用指引；实际材料、地点与时间以学校官方通知为准。'))
}

function campusView (st) {
  if (st === 'capability-loading') {
    return sec('', '', '', statusState('loading',
      '智慧校园服务配置检查中 <span class="dots" aria-hidden="true"><i></i><i></i><i></i></span>',
      ['正在读取本机开放的校园服务。确认完成前不显示卡片，也不会沿用上一次的结果。'],
      '<div class="status-skeleton" aria-hidden="true"><i></i><i></i><i></i></div>'))
  }
  if (st === 'capability-disabled') {
    return sec('', '', '', state('lock', 'shield', 'disabled', '本机暂未开启智慧校园服务',
      ['这台机器没有开放校园服务。打印、扫描、简历与岗位信息仍可从首页使用。'])) +
      sec('01', '仍可直接使用', '', unaffectedLinks()) +
      sec('', '', '', noteWarn('校园现场应当开放时，请向工作人员出示本机编号。')) +
      cta([link(HOME, '/', 'primary', 'btn primary', svg('home', 24) + '返回首页'),
        '<span class="why">其他服务不受影响。</span>'])
  }
  if (st === 'ready-base') {
    var base = scCards(false)
    return cardsSec('01', '这台机器可以查看的校园服务', base.n, 0, base.html) +
      sec('', '', '', unavailableStrip('off-list', 3, ['迎新指引', '行李帮运', '全景导览'])) +
      campusFoot()
  }
  var full = scCards(true)
  if (st === 'ready-modules') {
    return cardsSec('01', '这台机器可以查看的校园服务', full.n, 0, full.html) +
      campusFoot()
  }
  /* ready-extensions 与两个启动层共用同一份正文。 */
  return cardsSec('01', '这台机器可以查看的校园服务', full.n, 1, full.html) +
    sec('02', '扩展应用', '由运营方投放，进入第三方前会先提示',
      '<div class="captiles" data-testid="' + tid('ext-tiles') + '">' +
      SC_EXT.map(capTile).join('') + '</div>') +
    campusFoot()
}

/* ── 040 /smart-campus/welcome ──────────────────────────── */
var FLOW = [
  '<b>线上预报到</b><i>按学校官方通知完成信息确认</i>',
  '<b>到校报到</b><i>到学校指定的报到点核验并领取材料</i>',
  '<b>住宿与生活办理</b><i>领取钥匙，办理水电与网络</i>',
  '<b>校园卡与权限开通</b><i>用于校内消费、门禁与借阅</i>'
]
function welcomeView (st) {
  if (st === 'module-blocked') {
    return sec('', '', '', state('lock', 'lock', 'blocked', '本机暂未开启这项智慧校园服务',
      ['迎新指引未在这台机器开放。可返回智慧校园查看当前可用服务。'])) +
      sec('01', '当前仍可查看', '', recoveryLinks()) +
      sec('', '', '', noteWarn('现场应当开放时，请向工作人员出示本机编号。')) +
      cta([link(url('campus', 'ready-base', ''), '/smart-campus', 'primary', 'btn primary',
        svg('arrow', 24) + '返回智慧校园'),
      '<span class="why">可用服务会在校园首页列出。</span>'])
  }
  return sec('01', '报到流程', '四个环节是高校迎新的普遍做法', dsec('list', '通用环节', FLOW, 'numcols')) +
    sec('02', '入学与求职准备', '这三项由本机提供',
      '<div class="strip" data-testid="' + tid('prep') + '">' +
      offExit('prep-photo', 'badge', '证件照排版打印',
        '本机还没有开放这项排版；手机里已有的证件照可以直接去打印扫描。') +
      exit(PRINT_UPLOAD, '/print/upload', 'prep-print', 'print', '入学材料 / 表格打印', '报到表、承诺书等自助打印') +
      exit(RESUME_SOURCE, '/resume/source?intent=diagnose', 'prep-resume', 'doc',
        '第一份简历 · AI 诊断', '到简历页选来源后开始') + '</div>') +
    sec('03', '办事窗口', '',
      emptybox('windows', 'pin', '本机尚未接入学校办事窗口信息',
        '请以学校官方通知、迎新指南或现场指引为准；本机不会凭空给出窗口位置与开放时间。')) +
    sec('', '', '', noteCalm('报到登记、缴费与住宿安排请到学校官方渠道办理；<b>本机不采集你的任何个人信息</b>，也不向学校发送任何内容。')) +
    cta([link(url('campus-service', 'ready-campus-card', ''), '/smart-campus/service/campus-card',
      'primary', 'btn primary', svg('badge', 24) + '查看校园卡办理指引'),
    link(url('campus', 'ready-modules', ''), '/smart-campus', 'to-campus', 'btn ghost press',
      svg('arrow', 22) + '返回智慧校园')])
}

/* ── 042 /smart-campus/service/:key ─────────────────────────
   办理事项与材料只列**通用类别**，办理地点与时间一律做成诚实空态：
   本机没有任何一所学校的窗口、楼栋、时间与初始密码，写出来就是编造。 */
var SERVICES = {
  'campus-card': {
    icon: 'badge', accent: 'a-teal', title: '校园卡办理',
    lead: '校园卡的通用办理说明。是否需要办理、怎么办理，以学校官方通知为准。',
    itemsTitle: '常见办理事项', items: ['首次办理', '遗失补办', '挂失与解挂', '信息变更换卡'],
    matTitle: '常见材料类别',
    mats: ['入学或在校身份证明', '本人有效身份证件', '近期证件照', '学校要求的申请表格'],
    note: '本机不办理校园卡，也不查询你的办卡进度。'
  },
  'all-in-one': {
    icon: 'layers', accent: 'a-clay', title: '一卡通开通',
    lead: '校内消费、门禁与借阅权限的通用说明。开通范围以学校官方通知为准。',
    itemsTitle: '常见开通权限', items: ['校内消费', '楼栋门禁', '图书借阅', '自助充值'],
    matTitle: '常见材料类别', mats: ['本人校园卡', '本人学号或工号'],
    note: '本机不办理开通，也不查询你的开通状态。'
  },
  'campus-network': {
    icon: 'chart', accent: 'a-deep', title: '校园网开通',
    lead: '上网账号与宿舍网络的通用说明。开通方式与资费以学校官方通知为准。',
    itemsTitle: '常见开通内容', items: ['上网账号激活', '宿舍网络开通', '无线网络接入', '资费方案选择'],
    matTitle: '常见材料类别', mats: ['本人学号或工号', '学校发放的开通凭据'],
    note: '本机不代设、不代改上网账号与密码，也不查询你的开通状态。'
  },
  luggage: {
    icon: 'brief', accent: 'a-wheat', title: '行李帮运',
    lead: '行李帮运的通用说明。是否提供这项服务、服务点在哪里，以学校现场指引为准。',
    itemsTitle: '常见服务内容', items: ['行李短驳', '楼栋路线指引', '排队与等候说明', '异常件现场协助'],
    matTitle: '常见材料类别', mats: ['入学或在校身份证明', '本人联系方式'],
    note: '本机不代收费用、不登记行李信息，也不承诺任何送达时间。'
  },
  panorama: {
    icon: 'map', accent: 'a-slate', title: 'VR校园',
    lead: '校园全景导览的通用说明。导览内容接入之后才能展示。',
    itemsTitle: '常见导览内容', items: ['校园主要路线', '教学与实验区', '公共服务场馆', '生活区'],
    matTitle: '需要准备的材料', mats: ['无需材料'],
    note: '全景内容需要接入之后才有，本机不自行绘制，也不用别处的图代替。',
    emptyHead: '本机尚未接入这所学校的全景导览内容',
    emptyNote: '没有真实内容时这里不放占位图；可到现场或学校官方渠道了解校园环境。'
  }
}
var SERVICE_KEYS = ['campus-card', 'all-in-one', 'campus-network', 'luggage', 'panorama']

function taskPanel (id, icon, title, note, items) {
  return '<div class="task-panel" data-testid="' + tid(id) + '"><div class="tp-head"><span>' +
    svg(icon, 28) + '</span><div><b>' + title + '</b><small>' + note + '</small></div></div><div class="tp-grid">' +
    items.map(function (item, i) { return '<div><i>' + (i + 1) + '</i><span>' + item + '</span></div>' }).join('') +
    '</div></div>'
}

/* ── 死路屏的两组出口 ────────────────────────────────────────
   受限屏不给业务入口，但也不该只剩一句「暂未开启」和一颗返回键：那样一屏的高度
   全是空地，用户还得自己想下一步。这两组卡片给的是**这台机器此刻真的能做的事**，
   每张写清去处与它能解决什么，不是拿高度把一张空框撑满。 */
function recoveryCard (href, route, id, icon, title, desc) {
  return link(href, route, id, 'recovery-card press',
    '<span class="rc-ic">' + svg(icon, 27) + '</span>' +
    '<span class="rc-tx"><b>' + title + '</b><small>' + desc + '</small></span>' + svg('arrow', 21))
}
/** 校园侧仍可查看的三项自助服务指引：不受任何子模块开关约束，校园总开关一开就在。 */
function recoveryLinks () {
  var items = [
    ['campus-card', 'ready-campus-card', 'badge', '校园卡办理', '办卡、补卡与挂失的通用指引'],
    ['all-in-one', 'ready-all-in-one', 'layers', '一卡通开通', '消费、门禁与借阅权限说明'],
    ['campus-network', 'ready-campus-network', 'chart', '校园网开通', '上网账号与宿舍网络说明']
  ]
  return '<div class="recovery-grid" data-testid="' + tid('recovery') + '">' + items.map(function (it) {
    return recoveryCard(url('campus-service', it[1], ''), '/smart-campus/service/' + it[0],
      'recovery-' + it[0], it[2], it[3], it[4])
  }).join('') + '</div>'
}
/** 完全不经过这道能力开关的三项本机主服务：能力没开也照常可用。 */
function unaffectedLinks () {
  var items = [
    [PRINT_UPLOAD, '/print/upload', 'print', '打印文件', '上传或扫码后在本机自助打印'],
    [RESUME_SOURCE, '/resume/source?intent=diagnose', 'doc', '简历诊断', '到简历页选来源后开始'],
    [JOBS_HOME, '/jobs-service', 'brief', '查看岗位', '第三方来源岗位信息与去处']
  ]
  return '<div class="recovery-grid" data-testid="' + tid('unaffected') + '">' + items.map(function (it, i) {
    return recoveryCard(it[0], it[1], 'unaffected-' + i, it[2], it[3], it[4])
  }).join('') + '</div>'
}

function serviceReady (key, s) {
  if (key === 'campus-card') {
    return sec('01', '办卡前先核对', '具体要求以学校通知为准',
      taskPanel('card-checks', 'clipboard', '三项准备', '不确定时先问学校服务窗口', [
        '确认是首次办理、补办还是挂失', '准备本人身份证明与学校要求的材料', '核对官方办理地点、时间和收费说明'
      ])) +
      sec('02', '常见材料类别', '不同学校要求不同', dsec('list', '通常需要准备', s.mats, 'cols')) +
      sec('03', '本机可帮助准备', '', '<div class="strip" data-testid="' + tid('doable') + '">' +
        exit(PRINT_UPLOAD, '/print/upload', 'do-print', 'print', '打印办卡材料', '上传学校要求的表格或证件照文件') + '</div>') +
      sec('', '', '', noteCalm(s.note)) +
      /* 服务指引的两个出口是「继续看报到全流程」与「回校园首页换一项」——
         办卡材料的打印入口留在上面的任务区，主操作条不重复放同一个去处。 */
      cta([link(url('campus-welcome', 'ready', ''), '/smart-campus/welcome', 'primary', 'btn primary',
        svg('cap', 24) + '查看迎新报到指引'),
      link(url('campus', 'ready-modules', ''), '/smart-campus', 'to-campus', 'btn ghost press',
        svg('arrow', 22) + '返回智慧校园')])
  }
  if (key === 'all-in-one') {
    return sec('01', '先确认要开通的权限', '',
      taskPanel('one-checks', 'layers', '常见权限', '不同学校开放范围不同', [
        '校内消费与充值', '门禁与楼栋通行', '图书馆借阅或其他校内权限'
      ])) +
      sec('02', '办理前准备', '', dsec('list', '常见材料类别', s.mats, 'cols')) +
      sec('03', '相关指引与本机可做的', '', '<div class="strip" data-testid="' + tid('doable') + '">' +
        exit(url('campus-service', 'ready-campus-card', ''), '/smart-campus/service/campus-card',
          'to-card', 'badge', '校园卡办理指引', '一卡通权限通常挂在校园卡上') +
        exit(PRINT_UPLOAD, '/print/upload', 'do-print', 'print', '打印学校要求的表格',
          '上传文件后在本机自助打印') + '</div>') +
      sec('', '', '', noteCalm(s.note + ' 开通入口、地点与时间请查看学校官方通知。')) +
      cta([link(url('campus', 'ready-modules', ''), '/smart-campus', 'primary', 'btn primary', svg('arrow', 24) + '返回智慧校园')])
  }
  if (key === 'campus-network') {
    return sec('01', '开通前准备', '',
      taskPanel('network-checks', 'chart', '三步核对', '账号、资费和认证方式以学校为准', [
        '确认学校提供的上网账号或开通凭据', '确认宿舍有线与校园无线的接入方式', '核对资费、有效期和官方服务渠道'
      ])) +
      sec('02', '遇到问题时', '', dsec('list', '请优先联系学校网络服务渠道', [
        '账号无法激活：核对身份与开通状态', '能连接但无法上网：检查认证页面与资费状态',
        '宿舍端口无信号：联系现场网络服务人员', '到期后断网：到学校官方渠道续费'
      ], 'cols')) +
      sec('', '', '', noteCalm(s.note)) +
      cta([link(url('campus', 'ready-modules', ''), '/smart-campus', 'primary', 'btn primary', svg('arrow', 24) + '返回智慧校园')])
  }
  if (key === 'luggage') {
    return sec('01', '到现场后怎么做', '',
      taskPanel('luggage-flow', 'brief', '现场办理顺序', '服务是否提供以现场指引为准', [
        '找到学校公布的行李服务点', '核对目的楼栋、领取或交接规则', '贵重物品和证件随身保管'
      ])) +
      sec('02', '出发前准备', '', dsec('list', '建议随身保留',
        ['本人身份证明', '录取或报到信息', '本人联系方式', '行李件数与随身贵重物品'], 'cols')) +
      sec('', '', '', noteCalm(s.note)) +
      cta([link(url('campus', 'ready-modules', ''), '/smart-campus', 'primary', 'btn primary', svg('arrow', 24) + '返回智慧校园')])
  }
  return sec('01', '全景内容尚未接入', '',
    emptybox('place-panorama', 'map', s.emptyHead, s.emptyNote)) +
    sec('02', '现在可以怎么了解校园', '', dsec('list', '可靠替代方式', [
      '查看学校官网或官方迎新通知', '到校后按现场导视了解路线',
      '向学校官方服务窗口咨询', '向已入学的同学当面了解'
    ], 'cols')) +
    sec('03', '同一批开放的其他指引', '', '<div class="strip" data-testid="' + tid('doable') + '">' +
      exit(url('campus-welcome', 'ready', ''), '/smart-campus/welcome', 'to-welcome', 'cap',
        '迎新报到指引', '通用报到环节与入学准备') +
      exit(url('campus-service', 'ready-luggage', ''), '/smart-campus/service/luggage', 'to-luggage',
        'brief', '行李帮运指引', '现场服务点与交接顺序') + '</div>') +
    sec('', '', '', noteCalm(s.note)) +
    cta([link(url('campus', 'ready-modules', ''), '/smart-campus', 'primary', 'btn primary', svg('arrow', 24) + '返回智慧校园')])
}

/* 「本项未开启」与「未找到该服务」是两件事，必须一眼分得开：
   前者 = 这项服务存在，只是这台机器没开它 → 蓝灰锁态 + 说明可以去哪儿看别的；
   后者 = 这个地址压根没有对应服务 → 麦色问号态 + 说明为什么会走到这儿。
   两屏因此走两套正文骨架，而不是同一份模板换一句标题。 */
function serviceView (st) {
  if (st === 'module-blocked') {
    return sec('', '', '', state('lock', 'lock', 'blocked', '本机暂未开启这项智慧校园服务',
      ['这项服务未在本机开放。下面这些指引和主服务都不受影响，可以直接用。'])) +
      sec('01', '这台机器仍可查看的校园指引', '三项自助服务', recoveryLinks()) +
      sec('02', '校园之外仍可直接使用', '不经过这道开关', unaffectedLinks()) +
      sec('', '', '', noteWarn('现场应当开放时，请向工作人员出示本机编号；本机不代为申请开通。')) +
      cta([link(url('campus', 'ready-modules', ''), '/smart-campus', 'primary', 'btn primary',
        svg('arrow', 24) + '返回智慧校园'),
      '<span class="why">可用服务会在校园首页列出。</span>'])
  }
  if (st === 'not-found') {
    return sec('', '', '', state('warn', 'help', 'not-found', '未找到该服务',
      ['这个地址没有对应的校园服务。本机不会替你猜一项相近的服务打开。'])) +
      sec('01', '通常是这几种情况', '都不需要你另外操作',
        taskPanel('nf-why', 'help', '三种常见情况', '看一眼就能判断这次是哪一种', [
          '入口地址已经变更或者过期', '这一项没有在这台机器开放', '扫到的是别处或者过期的码'
        ])) +
      sec('02', '从可用服务重新选择', '三项自助服务', recoveryLinks()) +
      cta([link(url('campus', 'ready-base', ''), '/smart-campus', 'primary', 'btn primary',
        svg('arrow', 24) + '返回智慧校园'),
      '<span class="why">不会自动跳到其他服务。</span>'])
  }
  var key = st.replace(/^ready-/, '')
  var s = SERVICES[key]
  return serviceReady(key, s)
}

/* ── 启动层：扫码层复用壳层的来源二维码层（含焦点陷阱与 Escape 还原）──
   离场确认层用同一个 .qrlayer 骨架自绘，因此也落在同一套焦点与关闭逻辑里。

   两个启动层都必须把「这一下会把我带到哪儿」写在**看得见的那一层**上，而且必须
   把这句话的责任人写清楚：目标是**运营方在本机配置里声明**的，本机既没有去访问它，
   也没有替它做内容担保。所以标签固定写「运营方声明目标」——不写成「目标」（读起来
   像本机核实过），更不写成「官方入口」（那是替第三方背书）。 */
var TARGET_LABEL = '运营方声明目标'
var TARGET_VALUE = '按本机配置显示，本机不代为核实'
var QR = {
  'tb-qr': {
    id: 'tb-qr', page: 'toolbox', state: 'launch-qr', base: 'ready',
    title: '扫码在手机上打开', subject: '扩展服务（名称由配置显示）',
    metas: [['来自', '百宝箱'], [TARGET_LABEL, TARGET_VALUE]],
    note: '请核对服务名称与目标；需要输入账号、证件号或支付信息时，使用本人手机。'
  },
  'sc-qr': {
    id: 'sc-qr', page: 'campus', state: 'launch-qr', base: 'ready-extensions',
    title: '扫码在手机上打开', subject: '校园扩展应用（名称由配置显示）',
    metas: [['来自', '智慧校园'], [TARGET_LABEL, TARGET_VALUE]],
    note: '请核对服务名称与目标；需要输入账号、证件号或支付信息时，使用本人手机。'
  },
  'tb-ext': { id: 'tb-ext', page: 'toolbox', state: 'launch-external', base: 'ready',
    from: '百宝箱 · 扩展服务' },
  'sc-ext': { id: 'sc-ext', page: 'campus', state: 'launch-external', base: 'ready-extensions',
    from: '智慧校园 · 扩展应用' }
}
function extHtml (cfg) {
  return '<div class="qrlayer extlayer" data-testid="' + tid('ext-layer') + '" data-qr-src="' + cfg.id + '"' +
    ' role="dialog" aria-modal="true" aria-labelledby="' + tid('ext-title') + '">' +
    '<div class="qrcard"><div class="ex-h"><span class="ex-ic">' + svg('alert', 30) + '</span>' +
    '<h2 id="' + tid('ext-title') + '">即将进入第三方服务</h2></div>' +
    '<div class="rows" data-testid="' + tid('ext-meta') + '">' +
    '<div><span>本次对象</span><b>扩展服务（名称由配置显示）</b></div>' +
    '<div><span>来自</span><b>' + cfg.from + '</b></div>' +
    '<div><span>' + TARGET_LABEL + '</span><b>' + TARGET_VALUE + '</b></div></div>' +
    '<p class="qr-note">继续后将离开本机页面。需要输入账号、证件号或支付信息时，建议改用本人手机。</p>' +
    '<div class="ctarow">' +
    '<a class="btn ghost press" href="' + HOME + '" data-route="/" data-testid="' + tid('ext-back') + '">' +
    svg('home', 22) + '返回首页</a>' +
    '<button type="button" class="btn primary press" data-ext-confirm="1" data-testid="' +
    tid('ext-go') + '">' + svg('arrow', 22) + '继续打开</button></div></div></div>'
}

/* ── 页面注册表 ─────────────────────────────────────────── */
var PAGES = {
  toolbox: {
    id: 'toolbox-zone', route: '/toolbox', title: '百宝箱',
    back: function () { return [HOME, '/', '返回首页'] },
    render: toolboxView, qr: { 'launch-qr': 'tb-qr' },
    /* table 每行 = [state, 任务副标题, 胶囊色, 胶囊文案]；顺序即状态顺序，首项为默认态。 */
    table: [
      ['capability-loading', '先确认这台机器是否开放百宝箱；确认前不显示任何扩展服务。', '', '正在检查本机配置'],
      ['capability-disabled', '这台机器没有可以启动的扩展服务，因此一项都不显示。', 'warn', '本机未开启'],
      ['ready', '选一项扩展服务打开；站内、外部与扫码三种方式在磁贴上写明。', 'ok', '扩展服务已就绪'],
      ['launch-qr', '扫码在本人手机上打开；本机只提供入口，不代办、不记录结果。', '', '扫码打开入口'],
      ['launch-external', '离场确认：确认目标之后再决定是否离开本机页面。', 'warn', '即将进入第三方']
    ]
  },
  campus: {
    id: 'campus-zone', route: '/smart-campus', title: '智慧校园',
    back: function () { return [HOME, '/', '返回首页'] },
    render: campusView, qr: { 'launch-qr': 'sc-qr' },
    table: [
      ['capability-loading', '先确认这台机器是否开放校园服务；确认前不显示任何卡片。', '', '正在检查本机配置'],
      ['capability-disabled', '这台机器没有开放校园服务，因此不显示任何校园卡片。', 'warn', '本机未开启'],
      ['ready-base', '校园卡、一卡通与校园网的通用指引；其余项要开放后才出现。', 'ok', '基础指引已就绪'],
      ['ready-modules', '这台机器还开放了迎新指引、行李帮运与全景导览，一共六项通用指引。', 'ok', '指引已就绪'],
      ['ready-extensions', '六项通用指引，另有运营方投放的扩展应用可以启动。', 'ok', '指引与扩展已就绪'],
      ['launch-qr', '扫码在本人手机上打开；本机只提供入口，不代办、不记录结果。', '', '扫码打开入口'],
      ['launch-external', '离场确认：确认目标之后再决定是否离开本机页面。', 'warn', '即将进入第三方']
    ]
  },
  'campus-welcome': {
    id: 'campus-welcome', route: '/smart-campus/welcome', title: '迎新指引',
    back: function () { return [url('campus', 'ready-modules', ''), '/smart-campus', '返回智慧校园'] },
    render: welcomeView,
    table: [
      ['module-blocked', '这台机器没有开启迎新指引，因此不显示任何报到流程内容。', 'warn', '本项未开启'],
      ['ready', '看通用报到环节，再把入学与求职准备放到本机能做的三件事上。', 'ok', '通用参考']
    ]
  },
  'campus-service': {
    id: 'campus-service', route: '/smart-campus/service/:key', title: '校园服务',
    back: function () { return [url('campus', 'ready-modules', ''), '/smart-campus', '返回智慧校园'] },
    render: serviceView,
    table: [
      ['ready-campus-card', '核对办卡类型和材料；学校要求的文件可在本机打印。', 'ok', '校园卡 · 通用参考'],
      ['ready-all-in-one', '核对消费、门禁和借阅等开通范围。', 'ok', '一卡通 · 通用参考'],
      ['ready-campus-network', '核对账号、接入方式、资费与官方服务渠道。', 'ok', '校园网 · 通用参考'],
      ['ready-luggage', '按现场服务点、交接规则和行李安全顺序办理。', 'ok', '行李帮运 · 通用参考'],
      ['ready-panorama', '全景内容未接入时，提供可靠替代方式。', 'warn', '全景 · 内容未接入'],
      ['module-blocked', '这台机器没有开启这一项，因此不显示任何办理内容。', 'warn', '本项未开启'],
      ['not-found', '这一项不在本机可以查看的校园服务里，没有内容可以显示。', 'bad', '未找到该服务']
    ]
  }
}
var KEY_OF = { 'toolbox-zone': 'toolbox', 'campus-zone': 'campus',
  'campus-welcome': 'campus-welcome', 'campus-service': 'campus-service' }
/** 常显的通用参考横幅：只挂在真的在讲校园内容的那几屏，
    受限屏没有校园内容，挂上去反而像在解释一件没发生的事。 */
var BANNER = '通用参考 · 不代表任何具体学校的安排；办理材料、地点与时间一律以学校官方通知为准。'
function chrome (k, st) {
  if (k !== 'campus-welcome' && k !== 'campus-service') return ''
  if (st === 'module-blocked' || st === 'not-found') return ''
  return '<p class="tabreason" data-testid="' + PAGES[k].id + '-banner">' + BANNER + '</p>'
}

P.boot(PAGES, 'toolbox', { chrome: chrome, qr: QR })

/* 服务详情标题随真实 key 变化，避免五个页面都显示同一个通用标题。 */
var SERVICE_TITLES = {
  'ready-campus-card': '校园卡办理',
  'ready-all-in-one': '一卡通开通',
  'ready-campus-network': '校园网开通',
  'ready-luggage': '行李帮运',
  'ready-panorama': 'VR校园',
  'module-blocked': '校园服务暂未开放',
  'not-found': '校园服务未找到'
}
function syncServiceTitle () {
  if (P.root.getAttribute('data-screen') !== 'campus-service') return
  var title = SERVICE_TITLES[P.root.getAttribute('data-state')]
  if (title) document.getElementById('task-title').textContent = title
}
syncServiceTitle()
new MutationObserver(syncServiceTitle).observe(P.root, { attributes: true, attributeFilter: ['data-screen', 'data-state'] })

/* ── 离场确认层的挂载：壳层只自动挂来源二维码层，这一层由本文件负责 ────
   关闭与焦点循环仍然走壳层（同一个 .qrlayer 骨架），所以这里只管挂。 */
function currentKey () { return KEY_OF[P.root.getAttribute('data-screen')] }
function mountExt (srcId) {
  if (P.root.querySelector('.extlayer')) return
  var cfg = QR[srcId]
  if (!cfg) return
  var holder = document.createElement('div')
  holder.innerHTML = extHtml(cfg)
  P.root.appendChild(holder.firstChild)
  var back = P.root.querySelector('.extlayer [data-testid$="ext-back"]')
  if (back) back.focus()
}
function syncExt () {
  var k = currentKey()
  if (!k) return
  if (P.root.getAttribute('data-state') !== 'launch-external') return
  mountExt(k === 'toolbox' ? 'tb-ext' : 'sc-ext')
}
syncExt()

P.stage.addEventListener('click', function (e) {
  var opener = e.target.closest('[data-ext-open]')
  if (opener) {
    e.preventDefault()
    var k = currentKey()
    var srcId = opener.getAttribute('data-ext-open')
    P.goState(k, 'launch-external', srcId)
    return mountExt(srcId)
  }
  /* 「继续打开」在真机上会离开本页面前往第三方服务；静态原型不做整页跳转，
     只把这一屏切回扩展服务列表，也不显示任何「已打开」「已办理」的结论。 */
  if (e.target.closest('[data-ext-confirm]')) {
    e.preventDefault()
    var k2 = currentKey()
    return P.goState(k2, k2 === 'toolbox' ? 'ready' : 'ready-extensions', '')
  }
  /* 演示面板或正文里的状态链接切到离场确认态时，壳层先重绘正文，这里补挂那一层。 */
  syncExt()
})

/* 服务 key 域固定为 5 项，与真实实现的白名单一致；静态设计不新增第 6 个。 */
window.CAPABILITY_SERVICE_KEYS = SERVICE_KEYS
})()
