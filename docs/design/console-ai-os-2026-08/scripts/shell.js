/* ============================================================
   Console AI 改造原型 · 外壳
   侧栏结构 1:1 复刻现有生产代码：
     apps/admin/src/layouts/AdminLayoutWrapper.tsx   NAV_ITEMS（5 组 32 项）
     apps/partner/src/layouts/PartnerLayoutWrapper.tsx NAV_ITEMS（4 组 12 项）
   原型只在真实菜单上打改造标记，不重排、不新造导航。
   标记：改造=在原页加东西 · 填充=现有空壳页填上内容 · 摘除=从侧栏摘掉但保留页面
   ⚠️ Codex 复核后裁定：**全站新增 0 个页面**。
      原拟新增的 /interview-ops → 并入 /ai-services 的「面试训练」Tab
      原拟新增的 /tickets     → 并入 /account 的「通知与支持」Tab
   ============================================================ */

const ADMIN_NAV = [
  { items: [{ key:'dashboard', label:'工作台', href:'dashboard.html', mark:'改造' }] },
  { title:'设备运维', items:[
    { key:'devices', label:'设备管理' },
    { key:'screensaver', label:'宣传屏' },
    { key:'toolbox', label:'百宝箱' },
    { key:'smart-campus', label:'智慧校园' },
    { key:'alerts', label:'告警中心', href:'alerts.html', mark:'改造' },
  ]},
  { title:'业务管理', items:[
    { key:'orders', label:'订单管理', href:'orders.html', mark:'改造' },
    { key:'print-scan', label:'打印扫描运维' },
    { key:'billing', label:'计费与对账', href:'billing.html', mark:'改造' },
    { key:'files', label:'文件管理' },
    { key:'job-materials', label:'求职材料库', href:'job-materials.html', mark:'改造' },
    { key:'ai-services', label:'AI服务管理', href:'ai-services.html', mark:'改造' },
    { key:'ai-config', label:'AI大模型', href:'ai-config.html', mark:'改造' },
  ]},
  { title:'数据内容', items:[
    { key:'job-sources', label:'岗位信息源', href:'job-sources.html', mark:'改造' },
    { key:'fair-sources', label:'招聘会信息源' },
    { key:'policy-sources', label:'政策信息源' },
    { key:'fairs', label:'招聘会管理' },
    { key:'companies', label:'企业展示管理', href:'companies.html', mark:'修断点' },
    { key:'import-batches', label:'Excel 导入记录' },
    { key:'sync-sources', label:'数据接入通道' },
    // 2026-08-11 新增：OnlinePlatformDirectory 全局仅 2 处引用，两个后台都没有写入口。
    // 这是本轮审查中唯一确实需要 Admin 新建的页面（其余需求都并进现有页 Tab）。
    { key:'online-platforms', label:'线上平台目录', href:'online-platforms.html', mark:'新增' },
  ]},
  { title:'机构用户', items:[
    { key:'partners', label:'合作机构管理' },
    { key:'offline-agencies', label:'线下机构' },
    { key:'users', label:'用户管理' },
    { key:'benefit-activities', label:'权益活动', href:'benefit-activities.html', mark:'堵洞' },
    { key:'member-benefits', label:'会员权益' },
    { key:'member-feedback', label:'意见反馈' },
    { key:'member-notifications', label:'消息通知' },
    { key:'member-privacy', label:'会员隐私请求', href:'member-privacy.html', mark:'改造' },
  ]},
  { title:'系统管理', items:[
    { key:'permissions', label:'权限管理', mark:'摘除' },
    { key:'audit', label:'日志审计', href:'audit.html', mark:'改造' },
    { key:'legal-docs', label:'法务文档版本' },
    { key:'privacy-requests', label:'数据权利工单' },
  ]},
]

const PARTNER_NAV = [
  { items:[{ key:'dashboard', label:'工作台', href:'dashboard.html', mark:'改造' }] },
  { title:'机构信息', items:[
    { key:'profile', label:'机构资料', href:'profile.html', mark:'改造' },
  ]},
  { title:'数据管理', items:[
    { key:'jobs', label:'岗位信息管理', href:'jobs.html', mark:'改造' },
    { key:'companies', label:'企业资料管理', href:'companies.html', mark:'改造' },
    { key:'fairs', label:'招聘会信息管理', href:'fairs.html', mark:'改造' },
  ]},
  { title:'校园服务', items:[
    { key:'smart-campus', label:'智慧校园', href:'smart-campus.html', mark:'改造' },
    { key:'policy', label:'政策公告管理', href:'policy.html', mark:'改造' },
    { key:'sources', label:'数据源管理', href:'sources.html', mark:'改造' },
    { key:'sync-logs', label:'同步日志', href:'sync-logs.html', mark:'改造' },
  ]},
  { title:'数据与账号', items:[
    { key:'terminals', label:'终端数据', href:'terminals.html', mark:'填充' },
    { key:'stats', label:'数据统计', href:'stats.html', mark:'填充' },
    { key:'account', label:'账号权限', href:'account.html', mark:'填充' },
  ]},
]

const MARK_CLASS = { '改造':'badge--enh', '填充':'badge--fill', '摘除':'badge--off', '修断点':'badge--fix', '新增':'badge--new', '堵洞':'badge--fix' }

function buildNav(groups, activeKey) {
  return groups.map(g => `
    ${g.title ? `<div class="nav__title">${g.title}</div>` : ''}
    ${g.items.map(it => {
      const on = it.key === activeKey ? ' is-active' : ''
      const href = it.href || 'javascript:void(0)'
      const badge = it.mark ? `<span class="badge ${MARK_CLASS[it.mark] || 'badge--enh'}">${it.mark}</span>` : ''
      return `<a class="nav__item${on}" href="${href}">${it.label}${badge}</a>`
    }).join('')}`).join('')
}

function initShell(o) {
  const isAdmin = o.side === 'admin'
  const groups = isAdmin ? ADMIN_NAV : PARTNER_NAV

  document.body.insertAdjacentHTML('afterbegin', `
    <div class="app">
      <aside class="sidebar">
        <div class="sidebar__brand">
          <div class="sidebar__logo">AI</div>
          <div>
            <b>${isAdmin ? '管理后台' : '测试机构账号（预览）'}</b>
            <small>AI求职打印服务终端</small>
          </div>
        </div>
        <nav class="nav">
          ${buildNav(groups, o.active)}
          <div class="nav__title">原型</div>
          <a class="nav__item" href="../index.html">返回改造总览</a>
        </nav>
        <div class="sidebar__foot">
          <div class="av">${isAdmin ? '系' : '测'}</div>
          <div>
            <b>${isAdmin ? '系统管理员（预览）' : '测试机构账号（预览）'}</b>
            <small>${isAdmin ? '超级管理员' : '机构管理员'}</small>
          </div>
        </div>
      </aside>
      <div class="main">
        <header class="topbar">
          <div class="stateswitch" id="ss">
            <b>页面状态</b>
            <button data-s="default" class="is-on">默认</button>
            <button data-s="empty">首次/空数据</button>
            <button data-s="aidown">AI 不可用</button>
            <button data-s="error">加载失败</button>
          </div>
          <div class="topbar__right">
            <button class="btn btn--sm">${isAdmin ? '账号设置' : '退出'}</button>
          </div>
        </header>
        <main class="content" id="slot"></main>
      </div>
    </div>`)

  const src = document.getElementById('page')
  if (src) document.getElementById('slot').appendChild(src)

  document.body.dataset.state = 'default'
  document.querySelectorAll('#ss button').forEach(b => {
    b.addEventListener('click', () => {
      document.querySelectorAll('#ss button').forEach(x => x.classList.remove('is-on'))
      b.classList.add('is-on')
      document.body.dataset.state = b.dataset.s
    })
  })

  document.querySelectorAll('.tabs, .drawer__tabs').forEach(group => {
    group.addEventListener('click', e => {
      const btn = e.target.closest('button')
      if (!btn) return
      group.querySelectorAll('button').forEach(b => b.classList.remove('is-on'))
      btn.classList.add('is-on')
      const host = group.getAttribute('data-panels')
      if (host) {
        document.querySelectorAll(`[data-panel-of="${host}"]`).forEach(p => {
          p.style.display = p.dataset.panel === btn.dataset.tab ? '' : 'none'
        })
      }
    })
  })

  document.querySelectorAll('.switch').forEach(s =>
    s.addEventListener('click', () => s.classList.toggle('is-on')))

  if (!isAdmin) mountAssistant(o.active)
}

/* ============================================================
   C10 机构 AI 助手 —— 常驻悬浮球 + 右侧抽屉
   设计要点（方案 §8）：
   - 主体是 L1 查询与决策树，**不调模型**
   - 页面上下文自动带入
   - 只答本机构数据；查不到就说查不到 + 给工单入口
   - 不代替执行：只引导到操作页，不直接改数据
   ============================================================ */

const ASSIST_CTX = {
  jobs:     { label: '岗位信息管理', quick: ['我的岗位为什么终端上看不到？','为什么被驳回了？','手工录入和 Excel 有什么区别？'] },
  fairs:    { label: '招聘会信息管理', quick: ['参展企业为什么我改不了？','招聘会资料怎么上传？','为什么主办方显示的不是我们？'] },
  'member-privacy':{ label: '会员隐私', quick: ['用户说没同意过 AI 分析，怎么查？','撤回授权后还在调用怎么办？','小程序和一体机的授权分得开吗？'] },
  orders:{ label: '订单管理', quick: ['怎么分辨小程序单和一体机单？','用户说取件码过期了怎么办？','小程序转化率怎么看？'] },
  billing:{ label: '计费与对账', quick: ['AI 功能什么时候能开始收费？','为什么彩色打印是锁定的？','机构补贴怎么对账？'] },
  'benefit-activities':{ label: '权益活动', quick: ['为什么券还不能用？','一张券能抵多少钱？','退款会退回额度吗？'] },
  'job-materials':{ label: '求职材料库', quick: ['证件复印预设怎么配？','为什么证件照排版还不能开？','材料包什么时候能用？'] },
  'online-platforms':{ label: '线上平台目录', quick: ['为什么机构不能自己往目录里加平台？','某个平台域名不可达了怎么办？'] },
  companies:{ label: '企业资料管理', quick: ['我改了企业简介，招聘会那边怎么还是旧的？','企业展示哪些指标能自己控制？'] },
  stats:    { label: '数据统计', quick: ['这个月效果怎么样？','哪些内容没人看？'] },
  sources:  { label: '数据源管理', quick: ['数据源为什么同步失败？','凭证怎么更换？'] },
  policy:   { label: '政策公告管理', quick: ['政策审核要多久？','官方入口链接有什么要求？'] },
  profile:  { label: '机构资料', quick: ['资质快到期了会怎样？'] },
  account:  { label: '账号权限', quick: ['怎么给同事开子账号？'] },
  default:  { label: '', quick: ['我的内容为什么终端上看不到？','为什么被驳回了？','这个月效果怎么样？'] },
}

function mountAssistant(active) {
  const ctx = ASSIST_CTX[active] || ASSIST_CTX.default
  document.body.insertAdjacentHTML('beforeend', `
    <button class="asst-fab" id="asstFab" aria-label="打开机构助手">
      <span class="asst-fab__dot"></span>助手
    </button>
    <div class="asst" id="asst" hidden>
      <div class="asst__head">
        <div>
          <b>机构助手</b>
          ${ctx.label ? `<small>当前页：${ctx.label}</small>` : '<small>只查本机构数据</small>'}
        </div>
        <button class="btn btn--sm btn--ghost" id="asstClose">收起</button>
      </div>

      <div class="asst__body" id="asstBody">
        <div class="asst__msg asst__msg--bot">
          <div class="asst__bubble">
            我可以帮你查<b>本机构</b>的内容状态、审核结果、同步情况和效果数据，也能解释怎么操作。
            <div class="asst__note">查不到的我会直说，不会猜。涉及别的机构或求职者个人信息的问题我不回答。</div>
          </div>
        </div>
        <div class="asst__quick">
          ${ctx.quick.map((q,i) => `<button class="asst__q" data-q="${i}">${q}</button>`).join('')}
        </div>
      </div>

      <div class="asst__foot">
        <input class="input" placeholder="问点什么…" aria-label="输入问题">
        <button class="btn btn--sm btn--primary">发送</button>
      </div>
      <div class="asst__disclaim">
        操作指导类回答标注「AI 判断，仅供参考」；状态查询类为系统实测数据
        <span class="ev ev--1">E1</span>
      </div>
    </div>`)

  const fab = document.getElementById('asstFab')
  const box = document.getElementById('asst')
  fab.addEventListener('click', () => { box.hidden = !box.hidden })
  document.getElementById('asstClose').addEventListener('click', () => { box.hidden = true })
  document.querySelectorAll('.asst__q').forEach(b =>
    b.addEventListener('click', () => askAssistant(b.textContent.trim())))
}

/** 演示：命中决策树的走 L1 确定性回答，其余走 L3 并标注 */
function askAssistant(q) {
  const body = document.getElementById('asstBody')
  body.insertAdjacentHTML('beforeend',
    `<div class="asst__msg asst__msg--me"><div class="asst__bubble">${q}</div></div>`)
  const a = ASSIST_ANSWERS[q] || ASSIST_ANSWERS.__fallback
  body.insertAdjacentHTML('beforeend',
    `<div class="asst__msg asst__msg--bot"><div class="asst__bubble">${a}</div></div>`)
  body.scrollTop = body.scrollHeight
}

/* 演示答案库 —— 体现「L1 决策树给确定结论」与「L3 标注仅供参考」的区别 */
const ASSIST_ANSWERS = {
  '我的岗位为什么终端上看不到？': `
    <b>帮你查了这 6 条待确认的岗位，卡在不同环节：</b>
    <div class="asst__tree">
      <div class="asst__step asst__step--warn"><b>2 条</b> 还在审核中 <span class="ev ev--1">E1</span>
        <div class="asst__sub">平均等待 1.5 天 · <a href="jobs.html">查看</a></div></div>
      <div class="asst__step asst__step--err"><b>1 条</b> 已驳回：疑似歧视表述 <span class="ev ev--1">E1</span>
        <div class="asst__sub">「限女性，25岁以下」· <a href="jobs.html">看怎么改</a></div></div>
      <div class="asst__step asst__step--warn"><b>3 条</b> 已过截止日 <span class="ev ev--1">E1</span>
        <div class="asst__sub">最久已过 12 天 · <a href="jobs.html">批量改期或下架</a></div></div>
      <div class="asst__step asst__step--ok"><b>其余 24 条</b> 正常展示中
        <div class="asst__sub">分布在 4 个点位 · <a href="stats.html">看效果</a></div></div>
    </div>
    <div class="asst__note">这是逐条查库的结果，不是推测。诊断顺序：审核 → 发布 → 归档 → 有效期 → 机构资质 → 终端投放。</div>`,

  '为什么被驳回了？': `
    <b>最近一条被驳回的是「客服专员」</b>，驳回时间 08-10 16:22 <span class="ev ev--1">E1</span>
    <div class="asst__quote">驳回原因：疑似歧视表述 —— 标题含「限女性，25岁以下」</div>
    <b>怎么改：</b>把性别与年龄限定换成客观岗位要求，例如「具备良好沟通表达能力，普通话标准」。
    <div class="asst__note asst__note--warn">
      ⚠️ 说明：驳回原因目前<b>在岗位列表页还看不到</b>（政策与企业页已能看到）。
      这是已登记的待修项，修好前你可以在这里问我。
    </div>
    <div class="asst__acts"><a class="btn btn--sm btn--primary" href="jobs.html">去修改</a>
      <button class="btn btn--sm btn--ai">让 AI 帮我改</button></div>`,

  '我改了企业简介，招聘会那边怎么还是旧的？': `
    <b>这是一个已知问题，不是你操作错了。</b> <span class="ev ev--1">E1</span>
    <div class="asst__quote">企业信息目前存在两处：<b>企业档案</b>（「找企业」页用）与
      <b>招聘会参展企业</b>（招聘会的参会企业页用）。两处目前不自动同步。</div>
    你在企业资料页改的是<b>企业档案</b>，所以「找企业」页已经更新，
    而 3 场招聘会的参会企业页仍是旧版本。
    <div class="asst__acts">
      <button class="btn btn--sm">看看哪 3 场不一致</button>
      <button class="btn btn--sm btn--ghost">提工单请平台同步</button></div>
    <div class="asst__note">平台已在处理这个问题的修复方案。在修好之前，需要同步请走工单。</div>`,

  '手工录入和 Excel 有什么区别？': `
    <b>字段数不一样：手工能填 9 项，Excel 模板能填 17 项。</b> <span class="ev ev--1">E1</span>
    <div class="asst__quote">Excel 比手工多的 8 项：学历要求 · 经验要求 · 技能 · 福利 ·
      最低薪资 · 最高薪资 · 薪资单位 · 有效期</div>
    如果你的岗位需要标注学历经验或有截止日期，建议用 Excel 模板导入。
    <div class="asst__acts"><a class="btn btn--sm btn--primary" href="sources.html">下载 Excel 模板</a></div>
    <div class="asst__note asst__note--warn">
      ⚠️ 诚实说明：其中<b>学历、经验、技能、福利</b>四项当前在一体机上<b>暂未展示</b>（数据已保存）。
      平台已登记该问题，展示上线后你填的内容会自动生效，不用重填。
    </div>`,

  '参展企业为什么我改不了？': `
    <b>目前参展企业、展区展位、活动资料、场馆导览都由平台管理员维护。</b> <span class="ev ev--1">E1</span>
    你在招聘会页能改的是场次基本信息（名称、时间、地点、简介、来源链接）。
    <div class="asst__note asst__note--warn">
      ⚠️ 这一点平台已识别为待改进项：办会的是你，参展企业变动只有你知道。
      开放机构自助管理已列入计划。在那之前，参展企业变动请走工单，平台会当天处理。
    </div>
    <div class="asst__acts"><button class="btn btn--sm btn--primary">提交参展企业变更</button></div>`,

  '招聘会资料怎么上传？': `
    <b>目前活动资料由平台管理员上传。</b> <span class="ev ev--1">E1</span>
    你可以把物料文件通过工单提交，平台会上传并发布到该场次；
    求职者在一体机的招聘会页可以直接打印。
    <div class="asst__note asst__note--warn">⚠️ 另有一个已知问题：公开详情页当前显示的资料数固定为 0，正在修复。</div>
    <div class="asst__acts"><button class="btn btn--sm btn--primary">提交物料</button></div>`,

  '为什么主办方显示的不是我们？': `
    <b>这是一个已知的展示问题。</b> <span class="ev ev--1">E1</span>
    <div class="asst__quote">终端上「主办方」这一栏，目前取的是<b>数据来源机构</b>的名字，
      而不是招聘会真正的主办单位。</div>
    如果这场会是通过你们机构同步进来的，就会显示你们的名字；
    如果是别的机构同步的，就显示那家。
    <div class="asst__note">平台已登记修复（增加独立的「主办方」字段）。需要临时更正请提工单。</div>`,

  '企业展示哪些指标能自己控制？': `
    <b>系统支持 4 个展示开关：在招岗位数 · 城市 · 员工规模 · 展位号。</b>
    <div class="asst__note asst__note--warn">
      ⚠️ 诚实说明：这 4 个开关目前<b>只有平台管理员能设置</b>，机构侧界面还没开放
      （后端已支持）。需要调整请提工单，开放自助已列入计划。
    </div>
    <div class="asst__acts"><button class="btn btn--sm btn--primary">申请调整展示指标</button></div>`,

  '这个月效果怎么样？': `
    <b>本月你的内容表现（08-01 ~ 08-11）</b> <span class="ev ev--1">E1</span>
    <div class="asst__tree">
      <div class="asst__step asst__step--ok">列表曝光 <b>6,820</b> 次 · 较上月同期 +12.4%</div>
      <div class="asst__step asst__step--ok">详情浏览 <b>1,437</b> 次 · 转化率 21.1%（同类机构中位 18.4%）</div>
      <div class="asst__step asst__step--warn">打开来源平台 <b>312</b> 次 · 转化率 21.7%（中位 26.8%，<b>偏低</b>）</div>
    </div>
    <b>值得看一下：</b>有 3 条岗位占了 18% 曝光但<b>零跳转</b>——都是已过截止日的。
    <div class="asst__acts"><a class="btn btn--sm btn--primary" href="stats.html">看完整报表</a>
      <a class="btn btn--sm" href="jobs.html">处理这 3 条</a></div>
    <div class="asst__note">数据只到机构维度聚合，不含任何求职者个人信息。</div>`,

  '哪些内容没人看？': `
    <b>本周有 5 条内容曝光后零详情浏览。</b> <span class="ev ev--1">E1</span>
    <div class="asst__tree">
      <div class="asst__step asst__step--warn"><b>3 条</b> 已过截止日 —— 建议下架或改期</div>
      <div class="asst__step asst__step--warn"><b>2 条</b> 缺薪资区间 —— 终端不显示薪资的岗位，浏览率平均低 34%</div>
    </div>
    <div class="asst__acts"><a class="btn btn--sm btn--primary" href="jobs.html">去处理</a></div>`,

  '数据源为什么同步失败？': `
    <b>「校招平台 API」连续 3 次失败，都是同一个原因。</b> <span class="ev ev--2">E2</span>
    <div class="asst__quote">08-07 / 08-08 / 08-09 三次定时同步均返回 <code>HTTP 401 未授权</code>。
      最近一次成功是 08-06 —— 典型的<b>访问令牌过期</b>，不是网络问题。</div>
    <div class="asst__acts"><a class="btn btn--sm btn--primary" href="sources.html">去更换凭证</a>
      <a class="btn btn--sm" href="sources.html">先用 Excel 手动导入</a></div>`,

  '凭证怎么更换？': `
    <b>在数据源页找到对应来源 → 轮换凭证 → 填新 Token → 测试并保存。</b>
    <div class="asst__note">出于安全，系统<b>永远不显示已保存的凭证</b>，只显示「已配置」。
      测试不通过不会覆盖旧凭证。</div>
    <div class="asst__acts"><a class="btn btn--sm btn--primary" href="sources.html">去更换</a></div>`,

  '政策审核要多久？': `
    <b>政策公告的平均审核时长是 1.2 个工作日。</b> <span class="ev ev--1">E1</span>
    你当前有 1 条待审核（提交于 08-10）。
    <div class="asst__note">审核通过并发布后，会出现在一体机「政策服务」的对应分类下，求职者可打印办事清单。</div>`,

  '官方入口链接有什么要求？': `
    <b>政策的「官方入口」应当指向官方办理页面。</b>
    <div class="asst__note asst__note--warn">
      ⚠️ 诚实说明：系统当前<b>只校验链接格式，不校验是否官方域名</b>。
      这意味着填错了系统不会拦住你，但审核时会被驳回。平台已登记加强校验。
    </div>
    建议：使用政府门户或人社部门官网的正式办理页地址，不要用短链或第三方转发页。
    <div class="asst__foot-tip">AI 判断，仅供参考 <span class="ev ev--3">E3</span></div>`,

  '资质快到期了会怎样？': `
    <b>你的人力资源服务许可证 30 天后到期（2026-09-10）。</b> <span class="ev ev--1">E1</span>
    <div class="asst__quote">到期后，本机构的 33 条在架内容会<b>自动转为不可见</b>，
      不是删除。补件通过后会恢复展示。</div>
    平台会在到期前 30 / 15 / 7 天各提醒一次。补件与核验通常需要 3–5 个工作日。
    <div class="asst__acts"><a class="btn btn--sm btn--primary" href="profile.html">现在上传新证件</a></div>`,

  '怎么给同事开子账号？': `
    <b>你的机构类型（高校就业中心）最多可开 5 个子账号，当前已用 3 个。</b> <span class="ev ev--1">E1</span>
    可分配的角色：机构管理员 / 内容编辑 / 只读。
    <div class="asst__note asst__note--warn">
      ⚠️ 手机号换绑与账号删除属高风险操作，目前仍由平台执行，请走工单。
    </div>
    <div class="asst__acts"><a class="btn btn--sm btn--primary" href="account.html">去添加</a></div>`,

  '我的内容为什么终端上看不到？': `
    <b>诊断顺序：审核 → 发布 → 归档 → 有效期 → 机构资质 → 终端投放。</b>
    <div class="asst__tree">
      <div class="asst__step asst__step--warn"><b>4 条</b> 待审核 <span class="ev ev--1">E1</span></div>
      <div class="asst__step asst__step--err"><b>1 条</b> 已驳回 · <a href="jobs.html">看原因</a></div>
      <div class="asst__step asst__step--warn"><b>3 条</b> 已过截止日</div>
      <div class="asst__step asst__step--ok">其余正常展示中</div>
    </div>
    <div class="asst__note">每一步都是查库结果，不是推测。</div>`,

  __fallback: `
    <b>这个问题我查不到确定答案。</b>
    我能查的是：本机构内容的状态与审核结果、数据源同步情况、资质到期、效果数据、操作方法。
    <div class="asst__note">涉及别的机构、求职者个人信息、平台内部配置的问题，我不回答。
      需要人工处理可以提工单，平台会在 1 个工作日内响应。</div>
    <div class="asst__acts"><button class="btn btn--sm btn--primary">提交工单</button></div>`,
}
