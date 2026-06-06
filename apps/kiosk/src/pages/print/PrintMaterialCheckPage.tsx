import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Button, Card, PageHeader } from '@ai-job-print/ui'
import {
  AlertCircleIcon,
  CheckCircleIcon,
  EyeOffIcon,
  FileTextIcon,
  LoaderIcon,
  RotateCcwIcon,
  ShieldCheckIcon,
} from 'lucide-react'
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
  readPrintMaterialSession,
  type MaterialCheckSummary,
  type PrintFileState,
  type PrintMaterialSession,
} from './printMaterialSession'

interface LocationState {
  file?: PrintFileState
}

type Stage = 'idle' | 'inspection' | 'pii_scan' | 'review' | 'submitting' | 'done' | 'error'
type InspectionMessageSeverity = 'info' | 'warning'
const TASK_POLL_ATTEMPTS = 30
const TASK_POLL_INTERVAL_MS = 1_000

interface InspectionSummaryView {
  pageCount: number | null
  canPrint: boolean | null
  messages: Array<{ code: string; severity: InspectionMessageSeverity; text: string }>
}

const ACTION_LABEL: Record<PiiFindingDecisionAction, string> = {
  keep: '保留',
  redact: '遮挡',
}

const RISK_LABEL: Record<'high' | 'medium' | 'low', string> = {
  high: '高风险',
  medium: '中风险',
  low: '低风险',
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
  return mode === 'mock' || mode === 'skeleton' || mode === 'simulated'
}

function CheckStep({
  active,
  done,
  label,
}: {
  active: boolean
  done: boolean
  label: string
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-gray-100 bg-white px-4 py-3">
      <div
        className={[
          'flex h-9 w-9 items-center justify-center rounded-full',
          done ? 'bg-green-50 text-green-600' : active ? 'bg-primary-50 text-primary-600' : 'bg-gray-50 text-gray-400',
        ].join(' ')}
      >
        {done ? <CheckCircleIcon className="h-5 w-5" /> : active ? <LoaderIcon className="h-5 w-5 animate-spin" /> : <ShieldCheckIcon className="h-5 w-5" />}
      </div>
      <span className="text-sm font-medium text-gray-800">{label}</span>
    </div>
  )
}

function FlowStep({
  done,
  active,
  label,
}: {
  done?: boolean
  active?: boolean
  label: string
}) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <div
        className={[
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold',
          done ? 'bg-green-600 text-white' : active ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-400',
        ].join(' ')}
      >
        {done ? <CheckCircleIcon className="h-4 w-4" /> : ''}
      </div>
      <span className={['truncate text-sm font-medium', active ? 'text-primary-700' : done ? 'text-green-700' : 'text-gray-400'].join(' ')}>
        {label}
      </span>
    </div>
  )
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

  const [stage, setStage] = useState<Stage>('idle')
  const [inspectionTask, setInspectionTask] = useState<DocumentProcessTaskView | null>(null)
  const [piiTask, setPiiTask] = useState<DocumentProcessTaskView | null>(null)
  const [decisions, setDecisions] = useState<Record<string, PiiFindingAction>>({})
  const [error, setError] = useState<string | null>(null)

  useBusyLock(Boolean(file))

  const findings = piiTask?.piiFindings ?? []
  const allDecided = findings.every((finding) => decisions[finding.id] === 'keep' || decisions[finding.id] === 'redact')
  const decisionCounts = useMemo(() => countDecisions(decisions), [decisions])
  const inspectionSummary = useMemo(() => inspectionSummaryFromTask(inspectionTask), [inspectionTask])
  const requiresFormatReview = inspectionSummary?.canPrint === false
  const canContinue = stage === 'review' && allDecided && !requiresFormatReview
  const isWorking = stage === 'inspection' || stage === 'pii_scan' || stage === 'submitting'

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
          params: { scanScope: 'print_preview' },
        }, token)
      }
      persistSession({ file: checkedFile, inspectionTask: readyInspection, piiTask: pii })
      const readyPii = await waitForCompletedTask(pii, token, pii.accessToken)
      assertTaskReady(readyPii, '隐私检查')
      setPiiTask(readyPii)
      setDecisions(Object.fromEntries((readyPii.piiFindings ?? []).map((finding) => [finding.id, finding.action])))
      persistSession({ file: checkedFile, inspectionTask: readyInspection, piiTask: readyPii })
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
    if (!file || !inspectionTask || !piiTask || !allDecided || requiresFormatReview) return

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

      const materialCheck: MaterialCheckSummary = {
        inspectionTaskId: inspectionTask.id,
        piiTaskId: piiTask.id,
        checkedAt: new Date().toISOString(),
        findingCount: latestFindings.length,
        redactedCount,
        keptCount,
        mode: isDemoTask(inspectionTask) || isDemoTask(piiTask) ? 'demo' : 'checked',
      }

      persistSession({ inspectionTask, piiTask: decidedTask, materialCheck })
      setStage('done')
      navigate('/print/preview', { state: { file, materialCheck } })
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存隐私选择失败，请重试')
      setStage('review')
    }
  }

  if (!file) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-6 p-8">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-amber-50">
          <AlertCircleIcon className="h-10 w-10 text-amber-400" />
        </div>
        <div className="text-center">
          <p className="text-lg font-semibold text-gray-900">未找到文件信息</p>
          <p className="mt-2 text-sm text-gray-500">请重新上传文件后再进行材料检查</p>
        </div>
        <Button size="lg" onClick={() => navigate('/print/upload')}>
          重新上传文件
        </Button>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col p-6">
      <PageHeader
        title="打印前材料检查"
        subtitle="仅用于本次打印前确认，不向第三方发送"
        actions={
          <Button size="sm" variant="secondary" disabled={isWorking} onClick={() => navigate('/print/upload')}>
            重新上传
          </Button>
        }
      />

      <Card className="mt-5 p-4">
        <div className="flex items-center gap-3">
          <FlowStep label="上传文件" done />
          <div className="h-px w-6 bg-gray-200" />
          <FlowStep label="材料检查" active />
          <div className="h-px w-6 bg-gray-200" />
          <FlowStep label="打印设置" />
          <div className="h-px w-6 bg-gray-200" />
          <FlowStep label="确认打印" />
        </div>
      </Card>

      <div className="mt-5 grid flex-1 grid-cols-[300px_1fr] gap-6 overflow-hidden">
        <div className="flex flex-col gap-4">
          <Card className="p-5">
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-primary-50">
                <FileTextIcon className="h-6 w-6 text-primary-600" />
              </div>
              <div className="min-w-0">
                <p className="break-all text-sm font-semibold text-gray-900">{file.name}</p>
                <p className="mt-1 text-sm text-gray-500">
                  {file.size} · {file.pages === null ? '页数识别中' : `${file.pages} 页`}
                </p>
              </div>
            </div>
          </Card>

          <CheckStep label="文件体检" active={stage === 'inspection'} done={!!inspectionTask} />
          <CheckStep label="隐私片段检查" active={stage === 'pii_scan'} done={!!piiTask} />

          <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm leading-relaxed text-blue-800">
            仅用于本次打印前确认，不向第三方发送。页面只展示隐私片段，不展示完整原文。
          </div>
        </div>

        <div className="flex min-w-0 flex-col overflow-hidden">
          {isWorking && (
            <Card className="flex flex-1 flex-col items-center justify-center gap-5 p-8">
              <LoaderIcon className="h-12 w-12 animate-spin text-primary-500" />
              <div className="text-center">
                <p className="text-xl font-semibold text-gray-900">
                  {stage === 'inspection' ? '正在检查文件格式' : '正在检查隐私片段'}
                </p>
                <p className="mt-2 text-sm text-gray-500">请稍候，检查完成后需要您确认</p>
              </div>
            </Card>
          )}

          {stage === 'error' && (
            <Card className="flex flex-1 flex-col items-center justify-center gap-5 p-8">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-red-50">
                <AlertCircleIcon className="h-8 w-8 text-red-500" />
              </div>
              <div className="max-w-md text-center">
                <p className="text-xl font-semibold text-gray-900">材料检查未完成</p>
                <p className="mt-2 text-sm leading-relaxed text-gray-500">{error}</p>
              </div>
              <Button size="lg" className="min-w-[180px]" onClick={() => void runChecks()}>
                <RotateCcwIcon className="mr-2 h-5 w-5" />
                重试检查
              </Button>
            </Card>
          )}

          {stage === 'review' && (
            <div className="flex flex-1 flex-col overflow-hidden">
              <div className="mb-4 flex items-center justify-between rounded-lg border border-green-100 bg-green-50 px-5 py-4">
                <div className="flex items-center gap-3">
                  <CheckCircleIcon className="h-6 w-6 text-green-600" />
                  <div>
                    <p className="font-semibold text-green-900">检查完成</p>
                    <p className="mt-0.5 text-sm text-green-700">
                      {findings.length > 0 ? `发现 ${findings.length} 个需确认片段` : '未发现需要确认的隐私片段'}
                    </p>
                  </div>
                </div>
                {(isDemoTask(inspectionTask) || isDemoTask(piiTask)) && (
                  <span className="rounded-full bg-white px-3 py-1 text-xs font-medium text-gray-500">
                    流程演示
                  </span>
                )}
              </div>

              {inspectionSummary && (
                <div className="mb-4 rounded-lg border border-gray-100 bg-white px-5 py-4">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="font-semibold text-gray-900">文件体检摘要</p>
                      <p className="mt-1 text-sm text-gray-500">
                        {inspectionSummary.pageCount ? `${inspectionSummary.pageCount} 页` : '页数以实际打印为准'}
                      </p>
                    </div>
                    <span
                      className={[
                        'rounded-full px-3 py-1 text-xs font-semibold',
                        requiresFormatReview ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700',
                      ].join(' ')}
                    >
                      {requiresFormatReview ? '需重新上传' : '可继续打印'}
                    </span>
                  </div>
                  {inspectionSummary.messages.length > 0 && (
                    <div className="mt-3 flex flex-col gap-2">
                      {inspectionSummary.messages.map((message) => (
                        <div
                          key={`${message.code}:${message.text}`}
                          className={[
                            'flex items-center gap-2 rounded-md px-3 py-2 text-sm',
                            message.severity === 'warning' ? 'bg-amber-50 text-amber-800' : 'bg-gray-50 text-gray-700',
                          ].join(' ')}
                        >
                          {message.severity === 'warning' ? (
                            <AlertCircleIcon className="h-4 w-4 shrink-0" />
                          ) : (
                            <CheckCircleIcon className="h-4 w-4 shrink-0" />
                          )}
                          <span>{message.text}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {findings.length === 0 ? (
                <Card className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
                  <ShieldCheckIcon className="h-16 w-16 text-green-500" />
                  <div className="text-center">
                    <p className="text-xl font-semibold text-gray-900">
                      {requiresFormatReview ? '请重新上传文件后继续' : '可以继续设置打印参数'}
                    </p>
                    <p className="mt-2 text-sm text-gray-500">
                      {requiresFormatReview
                        ? '材料体检提示当前文件暂不可继续打印，请返回上传页重新选择文件'
                        : '本次检查未发现需要确认的隐私片段，后续请继续核对打印参数'}
                    </p>
                  </div>
                </Card>
              ) : (
                <div className="flex flex-1 flex-col gap-3 overflow-y-auto pb-2">
                  <Card className="flex items-center justify-between gap-4 p-4">
                    <div>
                      <p className="font-semibold text-gray-900">批量处理</p>
                      <p className="mt-1 text-sm text-gray-500">可先按建议处理，再逐项微调</p>
                    </div>
                    <div className="flex gap-3">
                      <button
                        type="button"
                        className="min-h-[56px] rounded-lg border border-amber-200 bg-amber-50 px-5 text-base font-semibold text-amber-800"
                        onClick={applySuggestedDecisions}
                      >
                        按建议处理
                      </button>
                      <button
                        type="button"
                        className="min-h-[56px] rounded-lg border border-gray-200 bg-white px-5 text-base font-semibold text-gray-700"
                        onClick={keepAll}
                      >
                        全部保留
                      </button>
                    </div>
                  </Card>
                  {findings.map((finding) => {
                    const selected = decisions[finding.id]
                    const risk = riskLevelForFinding(finding)
                    return (
                      <Card key={finding.id} className="p-5">
                        <div className="flex gap-4">
                          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-amber-50">
                            <EyeOffIcon className="h-5 w-5 text-amber-600" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-base font-semibold text-gray-900">{finding.label || finding.type}</span>
                              <span
                                className={[
                                  'rounded-full px-2.5 py-1 text-xs font-semibold',
                                  risk === 'high'
                                    ? 'bg-red-50 text-red-700'
                                    : risk === 'medium'
                                      ? 'bg-amber-50 text-amber-700'
                                      : 'bg-blue-50 text-blue-700',
                                ].join(' ')}
                              >
                                {RISK_LABEL[risk]}
                              </span>
                            </div>
                            <div className="mt-3 grid grid-cols-[80px_1fr] gap-y-2 text-sm">
                              <span className="text-gray-500">片段</span>
                              <span className="font-medium text-gray-900">{maskSnippet(finding.type, finding.snippet)}</span>
                              <span className="text-gray-500">建议</span>
                              <span className="font-medium text-amber-700">{suggestionForFinding(finding)}</span>
                            </div>
                            <div className="mt-4 grid grid-cols-2 gap-3">
                              {(['redact', 'keep'] as const).map((action) => (
                                <button
                                  key={action}
                                  type="button"
                                  onClick={() => setDecision(finding.id, action)}
                                  className={[
                                    'min-h-[72px] rounded-lg border px-4 text-base font-semibold transition-colors',
                                    selected === action
                                      ? action === 'redact'
                                        ? 'border-amber-500 bg-amber-50 text-amber-800'
                                        : 'border-primary-600 bg-primary-50 text-primary-700'
                                      : 'border-gray-200 bg-white text-gray-600 active:bg-gray-50',
                                  ].join(' ')}
                                >
                                  {ACTION_LABEL[action]}
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>
                      </Card>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {error && stage === 'review' && (
        <div className="mt-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertCircleIcon className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="mt-6 flex gap-3">
        <Button variant="secondary" size="lg" className="min-h-[72px] flex-1" disabled={isWorking} onClick={() => navigate('/print/upload')}>
          返回上传
        </Button>
        <Button
          size="lg"
          className="min-h-[72px] flex-1"
          disabled={!canContinue}
          onClick={() => void handleContinue()}
        >
          {stage === 'submitting' ? (
            <span className="flex items-center gap-2">
              <LoaderIcon className="h-5 w-5 animate-spin" />
              保存选择中…
            </span>
          ) : requiresFormatReview ? (
            '请重新上传文件'
          ) : findings.length > 0 && !allDecided ? (
            '请先完成全部选择'
          ) : (
            `继续打印设置${findings.length > 0 ? ` · 遮挡 ${decisionCounts.redactedCount} 项` : ''}`
          )}
        </Button>
      </div>
    </div>
  )
}
