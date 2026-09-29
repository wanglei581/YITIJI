/**
 * 门禁：一体机自我探索的同意说明只来自服务端下发（后端 #1119 同批）。
 *
 * 合规 9/29 终裁：必须证明用户看到的就是当前这一版说明。一体机写死的条款或版本号
 * 一旦和服务端差一个字，用户看到的是 A、系统记下的是 B —— 所以本门禁钉住：
 *   一、apps/kiosk/src 里没有写死的条款、勾选框文字、链接文字或同意版本号；
 *   二、编译真跑：喂一份 /questions 响应 → 同意页用的条款与勾选框文字就是它 →
 *       提交体里的 consentVersion 与响应逐字相同（含首尾空白也原样传递）；
 *   三、下发缺失 / 为空 / 形状不对 → 读不出说明，同意页不放行；
 *   四、服务端回 SELF_ASSESSMENT_CONSENT_VERSION_STALE → 回到 recover-consent，已答保留，
 *       按新版本重新确认后仍是那些答案，并自动重交；
 *   五、法务文档页按章节标题打开：标题包含 sectionTitle 的那一章；找不到停在开头，不做近似兜底。
 *
 * 纯本地：只读仓库源码、在内存里 import 编译产物，不连数据库 / 网络。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const kioskRoot = fileURLToPath(new URL('..', import.meta.url))
const repoRoot = fileURLToPath(new URL('../../..', import.meta.url))
const failures = []
const fail = (message) => failures.push(message)
const ok = (message) => console.log(`  ✓ ${message}`)
const read = (rel) => readFileSync(join(kioskRoot, rel), 'utf8')
const repoRead = (rel) => readFileSync(join(repoRoot, rel), 'utf8')
const toDataUrl = (code) => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
const transpile = (rel) => ts.transpileModule(read(rel), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  fileName: rel,
}).outputText

// ── 服务端当前这一版（只读源码文本，不 import 服务端） ─────────────────────────
const apiTypes = repoRead('services/api/src/ai/resume/self-assessment.types.ts')
const SERVER_VERSION = apiTypes.match(/export const SELF_ASSESSMENT_CONSENT_VERSION = '([^']+)'/)?.[1] ?? ''
const itemsBlock = apiTypes.match(/export const SELF_ASSESSMENT_CONSENT_ITEMS = \[([\s\S]*?)\] as const/)?.[1] ?? ''
const SERVER_ITEMS = [...itemsBlock.matchAll(/'([^']+)'/g)].map((m) => m[1])
const SERVER_LABEL = apiTypes.match(/export const SELF_ASSESSMENT_CONSENT_CHECKBOX_LABEL =\s*'([^']+)'/)?.[1] ?? ''
const linksBlock = apiTypes.match(/export const SELF_ASSESSMENT_CONSENT_LINKS[\s\S]*?= \[([\s\S]*?)\n\]/)?.[1] ?? ''
const SERVER_LINK_LABEL = linksBlock.match(/label: '([^']+)'/)?.[1] ?? ''
const SERVER_SECTION = linksBlock.match(/sectionTitle: '([^']+)'/)?.[1] ?? ''
if (!SERVER_VERSION || SERVER_ITEMS.length < 6 || !SERVER_LABEL || !SERVER_LINK_LABEL || !SERVER_SECTION) {
  fail('读不到服务端当前的版本号 / 条款 / 勾选框文字 / 链接（本门禁无法判定，视为失败）')
}

// ════════════════════════════════════════════════════════════════════════
// 一、源码里没有写死的说明
// ════════════════════════════════════════════════════════════════════════
function walk(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (/\.(ts|tsx)$/.test(name)) out.push(full)
  }
  return out
}
{
  const before = failures.length
  const fragments = [
    ...SERVER_ITEMS.map((item) => item.slice(0, 16)),
    SERVER_LABEL.slice(0, 16),
    SERVER_LINK_LABEL,
    '我已了解上述说明',
  ]
  for (const file of walk(join(kioskRoot, 'src'))) {
    const rel = relative(kioskRoot, file)
    const text = readFileSync(file, 'utf8')
    if (/sa-consent-v\d/.test(text)) fail(`${rel}: 写死了自我探索同意版本号（必须用 /questions 下发的原值）`)
    for (const fragment of fragments) {
      if (fragment && text.includes(fragment)) fail(`${rel}: 写死了自我探索同意说明「${fragment}…」（必须渲染 /questions 下发的原文）`)
    }
    if (/import\s*\{[^}]*\bSELF_ASSESSMENT_CONSENT_(ITEMS|VERSION|CHECKBOX_LABEL|LINKS)\b[^}]*\}\s*from\s*'@ai-job-print\/shared'/.test(text)) {
      fail(`${rel}: 从 shared 取同意说明常量 —— 那是构建时的一份，不是服务端这次下发的那一份`)
    }
  }
  const session = read('src/pages/resume/selfAssessmentSession.ts')
  if (/CONSENT_ITEMS\s*[:=]/.test(session) || /SELF_ASSESSMENT_CONSENT_VERSION\s*=/.test(session)) {
    fail('selfAssessmentSession.ts: 不得再声明条款数组或同意版本常量')
  }
  const flow = read('src/pages/resume/SelfAssessmentFlow.tsx')
  for (const [needle, why] of [
    ['useSelfAssessmentConsentBundle()', '同意页必须读服务端下发的说明'],
    ['<SaConsentList items={bundle.items} />', '条款必须渲染下发的 consentItems'],
    ['label={bundle.checkboxLabel} links={bundle.links}', '勾选框文字与链接必须来自下发'],
    ['version: bundle.version', '记下的同意版本必须是下发的原值'],
  ]) {
    if (!flow.includes(needle)) fail(`SelfAssessmentFlow.tsx: 缺「${needle}」—— ${why}`)
  }
  if (failures.length === before) ok('apps/kiosk/src 没有写死的条款、勾选框文字、链接文字或同意版本号；同意页渲染的是下发的那一份')
}

// ════════════════════════════════════════════════════════════════════════
// 二～四、编译真跑
// ════════════════════════════════════════════════════════════════════════
function memoryStorage() {
  const map = new Map()
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(String(key), String(value)) },
    removeItem: (key) => { map.delete(key) },
    clear: () => { map.clear() },
  }
}
globalThis.sessionStorage = memoryStorage()

const BANK = {
  version: 'v1',
  dimensions: [
    { key: 'interest', label: '兴趣偏好', questions: [
      { idx: 0, prompt: '周末更愿意做什么', choices: [{ key: 'a', label: '整理资料', weight: 1 }, { key: 'b', label: '约朋友出门', weight: 2 }] },
      { idx: 1, prompt: '工作里最享受的时刻', choices: [{ key: 'a', label: '把事做完', weight: 1 }, { key: 'b', label: '被人认可', weight: 2 }] },
    ] },
  ],
}
const consentModel = await import(toDataUrl(transpile('src/pages/resume/selfAssessmentConsent.ts')))
const sessionModel = await import(toDataUrl(
  transpile('src/pages/resume/selfAssessmentSession.ts')
    .replaceAll("from '@ai-job-print/shared'", `from '${toDataUrl(`export const SELF_ASSESSMENT_QUESTIONS_V1 = ${JSON.stringify(BANK)}\n`)}'`),
))
const calls = []
let respond = () => ({ status: 200, body: {} })
globalThis.__saFetch = async (url, init = {}) => {
  const call = { url: String(url), method: init.method ?? 'GET', body: init.body ? JSON.parse(init.body) : null }
  calls.push(call)
  const { status, body } = respond(call)
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
const api = await import(toDataUrl(
  transpile('src/services/api/selfAssessment.ts')
    .replaceAll("from '../../ai/aiDeclarationErrors'", `from '${toDataUrl('export function rethrowAiDeclaration() {}\n')}'`)
    .replaceAll("from '../auth/memberSessionEvents'", `from '${toDataUrl('export const isMemberSessionInvalidError = () => false\nexport const notifyMemberSessionExpired = () => {}\n')}'`)
    .replaceAll("from '../terminalAuth'", `from '${toDataUrl('export const terminalAttributedFetch = (...args) => globalThis.__saFetch(...args)\n')}'`)
    .replaceAll("from './client'", `from '${toDataUrl("export const API_BASE_URL = '/api/v1'\nexport const API_MODE = 'http'\n")}'`),
))

/** 与 SelfAssessmentFlow.tsx 结果页的提交调用同一形状（下方静态断言钉住那一处）。 */
function submitFromSession(s, access = {}) {
  return api.submitSelfAssessment({
    answers: sessionModel.flattenAnswers(s.answers),
    consent: { nonSensitive: s.consent.nonSensitive, sensitive: s.consent.sensitive, consentVersion: s.consentVersion },
  }, access)
}

const keepAll = () => true
const questionsBody = (overrides = {}) => ({
  version: 'v1',
  dimensions: BANK.dimensions,
  consentVersion: SERVER_VERSION,
  consentItems: [...SERVER_ITEMS],
  consentLinks: [{ label: SERVER_LINK_LABEL, legalDocType: 'privacy_policy', sectionTitle: SERVER_SECTION }],
  consentCheckboxLabel: SERVER_LABEL,
  ...overrides,
})

async function sourceChain(served) {
  calls.length = 0
  sessionModel.clearSession()
  respond = (call) => call.url.endsWith('/resume/self-assessment/questions')
    ? { status: 200, body: served }
    : { status: 200, body: { taskId: 'sa-task-1', status: 'completed', dimensions: [], summary: null, expiresAt: null } }
  const bundle = consentModel.readConsentBundle(await api.getSelfAssessmentQuestions())
  if (!bundle) return { bundle: null, submitted: null }
  const answered = { ...sessionModel.emptySelfAssessmentSession(), answers: { interest: { 0: 'a', 1: 'b' } } }
  const consented = consentModel.sessionAfterConsent(answered, { sensitive: false, version: bundle.version, now: '2026-09-29T09:00:00.000Z', keepAnswer: keepAll })
  sessionModel.saveSession(consented)
  await submitFromSession(sessionModel.loadSession())
  return { bundle, submitted: calls.find((c) => c.method === 'POST')?.body ?? null }
}

{
  const before = failures.length
  const served = questionsBody()
  const { bundle, submitted } = await sourceChain(served)
  if (!bundle) fail('合法的 /questions 响应读不出说明')
  else {
    if (JSON.stringify(bundle.items) !== JSON.stringify(served.consentItems)) fail('同意页条款 ≠ 这次下发的 consentItems')
    if (bundle.checkboxLabel !== served.consentCheckboxLabel) fail('勾选框文字 ≠ 这次下发的 consentCheckboxLabel')
    const segments = consentModel.consentLabelSegments(bundle.checkboxLabel, bundle.links)
    if (segments.map((s) => s.text).join('') !== served.consentCheckboxLabel) fail('勾选框文字切段后拼不回原句（链接必须原位嵌入，不增删字）')
    if (!segments.some((s) => s.link && s.text === SERVER_LINK_LABEL)) fail('勾选框文字里的链接那一段没有做成链接')
  }
  if (submitted?.consent?.consentVersion !== served.consentVersion) {
    fail(`提交的 consentVersion（${JSON.stringify(submitted?.consent?.consentVersion)}）≠ 这次下发的（${JSON.stringify(served.consentVersion)}）`)
  }
  // 首尾空白原样传递：一体机不替服务端「修」版本号，带空格就该原样送过去让服务端拒。
  const padded = ` ${SERVER_VERSION} `
  const paddedRun = await sourceChain(questionsBody({ consentVersion: padded }))
  if (paddedRun.submitted?.consent?.consentVersion !== padded) {
    fail(`版本号带首尾空白时提交体被改写成 ${JSON.stringify(paddedRun.submitted?.consent?.consentVersion)}（必须逐字等于 ${JSON.stringify(padded)}）`)
  }
  const other = 'sa-consent-v9.2031-01-01'
  const otherRun = await sourceChain(questionsBody({ consentVersion: other, consentItems: ['换了一版的说明'] }))
  if (otherRun.submitted?.consent?.consentVersion !== other || otherRun.bundle?.items?.[0] !== '换了一版的说明') {
    fail('服务端换了一版说明时，一体机没有跟着渲染与提交那一版（说明有写死的旁路）')
  }
  // 本机记下的版本与最新下发不一致 → 勾选框不沿用，必须重勾。
  const stored = { ...sessionModel.emptySelfAssessmentSession(), consent: { nonSensitive: true, sensitive: false }, consentVersion: 'sa-consent-v1.2026-08-16' }
  if (consentModel.initialCheckedVersion(stored, SERVER_VERSION)) fail('本机记的旧版本被当成已勾选当前版本')
  if (!consentModel.initialCheckedVersion({ ...stored, consentVersion: SERVER_VERSION }, SERVER_VERSION)) fail('本机记的就是当前版本时应沿用勾选')
  if (consentModel.initialCheckedVersion({ ...stored, consentVersion: `${SERVER_VERSION} ` }, SERVER_VERSION)) fail('版本比较必须逐字（带空格不算同一版）')
  const flow = read('src/pages/resume/SelfAssessmentFlow.tsx')
  const at = flow.indexOf('submitSelfAssessment(')
  const call = at < 0 ? '' : flow.slice(at, at + 700)
  if (!/consentVersion:\s*session\.consentVersion,/.test(call)) fail('SelfAssessmentFlow.tsx: 提交体的 consentVersion 必须直接取会话里记的原值（本节真跑依赖这一形状）')
  if (/consentVersion:\s*session\.consentVersion\??\.(trim|replace|concat)|consentVersion:\s*`/.test(call)) fail('SelfAssessmentFlow.tsx: 提交前不得 trim / 拼接版本号')
  if (failures.length === before) ok('编译真跑：条款与勾选框文字来自这次响应，提交的 consentVersion 与响应逐字相同（含首尾空白）')
}

{
  const before = failures.length
  const cases = [
    ['没有 consentVersion', questionsBody({ consentVersion: undefined })],
    ['consentVersion 为空串', questionsBody({ consentVersion: '' })],
    ['consentItems 缺失', questionsBody({ consentItems: undefined })],
    ['consentItems 为空', questionsBody({ consentItems: [] })],
    ['条款里有空串', questionsBody({ consentItems: ['本工具说明', ''] })],
    ['consentCheckboxLabel 缺失', questionsBody({ consentCheckboxLabel: undefined })],
    ['consentLinks 不是数组', questionsBody({ consentLinks: null })],
    ['响应不是对象', null],
  ]
  for (const [label, body] of cases) {
    const run = await sourceChain(body)
    if (run.bundle) fail(`下发${label}时仍读出了说明（必须不放行，也不得回退到写死条款）`)
    if (run.submitted) fail(`下发${label}时仍发出了提交`)
  }
  respond = () => ({ status: 503, body: { error: { code: 'MAINTENANCE_MODE', message: '设备维护中' } } })
  let rejected = false
  try { await api.getSelfAssessmentQuestions() } catch { rejected = true }
  if (!rejected) fail('/questions 读取失败时没有报错（同意页会停在无说明的状态）')
  const flow = read('src/pages/resume/SelfAssessmentFlow.tsx')
  const hook = read('src/pages/resume/useSelfAssessmentConsentBundle.ts')
  if (!/const ok = bundle !== null\s*\n?\s*&&/.test(flow)) fail('SelfAssessmentFlow.tsx: 「已确认」必须以拿到下发说明为前提')
  if (!/if \(!ok \|\| !bundle\) return/.test(flow)) fail('SelfAssessmentFlow.tsx: 没拿到说明时「开始作答」必须什么都不做')
  if (!flow.includes("blockedReason={!bundle ?")) fail('SelfAssessmentFlow.tsx: 没拿到说明时主按钮必须置灰并写明原因')
  if (!flow.includes('同意说明没有取到，请重试') || !flow.includes('onClick={consentBundle.retry}')) fail('SelfAssessmentFlow.tsx: 取不到说明时必须如实提示并给重试')
  if (!/bundle \? \{ status: 'ready', bundle \} : \{ status: 'error' \}/.test(hook) || !/\.catch\(\(\) => \{ if \(active\) setState\(\{ status: 'error' \}\)/.test(hook)) {
    fail('useSelfAssessmentConsentBundle.ts: 读不出说明或请求失败必须落到 error')
  }
  if (failures.length === before) ok('下发缺失、为空、形状不对或读取失败 → 读不出说明，同意页不放行、不提交、给重试')
}

{
  const before = failures.length
  sessionModel.clearSession()
  respond = (call) => call.method === 'POST'
    ? { status: 400, body: { error: { code: 'SELF_ASSESSMENT_CONSENT_VERSION_STALE', message: '知情同意说明已更新，请重新阅读并确认后再提交' } } }
    : { status: 200, body: questionsBody() }
  const answers = { interest: { 0: 'a', 1: 'b' } }
  const oldSession = { ...sessionModel.emptySelfAssessmentSession(), answers, consent: { nonSensitive: true, sensitive: false }, consentVersion: 'sa-consent-v1.2026-08-16', consentedAt: '2026-09-29T08:00:00.000Z' }
  let staleError = null
  try { await submitFromSession(oldSession) } catch (err) { staleError = err }
  if (!consentModel.isConsentVersionStale(staleError)) fail('服务端 400 SELF_ASSESSMENT_CONSENT_VERSION_STALE 没被认出来')
  const recovered = consentModel.sessionAfterStaleConsent(oldSession)
  if (consentModel.hasRecordedConsent(recovered)) fail('版本过期后会话仍算已同意（答题页不会进入 recover-consent）')
  if (JSON.stringify(recovered.answers) !== JSON.stringify(answers)) fail('版本过期后已答的题被清空了')
  if (recovered.resubmitAfterConsent !== true) fail('版本过期后没有记下「确认后自动重交」')
  const bundle = consentModel.readConsentBundle(questionsBody())
  const reconsented = consentModel.sessionAfterConsent(recovered, { sensitive: false, version: bundle.version, now: '2026-09-29T09:00:00.000Z', keepAnswer: keepAll })
  if (JSON.stringify(reconsented.answers) !== JSON.stringify(answers)) fail('重新确认说明后已答的题没保留下来')
  if (reconsented.consentVersion !== SERVER_VERSION || !consentModel.hasRecordedConsent(reconsented)) fail('重新确认后没有记下这一版')
  const flow = read('src/pages/resume/SelfAssessmentFlow.tsx')
  if (!/if \(mode === 'submit' && isConsentVersionStale\(err\)\) \{\s*saveSession\(sessionAfterStaleConsent\(loadSession\(\)\)\)\s*navigate\('\/resume\/self-assessment\/questions'/.test(flow)) {
    fail('SelfAssessmentFlow.tsx: 提交收到版本过期必须保存「撤同意、留答案」的会话并回答题页')
  }
  if (!/const consentOk = hasRecordedConsent\(session\)/.test(flow) || !/const blocked = !consentOk \|\| flat\.length === 0\s*\n\s*\? \{\s*\n\s*state: 'recover-consent'/.test(flow)) {
    fail('SelfAssessmentFlow.tsx: 没有记下同意时答题页必须是 recover-consent')
  }
  if (!/navigate\(resubmit && all > 0 && done >= all \? '\/resume\/self-assessment\/result'/.test(flow)) fail('SelfAssessmentFlow.tsx: 重新确认后答满的必须直接去结果页自动重交')
  if (failures.length === before) ok('版本过期 400 → recover-consent，已答保留；按新版本重新确认后答案仍在并自动重交')
}

// ════════════════════════════════════════════════════════════════════════
// 五、法务文档页按章节标题打开
// ════════════════════════════════════════════════════════════════════════
{
  const before = failures.length
  const legal = await import(toDataUrl(transpile('src/pages/legal/legalDocModel.ts')))
  const text = [
    '隐私政策（试运营）',
    '一、我们收集的信息\n登录信息：手机号。',
    '二、信息如何使用\n只用于你本次发起的服务。',
    '五、未成年人保护的一般说明\n这一章不是要打开的那一章。',
    `六、${SERVER_SECTION}\n未满十四周岁的，须由监护人同意并陪同。`,
    '七、联系我们\n请联系现场工作人员。',
  ].join('\n\n')
  const sections = legal.splitLegalSections(text)
  const target = sections.findIndex((s) => s.title === `六、${SERVER_SECTION}`)
  if (target <= 0) fail('夹具正文没切出「六、…」这一章（分章逻辑变了，本节无法判定）')
  const route = consentModel.consentLinkRoute({ label: SERVER_LINK_LABEL, legalDocType: 'privacy_policy', sectionTitle: SERVER_SECTION })
  const url = new URL(route, 'http://kiosk.local')
  if (url.pathname !== '/legal/privacy') fail(`同意页链接去处是 ${url.pathname}，应为 /legal/privacy`)
  const carried = legal.readSectionTitle(url.search)
  if (carried !== SERVER_SECTION) fail('链接没有原样带上 sectionTitle')
  if (legal.findSectionIndex(sections, carried) !== target) fail('法务文档页没有打开到标题包含 sectionTitle 的那一章')
  const withoutChapter = legal.splitLegalSections(text.replace(`六、${SERVER_SECTION}`, '六、其他事项'))
  if (legal.findSectionIndex(withoutChapter, SERVER_SECTION) !== 0) fail('标题找不到时必须停在开头（不得挑一章「看起来像」的，比如「未成年人保护」）')
  if (legal.findSectionIndex(sections, null) !== 0) fail('没带 section 时必须停在开头')
  const page = read('src/pages/legal/LegalDocPage.tsx')
  if (!page.includes('const sectionTitle = readSectionTitle(location.search)') || !/: sectionTarget\n/.test(page) || !page.includes('findSectionIndex(sections, sectionTitle)')) {
    fail('LegalDocPage.tsx: 没点目录时必须按 ?section= 打开到那一章')
  }
  if (failures.length === before) ok('法务文档页：打开到标题包含「未满十四周岁未成年人个人信息处理规则」的那一章；找不到停在开头，不做近似兜底')
}

if (failures.length > 0) {
  console.error('verify-self-assessment-consent-source failed:')
  for (const message of failures) console.error(`- ${message}`)
  process.exit(1)
}
console.log('verify-self-assessment-consent-source passed')
