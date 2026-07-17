import { useEffect, useRef, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Button } from '@ai-job-print/ui'
import {
  AlertCircleIcon,
  ArrowLeftIcon,
  CheckIcon,
  ClockIcon,
  LoaderIcon,
  PrinterIcon,
  ShieldAlertIcon,
} from 'lucide-react'
import type { ScanSessionCreateResponse } from '@ai-job-print/shared'
import { useAuth } from '../../auth/useAuth'
import { useBusyLock } from '../../contexts/KioskBusyContext'
import { getTerminalId } from '../../services/api/screensaver'
import { cancelScanSession, createScanSession } from '../../services/api/scanTasks'

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
    <div className="flex h-full flex-col bg-canvas px-6 py-5 text-neutral-900">
      <header className="flex h-[72px] shrink-0 items-center justify-between rounded-lg bg-dark px-6 text-surface shadow-sm">
        <div>
          <b className="block text-[21px] font-bold">就业服务大厅 · 01号机</b>
          <span className="mt-1 block text-sm text-neutral-100">AI求职打印服务终端</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-base text-neutral-100">2026年7月17日 10:25</span>
          <span className="inline-flex h-10 items-center gap-2 rounded-full bg-success-bg px-4 text-base font-semibold text-success-fg">
            <span className="h-2.5 w-2.5 rounded-full bg-current" />
            扫描仪就绪
          </span>
        </div>
      </header>

      <div className="mt-5 flex shrink-0 items-center gap-5">
        <button
          type="button"
          onClick={handleBack}
          className="inline-flex h-14 items-center gap-2 rounded-md border border-neutral-200 bg-surface px-5 text-lg font-semibold text-neutral-700"
        >
          <ArrowLeftIcon className="h-5 w-5" />
          上一步
        </button>
        <div>
          <h1 className="font-serif text-[42px] font-black leading-tight tracking-normal">扫描指引</h1>
          <p className="mt-1 text-xl text-neutral-500">扫描任务已创建，请按下方指引在打印机上操作</p>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-[auto_1fr_auto_1fr_auto_1fr_auto] items-center gap-3 rounded-lg border border-neutral-200 bg-surface px-5 py-4">
        {['选择类型', '扫描指引', '扫描中', '完成'].map((label, index) => (
          <div key={label} className="contents">
            <div className={['flex items-center gap-2 text-lg font-semibold', index < 2 ? 'text-primary-700' : 'text-neutral-400'].join(' ')}>
              <span className={['grid h-9 w-9 place-items-center rounded-full text-base font-bold', index < 1 ? 'bg-primary-600 text-surface' : index === 1 ? 'bg-primary-600 text-surface' : 'bg-neutral-100 text-neutral-400'].join(' ')}>
                {index < 1 ? <CheckIcon className="h-5 w-5" /> : index + 1}
              </span>
              <span>{label}</span>
            </div>
            {index < 3 && <div className={['h-px', index < 1 ? 'bg-primary-600' : 'bg-neutral-200'].join(' ')} />}
          </div>
        ))}
      </div>

      <main className="mt-4 flex min-h-0 flex-1 gap-5">
        <section className="flex min-w-0 flex-1 flex-col rounded-lg border border-primary-200 bg-surface p-6 shadow-sm">
          <div className="mb-4 flex items-center gap-3">
            <span className="grid h-12 w-12 place-items-center rounded-full bg-primary-50 text-primary-700">
              <PrinterIcon className="h-6 w-6" />
            </span>
            <div>
              <h2 className="text-[26px] font-bold">请到打印机操作面板依次操作</h2>
              <p className="mt-1 text-base text-neutral-500">以下步骤以本机实际下发的指引为准，操作完成后回到屏幕前等待</p>
            </div>
          </div>
          <div className="flex min-h-0 flex-1 flex-col justify-center">
            {guideRows.map(([title, copy], index) => (
              <div key={title} className="flex flex-1 items-center gap-5 border-b border-dashed border-neutral-200 py-4 last:border-b-0">
                <span className="grid h-[52px] w-[52px] shrink-0 place-items-center rounded-full bg-primary-50 text-2xl font-bold text-primary-700">{index + 1}</span>
                <div>
                  <b className="block text-[23px] font-bold">{title}</b>
                  <p className="mt-1 text-lg leading-relaxed text-neutral-500">{copy}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <aside className="flex w-[420px] shrink-0 flex-col gap-4">
          <section className="rounded-lg border border-primary-200 bg-surface p-5 shadow-sm">
            <div className="mb-3 flex items-center gap-3">
              <span className="h-3.5 w-3.5 rounded-full bg-primary-600 shadow-[0_0_0_5px_rgba(31,158,134,0.18)]" />
              <b className="text-xl font-bold text-primary-700">
                {loading ? '正在创建扫描任务…' : error ? '扫描任务创建失败' : '扫描任务已创建，等待打印机端操作'}
              </b>
            </div>
            {loading && (
              <div className="mb-3 flex items-center gap-2 rounded-md bg-primary-50 px-3 py-2 text-base text-primary-700">
                <LoaderIcon className="h-5 w-5 animate-spin" />
                正在向设备下发扫描任务
              </div>
            )}
            {error && (
              <div className="mb-3 flex items-start gap-2 rounded-md bg-error-bg px-3 py-2 text-base text-error-fg">
                <AlertCircleIcon className="mt-0.5 h-5 w-5 shrink-0" />
                {error}
              </div>
            )}
            {[
              ['扫描类型', SCAN_TYPE_LABELS[scanType]],
              ['任务编号', scanTaskId ?? '创建中'],
              ['剩余时间', countdown],
              ['输出格式', 'PDF（自动生成）'],
            ].map(([key, value]) => (
              <div key={key} className="flex items-baseline justify-between gap-3 border-b border-dashed border-neutral-200 py-2.5 last:border-b-0">
                <span className="text-[17.5px] text-neutral-500">{key}</span>
                <span className="text-right text-[18.5px] font-semibold text-neutral-900">{value}</span>
              </div>
            ))}
          </section>

          <section className="rounded-lg border border-neutral-200 bg-surface p-5 shadow-sm">
            <b className="mb-3 block text-xl font-bold">原件放置位置</b>
            <div className="flex gap-3">
              <div className="flex-1 rounded-md border border-neutral-200 bg-canvas p-4">
                <b className="text-lg font-bold">输稿器（多页）</b>
                <p className="mt-2 text-[15.5px] leading-relaxed text-neutral-500">正面朝上放入顶部输稿器，一次最多 50 页</p>
              </div>
              <div className="flex-1 rounded-md border border-neutral-200 bg-canvas p-4">
                <b className="text-lg font-bold">玻璃板（单页）</b>
                <p className="mt-2 text-[15.5px] leading-relaxed text-neutral-500">正面朝下对齐左上角，适合证书、证件</p>
              </div>
            </div>
          </section>

          <section className="flex flex-1 flex-col rounded-lg border border-neutral-200 bg-surface p-5 shadow-sm">
            <b className="mb-2 block text-xl font-bold">注意事项</b>
            {[
              '扫描前请取下订书钉、回形针并抚平折角，避免卡纸或图像歪斜。',
              '任务超时未收到扫描结果会自动结束，可返回重新创建。',
              '点击「返回」将取消本次扫描任务，不会保留任何文件。',
            ].map((tip) => (
              <div key={tip} className="flex flex-1 items-center gap-3 border-b border-dashed border-neutral-200 py-2 last:border-b-0">
                <ShieldAlertIcon className="h-5 w-5 shrink-0 text-warning-fg" />
                <p className="text-[16.5px] leading-relaxed text-neutral-500">{tip}</p>
              </div>
            ))}
          </section>
        </aside>
      </main>

      <div className="mt-5 flex h-[76px] shrink-0 items-center gap-4 border-t border-neutral-200 bg-canvas pt-4">
        <Button variant="secondary" size="lg" className="h-14 px-7 text-lg" onClick={handleBack}>
          <ArrowLeftIcon className="mr-2 h-5 w-5" />
          返回（取消任务）
        </Button>
        <span className="flex-1" />
        <Button size="lg" className="h-14 min-w-[500px] text-lg" disabled={!scanTaskId || !controlToken || starting} onClick={handleConfirm}>
          <CheckIcon className="mr-2 h-5 w-5" />
          {starting ? '正在进入等待…' : '我已在打印机上操作，开始等待'}
        </Button>
        <span className="inline-flex items-center gap-2 text-lg font-semibold text-neutral-500">
          <ClockIcon className="h-5 w-5" />
          {countdown}
        </span>
      </div>
    </div>
  )
}
