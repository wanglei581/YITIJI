import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 全站共享 AI 前端原语静态断言（接线矩阵 §四 S1-1 / S1-2）。
 *
 * 这些原语目前还没有被任何页面消费（消费在 S2 批次），浏览器套件断不到它们，
 * 所以用静态断言把契约锁住，防止后续接线时被改坏。
 *
 * 每条断言都对应一条**写在设计契约里、做错会造成用户可见伤害**的规则，
 * 不是「文件里有这个词」式的凑数检查。
 */

const root = fileURLToPath(new URL('..', import.meta.url))

function read(relativePath) {
  return readFileSync(join(root, relativePath), 'utf8')
}

const files = {
  hook: read('src/ai/useAiTask.ts'),
  region: read('src/ai/AiTaskRegion.tsx'),
  evidence: read('src/ai/AiEvidence.tsx'),
  barrel: read('src/ai/index.ts'),
  css: read('src/styles/ai-primitives.css'),
  indexCss: read('src/index.css'),
}

const failures = []

function assert(condition, message) {
  if (!condition) failures.push(message)
}

function must(fileKey, pattern, message) {
  const content = files[fileKey]
  const ok = pattern instanceof RegExp ? pattern.test(content) : content.includes(pattern)
  assert(ok, `${fileKey}: ${message}`)
}

function mustNot(fileKey, pattern, message) {
  const content = files[fileKey]
  const hit = pattern instanceof RegExp ? pattern.test(content) : content.includes(pattern)
  assert(!hit, `${fileKey}: ${message}`)
}

// ── S1-1 · data-aitask 四态原语 ────────────────────────────────────────────
// 契约：docs/design/kiosk-ai-os-v3-2026-08/01-home-v6.html:161-190

// 要求 1 / 3：前端不得用计时器自行推进任务状态，也不得设「到点变 done」的兜底计时器。
// 原型里唯一那处 PROTOTYPE-ONLY 计时器必须被删掉而不是搬运过来。
for (const timer of ['setTimeout', 'setInterval', 'requestAnimationFrame']) {
  mustNot('hook', new RegExp(`\\b${timer}\\s*\\(`), `任务状态原语内不得出现计时器 ${timer}`)
  mustNot('region', new RegExp(`\\b${timer}\\s*\\(`), `任务状态原语内不得出现计时器 ${timer}`)
}

// 状态只能是纯派生：没有本地状态就没有「前端自行推进」的落脚点。
mustNot('hook', /\buseState\s*[(<]/, '任务状态必须是纯派生，不得持有本地 state')
mustNot('hook', /\buseEffect\s*\(/, '任务状态必须是纯派生，不得用副作用推进')

// 四态封闭，不得扩充第五态（行尾锚定，防止在后面追加 | 'xxx'）。
must(
  'hook',
  /^export type AiTaskState = 'idle' \| 'running' \| 'done' \| 'failed'$/m,
  '四态取值必须严格是 idle / running / done / failed，不得扩充第五态',
)

// 要求 4：ai-down 硬钳位，且必须排在 pending 之前 —— 否则 AI 挂了还会出现 running。
const clampIndex = files.hook.indexOf("availability === 'unavailable'")
const pendingIndex = files.hook.indexOf('if (source.pending) return')
assert(clampIndex > -1, 'hook: 缺少 availability === "unavailable" 硬钳位')
assert(pendingIndex > -1, 'hook: 缺少 pending → running 分支')
assert(
  clampIndex > -1 && pendingIndex > -1 && clampIndex < pendingIndex,
  'hook: ai-down 钳位必须排在 pending 分支之前，否则 AI 不可用时仍会渲染出 running',
)
must('hook', /availability === 'unavailable'\) return 'failed'/, 'ai-down 必须钳位到 failed')

// fail-closed：能力探测无结论时不得默认正常，也不得渲染成「在算」。
// 必须断在派生函数自己的分支上，不能被 resolveBlockReason 里同名的判断顶替。
must(
  'hook',
  /if \(source\.availability === 'unknown'\) return source\.failed \? 'failed' : 'idle'/,
  '派生函数必须有 availability=unknown 的 fail-closed 分支',
)

// 要求 5：failed 必须保留不依赖 AI 的路径 —— fallback 是必填 prop，由类型系统强制。
must('region', /\n  fallback: AiTaskFallback\n/, 'fallback 必须是必填 prop（不得写成 fallback?）')

// 三种处置按能力性质区分，不能一刀切。
for (const mode of ["mode: 'manual'", "mode: 'blocked'", "mode: 'result-unavailable'"]) {
  must('region', mode, `缺少降级处置分支 ${mode}`)
}

// 三种处置都必须携带原因文案，不能只给一个通用的「AI 暂不可用」。
const reasonRequired = files.region.match(/^ {2}reason: string$/gm) ?? []
assert(
  reasonRequired.length >= 3,
  `region: 三种降级处置都必须有必填 reason，实测 ${reasonRequired.length} 处`,
)

// ① manual 必须承载具体手动路径 + 至少一个仍可用的动作。
must('region', /^ {2}manualPath: string$/m, 'manual 处置必须有必填 manualPath')
must('region', /^ {2}action: \{ label: string; onClick: \(\) => void \}$/m, 'manual 处置必须有必填 action')

// ② blocked 必须有置灰入口文案 + AI 挂了仍拿得到什么。
must('region', /^ {2}blockedActionLabel: string$/m, 'blocked 处置必须有必填 blockedActionLabel')
must('region', /^ {2}stillAvailable: string$/m, 'blocked 处置必须有必填 stillAvailable')

// ③ result-unavailable 必须告诉用户恢复后怎么办。
must('region', /^ {2}retryHint: string$/m, 'result-unavailable 处置必须有必填 retryHint')

// 置灰必须用 aria-disabled 并常驻可见原因，不得用原生 disabled：
// 原生 disabled 会把按钮踢出 Tab 序列、读屏直接跳过，用户永远读不到为什么灰。
must('region', /aria-disabled="true"/, '置灰入口必须用 aria-disabled="true"')
must('region', /aria-describedby=\{reasonId\}/, '置灰原因必须经 aria-describedby 关联')
// 负向后顾排除 aria-disabled / data-*-disabled；只抓真正的原生 disabled 属性。
mustNot(
  'region',
  /(?<![-\w])disabled(\s*=|\s*\}|\s*\/|\s*>)/,
  '不得使用原生 disabled 属性（会退出 Tab 序列、读屏跳过）',
)

// 要求 2：running 之外不挂载进度子树 —— 进度条没有机会在没在算的时候转。
must('region', /task\.isRunning \? running/, 'running 内容必须只在 running 态挂载')
must('region', /\{\.\.\.task\.containerProps\}/, '容器必须铺 data-aitask')

// idle / done / failed 时任何进度动效静止（CSS 第二道闸）。
must('css', /\[data-aitask='idle'\] \[data-ai-progress\]/, 'idle 态必须停掉进度动效')
must('css', /\[data-aitask='failed'\] \[data-ai-progress\]/, 'failed 态必须停掉进度动效')

// 一体机触控尺寸（CLAUDE.md §9）：主操作不小于 56px。
const minHeight = files.css.match(/min-height:\s*(\d+)px/)
assert(minHeight && Number(minHeight[1]) >= 56, 'css: 降级动作按钮 min-height 必须 ≥ 56px')

// ── S1-2 · 证据分级与 AI 免责 ──────────────────────────────────────────────
// 契约：docs/design/kiosk-ai-os-v3-2026-08/interface-handoff.md §3

// 全站此前「AI 判断」字样 0 处；共享组件必须把这个口径带进来。
must('evidence', 'AI 判断', '必须使用统一口径「AI 判断」')
must('evidence', /E3: 'AI 判断'/, 'E3 的用户可读名必须是「AI 判断」')
must('evidence', /E1: '你的材料'/, 'E1 的用户可读名必须是「你的材料」')
must('evidence', /E2: '来源信息'/, 'E2 的用户可读名必须是「来源信息」')

// E3 必须带「仅供参考」，且不得被 compact 掉。
must('evidence', /AI_JUDGEMENT_DISCLAIMER = '仅供参考'/, 'E3 免责后缀必须是「仅供参考」')
must('evidence', /level: 'E3'\n {6}compact\?: never/, 'E3 必须在类型层面禁用 compact')
must('evidence', /props\.level === 'E3' \? false/, 'E3 运行时也不得走 compact 分支')

// E3 禁止百分比 / 录用概率 / 通过率。断在导出声明上，改名即失效。
must(
  'evidence',
  /export const FORBIDDEN_E3_CLAIM_PATTERNS/,
  '必须导出 E3 量化断言禁用清单 FORBIDDEN_E3_CLAIM_PATTERNS',
)
must('evidence', /export function hasForbiddenE3Claim/, '必须导出 E3 量化断言自检函数')
for (const claim of ['录用', '通过率', '百分之']) {
  must('evidence', claim, `E3 禁用清单必须覆盖「${claim}」类断言`)
}

// AIGC 标识每页恰好一次 —— 断在守卫实现上，光写注释不算数。
must('evidence', /AIGC/, '必须提供 AIGC 可见标识')
must('evidence', /let mountedAigcMarks = 0/, 'AIGC 标识必须有「每页恰好一次」的挂载计数守卫')
must('evidence', /mountedAigcMarks > 1/, 'AIGC 标识守卫必须在多于一个时报错')

// 字号：徽章必须走令牌且 ≥ 13px；11px 已被判定为把最该被读到的标记做成最读不到的。
must('css', /--kiosk-ai-ev-fz:\s*(\d+)px/, '徽章字号必须走 --kiosk-ai-ev-fz 令牌')
const evFz = files.css.match(/--kiosk-ai-ev-fz:\s*(\d+)px/)
assert(evFz && Number(evFz[1]) >= 13, 'css: 证据徽章字号必须 ≥ 13px（不得回退到 11px）')
mustNot('css', /\.kiosk-ev[^{]*\{[^}]*font-size:\s*1[12]px/, '证据徽章不得硬编码 11px / 12px')
must('evidence', /className=\{\['kiosk-ev'/, '徽章必须使用 kiosk-ev 类名以套用字号令牌')

// 样式必须真的被挂上，否则以上尺寸口径全部落空。
// 走组件级 import（index.css 的 import 顺序是 verify-fusion-shell 锁死的合同，不动它）；
// 两个组件文件都要引，任一被深引时都不会掉样式。
must('region', /^import '\.\.\/styles\/ai-primitives\.css'$/m, 'AiTaskRegion 必须引入 AI 原语样式')
must('evidence', /^import '\.\.\/styles\/ai-primitives\.css'$/m, 'AiEvidence 必须引入 AI 原语样式')
mustNot('indexCss', 'ai-primitives.css', 'AI 原语样式不得塞进 index.css（会破坏 shell import 顺序合同）')

// 原语必须从统一出口导出，避免后续 17 页各自深引路径。
// 整行锚定：改成 `X as _Unused` 之类的重命名不算导出。
for (const name of ['useAiTask', 'AiTaskRegion', 'EvidenceBadge', 'AigcMark', 'AiCapabilityChip']) {
  must('barrel', new RegExp(`^ {2}${name},$`, 'm'), `统一出口必须原名导出 ${name}`)
}

// ── 合规红线（CLAUDE.md §2）────────────────────────────────────────────────
const forbiddenCopy = [
  '一键投递',
  '立即投递',
  '平台投递',
  '投递简历',
  '企业收简历',
  '候选人管理',
  '候选人筛选',
  '面试邀约',
]
for (const [key, content] of Object.entries(files)) {
  for (const word of forbiddenCopy) {
    assert(!content.includes(word), `${key}: 出现违规文案「${word}」`)
  }
}

if (failures.length > 0) {
  console.error('verify-kiosk-ai-primitives failed:')
  failures.forEach((failure) => console.error(`- ${failure}`))
  process.exit(1)
}

console.log(`verify-kiosk-ai-primitives passed (${Object.keys(files).length} files checked)`)
