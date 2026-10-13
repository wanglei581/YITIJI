import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

/**
 * P25 AI 顾问接线静态合同（接线矩阵 §四 S2-5，依赖 S0-1）。
 *
 * 浏览器套件断得到「mock 回落时页面显示了什么」，但断不到「代码里有没有留一条
 * 能把假回答放出来的路」。这个脚本专断后者 —— 每条都对应一条做错就会让 P25
 * 变成会说话的假 AI 的规则（CLAUDE.md §9「不伪造能力」/ 矩阵风险 R1）。
 */

const root = fileURLToPath(new URL('..', import.meta.url))
const read = (relativePath) => readFileSync(join(root, relativePath), 'utf8')

const files = {
  provider: read('src/pages/assistant/advisorProvider.ts'),
  page: read('src/pages/assistant/AssistantPage.tsx'),
  tools: read('src/pages/assistant/AdvisorTools.tsx'),
  conversation: read('src/pages/assistant/AdvisorConversation.tsx'),
  scenes: read('src/pages/assistant/advisorScenes.ts'),
  routes: read('src/routes/index.tsx'),
}

const failures = []
const assert = (condition, message) => { if (!condition) failures.push(message) }
const must = (key, pattern, message) => assert(
  pattern instanceof RegExp ? pattern.test(files[key]) : files[key].includes(pattern),
  `${key}: ${message}`,
)
const mustNot = (key, pattern, message) => assert(
  !(pattern instanceof RegExp ? pattern.test(files[key]) : files[key].includes(pattern)),
  `${key}: ${message}`,
)

// ── ① provider 判定：双重且 fail-closed ────────────────────────────────────
// 服务端把判定算好了（ai.service.ts:763,778），但前端不能只信一个布尔位：
// 缺字段的旧后端 / 本地 mock adapter 都不带这两个字段，把「没说」当「是真的」
// 正是风险 R1 要防的错。
must('provider', /aiGenerated === true/, 'aiGenerated 必须显式判 === true，不得用真值判断')
must('provider', /providerLabel\?\.startsWith\(LLM_PROVIDER_PREFIX\) \?\? false/, 'providerLabel 缺失必须判 false（fail-closed）')
must('provider', /LLM_PROVIDER_PREFIX = 'llm:'/, '真实模型前缀必须是服务端约定的 llm:')
mustNot('provider', /\|\|/, '两个条件必须同时满足（&&），不得用 || 放宽')

// 判定只能有一处实现；页面里不得再写一份前缀判断绕过它。
must('page', /isAiGeneratedReply\(response\)/, '页面必须用统一判定函数决定这轮是不是 AI 回答')
for (const key of ['page', 'conversation', 'tools']) {
  mustNot(key, /startsWith\(\s*['"]llm:/, '不得在判定函数之外另写一份 llm: 前缀判断')
}

// ── ② 判为非 AI 时，模型正文不进 UI ───────────────────────────────────────
// 「加一行免责声明照样展示」不算数：那仍然是一段读起来像 AI 的假回答。
must(
  'page',
  /if \(!isAiGeneratedReply\(response\)\)[\s\S]{0,600}?text: buildNonAiNotice\(response\.providerLabel\)/,
  '非 AI 分支的气泡正文必须来自诚实说明，不得来自 response.reply',
)
must(
  'page',
  /if \(!isAiGeneratedReply\(response\)\)[\s\S]{0,600}?return\b/,
  '非 AI 分支必须提前 return，不得继续走渲染模型正文的那条路',
)
must(
  'page',
  /setAiAvailability\('available'\)[\s\S]{0,400}?text: response\.reply/,
  'response.reply 只允许出现在已判定为真实模型回答之后',
)
must('conversation', /kind === 'ai' &&[\s\S]{0,120}EvidenceBadge level="E3"/, 'E3「AI 判断」徽章只允许挂在真实模型回答上')

// ── ②b 设备故障固定提示：正文照后端原文，小标是「安全提示」，不挂 E3 ──
// 模型就绪时服务端仍盖 aiGenerated。若把 fixedNotice 并进「不是 AI」那一支，
// 正文会被藏掉；若仍走 kind === 'ai'，就会挂上 E3。两条都不许。
must('provider', /function isFixedNoticeReply/, '固定提示必须有单独判定，不得并进 isAiGeneratedReply')
must('provider', /fixedNotice === true/, 'fixedNotice 只认布尔 true，缺失与 false 都不是固定提示')
must('page', /isFixedNoticeReply\(response\)/, '页面必须用统一判定决定这轮是不是固定提示')
const noticeAt = files.page.indexOf('if (isFixedNoticeReply(response))')
const nonAiAt = files.page.indexOf('if (!isAiGeneratedReply(response))')
assert(noticeAt !== -1 && nonAiAt !== -1 && noticeAt < nonAiAt, 'page: 固定提示判定必须在非 AI 拦截之前')

function braceBlockAfter(source, marker) {
  const start = source.indexOf(marker)
  if (start < 0) return ''
  const open = source.indexOf('{', start)
  if (open < 0) return ''
  let depth = 0
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1
    else if (source[i] === '}') {
      depth -= 1
      if (depth === 0) return source.slice(start, i + 1)
    }
  }
  return ''
}

function parenBlockAfter(source, marker) {
  const start = source.indexOf(marker)
  if (start < 0) return ''
  const open = source.indexOf('(', start)
  if (open < 0) return ''
  let depth = 0
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '(') depth += 1
    else if (source[i] === ')') {
      depth -= 1
      if (depth === 0) return source.slice(start, i + 1)
    }
  }
  return ''
}

const noticeBranch = braceBlockAfter(files.page, 'if (isFixedNoticeReply(response))')
assert(noticeBranch.includes("kind: 'fixed-notice'"), 'page: fixedNotice 为真时消息种类是 fixed-notice')
assert(noticeBranch.includes('text: response.reply'), 'page: 固定提示正文必须是后端原文')
assert(/\breturn\b/.test(noticeBranch), 'page: 固定提示分支必须提前 return，不得再走 AI 或非 AI 气泡')
assert(!noticeBranch.includes("kind: 'ai'"), 'page: 固定提示不得标成 AI 回答')
assert(!noticeBranch.includes("kind: 'not-ai'"), 'page: 固定提示不得走「这一轮没有 AI 回答」')
assert(!noticeBranch.includes('buildNonAiNotice'), 'page: 固定提示不得换成非 AI 说明')

const fixedBubble = parenBlockAfter(files.conversation, "msg.kind === 'fixed-notice'")
assert(fixedBubble.includes('安全提示'), 'conversation: fixedNotice 气泡挂「安全提示」')
assert(fixedBubble.includes('kiosk-ev--e3'), 'conversation: 「安全提示」复用 E3 小标的警示样式')
assert(fixedBubble.includes('data-fixed-notice="true"'), 'conversation: 固定提示小标带 data-fixed-notice，不靠证据等级')
assert(!fixedBubble.includes('EvidenceBadge'), 'conversation: 固定提示气泡不挂 E3')
assert(!fixedBubble.includes('data-evidence'), 'conversation: 固定提示气泡不写证据等级')
assert(!fixedBubble.includes('AI 生成 · 供参考'), 'conversation: 固定提示气泡不写「AI 生成 · 供参考」')
assert(!fixedBubble.includes('AI 判断'), 'conversation: 固定提示气泡不写「AI 判断」')

// ── ③ 可用性是实测值，不得写死 ────────────────────────────────────────────
must('page', /useState<AiAvailability>\('unknown'\)/, '首次进入的可用性必须是诚实的 unknown')
mustNot('page', /availability: 'available'/, '不得把 availability 直接写死为 available')
must('page', /availability: aiAvailability/, '四态的 availability 必须取实测值')
must('page', /pending: loading/, 'running 必须由真实请求生命周期驱动')
// 前端不得用计时器自行推进 AI 状态（01-home-v6.html:161-190 接线要求 1 / 3）。
for (const timer of ['setTimeout', 'setInterval']) {
  mustNot('page', new RegExp(`\\b${timer}\\s*\\(`), `AI 状态不得由计时器 ${timer} 推进`)
}

// ── ④ 降级：AI 是加速器不是前置条件 ───────────────────────────────────────
must('page', /mode: 'manual'/, 'P25 的降级必须是 manual —— 用户的目标不依赖模型')
must('page', /manualPath:/, 'manual 降级必须给出具体的手动路径')
must('page', /advisorTask\.isFailed && <AdvisorManualEntries \/>/, '降级时必须给出可点的真实入口，而不只是一句安慰话')
must('scenes', /ADVISOR_MANUAL_ENTRIES/, '手动入口必须集中声明，便于逐条核对路由真实性')

// 手动路径必须指向**真实注册**的路由，否则「不用等 AI 也能办」就是空话。
const manualRoutes = [...files.scenes.matchAll(/route: '\/([a-z-]+)'/g)].map((match) => match[1])
assert(manualRoutes.length >= 4, 'scenes: 手动入口至少四条')
for (const route of manualRoutes) {
  assert(files.routes.includes(`path: '${route}'`), `routes: 手动入口 /${route} 必须是已注册路由`)
}

// ── ⑤ 置灰一律 aria-disabled ─────────────────────────────────────────────
// 原生 disabled 会把控件踢出 Tab 序、读屏直接跳过，用户永远读不到「为什么灰」；
// 触屏也没有 hover 可以补这层解释。
must('page', /aria-disabled=\{aiLocked \|\| undefined\}/, 'AI 锁定态必须用 aria-disabled 表达')
mustNot('page', /(?<!aria-)disabled=\{aiLocked/, 'AI 锁定态不得使用原生 disabled')
must('page', /readOnly=\{aiLocked\}/, '输入框锁定用 readOnly，保持可聚焦可读')
must('tools', /aria-disabled=\{degraded \|\| undefined\}/, '专项工具置灰必须用 aria-disabled')
mustNot('tools', /(?<!aria-)disabled=\{degraded/, '专项工具置灰不得使用原生 disabled')
must('tools', /aria-describedby=\{degraded \? reasonId : undefined\}/, '置灰按钮必须指向常驻可见的原因')
must('page', /assistant-composer-lock/, '锁定原因必须常驻可见在输入区旁')

// 锁死不能是终局：配置修好后用户得有办法再试。
must('page', /重新检查 AI 顾问/, '锁定态必须留一条显式的重新检查路径')

// ── ⑥ 合规文案白名单（CLAUDE.md §2）────────────────────────────────────────
for (const key of ['page', 'conversation', 'tools', 'scenes']) {
  for (const forbidden of ['一键投递', '立即投递', '平台投递', '企业收简历', '候选人管理']) {
    mustNot(key, forbidden, `禁用文案：${forbidden}`)
  }
}

// 2.0 双向回归：运行真实纯函数，既不改变用户提示原意，也不把技术串上屏。
function loadPureModule(path, dependencies = {}) {
  const source = ts.transpileModule(read(path), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
  const exports = {}
  new Function('exports', 'require', source)(exports, (name) => {
    if (!(name in dependencies)) throw new Error(`Unexpected pure-module dependency: ${name}`)
    return dependencies[name]
  })
  return exports
}
const provider = loadPureModule('src/pages/assistant/advisorProvider.ts')
for (const [response, expected] of [
  [{ providerLabel: 'llm:test', aiGenerated: true }, true],
  [{ providerLabel: 'mock', aiGenerated: true }, false],
  [{ providerLabel: 'llm:test', aiGenerated: false }, false],
  [{ providerLabel: 'llm:test' }, false],
  [{ aiGenerated: true }, false],
  [{}, false],
]) {
  assert(provider.isAiGeneratedReply(response) === expected, `provider: double gate ${JSON.stringify(response)}`)
}
assert(provider.isFixedNoticeReply({ fixedNotice: true }) === true, 'provider: fixedNotice true')
assert(provider.isFixedNoticeReply({ fixedNotice: false }) === false, 'provider: fixedNotice false')
assert(provider.isFixedNoticeReply({}) === false, 'provider: fixedNotice 缺失')
assert(
  provider.isAiGeneratedReply({ providerLabel: 'llm:test', aiGenerated: true, fixedNotice: true }) === true,
  'provider: fixedNotice 不改模型来源判定，避免被收成非 AI 后藏正文',
)
const copy = loadPureModule('src/pages/assistant/advisorUserCopy.ts', {
  '../../utils/maskPii': loadPureModule('src/utils/maskPii.ts'),
})
const fallback = '这次未能完成，请稍后再试。'
for (const message of ['当前使用的人较多，请稍后再试', '今日可用次数已用完，请明天再来', '麦克风正被其他程序使用，请关闭后重试']) {
  assert(copy.advisorUserReason(message, fallback) === message, `copy: preserve user message ${message}`)
  assert(copy.advisorErrorMessage(new Error(message), fallback) === message, `copy: preserve error envelope ${message}`)
}
for (const message of [undefined, '', 'AI_BUSY', 'HTTP 503', '服务端能力探测失败', '当前会话 pending', '上传状态 uploaded', '引擎错误 E_CONN', 'TRTC 进房失败']) {
  assert(copy.advisorUserReason(message, fallback) === fallback, `copy: redact engineering reason ${message}`)
}
assert(copy.advisorDisplayText('电话 13812345678，邮箱 user@example.com') === '电话 138****5678，邮箱 u***@example.com', 'copy: mask phone and email on display')
must('page', 'advisorErrorMessage(error,', '文字请求失败必须保留用户话并过滤技术串')
must('conversation', 'advisorDisplayText(msg.text)', '对话展示必须掩码，不改请求原文')
must('conversation', 'AI 生成 · 供参考', '真实回答必须显示 2.0 AI 标识')
mustNot('page', "import './assistant-inkpaper.css'", '2.0 不得继续加载停放的旧样式')

if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL ${failure}`)
  console.error(`\n${failures.length} advisor provider gate check(s) failed`)
  process.exit(1)
}

console.log(`verify-advisor-provider-gate passed (${Object.keys(files).length} files checked)`)
