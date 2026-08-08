/**
 * 隐私遮挡结果契约 —— 前端唯一的「这次到底能说什么」判定处。
 *
 * 设计前提(docs/product/pii-redaction-decision-2026-08.md §3.4):
 * **文案由后端 `claim` 决定,前端不许自己编。**
 * 历史缺陷正是靠前端自觉没守住 —— 后端明说 `resultFileCreated:false`(没生成任何文件),
 * 前端照样让用户走完整个遮挡流程并显示「遮挡 N 项」。
 *
 * 因此本模块的三条硬规则:
 *
 * 1. **fail-closed**:`claim` 缺失或取值不认识 → `claim: null`,copy 层给出「本机无法确认」,
 *    绝不退化成任何表示已处理的表述。新增 claim 取值必须同步本文件,否则一律按未知处理。
 * 2. **没有派生件就没有遮挡结论**:`redactedFileId` 为空时,即使 claim 说成功也降级为未知 ——
 *    打印的还是原件,任何「遮挡」表述都是假的。
 * 3. **复检残留优先**:`reverify.remainingCount > 0` 覆盖一切正向 claim。
 *
 * 文案天花板(§3.3):禁止出现「已遮挡」(不带「你确认的 N 处」限定)三类无条件承诺
 * —— 另两类同样禁止出现:「已无隐私信息」、「隐私已保护」。本机没有能力做这个承诺。
 * 由 `scripts/verify-compliance-copy.mjs` + `verify:pii-redaction-contract` 两道门禁把守。
 */
import type { DocumentProcessTaskView } from '../../services/api/materials'
import type { MaterialRedactionSummary } from './printMaterialSession'

export type PiiRedactionClaim =
  | 'redacted_verified'
  | 'redacted_unverified'
  | 'partial'
  | 'not_supported'

export type PiiRedactionApplied = 'redacted' | 'kept' | 'failed_no_position'
export type PiiRedactionRequested = 'redact' | 'keep'
export type PiiRedactionNotSupportedReason = 'scanned_no_position' | 'encrypted' | 'too_many_pages'
export type PiiReverifyMethod = 'text_layer' | 'ocr' | 'skipped'

export interface PiiRedactionItem {
  id: string
  type: string
  pageNumber: number | null
  requested: PiiRedactionRequested
  applied: PiiRedactionApplied
}

export interface PiiRedactionReverify {
  ran: boolean
  /** null = 后端没给出数字,不等于 0。不允许当作「干净」。 */
  remainingCount: number | null
  method: PiiReverifyMethod | null
}

export interface PiiRedactionResult {
  ok: boolean
  /** null = 后端未给出可识别的 claim。前端此时不做任何遮挡结论。 */
  claim: PiiRedactionClaim | null
  /** 后端原样返回的 claim 字符串,仅用于排查,不参与文案。 */
  rawClaim: string | null
  redactedFileId: string | null
  /**
   * 派生件可嵌入预览 / 打印的短期 URL。
   * 后端契约字段:`checks.redactedFileUrl`。匿名一体机用户拿不到 `/files/:id/preview-url`
   * (该端点要求登录),所以派生件 URL 必须由 pii_redact 任务结果直接带出,
   * 否则前端只能 fail-closed 拒绝声称遮挡(见 hasUsableRedactedFile)。
   */
  redactedFileUrl: string | null
  items: PiiRedactionItem[]
  reverify: PiiRedactionReverify
  notSupportedReason: PiiRedactionNotSupportedReason | null
}

const CLAIMS: readonly string[] = ['redacted_verified', 'redacted_unverified', 'partial', 'not_supported']
const APPLIED: readonly string[] = ['redacted', 'kept', 'failed_no_position']
const NOT_SUPPORTED_REASONS: readonly string[] = ['scanned_no_position', 'encrypted', 'too_many_pages']
const REVERIFY_METHODS: readonly string[] = ['text_layer', 'ocr', 'skipped']

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function optionalCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null
}

function parseItems(value: unknown): PiiRedactionItem[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((raw, index) => {
    if (!isRecord(raw)) return []
    const applied = typeof raw['applied'] === 'string' && APPLIED.includes(raw['applied'])
      ? (raw['applied'] as PiiRedactionApplied)
      : null
    if (!applied) return []
    return [{
      id: optionalString(raw['id']) ?? `pii-item-${index}`,
      type: optionalString(raw['type']) ?? 'unknown',
      pageNumber: optionalCount(raw['pageNumber']),
      requested: raw['requested'] === 'keep' ? 'keep' : 'redact',
      applied,
    }]
  })
}

/**
 * 从 pii_redact 任务里取遮挡结论。
 *
 * 后端可能把契约放在 `result.checks`(既有材料任务惯例)或 `result` 顶层,两处都读;
 * 两处都没有 `claim` 时返回 `claim: null`(fail-closed),而不是猜一个成功态。
 */
export function parsePiiRedactionResult(task: DocumentProcessTaskView | null): PiiRedactionResult | null {
  if (!task) return null
  const result = isRecord(task.result) ? task.result : null
  if (!result) return null
  const checks = isRecord(result['checks']) ? result['checks'] : null
  const read = (key: string): unknown => (checks && key in checks ? checks[key] : result[key])

  const rawClaim = optionalString(read('claim'))
  const claim = rawClaim && CLAIMS.includes(rawClaim) ? (rawClaim as PiiRedactionClaim) : null
  const reverifyRaw = read('reverify')
  const reverify = isRecord(reverifyRaw) ? reverifyRaw : {}
  const reverifyMethod = optionalString(reverify['method'])

  return {
    ok: read('ok') === true,
    claim,
    rawClaim,
    redactedFileId: optionalString(read('redactedFileId')) ?? optionalString(task.resultFileId),
    redactedFileUrl: optionalString(read('redactedFileUrl')),
    items: parseItems(read('items')),
    reverify: {
      ran: reverify['ran'] === true,
      remainingCount: optionalCount(reverify['remainingCount']),
      method: reverifyMethod && REVERIFY_METHODS.includes(reverifyMethod)
        ? (reverifyMethod as PiiReverifyMethod)
        : null,
    },
    notSupportedReason: (() => {
      const reason = optionalString(read('notSupportedReason'))
      return reason && NOT_SUPPORTED_REASONS.includes(reason)
        ? (reason as PiiRedactionNotSupportedReason)
        : null
    })(),
  }
}

/** 有派生件 + 有可用 URL 才谈得上「遮挡后的文件」;缺一样,打印的就还是原件。 */
export function hasUsableRedactedFile(result: PiiRedactionResult | null): boolean {
  return Boolean(result?.redactedFileId && result.redactedFileUrl)
}

export function countByApplied(items: readonly PiiRedactionItem[], applied: PiiRedactionApplied): number {
  return items.filter((item) => item.applied === applied).length
}

// ── claim → 文案 ──────────────────────────────────────────────────────────────

export type PiiRedactionTone = 'success' | 'warning' | 'danger'

export interface PiiRedactionCopy {
  tone: PiiRedactionTone
  title: string
  detail: string
  /** true = 必须先看原尺寸预览再确认;这一步不提供跳过入口(§四 第 3 步)。 */
  requiresPreviewConfirm: boolean
  /** 人眼确认勾选项文案;null = 本状态没有可确认的遮挡结果。 */
  confirmLabel: string | null
  /** 通过人眼确认后主按钮文案。 */
  continueLabel: string
  /** true = 本机做不到,展示三条出路而不是遮挡结论。 */
  showFallbackOptions: boolean
}

/**
 * 「本机做不到」时给用户的三条真实出路(§五)。
 * 不写「稍后重试」——重试也不会有结果,那是假出路。
 */
export const PII_REDACTION_FALLBACKS: readonly string[] = [
  '用手机把证件号涂掉或打码，改好后重新上传',
  '不做遮挡直接打印 —— 需要你确认打印出来的纸上是完整信息',
  '换一份文字版简历（Word 导出或在线简历导出的 PDF）再试一次',
]

function notSupportedTitle(reason: PiiRedactionNotSupportedReason | null): string {
  if (reason === 'encrypted') return '这份 PDF 带了加密保护，本机读不到它的文字位置'
  if (reason === 'too_many_pages') return '这份文件页数超出本机可处理范围，定位不了要遮挡的位置'
  return '这份是扫描件，本机还不能在上面定位遮挡'
}

/**
 * claim → 允许说的话。这是本功能唯一的文案出口:
 * 页面组件只渲染这里返回的字符串,禁止出现第二处自行拼装的遮挡结论。
 */
export function piiRedactionCopy(result: PiiRedactionResult | null): PiiRedactionCopy {
  const unknown: PiiRedactionCopy = {
    tone: 'danger',
    title: '本机无法确认这次遮挡的结果',
    detail: '服务端没有返回可识别的处理结论。为避免误导，这里不给出任何遮挡结论 —— 请按下面的方式处理，或返回重新选择。',
    requiresPreviewConfirm: false,
    confirmLabel: null,
    continueLabel: '返回重新选择',
    showFallbackOptions: true,
  }
  if (!result || !result.claim) return unknown

  if (result.claim === 'not_supported') {
    return {
      tone: 'warning',
      title: notSupportedTitle(result.notSupportedReason),
      detail: '本机没有生成任何新文件，你上传的原件没有改动。可以按下面三种方式之一继续。',
      requiresPreviewConfirm: false,
      confirmLabel: null,
      continueLabel: '返回重新选择',
      showFallbackOptions: true,
    }
  }

  // 没有可用派生件就没有遮挡结论 —— 打印的还是原件。
  if (!hasUsableRedactedFile(result)) return unknown

  const redacted = countByApplied(result.items, 'redacted')
  const failed = countByApplied(result.items, 'failed_no_position')
  const remaining = result.reverify.remainingCount

  // 复检查出残留:优先级最高,盖歪了比没盖更容易让人放心地把纸拿走。
  if (remaining !== null && remaining > 0) {
    return {
      tone: 'danger',
      title: `仍检出 ${remaining} 处未盖住 · 不建议打印`,
      detail: '在遮挡后的文件上重新扫描，仍然读得到这些内容，说明黑条没盖准。请返回重新选择，或换一份文字版简历。',
      requiresPreviewConfirm: true,
      confirmLabel: `我已逐页看过预览，知道还有 ${remaining} 处未盖住，仍要打印`,
      continueLabel: '仍要打印',
      showFallbackOptions: false,
    }
  }

  if (result.claim === 'partial') {
    return {
      tone: 'warning',
      title: `已遮挡你确认的 ${redacted} 处 · 另有 ${failed} 处没能定位`,
      detail: '没能定位的那几处保持原样，已在下面单独列出。请在预览里确认它们出现在纸上是否可以接受。',
      requiresPreviewConfirm: true,
      confirmLabel: '我已逐页看过预览，确认可以打印',
      continueLabel: '确认并继续打印设置',
      showFallbackOptions: false,
    }
  }

  if (result.claim === 'redacted_unverified') {
    return {
      tone: 'warning',
      title: `已遮挡你确认的 ${redacted} 处 · 请核对预览`,
      detail: '这次机器复检没有跑成，本机无法判断黑条是否盖准，只能靠你逐页核对。',
      requiresPreviewConfirm: true,
      confirmLabel: '我已逐页看过预览，确认可以打印',
      continueLabel: '确认并继续打印设置',
      showFallbackOptions: false,
    }
  }

  return {
    tone: 'success',
    title: `已遮挡你确认的 ${redacted} 处 · 请核对预览`,
    detail: '机器复检没有再读到这几处。复检只能确认「盖住的地方盖住了」，不能证明文件里没有别的隐私信息 —— 漏检的内容复检同样看不见，所以还要你自己看一遍。',
    requiresPreviewConfirm: true,
    confirmLabel: '我已逐页看过预览，确认可以打印',
    continueLabel: '确认并继续打印设置',
    showFallbackOptions: false,
  }
}

/**
 * 机器复检的如实说明。
 * 关键口径(§3.3):复检通过 ≠ 干净,只等于「我盖的地方盖住了」。
 * 同一个检测器扫两遍,系统性漏检两遍都漏 —— 这句必须写在用户能看见的地方。
 */
export function piiReverifyNote(result: PiiRedactionResult | null): string {
  if (!result) return '本机没有拿到复检结果。'
  if (!result.reverify.ran) return '这次没有跑机器复检，本机无法判断黑条是否盖准，只能靠你逐页核对。'
  const method = result.reverify.method === 'ocr'
    ? '用 OCR 重新识别了一遍'
    : result.reverify.method === 'text_layer'
      ? '重新读了一遍文字层'
      : '重新扫了一遍'
  const remaining = result.reverify.remainingCount
  if (remaining === null) return `复检${method}，但没有返回残留数量，本机不据此下结论。`
  if (remaining > 0) return `复检${method}，仍然读得到 ${remaining} 处，说明黑条没盖准。`
  return `复检${method}，没有再读到这几处。复检只能发现「盖错位置」，发现不了「压根没检出」—— 漏掉的内容复检同样看不见。`
}

// ── 下游打印页的结论徽标 ────────────────────────────────────────────────────

/**
 * 打印预览 / 参数 / 确认页统一读这里,禁止各页自己按 findings 数量再编一句「遮挡 N 项」。
 * 返回 null = 本次没有遮挡结论可说(没检出、或用户全部选择保留)。
 */
export function materialRedactionBadge(
  summary: MaterialRedactionSummary | undefined,
): { text: string; tone: PiiRedactionTone } | null {
  if (!summary) return null
  if (summary.unredactedAcknowledgedAt) {
    return { text: '你已确认不做遮挡 · 打印的是原件，纸上是完整信息', tone: 'danger' }
  }
  if (summary.claim === 'not_supported') {
    return { text: '本机未能在这份文件上定位遮挡 · 打印使用原件', tone: 'warning' }
  }
  if (!summary.claim || !summary.redactedFileId) {
    return { text: '本机未确认遮挡结果 · 打印使用原件', tone: 'danger' }
  }
  if (!summary.previewConfirmedAt) {
    return { text: '遮挡结果尚未经你核对 · 请返回核对后再打印', tone: 'danger' }
  }
  const remaining = summary.reverifyRemainingCount
  if (remaining !== null && remaining > 0) {
    return { text: `仍检出 ${remaining} 处未盖住 · 不建议打印`, tone: 'danger' }
  }
  if (summary.claim === 'partial') {
    return {
      text: `已遮挡你确认的 ${summary.appliedRedactedCount} 处 · 另有 ${summary.failedNoPositionCount} 处没能定位`,
      tone: 'warning',
    }
  }
  if (summary.claim === 'redacted_unverified') {
    return { text: `已遮挡你确认的 ${summary.appliedRedactedCount} 处 · 机器复检未跑成`, tone: 'warning' }
  }
  return { text: `已遮挡你确认的 ${summary.appliedRedactedCount} 处 · 你已核对预览`, tone: 'success' }
}

// ── 逐页索引 ─────────────────────────────────────────────────────────────────

export interface PiiRedactionPageGroup {
  pageNumber: number | null
  redacted: readonly string[]
  failed: readonly string[]
  kept: readonly string[]
}

const TYPE_LABELS: Record<string, string> = {
  id_card: '身份证号',
  phone: '手机号',
  bank_card: '银行卡号',
  address: '住址',
  email: '邮箱',
  name: '姓名',
}

export function piiTypeLabel(type: string): string {
  return TYPE_LABELS[type] ?? '敏感信息'
}

/** 按页聚合,给用户「第几页该看哪里」的索引。没有坐标就不画覆盖层,只给页码指引。 */
export function groupItemsByPage(items: readonly PiiRedactionItem[]): PiiRedactionPageGroup[] {
  const map = new Map<number | null, { redacted: string[]; failed: string[]; kept: string[] }>()
  for (const item of items) {
    const bucket = map.get(item.pageNumber) ?? { redacted: [], failed: [], kept: [] }
    const label = piiTypeLabel(item.type)
    if (item.applied === 'redacted') bucket.redacted.push(label)
    else if (item.applied === 'failed_no_position') bucket.failed.push(label)
    else bucket.kept.push(label)
    map.set(item.pageNumber, bucket)
  }
  return [...map.entries()]
    .sort((a, b) => (a[0] ?? Number.MAX_SAFE_INTEGER) - (b[0] ?? Number.MAX_SAFE_INTEGER))
    .map(([pageNumber, bucket]) => ({ pageNumber, ...bucket }))
}
