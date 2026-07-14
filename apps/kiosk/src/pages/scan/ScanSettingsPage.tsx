import { useEffect, useRef, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Button, Card, PageHeader } from '@ai-job-print/ui'
import { AlertCircleIcon, LoaderIcon } from 'lucide-react'
import type { ScanSessionCreateResponse } from '@ai-job-print/shared'
import { useAuth } from '../../auth/useAuth'
import { useBusyLock } from '../../contexts/KioskBusyContext'
import { getTerminalId } from '../../services/api/screensaver'
import { cancelScanSession, createScanSession } from '../../services/api/scanTasks'

type ScanType = 'resume' | 'id' | 'document'

interface LocationState {
  scanType?: ScanType
}

export function ScanSettingsPage() {
  // 用户此时会离开触屏走到打印机操作,期间不能被待机宣传屏/闲置登出打断(参考 ScanProgressPage)
  useBusyLock(true)

  const navigate = useNavigate()
  const location = useLocation()
  const { getToken } = useAuth()
  const state = (location.state ?? {}) as LocationState
  const scanType = state.scanType ?? 'document'

  const [instructions, setInstructions] = useState<string[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [scanTaskId, setScanTaskId] = useState<string | null>(null)
  // B1-8：controlToken 只保存在内存态 React state（不落 localStorage/sessionStorage），
  // 刷新页面即丢、需要重新走一遍创建流程——和游客扫描会话本身"中间态不必跨刷新存活"同一原则。
  const [controlToken, setControlToken] = useState<string | null>(null)

  // 标记任务是否已成功交给下一步(进入 /scan/progress),交给下一步后卸载清理不应再取消该任务
  const confirmedRef = useRef(false)
  // 用 ref（而非 effect 内局部变量）跨越 StrictMode 的 mount→unmount→mount 双调用保存已创建的任务ID，
  // 否则第一次(被丢弃的)调用在 cleanup 时还拿不到 id，之后 resolve 时又被自己的 cancelled 挡住，
  // 会导致创建了一个后端任务却永远没人取消它（孤儿任务）。
  const createdIdRef = useRef<string | null>(null)
  // 同 createdIdRef：cleanup/handleBack 跑在 effect 闭包外或跨渲染，需要 ref 而非 state 来拿到最新的 controlToken。
  const controlTokenRef = useRef<string | null>(null)
  // 用共享 promise ref 跨越 StrictMode 双调用，确保只真正发起一次 createScanSession 网络请求，
  // 而不是每次 effect 调用都各自 fire 一个新请求（否则一次访问会在后端建两条任务记录）。
  const sessionPromiseRef = useRef<Promise<ScanSessionCreateResponse> | null>(null)
  // 代际计数器：区分"当前仍然有效的 effect 调用"与"StrictMode 丢弃的上一次调用"。
  // 只有代际匹配时才允许在 resolve/cleanup 时执行取消逻辑，避免把仍在使用中的真实会话误取消。
  const generationRef = useRef(0)

  useEffect(() => {
    const myGeneration = ++generationRef.current
    let cancelled = false
    setLoading(true)
    setError(null)

    if (!sessionPromiseRef.current) {
      sessionPromiseRef.current = createScanSession({ scanType, terminalId: getTerminalId() }, getToken())
    }

    sessionPromiseRef.current
      .then((created) => {
        createdIdRef.current = created.scanTaskId
        controlTokenRef.current = created.controlToken
        if (cancelled) {
          // 这次 effect 调用在请求完成前就已经被清理。如果它仍是"当前有效"的那次调用
          // (不是被 StrictMode 丢弃的第一次调用),说明用户在任务创建完成前就已经离开且未确认，
          // cleanup 触发时还不知道任务ID、来不及取消，这里补一次尽力取消。
          if (generationRef.current === myGeneration && !confirmedRef.current) {
            void cancelScanSession(created.scanTaskId, created.controlToken, getToken()).catch(() => undefined)
          }
          return
        }
        setInstructions(created.instructions)
        setScanTaskId(created.scanTaskId)
        setControlToken(created.controlToken)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : '创建扫描任务失败，请重试')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
      // StrictMode 丢弃的那次调用的 cleanup 是 no-op：真正的取消交给上面 .then 里的代际检查处理，
      // 避免这里对刚创建、马上要被第二次(真实)调用继续使用的会话误取消。
      // 这里刻意读取 ref 的最新值（而非某次渲染时的快照）来判断"我是否仍是最新一次调用"，
      // 因此忽略 exhaustive-deps 关于 ref 在 cleanup 里可能已变化的告警。
      // eslint-disable-next-line react-hooks/exhaustive-deps
      if (generationRef.current !== myGeneration) return
      // 组件卸载时,如果任务已创建但还没交给下一步(比如用户没点确认就离开了),
      // 尽力取消,避免孤儿 waiting 任务在有效期内被下一个物理扫描误匹配到别的用户。
      if (createdIdRef.current && controlTokenRef.current && !confirmedRef.current) {
        void cancelScanSession(createdIdRef.current, controlTokenRef.current, getToken()).catch(() => undefined)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleBack = () => {
    if (scanTaskId && controlToken && !confirmedRef.current) {
      void cancelScanSession(scanTaskId, controlToken, getToken()).catch(() => {
        // best-effort：任务会在过期后自然结束，这里不阻塞用户返回
      })
    }
    navigate(-1)
  }

  const handleConfirm = () => {
    if (!scanTaskId || !controlToken || starting) return
    confirmedRef.current = true
    setStarting(true)
    navigate('/scan/progress', { state: { scanTaskId, scanType, controlToken } })
  }

  return (
    <div className="flex h-full flex-col p-6">
      <PageHeader
        title="扫描设置"
        subtitle="请按下方指引在打印机上操作"
        actions={
          <Button size="sm" variant="secondary" onClick={handleBack}>
            上一步
          </Button>
        }
      />

      <div className="mt-6 flex flex-1 flex-col gap-4 overflow-y-auto">
        {loading && (
          <Card className="flex items-center gap-3 p-5">
            <LoaderIcon className="h-5 w-5 animate-spin text-primary-500" />
            <p className="text-sm text-neutral-600">正在创建扫描任务…</p>
          </Card>
        )}

        {error && (
          <Card className="flex items-center gap-2 border-error/30 bg-error-bg p-5">
            <AlertCircleIcon className="h-4 w-4 shrink-0 text-error-fg" />
            <p className="text-sm text-error-fg">{error}</p>
          </Card>
        )}

        {instructions && (
          <Card className="p-5">
            <p className="mb-3 text-sm font-medium text-neutral-700">请到打印机操作面板依次操作</p>
            <ol className="list-decimal space-y-2 pl-5 text-sm leading-relaxed text-neutral-700">
              {instructions.map((step, idx) => (
                <li key={idx}>{step}</li>
              ))}
            </ol>
          </Card>
        )}
      </div>

      <div className="mt-6 flex gap-3">
        <Button variant="secondary" size="lg" className="flex-1" onClick={handleBack}>
          返回
        </Button>
        <Button size="lg" className="flex-1" disabled={!scanTaskId || !controlToken || starting} onClick={handleConfirm}>
          我已在打印机上操作，开始等待
        </Button>
      </div>
    </div>
  )
}
