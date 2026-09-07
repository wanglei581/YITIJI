import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ClockIcon } from 'lucide-react'
import type { ScanSessionCreateResponse } from '@ai-job-print/shared'
import { useAuth } from '../../auth/useAuth'
import { useBusyLock } from '../../contexts/KioskBusyContext'
import { getTerminalId } from '../../services/api/screensaver'
import { ApiHttpError } from '../../services/api/httpAdapter'
import { cancelScanSession, createScanSession } from '../../services/api/scanTasks'
import { errorCodeOf, userMessageOf } from '../../services/api/userErrorMessage'
import { SCAN_OUTPUT_FORMAT_PENDING } from './scanOutputFormat'
import {
  ScanChain,
  ScanCta,
  ScanKvCard,
  ScanNoteCard,
  ScanPanelMock,
  ScanPlan,
  ScanSec,
  ScanStatusPanel,
  ScanWorkbenchShell,
} from './ScanWorkbenchChrome'
import { SCAN_TYPE_LABELS, type ScanType } from './scanWorkbench'

function isScanType(value: unknown): value is ScanType {
  return value === 'resume' || value === 'id' || value === 'document'
}

type SessionPhase = 'invalid' | 'loading' | 'success' | 'expired' | 'error'

interface LocationState {
  scanType?: unknown
}

interface SessionFailure {
  title: string
  description: string
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
          // status 必须**非 0**：本仓约定 status===0 表示「压根没拿到 HTTP 响应」
          // （networkError 就是这么造的），下面的 catch 据此判 outcomeUnknown 并显示
          // 「网络连接中断，无法确认服务端是否收到请求」。而这里的情况恰恰相反——
          // 服务端**回了** 2xx，只是响应体缺字段。用 0 会让页面对用户说反话，
          // 还会走进「为避免重复创建不自动重发」那条本不适用的分支。
          throw new ApiHttpError('INVALID_SCAN_SESSION', '扫描任务未创建成功，请返回重试', 200)
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
        const code = errorCodeOf(error)
        const outcomeUnknown = error instanceof ApiHttpError && (error.code === 'NETWORK_ERROR' || error.status === 0)
        if (outcomeUnknown) {
          setFailure({
            title: '无法确认扫描任务状态',
            description: '网络连接中断，无法确认服务端是否收到请求。为避免重复创建，本页不会自动重发。请检查网络后返回重试。',
          })
        } else if (code === 'SCAN_TERMINAL_BUSY') {
          setFailure({
            title: '本机正在扫描中',
            description: userMessageOf(error, '请等待当前扫描任务完成后再试。'),
          })
        } else if (code === 'SCAN_TERMINAL_DISABLED') {
          setFailure({
            title: '扫描功能已停用',
            description: userMessageOf(error, '请联系现场工作人员。'),
          })
        } else if (code === 'RATE_LIMITED' || (error instanceof ApiHttpError && error.status === 429)) {
          setFailure({
            title: '请求过于频繁',
            description: userMessageOf(error, '请稍后再试。'),
          })
        } else {
          setFailure({
            title: '扫描任务未创建',
            description: userMessageOf(error, '服务端未能创建扫描会话。请返回重试，或联系现场工作人员。'),
          })
        }
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
    const workbenchState = phase === 'invalid'
      ? 'invalid'
      : phase === 'loading'
        ? 'create-loading'
        : phase === 'expired'
          ? 'expired'
          : 'create-failed'
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
    const status = phase === 'loading'
      ? { tone: 'unknown' as const, label: '正在建扫描会话' }
      : phase === 'expired'
        ? { tone: 'warn' as const, label: '会话已过期' }
        : { tone: 'bad' as const, label: '会话创建失败' }

    return (
      <ScanWorkbenchShell
        page="scan-settings"
        state={workbenchState}
        title={title}
        subtitle={description}
        status={status}
        ctabar={
          <ScanCta reason={phase === 'loading' ? '请求还在路上 —— 这一刻页面不做任何判断，也不给你一个假的编号' : '未确认成功前不显示扫描操作步骤'}>
            <button type="button" className="qx-btn" data-variant="ghost" onClick={handleSafeReturn}>
              安全返回扫描首页
            </button>
            <button
              type="button"
              className="qx-btn"
              data-variant="primary"
              disabled
              aria-disabled="true"
            >
              {phase === 'loading' ? '等服务端返回会话' : '未创建扫描任务'}
            </button>
          </ScanCta>
        }
      >
        <ScanStatusPanel
          tone={phase === 'loading' ? 'info' : phase === 'invalid' ? 'lock' : 'error'}
          title={title}
          breathe={phase === 'loading'}
          chips={
            phase === 'loading'
              ? [
                  { label: '正在等服务端回话' },
                  { label: scanType ? `选中类型：${SCAN_TYPE_LABELS[scanType]}` : '未选择类型' },
                ]
              : [
                  { label: '没有任务编号', tone: 'warn' },
                  { label: '本机没有文件' },
                ]
          }
        >
          <p>{description}</p>
          {phase === 'loading' ? <p>这一步不碰扫描仪，也不会替你启动任何硬件。</p> : null}
        </ScanStatusPanel>
        {phase === 'loading' ? (
          <div className="sw-grid2">
            <ScanNoteCard title="会话建成之后会出现什么" foot="这三样都由服务端下发，本机一样都编不出来。">
              <ScanPlan items={[
                '服务端发的任务编号，用来认领待会儿回传的文件。',
                '按扫描类型定制的面板操作指引，本机原样转达。',
                '一枚只存在页面内存里的控制凭证，用来查询和取消。',
              ]} />
            </ScanNoteCard>
            <ScanNoteCard title="这一刻你可以做什么" foot="这一刻页面还没有任何结论可写。">
              <p>把要扫的纸先整理好、订书钉取掉，<b>但先别在面板上按开始</b> —— 会话还没建成，这时候扫出来的文件没人认领。</p>
              <p>等待通常就是一两秒。一直转，多半是本机到服务端的网络有问题。</p>
            </ScanNoteCard>
          </div>
        ) : (
          <div className="sw-grid2">
            <ScanNoteCard title="接下来怎么办" foot="本页不会自动重发，也不会自己变成成功。">
              <ScanPlan items={[
                '返回扫描首页，从选择类型重新走一遍。',
                '连续失败就别在面板上扫了，扫了也没有会话认领。',
                '叫工作人员看一眼这台机器到服务端的网络。',
              ]} />
            </ScanNoteCard>
            <ScanNoteCard title="为什么不给你一个编号" foot="这一屏的空白是有意的，不是还没加载完。">
              <p>编号是服务端发的，本机编不出来。<b>硬编一个给你看，你就会照着它去面板上操作</b>，扫出来的文件也没人认领。</p>
            </ScanNoteCard>
          </div>
        )}
      </ScanWorkbenchShell>
    )
  }

  return (
    <ScanWorkbenchShell
      page="scan-settings"
      state="panel-instruction"
      title="扫描指引"
      subtitle="扫描任务已创建，请仅按服务端返回的当前会话指引操作"
      status={{ tone: 'ok', label: '第 2 步 · 去面板操作' }}
      ctabar={
        <ScanCta>
          <button type="button" className="qx-btn" data-variant="ghost" onClick={handleSafeReturn}>
            返回（取消任务）
          </button>
          <button type="button" className="qx-btn" data-variant="primary" disabled={starting} onClick={handleConfirm}>
            {starting ? '正在进入等待…' : '我已操作，开始等待'}
          </button>
        </ScanCta>
      }
    >
      <ScanSec no="01" title="照着做：全在机器面板上" hint="服务端下发原文，本机不改写" grow>
        <ScanPanelMock
          instructions={instructions.map((instruction) => instruction)}
          scanLabel={SCAN_TYPE_LABELS[scanType]}
        />
      </ScanSec>
      <ScanSec no="02" title="现在在第一段" hint="链路位置，不是百分比">
        <ScanChain active={0} />
      </ScanSec>
      <ScanSec no="03" title="这次会话">
        <div className="sw-grid2">
          <ScanKvCard
            title="任务信息"
            rows={[
              ['扫描类型', SCAN_TYPE_LABELS[scanType]],
              ['任务编号', scanTaskId],
              ['剩余时间', countdown],
              ['输出格式', SCAN_OUTPUT_FORMAT_PENDING],
              ['控制凭证', '只在页面内存里，不上屏、不进链接、不落存储'],
            ]}
          />
          <ScanNoteCard title="按完面板之后" foot={<><ClockIcon size={16} aria-hidden /> 任务剩余 {countdown}。仅当前会话有效。点击返回会取消这个未确认的任务。</>}>
            <ScanPlan items={[
              '点「我已操作，开始等待」。',
              '进了等待页本机就每隔几秒自动查一次，你不用一直点。',
              '文件回来之前不显示扫到第几张：链路上没有这种事件。',
            ]} />
          </ScanNoteCard>
        </div>
      </ScanSec>
    </ScanWorkbenchShell>
  )
}
