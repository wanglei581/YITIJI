#!/usr/bin/env node
/**
 * verify:pii-redaction-contract —— 隐私遮挡前端契约门禁
 *
 * 背景:后端 pii_redact 现在会生成遮挡派生件并回填 claim,而前端曾对用户说
 * 「当前版本不生成新文件」。功能做出来了页面还说没做,和没做却说做了一样不诚实
 * (CLAUDE.md §9)。
 *
 * 本门禁钉住:
 *
 *   A. 文案由后端 claim 决定,前端不许自己编(行为测试 piiRedactionCopy)
 *   B. 拿不到结论 / 拿不到派生件时 fail-closed,不出现任何表示已处理的表述
 *   C. claim 白名单必须是 5 个(含 nothing_to_redact);未知取值不得降级成「无法确认」以外的话
 *   D. 下游预览 / 确认页通过 materialRedactionBadge 取结论,不再读 resultFileCreated
 *   E. 用户可见假文案(「当前版本不生成新文件」等)不得出现;诚实横幅不得被源分支假文案覆盖
 *
 * 本轮不改呈现层视觉(RedactionReviewPresentation / 强制预览核对页)。那些断言留给
 * 青序流光稿改完之后的视觉刀,本文件不假装它们已经存在。
 *
 * 行为测试用 Node 原生类型擦除直接 import 业务模块(--experimental-strip-types)。
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
 * 否则「不得把横幅改回 AI文件预检」这类说明性注释会被自己的门禁判违规。
 * `//` 只在不紧跟 `:` 时视为行注释,避免误伤 https:// 之类。
 */
const stripComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

const CONTRACT = 'src/pages/print/piiRedaction.ts'
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
  PII_REDACTION_CLAIMS,
  PII_REDACTION_NOT_SUPPORTED_REASONS,
} = await import(join(kioskRoot, CONTRACT))

check('claim 白名单恰好 5 个,含 nothing_to_redact', () => {
  assert.deepEqual([...PII_REDACTION_CLAIMS], [
    'redacted_verified',
    'redacted_unverified',
    'partial',
    'not_supported',
    'nothing_to_redact',
  ])
})

check('notSupportedReason 覆盖后端 10 个取值,不能一律套用扫描件', () => {
  assert.deepEqual([...PII_REDACTION_NOT_SUPPORTED_REASONS], [
    'scanned_no_position',
    'encrypted',
    'too_many_pages',
    'unsupported_format',
    'source_unavailable',
    'render_unverified',
    'output_too_large',
    'redaction_failed',
    'decisions_pending',
    'decision_task_invalid',
  ])
})

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
  notSupportedEncrypted: makeTask({
    ok: false,
    claim: 'not_supported',
    notSupportedReason: 'encrypted',
    redactedFileId: null,
    redactedFileUrl: null,
    items: [],
  }),
  notSupportedUnknownReason: makeTask({
    ok: false,
    claim: 'not_supported',
    notSupportedReason: 'brand_new_reason',
    redactedFileId: null,
    redactedFileUrl: null,
    items: [],
  }),
  nothingDetected: makeTask({
    ok: true,
    claim: 'nothing_to_redact',
    redactedFileId: null,
    redactedFileUrl: null,
    items: [],
    reverify: { ran: false, remainingCount: 0, method: 'skipped' },
  }),
  nothingKeptAll: makeTask({
    ok: true,
    claim: 'nothing_to_redact',
    redactedFileId: null,
    redactedFileUrl: null,
    items: [
      { id: 'a', type: 'phone', pageNumber: 1, requested: 'keep', applied: 'kept' },
    ],
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
check('parse:nothing_to_redact 进入白名单,不降级为无法确认', () => {
  assert.equal(parsed.nothingDetected.claim, 'nothing_to_redact')
  assert.equal(parsed.nothingKeptAll.claim, 'nothing_to_redact')
})

check('claim=redacted_verified → 「已生成遮挡后的文件，打印用的是它」且必须人眼核对', () => {
  const copy = piiRedactionCopy(parsed.verified)
  assert.equal(copy.title, '已生成遮挡后的文件，打印用的是它')
  assert.match(copy.detail, /机器复检没有再读到/)
  assert.equal(copy.requiresPreviewConfirm, true)
  assert.ok(copy.confirmLabel, '必须给出「我核对过」勾选项文案')
  assert.equal(copy.showFallbackOptions, false)
})

check('claim=redacted_unverified → 如实说做出来了但没验证,不能说已验证', () => {
  const copy = piiRedactionCopy(parsed.unverified)
  assert.match(copy.title, /已生成遮挡后的文件/)
  assert.match(copy.title, /复检没有跑成/)
  assert.match(copy.detail, /不能说已经验证/)
  assert.equal(copy.tone, 'warning')
})

check('复检有残留 → 「仍检出 N 处未盖住 · 不建议打印」,覆盖正向 claim', () => {
  const copy = piiRedactionCopy(parsed.remaining)
  assert.match(copy.title, /仍检出 2 处未盖住 · 不建议打印/)
  assert.equal(copy.tone, 'danger')
  assert.equal(copy.requiresPreviewConfirm, true)
})

check('claim=partial → 点名没能定位的处数,不笼统报成功', () => {
  const copy = piiRedactionCopy(parsed.partial)
  assert.match(copy.title, /已遮挡你确认的 2 处/)
  assert.match(copy.title, /另有 1 处没能定位/)
  assert.match(copy.detail, /没能定位的那几处保持原样/)
})

check('claim=not_supported + scanned_no_position → 说清是扫描件,并说明没生成新文件', () => {
  const copy = piiRedactionCopy(parsed.notSupported)
  assert.match(copy.title, /这份是扫描件/)
  assert.equal(copy.showFallbackOptions, true)
  assert.equal(copy.confirmLabel, null)
  assert.equal(copy.requiresPreviewConfirm, false)
  assert.match(copy.detail, /没有生成新文件/)
  assert.match(copy.detail, /打印仍使用原文件/)
})

check('claim=not_supported + encrypted → 不得套用扫描件那句', () => {
  const copy = piiRedactionCopy(parsed.notSupportedEncrypted)
  assert.match(copy.title, /加密/)
  assert.ok(!/扫描件/.test(copy.title), '加密 PDF 不得说成扫描件')
})

check('claim=not_supported + 未知 reason → 不假设是扫描件', () => {
  const copy = piiRedactionCopy(parsed.notSupportedUnknownReason)
  assert.equal(parsed.notSupportedUnknownReason.notSupportedReason, null)
  assert.ok(!/扫描件/.test(copy.title), '未知原因不得说成扫描件')
  assert.match(copy.title, /本机还不能在这份文件上定位遮挡/)
})

check('claim=nothing_to_redact 且零检出 → 说没发现需要遮挡的内容,打印原件', () => {
  const copy = piiRedactionCopy(parsed.nothingDetected)
  assert.equal(copy.title, '没发现需要遮挡的内容')
  assert.match(copy.detail, /打印用的是原文件/)
  assert.match(copy.detail, /没检出不等于没有/)
})

check('claim=nothing_to_redact 且用户全部保留 → 说是本人决定,纸上有完整信息', () => {
  const copy = piiRedactionCopy(parsed.nothingKeptAll)
  assert.equal(copy.title, '你选择了全部保留')
  assert.match(copy.detail, /打印用的是原文件/)
  assert.match(copy.detail, /完整信息/)
})

check('5 个 claim 的标题互不相同,不许一句话盖全', () => {
  const titles = [
    piiRedactionCopy(parsed.verified).title,
    piiRedactionCopy(parsed.unverified).title,
    piiRedactionCopy(parsed.partial).title,
    piiRedactionCopy(parsed.notSupported).title,
    piiRedactionCopy(parsed.nothingDetected).title,
  ]
  assert.equal(new Set(titles).size, 5, `标题撞车: ${titles.join(' | ')}`)
})

check('后端说成功但没有派生件 → 降级为「本机无法确认」(fail-closed)', () => {
  assert.equal(hasUsableRedactedFile(parsed.claimWithoutFile), false)
  const copy = piiRedactionCopy(parsed.claimWithoutFile)
  assert.match(copy.title, /本机无法确认/)
  assert.equal(copy.confirmLabel, null)
  assert.match(copy.detail, /打印仍使用原文件/)
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
  ...over,
})

check('徽标:verified 直说已生成遮挡后的文件、打印用的是它', () => {
  const badge = materialRedactionBadge(summaryOf({}))
  assert.equal(badge.tone, 'success')
  assert.equal(badge.text, '已生成遮挡后的文件，打印用的是它')
})
check('徽标:not_supported 说明打印使用原件', () => {
  const badge = materialRedactionBadge(summaryOf({ claim: 'not_supported', redactedFileId: null }))
  assert.match(badge.text, /打印使用原件/)
})
check('徽标:nothing_to_redact 说没发现需要遮挡的内容', () => {
  const badge = materialRedactionBadge(summaryOf({ claim: 'nothing_to_redact', redactedFileId: null }))
  assert.match(badge.text, /没发现需要遮挡的内容/)
  assert.match(badge.text, /打印使用原件/)
})
check('徽标:unverified 不能说已验证', () => {
  const badge = materialRedactionBadge(summaryOf({ claim: 'redacted_unverified', reverifyRan: false, reverifyRemainingCount: null }))
  assert.match(badge.text, /不能说已验证/)
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
    materialRedactionBadge(summaryOf({ claim: 'nothing_to_redact', redactedFileId: null })),
    materialRedactionBadge(summaryOf({ claim: null })),
  ]
  for (const badge of badges) {
    for (const pattern of FORBIDDEN_CLAIMS) {
      assert.ok(!pattern.test(badge.text), `「${badge.text}」命中 ${pattern}`)
    }
  }
})

// ── 3. 静态:材料检查页按 claim 接线,并改用派生件打印 ─────────────────────────

const pageSrc = read(PAGE)
const pageCode = stripComments(pageSrc)
check('材料检查页通过 parsePiiRedactionResult 读 claim,不自己编结论', () => {
  assert.match(pageSrc, /parsePiiRedactionResult/)
  assert.match(pageSrc, /toMaterialRedactionSummary/)
  assert.match(pageSrc, /printFileAfterRedaction/)
  assert.match(pageSrc, /hasUsableRedactedFile/)
})
check('材料检查页不再把「当前版本不生成新文件」当默认文案', () => {
  assert.ok(!pageCode.includes('当前版本不生成新文件'))
  assert.ok(!pageCode.includes('已完成遮挡产物评估，当前版本不生成新文件'))
})
check('材料检查页保留 main 的诚实预检横幅,不把源分支假文案带回来', () => {
  assert.match(pageCode, /feature="文件预检"/)
  assert.match(pageCode, /检查格式、大小、页数与图片质量/)
  assert.ok(!pageCode.includes('自动检查格式、边距与打印风险'))
  assert.ok(!pageCode.includes('AI文件预检'))
})

const presentationSrc = read('src/pages/print/components/MaterialCheckPresentation.tsx')
check('材料检查呈现层不再声称「尚不生成遮挡后文件」', () => {
  assert.ok(!presentationSrc.includes('尚不生成遮挡后文件'))
  assert.ok(!presentationSrc.includes('当前版本会记录你的保留/遮挡选择并完成遮挡评估，但尚不生成'))
})

// ── 4. 静态:下游页不再自己拼结论 ───────────────────────────────────────────

const LIE_MARKERS = [
  '当前版本尚未生成遮挡后文件',
  '当前版本不生成新文件',
  '当前版本不生成遮挡后文件',
  '尚不生成遮挡后文件',
  'resultFileCreated',
]

for (const relative of [
  'src/pages/print/PrintPreviewPage.tsx',
  'src/pages/print/PrintConfirmPage.tsx',
]) {
  const body = read(relative)
  check(`${relative} 通过 materialRedactionBadge 取结论`, () => {
    assert.match(body, /materialRedactionBadge/)
  })
  check(`${relative} 不再读已废弃的 resultFileCreated,也不再说「当前版本不生成」`, () => {
    for (const marker of LIE_MARKERS) {
      assert.ok(!body.includes(marker), `仍出现「${marker}」`)
    }
  })
}

const sessionSrc = read('src/pages/print/printMaterialSession.ts')
check('会话摘要以 claim 为真值,不再持久化 resultFileCreated', () => {
  assert.match(sessionSrc, /MaterialRedactionSummary/)
  assert.match(sessionSrc, /nothing_to_redact/)
  assert.ok(!sessionSrc.includes('resultFileCreated'))
})

// ── 结果 ────────────────────────────────────────────────────────────────────

if (failures > 0) {
  console.error(`\n❌ ${failures} 项失败 —— 隐私遮挡前端契约门禁未通过\n`)
  process.exit(1)
}
console.log('\n✅ ALL PASS —— 隐私遮挡前端契约门禁通过\n')
