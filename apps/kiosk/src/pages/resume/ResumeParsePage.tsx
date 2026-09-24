import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import {
  CheckIcon,
  SparklesIcon,
  XCircleIcon,
} from 'lucide-react'
import { Button, Card } from '@ai-job-print/ui'
import { useAuth } from '../../auth/useAuth'
import { useBusyLock } from '../../contexts/KioskBusyContext'
import { QxPageFrame } from '../../components/qingxu/QxPageFrame'
import { getResumeRecord, submitResumeParse } from '../../services/api'
import { ApiHttpError } from '../../services/api/httpAdapter'
import { aiErrorCodeOf, aiErrorMessageOf } from '../../ai'
import {
  canonicalResumeParsePayload,
  clearResumeParseIntent,
  prepareResumeParseIntent,
  releaseResumeParseIntent,
  resumeParseIntentBlockMessage,
  resumeParseIntentCode,
  resumeParseIntentHold,
  resumeParseWireBody,
  type CanonicalResumeParsePayload,
} from '../../services/resumeParseIntent'
import { readAiResumeSession, saveAiResumeSession } from './aiResumeSession'
import { useResumeAiConsent } from './resumeAiConsent'
import { ResumeAiConsentDialog } from './components/ResumeAiConsentDialog'
import { ResumeTriageHero, type RailMark } from './components/ResumeTriageHero'
import { buildScanHandoff } from './resumeScanHandoff'
import {
  RESUME_SCORING_DIMENSIONS,
  type ResumeParseResponse,
} from '@ai-job-print/shared'
import './resume-triage-qx.css'
import './resume-triage-panels-qx.css'

const STEPS = [
  { key: 'reading',    label: '读取上传文件',    hint: '校验格式与页数' },
  { key: 'ocr',        label: '识别可解析文字',  hint: '图片 / 扫描件经 OCR 识别' },
  { key: 'extracting', label: '提取简历结构',    hint: '识别教育、经历、技能等分区' },
  { key: 'diagnosing', label: '生成诊断报告',    hint: '6 个评分维度 + 风险表述 + 优先级建议' },
]

const DIMENSIONS = RESUME_SCORING_DIMENSIONS.map((item) => item.label)

const FAIL_REASONS = [
  '文件格式不支持，请重新上传',
  '文字识别失败，请确保文件清晰',
  '结构提取超时，请稍后重试',
  'AI 诊断服务暂时不可用，请稍后重试',
]

/**
 * 这些码只说明「本机没拿到服务端的可信答复」，服务端可能处理了也可能没处理——所以是
 * 「结果未知」，不能说成「解析失败」，也不能自动再提交一次（那是一次新的 AI 调用）：
 * - NETWORK_ERROR / REQUEST_TIMEOUT：断网 / 超时（见 throwHttpError.networkError）；
 * - UNKNOWN_ERROR：没有 API 错误信封的代答（网关、代理等，API 自己对任何错误都写 code），
 *   或 2xx 响应体截断（JSON 解析失败的错误本身不带 code）。
 */
const NO_REPLY_CODES = new Set(['NETWORK_ERROR', 'REQUEST_TIMEOUT', 'UNKNOWN_ERROR'])

/**
 * 按 aiHttpAdapter 真实抛出的错误对象判定（与来源页 upload-unknown 同一口径）：
 * 上面三类码一律未知；任何 5xx（ApiHttpError.status ≥ 500）即使带 API 业务信封也算未知 ——
 * 服务端可能已经处理完，只是回包这一步失败。只有 4xx 业务拒绝与 MOCK_MODE（演示模式明确拒绝，
 * AiMockModeError 不是 ApiHttpError、status 为 0）才是明确失败。
 */
function parseErrorOutcome(err: unknown): 'failed' | 'unknown' {
  const code = aiErrorCodeOf(err)
  if (code === 'RESUME_PARSE_OUTCOME_UNKNOWN' || code === 'AI_TASK_NOT_FOUND') return 'unknown'
  if (NO_REPLY_CODES.has(code)) return 'unknown'
  if (err instanceof ApiHttpError && (err.status >= 500 || err.status === 408)) return 'unknown'
  return 'failed'
}

function isTaskNotFound(err: unknown): boolean {
  return err instanceof ApiHttpError && err.status === 404 && aiErrorCodeOf(err) === 'AI_TASK_NOT_FOUND'
}

function anonymousAccessReady(taskId: string, accessToken: string | undefined, anonymous: boolean): boolean {
  const back = readAiResumeSession()
  if (!back || back.taskId !== taskId) return false
  if (!anonymous) return true
  return typeof accessToken === 'string' && accessToken.length > 0 && back.accessToken === accessToken
}

type ParseTask = { taskId: string; accessToken?: string }

/**
 * 本页真实所处的状态。标题、四步轨、顶栏胶囊都只从这里取，不各自猜。
 * 稿 21 的 parse-unknown / parse-rechecking：解析是一次同步请求，只有收到 2xx 答复才有 taskId。
 * 拿到了编号却不是最终结果时，用既有 GET /resume/records/:taskId 按本人凭证（会员 token 或本次
 * 一次性 accessToken）再查；整次答复都丢了、手里没有编号时没有可查的接口，只如实说未知，
 * 由用户自己决定要不要再提交一次（明确标成新的一次）。
 */
type ParseView = 'missing-file' | 'consent-checking' | 'consent-needed' | 'waiting' | 'failed' | 'unknown'

const VIEW: Record<ParseView, {
  ask: ReactNode
  doing: string
  flag: string
  warn: boolean
  status: { tone: 'ok' | 'warn' | 'bad' | 'unknown'; label: string }
  rail: RailMark[]
}> = {
  'missing-file': {
    ask: <>没找到<em>要用的简历文件</em>。</>,
    doing: '这一步需要一份已经拿到的简历，现在没有，所以不往下走。',
    flag: '已阻断', warn: true,
    status: { tone: 'warn', label: '这一步没有文件' },
    rail: ['current', 'todo', 'todo', 'todo'],
  },
  'consent-checking': {
    ask: <>先确认<em>授权状态</em>。</>,
    doing: '确认完成之前，文件不会交给 AI 服务。',
    flag: '确认中', warn: false,
    status: { tone: 'unknown', label: '确认授权中' },
    rail: ['done', 'wait', 'todo', 'todo'],
  },
  'consent-needed': {
    ask: <>用简历 AI 前，<em>需要你先授权</em>。</>,
    doing: '不授权就不解析；取消会回到来源选择，文件不会交给 AI。',
    flag: '待授权', warn: true,
    status: { tone: 'warn', label: '等待授权' },
    rail: ['done', 'wait', 'todo', 'todo'],
  },
  waiting: {
    ask: <>文件收到了，正在等<em>最终解析结果</em>。</>,
    doing: '解析是一次出结果的处理，中间没有阶段可以播报。',
    flag: '解析中', warn: false,
    status: { tone: 'unknown', label: '正在解析 · 一次性出结果' },
    rail: ['done', 'current', 'todo', 'todo'],
  },
  failed: {
    ask: <>这次<em>没能读出内容</em>。</>,
    doing: '文件已经传到服务端了，正在转到失败说明页，可以直接重新解析，不用再传一遍。',
    flag: '解析失败', warn: true,
    status: { tone: 'bad', label: '解析失败 · 可重试' },
    rail: ['done', 'bad', 'todo', 'todo'],
  },
  unknown: {
    ask: <>这一次解析<em>暂时无法确认有没有完成</em>。</>,
    doing: '可能已经完成，也可能没有；本页不会自动再提交，也不会把它当成失败。',
    flag: '结果未知', warn: true,
    status: { tone: 'warn', label: '解析结果未知' },
    rail: ['done', 'wait', 'todo', 'todo'],
  },
}

export function ResumeParsePage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user, getToken } = useAuth()
  const consent = useResumeAiConsent()
  const state = location.state as Record<string, unknown> | null

  const file = state?.file as { name?: string; format?: string; size?: number | string } | undefined
  const fileId = typeof state?.fileId === 'string' ? state.fileId : ''
  const watchedOwner = user?.id ?? null

  const [outcome, setOutcome] = useState<'failed' | 'unknown' | null>(null)
  // 结果未知但拿到了编号（2xx 却不是最终结果）：只放内存与既有最小会话，不进地址栏。
  const [pendingTask, setPendingTask] = useState<ParseTask | null>(null)
  const [recheck, setRecheck] = useState<'idle' | 'checking' | 'not-ready' | 'error' | 'replay' | 'not-found'>('idle')
  const [blockNote, setBlockNote] = useState<string | null>(null)
  const [storageBlocked, setStorageBlocked] = useState(false)
  const [confirmFresh, setConfirmFresh] = useState<0 | 1 | 2>(0)
  const failed = outcome !== null
  const cancelRef = useRef(false)
  const startedRef = useRef(false)
  // 同一时刻最多一次解析 POST：快速连点只发一次。
  const inFlightRef = useRef(false)
  const failTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const ownerRef = useRef<string | null>(watchedOwner)
  const ownerWatch = useRef(watchedOwner)
  const intentRef = useRef('')
  const payloadRef = useRef<CanonicalResumeParsePayload | null>(null)
  const keptTokenRef = useRef<ParseTask | null>(null)
  const pendingTaskRef = useRef<ParseTask | null>(null)
  const identityStoppedRef = useRef(false)
  ownerRef.current = watchedOwner
  pendingTaskRef.current = pendingTask

  useBusyLock(Boolean(fileId) && !failed)

  /**
   * 只给**明确失败**用：结果未知留在本页，不转去报告页的失败屏。
   * 服务端给过编号时（2xx + status=failed，匿名还带一次性 accessToken）照样带上：只进路由 state
   * 与既有最小会话（aiResumeSession 只存 taskId + accessToken），不进地址栏。
   */
  const navigateFail = useCallback(
    (reason: string, task?: ParseTask) => {
      if (task) {
        saveAiResumeSession(task)
        if (!anonymousAccessReady(task.taskId, task.accessToken, ownerRef.current === null)) {
          setPendingTask(task)
          setStorageBlocked(true)
          setOutcome('unknown')
          setBlockNote('本机没有把这次解析的读取凭证存牢。请留在此页，用同一次重查；退出后匿名结果可能无法找回。')
          return
        }
      }
      setOutcome('failed')
      failTimerRef.current = setTimeout(() => {
        navigate('/resume/report', { state: { ...state, success: false, reason, ...(task ? { taskId: task.taskId, accessToken: task.accessToken } : {}) } })
      }, 700)
    },
    [navigate, state],
  )

  const samePerson = useCallback((ownerId: string | null) => (
    !cancelRef.current && !identityStoppedRef.current && ownerRef.current === ownerId
  ), [])

  /** 只清当前 owner、当前意图、当前材料仍对得上的那一条。清不掉就停在未知，不导航、不另铸。 */
  const dropHeldIntent = useCallback(async (ownerId: string | null, missing: string) => {
    if (!samePerson(ownerId)) return false
    if (resumeParseIntentHold({ intent: intentRef.current, ownerId, payload: payloadRef.current }) !== 'held') {
      setOutcome('unknown')
      setRecheck('replay')
      setBlockNote(missing)
      return false
    }
    const cleared = await clearResumeParseIntent(intentRef.current, ownerId)
    if (!samePerson(ownerId) || !cleared.ok) {
      if (samePerson(ownerId)) {
        setOutcome('unknown')
        setRecheck('replay')
        setStorageBlocked(true)
        setBlockNote('解析结果的读取凭证已留在本机，但没能释放这一次的解析标识。请用同一次重查，不要开始新的解析。')
      }
      return false
    }
    intentRef.current = ''
    payloadRef.current = null
    return true
  }, [samePerson])

  const acceptResult = useCallback(async (result: ResumeParseResponse, ownerId: string | null, knownTaskId: string) => {
    if (!samePerson(ownerId)) return
    if (!result || typeof result !== 'object') {
      setOutcome('unknown')
      setBlockNote('服务端的答复不完整，这台机器没能确认这一次解析的结果。')
      return
    }
    if (knownTaskId && result.taskId && result.taskId !== knownTaskId) {
      setOutcome('unknown')
      setRecheck('replay')
      setBlockNote('这次重查返回了另一个编号，没有收下，也没有另起一次解析。')
      return
    }
    const anonymous = ownerId === null
    if (result.taskId) {
      const kept = keptTokenRef.current?.taskId === result.taskId ? keptTokenRef.current.accessToken : undefined
      const accessToken = kept || result.accessToken
      if ((result.status === 'completed' || result.status === 'failed') && anonymous && !accessToken) {
        setPendingTask({ taskId: result.taskId })
        setOutcome('unknown')
        setRecheck('replay')
        setBlockNote('这次解析有了编号，但答复里没有匿名读取凭证。请用同一次重查，不要开始新的解析。')
        return
      }
      if (!kept) {
        // Phase C-2A：匿名令牌只在这次答复里出现。先写后回读，没存牢就不清意图、不离开本页。
        saveAiResumeSession({ taskId: result.taskId, accessToken: result.accessToken })
      } else {
        saveAiResumeSession({ taskId: result.taskId, accessToken: kept })
      }
      if (!anonymousAccessReady(result.taskId, accessToken, anonymous)) {
        keptTokenRef.current = { taskId: result.taskId, accessToken }
        setPendingTask({ taskId: result.taskId, accessToken })
        setStorageBlocked(true)
        setOutcome('unknown')
        setBlockNote('本机没有把这次解析的读取凭证存牢。请留在此页，用同一次重查；退出后匿名结果可能无法找回。')
        return
      }
      keptTokenRef.current = { taskId: result.taskId, accessToken }
      setPendingTask({ taskId: result.taskId, accessToken })
      setStorageBlocked(false)
    }
    if (!samePerson(ownerId)) return
    if (result.status !== 'completed') {
      if (result.status === 'failed') {
        if (!result.taskId) {
          navigateFail(result.failReason ?? '简历解析未能完成，请重试')
          return
        }
        // 凭证已在上面写后读回。同一次意图清掉之后，报告页「重新解析」才会铸新的一对请求头。
        if (!await dropHeldIntent(ownerId, '本机解析标识已不在，没有打开失败报告，也没有另起一次解析。')) return
        navigateFail(result.failReason ?? '简历解析未能完成，请重试', {
          taskId: result.taskId,
          accessToken: keptTokenRef.current?.accessToken,
        })
        return
      }
      if (result.status !== 'pending' && result.status !== 'processing') {
        setBlockNote(result.taskId
          ? '解析已经提交并拿到了编号，但收到的答复不完整。'
          : '服务端的答复不完整，这台机器没能确认这一次解析的结果。')
      }
      setOutcome('unknown')
      return
    }
    if (!result.taskId) {
      setOutcome('unknown')
      setBlockNote('服务端的答复不完整，这台机器没能确认这一次解析的结果。')
      return
    }
    if (!await dropHeldIntent(ownerId, '本机解析标识已不在，没有打开结果，也没有另起一次解析。')) return
    navigate('/resume/report', {
      state: {
        ...state,
        success: true,
        taskId: result.taskId,
        accessToken: keptTokenRef.current?.taskId === result.taskId ? keptTokenRef.current.accessToken : result.accessToken,
        providerName: result.providerName,
        report: result.report,
        extractionNotice: result.extractionNotice,
      },
    })
  }, [dropHeldIntent, navigate, navigateFail, samePerson, state])

  const submitAndWait = useCallback(async (mode: 'start' | 'replay') => {
    if (!fileId || inFlightRef.current || identityStoppedRef.current) return
    inFlightRef.current = true
    const ownerId = ownerRef.current
    const knownTaskId = mode === 'replay' ? (pendingTaskRef.current?.taskId ?? '') : ''
    setOutcome(null)
    setRecheck('idle')
    setBlockNote(null)
    setConfirmFresh(0)
    try {
      const canonical = canonicalResumeParsePayload({
        fileId,
        fileName: file?.name ?? 'resume.pdf',
        fileFormat: file?.format ?? 'pdf',
        source: typeof state?.source === 'string' ? state.source : 'upload',
        selectedDimensions: state?.selectedDimensions,
        targetContext: state?.targetContext,
      })
      if (!canonical) {
        setOutcome('unknown')
        setBlockNote(resumeParseIntentBlockMessage('PAYLOAD_INVALID'))
        return
      }
      let prepared: { payload: CanonicalResumeParsePayload; headers: { intent: string; proof: string } }
      try {
        prepared = await prepareResumeParseIntent(canonical, ownerId, { reuseOnly: mode === 'replay' })
      } catch (err) {
        if (!samePerson(ownerId)) return
        setOutcome('unknown')
        setBlockNote(resumeParseIntentBlockMessage(resumeParseIntentCode(err) || 'PREPARE_FAILED'))
        if (knownTaskId) setRecheck('replay')
        return
      }
      if (!samePerson(ownerId)) return
      if (intentRef.current && prepared.headers.intent !== intentRef.current) {
        setOutcome('unknown')
        setBlockNote('这次重查没能沿用原来的解析标识，没有另起一次解析。')
        if (knownTaskId) setRecheck('replay')
        return
      }
      if (resumeParseIntentHold({ intent: prepared.headers.intent, ownerId, payload: prepared.payload }) !== 'held') {
        setOutcome('unknown')
        setBlockNote(resumeParseIntentBlockMessage('STORAGE_WRITE_FAILED'))
        return
      }
      intentRef.current = prepared.headers.intent
      payloadRef.current = prepared.payload
      const result = await submitResumeParse(resumeParseWireBody(prepared.payload), getToken(), prepared.headers)
      await acceptResult(result, ownerId, knownTaskId)
    } catch (err) {
      if (!samePerson(ownerId)) return
      // 把真实原因带进失败态：演示模式要说「演示模式不提供简历解析与诊断」，
      // 一律改写成「服务暂时不可用」会让用户以为是网络问题、反复重试同一份文件。
      // 没拿到可信答复：留在本页如实说未知，不转失败屏，也不自动再提交。
      if (parseErrorOutcome(err) === 'unknown') {
        setOutcome('unknown')
        if (knownTaskId) setRecheck('replay')
        if (aiErrorCodeOf(err) === 'RESUME_PARSE_OUTCOME_UNKNOWN') {
          setBlockNote('这次解析是否已经完成无法确认。请用同一次重查，不要开始新的解析。')
        }
        return
      }
      // 公共额度 429 发生在记账之前，同键重试仍会被拒。只清对得上的本机意图，避免下次换材料被卡住。
      if (err instanceof ApiHttpError && err.status === 429 && aiErrorCodeOf(err) === 'AI_PUBLIC_QUOTA_EXCEEDED') {
        if (await dropHeldIntent(ownerId, '本机解析标识对不上，没有打开拒绝页，也没有另起一次解析。')) {
          navigateFail(aiErrorMessageOf(err, '今日 AI 解析次数已用完'))
        }
        return
      }
      navigateFail(aiErrorMessageOf(err, 'AI 服务暂时不可用，请稍后重试'))
    } finally {
      inFlightRef.current = false
    }
  }, [acceptResult, dropHeldIntent, file?.format, file?.name, fileId, getToken, navigateFail, samePerson, state])

  const replaySame = () => {
    if (inFlightRef.current || confirmFresh !== 0 || identityStoppedRef.current) return
    cancelRef.current = false
    void submitAndWait('replay')
  }

  const beginFresh = async () => {
    if (inFlightRef.current || identityStoppedRef.current) return
    const ownerId = ownerRef.current
    inFlightRef.current = true
    try {
      const released = await releaseResumeParseIntent(ownerId)
      if (!samePerson(ownerId)) return
      if (!released.ok) {
        setConfirmFresh(0)
        setOutcome('unknown')
        setBlockNote(released.code === 'STORAGE_WRITE_FAILED'
          ? '本机没能清除上一次未完成的解析，没有开始新的一次。'
          : resumeParseIntentBlockMessage(released.code))
        return
      }
      intentRef.current = ''
      payloadRef.current = null
      keptTokenRef.current = null
      setPendingTask(null)
      setConfirmFresh(0)
      setBlockNote(null)
    } finally {
      inFlightRef.current = false
    }
    if (!samePerson(ownerId)) return
    cancelRef.current = false
    void submitAndWait('start')
  }

  /** 有编号时按同一编号读回（既有 GET，只读，凭本人会员 token 或本次一次性 accessToken）。 */
  const recheckTask = async () => {
    if (!pendingTask || recheck === 'checking' || storageBlocked || confirmFresh !== 0) return
    const ownerId = ownerRef.current
    setRecheck('checking')
    try {
      const res = await getResumeRecord(pendingTask.taskId, { token: getToken(), accessToken: pendingTask.accessToken })
      if (!samePerson(ownerId)) return
      await acceptResult(res, ownerId, pendingTask.taskId)
      if ((res.status === 'pending' || res.status === 'processing') && (!res.taskId || res.taskId === pendingTask.taskId)) {
        setRecheck('not-ready')
      }
    } catch (err) {
      if (!samePerson(ownerId)) return
      const held = resumeParseIntentHold({
        intent: intentRef.current,
        ownerId,
        payload: payloadRef.current,
      }) !== 'absent'
      if (isTaskNotFound(err) && held) {
        setRecheck('replay')
        setBlockNote('解析已经提交并拿到了编号，但结果还没有写入完成。请用同一次重查，不要开始新的解析。')
        return
      }
      if (isTaskNotFound(err)) {
        setRecheck('not-found')
        setBlockNote('以这台机器当前的登录状态和读取凭证，查不到这一次的结果。没有另起一次解析。')
        return
      }
      if (held && parseErrorOutcome(err) === 'unknown') {
        setRecheck('replay')
        setBlockNote('查询结果时没有拿到可信答复。请用同一次重查，不要开始新的解析。')
        return
      }
      setRecheck('error')
    }
  }

  const handleDevFail = useCallback(() => {
    cancelRef.current = true
    navigateFail(FAIL_REASONS[1])
  }, [navigateFail])

  useEffect(() => {
    if (ownerWatch.current === watchedOwner) return
    ownerWatch.current = watchedOwner
    if (!startedRef.current && !inFlightRef.current) return
    identityStoppedRef.current = true
    cancelRef.current = true
    inFlightRef.current = false
    setConfirmFresh(0)
    setOutcome('unknown')
    setBlockNote('登录状态已变化，没有开始新的一次解析。')
  }, [watchedOwner])

  useEffect(() => {
    const cleanup = () => {
      cancelRef.current = true
      if (failTimerRef.current) clearTimeout(failTimerRef.current)
    }
    if (identityStoppedRef.current) return cleanup
    cancelRef.current = false
    if (!fileId || startedRef.current) return cleanup
    if (consent.checking || consent.needsPrompt || !consent.ready) return cleanup
    startedRef.current = true
    void submitAndWait('start')
    return cleanup
  }, [fileId, submitAndWait, consent.checking, consent.needsPrompt, consent.ready])

  // File meta from navigation state
  const fileName = file?.name ?? '简历文件'
  const fileSize = typeof file?.size === 'number'
    ? file.size < 1024 * 1024 ? `${Math.round(file.size / 1024)} KB` : `${(file.size / 1024 / 1024).toFixed(1)} MB`
    : typeof file?.size === 'string' ? file.size : null
  const source = typeof state?.source === 'string' ? state.source : 'upload'
  const sourceLabel = source === 'scan' ? '扫描件' : source === 'manual' ? '手动填写' : '已上传'

  /*
   * 离开本页回到来源选择。
   * 扫描件是扫描工作台用 replace 交接过来的：扫描登记已清、/scan/result 那条历史也被换掉了，
   * 这份文件此刻只活在本页的路由 state 里。所以扫描来的必须把同一份文件身份原样带回来源页
   * （稿 21 scan-ready），否则一按返回文件就丢了；history back 也回不到扫描结果。
   * 上传来的照旧：顶栏回来源页、底栏「返回上一步」走浏览器历史。
   * 带上真实 intent，优化链路不会被悄悄改成诊断。
   *
   * 必须用 replace 把解析页这条历史换掉（顶栏返回、授权取消、扫描件的「返回上一步」都走这里）：
   * push 会把解析页留在来源页底下，浏览器 / 系统后退一按，解析页带着原来的路由 state 重新挂载，
   * 用同一个 fileId 和签名链接再提交一次解析，还把这份文件重新摆到屏幕上。
   */
  const scanHandoff = source === 'scan' ? buildScanHandoff(state) : null
  const sourceRoute = state?.intent === 'optimize' ? '/resume/source?intent=optimize' : '/resume/source'
  const leaveToSource = () => {
    cancelRef.current = true
    navigate(sourceRoute, scanHandoff ? { replace: true, state: { scanHandoff } } : { replace: true })
  }

  const view: ParseView = !fileId
    ? 'missing-file'
    : consent.checking
      ? 'consent-checking'
      : consent.needsPrompt
        ? 'consent-needed'
        : outcome ?? 'waiting'
  const copy = VIEW[view]

  const renderFrame = (body: ReactNode, ctabar?: ReactNode) => (
    <QxPageFrame
      title="AI 解析"
      subtitle="等待服务端返回真实解析结果"
      status={copy.status}
      terminalLabel="AI 简历服务"
      back={{ label: '返回简历来源', onBack: leaveToSource }}
      ctabar={ctabar}
    >
      <section data-kiosk-domain="resume" data-kiosk-screen="resume-parse" data-state={view} className="qx-resume-triage">
        <ResumeTriageHero
          eyebrow={state?.intent === 'optimize' ? 'AI RESUME OPTIMIZE' : 'AI RESUME DIAGNOSE'}
          ask={copy.ask}
          doing={copy.doing}
          flag={copy.flag}
          warn={copy.warn}
          rail={copy.rail}
        />
        {body}
      </section>
    </QxPageFrame>
  )

  // 没有文件就不问授权：授权是为了把文件交给 AI，手里没文件时弹授权只会把人绕进去。
  if (!fileId) {
    return renderFrame(
      <div className="qx-rt-wait">
        <section className="qx-rt-fail" data-tone="warn">
          <h2 className="qx-rt-fail-t"><XCircleIcon size={24} aria-hidden="true" />未找到简历文件</h2>
          <p>请回到来源选择，把简历交进来后，再开始 AI 诊断。本页不会凭空开始解析。</p>
        </section>
      </div>,
      <button type="button" className="qx-btn" data-variant="primary" onClick={() => navigate('/resume/source')}>
        回到来源选择
      </button>,
    )
  }

  if (consent.checking || consent.needsPrompt) {
    return (
      <>
        {renderFrame(
          <p className="qx-rt-note" role="status">
            {consent.checking ? '正在确认授权状态…' : '使用简历 AI 前需要先确认授权'}
          </p>,
        )}
        {consent.needsPrompt && (
          <ResumeAiConsentDialog
            busy={consent.busy}
            error={consent.error}
            guest={!getToken()}
            onCancel={leaveToSource}
            onConfirm={() => { void consent.confirm() }}
          />
        )}
      </>
    )
  }

  const page = renderFrame(
    <>
      <div className="qx-rt-wait">
        <section className="qx-card qx-rt-wait-card" data-live={failed ? undefined : 'true'}>
          {/* 装饰性处理标识：不表达百分比或服务端阶段 */}
          <span className="qx-rt-ring" data-tone={outcome === 'failed' ? 'bad' : outcome === 'unknown' ? 'warn' : undefined} aria-hidden="true">
            {failed ? <XCircleIcon size={44} /> : <SparklesIcon size={44} />}
          </span>
          <h2 className="qx-rt-wait-t" role="status" aria-live="polite">
            {outcome === 'failed' ? '解析出错' : outcome === 'unknown' ? (pendingTask ? '解析还没出最终结果' : '没等到解析结果') : '正在等待真实解析结果…'}
          </h2>
          {/* 文件信息 chips */}
          {!failed && (
            <div className="qx-rt-chips">
              <span>{fileName}</span>
              {fileSize && <span>{fileSize} · {sourceLabel}</span>}
              <span>处理内容说明 · 非实时阶段</span>
            </div>
          )}
        </section>

        {/* 稿 21 parse-unknown：四行说明沿用来源页 upload-unknown 的版式。 */}
        {outcome === 'unknown' && (
          <>
            <p className="qx-rt-note resume-parse-unknown" data-tone="warn">
              <b>结果未知</b>{pendingTask ? '服务端已经登记了这一次解析，但还没给出最终结果。' : '暂时无法确认这一次解析有没有完成。'}本页不会自动再提交，也不会把它当成失败。
            </p>
            <dl className="qx-rt-kv">
              <div><dt>发生了什么</dt><dd>{pendingTask ? '解析已经提交并拿到了编号，服务端还没返回最终结果。' : '提交解析后网络或服务出了问题，这台机器没能确认结果。'}</dd></div>
              <div><dt>还不确定的</dt><dd>这一次解析可能已经完成，也可能没有。</dd></div>
              {pendingTask ? (
                <div><dt>按编号再查</dt><dd>只是读取这一次的结果，不会重新解析，也不会多出记录。</dd></div>
              ) : (
                <>
                  <div><dt>同一次重查</dt><dd>用已经保存的同一次标识再问一次，不会另起一次解析。</dd></div>
                  <div><dt>重新提交</dt><dd>会作为新的一次解析重新调用 AI；如果刚才那次其实已经完成，记录里可能多出一条。</dd></div>
                </>
              )}
              <div>
                <dt>建议这样做</dt>
                <dd data-testid="resume-parse-unknown-next">
                  {pendingTask
                    ? '稍后点下方「按同一编号再查结果」；也可以返回简历来源换一份文件。'
                    : getToken()
                      ? '可先到「我的 → 我的简历」核对；暂时没看到时可稍后刷新。先按同一次重查。若决定重新提交，这是新的一次解析。'
                      : '当前未登录，暂时无法核对这一次的结果。需要继续时，先按同一次重查；重新提交会是新的一次解析。也可以返回简历来源。'}
                </dd>
              </div>
            </dl>
            {recheck === 'not-ready' && (
              <p className="qx-rt-note" role="status" data-testid="resume-parse-recheck-result">这次查到的仍不是最终结果，可以稍后再查。</p>
            )}
            {recheck === 'error' && (
              <p className="qx-rt-note" data-tone="warn" role="status" data-testid="resume-parse-recheck-result">这次没查到结果，可能是网络问题或编号已失效；可以稍后再查，或返回简历来源。</p>
            )}
            {blockNote && (
              <p className="qx-rt-note" data-tone="warn" role="status" data-testid="resume-parse-intent-note">{blockNote}</p>
            )}
            {!storageBlocked && confirmFresh === 0 && (!pendingTask || recheck === 'not-found') && (
              <button
                type="button"
                className="qx-btn"
                data-variant="ghost"
                onClick={() => {
                  if (inFlightRef.current || confirmFresh !== 0) return
                  setConfirmFresh(1)
                }}
              >
                重新提交解析（新的一次）
              </button>
            )}
          </>
        )}

        <p className="qx-rt-note" role="note">
          <b>说明</b>当前服务仅返回最终解析结果。以下为本次处理内容说明，不代表服务端实时阶段。
        </p>
        {consent.guestNotice && (
          <p className="qx-rt-note" role="note" data-testid="resume-ai-guest-notice">
            未登录使用简历 AI：本次结果只在本机会话内可见，离场即清，不进入任何账号；AI 建议仅供参考，不替你投递。
          </p>
        )}

        {/* 处理内容说明：API 不提供分阶段状态，不渲染完成/进行中 */}
        <ol className="qx-rt-steps" aria-label="本次处理内容说明">
          {STEPS.map((step, idx) => (
            <li key={step.key}>
              <i aria-hidden="true">{idx + 1}</i>
              <strong>{step.label}</strong>
              <em>{step.hint}</em>
              <span>处理内容</span>
            </li>
          ))}
        </ol>

        {/* 结果维度说明：不冒充实时准备进度 */}
        {!failed && (
          <section className="qx-card">
            <p className="qx-rt-wait-d"><b>报告将评估的维度</b></p>
            <div className="qx-rt-dim-grid">
              {DIMENSIONS.map((item) => <span key={item} className="qx-rt-dim">{item}</span>)}
            </div>
          </section>
        )}

        <p className="qx-rt-note" data-tone="warn">
          解析通常在 90 秒内完成；若格式不支持、识别失败或服务不可用，将如实提示失败原因，可重试或重新上传。诊断结果由 AI 生成，仅供参考。
        </p>
      </div>

      {/* DEV 专用 */}
      {import.meta.env.DEV && Boolean(fileId) && !failed && (
        <button type="button" onClick={handleDevFail} className="qx-rt-dev resume-parse-dev">
          [DEV] 模拟失败
        </button>
      )}
    </>,
    <>
      <p className="why">
        <CheckIcon size={18} aria-hidden="true" style={{ display: 'inline', marginRight: 6, verticalAlign: '-3px' }} />
        返回仅停止本机等待，不会撤回已提交的服务请求；简历原文不会发送给企业，也不进入平台候选人简历库。
      </p>
      {outcome === 'unknown' ? (
        <>
          <button type="button" className="qx-btn" data-variant="ghost" onClick={leaveToSource}>
            返回简历来源
          </button>
          {pendingTask && !storageBlocked && recheck !== 'replay' && recheck !== 'not-found' ? (
            <button type="button" className="qx-btn" data-variant="primary" disabled={recheck === 'checking'} onClick={() => { void recheckTask() }}>
              {recheck === 'checking' ? '正在查询…' : '按同一编号再查结果'}
            </button>
          ) : (
            <button type="button" className="qx-btn" data-variant="primary" data-testid="resume-parse-replay" onClick={replaySame}>
              按同一次重查
            </button>
          )}
        </>
      ) : (
      <button
        type="button"
        className="qx-btn"
        data-variant="ghost"
        onClick={() => {
          if (scanHandoff) { leaveToSource(); return }
          cancelRef.current = true
          navigate(-1)
        }}
      >
        <XCircleIcon size={20} aria-hidden="true" />
        返回上一步
      </button>
      )}
    </>,
  )

  return (
    <>
      {page}
      {confirmFresh > 0 && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-5"
          role="dialog"
          aria-modal="true"
          aria-labelledby="resume-parse-fresh-title"
        >
          <Card className="w-[32rem] max-w-full p-6 shadow-xl">
            <h2 id="resume-parse-fresh-title" className="text-lg font-semibold text-neutral-900">
              {confirmFresh === 1 ? '重新提交是新的一次' : '再次确认'}
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-neutral-600" data-testid="resume-parse-fresh-copy">
              {confirmFresh === 1
                ? '刚才那次解析可能已经完成。重新提交会再调用一次 AI，生成新的一次解析，不会取消或覆盖刚才那次；如果刚才那次其实已经完成，就等于重复解析了一次。'
                : '将清除本机这一次未完成的解析标识，并开始新的一次 AI 解析。'}
            </p>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <Button size="lg" variant="secondary" className="min-h-14" onClick={() => setConfirmFresh(0)}>
                先不提交
              </Button>
              {confirmFresh === 1 ? (
                <Button size="lg" className="min-h-14" onClick={() => setConfirmFresh(2)}>
                  继续确认
                </Button>
              ) : (
                <Button size="lg" className="min-h-14" onClick={() => { void beginFresh() }}>
                  开始新的一次
                </Button>
              )}
            </div>
          </Card>
        </div>
      )}
    </>
  )
}
