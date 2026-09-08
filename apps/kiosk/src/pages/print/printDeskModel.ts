import type { MaterialCheckSummary, PrintFileState } from './printMaterialSession'

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

export function isPrintDeskPreviewAuthorized(
  materialCheck: MaterialCheckSummary | undefined,
  file: PrintFileState | undefined,
): boolean {
  if (!file) return false
  const tasksComplete = Boolean(
    materialCheck?.inspectionTaskId &&
    materialCheck.piiTaskId &&
    materialCheck.piiRedactTaskId,
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
