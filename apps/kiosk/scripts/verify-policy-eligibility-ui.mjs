/**
 * P21 政策条件核对 —— 一体机接线契约守卫。
 *
 * 背景：后端 /policies/eligibility-questions 与 /policies/eligibility-check 建了两轮，
 * 合作机构录入面也接了，唯独一体机零引用。本门禁守住接线后的三件不能退化的事：
 *
 *   A. 两个端点被真实调用，且核对走 POST（作答含个人信息，不得进 URL query）。
 *   B. 面板真的挂在政策服务页上（不是死代码）。
 *   C. **两种「空」不许混为一谈** —— 这是本门禁的核心：
 *        无数据（库里还没有可核对的政策条目 → 录入进度）
 *        vs 不匹配（按你填的条件都对不上 → 核对结论）
 *      把前者显示成后者，等于告诉求职者「你不符合任何政策」，而事实是这台机器
 *      还没有任何政策可比。C3 用**真实执行** deriveOutcome 来断言，不只看正则。
 *   D. **AI 挂了这一页照常可用** —— 服务端是确定性比对、零 LLM，所以本页不得
 *      引入任何 AI 能力依赖或 AI 降级分支。V6 原型 21-policy.html 有 16 处
 *      data-when="ai-down" 把这项能力整个关掉，与它自己 :458-459 注释「零 LLM」
 *      矛盾；实现走「不依赖 AI」这一边，本门禁钉住它。
 *   E. 打印不许伪造：后端没有生成核对清单文件的通路，按钮必须是可解释的置灰
 *      （aria-disabled + 原因 + aria-describedby + 点击短路），不得用原生 disabled，
 *      也不得偷偷跳通用上传页假装打印本页结果。
 *   F. 作答零本地留存；触控尺寸达标。
 *
 * 运行：pnpm --filter @ai-job-print/kiosk verify:policy-eligibility-ui
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8')

let failed = 0
const pass = (msg) => console.log(`  PASS ${msg}`)
const fail = (msg) => { console.error(`  FAIL ${msg}`); failed++ }
const check = (ok, msg) => (ok ? pass(msg) : fail(msg))

const api = read('src/services/api/policy-eligibility.ts')
const outcomeSrc = read('src/pages/renshi/eligibilityOutcome.ts')
const panel = read('src/pages/renshi/EligibilityPanel.tsx')
const results = read('src/pages/renshi/EligibilityResults.tsx')
const page = read('src/pages/renshi/RenshiPage.tsx')
const components = read('src/pages/renshi/components.tsx')
const shared = read('src/pages/renshi/shared.ts')
const css = read('src/pages/renshi/renshi-policy-fusion.css')
const packageJson = read('package.json')

/**
 * 剥掉注释再判「用户可见 / 代码结构」类断言 —— 注释里正记录着历史错法。
 *
 * ⚠ 行注释必须**先**剥：源码注释里会出现 `../../ai/*` 这种带 `/*` 的写法，
 *   若先跑块注释正则，它会从那个 `/*` 一路吃到后面第一个 `*​/`，把中间的
 *   import 全删掉 —— 于是「没有 import AI」这类断言会**空匹配假通过**。
 *   本脚本自检段的 sanity 断言就是钉这件事的（本 PR 实测踩过一次）。
 */
const stripComments = (src) =>
  src
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')

const panelCode = stripComments(panel)
const resultsCode = stripComments(results)
const apiCode = stripComments(api)
const eligibilityCode = panelCode + resultsCode + apiCode + stripComments(outcomeSrc)

console.log('\n=== P21 政策条件核对 · 一体机接线契约 ===')

// ── 0. 前置 sanity：剥注释后代码没被吃掉 ─────────────────────────────────
// 下面所有「不含某某」的断言都建立在「剥完还是完整源码」之上。若剥注释把
// import 段吃了，那些断言会全部空匹配假通过 —— 比没有门禁更危险，所以先钉住。
check(
  panelCode.includes('import { useEffect, useMemo, useState }') &&
    resultsCode.includes("from '../../services/api/policy-eligibility'") &&
    apiCode.includes("from './client'"),
  '0. 剥注释后 import 段完整保留（防「不含某某」类断言空匹配假通过）',
)

// ── A. 两个端点被真实调用 ─────────────────────────────────────────────────
check(
  apiCode.includes("`${API_BASE_URL}/policies/eligibility-questions`"),
  'A1. 真实调用 GET /policies/eligibility-questions（问项字典服务端下发）',
)
check(
  apiCode.includes("`${API_BASE_URL}/policies/eligibility-check`"),
  'A2. 真实调用 POST /policies/eligibility-check',
)
// 作答含户籍 / 参保 / 失业登记等个人信息，必须走 POST body，不得进 URL query。
const checkCall = apiCode.slice(apiCode.indexOf('eligibility-check'))
check(
  /method:\s*'POST'/.test(checkCall) && /body:\s*JSON\.stringify\(\{\s*answers\s*\}\)/.test(checkCall),
  'A3. 核对走 POST + JSON body（作答不得出现在 URL query）',
)
check(
  !/eligibility-check[^`'"]*\?/.test(apiCode) && !/URLSearchParams/.test(apiCode),
  'A4. 核对端点未拼接 query string',
)
check(
  panelCode.includes('getEligibilityQuestions()') && panelCode.includes('checkEligibility('),
  'A5. 面板真实调用两个端点（不是只 import 不用）',
)
// 前端不得自造问项字典：取值一旦与服务端漂移，已录入条件会静默失配。
check(
  !/questions\s*[:=]\s*\[/.test(panelCode) && !/POLICY_ELIGIBILITY_QUESTIONS/.test(eligibilityCode),
  'A6. 前端不硬编码问项字典（问项与取值一律服务端下发）',
)
// mock 模式没有后端，宁可如实说做不了，也不造一份本地问项 / 假结论。
check(
  apiCode.includes('ELIGIBILITY_BACKEND_REQUIRED') && panelCode.includes("s: 'backend-required'"),
  'A7. 未连接后端时如实说明，不本地伪造问项或结论',
)

// ── B. 面板真的挂在页面上 ─────────────────────────────────────────────────
check(
  page.includes('<EligibilityPanel />') && page.includes("activeTab === 'eligibility'"),
  'B1. EligibilityPanel 挂在政策服务页（不是死代码）',
)
check(
  shared.includes("'eligibility'") && stripComments(components).includes("key: 'eligibility'"),
  'B2. 条件核对 Tab 在 TabKey 与 TabBar 中登记（可达）',
)

// ── C. 两种「空」必须是两句不同的话（本门禁核心）─────────────────────────
const require_ = createRequire(import.meta.url)
const ts = require_('typescript')
const transpiled = ts.transpileModule(outcomeSrc, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText
const mod = await import(`data:text/javascript;base64,${Buffer.from(transpiled).toString('base64')}`)
const { COPY_NO_PUBLISHED_POLICIES, COPY_NO_RECORDED_CONDITIONS, COPY_ALL_CONFLICT, deriveOutcome, isAskable } = mod

const copies = [COPY_NO_PUBLISHED_POLICIES, COPY_NO_RECORDED_CONDITIONS, COPY_ALL_CONFLICT]
check(
  copies.every((c) => typeof c === 'string' && c.length > 20) && new Set(copies).size === 3,
  'C1. 三条空态/结论文案各自存在且互不相同',
)
// 「无数据」文案必须自己声明它不是核对结果 —— 这是最容易被读错的一句。
check(
  /不是你的核对结果/.test(COPY_NO_PUBLISHED_POLICIES) &&
    /不代表你不符合任何政策/.test(COPY_NO_PUBLISHED_POLICIES) &&
    /不是你的核对结果/.test(COPY_NO_RECORDED_CONDITIONS),
  'C2. 「无数据」文案明说这是录入进度、不是核对结果，且不暗示用户不符合',
)
// 「不匹配」文案是结论，但不得写成资格裁定。
check(
  /按你填写的信息/.test(COPY_ALL_CONFLICT) &&
    /不是资格认定/.test(COPY_ALL_CONFLICT) &&
    !/你不符合/.test(COPY_ALL_CONFLICT),
  'C3. 「都对不上」是核对结论且不写成资格裁定',
)

// C4 —— 真实执行 deriveOutcome，不只看正则：
//   空集合只能落「无数据」，非空全冲突只能落「不匹配」，二者不可互串。
const item = (over, recorded = true) => ({ conditionsRecorded: recorded, overall: over })
const cases = [
  { name: '空集合', items: [], expect: 'no_published_policies' },
  { name: '有政策但零条件', items: [item('no_recorded_conditions', false)], expect: 'no_recorded_conditions' },
  { name: '全部条件不符', items: [item('some_conditions_conflict'), item('some_conditions_conflict')], expect: 'all_conflict' },
  { name: '有相符项', items: [item('all_recorded_conditions_matched'), item('some_conditions_conflict')], expect: 'has_results' },
  { name: '有待确认项', items: [item('some_conditions_unknown')], expect: 'has_results' },
]
const wrong = cases.filter((c) => deriveOutcome(c.items).kind !== c.expect)
check(wrong.length === 0, `C4. deriveOutcome 五种输入判定正确（错误：${wrong.map((c) => c.name).join('、') || '无'}）`)
check(
  deriveOutcome([]).kind === 'no_published_policies' &&
    cases.filter((c) => c.expect === 'all_conflict').every((c) => c.items.length > 0),
  'C5. 「无数据」只可能来自空集合，「都对不上」只可能来自非空集合',
)
// 探针语义：没东西可比时不进入作答，不向用户白要九项个人信息。
check(
  isAskable({ kind: 'no_published_policies' }) === false &&
    isAskable({ kind: 'no_recorded_conditions', policyCount: 3 }) === false &&
    isAskable({ kind: 'all_conflict', comparableCount: 2 }) === true,
  'C6. 无可比对内容时 isAskable=false（不先收个人信息再说库是空的）',
)
check(
  panelCode.includes('checkEligibility({})') && panelCode.includes('isAskable(outcome)'),
  'C7. 进面板先用空作答探针取可用性，再决定是否向用户要个人信息',
)
// 结果页把 outcome.kind 一一映射到文案，不得交叉接线。
check(
  /outcome\.kind === 'no_published_policies'\s*\?\s*COPY_NO_PUBLISHED_POLICIES/.test(resultsCode) &&
    /outcome\.kind === 'no_recorded_conditions'\s*\n?\s*\?\s*COPY_NO_RECORDED_CONDITIONS/.test(resultsCode) &&
    /outcome\.kind === 'all_conflict'\s*\n?\s*\?\s*COPY_ALL_CONFLICT/.test(resultsCode),
  'C8. 结果页 outcome.kind → 文案一一对应，无交叉接线',
)

// ── D. AI 挂了这一页照常可用 ──────────────────────────────────────────────
// 服务端是确定性比对（policy-eligibility.engine.ts，零 LLM），前端不得引入 AI 依赖。
const aiImports = /from\s+'(?:\.\.\/)+ai(?:\/[^']*)?'/.test(eligibilityCode)
check(!aiImports, 'D1. 条件核对相关文件不 import 任何 ../ai 能力模块')
const aiGates = ['useAiTask', 'deriveAiAvailability', 'isAiOutage', 'aiErrorCodeOf', 'AiTaskRegion', 'aiLocked', 'aiOutage']
const leaked = aiGates.filter((id) => eligibilityCode.includes(id))
check(leaked.length === 0, `D2. 不引用任何 AI 可用性门（越界标识：${leaked.join('、') || '无'}）`)
// 不得出现「AI 不可用所以不核对」这类降级分支或文案。
check(
  !/AI\s*不可用/.test(panelCode + resultsCode) && !/未核对/.test(panelCode + resultsCode),
  'D3. 无「AI 不可用 / 未核对」降级文案（原型 ai-down 那 16 处的错法不得进实现）',
)
// 正面：页面要明说 AI 与这一页无关，别让用户以为是 AI 在判。
check(
  /不使用 AI/.test(resultsCode) && /AI 服务是否可用都不影响/.test(resultsCode),
  'D4. 结果页明示「不使用 AI，AI 是否可用不影响本页」',
)
// 证据分级：确定性逻辑不得标 E3，也不得出现「AI 判断」。
check(
  /E2 · 按政策原文逐条比对/.test(resultsCode) && !/E3/.test(resultsCode) && !/AI\s*判断/.test(eligibilityCode),
  'D5. 证据分级标 E2，不标 E3、不写「AI 判断」',
)

// ── E. 打印诚实性 ─────────────────────────────────────────────────────────
// 后端没有生成核对清单文件的通路（policies 模块不引 FilesModule、无 pdf service、
// 无 print 路由），所以这里只能是可解释的置灰，不能是假按钮。
const printBtn = /<button[^>]*className="k8-elig-print-blocked"[\s\S]*?<\/button>/.exec(resultsCode)?.[0] ?? ''
check(
  printBtn.includes('aria-disabled="true"') &&
    printBtn.includes('aria-describedby="k8-elig-print-why"') &&
    /onClick=\{\(event\) => event\.preventDefault\(\)\}/.test(printBtn) &&
    /暂不可用/.test(printBtn),
  'E1. 打印按钮 = aria-disabled + 原因关联 + 点击短路 + 标注「暂不可用」',
)
// 原生 disabled 在 27 寸触摸屏上等于没给原因：没有 hover，title 永不显示；
// 还让按钮掉出 tab 序、被读屏跳过（口径见 #620）。
check(
  !/<button[^>]*\sdisabled(\s|>|=\{)/.test(panelCode + resultsCode),
  'E2. 不得回退原生 disabled（触屏上不可解释）',
)
check(
  /id="k8-elig-print-why"/.test(resultsCode) && /PRINT_BLOCKED_WHY/.test(resultsCode),
  'E3. 置灰原因是常显段落，且与按钮 aria-describedby 关联',
)
// 不许偷偷跳通用上传页假装打印本页结果（岗位详情已经犯过这个错）。
check(
  !/navigate\('\/print\/upload'\)/.test(eligibilityCode) && !/print\/jobs/.test(eligibilityCode),
  'E4. 未用通用上传/打印路径伪装成「打印核对清单」',
)
// 提交按钮的置灰同样要可解释。
check(
  /aria-describedby=\{enough \? undefined : 'k8-elig-submit-why'\}/.test(panelCode) &&
    /id="k8-elig-submit-why"/.test(panelCode),
  'E5. 提交按钮置灰同样带常显原因 + aria-describedby',
)

// ── F. 隐私与触控 ─────────────────────────────────────────────────────────
check(
  !/localStorage|sessionStorage|document\.cookie/.test(eligibilityCode),
  'F1. 作答不写入任何本地存储（服务端亦零持久化）',
)
check(
  !/searchParams\.set|history\.(push|replace)State/.test(eligibilityCode),
  'F2. 作答不进 URL',
)
// 合规边界：只做信息展示与资格自查，不代办、不申报、不承诺审批结果。
const overreach = [/代为申报/, /帮你申领/, /保证通过/, /一定能领/, /包过/, /资格认定通过/]
  .filter((p) => p.test(panelCode + resultsCode + stripComments(outcomeSrc)))
check(overreach.length === 0, `F3. 无代办 / 承诺审批结果的越界文案（命中：${overreach.length}）`)
// 主按钮 ≥56px，可点区 ≥48px（1080×1920 竖屏触控）。
const eligCss = css.slice(css.indexOf('.k8-elig {'))
const minHeights = [...eligCss.matchAll(/min-height:\s*(\d+)px/g)].map((m) => Number(m[1]))
// 两条规则覆盖全部可点元素：.k8-elig-opt（选项 chip）与四个按钮共用的那条。
check(
  minHeights.length >= 2 &&
    minHeights.every((h) => h >= 56) &&
    /\.k8-elig-opt\s*\{[^}]*min-height:\s*(?:5[6-9]|[6-9]\d|\d{3,})px/.test(eligCss) &&
    /\.k8-elig-submit,[\s\S]*?\{[^}]*min-height:\s*(?:5[6-9]|[6-9]\d|\d{3,})px/.test(eligCss),
  `F4. 条件核对可点元素 min-height 全部 ≥56px（实测：${minHeights.join('/') || '未采集到'}）`,
)
check(packageJson.includes('"verify:policy-eligibility-ui"'), 'F5. package.json 注册 verify:policy-eligibility-ui')

// ── 自检：断言用的正则必须真的能匹配到东西（空匹配不等于通过）────────────
// 反例夹具：把两种「空」串线、用原生 disabled、跳通用上传页 —— 这些必须被抓住。
const fixtureCrossWired = `outcome.kind === 'no_published_policies' ? COPY_ALL_CONFLICT`
const fixtureNativeDisabled = `<button type="button" disabled onClick={go}>打印</button>`
const fixtureFakePrint = `onClick={() => navigate('/print/upload')}`
const fixtureAiImport = `import { useAiTask } from '../../ai'\nimport x from '../../../ai/useAiTask'`
check(
  !/outcome\.kind === 'no_published_policies'\s*\?\s*COPY_NO_PUBLISHED_POLICIES/.test(fixtureCrossWired) &&
    /<button[^>]*\sdisabled(\s|>|=\{)/.test(fixtureNativeDisabled) &&
    /navigate\('\/print\/upload'\)/.test(fixtureFakePrint) &&
    /from\s+'(?:\.\.\/)+ai(?:\/[^']*)?'/.test(fixtureAiImport),
  '自检1. C8/D1/E2/E4 的正则在反例夹具上确实报警（不是空匹配假通过）',
)
// 自检2：行注释里的 `../../ai/*` 不得把后面的 import 吃掉（本 PR 实测踩过）。
const fixtureTrickyComment = `// 本面板不引 ../../ai/*、不读 AI 状态\nimport { useState } from 'react'`
check(
  stripComments(fixtureTrickyComment).includes("import { useState } from 'react'"),
  '自检2. stripComments 先剥行注释：注释里的 /* 不会吃掉后续代码',
)

console.log('')
if (failed > 0) {
  console.error(`FAIL ${failed} 项失败：P21 一体机接线契约未通过\n`)
  process.exit(1)
}
console.log('✅ ALL PASS — P21 政策条件核对一体机接线契约通过\n')
