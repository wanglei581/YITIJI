/**
 * 政策服务页（/renshi）真实性契约守卫（Phase A0）。
 *
 * 约束：
 *   A. renshi 目录不得引用 ComingSoon 占位；不得出现硬编码「同步时间：」假时效。
 *   B. 内置指引数据不得携带无证据的 updatedAt；官方入口 URL 必须为 https 且 gov.cn 域。
 *   C. 内置指引（builtin-*）不渲染收藏按钮；库内条目保留收藏能力。
 *   D. 浏览/外部跳转上报必须跳过 builtin-*（服务端仅接受库内已发布条目）。
 *   E. 人群筛选与后端 POLICY_AUDIENCES 对齐（含 flexible 与 migrant）。
 *   F. 首页政策服务子入口与 Tab 一一对应（社保指南→tab=social），不得回退「补贴指引→tab=social」错位。
 *   G. 无越界承诺文案（代办 / 保证到账 / 免申即享 / 一键投递等）。
 *   J. 内置办事指引不得与政策库条目合并成同一个列表（AST 断言，见下方说明）。
 *
 * 运行：pnpm --filter @ai-job-print/kiosk verify:renshi-policy-ui
 */
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8')

let failed = 0
const pass = (msg) => console.log(`  PASS ${msg}`)
const fail = (msg) => { console.error(`  FAIL ${msg}`); failed++ }

const page = read('src/pages/renshi/RenshiPage.tsx')
const detail = read('src/pages/renshi/PolicyDetail.tsx')
const list = read('src/pages/renshi/PolicyCategoryList.tsx')
const notices = read('src/pages/renshi/PolicyNotices.tsx')
const home = read('src/pages/service-hubs/PolicyTouchHub.tsx')
const model = read('src/pages/renshi/policyModel.ts')
const layout = read('src/pages/renshi/PolicyTouchLayout.tsx')
const focusHook = read('src/pages/renshi/usePolicyFocus.ts')
const shared = read('src/pages/renshi/shared.ts')
const builtinData = read('src/pages/renshi/builtinData.ts')
const policyPanel = read('src/pages/renshi/PolicyPanel.tsx')
const socialPanel = read('src/pages/renshi/SocialPanel.tsx')
const registerPanel = read('src/pages/renshi/RegisterPanel.tsx')
const noticePanel = read('src/pages/renshi/NoticePanel.tsx')
const components = read('src/pages/renshi/components.tsx')
const homeServiceGroups = read('src/pages/home/serviceGroups.ts')
const packageJson = read('package.json')

const allRenshi = page + shared + builtinData + policyPanel + socialPanel + registerPanel + noticePanel + components
const liveRenshi = page + detail + list + notices + home + model + layout


console.log('\n=== 政策服务页真实性契约验证 ===')

// A. 无占位交互与假时效
if (!allRenshi.includes('ComingSoon') && !allRenshi.includes('onComingSoon')) {
  pass('A1. renshi 目录无 ComingSoon 占位交互')
} else {
  fail('A1. renshi 目录不得引用 ComingSoon 占位')
}
if (!/同步时间：\d/.test(allRenshi)) {
  pass('A2. 无硬编码「同步时间：YYYY-MM-DD」假时效')
} else {
  fail('A2. 不得硬编码假同步时间')
}

// A3–A4. 政策与公告的审核、发布文案必须与机构自行操作的事实一致（托管 a：政策由机构在我们云上自己审核并发布，
// 管理员审核或发布会被后端拒绝，只剩紧急下架；见 policies.service.ts 的 reviewPolicy、publishPolicy）。
// 这一条曾在第七次冻结（#1366）改对，触屏版集成线从旧底稿切出时又带回「管理员审核」旧话（10/29 本机走查 I-04）：
// 所以这里按目录整体扫，任何 renshi 源码里再出现「管理员审核」都红，四句定稿各在其位。
function readRenshiSources(rel) {
  return readdirSync(join(ROOT, rel), { withFileTypes: true }).flatMap((entry) => {
    const sourcePath = join(rel, entry.name)
    if (entry.isDirectory()) return readRenshiSources(sourcePath)
    return entry.isFile() && /\.tsx?$/.test(entry.name)
      ? [{ path: sourcePath, source: read(sourcePath) }]
      : []
  })
}
const adminReviewSources = readRenshiSources('src/pages/renshi').filter(({ source }) => source.includes('管理员审核'))
if (adminReviewSources.length === 0) {
  pass('A3. renshi 全部 .ts/.tsx 源码无「管理员审核」')
} else {
  fail(`A3. 政策由机构自己审核并发布，源码不得出现「管理员审核」：${adminReviewSources.map(({ path }) => path).join('、')}`)
}
const institutionReviewCopies = [
  ['PolicyNotices.tsx', notices, '公告由发布机构自己审核并发布，正文与来源链接原样呈现。'],
  ['NoticePanel.tsx', noticePanel, '公告由发布机构自己审核并发布，目前一条都没有。这是内容进度，不是读取失败；读取失败会另有一屏说明。'],
  ['NoticePanel.tsx', noticePanel, '机构发布 · 机构自己审核'],
  ['PolicyPanel.tsx', policyPanel, '这里只展示发布机构自己审核并发布的政策。下方「通用办事指引」是本机整理的参考，不属于政策库。'],
]
for (const [index, [file, source, copy]] of institutionReviewCopies.entries()) {
  if (source.includes(copy)) {
    pass(`A4.${index + 1}. ${file} 保留机构自己审核并发布的定稿`)
  } else {
    fail(`A4.${index + 1}. ${file} 缺少定稿：「${copy}」`)
  }
}

// B. 内置指引数据诚实性
if (!builtinData.includes('updatedAt')) {
  pass('B1. 内置指引不携带无证据的 updatedAt')
} else {
  fail('B1. 内置指引不得携带硬编码 updatedAt（无证据的更新时间）')
}
const urls = [...builtinData.matchAll(/officialUrl:\s*'([^']+)'/g)].map((m) => m[1])
if (urls.length > 0 && urls.every((u) => u.startsWith('https://') && new URL(u).hostname.endsWith('.gov.cn'))) {
  pass(`B2. 内置官方入口 URL 全部 https + gov.cn 域（共 ${urls.length} 条）`)
} else {
  fail('B2. 内置官方入口 URL 必须为 https 且 gov.cn 域')
}

// C. builtin 收藏断链防护
if (policyPanel.includes("!item.id.startsWith('builtin-')") && policyPanel.includes('canFavorite &&')) {
  pass('C1. 内置指引不渲染收藏按钮')
} else {
  fail('C1. 内置指引必须隐藏收藏按钮（服务端仅接受库内已发布条目）')
}
if (policyPanel.includes('toggleFavorite')) {
  pass('C2. 库内条目保留收藏能力')
} else {
  fail('C2. 库内条目收藏能力不得移除')
}

// D. 活页面只展示接口内容，埋点归属仍为政策；停放指引不进入活路由。
if (!/builtinData|BUILTIN_GUIDES/.test(page + detail + list + home) &&
  detail.includes("recordBrowse(getToken(), 'policy', id)") && detail.includes('recordExternalJump')) {
  pass('D. 活页面无内置指引，库内浏览和原文二维码保留上报')
} else fail('D. 不得恢复内置指引或丢失库内上报')

// E. 人群枚举对齐
if (['graduate', 'flexible', 'migrant', 'startup', 'hardship'].every((k) => shared.includes(`'${k}'`))) {
  pass('E. 人群筛选含 graduate/flexible/migrant/startup/hardship（与后端 POLICY_AUDIENCES 对齐）')
} else {
  fail('E. 人群筛选必须与后端 POLICY_AUDIENCES 对齐（含 flexible 与 migrant）')
}

// F. 首页入口与 Tab 对应
if (homeServiceGroups.includes("{ title: '社保指南', description: '社保办事材料参考', icon: 'ticket', to: '/renshi?tab=social' }") && !homeServiceGroups.includes("title: '补贴指引'")) {
  pass('F. 首页「社保指南」入口指向 tab=social，无错位「补贴指引」入口')
} else {
  fail('F. 首页政策服务子入口必须与 Tab 一一对应（社保指南→tab=social）')
}

// G. 越界文案。「不代办 / 不代申请」属合规声明；其余代办表述一律视为正向承诺。
const unsafePatterns = [
  /一键投递/,
  /立即投递/,
  /平台投递/,
  /保证到账/,
  /免申即享/,
  /已到账/,
]
const safeServiceClaimPrefix = /(?:^|[，。；！？、\n\s])(?:不|不会|不得|禁止|无需|无须)(?:上传或|提供|支持|开展|承接|进行|为用户|为求职者)?$/
function hasUnsafeServiceClaim(text) {
  for (const match of text.matchAll(/代申请|代办/g)) {
    const prefix = text.slice(Math.max(0, (match.index ?? 0) - 12), match.index)
    if (!safeServiceClaimPrefix.test(prefix)) return true
  }
  return false
}
const unsafe = unsafePatterns.filter((pattern) => pattern.test(allRenshi + liveRenshi)).map((pattern) => pattern.source)
if (hasUnsafeServiceClaim(allRenshi + liveRenshi)) unsafe.push('未被否定的代办/代申请')
if (unsafe.length === 0) {
  pass('G. 无越界承诺文案（代办/保证到账/免申即享/一键投递等）')
} else {
  fail(`G. 出现越界文案模式：${unsafe.join('、')}`)
}
const allowedServiceClaims = ['不代办', '不上传或代办高敏材料', '不代申请']
const forbiddenServiceClaims = ['本平台可代办', '我们代办相关事项', '平台可代申请']
if (allowedServiceClaims.every((text) => !hasUnsafeServiceClaim(text)) && forbiddenServiceClaims.every(hasUnsafeServiceClaim)) {
  pass('G2. 代办文案守卫正反例契约通过')
} else {
  fail('G2. 代办文案守卫必须放过否定声明并拦截所有正向承诺')
}

// J. 内置办事指引 ≠ 政策库内容，两者不得合并成同一个数组再一起渲染。
//
//   合并之后政策库为空时页面依旧满屏，运营录完种子数据打不开判别力：
//   看到一堆卡片却无法确认自己录的 30 条到底进没进去（CLAUDE.md §9「不伪造能力」）。
//   用 AST 判定而不是字面量匹配：任何把「policies 派生表达式」和「BUILTIN_GUIDES」
//   放进同一个数组字面量 / concat 调用的写法都会被打红，换个变量名也躲不掉。
function mergesBuiltinWithLibrary(sourceText) {
  const source = ts.createSourceFile('RenshiPage.tsx', sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const offenders = []
  const mentionsBuiltin = (node) => /\bBUILTIN_GUIDES\b/.test(node.getText(source))
  const mentionsLibrary = (node) => /\bpolicies\b|\bfromPublished\b/.test(node.getText(source))

  function inspect(parts, node) {
    const hasBuiltin = parts.some(mentionsBuiltin)
    const hasLibrary = parts.some(mentionsLibrary)
    if (hasBuiltin && hasLibrary) offenders.push(node.getText(source).replace(/\s+/g, ' ').slice(0, 160))
  }

  function visit(node) {
    if (ts.isArrayLiteralExpression(node)) inspect([...node.elements], node)
    if (
      ts.isCallExpression(node)
      && ts.isPropertyAccessExpression(node.expression)
      && node.expression.name.text === 'concat'
    ) inspect([node.expression.expression, ...node.arguments], node)
    ts.forEachChild(node, visit)
  }
  visit(source)
  return offenders
}
const mergeOffenders = mergesBuiltinWithLibrary(page + list + home)
if (mergeOffenders.length === 0) {
  pass('J1. 内置办事指引未与政策库条目合并成同一个列表')
} else {
  fail(`J1. 内置指引不得与政策库条目合并渲染（政策库为空时页面会假装有内容）：${mergeOffenders.join(' ｜ ')}`)
}
// 正反例自检：守卫必须真的能抓到合并写法，也不能把「分开传两个 prop」误判成合并。
const mergeFixture = 'const items = [...policies.map(fromPublished), ...BUILTIN_GUIDES]'
const splitFixture = 'const lib = policies.map(fromPublished)\nconst guides = [...BUILTIN_GUIDES]'
if (mergesBuiltinWithLibrary(mergeFixture).length > 0 && mergesBuiltinWithLibrary(splitFixture).length === 0) {
  pass('J2. 合并守卫正反例契约通过')
} else {
  fail('J2. 合并守卫必须拦截合并数组并放过分区写法')
}

// K. 政策库必须有可达空态：内置指引里存在 audiences 含 'general' 的条目，
//    任何身份筛选下它都命中，所以「整个列表为空」这条分支永远走不到。
//    空态必须挂在政策库分区自己身上，且分区标记可被浏览器断言定位。
const librarySection = /data-policy-section="library"/.test(policyPanel)
const builtinSection = /data-policy-section="builtin"/.test(policyPanel)
const libraryEmptyCopy = /政策库暂无内容/.test(policyPanel)
if (librarySection && builtinSection && libraryEmptyCopy) {
  pass('K. 政策库/内置指引分区标记与政策库空态文案齐备')
} else {
  fail('K. PolicyPanel 必须分区渲染（data-policy-section=library/builtin）并为空政策库提供「政策库暂无内容」空态')
}

if (packageJson.includes('"verify:renshi-policy-ui"')) {
  pass('H. package.json 注册 verify:renshi-policy-ui')
} else {
  fail('H. package.json 缺少 verify:renshi-policy-ui')
}

// I. 通用上传页不能伪装成系统已内置的材料、表单或指引单。
const fakePrintAssets = ['失业登记申请表', '就业登记申请表', '社保查询操作指引', '创业担保贷款材料清单']
const misleadingPrintLabels = ['常用材料打印包', '打印材料清单', '打印申请材料', '打印申请表']
const parkedPrintSources = shared + builtinData + policyPanel + socialPanel + registerPanel + noticePanel + components
const hasPageClaim = /\b(?:pages?|pageCount)\s*[:=]/.test(parkedPrintSources) || /(?:共|合计)\s*\d+\s*页/.test(parkedPrintSources)
if (fakePrintAssets.every((name) => !allRenshi.includes(name)) && !hasPageClaim) {
  pass('I1. 无虚构的具名打印资产或页数')
} else {
  fail('I1. 通用上传入口不得伪装成系统已内置的具名打印资产或虚构页数')
}
const honestUploadButtonPattern = /<button\b(?:(?!<\/button>)[\s\S])*?onClick=\{\(\) => navigate\('\/print\/upload'\)\}(?:(?!<\/button>)[\s\S])*?上传自备材料打印(?:(?!<\/button>)[\s\S])*?<\/button>/
const socialUploadButtonPattern = /<button\b(?:(?!<\/button>)[\s\S])*?onClick=\{\(\) => navigate\('\/print\/upload'\)\}(?:(?!<\/button>)[\s\S])*?\{guide\.entryLabel\}(?:(?!<\/button>)[\s\S])*?<\/button>/
const stripNonVisibleComments = (source) => source.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
const hasHonestUploadButton = (source) => honestUploadButtonPattern.test(stripNonVisibleComments(source))
const honestUploadButtonGlobal = new RegExp(honestUploadButtonPattern.source, 'g')
const countHonestUploadButtons = (source) => [...stripNonVisibleComments(source).matchAll(honestUploadButtonGlobal)].length
const countUploadRoutes = (source) => (stripNonVisibleComments(source).match(/navigate\('\/print\/upload'\)/g) ?? []).length
const socialEntryLabels = [...builtinData.matchAll(/entryLabel:\s*'([^']+)'/g)].map((match) => match[1])
// 停放源码的打印诚实性继续保留；活详情按服务端清单接口，不再冒充通用上传。
const parkedHonest = countHonestUploadButtons(policyPanel) === 1 && countUploadRoutes(registerPanel) === 0 &&
  countUploadRoutes(socialPanel) === 1 && socialUploadButtonPattern.test(stripNonVisibleComments(socialPanel)) &&
  socialEntryLabels.length > 0 && socialEntryLabels.every((label) => label.includes('扫码') || label === '上传自备材料打印')
const liveChecklist = !detail.includes('/print/upload') && detail.includes('createPolicyChecklist(id)') &&
  detail.includes("origin: 'policy_checklist'") && detail.includes('pages: result.file.pageCount') &&
  detail.includes('fileUrl: result.file.printFileUrl') && detail.includes('size: policyFileSize(result.file.sizeBytes)')
const noticeGuarded = noticePanel.includes('onClick={() => onUpload(notice.id)}') &&
  notices.includes("confirm(id).then((policy) => { if (policy) navigate('/print/upload')") &&
  notices.includes('confirm(notice.id).then') && notices.includes("source.kind !== 'verified'")
if (misleadingPrintLabels.every((label) => !allRenshi.includes(label)) && parkedHonest && liveChecklist && noticeGuarded &&
  countHonestUploadButtons(components) === 1 && countUploadRoutes(components) === 1) {
  pass('I2. 停放源码仍守诚实上传；活详情打印真实服务端清单；公告上传/扫码前按条复查')
} else fail('I2. 清单与自备上传不得混淆，公告动作前必须按条确认')
const miswiredUploadFixture = `<button onClick={() => navigate('/print/upload')}>直接打印{/* 上传自备材料打印 */}</button>`
if (!hasHonestUploadButton(miswiredUploadFixture)) {
  pass('I3. 路由与诚实文案绑定在同一按钮内')
} else {
  fail('I3. 注释或相邻文案不得掩盖错误的 /print/upload 按钮标签')
}

// ── L. 无人值守复查与 11/05 政策解读交接 ──────────────────
const refreshMs = Number(detail.match(/const POLICY_REFRESH_MS = ([\d_]+)/)?.[1]?.replace(/_/g, '') ?? '0')
if (refreshMs >= 10_000 && refreshMs <= 60_000 && detail.includes('window.setInterval') &&
  detail.includes('getPublishedPolicy(id)') && detail.includes('POLICY_CHECK_TIMEOUT_MS')) {
  pass('L1. 详情按编号现读，30 秒复查、8 秒超时；超时不冒充撤下')
} else fail('L1. 活详情必须限时按条复查')
if (detail.includes("setPhase('withdrawn')") && detail.includes('setPhoneFile(null)') &&
  detail.includes('这条政策已下架') && detail.includes('返回政策首页') &&
  !/withdrawnIds/.test(page + detail + list)) {
  pass('L2. 撤下清正文与二维码；不缓存撤下编号，再发布可按接口重读')
} else fail('L2. 撤下详情必须关闭旧内容，不得永久过滤重发编号')
if (detail.includes('rememberAssistantPolicyQuestion({ id, title: policy.title })') &&
  detail.includes('按这条原文解释，不判断能不能领') && detail.includes("ai.state('assistant_chat') !== 'available'") &&
  detail.includes('条件、材料、打印、扫码照常') && !/policyId|rememberAssistantPolicyQuestion/.test(layout)) {
  pass('L3. 详情按编号交给小青，AI 不可用不影响其他操作；列表/首页只问通用问题')
} else fail('L3. 问小青必须按能力门控，详情带编号，通用问题不带编号')
if (home.includes('data?.latest.total === 0 && data.notices.total === 0') && home.includes('这里还没有发布的政策') &&
  home.includes('本机不自己编写政策，也不拿别处的内容顶替') &&
  list.includes('pageSize: POLICY_PAGE_SIZE') && model.includes('POLICY_PAGE_SIZE = 4') &&
  detail.includes('policyLines(policy.whereToApply)') && detail.includes('value={policy.whoCanApply}') &&
  detail.includes('value={policy.requiredMaterials}')) {
  pass('M. 全库真空态、服务端四条分页、三栏按机构字段呈现')
} else fail('M. 最小闭环不得拿内置数据、前端大列表或原文猜测替代')

console.log('')
if (failed > 0) {
  console.error(`FAIL ${failed} 项失败：政策服务页真实性契约未通过\n`)
  process.exit(1)
}
console.log('✅ ALL PASS — 政策服务页真实性契约符合 Phase A0 口径\n')
