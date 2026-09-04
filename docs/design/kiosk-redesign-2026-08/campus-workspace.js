/* ============================================================
   49 · /campus 校园招聘专区 + /campus/welcome —— 视图与状态注册表
   依赖 policy-campus-workspaces.js 提供的壳层（片段构造、渲染、二维码弹层、取证模式）。
   生产里 /campus 与 /campus/welcome 是两条独立 route（台账 035 / 036）；/campus 的五个
   任务分区在 React 里是组件内部 state，这里用 ?state= 表达，只为逐态取证与直达演示。
   核心边界：**没有选定的真实招聘会就没有任务上下文** —— loading / 无校园场次 / 读取失败
   三态一律不给可进入的任务分区、不挂上下文条、不给预约入口，也不放任何二维码。
   ============================================================ */
(function () {
'use strict'
var P = window.PCW
var svg = P.svg, slot = P.slot, sec = P.sec, box = P.box, link = P.link, off = P.off, why = P.why
var noteline = P.noteline, exit = P.exit, exitOff = P.exitOff, cta = P.cta, rows = P.rows
var deadend = P.deadend, srcRow = P.srcRow, qrBtn = P.qrBtn, qrBtnSm = P.qrBtnSm, tabOff = P.tabOff
var dsec = P.dsec
var tid = P.tid, url = P.url

var TASKS = [
  ['overview', '企业速览', 'layers'], ['companies', '参展企业', 'build'], ['map', '导览图', 'nav'],
  ['ai', 'AI 参会准备', 'sparkle'], ['print', '打印服务', 'print']
]
var TASK_OF = {
  'ready-overview': 'overview', 'stats-unavailable': 'overview', 'source-qr': 'overview',
  'ready-companies': 'companies', 'companies-empty': 'companies',
  'companies-unavailable': 'companies', 'companies-retrying': 'companies',
  'ready-map': 'map', 'map-no-image': 'map', 'zones-empty': 'map', 'zones-unavailable': 'map',
  'zones-retrying': 'map', 'nav-qr': 'map',
  'ready-ai': 'ai', 'ready-ai-consented': 'ai', 'ai-handoff': 'ai',
  'ai-context-missing': 'ai', 'ai-unavailable': 'ai',
  'ready-print': 'print', 'materials-empty': 'print', 'materials-unavailable': 'print'
}
/** 还没有选定招聘会的三态：不给任务分区、不挂上下文条、不给预约入口。 */
var NO_FAIR = ['loading', 'no-campus-data', 'request-error']
var NO_FAIR_WHY = '还没有选定招聘会，这五个分区都要先有一场真实活动才能进入；本机不会先编一场占位。'
/* React 根据当次已返回岗位的标题动态派生并去重；静态稿只画字段位，不把示例类别写成完整枚举。 */
var CAT_CHIPS = ['全部分类', '返回分类一', '返回分类二', '返回分类三', '其他已返回分类']

function bookCta (whyText, disabled) {
  if (disabled) {
    return cta([off('primary', 'btn primary', svg('qr', 24) + '扫码预约 · 去来源平台办理', 'book-why'),
      why('book-why', whyText)])
  }
  return cta(['<button type="button" class="btn primary press" data-qr-open="fair-appointment"' +
    ' data-testid="' + tid('primary') + '">' + svg('qr', 24) + '扫码预约 · 去来源平台办理</button>',
  '<span class="why">' + whyText + '</span>'])
}

/* ── 主体：还没有场次的三态 ─────────────────────────────── */
function campusView (st) {
  if (st === 'loading') {
    return deadend('info', 'refresh', 'loading',
      '正在挑选本校的校园招聘会 <span class="dots" aria-hidden="true"><i></i><i></i><i></i></span>',
      ['选定之前不显示企业数、岗位数或场馆信息，也不会拿上一场顶替。'],
      exit('28-jobfair-enhanced.html', '/job-fairs', 'to-fairs', 'cal', '查看全部招聘会', '不限校园主题') +
      exit('16-service-hubs.html?hub=fairs', '/fairs-service', 'to-hub', 'layers', '返回招聘会服务', '现场服务与到场指引') +
      exit('10-print-hub.html', '/print-scan', 'to-print', 'print', '去打印扫描', '本机随时可用'),
      '这三条都不等这次读取',
      noteline('info', '参展企业、导览图与现场统计会在活动选定后分别读取，其中任何一项没读到都不影响这一页。')
    ) + bookCta('招聘会还没选定，预约入口要等来源信息读回来之后才能给。', true)
  }
  if (st === 'no-campus-data') {
    return deadend('lock', 'cap', 'no-campus', '本机暂时没有校园招聘会',
      ['招聘会<b>读取成功了</b>，只是里面没有校园 / 校招活动。这是内容进度，不是读取失败。',
        '本机不会把综合场次硬凑成校园专区，也不会凭空给出企业、展位或预约二维码。'],
      exit('28-jobfair-enhanced.html', '/job-fairs', 'to-fairs', 'cal', '查看全部招聘会', '不限校园主题') +
      exit('16-service-hubs.html?hub=fairs', '/fairs-service', 'to-hub', 'layers', '返回招聘会服务', '现场服务与到场指引') +
      exit('43-company-directory.html?screen=list', '/companies', 'to-dir', 'build', '看企业目录', '不限本场的企业信息'),
      '现在仍然可以',
      noteline('info', '本校有新的校园招聘会上线后，这一屏会自动换成那一场的信息与预约入口。')
    ) + bookCta('没有选定的招聘会，就没有可预约的来源平台入口。', true)
  }
  if (st === 'request-error') {
    return deadend('error', 'alert', 'load-error', '招聘会这次没读到',
      ['这次读取没有成功，所以本页没有任何活动可展示。<b>这和「确实没有校园招聘会」是两回事</b>，本机分两屏说明。',
        '本机没有拿旧活动顶替，五个分区同样不可进入。'],
      exit('16-service-hubs.html?hub=fairs', '/fairs-service', 'to-hub', 'layers', '返回招聘会服务', '换一条路径看现场服务') +
      exit('10-print-hub.html', '/print-scan', 'to-print', 'print', '去打印扫描', '本机随时可用') +
      exit('26-browse-list.html', '/jobs', 'to-jobs', 'brief', '看第三方岗位', '投递在来源平台办理'),
      '这三条都不依赖这次读取',
      noteline('warn', '重试会留在校园招聘专区重新读取一次，不会把你送回首页。')
    ) + cta([
      link(url('campus', 'loading', ''), '/campus', 'primary', 'btn primary', svg('refresh', 24) + '重新读取'),
      '<span class="why">重试会先回到读取中，本机不把「点了重试」直接显示成读取成功。</span>'
    ])
  }
  var task = TASK_OF[st] || 'overview'
  return task === 'overview' ? overviewTask(st)
    : task === 'companies' ? companiesTask(st)
      : task === 'map' ? mapTask(st)
        : task === 'ai' ? aiTask(st) : printTask(st)
}

/* ── 企业速览 ───────────────────────────────────────────── */
function overviewTask (st) {
  var statsBlock = st === 'stats-unavailable'
    ? box('warn', 'chart', 'stats-off', '现场服务统计这次没有取到',
      ['没取到时本机显示「暂无数据」，<b>不写成 0</b>：0 是一个结论，没取到不是。',
        '活动信息、参展名单、导览图与预约入口都不依赖这一项。'], 'small') +
      '<div style="margin-top:12px">' + rows([
        ['到场企业数', '暂无数据'], ['浏览次数', '暂无数据'], ['扫码次数', '暂无数据']
      ]) + '</div>'
    : rows([['到场企业数', slot('—')], ['浏览次数', slot('—')], ['扫码次数', slot('—')]]) +
      '<div style="margin-top:12px">' + noteline('info',
        '统计只覆盖本机的服务行为，不含任何求职者个人信息；没有可证明的数据时显示「暂无数据」。') + '</div>'
  return sec('', '', '', '<div class="band" data-testid="campus-band">' +
    [['参展企业', '家'], ['招聘岗位', '个'], ['活动类型', ''], ['行业覆盖', '类']].map(function (c) {
      return '<div class="cell"><b>' + slot('—') + '</b><span>' + c[0] + (c[1] ? '（' + c[1] + '）' : '') + '</span></div>'
    }).join('') + '</div>') +
    sec('', '活动信息', '主办方提交 · 以来源平台为准', '<div class="blk">' + rows([
      ['举办时间', slot('—')], ['举办地点', slot('—')], ['现场服务', slot('—')],
      ['入场方式', slot('—')], ['活动状态', slot('—')]
    ]) + '</div>') +
    sec('', '现场服务统计', '系统服务行为数据 · 不含个人信息', '<div class="blk">' + statsBlock + '</div>') +
    (st === 'stats-unavailable' ? '' : sec('', '在招企业', '按在招岗位数排序',
      '<div class="list" data-testid="campus-hot-list">' +
      ['h1', 'h2', 'h3'].map(function (id) {
        return link('44-fair-company-detail.html', '/job-fairs/:id/companies/:companyId', 'hot-' + id, 'item-main',
          '<span class="item-ic clay">' + svg('build', 26) + '</span><span class="item-tx"><b>' +
          slot('企业名称', 'wide') + '</b><span class="item-sub">在招岗位名称由参展名单返回</span></span>' +
          '<span class="item-tail"><span class="tagchip guide">' + slot('—') + ' 个岗位</span>' +
          svg('arrow', 22) + '</span>')
      }).join('') + '</div>')) +
    sec('', '', '', srcRow('') + noteline('info',
      '规模、企业与岗位由主办方提交，本机<b>不核验其真实性</b>；实际到场以入口处公布为准。')) +
    bookCta('预约名额、资格与结果都由来源平台决定，本机只负责把入口给你。')
}

/* ── 参展企业 ───────────────────────────────────────────── */
function companiesTask (st) {
  if (st === 'companies-empty') {
    return deadend('lock', 'build', 'companies-empty', '这一场暂未录入参展企业',
      ['主办方<b>确实没有提交</b>参展企业名单。现场仍可能有企业到场，以入口处公布的名单为准。',
        '导览图、活动资料与预约入口都不依赖这份名单。'],
      link(url('campus', 'ready-map', ''), '/campus', 'to-map', 'exit', '<span class="eic">' + svg('nav', 24) +
        '</span><span class="etx"><b>看导览图与展区</b><span>场馆位置与展位分区</span></span>') +
      exit('43-company-directory.html?screen=list', '/companies', 'to-dir', 'build', '看企业目录', '不限本场的企业信息') +
      exit('26-browse-list.html', '/jobs', 'to-jobs', 'brief', '看第三方岗位', '投递在来源平台办理'),
      '这三条都不依赖参展名单',
      noteline('info', '空名单与读不到名单是两件事，本机分两屏说明；读不到时会给「重新读取名单」。')
    ) + bookCta('名单为空不影响预约：入口仍由来源平台提供。')
  }
  if (st === 'companies-unavailable') {
    return deadend('error', 'alert', 'companies-unavailable', '参展企业名单这次读不到',
      ['<b>这不是「没有企业参展」</b>：读不到和确实为空是两种情况，本机分两屏说明。',
        '招聘会已经选定，导览图、活动资料与预约入口都不受影响。'],
      link(url('campus', 'companies-retrying', ''), '/campus', 'retry-companies', 'exit', '<span class="eic">' + svg('refresh', 24) +
        '</span><span class="etx"><b>重新读取名单</b><span>回到读取中，不直接显示成功</span></span>') +
      link(url('campus', 'ready-map', ''), '/campus', 'to-map', 'exit', '<span class="eic">' + svg('nav', 24) +
        '</span><span class="etx"><b>看导览图与展区</b><span>场馆位置与展位分区</span></span>') +
      exit('43-company-directory.html?screen=list', '/companies', 'to-dir', 'build', '看企业目录', '不限本场的企业信息'),
      '名单之外的内容照常可用',
      noteline('warn', '重新读取只重取这一份名单，不会换掉这一场招聘会。')
    ) + bookCta('名单读取失败不影响预约：入口由来源平台提供。')
  }
  if (st === 'companies-retrying') {
    return deadend('info', 'refresh', 'companies-retrying',
      '正在重新读取参展企业名单 <span class="dots" aria-hidden="true"><i></i><i></i><i></i></span>',
      ['读回来之前不显示任何企业、岗位或展位号，也不会把上一次的失败改写成成功。',
        '重试只重取这一份名单：招聘会不会换，你选好的岗位分类也不会被清掉。'],
      link(url('campus', 'ready-map', ''), '/campus', 'to-map', 'exit', '<span class="eic">' + svg('nav', 24) +
        '</span><span class="etx"><b>看导览图与展区</b><span>不等这次名单</span></span>') +
      link(url('campus', 'ready-print', ''), '/campus', 'to-print-task', 'exit', '<span class="eic">' + svg('print', 24) +
        '</span><span class="etx"><b>去打印服务</b><span>活动资料与自备材料</span></span>') +
      exit('43-company-directory.html?screen=list', '/companies', 'to-dir', 'build', '看企业目录', '不限本场的企业信息'),
      '这三条都不等这次名单',
      noteline('info', '名单读回来会自动出现在这一屏；读不到时仍会如实说明，不会显示成空名单。')
    ) + bookCta('名单还在重取，预约入口不受影响。')
  }
  return sec('', '', '', '<div class="chips" role="group" aria-label="按岗位动态分类筛选" data-testid="campus-cats">' +
    CAT_CHIPS.map(function (c, i) {
      return '<button type="button" class="chip press" aria-pressed="' + (i === 0) + '" data-cat="' + c +
        '" data-testid="campus-cat-' + i + '">' + (i === 0 ? svg('filter', 22) : '') + c + '</button>'
    }).join('') + '</div>' + noteline('info', '除「全部分类」外，选项应从当次已返回的岗位标题动态派生并去重；没有返回的类别不预置。')) +
    sec('', '参展企业', '展位号与行业由主办方提交', '<div class="list" data-testid="campus-company-list">' +
      ['c1', 'c2', 'c3', 'c4'].map(function (id) {
        return '<article class="item" data-company="' + id + '">' +
          link('44-fair-company-detail.html', '/job-fairs/:id/companies/:companyId', 'company-' + id, 'item-main',
            '<span class="item-ic clay">' + svg('build', 26) + '</span><span class="item-tx"><b>' +
            slot('企业名称', 'wide') + '</b><span class="item-sub">行业与在招岗位数由参展名单返回</span></span>' +
            '<span class="item-tail"><span class="tagchip guide">展位 ' + slot('—') + '</span>' + svg('arrow', 22) + '</span>') +
          '</article>'
      }).join('') + '</div>') +
    sec('', '在招岗位', '分类由岗位标题派生，仅用于筛选', '<div class="list" data-testid="campus-position-list">' +
      ['p1', 'p2', 'p3'].map(function (id) {
        return '<article class="item" data-position="' + id + '"><div class="item-main" style="cursor:default">' +
          '<span class="item-ic wheat">' + svg('brief', 26) + '</span><span class="item-tx"><b>' +
          slot('岗位名称', 'wide') + '</b><span class="item-sub">所属企业与要求由参展名单返回</span></span>' +
          '<span class="item-tail"><span class="tagchip guide">' + slot('分类') + '</span></span></div></article>'
      }).join('') + '</div>') +
    /* 页内 AI 增强：名单是这一屏的主内容，AI 只挂在它后面做一个可选的下一步。
       点下去不在本屏生成任何匹配结论、不排序、不收藏、不留痕 —— 先落到「AI 参会
       准备」的本次确认，产品侧真实去处是参会准备（data-route 即 visit-plan）。
       之所以只给企业分区、不给导览图分区挂同类入口：真实输入里没有展区导览上下文，
       挂上去就等于许诺一条本机拿不出的个性化路线。 */
    sec('', '', '', '<div class="strip">' +
      link(url('campus', 'ready-ai', ''), '/job-fairs/:id/visit-plan', 'ai-priority', 'exit',
        '<span class="eic">' + svg('sparkle', 24) + '</span>' +
        '<span class="etx"><b>用本次简历整理优先企业</b>' +
        '<span>去 AI 参会准备确认后生成，本屏名单顺序不变</span></span>') + '</div>') +
    sec('', '', '', noteline('info', '企业与岗位由主办方提交；看完详情<b>仍需去来源平台办理投递</b>，' +
      '本机不代收、不转交简历。')) +
    bookCta('先看企业再决定要不要去，预约仍在来源平台完成。')
}

/* ── 导览图与展区 ───────────────────────────────────────── */
function mapTask (st) {
  var mapBlock = st === 'map-no-image'
    ? box('warn', 'map', 'map-no-image', '主办方没有提供展位平面图',
      ['本机<b>不放灰色占位图</b>，也不用别场的图代替。场馆位置和展区文字信息仍然可用。'], 'small')
    : '<div class="mapslot" data-testid="campus-map-slot">' + svg('map', 96) +
      '<span>主办方提交的展位平面图显示在这里</span></div>'
  var zoneBlock = st === 'zones-empty'
    ? box('lock', 'layers', 'zones-empty', '这一场没有划分展区',
      ['主办方这次<b>确实没有做分区</b>，不是数据丢失。展位号以现场指示牌为准。'], 'small') +
      noteline('info', '没有分区时按<b>展位号顺序</b>找即可；参展企业里每家都带自己的展位号。')
    : st === 'zones-unavailable'
      ? box('error', 'alert', 'zones-unavailable', '展区这次读不到',
        ['<b>读不到不等于没有分区</b>，本机不猜也不用旧数据补。场馆地址与导航入口不受影响。'], 'small') +
        noteline('warn', '这一项失败<b>不阻断</b>场馆信息、导航二维码与来源预约；下面可以只重取展区。') +
        '<div style="margin-top:12px">' + link(url('campus', 'zones-retrying', ''), '/campus', 'retry-zones', 'btn ghost sm',
          svg('refresh', 22) + '重新读取展区') + '</div>'
      : st === 'zones-retrying'
        ? box('info', 'refresh', 'zones-retrying',
          '正在重新读取展区 <span class="dots" aria-hidden="true"><i></i><i></i><i></i></span>',
          ['读回来之前不显示任何展区名称或展位数，也不会把这次重试直接写成成功。'], 'small') +
          noteline('info', '下一屏是展区列表、空列表还是再次失败，由这次读取的结果决定。')
        : '<div class="list" data-testid="campus-zone-list">' + ['z1', 'z2', 'z3'].map(function () {
          return '<div class="item"><div class="item-main" style="cursor:default">' +
            '<span class="item-ic clay">' + svg('layers', 26) + '</span><span class="item-tx"><b>' +
            slot('展区名称', 'wide') + '</b><span class="item-sub">分区说明由主办方提交</span></span>' +
            '<span class="item-tail"><span class="tagchip guide">展位 ' + slot('—') + ' 个</span></span></div></div>'
        }).join('') + '</div>'
  return sec('', '场馆位置', '坐标与地址由主办方提交', '<div class="blk">' + mapBlock +
    '<div style="margin-top:14px">' + rows([['详细地址', slot('—')], ['交通说明', slot('—')]]) + '</div>' +
    '<div style="margin-top:12px">' + qrBtnSm('venue-nav', 'nav-qr', '扫码在手机上导航') + '</div></div>') +
    sec('', '展位分区', '现场以指示牌为准', zoneBlock) +
    sec('', '', '', '<div class="strip">' +
      exit('28-jobfair-enhanced.html', '/job-fairs/:id/map', 'full-map', 'map', '查看完整导览图', '招聘会详情里的完整地图页') +
      exit('28-jobfair-enhanced.html', '/job-fairs/:id/materials', 'materials', 'print', '打印活动资料', '主办方上传的日程与名册') +
      '</div>') +
    bookCta('先确认场馆和展区，再决定是否去来源平台预约。')
}

/* ── AI 参会准备（AI-CONTEXT：授权 → 交接，不在本页生成）──── */
function aiFallbacks () {
  return '<div class="strip">' +
    link(url('campus', 'ready-companies', ''), '/campus', 'fb-companies', 'exit', '<span class="eic">' + svg('build', 24) +
      '</span><span class="etx"><b>自己看参展企业</b><span>按分类筛选，逐家展开</span></span>') +
    link(url('campus', 'ready-map', ''), '/campus', 'fb-map', 'exit', '<span class="eic">' + svg('nav', 24) +
      '</span><span class="etx"><b>自己看导览图</b><span>场馆位置与展位分区</span></span>') +
    exit('28-jobfair-enhanced.html', '/job-fairs/:id/materials', 'fb-print', 'print', '打印活动资料', '主办方上传的日程与名册') +
    '</div>'
}
function aiTask (st) {
  var consented = st === 'ready-ai-consented'
  var head = sec('', 'AI 参会准备', '用你这次上传的简历 + 本场公开信息', '<div class="blk">' + rows([
    ['本次招聘会', slot('招聘会名称', 'wide')],
    ['企业与岗位信息', slot('主办方提交', 'wide')],
    ['你这次的简历', st === 'ai-context-missing' ? '本次还没有上传' : slot('本次上传的简历', 'wide')]
  ]) + '</div>')
  if (st === 'ai-context-missing') {
    return head +
      sec('', '', '', box('lock', 'lock', 'ai-missing', '还没有可用于准备的简历',
        ['要生成参会准备，需要<b>这一场招聘会</b>和<b>你这次上传的简历</b>。现在缺后一个，所以不生成任何内容。',
          '本机不会拿示例简历、别人的简历或历史记录顶替，也不会凭岗位名称编一份清单。'])) +
      sec('', '不用 AI 也能完成的事', '这三条都不经过模型', aiFallbacks()) +
      sec('', '', '', noteline('info', '缺简历只挡住这一项：企业名单、导览图、扫码预约与打印都能照常用。')) +
      cta([off('primary', 'btn primary', svg('sparkle', 24) + '生成参会准备', 'ai-ctx-why'),
        link('21-resume-triage.html', '/resume/source', 'to-resume', 'btn ghost', svg('doc', 22) + '先去简历服务'),
        why('ai-ctx-why', '没有你本次上传的简历就没有真实输入，此时不能生成。')])
  }
  if (st === 'ai-unavailable') {
    return head +
      sec('', '', '', box('error', 'alert', 'ai-down', '这次没能生成参会准备',
        ['本机不显示准备内容，也不会拿上一次的结果冒充这次。',
          '这次请求<b>可能已经送到模型才失败</b>，是否计入用量以服务端记录为准。'])) +
      sec('', '不用 AI 也能完成的事', '这三条都不经过模型', aiFallbacks()) +
      sec('', '', '', noteline('warn', '这一项失败<b>不阻断任何主任务</b>：参展企业、导览图、来源预约与打印都不经过模型。')) +
      cta([off('primary', 'btn primary', svg('sparkle', 24) + '生成参会准备', 'ai-down-why'),
        why('ai-down-why', '模型这次没有返回可用结果；稍后再试，本机不会用旧结果顶替。')])
  }
  if (st === 'ai-handoff') {
    return head +
      sec('', '', '', box('info', 'arrow', 'ai-handoff', '已确认，去参会准备页生成',
        ['下一步会带上<b>这一场招聘会</b>和<b>你这次上传的简历</b>，在参会准备页真正发起生成，' +
          '并在那一页显示进度与结果。',
          '本页<b>本次产出零条</b>：这里没有发起生成，也没有任何清单内容。'])) +
      sec('', '不用 AI 也能完成的事', '这三条都不经过模型', aiFallbacks()) +
      sec('', '', '', noteline('info', '这次确认只在本页有效；生成成功后的结果按服务端规则保留，默认 24 小时。' +
        '内容不会同步给企业、主办方或来源平台。')) +
      cta([
        exit('28-jobfair-enhanced.html', '/job-fairs/:id/visit-plan', 'primary', 'sparkle',
          '去参会准备页生成', '生成在那一页发起'),
        '<span class="why">本机不预告结果，也不预扣服务次数。</span>'
      ])
  }
  return head +
    sec('', '生成后你会拿到什么', '可以重新生成，也可以打印', '<div class="blk">' + rows([
      ['本场重点', '结合招聘会与企业岗位公开信息'],
      ['优先了解的企业', '给出参考原因，不代表企业评价'],
      ['准备清单与提问', '材料清单、可向企业询问的问题'],
      ['现场通用提示', '公开信息层面的提醒，不含展位与日程']
    ]) + '</div>') +
    /* 授权即边界：原先这里另起一块「AI 在这一页不做什么」四行能力清单 —— 那是内部
       口径，用户在确认前要看的只是「这次拿我的什么、不外流到哪」。四行里三行本来就
       写在页脚真话条（不接收简历、不转交企业、不记录预约与投递结果），唯一没被覆盖的
       「不估算录用可能」压进确认控件自己的副行，正好落在按下确认的那一刻。 */
    sec('', '', '', '<button type="button" class="item on press" style="width:100%" aria-pressed="' +
      (consented ? 'true' : 'false') + '" data-consent="1" data-testid="campus-consent">' +
      '<span class="item-main" style="pointer-events:none"><span class="item-ic">' +
      svg(consented ? 'ok' : 'check', 26) + '</span>' +
      '<span class="item-tx"><b>确认用我这次上传的简历生成这场参会准备</b>' +
      '<span class="item-sub">只用于本次生成；不同步给企业或主办方，也不估算你的录用可能</span>' +
      '</span></span></button>') +
    sec('', '不用 AI 也能完成的事', '这三条都不经过模型', aiFallbacks()) +
    (consented
      ? cta([
        link(url('campus', 'ai-handoff', ''), '/campus', 'primary', 'btn primary', svg('sparkle', 24) + '生成参会准备'),
        '<span class="why">已确认。下一步在参会准备页发起生成，本页不生成任何内容。</span>'
      ])
      : cta([off('primary', 'btn primary', svg('sparkle', 24) + '生成参会准备', 'consent-why'),
        why('consent-why', '还没确认这次生成，本页不会把你的简历带去参会准备页。')]))
}

/* ── 打印服务 ───────────────────────────────────────────── */
function printTask (st) {
  var materials
  if (st === 'materials-empty') {
    materials = box('lock', 'layers', 'materials-empty', '这一场还没有上传活动资料',
      ['主办方这次<b>确实没有上传</b>日程、企业名册或导览图。这是内容进度，不是读取失败。',
        '本机不会生成日程或名册，也不会拿别场资料顶替。'], 'small') +
      '<div class="strip">' +
      exitOff('materials-off-btn', 'layers', '打印活动资料 · 暂无资料', '主办方尚未上传任何资料', 'materials-why') +
      exit('12-file-source.html', '/print/upload', 'mat-upload', 'print', '上传自备材料打印', '简历、证件、通知单都可以') +
      '</div>' + why('materials-why', '资料确实为空，本机不给一个点进去只会落空的入口。')
  } else if (st === 'materials-unavailable') {
    materials = box('error', 'alert', 'materials-unavailable', '活动资料这次读不到',
      ['<b>读不到不等于没有资料</b>：主办方可能已经上传，只是这次没取到，本机分两屏说明。',
        '本机不猜条数、不列文件名，也不会用别场资料顶替。'], 'small') +
      '<div class="strip">' +
      exitOff('materials-off-btn', 'layers', '打印活动资料 · 暂不可用', '这次没有读到资料', 'materials-why') +
      exit('12-file-source.html', '/print/upload', 'mat-upload', 'print', '上传自备材料打印', '简历、证件、通知单都可以') +
      '</div>' + why('materials-why', '这次没读到资料，本机不给一个点进去只会落空的入口；重新进入时会再取一次。')
  } else {
    materials = '<div class="strip">' +
      exit('28-jobfair-enhanced.html', '/job-fairs/:id/materials', 'materials-on', 'layers', '打印活动资料',
        '日程 / 企业名册 / 导览图逐份选择') +
      exit('12-file-source.html', '/print/upload', 'mat-upload', 'print', '上传自备材料打印', '简历、证件、通知单都可以') +
      '</div>'
  }
  return sec('', '现场打印', '本机只处理真实存在的文件', '<div class="blk">' + materials + '</div>') +
    sec('', '打印前需要知道的', '这几条与本机能力一致', '<div class="blk">' + rows([
      ['文件来源', '本机上传 / 手机扫码 / U 盘导入'],
      ['纸张幅面', 'A4（不支持 A3）'],
      ['费用', '在打印确认页由服务端报价'],
      ['完成判定', '以打印任务回流为准，本页不显示结果']
    ]) + '</div>') +
    sec('', '简历与文件入口', '', '<div class="tiles">' +
      link('21-resume-triage.html', '/resume/source', 'tile-resume', 'tile',
        '<b>' + svg('doc', 22) + 'AI 简历服务</b><span>上传、扫描、解析、诊断与优化</span>') +
      link('18-scan-workbench.html', '/scan/start', 'tile-scan', 'tile',
        '<b>' + svg('print', 22) + '扫描纸质原件</b><span>在打印机面板完成扫描后回传</span>') +
      link('26-browse-list.html', '/jobs', 'tile-jobs', 'tile',
        '<b>' + svg('brief', 22) + '看第三方岗位</b><span>投递请前往来源平台办理</span>') +
      link('38-member-assets.html', '/me/documents', 'tile-docs', 'tile',
        '<b>' + svg('list', 22) + '我的文档</b><span>本人保存过的文件</span>') +
      '</div>') +
    sec('', '', '', noteline('info', '活动资料只来自主办方上传的文件：本机<b>不生成</b>日程、名册或导览图。')) +
    bookCta('打印之外，预约仍需在来源平台完成。')
}

/* ── /campus/welcome：一屏说清「这里没有内容」，唯一业务出口是返回 /campus。
      不解释保留原因，不列内部去向，不放 AI，也不引导智慧校园。 ─────────── */
function welcomeView () {
  return sec('', '', '', box('lock', 'cap', 'welcome', '当前没有独立的迎新招聘内容',
    ['本校的招聘会、参展企业与来源平台信息都在<b>校园招聘专区</b>，请从下面返回查看。'])) +
    sec('', '返回后可以看到', '', '<div class="blk">' +
      dsec('arrow', '校园招聘专区', ['本校招聘会的时间、地点与来源信息',
        '参展企业与在招岗位，详情去来源平台办理', '场馆导览、展位分区与活动资料打印']) + '</div>') +
    sec('', '', '', noteline('info', '迎新报到、校园卡与网络办理不在这里提供；是否开放请向现场工作人员确认。')) +
    cta([
      link(url('campus', 'ready-overview', ''), '/campus', 'primary', 'btn primary', svg('arrow', 24) + '返回校园招聘专区'),
      '<span class="why">这是本页唯一的主操作。</span>'
    ])
}

/* ── 来源二维码：预约入口与场馆导航各自保留自己的上下文 ──── */
var QR = {
  'fair-appointment': {
    id: 'fair-appointment', page: 'campus', state: 'source-qr', base: 'ready-overview',
    title: '扫码预约 · 去来源平台办理', subject: slot('招聘会名称', 'wide'),
    metas: [['来源类型', '第三方 / 官方校招信息'], ['来源机构', slot('—')],
      ['目标域名', slot('—')], ['本机角色', '只提供入口，不接收简历']],
    note: '预约由来源平台管理：<b>本系统不接收简历、不转交企业、不记录预约结果</b>。' +
      '请核对来源机构与目标域名后用手机扫码。'
  },
  'venue-nav': {
    id: 'venue-nav', page: 'campus', state: 'nav-qr', base: 'ready-map',
    title: '扫码在手机上导航', subject: slot('场馆名称', 'wide'),
    metas: [['来源类型', '主办方提交的场馆坐标'], ['详细地址', slot('—')],
      ['本机角色', '只生成入口，不做路线规划']],
    note: '扫码后由<b>手机地图</b>打开该坐标；本机不做路线规划，也不能确认你是否到场。' +
      '坐标由主办方提交，与现场指示不一致时以现场为准。'
  }
}

/* ── 页面注册表 ─────────────────────────────────────────── */
var PAGES = {
  campus: {
    id: 'campus', route: '/campus', title: '校园招聘专区',
    back: function () { return ['16-service-hubs.html?hub=fairs', '/fairs-service', '返回招聘会服务'] },
    render: campusView, qr: { 'source-qr': 'fair-appointment', 'nav-qr': 'venue-nav' },
    /* table 每行 = [state, 任务副标题, 胶囊色, 胶囊文案]；顺序即状态顺序，首项为默认态。 */
    table: [
      ['loading', '先挑一场本校的校园招聘会作为本专区主体；选定前五个分区不可进入。', '', '正在挑选校园场次'],
      ['no-campus-data', '招聘会读到了，但里面没有校园招聘活动。', 'warn', '无校园招聘会'],
      ['request-error', '这次没读到招聘会，本页没有活动可展示。', 'bad', '招聘会读取失败'],
      ['ready-overview', '规模、活动信息与在招企业都来自主办方提交，预约一律去来源平台。', 'ok', '来源信息已就绪'],
      ['stats-unavailable', '现场服务统计没取到，一律显示「暂无数据」，本机不写成 0。', 'warn', '统计暂无数据'],
      ['source-qr', '预约由来源平台管理，本系统不接收简历、不记录预约结果。', '', '来源平台预约入口'],
      ['ready-companies', '参展企业与岗位按分类筛选；看完详情仍需去来源平台办理投递。', 'ok', '参展名单已就绪'],
      ['companies-empty', '主办方没有提交参展名单；其他分区不受影响。', 'warn', '名单确无数据'],
      ['companies-unavailable', '这次没读到名单；这和「确实没有企业」是两回事。', 'bad', '名单暂不可用'],
      ['companies-retrying', '已重新读取名单，读回来之前不显示任何企业。', '', '正在重取名单'],
      ['ready-map', '场馆位置、展位分区与手机导航入口；坐标由主办方提交。', 'ok', '场馆信息已就绪'],
      ['map-no-image', '这一场没有平面图，本机不放灰色占位图，也不借用别场的图。', 'warn', '无平面图'],
      ['zones-empty', '这一场确实没有划分展区。', 'warn', '未划分展区'],
      ['zones-unavailable', '这次没读到展区，本机不猜也不用旧数据补。', 'bad', '展区暂不可用'],
      ['zones-retrying', '已重新读取展区，读回来之前不显示任何展区。', '', '正在重取展区'],
      ['nav-qr', '扫码后由手机地图打开坐标，本机不做路线规划、不确认到场。', '', '手机导航入口'],
      ['ready-ai', '需要已选招聘会、你这次上传的简历与本次确认。', '', '等待本次确认'],
      ['ready-ai-consented', '已确认使用你这次上传的简历；下一步去参会准备页生成。', 'ok', '本次生成已确认'],
      ['ai-handoff', '生成在参会准备页发起，本页本次产出零条。', '', '去参会准备页生成'],
      ['ai-context-missing', '缺少可用于准备的简历，因此不生成任何内容。', 'warn', '缺少本人简历'],
      ['ai-unavailable', '这次没能生成；请求可能已送到模型才失败，以服务端记录为准。', 'bad', 'AI 生成未完成'],
      ['ready-print', '打印只处理真实存在的文件：主办方资料，或你自己上传的材料。', 'ok', '打印入口可用'],
      ['materials-empty', '主办方还没有上传活动资料。', 'warn', '暂无活动资料'],
      ['materials-unavailable', '这次没读到活动资料；读不到与确实没有分成两屏。', 'bad', '资料暂不可用']
    ]
  },
  welcome: {
    id: 'campus-welcome', route: '/campus/welcome', title: '校园招聘迎新指引',
    back: function () { return [url('campus', 'ready-overview', ''), '/campus', '返回校园招聘专区'] },
    render: welcomeView,
    table: [['ready', '本机没有单独的迎新招聘内容，请回校园招聘专区查看。', 'warn', '无独立迎新内容']]
  }
}
/** 任务分区：选定场次后五态可点；未选定时同样是五个控件，但一律置灰、无 href、原因常显。 */
function chrome (k, st) {
  if (k !== 'campus') return ''
  if (NO_FAIR.indexOf(st) >= 0) {
    return '<nav class="tabbar" style="--tabs:5" aria-label="校园招聘任务分区（当前不可进入）" data-testid="campus-taskbar">' +
      TASKS.map(function (t) { return tabOff('campus-task-' + t[0], t[2], t[1], 'no-fair-why') }).join('') +
      '</nav><p class="tabreason" id="no-fair-why">' + NO_FAIR_WHY + '</p>'
  }
  var active = TASK_OF[st] || 'overview'
  return '<nav class="tabbar" style="--tabs:5" aria-label="校园招聘任务分区" data-testid="campus-taskbar">' +
    TASKS.map(function (t) {
      var target = t[0] === 'overview' ? 'ready-overview' : t[0] === 'companies' ? 'ready-companies'
        : t[0] === 'map' ? 'ready-map' : t[0] === 'ai' ? 'ready-ai' : 'ready-print'
      return '<a class="tab press" href="' + url('campus', target, '') + '" data-route="/campus" data-task="' + t[0] +
        '" data-testid="campus-task-' + t[0] + '"' + (t[0] === active ? ' aria-current="page"' : '') + '>' +
        svg(t[2], 24) + t[1] + '</a>'
    }).join('') + '</nav>'
}
/** 招聘会上下文条：welcome 与「还没有选定场次」的三态都不显示 ——
    没选中场次却挂一条上下文，等于给一个不存在的招聘会占位。 */
function strip (k, st) {
  if (k !== 'campus' || NO_FAIR.indexOf(st) >= 0) return ''
  return '<div class="fairstrip" data-testid="campus-fairstrip">' +
    '<span class="fsi">' + svg('cap', 24) + '</span>' +
    '<span class="fsm"><b>' + slot('招聘会名称', 'wide') + '</b>' +
    '<span>' + slot('举办日期') + '</span><span>' + slot('场馆') + '</span></span>' +
    '<span class="tagchip lib">校园双选</span></div>'
}

P.boot(PAGES, 'campus', { chrome: chrome, strip: strip, qr: QR })

/* ── 就地交互：岗位分类筛选 / 本次授权 ──────────────────── */
P.stage.addEventListener('click', function (e) {
  var cat = e.target.closest('[data-cat]')
  if (cat) {
    Array.prototype.forEach.call(P.stage.querySelectorAll('[data-cat]'), function (c) {
      c.setAttribute('aria-pressed', String(c === cat))
    })
    var first = P.stage.querySelector('[data-company="c1"]')
    if (first) first.hidden = cat.getAttribute('data-cat') !== '全部分类'
    return
  }
  /* 参会准备授权：走壳层统一渲染，勾选后主操作换成真实可点的交接链接；
     授权只是本页临时态，不写 storage，也不带任何个人内容进 URL。 */
  var consent = e.target.closest('[data-consent]')
  if (consent) {
    var on = consent.getAttribute('aria-pressed') === 'true'
    P.goState('campus', on ? 'ready-ai' : 'ready-ai-consented', '')
  }
})
})()
