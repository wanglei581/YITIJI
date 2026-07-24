import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Button } from '@ai-job-print/ui'
import { AlertCircleIcon } from 'lucide-react'
import { useAuth } from '../../auth/useAuth'
import { useBusyLock } from '../../contexts/KioskBusyContext'
import { ApiHttpError } from '../../services/api/httpAdapter'
import {
  createMaterialTask,
  decidePiiFindings,
  getMaterialTask,
  type DocumentProcessTaskView,
  type PiiFindingAction,
  type PiiFindingDecisionAction,
  type PiiFindingView,
} from '../../services/api/materials'
import {
  clearPrintMaterialSession,
  patchPrintMaterialSession,
  printUploadPathForSource,
  readPrintMaterialSession,
  type MaterialCheckSummary,
  type PrintMaterialSource,
  type PrintFileState,
  type PrintMaterialSession,
} from './printMaterialSession'
import { PrintPrototypeHeader } from './PrintPrototypeLayout'
import {
  MaterialCheckPresentation,
  type MaterialCheckStage,
} from './components/MaterialCheckPresentation'

interface LocationState {
  file?: PrintFileState
  source?: PrintMaterialSource
}

type InspectionMessageSeverity = 'info' | 'warning'
const TASK_POLL_ATTEMPTS = 30
const TASK_POLL_INTERVAL_MS = 1_000

interface InspectionSummaryView {
  pageCount: number | null
  canPrint: boolean | null
  messages: Array<{ code: string; severity: InspectionMessageSeverity; text: string }>
}

interface NormalizeA4SummaryView {
  targetPaperSize: string
  canNormalize: boolean | null
  messages: Array<{ code: string; severity: InspectionMessageSeverity; text: string }>
}

interface PiiRedactionSummaryView {
  canRedact: boolean
  redactedFileId: string | null
  resultFileCreated: boolean
  message: string
}

function isPendingStatus(task: DocumentProcessTaskView): boolean {
  return task.status === 'pending' || task.status === 'processing'
}

async function waitForCompletedTask(
  task: DocumentProcessTaskView,
  token: string | null,
  accessToken = task.accessToken,
): Promise<DocumentProcessTaskView> {
  let current = task
  for (let attempt = 0; attempt < TASK_POLL_ATTEMPTS && isPendingStatus(current); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, TASK_POLL_INTERVAL_MS))
    const next = await getMaterialTask(current.id, { token, accessToken })
    current = { ...next, accessToken: next.accessToken ?? accessToken }
  }
  return current
}

function assertTaskReady(task: DocumentProcessTaskView, label: string): void {
  if (task.status === 'completed') return
  if (task.status === 'failed') {
    throw new Error(task.errorMessage || `${label}失败，请重试`)
  }
  throw new Error(`${label}仍在处理中，请稍后重试`)
}

function pageCountFromInspection(task: DocumentProcessTaskView): number | null {
  const checks = task.result?.['checks']
  if (!checks || typeof checks !== 'object' || Array.isArray(checks)) return null
  const pageCount = (checks as Record<string, unknown>)['pageCount']
  if (typeof pageCount !== 'number' || !Number.isInteger(pageCount)) return null
  return pageCount > 0 && pageCount <= 2000 ? pageCount : null
}

function applyDetectedPageCount(file: PrintFileState, inspection: DocumentProcessTaskView): PrintFileState {
  const pageCount = pageCountFromInspection(inspection)
  if (!pageCount || file.pages === pageCount) return file
  return { ...file, pages: pageCount }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function inspectionSummaryFromTask(task: DocumentProcessTaskView | null): InspectionSummaryView | null {
  const checks = task?.result?.['checks']
  if (!isRecord(checks)) return null
  const pageCount = task ? pageCountFromInspection(task) : null
  const canPrint = typeof checks['canPrint'] === 'boolean' ? checks['canPrint'] : null
  const messages = normalizeInspectionMessages(checks)
  return { pageCount, canPrint, messages }
}

function normalizeA4SummaryFromTask(task: DocumentProcessTaskView | null): NormalizeA4SummaryView | null {
  const checks = task?.result?.['checks']
  if (!isRecord(checks)) return null
  const targetPaperSize = typeof checks['targetPaperSize'] === 'string' ? checks['targetPaperSize'] : 'A4'
  const canNormalize = typeof checks['canNormalize'] === 'boolean' ? checks['canNormalize'] : null
  const messages = normalizeInspectionMessages(checks)
  return { targetPaperSize, canNormalize, messages }
}

function piiRedactionSummaryFromTask(task: DocumentProcessTaskView | null): PiiRedactionSummaryView | null {
  const checks = task?.result?.['checks']
  if (!isRecord(checks)) return null
  const messages = normalizeInspectionMessages(checks)
  return {
    canRedact: checks['canRedact'] === true,
    redactedFileId: typeof checks['redactedFileId'] === 'string' ? checks['redactedFileId'] : null,
    resultFileCreated: checks['resultFileCreated'] === true,
    message: messages[0]?.text ?? '已完成遮挡产物评估，当前版本不生成新文件，打印仍使用原文件',
  }
}

function normalizeInspectionMessages(checks: Record<string, unknown>): InspectionSummaryView['messages'] {
  const rawMessages = Array.isArray(checks['messages']) ? checks['messages'] : []
  const messages = rawMessages.flatMap((item) => {
    if (!isRecord(item) || typeof item['text'] !== 'string') return []
    const severity: InspectionMessageSeverity = item['severity'] === 'warning' ? 'warning' : 'info'
    return [{
      code: typeof item['code'] === 'string' ? item['code'] : 'INSPECTION_MESSAGE',
      severity,
      text: item['text'],
    }]
  })
  if (messages.length > 0) return messages.slice(0, 3)

  const warnings = Array.isArray(checks['warnings']) ? checks['warnings'].filter((item): item is string => typeof item === 'string') : []
  if (warnings.length > 0) {
    return warnings.slice(0, 3).map((code) => ({
      code,
      severity: 'warning',
      text: inspectionWarningText(code),
    }))
  }
  return []
}

function inspectionWarningText(code: string): string {
  if (code === 'PDF_PAGE_COUNT_NOT_DETECTED') return '暂未识别 PDF 页数，以实际打印为准'
  if (code === 'SOURCE_FILE_BYTES_UNAVAILABLE') return '暂未读取到文件内容，以实际打印为准'
  if (code === 'PRINT_MIME_UNSUPPORTED') return '当前文件格式暂不支持打印前体检'
  return '材料体检存在提示，请继续核对打印参数'
}

function maskSnippet(type: string, snippet: string | null): string {
  if (!snippet) return '未提供片段'
  const value = snippet.trim()
  if (!value) return '未提供片段'
  if (type === 'phone') return value.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2')
  if (type === 'email') {
    const [name, domain] = value.split('@')
    if (!name || !domain) return value
    const first = name.slice(0, 1)
    return `${first}***@${domain}`
  }
  if (value.length <= 4) return `${value.slice(0, 1)}**`
  return `${value.slice(0, 2)}***${value.slice(-2)}`
}

function suggestionForFinding(finding: PiiFindingView): string {
  if (riskLevelForFinding(finding) === 'high') return '建议遮挡后再打印'
  if (riskLevelForFinding(finding) === 'medium') return '建议确认是否需要遮挡'
  return '按材料用途确认保留或遮挡'
}

function riskLevelForFinding(finding: PiiFindingView): 'high' | 'medium' | 'low' {
  if (finding.type.includes('id') || finding.type.includes('address')) return 'high'
  if (finding.type === 'phone' || finding.type === 'email') return 'medium'
  return 'low'
}

function countDecisions(decisions: Record<string, PiiFindingAction>): { keptCount: number; redactedCount: number } {
  return Object.values(decisions).reduce(
    (acc, action) => ({
      keptCount: acc.keptCount + (action === 'keep' ? 1 : 0),
      redactedCount: acc.redactedCount + (action === 'redact' ? 1 : 0),
    }),
    { keptCount: 0, redactedCount: 0 },
  )
}

function isDemoTask(task: DocumentProcessTaskView | null): boolean {
  const mode = task?.result?.['mode']
  return mode === 'mock' || mode === 'skeleton'
}

/**
 * pii_scan 完成后的诚实结果态文案。
 * 后端 mode 取值（见 materials.service.ts / pii-scan.util.ts）：
 * - 'real'：真实扫描完成且覆盖了文档全部页面，命中结果走 findings 列表展示，这里不需要额外文案。
 * - 'partial'：扫描版 PDF 页数超过 OCR 页数上限，只扫描了前 N 页（共 M 页），即使 0 命中也
 *   不能当作"已确认无风险"，必须诚实提示人工确认剩余页面。
 * - 'skipped_non_document'：历史遗留态，contentCategory=photo 跳过口子已在服务端移除；仅为兼容
 *   修复上线前、TASK_TTL_HOURS 窗口内可能仍被读取到的存量任务而保留此文案分支。
 * - 'degraded'：本该真实扫描但 OCR 不可用/失败，诚实告知需人工确认，不是"演示"。
 * - 'unsupported_format'：该文件格式完全没有内容提取路径（如旧版 .doc），诚实告知，不是"演示"。
 * - 其余未知取值一律 fail-closed 显示警告：旧后端在 TASK_TTL_HOURS 窗口内的存量任务
 *   （如历史 'simulated'）或未来新增 mode，都不允许静默呈现为"真实扫描完成"。
 *   'mock'/'skeleton' 例外——它们由 isDemoTask 的"流程演示"徽标单独诚实标注。
 */
function piiScanModeCopy(task: DocumentProcessTaskView | null): { label: string; tone: 'neutral' | 'warning' } | null {
  const mode = task?.result?.['mode']
  if (mode === 'skipped_non_document') return { label: '该文件类型无需隐私扫描', tone: 'neutral' }
  if (mode === 'degraded') return { label: '内容扫描暂不可用，请人工确认文件不含敏感信息', tone: 'warning' }
  if (mode === 'unsupported_format') return { label: '该文件格式暂不支持内容扫描，请人工确认文件不含敏感信息', tone: 'warning' }
  if (mode === 'partial') {
    const scannedPages = task?.result?.['scannedPages']
    const totalPages = task?.result?.['totalPages']
    const scannedLabel = typeof scannedPages === 'number' ? scannedPages : '部分'
    const totalLabel = typeof totalPages === 'number' ? totalPages : '全部'
    return {
      label: `本次仅检查了前 ${scannedLabel} 页（共 ${totalLabel} 页），请人工确认其余页面不含敏感信息`,
      tone: 'warning',
    }
  }
  if (mode === 'real') return null
  if (isDemoTask(task)) return null
  return { label: '本次隐私检查结果状态未知，请人工确认文件不含敏感信息', tone: 'warning' }
}

export function PrintMaterialCheckPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { getToken } = useAuth()
  const state = location.state as LocationState | null
  const [session, setSession] = useState<PrintMaterialSession | null>(() => readPrintMaterialSession())
  const stateFile = state?.file
  const sessionFile = session?.file
  const file = sessionFile?.fileId && stateFile?.fileId && sessionFile.fileId === stateFile.fileId
    ? { ...stateFile, ...sessionFile }
    : stateFile ?? sessionFile
  const source = state?.source ?? session?.source
  const uploadPath = printUploadPathForSource(source)

  const [stage, setStage] = useState<MaterialCheckStage>('idle')
  const [inspectionTask, setInspectionTask] = useState<DocumentProcessTaskView | null>(null)
  const [normalizeTask, setNormalizeTask] = useState<DocumentProcessTaskView | null>(null)
  const [piiTask, setPiiTask] = useState<DocumentProcessTaskView | null>(null)
  const [decisions, setDecisions] = useState<Record<string, PiiFindingAction>>({})
  const [error, setError] = useState<string | null>(null)

  useBusyLock(Boolean(file))

  const findings = piiTask?.piiFindings ?? []
  const allDecided = findings.every((finding) => decisions[finding.id] === 'keep' || decisions[finding.id] === 'redact')
  const decisionCounts = useMemo(() => countDecisions(decisions), [decisions])
  const inspectionSummary = useMemo(() => inspectionSummaryFromTask(inspectionTask), [inspectionTask])
  const normalizeSummary = useMemo(() => normalizeA4SummaryFromTask(normalizeTask), [normalizeTask])
  const requiresFormatReview = inspectionSummary?.canPrint === false
  const piiModeCopy = useMemo(() => piiScanModeCopy(piiTask), [piiTask])
  const canContinue = stage === 'review' && allDecided && !requiresFormatReview
  const isWorking = stage === 'inspection' || stage === 'normalize_a4' || stage === 'pii_scan' || stage === 'submitting'
  const presentationFindings = findings.map((finding) => ({
    id: finding.id,
    label: finding.label || finding.type,
    maskedSnippet: maskSnippet(finding.type, finding.snippet),
    suggestion: suggestionForFinding(finding),
    risk: riskLevelForFinding(finding),
    selected: decisions[finding.id] ?? 'pending',
  }))

  const persistSession = (patch: Partial<Omit<PrintMaterialSession, 'updatedAt'>>) => {
    const nextFile = patch.file ?? file
    if (!nextFile) return null
    const next = patchPrintMaterialSession({ ...patch, file: nextFile })
    setSession(next)
    return next
  }

  const clearStaleSession = () => {
    clearPrintMaterialSession()
    setSession(null)
  }

  const runChecks = async () => {
    if (!file?.fileId) {
      setStage('error')
      setError('缺少上传文件编号，请重新上传后再检查')
      return
    }

    setStage('inspection')
    setError(null)
    setInspectionTask(null)
    setNormalizeTask(null)
    setPiiTask(null)
    setDecisions({})

    try {
      const token = getToken()
      const storedSession = session?.file.fileId === file.fileId ? session : null
      const storedInspection = storedSession?.inspectionTask
      let inspection: DocumentProcessTaskView
      if (storedInspection?.id) {
        const queried = await getMaterialTask(storedInspection.id, { token, accessToken: storedInspection.accessToken })
        inspection = { ...queried, accessToken: queried.accessToken ?? storedInspection.accessToken }
      } else {
        inspection = await createMaterialTask({
          kind: 'inspection',
          sourceFileId: file.fileId,
          params: { expectedPaperSize: 'A4', source: 'kiosk_print' },
        }, token)
      }
      persistSession({ inspectionTask: inspection })
      const readyInspection = await waitForCompletedTask(inspection, token, inspection.accessToken)
      assertTaskReady(readyInspection, '文件体检')
      const checkedFile = applyDetectedPageCount(file, readyInspection)
      setInspectionTask(readyInspection)
      persistSession({ file: checkedFile, inspectionTask: readyInspection })

      setStage('normalize_a4')
      const storedNormalize = storedSession?.normalizeTask
      let normalize: DocumentProcessTaskView
      if (storedNormalize?.id) {
        const queried = await getMaterialTask(storedNormalize.id, { token, accessToken: storedNormalize.accessToken })
        normalize = { ...queried, accessToken: queried.accessToken ?? storedNormalize.accessToken }
      } else {
        normalize = await createMaterialTask({
          kind: 'normalize_a4',
          sourceFileId: file.fileId,
          params: { targetPaperSize: 'A4', source: 'kiosk_print' },
        }, token)
      }
      persistSession({ file: checkedFile, inspectionTask: readyInspection, normalizeTask: normalize })
      const readyNormalize = await waitForCompletedTask(normalize, token, normalize.accessToken)
      assertTaskReady(readyNormalize, 'A4 规范化评估')
      setNormalizeTask(readyNormalize)
      persistSession({ file: checkedFile, inspectionTask: readyInspection, normalizeTask: readyNormalize })

      setStage('pii_scan')
      const storedPii = storedSession?.piiTask
      let pii: DocumentProcessTaskView
      if (storedPii?.id) {
        const queried = await getMaterialTask(storedPii.id, { token, accessToken: storedPii.accessToken })
        pii = { ...queried, accessToken: queried.accessToken ?? storedPii.accessToken }
      } else {
        pii = await createMaterialTask({
          kind: 'pii_scan',
          sourceFileId: file.fileId,
          params: {
            scanScope: 'print_preview',
            ...(session?.contentCategory ? { contentCategory: session.contentCategory } : {}),
          },
        }, token)
      }
      persistSession({ file: checkedFile, inspectionTask: readyInspection, normalizeTask: readyNormalize, piiTask: pii })
      const readyPii = await waitForCompletedTask(pii, token, pii.accessToken)
      assertTaskReady(readyPii, '隐私检查')
      setPiiTask(readyPii)
      setDecisions(Object.fromEntries((readyPii.piiFindings ?? []).map((finding) => [finding.id, finding.action])))
      persistSession({ file: checkedFile, inspectionTask: readyInspection, normalizeTask: readyNormalize, piiTask: readyPii })
      setStage('review')
    } catch (err) {
      if (err instanceof ApiHttpError && [403, 404, 410].includes(err.status)) {
        clearStaleSession()
      }
      setError(err instanceof Error ? err.message : '材料检查失败，请重试')
      setStage('error')
    }
  }

  useEffect(() => {
    if (state?.file) {
      const next = patchPrintMaterialSession({ file: state.file })
      setSession(next)
    }
    void runChecks()
    // 首次进入页面即开始顺序检查；重试由按钮显式触发。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const setDecision = (findingId: string, action: PiiFindingDecisionAction) => {
    setDecisions((prev) => ({ ...prev, [findingId]: action }))
  }

  const applySuggestedDecisions = () => {
    setDecisions(Object.fromEntries(findings.map((finding) => [
      finding.id,
      riskLevelForFinding(finding) === 'low' ? 'keep' : 'redact',
    ])))
  }

  const keepAll = () => {
    setDecisions(Object.fromEntries(findings.map((finding) => [finding.id, 'keep'])))
  }

  const handleContinue = async () => {
    if (!file?.fileId || !inspectionTask || !piiTask || !allDecided || requiresFormatReview) return

    setStage('submitting')
    setError(null)
    try {
      const token = getToken()
      const payload = findings.map((finding) => ({
        findingId: finding.id,
        action: decisions[finding.id] as PiiFindingDecisionAction,
      }))
      const decidedTask = findings.length > 0
        ? await decidePiiFindings(piiTask.id, payload, { token, accessToken: piiTask.accessToken })
        : piiTask
      const latestFindings = decidedTask.piiFindings ?? findings
      const latestDecisions = Object.fromEntries(latestFindings.map((finding) => [finding.id, finding.action]))
      const { keptCount, redactedCount } = countDecisions(latestDecisions)

      const redactionTask = await createMaterialTask({
        kind: 'pii_redact',
        sourceFileId: file.fileId,
        params: { decisionTaskId: decidedTask.id },
      }, token, decidedTask.accessToken ?? piiTask.accessToken)
      persistSession({ inspectionTask, normalizeTask: normalizeTask ?? undefined, piiTask: decidedTask, piiRedactTask: redactionTask })
      const readyRedaction = await waitForCompletedTask(redactionTask, token, redactionTask.accessToken)
      assertTaskReady(readyRedaction, '遮挡产物评估')
      const redaction = piiRedactionSummaryFromTask(readyRedaction) ?? undefined
      if (redaction && !redaction.canRedact) {
        persistSession({ inspectionTask, normalizeTask: normalizeTask ?? undefined, piiTask: decidedTask, piiRedactTask: readyRedaction })
        setError(redaction.message)
        setStage('review')
        return
      }

      const materialCheck: MaterialCheckSummary = {
        inspectionTaskId: inspectionTask.id,
        normalizeTaskId: normalizeTask?.id,
        piiTaskId: piiTask.id,
        piiRedactTaskId: readyRedaction.id,
        checkedAt: new Date().toISOString(),
        findingCount: latestFindings.length,
        redactedCount,
        keptCount,
        redaction,
        mode: isDemoTask(inspectionTask) || isDemoTask(normalizeTask) || isDemoTask(piiTask) || isDemoTask(readyRedaction) ? 'demo' : 'checked',
      }

      persistSession({ inspectionTask, normalizeTask: normalizeTask ?? undefined, piiTask: decidedTask, piiRedactTask: readyRedaction, materialCheck })
      setStage('done')
      navigate('/print/preview', { state: { file, materialCheck, source } })
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存隐私选择失败，请重试')
      setStage('review')
    }
  }

  if (!file) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-6 p-8">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-warning-bg">
          <AlertCircleIcon className="h-10 w-10 text-warning" />
        </div>
        <div className="text-center">
          <p className="text-lg font-semibold text-neutral-900">未找到文件信息</p>
          <p className="mt-2 text-sm text-neutral-500">请重新上传文件后再进行材料检查</p>
        </div>
        <Button size="lg" onClick={() => navigate(uploadPath)}>
          重新上传文件
        </Button>
      </div>
    )
  }

  return (
    <div className="print-proto flex min-h-full flex-col p-6">
      <PrintPrototypeHeader
        title="打印前材料检查"
        subtitle="仅用于本次打印前确认；扫描件 / 图片可能通过第三方 OCR 服务识别文字"
        step={2}
        backLabel="重新上传"
        onBack={() => navigate(uploadPath)}
      />

      <MaterialCheckPresentation
        stage={stage}
        file={file}
        error={error}
        inspection={inspectionSummary ? {
          pageLabel: inspectionSummary.pageCount ? `${inspectionSummary.pageCount} 页` : '页数以实际打印为准',
          canPrint: inspectionSummary.canPrint,
          messages: inspectionSummary.messages.map((message) => message.text),
        } : null}
        normalization={normalizeSummary ? {
          targetPaperSize: normalizeSummary.targetPaperSize,
          canNormalize: normalizeSummary.canNormalize,
          messages: normalizeSummary.messages.map((message) => message.text),
        } : null}
        privacyModeWarning={piiModeCopy?.label ?? null}
        demoMode={isDemoTask(inspectionTask) || isDemoTask(piiTask)}
        findings={presentationFindings}
        requiresFormatReview={requiresFormatReview}
        canContinue={canContinue}
        isWorking={isWorking}
        redactedCount={decisionCounts.redactedCount}
        onRetry={() => void runChecks()}
        onBack={() => navigate(uploadPath)}
        onApplySuggested={applySuggestedDecisions}
        onKeepAll={keepAll}
        onDecision={setDecision}
        onContinue={() => void handleContinue()}
      />
    </div>
  )
}
