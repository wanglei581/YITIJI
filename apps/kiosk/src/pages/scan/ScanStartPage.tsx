import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  CreditCardIcon,
  FileTextIcon,
  ScanIcon,
  ShieldCheckIcon,
} from 'lucide-react'
import { useAuth } from '../../auth/useAuth'
import { API_BASE_URL } from '../../services/api/client'

type ScanType = 'resume' | 'id' | 'document'
type ScannerStatus = 'ready' | 'offline' | 'busy'

interface ScanTypeOption {
  type: ScanType
  label: string
  description: string
  chips: { label: string; tone?: 'ok' | 'warn' }[]
  icon: React.ComponentType<{ className?: string }>
}

const SCAN_TYPES: ScanTypeOption[] = [
  {
    type: 'resume',
    label: '简历扫描',
    description: '扫描纸质简历，可直接进入 AI 识别与优化，也可存档打印',
    chips: [{ label: '支持 AI 简历识别', tone: 'ok' }, { label: '生成 PDF' }],
    icon: FileTextIcon,
  },
  {
    type: 'id',
    label: '证件扫描',
    description: '扫描证件原件生成存档 PDF；证件类文件设有效期并自动清理',
    chips: [{ label: '敏感文件 · 自动清理', tone: 'warn' }, { label: '生成 PDF' }],
    icon: CreditCardIcon,
  },
  {
    type: 'document',
    label: '普通文档',
    description: '扫描通用文件生成 PDF 存档，可保存到「我的文档」或直接打印',
    chips: [{ label: '生成 PDF' }, { label: '可存档 / 打印' }],
    icon: ScanIcon,
  },
]

const FLOW_STEPS = [
  ['选择扫描类型', '点击下方「下一步」创建扫描任务'],
  ['按屏幕指引', '到打印机放好原件，在操作面板上发起扫描'],
  ['本机自动检测', '扫描结果，期间请勿关闭页面'],
  ['选择文件去向', '打印、保存到我的文档或 AI 简历识别'],
] as const

// 扫描类型卡片 chip 样式
function chipClass(tone?: 'ok' | 'warn') {
  if (tone === 'ok') return 'bg-success-bg text-success-fg border border-primary-200'
  if (tone === 'warn') return 'bg-warning-bg text-warning-fg border border-warning/30'
  // 原型 .chip：纸色底 + 线条边框
  return 'bg-canvas border border-neutral-200 text-neutral-500'
}

function normalizeScannerStatus(payload: unknown): ScannerStatus {
  const data = payload && typeof payload === 'object' && 'data' in payload
    ? (payload as { data?: unknown }).data
    : payload
  const scanner = data && typeof data === 'object' && 'scanner' in data
    ? (data as { scanner?: unknown }).scanner
    : data
  if (scanner && typeof scanner === 'object') {
    const raw = 'status' in scanner ? String((scanner as { status?: unknown }).status ?? '').toLowerCase() : ''
    if (raw.includes('busy') || raw.includes('work') || raw.includes('scan')) return 'busy'
    if (raw.includes('offline') || raw.includes('error') || raw.includes('down')) return 'offline'
    if ('online' in scanner && (scanner as { online?: unknown }).online === false) return 'offline'
    if ('busy' in scanner && (scanner as { busy?: unknown }).busy === true) return 'busy'
  }
  const raw = typeof data === 'string' ? data.toLowerCase() : ''
  if (raw.includes('busy')) return 'busy'
  if (raw.includes('offline')) return 'offline'
  return 'ready'
}

async function fetchScannerStatus(token?: string | null): Promise<ScannerStatus> {
  const url = new URL(`${API_BASE_URL}/kiosk/device/status`, window.location.origin)
  const headers = new Headers({ Accept: 'application/json' })
  if (token) headers.set('Authorization', `Bearer ${token}`)
  const response = await fetch(url.toString(), { method: 'GET', headers, credentials: 'include' })
  if (!response.ok) return 'offline'
  return normalizeScannerStatus(await response.json())
}

// 原型 .status-chip：根据状态切换 rgba 背景/边框颜色
function statusChipStyle(status: ScannerStatus): React.CSSProperties {
  if (status === 'offline') {
    return {
      background: 'rgba(193,74,52,.15)',
      border: '1px solid rgba(193,74,52,.4)',
    }
  }
  if (status === 'busy') {
    return {
      background: 'rgba(184,104,60,.18)',
      border: '1px solid rgba(184,104,60,.45)',
    }
  }
  // ready — 原型品牌青
  return {
    background: 'rgba(31,158,134,.18)',
    border: '1px solid rgba(31,158,134,.45)',
  }
}

function statusDotStyle(status: ScannerStatus): React.CSSProperties {
  if (status === 'offline') {
    return { background: '#c14a34', boxShadow: '0 0 0 4px rgba(193,74,52,.2)' }
  }
  if (status === 'busy') {
    return { background: '#b8683c', boxShadow: '0 0 0 4px rgba(184,104,60,.2)' }
  }
  return { background: '#35ab8e', boxShadow: '0 0 0 4px rgba(53,171,142,.2)' }
}

export function ScanStartPage() {
  const navigate = useNavigate()
  const { getToken } = useAuth()
  const [selected, setSelected] = useState<ScanType>('resume')
  const [scannerStatus, setScannerStatus] = useState<ScannerStatus>('ready')

  useEffect(() => {
    let stopped = false
    const refresh = async () => {
      try {
        const next = await fetchScannerStatus(getToken())
        if (!stopped) setScannerStatus(next)
      } catch {
        if (!stopped) setScannerStatus('offline')
      }
    }
    void refresh()
    const timer = window.setInterval(() => void refresh(), 30_000)
    return () => { stopped = true; window.clearInterval(timer) }
  }, [getToken])

  const statusLabel =
    scannerStatus === 'busy' ? '扫描仪忙碌' :
    scannerStatus === 'offline' ? '扫描仪离线' :
    '扫描仪就绪'

  return (
    /* 外层不加水平内边距——顶栏需要撑满全宽 */
    <div className="flex h-full flex-col overflow-hidden bg-canvas text-neutral-900">

      {/* ── 顶栏（原型 .topbar，全宽、墨绿底） ── */}
      <header className="flex h-[76px] shrink-0 items-center justify-between bg-dark px-11 text-[#f4f1e8]">
        <div className="flex items-baseline gap-[18px]">
          <b className="font-serif text-[26px] font-bold tracking-wide">就业服务大厅 · 01号机</b>
          <span className="text-xl opacity-55">AI求职打印服务终端</span>
        </div>
        <div className="flex items-center gap-7 text-xl">
          <span className="opacity-85 tabular-nums">2026年7月17日 10:24</span>
          {/* 原型 .status-chip：rgba 背景 + 发光小圆点 */}
          <span
            className="inline-flex items-center gap-[10px] rounded-full px-[18px] py-2 text-[19px]"
            style={statusChipStyle(scannerStatus)}
          >
            <span
              className="h-[11px] w-[11px] shrink-0 rounded-full"
              style={statusDotStyle(scannerStatus)}
            />
            {statusLabel}
          </span>
        </div>
      </header>

      {/* ── 页头（原型 .pagehead）：返回 + 标题 ── */}
      <div className="flex shrink-0 items-center gap-[26px] px-12 pb-[26px] pt-[34px]">
        <button
          type="button"
          onClick={() => navigate('/print-scan')}
          className="inline-flex h-[72px] shrink-0 items-center gap-3 rounded-[14px] border border-neutral-200 bg-surface px-[30px] text-2xl font-semibold text-neutral-800 shadow-sm active:scale-[0.97]"
        >
          <ArrowLeftIcon className="h-[26px] w-[26px]" />
          返回
        </button>
        <div>
          <h1 className="font-serif text-[44px] font-black leading-tight tracking-[2px]">材料扫描</h1>
          <p className="mt-2 text-[22px] tracking-wide text-neutral-500">请选择扫描类型，不同类型对应不同的后续用途</p>
        </div>
      </div>

      {/* ── 步骤指示器（原型 .steps，裸浮 flex 非卡片） ── */}
      <div className="flex shrink-0 items-center px-12 pb-6">
        {['选择类型', '扫描指引', '扫描中', '完成'].map((label, index) => (
          <div key={label} className="contents">
            <div className={['flex items-center gap-3', index === 0 ? 'text-neutral-900' : 'text-neutral-400'].join(' ')}>
              <span className={[
                'grid h-11 w-11 shrink-0 place-items-center rounded-full text-xl font-bold',
                index === 0
                  ? 'bg-primary-600 text-surface'
                  : 'border-2 border-neutral-200 bg-surface text-neutral-400',
              ].join(' ')}>
                {index + 1}
              </span>
              <span className={['text-xl', index === 0 ? 'font-semibold' : ''].join(' ')}>{label}</span>
            </div>
            {index < 3 && (
              <div className="mx-4 h-0.5 min-w-[40px] flex-1 bg-neutral-200" />
            )}
          </div>
        ))}
      </div>

      {/* ── 主内容区（原型 .content）── */}
      <main className="flex min-h-0 flex-1 flex-col gap-6 overflow-hidden px-12">

        {/* 扫描说明通知条（原型 .notice：虚线边框、浅底、小麦色图标） */}
        <div className="flex shrink-0 items-center gap-3 rounded-xl border border-dashed border-neutral-300 bg-surface/80 px-5 py-3 text-[17px] leading-relaxed text-neutral-500">
          <svg className="h-5 w-5 shrink-0 text-[#a9781f]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
            <circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16.5v.5"/>
          </svg>
          扫描说明：扫描在打印机设备上完成，本机负责创建任务并接收扫描文件；请按下一步指引在打印机操作面板上操作。
        </div>

        {/* 左右分栏 */}
        <div className="flex min-h-0 flex-1 gap-[22px]">

          {/* 左：三种扫描类型卡 */}
          <div className="flex min-w-0 flex-1 flex-col gap-[18px]">
            {SCAN_TYPES.map(({ type, label, description, chips, icon: Icon }) => {
              const isSelected = selected === type
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => setSelected(type)}
                  className={[
                    'flex flex-1 items-center gap-[22px] rounded-[18px] border-2 px-7 py-6 text-left transition active:scale-[0.99]',
                    isSelected
                      ? 'border-primary-600 bg-primary-100'
                      : 'border-neutral-200 bg-surface',
                  ].join(' ')}
                >
                  {/* 图标区：选中时品牌青底白图，未选时纸色底青色图 */}
                  <span className={[
                    'grid h-[84px] w-[84px] shrink-0 place-items-center rounded-[20px] border',
                    isSelected
                      ? 'border-primary-600 bg-primary-600 text-surface'
                      : 'border-neutral-200 bg-canvas text-primary-700',
                  ].join(' ')}>
                    <Icon className="h-11 w-11" />
                  </span>

                  {/* 文字区 */}
                  <span className="min-w-0 flex-1">
                    <b className="block font-serif text-[30px] font-bold tracking-wide">{label}</b>
                    <span className="mt-1.5 block text-[19px] leading-relaxed text-neutral-500">{description}</span>
                    <span className="mt-3 flex flex-wrap gap-2.5">
                      {chips.map((chip) => (
                        <span
                          key={chip.label}
                          className={['inline-flex items-center rounded-full px-4 py-2 text-base font-semibold', chipClass(chip.tone)].join(' ')}
                        >
                          {chip.label}
                        </span>
                      ))}
                    </span>
                  </span>

                  {/* 选中指示圆 */}
                  <span className={[
                    'grid h-11 w-11 shrink-0 place-items-center rounded-full border-2',
                    isSelected
                      ? 'border-primary-600 bg-primary-600 text-surface'
                      : 'border-neutral-200 text-transparent',
                  ].join(' ')}>
                    <CheckIcon className="h-6 w-6" />
                  </span>
                </button>
              )
            })}
          </div>

          {/* 右：流程说明 + 设备能力 + 安全提示 */}
          <aside className="flex w-[400px] shrink-0 flex-col gap-4">

            {/* 扫描流程卡（原型 .card.accented.a-teal：顶边青色 4px 强调条） */}
            <section className="flex flex-1 flex-col rounded-[18px] border border-neutral-200 border-t-4 border-t-primary-600 bg-surface p-5 shadow-sm">
              <b className="mb-3 block text-[21px] font-bold">扫描流程（共 4 步）</b>
              {FLOW_STEPS.map(([title, copy], index) => (
                <div
                  key={title}
                  className="flex flex-1 items-center gap-[14px] border-b border-dashed border-neutral-200 py-2.5 last:border-b-0"
                >
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary-100 text-lg font-bold text-primary-700">
                    {index + 1}
                  </span>
                  <p className="text-[17.5px] leading-relaxed text-neutral-500">
                    <b className="font-semibold text-neutral-900">{title}</b>，{copy}
                  </p>
                </div>
              ))}
            </section>

            {/* 本机扫描能力 */}
            <section className="rounded-[18px] border border-neutral-200 bg-surface p-5 shadow-sm">
              <b className="mb-3 block text-xl font-bold">
                本机扫描能力{' '}
                <span className="text-[15px] font-normal text-neutral-500">以本机实际配置为准</span>
              </b>
              <div className="flex flex-wrap gap-2.5">
                {[
                  { label: '彩色 / 黑白', tone: 'ok' },
                  { label: 'A4 幅面' },
                  { label: '输稿器一次最多 50 页' },
                  { label: '平板适合证书单页' },
                  { label: '生成 PDF 文件' },
                ].map(({ label, tone }) => (
                  <span
                    key={label}
                    className={[
                      'inline-flex items-center rounded-full px-4 py-2 text-base font-semibold',
                      tone === 'ok'
                        ? 'bg-success-bg text-success-fg border border-primary-200'
                        : 'bg-canvas border border-neutral-200 text-neutral-500',
                    ].join(' ')}
                  >
                    {label}
                  </span>
                ))}
              </div>
            </section>

            {/* 安全提示（原型 .notice：虚线、浅底、盾牌图标） */}
            <div className="flex items-start gap-3 rounded-xl border border-dashed border-neutral-300 bg-surface/80 px-5 py-3 text-base leading-relaxed text-neutral-500">
              <ShieldCheckIcon className="mt-0.5 h-5 w-5 shrink-0 text-[#a9781f]" />
              扫描文件设有效期，过期自动清理；未保存去向的文件在本次服务结束后删除。
            </div>
          </aside>
        </div>
      </main>

      {/* ── 底部行动条（原型 .actionbar：surface 底 + 边框线 + 大内边距） ── */}
      <div className="flex shrink-0 items-center gap-5 border-t border-neutral-200 bg-surface px-12 pb-[34px] pt-[26px]">
        <button
          type="button"
          onClick={() => navigate('/print-scan')}
          className="inline-flex h-[88px] items-center gap-[14px] rounded-[18px] border border-neutral-200 bg-surface px-11 text-[27px] font-semibold text-neutral-800 active:scale-[0.98]"
        >
          <ArrowLeftIcon className="h-8 w-8" />
          返回
        </button>
        <span className="flex-1" />
        <button
          type="button"
          disabled={scannerStatus === 'offline'}
          onClick={() => navigate('/scan/settings', { state: { scanType: selected } })}
          className="inline-flex h-[88px] min-w-[420px] items-center justify-center gap-[14px] rounded-[18px] bg-primary-600 px-11 text-[27px] font-semibold tracking-wide text-surface shadow-[0_6px_18px_rgba(31,158,134,.25)] active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-400 disabled:shadow-none"
        >
          <ArrowRightIcon className="h-8 w-8" />
          下一步 · 查看扫描指引
        </button>
      </div>
    </div>
  )
}

