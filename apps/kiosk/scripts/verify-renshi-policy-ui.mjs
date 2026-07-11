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
 *
 * 运行：pnpm --filter @ai-job-print/kiosk verify:renshi-policy-ui
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8')

let failed = 0
const pass = (msg) => console.log(`  PASS ${msg}`)
const fail = (msg) => { console.error(`  FAIL ${msg}`); failed++ }

const page = read('src/pages/renshi/RenshiPage.tsx')
const shared = read('src/pages/renshi/shared.ts')
const builtinData = read('src/pages/renshi/builtinData.ts')
const policyPanel = read('src/pages/renshi/PolicyPanel.tsx')
const socialPanel = read('src/pages/renshi/SocialPanel.tsx')
const registerPanel = read('src/pages/renshi/RegisterPanel.tsx')
const noticePanel = read('src/pages/renshi/NoticePanel.tsx')
const components = read('src/pages/renshi/components.tsx')
const home = read('src/pages/home/HomePage.tsx')
const packageJson = read('package.json')

const allRenshi = page + shared + builtinData + policyPanel + socialPanel + registerPanel + noticePanel + components

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

// D. builtin 埋点跳过
if (page.includes("startsWith('builtin-')") && page.includes('if (isBuiltin(item.id)) return') && page.includes('recordBrowse') && page.includes('recordExternalJump')) {
  pass('D. 浏览/跳转上报跳过 builtin，库内条目保留上报')
} else {
  fail('D. 浏览/跳转上报必须跳过 builtin 且保留库内上报')
}

// E. 人群枚举对齐
if (['graduate', 'flexible', 'migrant', 'startup', 'hardship'].every((k) => shared.includes(`'${k}'`))) {
  pass('E. 人群筛选含 graduate/flexible/migrant/startup/hardship（与后端 POLICY_AUDIENCES 对齐）')
} else {
  fail('E. 人群筛选必须与后端 POLICY_AUDIENCES 对齐（含 flexible 与 migrant）')
}

// F. 首页入口与 Tab 对应
if (home.includes("{ title: '社保指南', icon: 'ticket', to: '/renshi?tab=social' }") && !home.includes("title: '补贴指引'")) {
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
const unsafe = unsafePatterns.filter((pattern) => pattern.test(allRenshi)).map((pattern) => pattern.source)
if (hasUnsafeServiceClaim(allRenshi)) unsafe.push('未被否定的代办/代申请')
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

if (packageJson.includes('"verify:renshi-policy-ui"')) {
  pass('H. package.json 注册 verify:renshi-policy-ui')
} else {
  fail('H. package.json 缺少 verify:renshi-policy-ui')
}

// I. 通用上传页不能伪装成系统已内置的材料、表单或指引单。
const fakePrintAssets = ['失业登记申请表', '就业登记申请表', '社保查询操作指引', '创业担保贷款材料清单']
const misleadingPrintLabels = ['常用材料打印包', '打印材料清单', '打印申请材料', '打印申请表']
const hasPageClaim = /\b(?:pages?|pageCount)\s*[:=]/.test(allRenshi) || /(?:共|合计)\s*\d+\s*页/.test(allRenshi)
if (fakePrintAssets.every((name) => !allRenshi.includes(name)) && !hasPageClaim) {
  pass('I1. 无虚构的具名打印资产或页数')
} else {
  fail('I1. 通用上传入口不得伪装成系统已内置的具名打印资产或虚构页数')
}
const honestUploadButtonPattern = /<button\b(?:(?!<\/button>)[\s\S])*?onClick=\{\(\) => navigate\('\/print\/upload'\)\}(?:(?!<\/button>)[\s\S])*?上传自备材料打印(?:(?!<\/button>)[\s\S])*?<\/button>/
const socialUploadButtonPattern = /<button\b(?:(?!<\/button>)[\s\S])*?onClick=\{\(\) => navigate\('\/print\/upload'\)\}(?:(?!<\/button>)[\s\S])*?\{guide\.entryLabel\}(?:(?!<\/button>)[\s\S])*?<\/button>/
const stripNonVisibleComments = (source) => source.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
const hasHonestUploadButton = (source) => honestUploadButtonPattern.test(stripNonVisibleComments(source))
const socialEntryLabels = [...builtinData.matchAll(/entryLabel:\s*'([^']+)'/g)].map((match) => match[1])
const uploadRouteCount = (allRenshi.match(/navigate\('\/print\/upload'\)/g) ?? []).length
const honestPanelEntries =
  hasHonestUploadButton(policyPanel) &&
  hasHonestUploadButton(registerPanel) &&
  socialUploadButtonPattern.test(stripNonVisibleComments(socialPanel)) &&
  socialEntryLabels.length > 0 &&
  socialEntryLabels.every((label) => label.includes('扫码') || label === '上传自备材料打印') &&
  uploadRouteCount === 3
if (misleadingPrintLabels.every((label) => !allRenshi.includes(label)) && honestPanelEntries) {
  pass('I2. 保留的通用打印入口明确要求用户上传自备材料')
} else {
  fail('I2. /print/upload 入口必须使用「上传自备材料打印」等诚实文案')
}
const miswiredUploadFixture = `<button onClick={() => navigate('/print/upload')}>直接打印{/* 上传自备材料打印 */}</button>`
if (!hasHonestUploadButton(miswiredUploadFixture)) {
  pass('I3. 路由与诚实文案绑定在同一按钮内')
} else {
  fail('I3. 注释或相邻文案不得掩盖错误的 /print/upload 按钮标签')
}

console.log('')
if (failed > 0) {
  console.error(`FAIL ${failed} 项失败：政策服务页真实性契约未通过\n`)
  process.exit(1)
}
console.log('✅ ALL PASS — 政策服务页真实性契约符合 Phase A0 口径\n')
