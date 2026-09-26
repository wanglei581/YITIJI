import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')

let failures = 0
function check(condition, message) {
  if (condition) console.log(`  PASS ${message}`)
  else {
    failures += 1
    console.error(`  FAIL ${message}`)
  }
}

console.log('\n=== Kiosk 入口服务真实性守卫 ===')

const readinessHook = read('src/hooks/useApiReadiness.ts')
for (const marker of [
  "'checking' | 'ready' | 'unavailable'",
  'AbortController',
  "cache: 'no-store'",
  '/health',
  'READINESS_TIMEOUT_MS',
]) {
  check(readinessHook.includes(marker), `在线服务探测保留 ${marker}`)
}


// 2026-09-20：五个服务台（/resume-service /jobs-service /fairs-service
// /interview-service /policy-service）迁入青序流光，五份旧壳页面已从路由摘掉，
// 共用 src/pages/service-hubs/QxServiceHubPage.tsx 一份实现。
//
// 断言改钉**活面**而不是那五个不再渲染的文件——门禁钉在死代码上就是只剩形式。
// 不变量一条没放宽，只是换了它该看的地方：
//   · 入口级在线服务探测仍在；
//   · checking 与 unavailable 都 fail-closed（不是只拦 unavailable）；
//   · 被拦的能力不得仍是可点控件，且必须说得出原因；
//   · 旧壳 `requiresApi: false` 的四个入口仍然离线可进，其余仍然 fail-closed。
const hubPage = read('src/pages/service-hubs/QxServiceHubPage.tsx')
const hubModel = read('src/pages/service-hubs/serviceHubModel.ts')
const hubSpecs = read('src/pages/service-hubs/serviceHubSpecs.ts')

// 抽取脚本既是生成器也是对账基准，两处判据都要用它，所以在这里一次性载入。
const SERVICE_HUB_EXTRACT = await import('./extract-service-hub-specs.mjs')
const SERVICE_HUB_SPECS_COUNTS_PRELOAD = SERVICE_HUB_EXTRACT.SERVICE_HUB_SPECS_COUNTS

/**
 * 去掉 /* ... *​/ 块注释后的代码面。
 *
 * 「这段代码里不许再出现 X」这类反向断言必须只看代码：本文件下面几条钉的是
 * 「不许再按标题正则猜图标」「不许再用 :first-of-type 命中主板」，而把 X 写进
 * 「为什么不该这么写」的注释里恰恰是**最该鼓励**的行为。不剥注释，就等于
 * 谁解释得越清楚谁越红，解释会被删掉，教训也跟着没了。
 */
const codeOf = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '')
const hubPageCode = codeOf(hubPage)

// 状态条的三态诚实话术随组件一起搬进服务台自己的提示条（旧 ServiceReadinessStrip
// 组件已随五页删除）。这条判据一字未改，只是钉到了真正渲染它的地方。
check(!/AI.*已连接/.test(hubPage), '健康检查不扩大声明为 AI 能力已连接')
// ready 态也必须出声。公共终端上「什么都没显示」会被读成「一切正常」，
// 所以就绪时说的是「进入后再确认」，而不是替下游页面承诺能办。
check(
  hubPage.includes('本页只负责分流，不预报在线、名额、价格或办理结果'),
  '服务台就绪态不预报在线 / 名额 / 价格 / 办理结果'
)

check(hubPage.includes('useApiReadiness'), '服务台使用入口级在线服务探测')
check(hubPage.includes('useTerminalDeviceStatus'), '服务台设备类能力看真实终端设备状态')
// 「检查中」与「不可用」都必须算 blocked。只拦 unavailable 等于用「还不知道」冒充「可以用」。
check(
  /apiChecking:\s*apiStatus === 'checking'/.test(hubPage) &&
    /apiDown:\s*apiStatus === 'unavailable'/.test(hubPage),
  '服务台把 checking 与 unavailable 分开取，两者都进降级判据'
)
check(
  /const apiBlocked = apiStatus !== 'ready'/.test(hubPage),
  '服务台 apiBlocked 覆盖 checking 与 unavailable（fail-closed）'
)
check(
  /if \(state\.apiChecking\) return/.test(hubModel) &&
    /if \(state\.deviceChecking\) return/.test(hubModel),
  '降级判据在「正在确认」阶段同样返回不可用原因（不得放行）'
)
// 被拦时不是「灰掉的按钮」而是一张说明原因的非可点卡片：CLAUDE.md §9「不伪造能力」，
// 点不动必须说得出为什么。
check(
  /className="qx-hub-card is-unavailable"[\s\S]*?role="group"[\s\S]*?aria-disabled="true"/.test(hubPage),
  '不可用能力不再是可点控件（role=group + aria-disabled）'
)
check(
  /data-disabled-reason=\{`capability:\$\{cap\.kind\}`\}/.test(hubPage),
  '不可用能力带 data-disabled-reason，原因可被走查取证'
)
for (const copy of ['正在确认在线服务', '在线服务暂不可用', '重新检测']) {
  check(hubPage.includes(copy), `服务台展示真实检查状态「${copy}」`)
}
check(/onClick=\{retryApi\}/.test(hubPage), '服务台保留在线服务重新检测入口')

// 旧壳五页把「后端不可达也能进」写成 `requiresApi: false`，**默认 true**；
// 迁移必须原样保住这条 fail-closed，不能因为稿把浏览类标成 `kind: 'info'`
// 就让 /jobs、/job-fairs、/me/* 在后端断开时仍写着「进入 →」。
// 青序流光把它收进 serviceHubModel 的 needsBackend()：白名单登记即可离线进，
// 未登记一律按需要后端。下面两族断言分别钉「白名单里有什么」和「默认是拒绝」。
const OFFLINE_ENTRIES = [
  ['/jobs/online-platforms', '线上招聘平台保留离线二维码入口'],
  ['/interview/tips', '面试技巧保留离线阅读入口'],
  ['/renshi?tab=social', '社保指南保留离线指引入口'],
  ['/renshi?tab=register', '档案与登记保留离线指引入口'],
]
for (const [route, label] of OFFLINE_ENTRIES) {
  check(
    new RegExp(`route: '${route.replace(/[?]/g, '\\$&')}',\\s*kind: 'info'`).test(hubSpecs) &&
      new RegExp(`'${route.replace(/[?]/g, '\\$&')}',`).test(
        hubModel.slice(hubModel.indexOf('OFFLINE_CAPABLE_ROUTES')),
      ),
    label
  )
}
check(
  /export function needsBackend\(route: string\): boolean \{\s*return !OFFLINE_CAPABLE_ROUTES\.has\(route\)/.test(
    hubModel,
  ),
  '离线可进是白名单制：未登记的路由一律按需要后端（fail-closed）'
)

// ── 白名单页自己的出口不得成为绕过口 ────────────────────────────────────────
//
// OFFLINE_CAPABLE_ROUTES 说的是「不联网也能**读**这一页」，不是「这一页上的每个
// 按钮都不需要后端」。四条白名单页各自都有通往需要后端的页面的出口
// （`/jobs/online-platforms` → `/jobs` 与 `/assistant`；`/renshi` → `/assistant`），
// 但那些落点都是**只读页**，进去看到的是空态或错误态，用户没有付出任何填写。
// `/interview/tips` 不同，它是唯一一条出口会**在服务端建会话**的：底部
// 「开始模拟面试」走 setup → POST /mock-interviews，用户要先选岗位、面试官和时长，
// 填完才在最后一步撞上错误。所以本段只钉这一条；另外三条属于同类但更轻的缺口，
// 已登记在 `docs/progress/next-tasks.md`，不在本段断言范围内（写清楚是为了
// 下一个读这段的人不会以为它们已经被这条门禁覆盖了）。
//
// 缺这条断言时的实际走法：后端断开 → 面试服务台把「模拟练习」卡 fail-closed →
// 用户改点同一个服务台上的「先看技巧」（白名单，允许进）→ 在技巧页点「开始模拟面试」
// → 进 setup。服务台那条判据被整条绕过，用户最后停在一个填完表才报错的设置页。
//
// 判据必须与服务台同源：checking 与 unavailable 都不放行。只拦 unavailable，
// 等于在探测的那几秒里留一扇门。
{
  const tips = read('src/pages/interview/InterviewTipsPage.tsx')
  const tipsCode = codeOf(tips)
  check(tips.includes('useApiReadiness'), '面试技巧页按入口级在线服务探测判断能否开始练习')
  check(
    /function startGate\(status: 'checking' \| 'ready' \| 'unavailable'\)/.test(tips) &&
      /if \(status === 'unavailable'\)/.test(tips) &&
      /if \(status === 'checking'\)/.test(tips),
    '面试技巧页出口闸门对 unavailable 与 checking 都给出原因（两半都 fail-closed）'
  )
  // 渲染层与行为层都要挡。aria-disabled 的按钮仍可被程序化点击，
  // 只改外观等于「看起来点不动」而实际仍然导航。
  // 位置也要断言：闸门必须排在写 session 与 navigate 之前，写完再 return 拦不住任何东西。
  {
    const body = tipsCode.slice(tipsCode.indexOf('const goSetup = () => {'))
    const gateAt = body.indexOf('if (gate) return')
    const patchAt = body.indexOf('patchInterviewWorkbenchSession(')
    const navAt = body.indexOf("navigate('/interview/setup')")
    check(
      gateAt > 0 && patchAt > gateAt && navAt > gateAt,
      '面试技巧页 goSetup 先看闸门再写 session / 导航（aria-disabled 拦不住程序化点击）'
    )
  }
  check(
    /aria-disabled="true"[\s\S]{0,320}?data-testid="interview-primary"/.test(tips) &&
      /aria-describedby="interview-tips-start-why"/.test(tips),
    '不可用时「开始模拟面试」不是可点控件，且用 aria-describedby 指向具体原因'
  )
  // 本地技巧内容一条都不许因此消失：拦的是出口，不是这一页。
  // 白名单当初把它登记进来，就是为了后端断开时还有东西可读。
  for (const local of ['面试前准备清单', '高频问题应对', 'STAR', '自我介绍结构建议']) {
    check(tips.includes(local), `在线服务不可用不影响本地技巧内容「${local}」仍然渲染`)
  }
  check(
    /className="qx-btn"[\s\S]{0,200}?onClick=\{retryApi\}/.test(tips),
    '面试技巧页在线服务不可用时保留「重新检测」，不让用户只能退出去'
  )
}

// 政策服务台的「我的」入口不得声称一份系统并不保存的历史。
//
// 稿 16 原写的是 `['AI问答记录','查看本人政策问答', … '/me/ai-records']`，
// 但 /me/ai-records 的内容由 MemberAiRecordKind 决定，它只有
// parse / optimize / generate / job_fit / career_plan / fair_visit_plan / self_assessment
// 七类，外加岗位 AI 会话与模拟面试记录——**没有一类是政策问答**。
// 政策服务台的 AI 能力是「打开AI顾问」（/assistant），而顾问对话根本不落库。
// 于是这条入口承诺了一份点进去必然为空、且永远不会有内容的历史。
// 稿与规格已一并改为真实能力（title/description 都改），这里钉住不许改回去。
check(
  !hubSpecs.includes('查看本人政策问答') && !hubSpecs.includes('AI问答记录'),
  '政策服务台不再声称「AI问答记录 / 查看本人政策问答」（/me/ai-records 不保存政策问答）'
)
{
  const draft = fs.readFileSync(
    path.join(root, '..', '..', 'docs/design/kiosk-redesign-2026-08/16-service-hubs.html'),
    'utf8',
  )
  check(
    !draft.includes('查看本人政策问答') && !draft.includes('AI问答记录'),
    '设计真值 16-service-hubs.html 与规格同步改掉政策问答历史（稿是抽取源，只改代码会被下次抽取覆盖回去）'
  )
}
// 判据要真的作用在每张卡上：unavailableReason 必须拿到该卡的 route，
// 否则白名单写得再对也落不到界面上。
check(
  /unavailableReason\(cap\.kind, cap\.route, availability\)/.test(hubPage) &&
    /unavailableReason\(link\.kind, link\.route, availability\)/.test(hubPage),
  '能力卡与常用入口都按各自 route 判定是否可进'
)
check(
  /unavailableReason\(kind, goal\.route, availability\)/.test(hubPage) &&
    /capabilityKindFor\(spec, goal\.route\)/.test(hubPage),
  '目标分段与能力卡共用同一条 fail-closed 判据，不得另开一条可点通道'
)
{
  const noticeFn = hubPage.slice(hubPage.indexOf('function noticeCopy'), hubPage.indexOf('export function QxServiceHubPage'))
  const apiDownAt = noticeFn.indexOf('if (state.apiDown)')
  const apiCheckingAt = noticeFn.indexOf('if (state.apiChecking)')
  const deviceOffAt = noticeFn.indexOf('if (state.deviceOff)')
  const deviceCheckingAt = noticeFn.indexOf('if (state.deviceChecking)')
  check(
    apiDownAt >= 0 && apiCheckingAt > apiDownAt && deviceOffAt > apiCheckingAt,
    '分流提示条：apiDown / apiChecking 优先于 deviceOff（device-off 文案会声称 AI 仍可进入）'
  )
  // 提示条必须覆盖 deviceChecking，而不是让它掉进末尾的就绪态 default。
  //
  // 为什么这条该存在（不是照当前行为反写）：`data-readiness` 在 deviceChecking 时是
  // 'checking'、顶栏胶囊是「正在确认本机设备」、图标是转圈的 LoaderCircle——三个信号
  // 都说「还在确认」，正文却说「进入具体服务后再确认实时能力 / 本页只负责分流」，
  // 那是就绪态的话术。同一条提示条自相矛盾时，用户信的是文字。
  // CLAUDE.md §9「不伪造能力」：没拿到结论就不能用就绪口径播报。
  check(
    deviceCheckingAt > deviceOffAt && deviceOffAt >= 0,
    '分流提示条为 deviceChecking 单独出话术，排在 deviceOff 之后（不得落进就绪态 default）'
  )
  check(
    noticeFn.includes('正在确认本机设备。'),
    '设备探测未出结果时提示条正文说「正在确认本机设备」，不说就绪态的「进入具体服务后再确认」'
  )
}
check(
  /if \(!needsBackend\(route\)\) return null/.test(hubModel) &&
    /if \(state\.apiDown\) return '在线服务当前不可用'/.test(hubModel) &&
    /if \(state\.apiChecking\) return '正在确认在线服务'/.test(hubModel),
  '需要后端的入口在 unavailable / checking 下都给出原因（两半都 fail-closed）'
)

// ── 2026-09-20 定向修复的四条不变量 ─────────────────────────────────────────
// 每条都对应一个已经在 1080×1920 截图里看得见的缺陷，不是预防性装饰。

// 1) 图标取自稿的 `icon` 键，不是按标题猜。
//    修复前这里是一张 TITLE_ICON 正则表（抽取丢了稿的 icon 字段），代价：
//    「校园招聘」稿 building 却渲染成文档，「岗位匹配参考」稿 chart 却渲染成公文包。
check(!/TITLE_ICON/.test(hubPageCode), '服务台不按标题正则猜图标（TITLE_ICON 已删除）')
check(
  /const HUB_ICON: Record<HubIconKey, typeof BotIcon> = \{/.test(hubPage),
  '服务台图标是 HubIconKey → lucide 的**全量**显式映射（漏登记会 typecheck 红，不会静默兜底）'
)
check(
  /const Icon = HUB_ICON\[cap\.icon\]/.test(hubPage) && /const Icon = HUB_ICON\[link\.icon\]/.test(hubPage),
  '能力卡与常用入口都按稿里那张卡自己的 icon 键取图标'
)
{
  const iconed = hubSpecs.match(/icon: '[a-z]+'/g) ?? []
  check(
    iconed.length === SERVICE_HUB_SPECS_COUNTS_PRELOAD.cards + SERVICE_HUB_SPECS_COUNTS_PRELOAD.quick,
    `规格表里 36 张卡 + 15 条常用入口各自带稿的 icon 键（实得 ${iconed.length}）`
  )
}

// 2) 没有设备能力的服务台不探测、也不播报本机设备。
//    修复前岗位 / 招聘会 / 面试 / 政策四页都在替打印机说话：顶栏「正在确认本机设备」
//    永远不会有下文（hook 停用档的 loading 停在初始 true），用户只会以为这页坏了。
check(
  /export function hubUsesDevice/.test(hubModel),
  '是否有设备能力由规格自身判定（稿标的 kind: device），不写死 hub 名字'
)
check(
  /const deviceAware = hubUsesDevice\(spec\)/.test(hubPage) &&
    /useTerminalDeviceStatus\(deviceAware\)/.test(hubPage),
  '服务台按 deviceAware 决定要不要探测本机设备'
)
check(
  /deviceOff: deviceAware && \(/.test(hubPage) && /deviceChecking: deviceAware &&/.test(hubPage),
  '无设备能力的服务台，设备降级判据恒为 false（不播报打印机离线 / 探测中）'
)
{
  // hook 的停用档必须真的停掉副作用：`if (!enabled) return` 要排在 fetch 与轮询定时器之前。
  const hook = read('src/hooks/useTerminalDeviceStatus.ts')
  const guardAt = hook.indexOf('if (!enabled) return')
  const fetchAt = hook.indexOf('await fetch(')
  const timerAt = hook.indexOf('window.setInterval')
  check(
    guardAt > 0 && fetchAt > guardAt && timerAt > guardAt,
    'useTerminalDeviceStatus(false) 在发请求与挂 60s 轮询之前就 return（停用即不占用后端与定时器）'
  )
}

// 3) 主能力板吸收整页余量的判据必须是显式类名。
//    修复前写的是 `.qx-hub-board:first-of-type`——`:first-of-type` 按标签名算，
//    `.qx-hub` 里第一个 <section> 是目标分段，这条规则一次都没命中：
//    六卡页（招聘会 / 面试）底部留下约 400px 死白。
{
  const hubCss = read('src/pages/service-hubs/styles/service-hub-qx.css')
  check(
    !/\.qx-hub-board:first-of-type/.test(codeOf(hubCss)),
    '主能力板不靠 :first-of-type 命中（它按标签名算，第一个 <section> 是目标分段）'
  )
  check(
    /\.qx-hub-board--primary\s*\{[^}]*flex: 1 0 auto/.test(hubCss) &&
      /className="qx-hub-board qx-hub-board--primary"/.test(hubPage),
    '主能力板由显式类名 qx-hub-board--primary 吸收余量（可长不可缩）'
  )
}

// 4) 同一件事在页面上只能有一个严重度。
//    device-off 时顶栏胶囊是琥珀 warn，提示条此前却用朱砂红的 unavailable。
check(
  /availability\.apiDown\s*\?\s*'unavailable'/.test(hubPage) &&
    /availability\.deviceOff\s*\?\s*'degraded'/.test(hubPage),
  '提示条 unavailable 只留给 apiDown；deviceOff 走 degraded，与顶栏 warn 同一严重度'
)

// 5) 域标识与目标分段说明。
check(/\{spec\.eyebrow\}/.test(hubPage), '服务台渲染稿的 eyebrow（域标识，回答「我在哪个服务域」）')
check(
  !/\{spec\.sectionHint\}；/.test(hubPage) &&
    hubPage.includes('选择后直接进入对应服务；不会替你提交或生成结果。'),
  '目标分段用稿的固定说明，不再拼 sectionHint（那会让同一句话在一屏里出现两次）'
)

// 规格表 ↔ 稿 16-service-hubs.html 的转录对账。
// 这份 36 张卡 / 17 个目标 / 15 条常用入口的规格是机械抽取产物；2026-09-10 那版
// 漏掉稿里的 quick，15 条通往「我的」台账的入口静默消失过一次。手改 specs、
// 或改了稿没重跑抽取，在这里当场变红。
const { SERVICE_HUB_SPECS_TEXT, SERVICE_HUB_SPECS_COUNTS } = SERVICE_HUB_EXTRACT
check(
  hubSpecs === SERVICE_HUB_SPECS_TEXT,
  `serviceHubSpecs.ts 与稿 16-service-hubs.html 逐字节一致（hubs=${SERVICE_HUB_SPECS_COUNTS.hubs} cards=${SERVICE_HUB_SPECS_COUNTS.cards} goals=${SERVICE_HUB_SPECS_COUNTS.goals} quick=${SERVICE_HUB_SPECS_COUNTS.quick}）；不一致请跑 node scripts/extract-service-hub-specs.mjs 而不是手改`
)

const printScanHome = read('src/pages/print-scan/PrintScanHomePage.tsx')
check(printScanHome.includes('loadConfiguredCapabilities'), '打印扫描首页保留能力加载状态')
check(!printScanHome.includes('getConfiguredCapabilities'), '打印扫描首页不再吞掉能力加载失败')
// P39 迁移（V6 纵切第一刀）把「能力是否已确认」从行内三元收成
// toProbeStatus() + confirmed 两步，断言随结构改写，**不变量一字未变**：
// 只有探测结果不是 error 才判定为已确认，其余一律 fail-closed。
check(
  /function toProbeStatus[\s\S]*?load\.status === 'error' \? 'error' : 'ok'/.test(printScanHome),
  '能力探测失败一律判为未确认（不得把 error 当成可放行）'
)
check(
  /const confirmed = probe === 'ok'/.test(printScanHome),
  '只有能力配置读取成功才放行任务入口'
)
check(/available: false,[\s\S]*?to: ''/.test(printScanHome), '能力未确认时正式任务入口 fail-closed')
for (const forbidden of ['AI 就绪', '自动双面打印', '一次最多 50 页', '固定输出 PDF']) {
  check(!printScanHome.includes(forbidden), `打印扫描首页不再显示未证明断言「${forbidden}」`)
}

const capabilityApi = read('src/services/api/printScanCapabilities.ts')
for (const marker of ['AbortController', "cache: 'no-store'", 'CAPABILITY_TIMEOUT_MS']) {
  check(capabilityApi.includes(marker), `能力配置请求保留 ${marker}`)
}

const home = read('src/pages/home/HomePage.tsx')
check(home.includes('useTerminalDeviceStatus'), '首页本机卡使用真实打印机状态')
for (const forbidden of ['文档打印就绪', '材料扫描就绪', '自动双面可用']) {
  check(!home.includes(forbidden), `首页不再硬编码「${forbidden}」`)
}

const upload = read('src/pages/print/PrintUploadPage.tsx')
check(!upload.includes('生产 Kiosk 将切换为 Agent 文件中转'), '打印上传页不显示内部实现横幅')
check(!upload.includes('import { API_MODE }'), '打印上传页移除仅供开发横幅使用的 API_MODE import')

console.log('')
if (failures > 0) {
  console.error(`=== FAILED: ${failures} assertion(s) ===\n`)
  process.exit(1)
}
console.log('=== ALL PASS ===\n')
