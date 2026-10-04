import type { MaterialCheckSummary, PrintFileState } from './printMaterialSession'
import type { DocumentProcessTaskView } from '../../services/api/materials'
import type { PrintHandoffContext } from './printHandoff'

export type PrintDeskStep = 'check' | 'preview'

export type PrivacyPreviewGate =
  | { kind: 'ready'; confirmationLabel: null }
  | { kind: 'confirm'; confirmationLabel: string }
  | { kind: 'blocked'; confirmationLabel: null }

export function parsePrintDeskStep(raw: string | null): PrintDeskStep | null {
  if (raw === 'check' || raw === 'preview') return raw
  return null
}

export function privacyPreviewGate(
  materialCheck: MaterialCheckSummary | undefined,
  file: PrintFileState,
): PrivacyPreviewGate {
  const redaction = materialCheck?.redaction
  if (!redaction?.claim) return { kind: 'blocked', confirmationLabel: null }

  if (redaction.claim === 'nothing_to_redact') {
    return { kind: 'ready', confirmationLabel: null }
  }

  if (redaction.claim === 'not_supported') {
    return redaction.unredactedAcknowledgedAt
      ? { kind: 'ready', confirmationLabel: null }
      : {
          kind: 'confirm',
          confirmationLabel: '我已逐页核对预览，知道本机没有生成遮挡文件，仍确认使用原文件',
        }
  }

  const isUsingDerivedFile = Boolean(redaction.redactedFileId && file.fileId === redaction.redactedFileId)
  if (!isUsingDerivedFile) return { kind: 'blocked', confirmationLabel: null }
  if (redaction.previewConfirmedAt) return { kind: 'ready', confirmationLabel: null }

  const remaining = redaction.reverifyRemainingCount
  if (remaining !== null && remaining > 0) {
    return {
      kind: 'confirm',
      confirmationLabel: `我已逐页核对预览，知道仍检出 ${remaining} 处未盖住，仍确认继续`,
    }
  }
  if (redaction.claim === 'partial') {
    return {
      kind: 'confirm',
      confirmationLabel: '我已逐页核对预览，知道有片段未能定位，仍确认继续',
    }
  }
  if (redaction.claim === 'redacted_unverified') {
    return {
      kind: 'confirm',
      confirmationLabel: '我已逐页核对预览，知道机器复检未完成，仍确认继续',
    }
  }
  return {
    kind: 'confirm',
    confirmationLabel: '我已逐页核对遮挡后的文件，确认可以继续',
  }
}

/** 文字识别没覆盖时，用户确认按原件继续。不编造遮挡任务编号。 */
export function manualOriginalPrintCheck(input: {
  inspectionTaskId: string
  normalizeTaskId?: string
  piiTaskId: string
  findingCount: number
  acknowledgedAt: string
}): MaterialCheckSummary {
  return {
    inspectionTaskId: input.inspectionTaskId,
    ...(input.normalizeTaskId ? { normalizeTaskId: input.normalizeTaskId } : {}),
    piiTaskId: input.piiTaskId,
    checkedAt: input.acknowledgedAt,
    findingCount: input.findingCount,
    redactedCount: 0,
    keptCount: input.findingCount,
    mode: 'checked',
    redaction: {
      claim: 'not_supported',
      redactedFileId: null,
      appliedRedactedCount: 0,
      failedNoPositionCount: 0,
      keptCount: input.findingCount,
      reverifyRemainingCount: null,
      reverifyRan: false,
      unredactedAcknowledgedAt: input.acknowledgedAt,
    },
  }
}

function acknowledgedOriginal(materialCheck: MaterialCheckSummary | undefined): boolean {
  const at = materialCheck?.redaction?.unredactedAcknowledgedAt
  return materialCheck?.redaction?.claim === 'not_supported'
    && typeof at === 'string'
    && at.trim().length > 0
}

export function isPrintDeskPreviewAuthorized(
  materialCheck: MaterialCheckSummary | undefined,
  file: PrintFileState | undefined,
): boolean {
  if (!file) return false
  const tasksComplete = Boolean(
    materialCheck?.inspectionTaskId &&
    materialCheck.piiTaskId &&
    (materialCheck.piiRedactTaskId || acknowledgedOriginal(materialCheck)),
  )
  if (!tasksComplete) return false
  return privacyPreviewGate(materialCheck, file).kind !== 'blocked'
}

/**
 * URL `?step=` 是意图，不是授权。
 * 请求 preview 时仍渲染预览页：预览页自己的 check-required 守卫负责拦下跳过检查。
 * 没有 step 时从 session 复水：检查已过就回 preview，否则回 check。
 */
export function resolvePrintDeskView(args: {
  requested: PrintDeskStep | null
  previewAuthorized: boolean
}): PrintDeskStep {
  if (args.requested === 'preview') return 'preview'
  if (args.requested === 'check') return 'check'
  return args.previewAuthorized ? 'preview' : 'check'
}

/** 数量来自材料检查保存的真实命中与裁决，不把“选择保留”说成“没有命中”。 */
export function printPrivacyDecisionSummary(check: MaterialCheckSummary): string {
  const { findingCount: total, redactedCount: redacted, keptCount: kept } = check
  if (![total, redacted, kept].every((n) => Number.isSafeInteger(n) && n >= 0) || redacted + kept !== total) {
    return '隐私检查结果以材料检查页为准'
  }
  if (total === 0 && check.redaction?.claim === 'not_supported') return '隐私检查结果以材料检查页为准'
  if (total === 0) return '没发现需要遮挡的内容'
  if (redacted === 0) return `发现 ${total} 处个人信息，你选择了全部保留，原样打印。`
  return `发现 ${total} 处个人信息，遮挡 ${redacted} 处，保留 ${kept} 处。`
}

interface CheckResult {
  inspection: DocumentProcessTaskView
  normalize: DocumentProcessTaskView
  pii: DocumentProcessTaskView
  session: PrintHandoffContext
}
// 编号与文件共同隔离这一轮；只保留在途 Promise，结束后仍由交接上下文负责复水。
const checksInFlight = new Map<string, Promise<CheckResult>>()

export function shareMaterialChecks(key: string, run: () => Promise<CheckResult>): Promise<CheckResult> {
  const existing = checksInFlight.get(key)
  if (existing) return existing
  const request = run().finally(() => {
    if (checksInFlight.get(key) === request) checksInFlight.delete(key)
  })
  checksInFlight.set(key, request)
  return request
}
