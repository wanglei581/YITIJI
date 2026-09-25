/**
 * 数据大屏前端门禁（同时守 admin / partner / packages/ui 三处，只做一个脚本）。
 *
 * 守的是这块屏最容易被悄悄破坏的六件事：
 *   1. 未接入的指标被人补成 0 —— 那是这个项目最不能犯的错；
 *   2. 未接入原因表与后端契约漂移 —— 少一条就会在屏上显示成兜底文案；
 *   3. 机构侧请求被加上 orgId 或缓存穿透参数 —— 服务端会 400，且是跨机构风险面；
 *   4. 时间用 toISOString 手工切片 —— 那是 UTC 墙钟冒充本地时间；
 *   5. 卡片漏掉来源脚注 —— 设计稿第一条硬约束；
 *   6. 屏上出现投递字样 —— 合规红线。
 *
 * 与 scripts/verify-compliance-copy.mjs 的关系：那条是全树扫禁用词，
 * 这条在大屏范围内更严（连白名单里的「去来源平台投递」也不许出现，
 * 因为大屏没有跳转动作，出现投递二字只可能是误写）。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const adminRoot = fileURLToPath(new URL('..', import.meta.url))
const repoRoot = fileURLToPath(new URL('../../..', import.meta.url))

const failures = []
function check(condition, message) {
  if (condition) {
    console.log(`PASS ${message}`)
  } else {
    failures.push(message)
    console.error(`FAIL ${message}`)
  }
}

function read(rel) {
  return readFileSync(join(repoRoot, rel), 'utf8')
}

function collect(rel) {
  const abs = join(repoRoot, rel)
  const out = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) walk(full)
      else if (/\.(ts|tsx)$/.test(entry)) out.push(full)
    }
  }
  walk(abs)
  return out.map((full) => ({ path: relative(repoRoot, full), source: readFileSync(full, 'utf8') }))
}

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}

console.log('\n=== 数据大屏前端门禁 ===')

const SCREEN_DIRS = [
  'apps/admin/src/routes/screen',
  'apps/partner/src/routes/screen',
  'packages/ui/src/screen',
]
const screenFiles = SCREEN_DIRS.flatMap(collect)
const serviceFiles = [
  { path: 'apps/admin/src/services/api/consoleScreen.ts', source: read('apps/admin/src/services/api/consoleScreen.ts') },
  { path: 'apps/partner/src/services/api/consoleScreen.ts', source: read('apps/partner/src/services/api/consoleScreen.ts') },
]
const allFiles = [...screenFiles, ...serviceFiles]
const adminService = serviceFiles[0].source
const partnerService = serviceFiles[1].source

check(screenFiles.length >= 10, `大屏组件文件被扫到（实际 ${screenFiles.length} 个，期望 ≥10）`)

// ── 1. 原因表与后端契约逐条对齐 ───────────────────────────────────────────
const contract = read('packages/shared/src/types/consoleScreen.ts')
const reasonBlock = contract.slice(
  contract.indexOf('export const SCREEN_UNAVAILABLE_REASON'),
  contract.indexOf('export type ScreenUnavailableReason'),
)
const contractReasons = [...reasonBlock.matchAll(/:\s*'([a-z_]+)'/g)].map((m) => m[1]).sort()
const copySource = read('packages/ui/src/screen/screenCopy.ts')
const copyBlock = copySource.slice(copySource.indexOf('export const SCREEN_REASON_COPY'))
const copyKeys = [...copyBlock.matchAll(/^\s{2}([a-z_]+):\s*\{/gm)].map((m) => m[1]).sort()
check(contractReasons.length >= 13, `契约里解析到 ${contractReasons.length} 个未接入原因`)
check(
  JSON.stringify(contractReasons) === JSON.stringify(copyKeys),
  `未接入原因文案表与契约完全一致（契约 ${contractReasons.length} / 文案表 ${copyKeys.length}）`,
)
// 取数失败必须与结构性缺失分开：一个刷新会回来，一个刷新无用
check(
  /source_query_failed:\s*\{[^}]*transient:\s*true/s.test(copyBlock),
  '取数失败被标为 transient，可与结构性未接入分开渲染',
)
check(
  (copyBlock.match(/transient:\s*true/g) ?? []).length === 1,
  '只有取数失败是 transient，结构性缺口不会被说成「刷新一下就好」',
)

// ── 2. 绝不给不可用指标补 0 ───────────────────────────────────────────────
for (const file of allFiles) {
  const code = stripComments(file.source)
  check(!/\?\?\s*0\b/.test(code), `${file.path} 没有 ?? 0 数值兜底`)
  check(!/\|\|\s*0\b/.test(code), `${file.path} 没有 || 0 数值兜底`)
}
check(
  /if \(!metric \|\| metric\.available === false\)/.test(read('packages/ui/src/screen/ScreenPrimitives.tsx')),
  'ScreenMetricCard 是唯一取数入口，available:false 与缺席都走未接入分支',
)

// ── 3. 时间与错误文案 ─────────────────────────────────────────────────────
for (const file of allFiles) {
  const code = stripComments(file.source)
  check(!/toISOString\s*\(\s*\)\s*\.\s*(slice|replace)/.test(code), `${file.path} 没有 toISOString 手工切片`)
  // M4 教训：不写 toISOString 也能手工切 ISO 串（`generatedAt.slice(0,19).replace('T',' ')`）。
  // 所以直接禁掉这两种切法本身，时间一律走 formatDateTime。
  check(
    !/\.slice\s*\(\s*0\s*,\s*(10|16|19)\s*\)/.test(code),
    `${file.path} 没有按位切 ISO 时间串`,
  )
  check(
    !/\.replace\s*\(\s*['"]T['"]\s*,/.test(code),
    `${file.path} 没有把 ISO 的 T 换成空格冒充本地时间`,
  )
  check(
    !/(\b\w+)\s+instanceof\s+Error\s*\?\s*\1\.message/.test(code),
    `${file.path} 没有把原始 Error.message 直接渲染`,
  )
  check(!/https?:\/\/\d{1,3}(\.\d{1,3}){3}/.test(code), `${file.path} 没有硬编码 IP 主机`)
}
check(
  /formatDateTime/.test(read('apps/admin/src/routes/screen/screenMeta.ts'))
    && /formatDateTime/.test(read('apps/partner/src/routes/screen/screenMeta.ts')),
  '两端页眉时间戳都走 formatDateTime（Asia/Shanghai）',
)

// ── 4. 跨机构隔离与非法参数 ───────────────────────────────────────────────
// 每端第一个 fetch 必须是快照（下面两条按「第一个」取）；其后只允许单台孪生与使用统计两个端点。
check(!/['"]\/admin\//.test(stripComments(partnerService)), '机构侧取数没有引用任何 /admin 端点')
check(!/orgId/.test(stripComments(partnerService)), '机构侧取数不出现 orgId（服务端只从鉴权用户回源）')
const partnerUrl = partnerService.match(/fetch\(`([^`]+)`/)
check(Boolean(partnerUrl), '机构侧取数使用模板串 URL')
check(
  Boolean(partnerUrl) && !partnerUrl[1].includes('?'),
  `机构侧请求不带任何 query（实际 ${partnerUrl ? partnerUrl[1] : 'N/A'}）`,
)
check(
  /partner\/screen\/snapshot/.test(partnerService),
  '机构侧打的是 /partner/screen/snapshot',
)
const adminUrl = adminService.match(/fetch\(`([^`]+)`/)
check(
  Boolean(adminUrl) && /\?profile=\$\{profile\}$/.test(adminUrl[1]),
  `管理员侧只发 profile 一个参数（实际 ${adminUrl ? adminUrl[1] : 'N/A'}）`,
)
check(
  /return raw === 'ops' \? 'ops' : 'gov'/.test(adminService),
  '非法 profile 在前端纠正为 gov，不把非法值发给服务端',
)
for (const file of allFiles) {
  const code = stripComments(file.source)
  check(!/[?&]t=\$\{Date\.now\(\)\}|_=\$\{Date\.now\(\)\}/.test(code), `${file.path} 没有缓存穿透参数`)
}
// 孪生大屏新增了单台孪生与使用统计两个端点：两端的每一个 fetch 地址都必须在白名单里，
// 唯一允许的 query 是经白名单纠正过的 range（today / 7d / 30d），非法值不发给服务端。
const PARTNER_URLS = [
  '${API_BASE_URL}/partner/screen/snapshot',
  '${API_BASE_URL}/partner/screen/terminals/${encodeURIComponent(terminalId)}',
  '${API_BASE_URL}/partner/screen/usage?range=${normalizeUsageRange(range)}',
]
const ADMIN_URLS = [
  '${API_BASE_URL}/admin/screen/snapshot?profile=${profile}',
  '${API_BASE_URL}/admin/screen/terminals/${encodeURIComponent(terminalId)}',
  '${API_BASE_URL}/admin/screen/usage?range=${normalizeUsageRange(range)}',
]
for (const [name, service, allowed] of [['机构', partnerService, PARTNER_URLS], ['管理员', adminService, ADMIN_URLS]]) {
  const urls = [...stripComments(service).matchAll(/fetch\(`([^`]+)`/g)].map((m) => m[1])
  check(
    urls.length === allowed.length && urls.every((url) => allowed.includes(url)),
    `${name}侧只打快照 / 单台孪生 / 使用统计三个端点，参数都在白名单里（实际 ${urls.join(' | ')}）`,
  )
  check(
    /export function normalizeUsageRange\(raw: string \| null \| undefined\): ScreenUsageRange \{\s*return raw === '7d' \|\| raw === '30d' \? raw : 'today'/.test(service),
    `${name}侧 range 只有 today / 7d / 30d，其余一律纠正为 today`,
  )
}

// ── 5. 信封口径：admin 解 data，partner 读裸对象 ──────────────────────────
check(/\(payload as \{ data\?: unknown \}\)\.data/.test(adminService), '管理员侧解 ApiResponse 信封的 data')
check(!/\.data\b/.test(stripComments(partnerService).replace(/\.data\?/g, '')), '机构侧不解信封，直接读裸对象')
check(/audience !== 'admin'/.test(adminService), '管理员侧校验 audience=admin')
check(/audience !== 'partner'/.test(partnerService), '机构侧校验 audience=partner')

// ── 6. 展示令牌与持久化 ───────────────────────────────────────────────────
for (const file of allFiles) {
  const code = stripComments(file.source)
  check(
    !/(localStorage|sessionStorage)\s*\.\s*setItem/.test(code),
    `${file.path} 不把快照或展示凭据写进浏览器存储`,
  )
  check(!/[?&]token=/.test(code), `${file.path} 不自造展示 token 参数`)
}
const adminPage = read('apps/admin/src/routes/screen/index.tsx')
const partnerPage = read('apps/partner/src/routes/screen/index.tsx')
check(
  /displayToken === 'not_issued'/.test(read('apps/admin/src/routes/screen/screenMeta.ts'))
    && /displayToken === 'not_issued'/.test(read('apps/partner/src/routes/screen/screenMeta.ts')),
  '页眉如实渲染「未签发免登录展示令牌」的访问口径',
)
// 取数失败的整屏说法统一在孪生外壳里（两端共用）；页面只负责把「重新登录」接到用户点击上。
const twinShell = read('packages/ui/src/screen/twin/TwinShell.tsx')
check(
  /result\.kind === 'unauthorized'/.test(twinShell) && /重新登录/.test(twinShell) && /onClick=\{onRelogin\}/.test(twinShell),
  '孪生外壳 401 渲染「重新登录」按钮，点了才跳转',
)
check(!/useEffect\(/.test(stripComments(twinShell)), '孪生外壳没有任何副作用（不会在 401 时自动跳走）')
for (const [name, page, view] of [
  ['管理员', adminPage, read('apps/admin/src/routes/screen/screenView.tsx')],
  ['机构', partnerPage, read('apps/partner/src/routes/screen/screenView.tsx')],
]) {
  check(!/redirectToLogin\(\)\s*\n\s*\}?\s*,?\s*\n?\s*\/\/ auto/.test(page), `${name}页 401 不静默跳转`)
  check(
    /onRelogin: \(\) => redirectToLogin\(\)/.test(page) && (page.match(/redirectToLogin\(/g) ?? []).length === 1,
    `${name}页只把 redirectToLogin 接在「重新登录」这一个用户动作上`,
  )
  check(
    /export \{ TwinFailurePanel as FailurePanel, TwinShell, TwinShellEmpty \} from '@ai-job-print\/ui'/.test(view),
    `${name}端的整屏失败说法来自共用外壳，不各写一份`,
  )
}

// ── 7. 每张卡都有来源脚注 ─────────────────────────────────────────────────
check(
  /foot: ReactNode/.test(read('packages/ui/src/screen/ScreenPrimitives.tsx')),
  'ScreenCard 的 foot 是必填 prop（类型层面保证，不靠评审）',
)
// 孪生面板同样把来源说明做成必填：TwinPanel 与 TwinMetricPanel 的 source 都没有问号。
const twinPanelSrc = read('packages/ui/src/screen/twin/TwinPanel.tsx')
// 只在各自的接口体里找（接口体不含花括号）：跨接口匹配会让其中一个改成可选时照样通过
const interfaceBody = (source, head) => {
  const at = source.indexOf(head)
  return at < 0 ? '' : source.slice(at, source.indexOf('}', at))
}
check(
  /^\s{2}source: ReactNode$/m.test(interfaceBody(twinPanelSrc, 'export interface TwinPanelProps {'))
    && /^\s{2}source: ReactNode$/m.test(interfaceBody(twinPanelSrc, "export interface TwinMetricPanelProps<T> extends Omit<TwinPanelProps, 'children' | 'source'> {")),
  'TwinPanel / TwinMetricPanel 的 source 是必填 prop（类型层面保证每块面板都有来源说明）',
)
for (const file of screenFiles.filter((f) => /<Twin(Metric)?Panel\b/.test(f.source))) {
  const opens = (file.source.match(/<Twin(Metric)?Panel\b/g) ?? []).length
  const sources = (file.source.match(/\ssource=/g) ?? []).length
  check(sources >= opens, `${file.path} 的 ${opens} 个孪生面板都传了 source（实际 ${sources} 处）`)
}
const gridFiles = screenFiles.filter((file) => /Grid\.tsx$/.test(file.path))
check(gridFiles.length === 3, `三套 profile 的栅格文件都在（实际 ${gridFiles.length}）`)
for (const file of gridFiles) {
  const opens = [...file.source.matchAll(/<Screen(MetricCard|Card)\b/g)]
  const foots = [...file.source.matchAll(/\n\s+foot=/g)]
  if (opens.length === 0) continue
  check(
    foots.length >= opens.length,
    `${file.path} 的 ${opens.length} 个卡片调用点都传了 foot（实际 ${foots.length} 处）`,
  )
}

// ── 8. 合规文案 ───────────────────────────────────────────────────────────
// 大屏没有跳转动作，所以「投递 / 收简历」只允许以**否定句**出现
// （设计稿 §三 要求屏上明写「不是投递结果」「本平台不收简历」）。
// 肯定形式一律判红。
const AFFIRMATIVE_CLOSURE = /(?<!不是|不做|不收|不|非)(一键投递|立即投递|平台投递|投递简历|投递成功|收简历|候选人管理|面试邀约|一键报名)/
for (const file of allFiles) {
  check(!AFFIRMATIVE_CLOSURE.test(file.source), `${file.path} 不出现肯定式招聘闭环用语`)
  check(!/一键投递|立即投递|平台投递|投递简历|投递成功/.test(file.source), `${file.path} 不出现投递类禁用词`)
}
check(
  /打开来源平台入口/.test(copySource),
  '外部入口只表述为「打开来源平台入口」',
)
// 正向对照：强制存在的免责句必须真的在，否则上面两条禁令是空转的
check(
  /不是投递结果/.test(copySource),
  '来源入口口径里写明「不是投递结果」（设计稿 §三 强制）',
)
check(
  /不收简历/.test(read('apps/admin/src/routes/screen/GovGrid.tsx')),
  '政务版在架岗位卡写明「本平台不收简历」',
)
check(
  /不收简历/.test(read('apps/partner/src/routes/screen/PartnerGrid.tsx'))
    && /不收简历/.test(read('apps/partner/src/routes/screen/PartnerUsageView.tsx')),
  '机构版总览与信息使用都写明「本平台不收简历」',
)
check(
  /不是投递或预约结果/.test(read('packages/ui/src/screen/twin/TwinInfoFlow.tsx'))
    && /不是投递结果/.test(read('apps/partner/src/routes/screen/PartnerUsageView.tsx')),
  '机构版「打开来源平台入口」在场景与面板里都写明不是投递 / 预约结果',
)

// ── 9. mock 模式一个数字都不出 ────────────────────────────────────────────
for (const [name, service] of [['管理员', adminService], ['机构', partnerService]]) {
  check(/API_MODE !== 'http'/.test(service) && /kind: 'mock'/.test(service), `${name}侧 mock 模式直接返回 mock，不发请求`)
}
check(
  /result\.kind === 'mock'/.test(twinShell) && /演示模式不展示大屏数值/.test(twinShell),
  '孪生外壳在 mock 模式渲染明确说明而不是假数据（两端共用）',
)

// ── 10. 机构未接入指标是算出来的，不是写死的清单 ──────────────────────────
const partnerLabels = read('apps/partner/src/routes/screen/metricLabels.ts')
check(
  /for \(const key of PARTNER_METRIC_KEYS\)/.test(partnerLabels)
    && /metric\.available !== false/.test(partnerLabels),
  '机构未接入归并从响应算出，后端补齐后会自动消失',
)
check(
  /countPartnerGapMetrics/.test(read('apps/partner/src/routes/screen/PartnerGrid.tsx')),
  '归并面板标出覆盖了多少项，不造成「已全部接入」的错觉',
)

// ── 11. 机队样本 vs 全量 ──────────────────────────────────────────────────
const fleet = read('packages/ui/src/screen/ScreenFleetWall.tsx')
check(/sampledCount/.test(fleet) && /matchedCount/.test(fleet), '机队组件同时使用样本数与全量数')
check(
  /显示前|以下分类基于前/.test(fleet) || /基于前 \$\{screenCount\(value\.sampledCount\)\} 台样本/.test(fleet),
  '截断时明确写出样本口径，不把样本分类当全量',
)
check(
  /unit: `\/ \$\{screenCount\(value\.sampledCount\)\} 台`/.test(fleet),
  '在网终端的分母是样本台数，不是全量台数',
)

// ── 12. 卡中卡 ────────────────────────────────────────────────────────────
for (const file of gridFiles) {
  const code = stripComments(file.source)
  // 栅格里每个 <ScreenCard>/<ScreenMetricCard> 都必须在下一个卡片开始前闭合
  const opens = (code.match(/<Screen(Card|MetricCard)\b/g) ?? []).length
  // 孪生栅格（GovGrid / PartnerGrid）不用 ScreenCard，改由下方 .twin-panel 的选择器检查与 E2E 的运行时检查守住
  if (opens === 0 && /<Twin(Metric)?Panel\b/.test(code)) continue
  const closes = (code.match(/<\/ScreenCard>|\/>\s*$/gm) ?? []).length
  check(opens > 0 && closes >= opens, `${file.path} 的卡片逐个闭合，没有卡片套卡片（${opens} 开 / ${closes} 闭）`)
}
// 样式按「壳 / 块 / 字阶」拆成三份（单文件曾到 1005 行）。
// 门禁读的是三份的合集：拆分只许搬运，不许把规则搬丢。
const CSS_FILES = [
  'packages/ui/src/styles/ops-screen.css',
  'packages/ui/src/styles/ops-screen-blocks.css',
  'packages/ui/src/styles/ops-screen-scale.css',
  // 孪生大屏：壳 / 面板小件 / 块位与字阶 / 3D 场景
  'packages/ui/src/styles/twin-screen.css',
  'packages/ui/src/styles/twin-screen-parts.css',
  'packages/ui/src/styles/twin-screen-layout.css',
  'packages/ui/src/styles/twin-screen-3d.css',
]
const css = CSS_FILES.map(read).join('\n')
for (const rel of CSS_FILES) {
  const lines = read(rel).split('\n').length
  check(lines < 800, `${rel} 行数 ${lines} < 800`)
}
for (const app of ['admin', 'partner']) {
  const entry = read(`apps/${app}/src/index.css`)
  check(
    CSS_FILES.every((rel) => entry.includes(`@ai-job-print/ui/styles/${rel.split('/').pop()}`)),
    `apps/${app} 入口引入了全部 ${CSS_FILES.length} 份大屏样式（顺序即层叠顺序）`,
  )
}
check(!/\.ops-card\s+\.ops-card/.test(css.replace(/\/\*[\s\S]*?\*\//g, '')), '样式里没有卡中卡选择器')
check(!/\.twin-panel\s+\.twin-panel/.test(css.replace(/\/\*[\s\S]*?\*\//g, '')), '样式里没有孪生面板套面板的选择器')

// ── 13. 动效降级 ──────────────────────────────────────────────────────────
// M4 教训：只断言「字符串存在」是空转的 —— 壳层另有一处 reduced-motion
// 只管按钮过渡，把点阵那条删掉门禁照样绿。所以断言要落到**被降级的那个选择器**上。
const reducedBlocks = [...css.matchAll(/@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/g)]
  .map((m) => m[1])
check(reducedBlocks.length > 0, '样式提供 prefers-reduced-motion 降级')
check(
  reducedBlocks.some((block) => /\.ops-d\b/.test(block) && /animation: none/.test(block)),
  'reduced-motion 下终端矩阵的呼吸被关掉（不是只关按钮过渡）',
)
check(
  reducedBlocks.some((block) => /\.ops-screen::before/.test(block)),
  'reduced-motion 下屏底扫描光带被关掉',
)
check(/\[data-ops-motion='off'\]/.test(css), '样式提供显式关闭动效的通道')
check(
  reducedBlocks.some((block) => ['.tw3-flow', '.tw3-fl', '.tw3-ring', '.tw3-sweep', '.tw3-beam'].every((sel) => block.includes(sel)) && /animation: none !important/.test(block)),
  'reduced-motion 下孪生场景的流线、脉冲环、扫描与光柱都被关掉',
)
check(
  reducedBlocks.some((block) => /\.twin \*/.test(block) && /animation: none !important/.test(block))
    && /\[data-ops-motion='off'\] \.twin \*/.test(css),
  '孪生面板的动效同样随 reduced-motion 与「关闭动效」一起停下'
)
check(
  /animation: none !important/.test(css),
  '降级时动效被强制关闭',
)
check(
  /useScreenMotion/.test(read('packages/ui/src/screen/ScreenFrame.tsx')),
  '运行时同样读 prefers-reduced-motion，不只靠 CSS',
)
for (const [name, page] of [['管理员', adminPage], ['机构', partnerPage]]) {
  check(/关闭动效/.test(page), `${name}页提供关闭动效按钮（低性能回退）`)
}
// 纵深必须绑定真实健康态，不是随机
check(
  /\.ops-d\.is-err\s*\{[^}]*translateZ/.test(css) && /\.ops-d\.is-ok\s*\{[^}]*translateZ/.test(css),
  '终端矩阵的纵深由真实健康态决定',
)
check(!/Math\.random/.test(css + screenFiles.map((f) => f.source).join('\n')), '大屏没有任何随机数参与呈现')

// ── 14. 可读字号下限 ──────────────────────────────────────────────────────
const wallSizes = [...css.matchAll(/\[data-ops-screen='wall'\][^{]*\{[^}]*font-size:\s*(\d+(?:\.\d+)?)px/g)]
  .map((m) => Number(m[1]))
const deskSizes = [...css.matchAll(/\[data-ops-screen='desk'\][^{]*\{[^}]*font-size:\s*(\d+(?:\.\d+)?)px/g)]
  .map((m) => Number(m[1]))
check(wallSizes.length > 20 && Math.min(...wallSizes) >= 13, `舞台档最小字号 ${Math.min(...wallSizes)}px ≥ 13px`)
check(deskSizes.length > 20 && Math.min(...deskSizes) >= 12, `桌面档最小字号 ${Math.min(...deskSizes)}px ≥ 12px`)

// ── 14A. 页眉标题层级 ─────────────────────────────────────────────────────
// 大屏嵌在 Admin / Partner 的 Page 里时，外层 PageHeader 已经是 h1；
// 大屏页眉再渲染一个 h1 就是一页两个 h1 —— 读屏器读不出主次，
// partner 的 route-sweep 也会因 locator('h1') 命中两个而 strict mode violation。
// 这一组守的是「层级由调用方显式决定」，而不是靠 CSS 把其中一个藏起来。
const frame = read('packages/ui/src/screen/ScreenFrame.tsx')
check(
  /export type ScreenHeadingLevel = 1 \| 2/.test(frame),
  '页眉标题层级是受限联合类型（只开放 h1 / h2，不是任意字符串）',
)
check(
  /^\s{2}headingLevel: ScreenHeadingLevel$/m.test(frame),
  'headingLevel 是必填 prop（没有 ?，漏传就是编译错误而不是静默多一个 h1）',
)
check(
  !/headingLevel\s*=\s*[12]/.test(stripComments(frame)),
  'headingLevel 没有默认值（给了默认值，下一个接入点会静默多出一个 h1）',
)
check(
  /const Heading = headingLevel === 1 \? 'h1' : 'h2'/.test(frame)
    && /<Heading>\{title\}<\/Heading>/.test(frame),
  '页眉按层级渲染真实的 h1 / h2 标签',
)
check(
  !/<h1>\{title\}<\/h1>/.test(frame),
  '页眉不再无条件渲染 h1',
)
// 两端都必须按「是否全屏演示」决定层级，且三个调用点一个都不能漏
for (const app of ['admin', 'partner']) {
  const page = read(`apps/${app}/src/routes/screen/index.tsx`)
  const view = read(`apps/${app}/src/routes/screen/screenView.tsx`)
  check(
    /const headingLevel = presenting \? 1 : 2/.test(page),
    `apps/${app} 按是否全屏演示决定标题层级（嵌入 h2 / 全屏 h1）`,
  )
  // 孪生大屏的页眉都在共用外壳里：页面只把层级放进下发给各页签的 chrome，外壳原样透传
  check(
    /const chrome: ScreenChrome = \{\s*headingLevel,/.test(page),
    `apps/${app} 把按展示与否算出的 headingLevel 放进下发给各页签的 chrome`,
  )
  check(
    /headingLevel: ScreenHeadingLevel/.test(view) && /export type ScreenChrome = TwinChrome & \{ headingLevel: ScreenHeadingLevel \}/.test(view),
    `apps/${app} 的 chrome 类型把 headingLevel 收窄为 1 | 2，不自己决定层级`,
  )
}
const twinFrame = read('packages/ui/src/screen/twin/TwinFrame.tsx')
check(
  (twinShell.match(/headingLevel=\{headingLevel\}/g) ?? []).length >= 4
    && /const headingLevel = chrome\.headingLevel/.test(twinShell),
  '孪生外壳把 chrome 的 headingLevel 原样透传给页眉与块位（有数据 / 无数据两种外壳都是）',
)
check(
  /^\s{2}headingLevel: ScreenHeadingLevel$/m.test(twinFrame)
    && /const Heading = headingLevel === 1 \? 'h1' : 'h2'/.test(twinFrame)
    && !/headingLevel\s*=\s*[12]/.test(stripComments(twinFrame)),
  '孪生页眉按层级渲染真实 h1 / h2，headingLevel 必填且没有默认值',
)
check(
  /TwinPanelHeadingContext\.Provider value=\{headingLevel === 1 \? 2 : 3\}/.test(twinFrame),
  '孪生面板标题比页眉低一级（页眉 h1 → 面板 h2；页眉 h2 → 面板 h3）',
)
// 不许用 CSS 把多出来的 h1 藏掉：那只骗眼睛，读屏器和 locator 照样看得见
check(
  !/\.ops-hd\s+h1\s*\{[^}]*display:\s*none/.test(css),
  '没有用 display:none 隐藏多余标题（层级要真的改，不是藏起来）',
)
// 字阶要同时覆盖 h1 与 h2，否则降级成 h2 后字号掉回浏览器默认
check(
  (css.match(/\.ops-hd :is\(h1, h2\)/g) ?? []).length >= 3,
  '页眉字阶三处（基础 / wall / desk）都同时覆盖 h1 与 h2',
)
check(
  (css.match(/\.twin-hd :is\(h1, h2\)/g) ?? []).length >= 3,
  '孪生页眉字阶三处（基础 / wall / desk）都同时覆盖 h1 与 h2',
)

// ── 15. 路由与侧栏接线 ────────────────────────────────────────────────────
const adminRoutes = read('apps/admin/src/routes/index.tsx')
const adminLayout = read('apps/admin/src/layouts/AdminLayoutWrapper.tsx')
const partnerRoutes = read('apps/partner/src/routes/index.tsx')
const partnerLayout = read('apps/partner/src/layouts/PartnerLayoutWrapper.tsx')
check(/path: 'screen',\s*element: <ScreenPage \/>/.test(adminRoutes), '管理员 /screen 路由已注册')
check(/path: 'screen',\s*element: <ScreenPage \/>/.test(partnerRoutes), '机构 /screen 路由已注册')
check(
  /path: 'screen\/:tab',\s*element: <ScreenPage \/>/.test(adminRoutes) && /path: 'screen\/:tab',\s*element: <ScreenPage \/>/.test(partnerRoutes),
  '两端 /screen/:tab 页签路由已注册（每个页签一个地址）',
)
check(
  /location\.pathname\.startsWith\('\/screen\/'\) \? 'screen'/.test(adminLayout) && /location\.pathname\.startsWith\('\/screen\/'\) \? 'screen'/.test(partnerLayout),
  '两端侧栏在 /screen/* 页签下仍高亮「数据大屏」',
)
check(
  /if \(raw === 'gov' \|\| raw === 'usage' \|\| raw === 'ops' \|\| raw === 'terminal'\) return raw/.test(read('apps/admin/src/routes/screen/screenTabs.ts'))
    && /return raw === 'usage' \|\| raw === 'terminal' \? raw : 'overview'/.test(read('apps/partner/src/routes/screen/screenTabs.ts')),
  '非法页签在前端纠正为默认页签，不渲染未知视图',
)
check(/'\/screen':\s*'screen'/.test(adminLayout) && /key: 'screen'/.test(adminLayout), '管理员侧栏有数据大屏入口')
check(/'\/screen':\s*'screen'/.test(partnerLayout) && /key: 'screen'/.test(partnerLayout), '机构侧栏有数据大屏入口')
check(
  (adminLayout.match(/key: 'screen'/g) ?? []).length === 1
    && (partnerLayout.match(/key: 'screen'/g) ?? []).length === 1,
  '两侧各只有一个数据大屏入口，没有重复导航',
)
check(
  /screen:/.test(read('apps/partner/src/routes/Page.tsx')),
  '机构大屏页有 FRONTEND_HINT 归属说明',
)

console.log(`\n${failures.length === 0 ? 'OK' : 'FAILED'} — ${failures.length} 条未通过`)
if (failures.length > 0) {
  for (const item of failures) console.error(` - ${item}`)
  process.exit(1)
}
