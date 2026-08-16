import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 批次 KIOSK-DEBT 三处前端欠账静态合同。
 *
 * 这三条都属于「浏览器套件断不到」的那一类：
 *   ① 同意版本有没有真的发出去 —— 页面渲染完全一样，差别只在请求体里；
 *   ② 跨页上下文参数传了有没有人消费 —— 传了不用时页面照样能渲染；
 *   ③ 能力门禁置灰有没有常显原因 —— 触屏上 title 永远不显示，截图也看不出差别。
 *
 * 每一条对应一个「做错了就会让用户被静默欺骗」的规则，不是风格检查。
 */

const root = fileURLToPath(new URL('..', import.meta.url))
const read = (relativePath) => readFileSync(join(root, relativePath), 'utf8')

const failures = []
const assert = (condition, message) => { if (!condition) failures.push(message) }

// ════════════════════════════════════════════════════════════════════════
// ① 版本化同意：前端必须真的把 consentVersion 发出去
// ════════════════════════════════════════════════════════════════════════
// 只存布尔「同意过」而不存「同意了哪一版」，隐私条款改版后系统会把用户对旧版本
// 的同意当成对新版本的同意。后端（版本化同意合入后）刻意不拒绝缺省值——拒了会
// 400 掉生产上每一次提交——所以「前端漏发」不会报错，只会静默降级成 null。
// 这一节就是那个不会自己报错的地方的唯一守门人。
{
  const api = read('src/services/api/selfAssessment.ts')
  const flow = read('src/pages/resume/SelfAssessmentFlow.tsx')

  assert(
    /consent:\s*\{[^}]*consentVersion\?:\s*string/s.test(api),
    'selfAssessment.ts: submitSelfAssessment 的 consent 必须带 consentVersion 字段（后端读的是 consent.consentVersion，放外层等于没发）',
  )
  // 只看 submit 调用那一段：写入会话时用常量是对的（那才是「记下用户同意的这一版」），
  // 只有**发给服务端**时用常量才是伪造。整文件级的禁令会把前者一起误杀。
  const submitAt = flow.indexOf('submitSelfAssessment(')
  assert(submitAt !== -1, 'SelfAssessmentFlow.tsx: 找不到 submitSelfAssessment 调用点')
  const submitCall = submitAt === -1 ? '' : flow.slice(submitAt, submitAt + 700)

  assert(
    /consentVersion:\s*session\.consentVersion/.test(submitCall),
    'SelfAssessmentFlow.tsx: 提交时必须带上 consentVersion（取自会话）',
  )
  // 送常量 = 把「本次构建认为当前是哪一版」冒充成「用户同意的是哪一版」。
  // 同意门禁下两者必然相等，但门禁一旦被绕过（深链 / 会话被改），
  // 送常量就是伪造同意——正是版本化同意本身要防的那件事。
  assert(
    !/consentVersion:\s*SELF_ASSESSMENT_CONSENT_VERSION/.test(submitCall),
    'SelfAssessmentFlow.tsx: 提交的版本号必须取自会话（用户实际同意的那一版），不得直接送当前常量',
  )
}

// ════════════════════════════════════════════════════════════════════════
// ② 跨页上下文：要么消费，要么别传
// ════════════════════════════════════════════════════════════════════════
// 传了不用是最坏的形态 —— 页面照常渲染，没有任何报错，后续维护者却以为
// 上下文是通的。这一节钉死已经清掉的几处，防止它们被「顺手加回来」。
{
  const login = read('src/pages/auth/LoginPage.tsx')
  assert(
    /\(location\.state as \{ hint\?: unknown \} \| null\)\?\.hint/.test(login),
    'LoginPage.tsx: 必须读取 state.hint（换绑后被登出，用户得知道为什么）',
  )
  // 只从 state 取、不从 query 取：query 可被外部构造，会变成登录页文案注入点。
  assert(
    !/searchParams\.get\(['"]hint['"]\)|URLSearchParams\([^)]*\)\.get\(['"]hint['"]\)/.test(login),
    'LoginPage.tsx: hint 不得从 query 取（可被外部构造，成为登录页文案注入点）',
  )

  // `/assistant` 只认 `?intent=`，从不读 location.state。
  const topicWriters = ['src/pages/policy/PolicyServiceHubPage.tsx', 'src/pages/interview/InterviewServiceHubPage.tsx', 'src/pages/job-fairs/FairsServiceHubPage.tsx']
  for (const f of topicWriters) {
    assert(!/state:\s*\{\s*topic:/.test(read(f)), `${f}: 不得向 /assistant 传 state.topic（该页不读 location.state）`)
  }

  // `/renshi` 的 tab 白名单是 policy|social|register|notice，subsidy 会被静默丢弃。
  assert(
    !/\/renshi\?tab=subsidy/.test(read('src/pages/policy/PolicyServiceHubPage.tsx')),
    'PolicyServiceHubPage.tsx: 不得链接 /renshi?tab=subsidy（不在 tab 白名单，会被静默回落到 policy）',
  )

  // `/print/upload` 的 source 取自 query 且只认 resume|document；jobId/jobTitle 无消费点。
  assert(
    !/navigate\('\/print\/upload',\s*\{\s*state:\s*\{[^}]*job(Id|Title)/.test(read('src/pages/jobs/JobDetailPage.tsx')),
    'JobDetailPage.tsx: 不得向 /print/upload 传 jobId / jobTitle（打印链路没有消费点）',
  )

  // 自我探索 intro 页不读 `?from=`。
  for (const f of ['src/pages/assistant/advisorScenes.ts', 'src/pages/resume/ResumeReportPage.tsx', 'src/pages/resume/CareerPlanPage.tsx', 'src/services/api/aiMockAdapter.ts']) {
    assert(!/self-assessment\/intro\?from=/.test(read(f)), `${f}: 不得给 self-assessment/intro 带 ?from=（该页不读它）`)
  }
}

// ════════════════════════════════════════════════════════════════════════
// ③ 能力门禁置灰必须可解释（触屏无 hover，title 永远读不到）
// ════════════════════════════════════════════════════════════════════════
// 判据：能力门禁（功能不可用）→ aria-disabled + **常显**原因文字；
//       瞬时态（请求进行中 / 表单未填完）→ 原生 disabled 即可，不在本节管辖。
{
  // 本批改过的这些文件里，能力门禁的原因不得再退回 title 属性。
  // 注意只查 HTML title **属性**（`title={` / `title="`），
  // 组件 prop 形式的 title 是页面标题，不在此列 —— 所以逐文件白名单。
  const noTitleReason = [
    'src/pages/job-fairs/components/FairCompanyDetailSections.tsx',
    'src/pages/job-fairs/FairMaterialsPage.tsx',
    'src/pages/resume/JobMaterialLibraryPage.tsx',
    // MyDocumentsPage.tsx 的同类缺陷（打印置灰原因只在 title 里）本批未修：
    // 它归 verify:profile-documents-inkpaper 的批次范围守卫管辖，一旦本 PR 触碰该页，
    // 那个守卫会要求本 PR 全部 20+ 文件进它的 allowlist —— 那等于把别人的守卫掏空。
    // 已在 PR 正文登记为单独跟进（只改文档页那一个文件时才过得了它的范围检查）。
  ]
  for (const f of noTitleReason) {
    assert(
      !/title=\{[^}]*(?:Hint|暂不支持|演示模式|未就绪)/.test(read(f)),
      `${f}: 置灰原因不得只写在 title 里（一体机是触屏，没有 hover，永远不显示）`,
    )
  }

  // 来源投递门禁：五个文件都必须是 aria-disabled + 引用同一条原因常量。
  const sourceGated = [
    'src/pages/jobs/JobDetailPage.tsx',
    'src/pages/jobs/components/JobDetailSections.tsx',
    'src/pages/job-fairs/FairCompanyDetailPage.tsx',
    'src/pages/job-fairs/components/FairCompanyDetailSections.tsx',
    'src/pages/companies/CompanyDetailPage.tsx',
  ]
  for (const f of sourceGated) {
    const src = read(f)
    assert(/SOURCE_APPLY_UNAVAILABLE_REASON/.test(src), `${f}: 必须渲染常显的来源投递不可用原因`)
    assert(/aria-disabled=/.test(src), `${f}: 来源投递门禁必须用 aria-disabled`)
    // 原生 disabled 会把按钮踢出 Tab 序列，读屏永远读不到旁边那句原因。
    // `(?<!aria-)` 不可省：`aria-disabled=` 里就包含 `disabled=` 这段字面量，
    // 少了它会把正确的写法当成违规（本脚本第一版就踩了这个）。
    assert(
      !/(?<!aria-)disabled=\{!(?:sourceCanApply\}|isValidSourceUrl\()/.test(src),
      `${f}: 来源投递门禁不得用原生 disabled（会掉出 Tab 序列，原因读不到）`,
    )
  }

  // 原因文案必须具体到「为什么」，不能退化成「当前不可用」这种等于没说的话。
  const reasons = read('src/lib/capabilityReasons.ts')
  assert(!/=\s*'当前不可用'/.test(reasons), 'capabilityReasons.ts: 不得使用「当前不可用」这类无信息量文案')
  assert(/SOURCE_APPLY_UNAVAILABLE_REASON\s*=\s*'[^']{10,}'/.test(reasons), 'capabilityReasons.ts: 来源投递原因必须写清楚（≥10 字）')

  // CLAUDE.md §9：可点击区不小于 48px。本批改到的两处原为 44px。
  assert(
    !/min-h-\[4[0-7]px\]/.test(read('src/pages/profile/me/MyResumesPage.tsx')),
    'MyResumesPage.tsx: 可点击区不得低于 48px（CLAUDE.md §9）',
  )
}

if (failures.length > 0) {
  console.error('FAIL: kiosk 前端欠账合同未满足：')
  for (const f of failures) console.error(`  - ${f}`)
  process.exit(1)
}
console.log('OK: kiosk 前端欠账合同全部满足')
