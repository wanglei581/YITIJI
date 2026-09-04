/* ============================================================
   48 · /renshi 政策服务共享工作台（台账 034）—— 视图与状态注册表
   依赖 policy-campus-workspaces.js 提供的壳层（片段构造、渲染、二维码弹层、取证模式）。
   五个任务分区对应产品真实 query：?tab=policy|eligibility|social|register|notice。
   本文件只描述「服务端这次返回了哪一支」，不发请求、不生成结论、不写任何存储。
   ============================================================ */
(function () {
'use strict'
var P = window.PCW
var svg = P.svg, slot = P.slot, sec = P.sec, box = P.box, link = P.link, off = P.off, why = P.why
var noteline = P.noteline, exit = P.exit, cta = P.cta, rows = P.rows, deadend = P.deadend
var srcRow = P.srcRow, dsec = P.dsec, qrBtn = P.qrBtn, qrBtnSm = P.qrBtnSm, tid = P.tid, url = P.url

/** 身份筛选：与后端 POLICY_AUDIENCES 对齐（apps/kiosk/src/pages/renshi/shared.ts） */
var AUDIENCES = [
  ['all', '全部', 'users'], ['graduate', '高校毕业生', 'cap'], ['flexible', '灵活就业', 'brief'],
  ['migrant', '返乡务工', 'pin'], ['startup', '创业人员', 'build'], ['hardship', '困难群体', 'heart']
]
/** 政策库只放**一条字段骨架**，用来说明「读到条目时长什么样」——
    不预置标题、原文、来源与条数，也不用多行制造「已经有几条真实政策」的印象。
    demoAud 仅供原型演示筛选行为，真实运行时由服务端 audience 字段决定。 */
var LIBRARY_ROWS = [
  { id: 'lib-result', demoAud: 'graduate' }
]
/** 本机内置通用办事指引：对应 apps/kiosk/src/pages/renshi/builtinData.ts 的 5 条。
    条目、条件、材料、步骤与来源地址沿用仓库现有内容；只有「官方入口 / 官方平台」这类
    容易被读成「本系统已核验」的措辞按本轮审查统一改写为「来源入口 / 发布方」，
    见 48-policy-workspace.html 注释里的「设计修正 ①」。 */
var GUIDES = [
  {
    id: 'builtin-job-subsidy', aud: ['graduate', 'hardship'], tag: '补贴指引',
    title: '一次性求职创业补贴', hint: '毕业学年 · 困难条件',
    conditions: ['毕业学年学生或当地政策规定的高校毕业生', '有就业创业意愿，且符合困难家庭、残疾、助学贷款等条件之一', '以学校或发布方公布的申报周期为准'],
    materials: ['身份证明', '学生身份或毕业信息证明', '困难类型证明材料', '本人银行卡或学校要求的账户信息'],
    steps: ['阅读本地政策口径与申报时间', '按学校或发布方要求准备材料', '通过发布方提供的来源入口或学校渠道提交', '等待发布方审核结果'],
    src: '综合整理 · 国家政务服务平台口径', url: 'https://gjzwfw.www.gov.cn/col/col1110/'
  },
  {
    id: 'builtin-flexible-social', aud: ['flexible'], tag: '补贴指引',
    title: '灵活就业社保补贴', hint: '灵活就业登记 · 社保缴纳',
    conditions: ['已按当地要求完成就业或失业登记', '以灵活就业人员身份缴纳社会保险', '符合毕业年限、就业困难认定或当地补贴对象范围'],
    materials: ['身份证明', '就业 / 失业登记信息', '灵活就业承诺或证明', '社保缴费记录', '本人银行卡'],
    steps: ['先完成就业 / 失业登记', '确认社保缴费记录', '准备并核对材料清单', '扫码打开来源入口申请或查询'],
    src: '综合整理 · 参考入口：青岛人社（其他地区请查询当地人社平台）', url: 'https://hrss.qingdao.gov.cn/'
  },
  {
    id: 'builtin-housing-talent', aud: ['graduate'], tag: '住房安家',
    title: '高校毕业生住房 / 安家政策', hint: '住房补贴 · 安家费',
    conditions: ['学历、毕业年限、就业地与社保缴纳状态符合当地政策', '政策可能按批次、公示与年度预算执行', '最终资格以发布方与经办窗口审核为准'],
    materials: ['身份证明', '毕业证 / 学位证', '劳动合同或就业证明', '社保缴纳证明', '住房或租赁相关材料（按当地要求）'],
    steps: ['确认所在城市与毕业时间', '查看发布方的事项说明', '准备学历与就业材料', '扫码打开来源入口办理或查询'],
    src: '综合整理 · 参考入口：青岛人才服务（其他地区请查询当地平台）',
    url: 'https://hrsswb.qingdao.gov.cn/qddbbl/pages/gx.html'
  },
  {
    id: 'builtin-skill-training', aud: ['general'], tag: '技能提升',
    title: '职业技能培训 / 技能提升补贴', hint: '培训目录 · 技能证书',
    conditions: ['参加人社部门认可的培训或评价项目', '取得符合政策要求的证书或结果', '在规定期限内通过发布方公布的渠道申请'],
    materials: ['身份证明', '培训或评价证明', '职业资格 / 技能等级证书', '社保或就业状态材料（按政策要求）'],
    steps: ['查询本地培训目录', '确认培训机构与补贴标准', '完成培训 / 评价', '通过来源入口申领或查询'],
    src: '综合整理 · 人社培训补贴口径', url: 'https://www.12333.gov.cn/job/?channel=12333'
  },
  {
    id: 'builtin-startup-loan', aud: ['startup', 'graduate'], tag: '创业扶持',
    title: '创业担保贷款 / 创业补贴', hint: '一次性创业资助 · 场租',
    conditions: ['创业主体、注册年限、社保缴纳与吸纳就业情况符合当地政策', '贷款与补贴以经办机构审批、银行授信和财政资金安排为准', '不得理解为本平台发放补贴或贷款'],
    materials: ['身份证明', '营业执照或创业主体材料', '社保缴费记录', '场地租赁或经营材料', '银行账户信息（按经办要求）'],
    steps: ['确认创业主体与政策类型', '准备经营与社保材料', '扫码打开来源入口', '线下或线上按发布方公布的流程提交'],
    src: '综合整理 · 参考入口：青岛人社（其他地区请查询当地人社平台）', url: 'https://hrss.qingdao.gov.cn/'
  }
]
/** 办理方式统一口径：本机没有配置线上入口 ≠ 该事项只能线下办理。
    必须在下面几张表之前声明 —— 表在模块求值时就要用到它的值。 */
var OFFLINE_RULE = '本机暂未配置线上入口，办理方式以当地发布渠道为准。'
/** 社保指南：builtinData.ts SOCIAL_GUIDES 的 4 条，措辞按上面同一条口径统一。 */
var SOCIALS = [
  { k: 'query', ic: 'shield', t: '参保信息查询', d: '查询社保参保状态、缴费年限、账户余额',
    s: ['手机扫码打开来源入口', '实名认证（首次需要）', '选择「参保证明」或「缴费记录」', '在线查看或下载'],
    btn: '扫码查询', url: 'https://si.12333.gov.cn/' },
  { k: 'proof', ic: 'clipboard', t: '参保证明打印', d: '参保证明与缴费记录，用于贷款或落户',
    s: ['来源平台可在线查询并下载电子参保证明', '需要纸质盖章证明时，携带身份证前往当地社保经办窗口', '具体窗口与出证方式以当地社保机构公布为准'],
    no: '电子证明可在来源平台下载；<b>纸质盖章件由社保经办窗口开具</b>。' + OFFLINE_RULE },
  { k: 'medical', ic: 'help', t: '医保异地就医备案', d: '跨省就医建议提前备案',
    s: ['通过「国家医保服务平台」App 或小程序办理备案', '登录后选择「异地就医备案」', '填写就医地和参保信息提交申请', '审核方式与时长以平台提示为准'],
    btn: '扫码打开国家医保服务平台', url: 'https://fuwu.nhsa.gov.cn/' },
  { k: 'card', ic: 'badge', t: '社保卡办理/补换', d: '首次申领、挂失补办、换新社保卡',
    s: ['携带身份证前往合作银行或社保经办网点', '填写社保卡申请表', '工作人员采集信息', '制卡领卡周期以银行 / 社保机构告知为准'],
    no: '社保卡由<b>银行或社保经办网点</b>受理。' + OFFLINE_RULE }
]
/** 就业登记：builtinData.ts REGISTER_ITEMS 的真实 3 条。 */
var REGISTERS = [
  { k: 'unemployment', ic: 'scroll', t: '失业登记', p: '领取失业保险金、享受就业援助服务的前提',
    loc: '户籍所在地（或常住地）就业服务大厅',
    m: ['居民身份证原件及复印件', '户口本（或居住证）', '解除/终止劳动合同证明', '本人银行卡', '证件照（规格与张数按当地要求）'] },
  { k: 'employment', ic: 'badge', t: '就业创业登记', p: '享受就业扶持政策、计入社会保障就业档案',
    loc: '就业服务大厅综合受理窗口',
    m: ['居民身份证原件及复印件', '劳动合同（就业）或营业执照（创业）', '证件照（如需变更信息，规格按当地要求）'] },
  { k: 'archive', ic: 'book', t: '人事档案转移', p: '档案迁移至新工作单位或人才中心托管',
    loc: '人才服务中心档案窗口（是否需预约以当地为准）',
    m: ['居民身份证原件', '接收单位档案接收函（盖章）', '原存档机构出具的档案清单'] }
]
/** 条件核对问项字典：services/api/src/policies/policy-eligibility.types.ts 的真实 9 项。 */
var QUESTIONS = [
  ['employment_status', '现在状态', false, ['离职找工作中', '在职想换工作', '应届毕业生', '想创业 / 已创业', '不确定']],
  ['household_social', '户籍社保', true, ['本市户籍', '外地 · 本市缴社保', '外地 · 未缴社保', '不确定']],
  ['unemployed_duration', '离职多久', false, ['1 个月内', '1–6 个月', '6 个月以上', '没工作过', '不确定']],
  ['age_range', '年龄段', true, ['16–24 岁', '25–35 岁', '36–45 岁', '46 岁以上', '不确定']],
  ['graduation_year', '毕业年份', false, ['本年度应届', '毕业 2 年内', '毕业超过 2 年', '不适用', '不确定']],
  ['unemployment_registration', '失业登记', true, ['已办', '没办', '不确定']],
  ['social_insurance_months', '连续缴费', true, ['未缴', '不满 3 个月', '满 3 个月以上', '不确定']],
  ['separation_reason', '离职原因', true, ['裁员 / 合同到期', '本人主动辞职', '其他', '不确定']],
  ['prior_subsidy', '领过同类补贴', false, ['没领过', '领过', '不确定']]
]
/** 服务端固定文案，一字不改（types.ts / eligibilityOutcome.ts）。 */
var PRIVACY_NOTICE = '你填写的答案只用于本次条件比对，不保存、不上传给任何政府或第三方系统，' +
  '结果只在本次会话内展示；任何一项都可以不填，不填的条件会标为「无法判定」。'
var DISCLAIMER = '本结果是把你填写的信息与已录入的政策条件做机械比对，不是资格认定。' +
  '本机不做资格认定、不代办、不收费；能不能办以经办窗口审核为准。'
var COPY_NO_PUBLISHED = '政策库里还没有可核对的政策条目。这是本机的内容录入进度，不是你的核对结果 —— ' +
  '它不代表你不符合任何政策。可以先看「就业政策」里的办事指引，或向经办窗口咨询。'
var COPY_NO_RULES = '本机已发布的政策条目还没有录入可逐条比对的申领条件，因此这次不做机械比对。' +
  '这同样是录入进度，不是你的核对结果；具体条件请看政策原文或向经办窗口核对。'
var SUBMIT_WHY = '一项都不填时每条条件都会判成「无法判定」，结果没有参考价值。请至少选 1 项（不含「不确定」）。'
/** 来源入口统一口径：本系统没有核验过任何外部链接的官方性，只提供入口并要求先核对域名。 */
var SRC_RULE = '来源入口由发布方提供，<b>本系统未核验其官方性</b>；扫码前请核对机构和目标域名。'
var SRC_NOTE = '本系统<b>没有核验过</b>这个链接的官方性，也不代替你办理。请先核对机构和目标域名，' +
  '确认无误再用手机扫码。'

var TABS = [
  ['policy', '就业政策', 'doc'], ['eligibility', '条件核对', 'scale'], ['social', '社保指南', 'shield'],
  ['register', '就业登记', 'clipboard'], ['notice', '政策公告', 'scroll']
]
function host (u) { return u.replace(/^https?:\/\//, '').split('/')[0] }
function guideOf (id) {
  for (var i = 0; i < GUIDES.length; i++) if (GUIDES[i].id === id) return GUIDES[i]
  return null
}

/* ── 政策库 / 通用办事指引：两个分区，两套空态，永不合并 ── */
function audChips (active) {
  return '<div class="chips" role="group" aria-label="按身份筛选政策事项" data-testid="' + tid('audience') + '">' +
    AUDIENCES.map(function (a) {
      return '<button type="button" class="chip press" aria-pressed="' + (a[0] === active) + '" data-aud="' + a[0] +
        '" data-testid="' + tid('aud-' + a[0]) + '">' + svg(a[2], 22) + a[1] + '</button>'
    }).join('') + '</div>'
}
function libraryRow (row, open, aiMode) {
  return '<article class="item' + (open ? ' on' : '') + '" data-item="' + row.id + '" data-aud-of="' + row.demoAud + '">' +
    '<button type="button" class="item-main press" aria-expanded="' + (open ? 'true' : 'false') +
    '" data-acc="' + row.id + '" data-testid="' + tid('item-' + row.id) + '">' +
    '<span class="item-ic slate">' + svg('doc', 26) + '</span>' +
    '<span class="item-tx"><b>' + slot('政策标题', 'wide') + '</b>' +
    '<span class="item-sub">展开可看政策原文、来源机构与办理入口</span></span>' +
    '<span class="item-tail"><span class="tagchip lib">已审核发布</span>' +
    '<span class="caret">' + svg('chevron', 24) + '</span></span></button>' +
    (open ? libraryDetail(row.id, aiMode) : '') + '</article>'
}
function sourceActions (id, mode, printId) {
  if (mode === 'source-missing' || mode === 'source-invalid') {
    var text = mode === 'source-missing' ? '发布方没有提供来源地址' : '来源地址不是有效的网址'
    return '<div class="strip">' +
      off('qr-' + id, 'exit', '<span class="eic">' + svg('qr', 24) +
        '</span><span class="etx"><b>来源二维码暂不可用</b><span>' + text + '</span></span>', 'source-why') +
      exit('12-file-source.html', '/print/upload', printId, 'print', '上传自备材料打印', '本机只打印你自己带来的文件') +
      '</div>' + why('source-why', text + '；本机不会猜地址或补链接。')
  }
  return '<div class="strip">' +
    qrBtn(id, 'qr-' + id, '扫码打开来源链接', '先核对机构和目标域名再用手机访问') +
    exit('12-file-source.html', '/print/upload', printId, 'print', '上传自备材料打印', '本机只打印你自己带来的文件') +
    '</div>'
}
function libraryDetail (id, aiMode) {
  var manual = aiMode === 'manual'
  return '<div class="acc-body swap-in" data-testid="' + tid('item-' + id + '-body') + '">' +
    '<div class="quote"><span class="qp">政策原文</span>' +
    slot('', 'full') + slot('', 'full') + (manual ? slot('', 'full') + slot('', 'full') : '') + '</div>' +
    srcRow('<span class="chip">发布日期 <b>' + slot('—') + '</b></span>') +
    (manual ? '' : aiRow(aiMode)) +
    sourceActions(id, aiMode, 'print-' + id) + '</div>'
}
/** AI-CONTEXT 就地入口：只在真实政策条目旁出现一次，克制到一行原因 + 一个禁用控件。
    当前小青技能白名单里没有政策场景，所以本页任何状态都不给可点的 AI 入口，
    也不声称能自动带入这条政策；看原文、来源与条件核对全部不经过模型。 */
function manualSrc () {
  return link(url('policy', 'manual-view-source', ''), '/renshi?tab=policy', 'manual-src', 'exit',
    '<span class="eic">' + svg('eye', 24) + '</span><span class="etx"><b>自己看原文与来源</b>' +
    '<span>不经过模型的人工核对</span></span>')
}
/** 一行原因 + 一个置灰控件 + 一条人工退路，就是这一页 AI 的全部体积。 */
function aiOff (title, desc, reason) {
  return why('ai-why', reason) + '<div class="strip">' +
    off('ai-open', 'exit', '<span class="eic">' + svg('chat', 24) +
      '</span><span class="etx"><b>' + title + '</b><span>' + desc + '</span></span>', 'ai-why') +
    manualSrc() + '</div>'
}
function aiRow (mode) {
  if (mode === 'missing') {
    return aiOff('本条暂未接入小青', '本机整理的参考指引',
      '这条没有政策原文可引用；政策库条目同样暂未接入小青。')
  }
  if (mode === 'down') {
    return aiOff('小青这次连不上', '稍后可以再试',
      '小青连不上。看原文、筛选、扫码与条件核对都不经过它，可以继续用。')
  }
  return aiOff('本条政策暂未接入小青', '小青还不能解释政策原文',
    '小青暂不解释政策，也不判断你能不能办；请看原文或向经办窗口核对。')
}
function guideRow (g, open, aiMode) {
  return '<article class="item' + (open ? ' on' : '') + '" data-item="' + g.id + '" data-aud-of="' + g.aud.join(' ') + '">' +
    '<button type="button" class="item-main press" aria-expanded="' + (open ? 'true' : 'false') +
    '" data-acc="' + g.id + '" data-testid="' + tid('item-' + g.id) + '">' +
    '<span class="item-ic wheat">' + svg('book', 26) + '</span>' +
    '<span class="item-tx"><b>' + g.title + '</b><span class="item-sub">' + g.hint + '</span></span>' +
    '<span class="item-tail"><span class="tagchip guide">' + g.tag + '</span>' +
    '<span class="caret">' + svg('chevron', 24) + '</span></span></button>' +
    (open ? guideDetail(g, aiMode) : '') + '</article>'
}
function guideDetail (g, aiMode) {
  return '<div class="acc-body swap-in" data-testid="' + tid('item-' + g.id + '-body') + '">' +
    dsec('badge', '先看是否符合', g.conditions) +
    dsec('list', '需要准备材料', g.materials, 'cols') +
    dsec('arrow', '建议办理路径', g.steps, 'numcols') +
    '<div class="srcrow"><span class="chip">整理来源 <b>' + g.src + '</b></span></div>' +
    (aiMode === 'missing' ? aiRow('missing') : noteline('info', SRC_RULE)) +
    '<div class="strip">' +
    qrBtn(g.id, 'qr-' + g.id, '扫码打开来源链接', '手机访问前请核对机构和目标域名') +
    exit('12-file-source.html', '/print/upload', 'print-' + g.id, 'print', '上传自备材料打印', '本机只打印你自己带来的文件') +
    '</div></div>'
}
function policyList (aud, libEmpty, expandId, aiMode) {
  var libVisible = libEmpty ? [] : LIBRARY_ROWS.filter(function (r) { return aud === 'all' || r.demoAud === aud })
  var guideVisible = GUIDES.filter(function (g) {
    return aud === 'all' || g.aud.indexOf(aud) >= 0 || g.aud.indexOf('general') >= 0
  })
  /* 选中哪一条：expandId 为空串表示「这一屏不展开任何条目」（空态屏的主内容是空态本身）；
     指定了却被身份筛选挡掉时回落到第一条可见条目 —— 与 React 的
     selected = 命中项 ?? selectable[0] 同口径，避免筛完之后详情整块消失。 */
  var visibleIds = libVisible.map(function (r) { return r.id })
    .concat(guideVisible.map(function (g) { return g.id }))
  if (expandId && visibleIds.indexOf(expandId) < 0) expandId = visibleIds[0] || ''
  var libInner = libVisible.length
    ? '<div class="list" data-testid="' + tid('library-list') + '">' + libVisible.map(function (r) {
      return libraryRow(r, r.id === expandId, aiMode)
    }).join('') + '</div>'
    : box('lock', 'doc', 'library-empty',
      libEmpty ? '政策库暂无内容' : '当前身份暂无匹配政策',
      [libEmpty
        ? '这里只展示合作机构发布、管理员审核通过的政策。下方「通用办事指引」是本机整理的参考，<b>不属于政策库</b>。'
        : '可切换身份或选择「全部」再看一次；这只是筛选结果，不代表库里没有政策。'], 'small')
  var guideInner = guideVisible.length
    ? '<div class="list" data-testid="' + tid('guide-list') + '">' +
      guideVisible.map(function (g) { return guideRow(g, g.id === expandId, aiMode) }).join('') + '</div>'
    : box('lock', 'book', 'guide-empty', '当前身份暂无匹配指引', ['可切换身份或选择「全部」再看一次。'], 'small')
  return '<section class="sec" data-testid="' + tid('sections') + '">' +
    '<div class="grp" data-section="library"><b>政策库</b><span>' +
    (libEmpty ? '本次没有读到条目' : libVisible.length ? '读到的条目按下面的结构展示' : '当前筛选无匹配') +
    '</span></div>' + libInner + '</section>' +
    '<section class="sec"><div class="grp builtin" data-section="builtin"><b>通用办事指引</b>' +
    '<span>本机整理的参考，不属于政策库</span></div>' +
    guideInner + '</section>'
}
function srcline (text) {
  return '<section class="sec"><div class="srcline" data-testid="' + tid('source-line') + '">' +
    svg('info', 22) + '<span>' + text + '</span></div></section>'
}
function printCta (whyText) {
  return cta([
    link('12-file-source.html', '/print/upload', 'primary', 'btn primary', svg('print', 24) + '上传自备材料打印'),
    '<span class="why">' + whyText + '</span>'
  ])
}

function policyView (st) {
  if (st === 'loading') {
    return deadend('info', 'refresh', 'loading',
      '正在读取政策与公告 <span class="dots" aria-hidden="true"><i></i><i></i><i></i></span>',
      ['读回来之前不显示条数、标题与来源，也不会拿上一次的内容顶替。'],
      link(url('eligibility', 'eligibility-probing', ''), '/renshi?tab=eligibility', 'to-elig', 'exit',
        '<span class="eic">' + svg('scale', 24) + '</span><span class="etx"><b>去条件核对</b><span>不等这次读取</span></span>') +
      link(url('social', 'social', ''), '/renshi?tab=social', 'to-social', 'exit',
        '<span class="eic">' + svg('shield', 24) + '</span><span class="etx"><b>看社保指南</b><span>本机内置内容</span></span>') +
      exit('12-file-source.html', '/print/upload', 'to-print', 'print', '上传材料打印', '本机随时可用'),
      '这三条都不等政策读取',
      noteline('info', '社保指南与就业登记是本机内置内容，随时可看；政策与公告读回来会自动出现在这一屏。')
    ) + printCta('政策还没读回来，打印你自己带来的材料不受影响。')
  }
  if (st === 'request-error') {
    return deadend('error', 'alert', 'error', '政策与公告这次没读到',
      ['这次读取没有成功，所以本页不显示任何条目。<b>这不等于政策库是空的</b>：库里确实没有内容时会另有一屏说明。'],
      link(url('eligibility', 'eligibility-probing', ''), '/renshi?tab=eligibility', 'to-elig', 'exit',
        '<span class="eic">' + svg('scale', 24) + '</span><span class="etx"><b>去条件核对</b><span>不受这次失败影响</span></span>') +
      link(url('social', 'social', ''), '/renshi?tab=social', 'to-social', 'exit',
        '<span class="eic">' + svg('shield', 24) + '</span><span class="etx"><b>看社保指南</b><span>本机内置内容</span></span>') +
      exit('12-file-source.html', '/print/upload', 'err-print', 'print', '上传材料打印', '本机随时可用'),
      '这三条都不依赖这次读取',
      noteline('warn', '重试会留在政策服务里重新读取一次，不会把你送回首页，也不会显示上一次的内容。')
    ) + cta([
      link(url('policy', 'loading', ''), '/renshi?tab=policy', 'primary', 'btn primary', svg('refresh', 24) + '重新读取'),
      '<span class="why">重试会先回到读取中，本机不把「点了重试」直接显示成读取成功。</span>'
    ])
  }
  var aud = st === 'filtered-empty' ? 'startup' : 'all'
  var libEmpty = st === 'policy-library-empty'
  var aiMode = st === 'context-missing' ? 'missing'
    : st === 'ai-unavailable' ? 'down'
      : st === 'manual-view-source' ? 'manual'
        : st === 'source-missing' ? 'source-missing'
          : st === 'source-invalid' ? 'source-invalid' : 'ready'
  /* 展开哪一条：默认展开政策库条目（原文与来源都挂在它上面）。
     两个空态屏的主内容是空态本身，一条都不展开，免得空态被一大块指引正文压下去。
     context-missing 要说明「指引没有原文可引用」，展开一条通用指引。
     QR 态按 ?src= 展开用户真正点开的那一条，保证「点 A 打开的就是 A」。 */
  var expand = (libEmpty || st === 'filtered-empty') ? ''
    : st === 'context-missing' ? 'builtin-skill-training' : 'lib-result'
  if (st === 'source-qr') expand = P.srcKey() || 'lib-result'
  var line = libEmpty
    ? '政策库暂无已发布政策；下方「通用办事指引」是本机整理的参考'
    : st === 'filtered-empty'
      ? '当前按「创业人员」筛选：政策库没有命中，下方指引仍可查看'
      : st === 'context-missing'
        /* 这一屏的说明就贴在展开条目的置灰控件旁边，顶部不再重复一遍 */
        ? ''
        : st === 'ai-unavailable'
          ? '小青这次连不上；看原文、筛选、扫码与条件核对都照常可用'
          : st === 'manual-view-source'
            ? '人工核对：不经过模型，直接看这条政策的原文与来源'
            : st === 'source-missing'
              ? '这条政策没有来源地址；本机不生成二维码，也不补写链接'
              : st === 'source-invalid'
                ? '这条政策的来源地址无效；本机不生成二维码'
            : '政策库来源：' + slot('机构') + ' · 同步于 ' + slot('日期')
  var tail = st === 'manual-view-source'
    ? printCta('原文只做展示；需要纸质件请上传你自己的材料。')
    : printCta('政策与指引只做说明；需要纸质件请上传你自己的材料。')
  return (line ? srcline(line) : '') +
    '<section class="sec">' + audChips(aud) + '</section>' +
    policyList(aud, libEmpty, expand, aiMode) + tail
}

/* ── 条件核对（零 LLM 的服务端确定性比对）───────────────── */
function stepbar (n) {
  return '<section class="sec"><ol class="steps2" data-testid="' + tid('stepbar') + '">' +
    '<li' + (n === 1 ? ' aria-current="step"' : '') + '><span class="sn">1</span>选你的情况</li>' +
    '<li' + (n === 2 ? ' aria-current="step"' : '') + '><span class="sn">2</span>看逐条结果</li></ol></section>'
}
function eligNotice (kind, icon, id, head, paras, note) {
  return stepbar(1) +
    deadend(kind, icon, id, head, paras,
      link(url('policy', 'policy-ready', ''), '/renshi?tab=policy', 'to-policy', 'exit', '<span class="eic">' + svg('doc', 24) +
        '</span><span class="etx"><b>去看就业政策</b><span>政策条目与办事指引</span></span>') +
      link(url('social', 'social', ''), '/renshi?tab=social', 'to-social', 'exit', '<span class="eic">' + svg('shield', 24) +
        '</span><span class="etx"><b>看社保指南</b><span>查询、证明与备案</span></span>') +
      exit('12-file-source.html', '/print/upload', 'to-print', 'print', '上传自备材料打印', '只处理你带来的文件'),
      '这三条都不依赖条件核对', note) +
    cta([
      link(url('eligibility', 'eligibility-probing', ''), '/renshi?tab=eligibility', 'primary', 'btn primary',
        svg('refresh', 24) + '重新检查'),
      '<span class="why">重新检查只是再问一次「现在有没有可比对的政策」，不收集任何个人信息。</span>'
    ])
}
function questionBlock (answered) {
  return '<div class="qs" data-testid="' + tid('questions') + '">' + QUESTIONS.map(function (q) {
    return '<fieldset class="q" data-q="' + q[0] + '"><div class="qh"><legend>' + q[1] + '</legend>' +
      (q[2] ? '<small>这项可以不填</small>' : '') + '</div><div class="opts">' +
      q[3].map(function (o) {
        var on = answered && answered[q[0]] === o
        return '<button type="button" class="opt press" aria-pressed="' + (on ? 'true' : 'false') +
          '" data-opt="' + q[0] + '" data-val="' + o + '">' + o + '</button>'
      }).join('') + '</div></fieldset>'
  }).join('') + '</div>'
}
/** 逐条结果只留**一条空槽位**：判定标签、说明、原文与依据全部等服务端返回后填入。
    前端不预置「相符 / 不符 / 无法判定」任何一行，也不拼总体结论。 */
function condRow () {
  return '<li class="cond" data-cond="server-slot">' + svg('scale', 24) +
    '<span class="cm"><span class="ct">' + slot('条件名称', 'wide') +
    '<span class="tagchip slate">' + slot('判定') + '</span></span>' +
    '<span class="cr">判定说明 ' + slot('', 'full') + '</span>' +
    '<span class="cb">政策原文 ' + slot('', 'full') + '</span>' +
    '<span class="cb">依据你填的 ' + slot('—', 'wide') + '</span></span></li>'
}
function eligView (st) {
  if (st === 'eligibility-probing') {
    return stepbar(1) +
      sec('', '', '', box('info', 'scale', 'probing',
        '正在检查现在有没有可比对的政策 <span class="dots" aria-hidden="true"><i></i><i></i><i></i></span>',
        ['先确认库里有没有录了条件的政策，再决定要不要请你填写。这一步<b>不发送任何个人信息</b>。'])) +
      sec('', '', '', noteline('shield', '条件核对由服务端按政策原文逐条比对，<b>不使用 AI</b>；' +
        '小青能不能用都不影响它。')) +
      sec('', '', '', noteline('info', '如果没有可比对的条目，本机会直接说明，' +
        '不会先问完九项再用一句像「你不符合」的话收场。')) +
      cta([off('primary', 'btn primary', svg('scale', 24) + '按政策原文逐条比对', 'probe-why'),
        why('probe-why', '还没确认有可比对的政策，此时不该向你要户籍、年龄段或参保信息。')])
  }
  if (st === 'eligibility-backend-required') {
    return eligNotice('warn', 'alert', 'backend-required', '本机现在做不了条件核对',
      ['本机暂时连不上政策服务。问项与判定口径都要由服务端下发，<b>本机不会自己编一套问项或结论</b>。请联系现场工作人员后再试。'],
      noteline('warn', '本机没有向你收集任何信息，也没有给出任何结论。'))
  }
  if (st === 'eligibility-no-policies') {
    return eligNotice('lock', 'doc', 'no-policies', '暂时没有可核对的政策条目', [COPY_NO_PUBLISHED],
      noteline('info', '本机没有向你收集任何信息，这一屏也不是核对结论。'))
  }
  if (st === 'eligibility-no-rules') {
    return eligNotice('lock', 'list', 'no-rules', '已发布政策还没录入可比对条件', [COPY_NO_RULES],
      noteline('info', '有政策但没有可比对的条件时，本机<b>不拿正文猜条件</b>：请看政策原文或向经办窗口核对。'))
  }
  if (st === 'eligibility-error') {
    return eligNotice('error', 'alert', 'elig-error', '这次核对没有成功',
      ['这次没有拿到结果，所以本页不显示任何结论。<b>失败不等于「你不符合」</b>，也不代表库里没有政策。',
        '你选过的内容只留在这一页，离开或重来都不会被保存。'],
      noteline('warn', '你的作答不落库、不进日志，本机也不把它写进网址或浏览器存储。'))
  }
  if (st === 'eligibility-result') {
    /* 结论区全部是**空槽位**：总体说明、逐条判定、原文与免责说明都等服务端返回后原样填入。
       前端不拼「你符合 / 不符合」，也不预置任何一条判定行。 */
    return stepbar(2) +
      sec('', '', '', '<div class="blk"><p class="state-p"><b>本次比对说明</b>　' +
        '<span class="item-sub" style="display:inline">服务端返回后原样显示</span><br>' +
        slot('', 'full') + '</p>' +
        '<div class="srcrow" style="margin-top:12px">' +
        '<span class="chip ok">' + svg('scale', 20) + 'E2 · 按政策原文逐条比对</span>' +
        '<span class="chip">不使用 AI</span><span class="chip">共发布 <b>' + slot('—') + '</b> 条</span>' +
        '<span class="chip">你填了 <b>' + slot('—') + '</b> / 9 项</span></div></div>') +
      sec('', '逐条结果', '每条都能对回政策原文', '<div class="rescard" data-testid="' + tid('result-card') + '">' +
        '<h3>' + slot('政策标题', 'wide') + '</h3>' +
        '<div class="srcrow"><span class="chip slate">来源机构 <b>' + slot('—') + '</b></span>' +
        '<span class="chip">同步时间 <b>' + slot('—') + '</b></span>' +
        '<span class="chip">外部编号 <b>' + slot('—') + '</b></span></div>' +
        '<p class="overall">本条总体说明 ' + slot('', 'full') + '</p>' +
        '<ul class="conds">' + condRow() + '</ul></div>') +
      sec('', '', '', '<p class="disclaimer" data-testid="' + tid('disclaimer') + '">' +
        '服务端返回的免责说明将在这里原样显示，本机与 AI 都不改写。</p>') +
      cta([
        link(url('eligibility', 'eligibility-ask-empty', ''), '/renshi?tab=eligibility', 'primary', 'btn primary',
          svg('refresh', 24) + '重新填写并再比对一次'),
        off('print-list', 'btn ghost', svg('print', 22) + '打印核对清单（暂不可用）', 'print-why'),
        why('print-why', '作答不做保存，暂时无法印成纸质清单。')
      ])
  }
  var answered = st === 'eligibility-ask-partial' ? { employment_status: '应届毕业生', graduation_year: '本年度应届' } : null
  var n = answered ? 2 : 0
  var submitting = st === 'eligibility-submitting'
  if (submitting) { answered = { employment_status: '应届毕业生', graduation_year: '本年度应届' }; n = 2 }
  var primary = submitting
    ? off('primary', 'btn primary', '<span class="dots" aria-hidden="true"><i></i><i></i><i></i></span>正在比对…', 'submit-why')
    : n > 0
      ? '<button type="button" class="btn primary press" data-submit="1" data-testid="' + tid('primary') + '">' +
        svg('scale', 24) + '按政策原文逐条比对</button>'
      : off('primary', 'btn primary', svg('scale', 24) + '按政策原文逐条比对', 'submit-why')
  var tail = submitting
    ? why('submit-why', '已提交这次比对，等服务端返回逐条结果；本机不猜结论，也不预先显示任何条数。')
    : n > 0 ? '<span class="why" data-testid="' + tid('submit-hint') + '">选「不确定」等于没填，对应条件会标为「无法判定」，不会算成不符合。</span>'
      : why('submit-why', SUBMIT_WHY)
  return stepbar(1) +
    '<section class="sec"><p class="privacy" data-testid="' + tid('privacy') + '">' + svg('lock', 22) + PRIVACY_NOTICE + '</p></section>' +
    sec('', '', '', questionBlock(answered)) +
    sec('', '', '', '<p class="disclaimer" data-testid="' + tid('disclaimer') + '">' + DISCLAIMER + '</p>') +
    cta(['<span class="count" data-testid="' + tid('count') + '">已填 <b><span data-count>' + n +
      '</span> / 9</b> 项</span>', primary, tail])
}

/* ── 社保 / 就业登记 / 公告 ─────────────────────────────── */
function socialView () {
  return srcline('本机整理的办事指引，办理以对应平台为准') +
    sec('', '', '', '<div class="grid2">' + SOCIALS.map(function (g) {
      /* 有真实来源地址的两项给扫码入口；没有的两项只留一行就地说明 ——
         打印入口在底部主操作条常驻，不在同屏重复三个一模一样的按钮。 */
      var action = g.url
        ? qrBtnSm('social-' + g.k, 'social-' + g.k, g.btn)
        : noteline('print', g.no, 'warn')
      return '<div class="blk"><div class="grp"><b>' + svg(g.ic, 24) + g.t + '</b></div>' +
        '<p class="item-sub">' + g.d + '</p>' + dsec('arrow', '办理步骤', g.s, 'num') +
        '<div style="margin-top:12px">' + action + '</div></div>'
    }).join('') + '</div>') +
    sec('', '', '', noteline('info', SRC_RULE)) +
    printCta('社保材料请自行准备，本机只负责打印。')
}
function registerView () {
  return srcline('办理地点与材料以当地就业服务机构公布为准') +
    sec('', '', '', '<div class="list">' + REGISTERS.map(function (r) {
      return '<div class="blk"><div class="grp"><b>' + svg(r.ic, 24) + r.t + '</b><span>' + r.p + '</span></div>' +
        '<div class="rows"><div><span>办理地点</span><b>' + r.loc + '</b></div></div>' +
        '<div style="margin-top:12px">' + dsec('list', '所需材料', r.m, 'cols') + '</div></div>'
    }).join('') + '</div>') +
    sec('', '', '', noteline('info', OFFLINE_RULE + '本机不代办，只提供材料清单与打印。')) +
    sec('', '', '', noteline('warn', '<b>证件照本机不能现场拍摄</b>，请自带电子照或到照相馆办理。')) +
    printCta('把清单里需要复印的材料上传，本机可直接出纸。')
}
function noticeView (st) {
  if (st === 'notice-empty') {
    return deadend('lock', 'scroll', 'notice-empty', '暂无政策公告',
      ['公告由合作机构发布、管理员审核后展示，目前一条都没有。<b>这是内容进度，不是读取失败</b>；读取失败会另有一屏说明。'],
      link(url('policy', 'policy-ready', ''), '/renshi?tab=policy', 'to-policy', 'exit', '<span class="eic">' + svg('doc', 24) +
        '</span><span class="etx"><b>去看就业政策</b><span>政策条目与办事指引</span></span>') +
      link(url('eligibility', 'eligibility-probing', ''), '/renshi?tab=eligibility', 'to-elig', 'exit',
        '<span class="eic">' + svg('scale', 24) + '</span><span class="etx"><b>去条件核对</b><span>按政策原文逐条比对</span></span>') +
      exit('12-file-source.html', '/print/upload', 'empty-print', 'print', '上传材料打印', '不受公告影响'),
      '公告为空不影响这三条',
      noteline('info', '公告正文与来源链接都由发布机构提交，本机不改写、不补写。')
    ) + printCta('公告为空不影响打印你自己带来的材料。')
  }
  var sourceMode = st === 'source-missing' ? 'source-missing' : st === 'source-invalid' ? 'source-invalid' : 'ready'
  return srcline('政策公告来源：' + slot('机构') + ' · 同步于 ' + slot('日期')) +
    sec('', '', '', '<div class="list" data-testid="' + tid('notice-list') + '">' +
      '<article class="item on" data-item="nt-1">' +
      '<button type="button" class="item-main press" aria-expanded="true" data-acc="nt-1" data-testid="' + tid('item-nt-1') + '">' +
      '<span class="item-ic slate">' + svg('scroll', 26) + '</span>' +
      '<span class="item-tx"><b>' + slot('公告标题', 'wide') + '</b>' +
      '<span class="item-sub">正文与来源链接由发布机构提交，本机不改写</span></span>' +
      '<span class="item-tail"><span class="tagchip lib">通知</span><span class="caret">' + svg('chevron', 24) + '</span></span></button>' +
      '<div class="acc-body" data-testid="' + tid('item-nt-1-body') + '">' +
      '<div class="quote"><span class="qp">公告正文</span>' + slot('', 'full') + slot('', 'full') + '</div>' +
      srcRow('<span class="chip">发布时间 <b>' + slot('—') + '</b></span>') +
      noteline('info', SRC_RULE) +
      sourceActions('nt-1', sourceMode, 'notice-print') +
      '</div></article></div>') +
    printCta('公告本身不提供下载；如需打印你自己带来的材料，可在这里上传。')
}

/* ── 来源二维码：每一条来源都保留自己的非敏感上下文，不做泛化占位 ── */
var QR = {}
function qsrc (id, pg, base, title, subject, metas, note) {
  QR[id] = { id: id, page: pg, state: 'source-qr', base: base, title: title, subject: subject, metas: metas, note: note }
}
LIBRARY_ROWS.forEach(function (r) {
  qsrc(r.id, 'policy', 'policy-ready', '扫码打开来源链接', slot('政策标题', 'wide'),
    [['来源类型', '政策库条目 · 已审核发布'], ['来源机构', slot('—')], ['同步时间', slot('—')],
      ['目标域名', slot('—')]],
    SRC_NOTE)
})
GUIDES.forEach(function (g) {
  qsrc(g.id, 'policy', 'policy-ready', '扫码打开来源链接', g.title,
    [['来源类型', '本机整理的办事指引'], ['整理来源', g.src], ['目标域名', host(g.url)]],
    SRC_NOTE)
})
SOCIALS.forEach(function (g) {
  if (!g.url) return
  qsrc('social-' + g.k, 'social', 'social', '扫码打开社保服务入口', g.t,
    [['来源类型', '本机整理的社保指引'], ['目标域名', host(g.url)],
      ['本机角色', '只提供入口，不代查、不代办']],
    SRC_NOTE)
})
qsrc('nt-1', 'notice', 'notice-ready', '扫码打开公告来源链接', slot('公告标题', 'wide'),
  [['来源类型', '合作机构发布 · 管理员审核'], ['发布机构', slot('—')], ['目标域名', slot('—')]],
  SRC_NOTE)

/* ── 页面注册表 ─────────────────────────────────────────── */
function backHub () { return ['16-service-hubs.html?hub=policy', '/policy-service', '返回政策服务'] }
var PAGES = {
  /* table 每行 = [state, 任务副标题, 胶囊色, 胶囊文案]；顺序即状态顺序，首项为默认态。 */
  policy: {
    id: 'renshi-policy', route: '/renshi?tab=policy', title: '就业政策', back: backHub,
    render: policyView, qr: { 'source-qr': 'lib-result' },
    table: [
      ['loading', '政策与公告一起读取，读回来之前不显示任何条目。', '', '正在读取政策'],
      ['policy-ready', '政策库条目与本机整理的指引<b>分区展示</b>，展开即看原文、条件与办理路径。', 'ok', '政策库 · 已审核发布'],
      ['policy-library-empty', '政策库当前为空；下方指引是本机整理的参考，不用来冒充政策库有内容。', 'warn', '政策库暂无内容'],
      ['filtered-empty', '按身份筛选后政策库没有命中；这是筛选结果，不是库里没有政策。', 'warn', '筛选后无匹配'],
      ['request-error', '这次读取失败，本页不显示任何条目，也不猜政策库是空还是有。', 'bad', '政策读取失败'],
      ['source-qr', '来源链接由发布方提供，本机没有核验过它的官方性。', '', '来源链接未核验'],
      ['source-missing', '发布方没有提供来源地址；本机不生成二维码，也不补写链接。', 'warn', '缺少来源地址'],
      ['source-invalid', '来源地址不是有效的网址；本机不生成二维码。', 'bad', '来源地址无效'],
      ['context-missing', '本机整理的指引没有政策原文可引用，因此不提供解释入口。', 'warn', '无政策原文可引用'],
      ['ai-unavailable', '小青这次连不上；这一屏其余能力照常，条件核对本来也不经过模型。', 'bad', '小青不可用'],
      ['manual-view-source', '不经过模型的人工核对：直接看这条政策的原文与来源。', 'ok', '人工核对路径']
    ]
  },
  eligibility: {
    id: 'renshi-eligibility', route: '/renshi?tab=eligibility', title: '条件核对', back: backHub,
    render: eligView,
    table: [
      ['eligibility-probing', '先确认有可比对的政策，再决定是否请你填写。', '', '正在检查可比对政策'],
      ['eligibility-backend-required', '本机连不上政策服务；不自造问项，也不给任何结论。', 'warn', '暂时无法核对'],
      ['eligibility-no-policies', '库里没有可比对的条目；这是录入进度，不是你的核对结果。', 'warn', '无可比对条目'],
      ['eligibility-no-rules', '有政策但没录可比对条件，本次不做逐条比对。', 'warn', '未录入比对条件'],
      ['eligibility-ask-empty', '先选你的情况再比对；作答只留在本页，不写进网址或浏览器存储。', '', '等待你填写'],
      ['eligibility-ask-partial', '已经可以比对了；没填的项会标为「无法判定」，不算不符合。', 'ok', '可以开始比对'],
      ['eligibility-submitting', '等服务端返回；本机不猜结论，也不显示任何中间进度。', '', '正在等待比对结果'],
      ['eligibility-result', '总体说明与逐条判定都由服务端返回后原样显示。', 'ok', '逐条结果已返回'],
      ['eligibility-error', '这次没有拿到结果，本页不显示任何结论。', 'bad', '核对未成功']
    ]
  },
  social: {
    id: 'renshi-social', route: '/renshi?tab=social', title: '社保指南', back: backHub,
    render: socialView, qr: { 'source-qr': 'social-query' },
    table: [
      ['social', '查询、证明、异地就医备案与社保卡四项，办理均以对应平台为准。', 'ok', '本机整理指引'],
      ['source-qr', '扫码只打开对方平台，本机不代查、不代办，也未核验其资质。', '', '外部平台入口']
    ]
  },
  register: {
    id: 'renshi-register', route: '/renshi?tab=register', title: '就业登记', back: backHub,
    render: registerView,
    table: [['register', '办理地点与材料清单以当地发布渠道最新说明为准；本机不代办。', 'ok', '办理材料指引']]
  },
  notice: {
    id: 'renshi-notice', route: '/renshi?tab=notice', title: '政策公告', back: backHub,
    render: noticeView, qr: { 'source-qr': 'nt-1' },
    table: [
      ['notice-ready', '公告由合作机构发布、管理员审核后展示，正文与来源链接原样呈现。', 'ok', '已审核发布'],
      ['notice-empty', '当前一条公告都没有；这是内容进度，不是读取失败。', 'warn', '暂无公告'],
      ['source-qr', '公告的来源链接由发布机构提交，本系统未核验其官方性。', '', '来源链接未核验'],
      ['source-missing', '公告没有来源地址；本机不生成二维码，也不补写链接。', 'warn', '缺少来源地址'],
      ['source-invalid', '公告来源地址不是有效的网址；本机不生成二维码。', 'bad', '来源地址无效']
    ]
  }
}
/** 五个任务分区：产品真实 query（/renshi?tab=），五态常驻可点。 */
function chrome (k) {
  return '<nav class="tabbar" style="--tabs:5" aria-label="政策服务任务分区" data-testid="renshi-tabbar">' +
    TABS.map(function (t) {
      var target = PAGES[t[0]]
      return '<a class="tab press" href="' + url(t[0], target.states[0], '') + '" data-route="' + target.route +
        '" data-tab="' + t[0] + '" data-testid="renshi-tab-' + t[0] + '"' +
        (t[0] === k ? ' aria-current="page"' : '') + '>' + svg(t[2], 24) + t[1] + '</a>'
    }).join('') + '</nav>'
}

P.boot(PAGES, 'policy', { chrome: chrome, qr: QR })

/* ── 就地交互：筛选 / 展开 / 作答 / 提交 ─────────────────── */
var stage = P.stage, root = P.root
/** 条件核对计数：与服务端 countAnswered 同口径 —— 选了「不确定」等于没答。 */
function recount () {
  var n = 0
  Array.prototype.forEach.call(stage.querySelectorAll('[data-opt][aria-pressed="true"]'), function (b) {
    if (b.getAttribute('data-val') !== '不确定') n++
  })
  var counter = stage.querySelector('[data-count]')
  if (counter) counter.textContent = String(n)
  var primary = stage.querySelector('[data-testid="renshi-eligibility-primary"]')
  var hint = stage.querySelector('[data-testid="renshi-eligibility-submit-hint"]')
  var reason = document.getElementById('submit-why')
  if (!primary) return
  if (n > 0) {
    primary.removeAttribute('aria-disabled')
    primary.removeAttribute('aria-describedby')
    primary.classList.add('press')
    primary.setAttribute('data-submit', '1')
    if (reason) {
      reason.className = 'why'
      reason.textContent = '选「不确定」等于没填，对应条件会标为「无法判定」，不会算成不符合。'
      reason.removeAttribute('id')
      reason.setAttribute('data-testid', 'renshi-eligibility-submit-hint')
    }
  } else {
    primary.setAttribute('aria-disabled', 'true')
    primary.setAttribute('aria-describedby', 'submit-why')
    primary.removeAttribute('data-submit')
    var back = reason || hint
    if (back) { back.className = 'reason'; back.id = 'submit-why'; back.textContent = SUBMIT_WHY; back.removeAttribute('data-testid') }
  }
}
function applyFilter (aud) {
  Array.prototype.forEach.call(stage.querySelectorAll('[data-aud]'), function (c) {
    c.setAttribute('aria-pressed', String(c.getAttribute('data-aud') === aud))
  })
  var libCount = 0, guideCount = 0
  Array.prototype.forEach.call(stage.querySelectorAll('[data-aud-of]'), function (item) {
    var list = item.getAttribute('data-aud-of').split(' ')
    var hit = aud === 'all' || list.indexOf(aud) >= 0 || list.indexOf('general') >= 0
    item.hidden = !hit
    if (!hit) return
    if (item.getAttribute('data-item').indexOf('lib-') === 0) libCount++
    else guideCount++
  })
  var libSection = stage.querySelector('[data-section="library"]')
  var guideSection = stage.querySelector('[data-section="builtin"]')
  if (libSection) libSection.querySelector('span').textContent = libCount
    ? '读到的条目按下面的结构展示'
    : '当前筛选无匹配'
  if (guideSection) guideSection.querySelector('span').textContent = guideCount
    ? '本机整理的参考，不属于政策库'
    : '当前筛选无匹配'
  var libList = stage.querySelector('[data-testid="renshi-policy-library-list"]')
  var libEmpty = stage.querySelector('[data-testid="renshi-policy-filtered-empty"]')
  if (libList && !libEmpty && libCount === 0) {
    var d = document.createElement('div')
    d.innerHTML = box('lock', 'doc', 'filtered-empty', '当前身份下暂无匹配的政策',
      ['可切换上方身份或选择「全部」查看政策库中的其他条目；这条空态只说明筛选结果，不代表库里没有政策。'], 'small')
    libList.parentNode.appendChild(d.firstChild)
    libList.hidden = true
  } else if (libEmpty && libCount > 0) {
    libEmpty.parentNode.removeChild(libEmpty)
    if (libList) libList.hidden = false
  }
}
stage.addEventListener('click', function (e) {
  /* 身份筛选：就地重算两个分区，不跳页、不改 URL */
  var chip = e.target.closest('[data-aud]')
  if (chip) return applyFilter(chip.getAttribute('data-aud'))

  /* 条目展开 / 收起：就地开合，不跳页、不改 URL */
  var acc = e.target.closest('[data-acc]')
  if (acc) {
    var open = acc.getAttribute('aria-expanded') === 'true'
    var card = acc.parentNode
    var body = card.querySelector('.acc-body')
    if (open) {
      if (body) card.removeChild(body)
      card.classList.remove('on')
    } else {
      Array.prototype.forEach.call(stage.querySelectorAll('[data-acc][aria-expanded="true"]'), function (other) {
        if (other === acc) return
        other.setAttribute('aria-expanded', 'false')
        var otherCard = other.parentNode
        var otherBody = otherCard.querySelector('.acc-body')
        if (otherBody) otherCard.removeChild(otherBody)
        otherCard.classList.remove('on')
      })
      var id = acc.getAttribute('data-acc')
      var g = guideOf(id)
      var tpl = document.createElement('div')
      var current = root.getAttribute('data-state')
      var mode = current === 'ai-unavailable' ? 'down' : current === 'context-missing' ? 'missing'
        : current === 'manual-view-source' ? 'manual' : current === 'source-missing' ? 'source-missing'
          : current === 'source-invalid' ? 'source-invalid' : 'ready'
      tpl.innerHTML = root.getAttribute('data-screen') === 'renshi-notice'
        ? '<div class="acc-body swap-in" data-testid="' + tid('item-' + id + '-body') + '">' +
          '<div class="quote"><span class="qp">公告正文</span>' + slot('', 'full') + slot('', 'full') + '</div>' +
          srcRow('<span class="chip">发布时间 <b>' + slot('—') + '</b></span>') +
          noteline('info', SRC_RULE) +
          sourceActions(id, mode, 'notice-print') + '</div>'
        : g ? guideDetail(g, mode) : libraryDetail(id, mode)
      card.appendChild(tpl.firstChild)
      card.classList.add('on')
    }
    acc.setAttribute('aria-expanded', open ? 'false' : 'true')
    return
  }

  /* 条件核对作答：只改 DOM 与计数。刻意不写 URL、不写 localStorage /
     sessionStorage —— 户籍、年龄段、参保这些取值不进任何可持久化的地方。 */
  var opt = e.target.closest('[data-opt]')
  if (opt) {
    var was = opt.getAttribute('aria-pressed') === 'true'
    Array.prototype.forEach.call(opt.closest('.opts').querySelectorAll('[data-opt]'), function (b) {
      b.setAttribute('aria-pressed', 'false')
    })
    opt.setAttribute('aria-pressed', was ? 'false' : 'true')
    return recount()
  }

  /* 提交比对：走壳层统一渲染，data-screen / data-state / testid / 副标题 / 胶囊一起同步；
     作答依旧只在 DOM 临时态，不写进 URL 与任何存储。 */
  if (e.target.closest('[data-submit]')) return P.goState('eligibility', 'eligibility-submitting', '')
})
})()
