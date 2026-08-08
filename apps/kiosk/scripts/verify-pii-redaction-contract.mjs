#!/usr/bin/env node
/**
 * verify:pii-redaction-contract —— 隐私遮挡前端契约门禁
 *
 * 背景:后端 pii_redact 曾恒返回 resultFileCreated:false(不生成任何文件),
 * 而前端照样让用户走完整个遮挡流程并显示「遮挡 N 项」。页面有一行诚实警示,
 * 所以不算欺骗,但用户以为做了 —— 这台机器在公共场所、输出实体纸、纸会被别人捡走。
 *
 * 修复口径见 docs/product/pii-redaction-decision-2026-08.md。本门禁钉住四条:
 *
 *   A. 文案由后端 claim 决定,前端不许自己编(行为测试 piiRedactionCopy)
 *   B. 拿不到结论 / 拿不到派生件时 fail-closed,不出现任何表示已处理的表述
 *   C. 强制预览不可跳过、不可折叠(静态断言 RedactionReviewPresentation)
 *   D. failed_no_position 单独标出,不混在成功项里
 *
 * 行为测试用 Node 原生类型擦除直接 import 业务模块(--experimental-strip-types),
 * 比正则断言强得多:改坏 claim 分支会立刻挂,而不是等到有人在一体机前面打了一张纸。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const kioskRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = join(kioskRoot, '..', '..')
const read = (relative) => readFileSync(join(kioskRoot, relative), 'utf8')

/**
 * 去掉注释后再扫「禁止出现的入口标记」。
 * 否则「本组件刻意不提供跳过预览的入口」这类说明性注释会被自己的门禁判违规。
 * `//` 只在不紧跟 `:` 时视为行注释,避免误伤 https:// 之类。
 */
const stripComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

const CONTRACT = 'src/pages/print/piiRedaction.ts'
const REVIEW = 'src/pages/print/components/RedactionReviewPresentation.tsx'
const DECIDE = 'src/pages/print/components/MaterialCheckPresentation.tsx'
const PAGE = 'src/pages/print/PrintMaterialCheckPage.tsx'

let failures = 0
const pass = (message) => console.log(`  PASS ${message}`)
const fail = (message) => {
  failures += 1
  console.error(`  FAIL ${message}`)
}
function check(message, fn) {
  try {
    fn()
    pass(message)
  } catch (error) {
    fail(`${message} — ${error.message}`)
  }
}

console.log('\n=== Kiosk 隐私遮挡前端契约门禁 ===')

// ── §3.3 文案天花板:本机不具备的承诺一律禁止出现 ──────────────────────────────
// 与 packages/shared COMPLIANCE_FORBIDDEN_TERM_PATTERNS 同源,下面会断言两处不漂移。
const FORBIDDEN_CLAIMS = [
  /已遮挡(?!你确认的)/,
  /已?无隐私(?:信息|内容)/,
  /隐私已(?:保护|清除|移除)/,
]

const ssot = readFileSync(join(repoRoot, 'packages/shared/src/types/complianceCopy.ts'), 'utf8')
check('§3.3 禁词已进合规 SSOT(两道门禁不漂移)', () => {
  for (const pattern of FORBIDDEN_CLAIMS) {
    assert.ok(
      ssot.includes(pattern.source),
      `complianceCopy.ts 缺少 ${pattern.source}`,
    )
  }
})

const {
  parsePiiRedactionResult,
  piiRedactionCopy,
  hasUsableRedactedFile,
  materialRedactionBadge,
} = await import(join(kioskRoot, CONTRACT))

// ── 1. 行为:claim → 文案 ────────────────────────────────────────────────────

const baseItems = [
  { id: 'a', type: 'id_card', pageNumber: 1, requested: 'redact', applied: 'redacted' },
  { id: 'b', type: 'phone', pageNumber: 1, requested: 'redact', applied: 'redacted' },
  { id: 'c', type: 'email', pageNumber: 2, requested: 'keep', applied: 'kept' },
]

const makeTask = (checks) => ({ result: { checks }, resultFileId: null })

const scenarios = {
  verified: makeTask({
    ok: true,
    claim: 'redacted_verified',
    redactedFileId: 'file-1',
    redactedFileUrl: 'https://example.invalid/f.pdf',
    items: baseItems,
    reverify: { ran: true, remainingCount: 0, method: 'text_layer' },
  }),
  unverified: makeTask({
    ok: true,
    claim: 'redacted_unverified',
    redactedFileId: 'file-1',
    redactedFileUrl: 'https://example.invalid/f.pdf',
    items: baseItems,
    reverify: { ran: false, remainingCount: null, method: 'skipped' },
  }),
  partial: makeTask({
    ok: true,
    claim: 'partial',
    redactedFileId: 'file-1',
    redactedFileUrl: 'https://example.invalid/f.pdf',
    items: [...baseItems, { id: 'd', type: 'id_card', pageNumber: 3, requested: 'redact', applied: 'failed_no_position' }],
    reverify: { ran: true, remainingCount: 0, method: 'text_layer' },
  }),
  remaining: makeTask({
    ok: true,
    claim: 'redacted_verified',
    redactedFileId: 'file-1',
    redactedFileUrl: 'https://example.invalid/f.pdf',
    items: baseItems,
    reverify: { ran: true, remainingCount: 2, method: 'ocr' },
  }),
  notSupported: makeTask({
    ok: false,
    claim: 'not_supported',
    notSupportedReason: 'scanned_no_position',
    redactedFileId: null,
    redactedFileUrl: null,
    items: [],
    reverify: { ran: false, remainingCount: 0, method: 'skipped' },
  }),
  // 后端说成功但没给派生件 —— 打印的还是原件,必须降级为「本机无法确认」。
  claimWithoutFile: makeTask({
    ok: true,
    claim: 'redacted_verified',
    redactedFileId: null,
    redactedFileUrl: null,
    items: baseItems,
    reverify: { ran: true, remainingCount: 0, method: 'text_layer' },
  }),
  // 旧后端形状(本次修复前):没有 claim 字段。
  legacy: makeTask({ canRedact: true, redactedFileId: null, resultFileCreated: false }),
  // 未来新增 / 拼错的 claim 取值。
  unknownClaim: makeTask({ claim: 'totally_redacted', redactedFileId: 'x', redactedFileUrl: 'https://a.invalid/x.pdf' }),
}

const parsed = Object.fromEntries(
  Object.entries(scenarios).map(([key, task]) => [key, parsePiiRedactionResult(task)]),
)

check('parse:旧后端形状(无 claim)→ claim 为 null,不猜成功态', () => {
  assert.equal(parsed.legacy.claim, null)
})
check('parse:未知 claim 取值 → claim 为 null(fail-closed)', () => {
  assert.equal(parsed.unknownClaim.claim, null)
  assert.equal(parsed.unknownClaim.rawClaim, 'totally_redacted')
})
check('parse:契约放在 result 顶层时同样能读到', () => {
  const flat = parsePiiRedactionResult({
    result: { claim: 'not_supported', notSupportedReason: 'encrypted', items: [] },
    resultFileId: null,
  })
  assert.equal(flat.claim, 'not_supported')
  assert.equal(flat.notSupportedReason, 'encrypted')
})
check('parse:reverify.remainingCount 缺失时为 null,不当作 0', () => {
  assert.equal(parsed.unverified.reverify.remainingCount, null)
})

check('claim=redacted_verified → 「已遮挡你确认的 N 处 · 请核对预览」且必须人眼确认', () => {
  const copy = piiRedactionCopy(parsed.verified)
  assert.match(copy.title, /^已遮挡你确认的 2 处 · 请核对预览$/)
  assert.equal(copy.requiresPreviewConfirm, true)
  assert.ok(copy.confirmLabel, '必须给出「我核对过」勾选项文案')
  assert.equal(copy.showFallbackOptions, false)
})

check('复检有残留 → 「仍检出 N 处未盖住 · 不建议打印」,覆盖正向 claim', () => {
  const copy = piiRedactionCopy(parsed.remaining)
  assert.match(copy.title, /仍检出 2 处未盖住 · 不建议打印/)
  assert.equal(copy.tone, 'danger')
  assert.equal(copy.requiresPreviewConfirm, true)
})

check('claim=partial → 点名没能定位的处数,不笼统报成功', () => {
  const copy = piiRedactionCopy(parsed.partial)
  assert.match(copy.title, /另有 1 处没能定位/)
})

check('claim=not_supported → 不出现任何表示已遮挡的表述,并给出三条出路', () => {
  const copy = piiRedactionCopy(parsed.notSupported)
  assert.match(copy.title, /这份是扫描件/)
  assert.equal(copy.showFallbackOptions, true)
  assert.equal(copy.confirmLabel, null)
  assert.equal(copy.requiresPreviewConfirm, false)
  assert.match(copy.detail, /没有生成任何新文件/)
})

check('后端说成功但没有派生件 → 降级为「本机无法确认」(fail-closed)', () => {
  assert.equal(hasUsableRedactedFile(parsed.claimWithoutFile), false)
  const copy = piiRedactionCopy(parsed.claimWithoutFile)
  assert.match(copy.title, /本机无法确认/)
  assert.equal(copy.confirmLabel, null)
})

check('claim 缺失 / 未知 → 「本机无法确认」,不解锁打印', () => {
  for (const key of ['legacy', 'unknownClaim']) {
    const copy = piiRedactionCopy(parsed[key])
    assert.match(copy.title, /本机无法确认/, key)
    assert.equal(copy.requiresPreviewConfirm, false, key)
    assert.equal(copy.confirmLabel, null, key)
  }
  const nothing = piiRedactionCopy(null)
  assert.match(nothing.title, /本机无法确认/)
})

check('全部 claim 分支的文案都不触碰 §3.3 禁词', () => {
  const outputs = [piiRedactionCopy(null), ...Object.values(parsed).map(piiRedactionCopy)]
  for (const copy of outputs) {
    const text = [copy.title, copy.detail, copy.confirmLabel ?? '', copy.continueLabel].join(' | ')
    for (const pattern of FORBIDDEN_CLAIMS) {
      assert.ok(!pattern.test(text), `「${text}」命中 ${pattern}`)
    }
  }
})

// ── 2. 行为:下游打印页的结论徽标 ────────────────────────────────────────────

const summaryOf = (over) => ({
  claim: 'redacted_verified',
  redactedFileId: 'file-1',
  appliedRedactedCount: 2,
  failedNoPositionCount: 0,
  keptCount: 1,
  reverifyRemainingCount: 0,
  reverifyRan: true,
  previewConfirmedAt: '2026-08-09T00:00:00.000Z',
  ...over,
})

check('徽标:未经人眼确认的遮挡结果不放行', () => {
  const badge = materialRedactionBadge(summaryOf({ previewConfirmedAt: undefined }))
  assert.equal(badge.tone, 'danger')
  assert.match(badge.text, /尚未经你核对/)
})
check('徽标:not_supported 说明打印使用原件', () => {
  const badge = materialRedactionBadge(summaryOf({ claim: 'not_supported', redactedFileId: null }))
  assert.match(badge.text, /打印使用原件/)
})
check('徽标:用户确认不做遮挡时直说纸上是完整信息', () => {
  const badge = materialRedactionBadge(summaryOf({ claim: null, redactedFileId: null, unredactedAcknowledgedAt: 'x' }))
  assert.match(badge.text, /完整信息/)
  assert.equal(badge.tone, 'danger')
})
check('徽标:没有遮挡动作时返回 null,不硬凑一句结论', () => {
  assert.equal(materialRedactionBadge(undefined), null)
})
check('徽标文案不触碰 §3.3 禁词', () => {
  const badges = [
    materialRedactionBadge(summaryOf({})),
    materialRedactionBadge(summaryOf({ claim: 'partial', failedNoPositionCount: 1 })),
    materialRedactionBadge(summaryOf({ claim: 'redacted_unverified', reverifyRan: false, reverifyRemainingCount: null })),
    materialRedactionBadge(summaryOf({ reverifyRemainingCount: 3 })),
    materialRedactionBadge(summaryOf({ claim: 'not_supported', redactedFileId: null })),
    materialRedactionBadge(summaryOf({ claim: null })),
  ]
  for (const badge of badges) {
    for (const pattern of FORBIDDEN_CLAIMS) {
      assert.ok(!pattern.test(badge.text), `「${badge.text}」命中 ${pattern}`)
    }
  }
})

// ── 3. 静态:强制预览不可跳过 / 不可折叠 ────────────────────────────────────

const reviewSrc = read(REVIEW)

const reviewCode = stripComments(reviewSrc)
check('核对页没有任何跳过入口', () => {
  for (const marker of ['跳过', '稍后', '直接继续', 'skipPreview', 'onSkip']) {
    assert.ok(!reviewCode.includes(marker), `出现跳过入口标记「${marker}」`)
  }
})
check('核对页不折叠、不默认收起', () => {
  for (const marker of ['<details', '<summary', 'collapse', 'Collapse', 'accordion', '展开查看']) {
    assert.ok(!reviewCode.includes(marker), `出现折叠标记「${marker}」`)
  }
})
check('预览区无条件渲染(没有显示/隐藏开关)', () => {
  assert.match(reviewSrc, /w2-redact-preview-frame/)
  assert.ok(!/useState/.test(reviewSrc), '核对页不得自持展开状态')
  assert.ok(!/showPreview/.test(reviewSrc))
})
check('未勾选确认 → 继续按钮不可用', () => {
  assert.match(reviewSrc, /const canContinue = canConfirm && props\.confirmed && !props\.isWorking/)
  assert.match(reviewSrc, /disabled=\{!canContinue\}/)
})
check('预览拿不到 → 不允许确认(fail-closed)', () => {
  assert.match(reviewSrc, /const previewBlocked = props\.previewKind === 'unavailable'/)
  assert.match(reviewSrc, /canConfirm = copy\.requiresPreviewConfirm && !previewBlocked/)
})
check('failed_no_position 单独成块,不混在成功项里', () => {
  assert.match(reviewSrc, /w2-redact-failed/)
  assert.match(reviewSrc, /props\.failedItems\.length > 0/)
  assert.match(reviewSrc, /没能定位/)
})
check('「不做遮挡直接打印」需要单独的明确确认', () => {
  assert.match(reviewSrc, /acknowledgedUnredacted/)
  assert.match(reviewSrc, /disabled=\{!props\.acknowledgedUnredacted \|\| props\.isWorking\}/)
})
check('核对页保持纯展示(不发请求、不碰路由 / 存储)', () => {
  for (const marker of ['../../services', 'useNavigate', 'useLocation', 'sessionStorage', 'localStorage', 'fetch(']) {
    assert.ok(!reviewSrc.includes(marker), `出现非展示层依赖「${marker}」`)
  }
})

// ── 4. 静态:逐项裁决与编排 ─────────────────────────────────────────────────

const decideSrc = read(DECIDE)
check('逐项列出第几页 / 类型 / 掩码片段', () => {
  assert.match(decideSrc, /pageLabel/)
  assert.match(decideSrc, /maskedSnippet/)
})
check('没有批量「全部保留」入口(保留必须逐项单独点)', () => {
  for (const marker of ['全部保留', 'onKeepAll', 'onApplySuggested']) {
    assert.ok(!stripComments(decideSrc).includes(marker), `出现批量保留入口「${marker}」`)
  }
})

const pageSrc = read(PAGE)
check('默认全部遮挡', () => {
  assert.match(pageSrc, /\[finding\.id, 'redact' as PiiFindingAction\]/)
})
check('遮挡后进入核对阶段,而不是直接跳打印设置', () => {
  assert.match(pageSrc, /setStage\('redaction_review'\)/)
  assert.match(pageSrc, /RedactionReviewPresentation/)
})
check('唯一不进核对阶段的条件是「没有任何一处要求遮挡」', () => {
  assert.match(pageSrc, /if \(redactedCount === 0\) \{/)
  // 只有三处调用:无遮挡请求 / 人眼确认通过 / 用户明确接受打印原件。
  // 多出来的第四处一定要复核 —— 那很可能是又开了一条绕过核对的路。
  const jumps = pageSrc.match(/goToPreview\(/g) ?? []
  assert.equal(jumps.length, 3, `goToPreview 调用点应为 3 处,实际 ${jumps.length}`)
})
check('人眼确认通过后才写 previewConfirmedAt,且改用派生件打印', () => {
  assert.match(pageSrc, /if \(!hasUsableRedactedFile\(redaction\)\) return/)
  assert.match(pageSrc, /previewConfirmedAt: new Date\(\)\.toISOString\(\)/)
  assert.match(pageSrc, /fileId: redaction\.redactedFileId \?\? file\.fileId/)
})

// ── 5. 静态:下游页不再自己拼结论 ───────────────────────────────────────────

for (const relative of [
  'src/pages/print/PrintPreviewPage.tsx',
  'src/pages/print/PrintConfirmPage.tsx',
]) {
  const body = read(relative)
  check(`${relative} 通过 materialRedactionBadge 取结论`, () => {
    assert.match(body, /materialRedactionBadge/)
    assert.ok(!body.includes('resultFileCreated'), '仍在读已废弃的 resultFileCreated')
  })
}

// ── 结果 ────────────────────────────────────────────────────────────────────

if (failures > 0) {
  console.error(`\n❌ ${failures} 项失败 —— 隐私遮挡前端契约门禁未通过\n`)
  process.exit(1)
}
console.log('\n✅ ALL PASS —— 隐私遮挡前端契约门禁通过\n')
