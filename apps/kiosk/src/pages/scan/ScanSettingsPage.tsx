import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Button, KioskActionBar, KioskPageFrame, KioskPageHeader, KioskStatePanel } from '@ai-job-print/ui'
import { ClockIcon, PrinterIcon } from 'lucide-react'
import type { ScanSessionCreateResponse } from '@ai-job-print/shared'
import { useAuth } from '../../auth/useAuth'
import { useBusyLock } from '../../contexts/KioskBusyContext'
import { getTerminalId } from '../../services/api/screensaver'
import { ApiHttpError } from '../../services/api/httpAdapter'
import { cancelScanSession, createScanSession } from '../../services/api/scanTasks'
import { ScanFlowSteps } from './ScanFlowSteps'
import { SCAN_OUTPUT_FORMAT_PENDING } from './scanOutputFormat'
import './styles/scan-fusion.css'

type ScanType = 'resume' | 'id' | 'document'
type SessionPhase = 'invalid' | 'loading' | 'success' | 'expired' | 'error'

interface LocationState {
  scanType?: unknown
}

interface SessionFailure {
  title: string
  description: string
}

const SCAN_TYPE_LABELS: Record<ScanType, string> = {
  resume: '简历扫描',
  id: '证件扫描',
  document: '普通文档',
}

function isScanType(value: unknown): value is ScanType {
  return value === 'resume' || value === 'id' || value === 'document'
}

function getCancellationCredentials(created: unknown): { scanTaskId: string; controlToken: string } | null {
  if (!created || typeof created !== 'object') return null
  const candidate = created as Partial<ScanSessionCreateResponse>
  if (typeof candidate.scanTaskId !== 'string' || candidate.scanTaskId.trim().length === 0) return null
  if (typeof candidate.controlToken !== 'string' || candidate.controlToken.trim().length === 0) return null
  return { scanTaskId: candidate.scanTaskId, controlToken: candidate.controlToken }
}

function isValidCreatedSession(created: unknown): created is ScanSessionCreateResponse {
  if (!created || typeof created !== 'object') return false
  const candidate = created as Partial<ScanSessionCreateResponse>
  return getCancellationCredentials(candidate) !== null
    && typeof candidate.expiresAt === 'string'
    && Number.isFinite(Date.parse(candidate.expiresAt))
    && Date.parse(candidate.expiresAt) > Date.now()
    && Array.isArray(candidate.instructions)
    && candidate.instructions.length > 0
    && candidate.instructions.every((instruction) => typeof instruction === 'string' && instruction.trim().length > 0)
}

function formatCountdown(expiresAt: string): string {
  const seconds = Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000))
  const minutes = Math.floor(seconds / 60)
  const remain = seconds % 60
  return `${minutes}:${String(remain).padStart(2, '0')}`
}

export function ScanSettingsPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { getToken } = useAuth()
  const state = (location.state ?? {}) as LocationState
  const scanType = isScanType(state.scanType) ? state.scanType : null

  const [phase, setPhase] = useState<SessionPhase>(scanType ? 'loading' : 'invalid')
  const [failure, setFailure] = useState<SessionFailure | null>(null)
  const [instructions, setInstructions] = useState<string[] | null>(null)
  const [starting, setStarting] = useState(false)
  const [scanTaskId, setScanTaskId] = useState<string | null>(null)
  const [expiresAt, setExpiresAt] = useState<string | null>(null)
  const [countdown, setCountdown] = useState('--:--')
  const [controlToken, setControlToken] = useState<string | null>(null)

  const confirmedRef = useRef(false)
  const createdIdRef = useRef<string | null>(null)
  const controlTokenRef = useRef<string | null>(null)
  const sessionPromiseRef = useRef<Promise<ScanSessionCreateResponse> | null>(null)
  const generationRef = useRef(0)
  const cancelRequestedRef = useRef(false)
  const explicitCancelRequestedRef = useRef(false)
  const expiryHandledRef = useRef(false)

  useBusyLock(phase === 'loading' || phase === 'success' || starting)

  const cancelSessionOnce = (id: string, token: string) => {
    if (cancelRequestedRef.current) return
    cancelRequestedRef.current = true
    void cancelScanSession(id, token, getToken()).catch(() => undefined)
  }

  useEffect(() => {
    if (!scanType) return

    const myGeneration = ++generationRef.current
    let cancelled = false

    if (!sessionPromiseRef.current) {
      sessionPromiseRef.current = createScanSession({ scanType, terminalId: getTerminalId() }, getToken())
    }

    sessionPromiseRef.current
      .then((created) => {
        const cancellationCredentials = getCancellationCredentials(created)
        if (cancellationCredentials) {
          createdIdRef.current = cancellationCredentials.scanTaskId
          controlTokenRef.current = cancellationCredentials.controlToken
        }
        if (!isValidCreatedSession(created)) {
          if (cancellationCredentials) {
            cancelSessionOnce(cancellationCredentials.scanTaskId, cancellationCredentials.controlToken)
          }
          throw new Error('INVALID_SCAN_SESSION')
        }

        if (cancelled) {
          if (
            generationRef.current === myGeneration
            && explicitCancelRequestedRef.current
            && !confirmedRef.current
          ) {
            cancelSessionOnce(created.scanTaskId, created.controlToken)
          }
          return
        }

        setInstructions(created.instructions)
        setScanTaskId(created.scanTaskId)
        setControlToken(created.controlToken)
        setExpiresAt(created.expiresAt)
        setPhase('success')
      })
      .catch((error: unknown) => {
        if (cancelled) return
        const outcomeUnknown = error instanceof ApiHttpError && error.code === 'NETWORK_ERROR'
        setFailure(outcomeUnknown
          ? {
              title: '无法确认扫描任务状态',
              description: '网络响应中断，无法确认服务端是否收到请求。为避免重复创建，本页不会自动重发。',
            }
          : {
              title: '扫描任务未创建',
              description: '服务端未返回可用的扫描会话，因此本页不显示任务编号或设备操作指引。',
            })
        setPhase('error')
      })

    return () => {
      cancelled = true
      // 路由卸载可能来自公共终端隐私清场；卸载本身绝不取消已创建的后台扫描任务。
      // 只有用户明确点击返回、服务端响应无效或会话自然过期时才发送取消请求。
    }
    // StrictMode 需要在同一组 refs 上复用唯一创建 promise，不按渲染重发。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!expiresAt) return

    const tick = () => {
      setCountdown(formatCountdown(expiresAt))
      if (Date.parse(expiresAt) > Date.now() || expiryHandledRef.current) return
      expiryHandledRef.current = true
      if (createdIdRef.current && controlTokenRef.current && !confirmedRef.current) {
        cancelSessionOnce(createdIdRef.current, controlTokenRef.current)
      }
      setFailure({
        title: '扫描会话已过期',
        description: '当前会话已超过服务端返回的有效期，本页已停止继续操作。请返回扫描首页重新创建。',
      })
      setPhase('expired')
    }

    tick()
    const timer = window.setInterval(tick, 1000)
    return () => window.clearInterval(timer)
    // 取消函数依赖可变 token/ref，当前 effect 只应由服务端过期时间重建。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expiresAt])

  const handleSafeReturn = () => {
    explicitCancelRequestedRef.current = true
    if (createdIdRef.current && controlTokenRef.current && !confirmedRef.current) {
      cancelSessionOnce(createdIdRef.current, controlTokenRef.current)
    }
    navigate('/scan/start')
  }

  const handleConfirm = () => {
    if (!scanType || !scanTaskId || !controlToken || starting) return
    confirmedRef.current = true
    setStarting(true)
    navigate('/scan/progress', { state: { scanTaskId, scanType, controlToken } })
  }

  if (phase !== 'success' || !scanType || !scanTaskId || !controlToken || !instructions || !expiresAt) {
    const title = phase === 'invalid'
      ? '未创建扫描任务'
      : phase === 'loading'
        ? '正在创建扫描任务'
        : failure?.title ?? '扫描任务未创建'
    const description = phase === 'invalid'
      ? '当前页面没有来自扫描首页的合法类型信息，本次不会发起创建请求。'
      : phase === 'loading'
        ? '正在等待服务端返回真实会话，成功前不会显示任务信息或操作指引。'
        : failure?.description ?? '本次没有可用的扫描会话。'

    return (
      <KioskPageFrame className="w2-scan-page">
        <div data-w2-page="scan-settings" className="w2-scan-shell">
          <KioskPageHeader title={title} description={description} onBack={handleSafeReturn} backLabel="安全返回扫描首页" />
          <section className="w2-scan-content">
            <KioskStatePanel
              tone={phase === 'loading' ? 'loading' : 'error'}
              title={title}
              description={description}
              actions={<Button size="lg" variant="secondary" onClick={handleSafeReturn}>安全返回扫描首页</Button>}
            />
          </section>
          <KioskActionBar leading={<span className="w2-scan-action-note">未确认成功前不显示扫描操作步骤</span>}>
            <Button variant="secondary" size="lg" onClick={handleSafeReturn}>安全返回扫描首页</Button>
          </KioskActionBar>
        </div>
      </KioskPageFrame>
    )
  }

  return (
    <KioskPageFrame className="w2-scan-page">
      <div data-w2-page="scan-settings" className="w2-scan-shell">
        <KioskPageHeader
          title="扫描指引"
          description="扫描任务已创建，请仅按服务端返回的当前会话指引操作"
          onBack={handleSafeReturn}
          backLabel="上一步（取消任务）"
          aside={<span className="w2-scan-status-chip is-ready"><span />扫描任务已创建</span>}
        />

        <ScanFlowSteps activeIndex={1} />

        <section className="w2-scan-content w2-scan-two-column">
          <section className="w2-scan-primary-card">
            <div className="w2-scan-card-title">
              <span><PrinterIcon /></span>
              <div><h2>当前会话的服务端指引</h2><p>以下内容全部来自刚刚创建的扫描会话。</p></div>
            </div>
            <div className="w2-scan-guide-list">
              {instructions.map((instruction, index) => (
                <div key={`${instruction}-${index}`} className="w2-scan-guide-row">
                  <span>{index + 1}</span><div><b>服务端指引 {index + 1}</b><p>{instruction}</p></div>
                </div>
              ))}
            </div>
          </section>

          <aside className="w2-scan-sidebar">
            <section className="w2-scan-info-card">
              <h2>任务信息</h2>
              {[
                ['扫描类型', SCAN_TYPE_LABELS[scanType]],
                ['任务编号', scanTaskId],
                ['剩余时间', countdown],
                ['输出格式', SCAN_OUTPUT_FORMAT_PENDING],
              ].map(([key, value]) => (
                <div key={key}><span>{key}</span><b>{value}</b></div>
              ))}
            </section>
            <p className="w2-scan-warning">仅当前会话有效。点击返回会取消这个未确认的任务。</p>
          </aside>
        </section>

        <KioskActionBar leading={<span className="w2-scan-action-note"><ClockIcon />任务剩余 {countdown}</span>}>
          <Button variant="secondary" size="lg" onClick={handleSafeReturn}>返回（取消任务）</Button>
          <Button size="lg" disabled={starting} onClick={handleConfirm}>
            {starting ? '正在进入等待…' : '我已操作，开始等待'}
          </Button>
        </KioskActionBar>
      </div>
    </KioskPageFrame>
  )
}
