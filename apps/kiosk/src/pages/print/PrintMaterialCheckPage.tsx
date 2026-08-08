/**
 * 打印前材料检查 + 隐私遮挡四步交互（docs/product/pii-redaction-decision-2026-08.md §四）。
 *
 * 1. 检出逐项列出（第几页 / 类型 / 掩码片段）
 * 2. 逐项裁决：默认全部遮挡，「保留」需要单独点
 * 3. **强制预览**：看遮挡后的文件，原尺寸、不可折叠、没有跳过入口
 * 4. 勾「我核对过」才解锁打印
 *
 * 第 3 步是这个功能唯一真正的安全阀：机器复检只能发现「盖错位置」，
 * 发现不了「压根没检出」—— 同一个检测器扫两遍，系统性漏检两遍都漏。
 * 不要以「少一步更顺」为由把它做成可跳过 / 默认折叠。
 *
 * 所有遮挡结论文案统一来自 piiRedactionCopy(claim)，本页不自行拼装。
 */
import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Button } from '@ai-job-print/ui'
import { AlertCircleIcon } from 'lucide-react'
import { useAuth } from '../../auth/useAuth'
import { AiDriverBanner } from '../../components/AiDriverBanner'
import { useBusyLock } from '../../contexts/KioskBusyContext'
import { ApiHttpError } from '../../services/api/httpAdapter'
import {
  createMaterialTask,
  decidePiiFindings,
  getFilePreviewUrl,
  getMaterialTask,
  type DocumentProcessTaskView,
  type PiiFindingAction,
  type PiiFindingDecisionAction,
} from '../../services/api/materials'
import {
  clearPrintMaterialSession,
  patchPrintMaterialSession,
  printUploadPathForSource,
  readPrintMaterialSession,
  type MaterialCheckSummary,
  type MaterialRedactionSummary,
  type PrintMaterialSource,
  type PrintFileState,
  type PrintMaterialSession,
} from './printMaterialSession'
import {
  countDecisions,
  findingLabel,
  inspectionSummaryFromTask,
  isDemoTask,
  maskSnippet,
  normalizeA4SummaryFromTask,
  pageCountFromInspection,
  pageLabelForFinding,
  piiScanModeCopy,
  riskLevelForFinding,
} from './materialCheckModel'
import {
  countByApplied,
  groupItemsByPage,
  hasUsableRedactedFile,
  parsePiiRedactionResult,
  piiRedactionCopy,
  piiReverifyNote,
  piiTypeLabel,
  type PiiRedactionResult,
} from './piiRedaction'
import { PrintPageFrame, PrintPrototypeHeader } from './PrintPrototypeLayout'
import {
  MaterialCheckPresentation,
  type MaterialCheckStage,
} from './components/MaterialCheckPresentation'
import { RedactionReviewPresentation } from './components/RedactionReviewPresentation'

interface LocationState {
  file?: PrintFileState
  source?: PrintMaterialSource
}

const TASK_POLL_ATTEMPTS = 30
const TASK_POLL_INTERVAL_MS = 1_000

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

function applyDetectedPageCount(file: PrintFileState, inspection: DocumentProcessTaskView): PrintFileState {
  const pageCount = pageCountFromInspection(inspection)
  if (!pageCount || file.pages === pageCount) return file
  return { ...file, pages: pageCount }
}

function suggestionForRisk(risk: 'high' | 'medium' | 'low'): string {
  if (risk === 'high') return '默认遮挡；确需露出时再点「保留」'
  if (risk === 'medium') return '默认遮挡；投递用材料通常需要保留联系方式'
  return '默认遮挡；按材料用途决定是否保留'
}

function previewKindForUrl(url: string | null, mimeType?: string): 'pdf' | 'image' | 'unavailable' {
  if (!url) return 'unavailable'
  if (mimeType?.startsWith('image/')) return 'image'
  if (/\.(png|jpe?g|webp)(\?|$)/i.test(url)) return 'image'
  return 'pdf'
}

function redactionSummaryOf(result: PiiRedactionResult | null): MaterialRedactionSummary | undefined {
  if (!result) return undefined
  return {
    claim: result.claim,
    redactedFileId: result.redactedFileId,
    appliedRedactedCount: countByApplied(result.items, 'redacted'),
    failedNoPositionCount: countByApplied(result.items, 'failed_no_position'),
    keptCount: countByApplied(result.items, 'kept'),
    reverifyRemainingCount: result.reverify.remainingCount,
    reverifyRan: result.reverify.ran,
  }
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

  // 第 3 / 4 步（强制预览 + 人眼确认）状态
  const [redactTask, setRedactTask] = useState<DocumentProcessTaskView | null>(null)
  const [redaction, setRedaction] = useState<PiiRedactionResult | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewConfirmed, setPreviewConfirmed] = useState(false)
  const [acknowledgedUnredacted, setAcknowledgedUnredacted] = useState(false)

  const findings = piiTask?.piiFindings ?? []
  const allDecided = findings.every((finding) => decisions[finding.id] === 'keep' || decisions[finding.id] === 'redact')
  const decisionCounts = useMemo(() => countDecisions(decisions), [decisions])
  const inspectionSummary = useMemo(() => inspectionSummaryFromTask(inspectionTask), [inspectionTask])
  const normalizeSummary = useMemo(() => normalizeA4SummaryFromTask(normalizeTask), [normalizeTask])
  const requiresFormatReview = inspectionSummary?.canPrint === false
  const piiModeCopy = useMemo(() => piiScanModeCopy(piiTask), [piiTask])
  const canContinue = stage === 'review' && allDecided && !requiresFormatReview
  const isWorking = stage === 'inspection' || stage === 'normalize_a4' || stage === 'pii_scan' || stage === 'submitting'
  useBusyLock(isWorking)

  const redactionCopy = useMemo(() => piiRedactionCopy(redaction), [redaction])
  const pageGroups = useMemo(() => groupItemsByPage(redaction?.items ?? []), [redaction])
  const failedItems = useMemo(
    () => (redaction?.items ?? [])
      .filter((item) => item.applied === 'failed_no_position')
      .map((item) => ({
        id: item.id,
        label: piiTypeLabel(item.type),
        pageLabel: item.pageNumber ? `第 ${item.pageNumber} 页` : '页码未知',
      })),
    [redaction],
  )

  const presentationFindings = findings.map((finding) => {
    const risk = riskLevelForFinding(finding)
    return {
      id: finding.id,
      label: findingLabel(finding),
      pageLabel: pageLabelForFinding(finding),
      maskedSnippet: maskSnippet(finding.type, finding.snippet),
      suggestion: suggestionForRisk(risk),
      risk,
      selected: decisions[finding.id] ?? 'pending',
    }
  })

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
    setRedactTask(null)
    setRedaction(null)
    setPreviewUrl(null)
    setPreviewConfirmed(false)
    setAcknowledgedUnredacted(false)

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
      // §四 第 2 步：默认全部遮挡；「保留」必须用户逐项单独点，不提供批量保留入口。
      setDecisions(Object.fromEntries(
        (readyPii.piiFindings ?? []).map((finding) => [finding.id, 'redact' as PiiFindingAction]),
      ))
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

  const buildSummary = (args: {
    piiTaskId: string
    redactTaskId?: string
    findingCount: number
    redactedCount: number
    keptCount: number
    redaction?: MaterialRedactionSummary
  }): MaterialCheckSummary => ({
    inspectionTaskId: inspectionTask?.id ?? '',
    normalizeTaskId: normalizeTask?.id,
    piiTaskId: args.piiTaskId,
    piiRedactTaskId: args.redactTaskId,
    checkedAt: new Date().toISOString(),
    findingCount: args.findingCount,
    redactedCount: args.redactedCount,
    keptCount: args.keptCount,
    redaction: args.redaction,
    mode: isDemoTask(inspectionTask) || isDemoTask(normalizeTask) || isDemoTask(piiTask) ? 'demo' : 'checked',
  })

  const goToPreview = (nextFile: PrintFileState, materialCheck: MaterialCheckSummary) => {
    persistSession({ file: nextFile, materialCheck })
    setStage('done')
    navigate('/print/preview', { state: { file: nextFile, materialCheck, source } })
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

      // 没有任何一处要求遮挡 → 没有遮挡产物可核对，不做「强制预览」这道戏。
      // 这是唯一允许不进入第 3 步的条件，且此路径不会出现任何遮挡结论文案。
      if (redactedCount === 0) {
        persistSession({ piiTask: decidedTask })
        goToPreview(file, buildSummary({
          piiTaskId: decidedTask.id,
          findingCount: latestFindings.length,
          redactedCount,
          keptCount,
        }))
        return
      }

      const redactionTask = await createMaterialTask({
        kind: 'pii_redact',
        sourceFileId: file.fileId,
        params: { decisionTaskId: decidedTask.id },
      }, token, decidedTask.accessToken ?? piiTask.accessToken)
      persistSession({ piiTask: decidedTask, piiRedactTask: redactionTask })
      const readyRedaction = await waitForCompletedTask(redactionTask, token, redactionTask.accessToken)
      assertTaskReady(readyRedaction, '隐私遮挡处理')

      const parsed = parsePiiRedactionResult(readyRedaction)
      // 派生件 URL 首选后端直接带出（checks.redactedFileUrl）；拿不到时兜底问
      // /files/:id/preview-url（需登录）。两处都拿不到 → previewUrl 为 null，
      // 核对页 fail-closed：看不到就不允许确认，也不会声称遮挡。
      let url = parsed?.redactedFileUrl ?? null
      if (!url && parsed?.redactedFileId) {
        url = await getFilePreviewUrl(parsed.redactedFileId, {
          token,
          accessToken: readyRedaction.accessToken ?? decidedTask.accessToken,
        })
      }

      setRedactTask(readyRedaction)
      setRedaction(parsed ? { ...parsed, redactedFileUrl: url } : null)
      setPreviewUrl(url)
      setPreviewConfirmed(false)
      setAcknowledgedUnredacted(false)
      persistSession({ piiTask: decidedTask, piiRedactTask: readyRedaction })
      setStage('redaction_review')
    } catch (err) {
      setError(err instanceof Error ? err.message : '隐私遮挡处理失败，请重试')
      setStage('review')
    }
  }

  /** 第 4 步：人眼确认通过 → 用遮挡后的派生件继续打印（打印与存档同一份）。 */
  const handleRedactionConfirm = () => {
    if (!file || !piiTask || !redaction || !previewConfirmed) return
    if (!hasUsableRedactedFile(redaction)) return
    const summary = redactionSummaryOf(redaction)
    if (!summary) return
    const derivedFile: PrintFileState = {
      ...file,
      fileId: redaction.redactedFileId ?? file.fileId,
      fileUrl: redaction.redactedFileUrl ?? file.fileUrl,
      fileMd5: undefined,
    }
    goToPreview(derivedFile, buildSummary({
      piiTaskId: piiTask.id,
      redactTaskId: redactTask?.id,
      findingCount: findings.length,
      redactedCount: decisionCounts.redactedCount,
      keptCount: decisionCounts.keptCount,
      redaction: { ...summary, previewConfirmedAt: new Date().toISOString() },
    }))
  }

  /** 「本机做不到」时的出路之一：用户明确接受打印未遮挡的原件。 */
  const handlePrintOriginal = () => {
    if (!file || !piiTask || !acknowledgedUnredacted) return
    const summary = redactionSummaryOf(redaction)
    goToPreview(file, buildSummary({
      piiTaskId: piiTask.id,
      redactTaskId: redactTask?.id,
      findingCount: findings.length,
      redactedCount: decisionCounts.redactedCount,
      keptCount: decisionCounts.keptCount,
      redaction: summary
        ? { ...summary, unredactedAcknowledgedAt: new Date().toISOString() }
        : undefined,
    }))
  }

  if (!file) {
    return (
      <PrintPageFrame className="p-6">
      <div className="flex h-full flex-col items-center justify-center gap-6 p-8">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-warning-bg">
          <AlertCircleIcon className="h-10 w-10 text-warning" />
        </div>
        <div className="text-center">
          <p className="text-lg font-semibold text-neutral-900">未找到文件信息</p>
          <p className="mt-2 text-sm text-neutral-500">请重新上传文件后再进行材料检查</p>
        </div>
        <Button size="lg" className="min-h-14" onClick={() => navigate(uploadPath)}>
          重新上传文件
        </Button>
      </div>
      </PrintPageFrame>
    )
  }

  const reviewingRedaction = stage === 'redaction_review'

  return (
    <PrintPageFrame className="p-6">
    <div className="flex min-h-full flex-col">
      <PrintPrototypeHeader
        title={reviewingRedaction ? '核对遮挡结果' : '打印前材料检查'}
        subtitle={reviewingRedaction
          ? redactionCopy.showFallbackOptions
            // 本机做不到时没有预览可看，副标题不能继续要求「看预览」。
            ? '本机没有产出遮挡后的文件，请选择下面的处理方式'
            : '请逐页看过下面的预览，确认之后才能继续打印'
          : '仅用于本次打印前确认；扫描件 / 图片可能通过第三方 OCR 服务识别文字'}
        step={2}
        backLabel={reviewingRedaction ? '返回逐项选择' : '重新上传'}
        onBack={() => (reviewingRedaction ? setStage('review') : navigate(uploadPath))}
      />

      {reviewingRedaction ? (
        <RedactionReviewPresentation
          copy={redactionCopy}
          fileName={file.name}
          previewUrl={previewUrl}
          previewKind={previewKindForUrl(previewUrl, file.mimeType)}
          previewUnavailableReason={
            redaction?.redactedFileId
              ? '本机没有拿到遮挡后文件的预览地址（未登录时可能出现）。看不到就没法核对，因此这一步不能确认。'
              : '本机没有拿到遮挡后的文件。'
          }
          pageGroups={pageGroups}
          failedItems={failedItems}
          keptCount={countByApplied(redaction?.items ?? [], 'kept')}
          reverifyNote={piiReverifyNote(redaction)}
          confirmed={previewConfirmed}
          onConfirmedChange={setPreviewConfirmed}
          acknowledgedUnredacted={acknowledgedUnredacted}
          onAcknowledgedChange={setAcknowledgedUnredacted}
          isWorking={false}
          onBack={() => setStage('review')}
          onContinue={handleRedactionConfirm}
          onPrintOriginal={handlePrintOriginal}
        />
      ) : (
        <>
          <AiDriverBanner feature="AI文件预检" description="自动检查格式、边距与打印风险" />

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
            onDecision={setDecision}
            onContinue={() => void handleContinue()}
          />
        </>
      )}
    </div>
    </PrintPageFrame>
  )
}
