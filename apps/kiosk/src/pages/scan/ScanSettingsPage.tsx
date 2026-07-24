import { useEffect, useRef, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Button, KioskActionBar, KioskPageFrame, KioskPageHeader, KioskStatePanel } from '@ai-job-print/ui'
import {
  CheckIcon,
  ClockIcon,
  PrinterIcon,
} from 'lucide-react'
import type { ScanSessionCreateResponse } from '@ai-job-print/shared'
import { useAuth } from '../../auth/useAuth'
import { useBusyLock } from '../../contexts/KioskBusyContext'
import { getTerminalId } from '../../services/api/screensaver'
import { cancelScanSession, createScanSession } from '../../services/api/scanTasks'
import './styles/scan-fusion.css'

type ScanType = 'resume' | 'id' | 'document'

interface LocationState {
  scanType?: ScanType
}

const SCAN_TYPE_LABELS: Record<ScanType, string> = {
  resume: '简历扫描',
  id: '证件扫描',
  document: '普通文档',
}

const GUIDE_STEPS = [
  ['放好原件', '多页材料正面朝上放入顶部输稿器；单页证书掀开上盖，正面朝下对齐玻璃板左上角'],
  ['在面板上选择「扫描」', '点按打印机屏幕上的扫描功能，按面板提示选择本机对应的接收目录'],
  ['按「开始」键发起扫描', '输稿器会自动逐页进纸；平板扫描每页需手动更换原件后再按开始'],
  ['回到本屏幕点击「开始等待」', '本机会自动检测扫描结果并生成 PDF 文件，请勿离开'],
] as const

function formatCountdown(expiresAt: string | null): string {
  if (!expiresAt) return '10:00'
  const seconds = Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000))
  const minutes = Math.floor(seconds / 60)
  const remain = seconds % 60
  return `${minutes}:${String(remain).padStart(2, '0')}`
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
  const [expiresAt, setExpiresAt] = useState<string | null>(null)
  const [countdown, setCountdown] = useState('10:00')
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
        setExpiresAt(created.expiresAt)
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

  useEffect(() => {
    setCountdown(formatCountdown(expiresAt))
    const timer = window.setInterval(() => setCountdown(formatCountdown(expiresAt)), 1000)
    return () => window.clearInterval(timer)
  }, [expiresAt])

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

  const guideRows = instructions && instructions.length > 0
    ? instructions.map((instruction, index) => [GUIDE_STEPS[index]?.[0] ?? `打印机操作 ${index + 1}`, instruction] as const)
    : GUIDE_STEPS

  return (
    <KioskPageFrame className="w2-scan-page">
      <div data-w2-page="scan-settings" className="w2-scan-shell">
        <KioskPageHeader title="扫描指引" description="扫描任务已创建，请按本机下发的指引在打印机上操作" onBack={handleBack} backLabel="上一步（取消任务）" aside={<span className="w2-scan-status-chip is-ready"><span />扫描任务已创建</span>} />

        <div className="w2-scan-steps" aria-label="扫描流程">
          {(['选择类型', '扫描指引', '扫描中', '完成'] as const).map((label, index) => (
            <div key={label} className={index < 1 ? 'is-done' : index === 1 ? 'is-active' : ''}><span>{index < 1 ? <CheckIcon /> : index + 1}</span>{label}</div>
          ))}
        </div>

        <section className="w2-scan-content w2-scan-two-column">
          <section className="w2-scan-primary-card">
            <div className="w2-scan-card-title"><span><PrinterIcon /></span><div><h2>请到打印机操作面板依次操作</h2><p>以下内容来自当前扫描任务的服务端指引。</p></div></div>
            <div className="w2-scan-guide-list">
            {guideRows.map(([title, copy], index) => (
              <div key={`${title}-${index}`} className="w2-scan-guide-row">
                <span>{index + 1}</span><div><b>{title}</b><p>{copy}</p></div>
              </div>
            ))}
            </div>
          </section>

          <aside className="w2-scan-sidebar">
            {loading && <KioskStatePanel compact tone="loading" title="正在创建扫描任务" description="正在向设备下发当前任务，请稍候。" />}
            {error && <KioskStatePanel compact tone="error" title="扫描任务创建失败" description={error} />}
            <section className="w2-scan-info-card">
              <h2>任务信息</h2>
            {[
              ['扫描类型', SCAN_TYPE_LABELS[scanType]],
              ['任务编号', scanTaskId ?? '创建中'],
              ['剩余时间', countdown],
              ['输出格式', 'PDF（自动生成）'],
            ].map(([key, value]) => (
              <div key={key}><span>{key}</span><b>{value}</b></div>
            ))}
            </section>
            <p className="w2-scan-warning">扫描前请取下订书钉、回形针并抚平折角。点击返回会取消本次任务。</p>
          </aside>
        </section>

        <KioskActionBar leading={<span className="w2-scan-action-note"><ClockIcon />任务剩余 {countdown}</span>}>
          <Button variant="secondary" size="lg" onClick={handleBack}>返回（取消任务）</Button>
          <Button size="lg" disabled={!scanTaskId || !controlToken || starting} onClick={handleConfirm}>
            <CheckIcon />{starting ? '正在进入等待…' : '我已操作，开始等待'}
          </Button>
        </KioskActionBar>
      </div>
    </KioskPageFrame>
  )
}
