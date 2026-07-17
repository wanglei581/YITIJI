import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  CreditCardIcon,
  FileTextIcon,
  InfoIcon,
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

function chipClass(tone?: 'ok' | 'warn') {
  if (tone === 'ok') return 'bg-success-bg text-success-fg'
  if (tone === 'warn') return 'bg-warning-bg text-warning-fg'
  return 'bg-neutral-50 text-neutral-600'
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
  const response = await fetch(url.toString(), {
    method: 'GET',
    headers,
    credentials: 'include',
  })
  if (!response.ok) return 'offline'
  return normalizeScannerStatus(await response.json())
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
    return () => {
      stopped = true
      window.clearInterval(timer)
    }
  }, [getToken])

  const statusLabel = scannerStatus === 'busy' ? '扫描仪忙碌' : scannerStatus === 'offline' ? '扫描仪离线' : '扫描仪就绪'
  const statusClass = scannerStatus === 'offline' ? 'bg-error-bg text-error-fg' : scannerStatus === 'busy' ? 'bg-warning-bg text-warning-fg' : 'bg-success-bg text-success-fg'

  return (
    <div className="flex h-full flex-col bg-canvas px-6 py-5 text-neutral-900">
      <header className="flex h-[72px] shrink-0 items-center justify-between rounded-lg bg-dark px-6 text-surface shadow-sm">
        <div>
          <b className="block text-[21px] font-bold">就业服务大厅 · 01号机</b>
          <span className="mt-1 block text-sm text-neutral-100">AI求职打印服务终端</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-base text-neutral-100">2026年7月17日 10:24</span>
          <span className={['inline-flex h-10 items-center gap-2 rounded-full px-4 text-base font-semibold', statusClass].join(' ')}>
            <span className="h-2.5 w-2.5 rounded-full bg-current" />
            {statusLabel}
          </span>
        </div>
      </header>

      <div className="mt-5 flex shrink-0 items-center gap-5">
        <button
          type="button"
          onClick={() => navigate('/print-scan')}
          className="inline-flex h-14 items-center gap-2 rounded-md border border-neutral-200 bg-surface px-5 text-lg font-semibold text-neutral-700"
        >
          <ArrowLeftIcon className="h-5 w-5" />
          返回
        </button>
        <div>
          <h1 className="font-serif text-[42px] font-black leading-tight tracking-normal">材料扫描</h1>
          <p className="mt-1 text-xl text-neutral-500">请选择扫描类型，不同类型对应不同的后续用途</p>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-[auto_1fr_auto_1fr_auto_1fr_auto] items-center gap-3 rounded-lg border border-neutral-200 bg-surface px-5 py-4">
        {['选择类型', '扫描指引', '扫描中', '完成'].map((label, index) => (
          <div key={label} className="contents">
            <div className={['flex items-center gap-2 text-lg font-semibold', index === 0 ? 'text-primary-700' : 'text-neutral-400'].join(' ')}>
              <span className={['grid h-9 w-9 place-items-center rounded-full text-base font-bold', index === 0 ? 'bg-primary-600 text-surface' : 'bg-neutral-100 text-neutral-400'].join(' ')}>
                {index + 1}
              </span>
              <span>{label}</span>
            </div>
            {index < 3 && <div className="h-px bg-neutral-200" />}
          </div>
        ))}
      </div>

      <main className="mt-4 flex min-h-0 flex-1 flex-col gap-4">
        <div className="flex items-center gap-3 rounded-lg border border-primary-200 bg-primary-50 px-5 py-4 text-lg leading-relaxed text-primary-800">
          <InfoIcon className="h-6 w-6 shrink-0" />
          扫描说明：扫描在打印机设备上完成，本机负责创建任务并接收扫描文件；请按下一步指引在打印机操作面板上操作。
        </div>

        <div className="flex min-h-0 flex-1 gap-5">
          <div className="flex min-w-0 flex-1 flex-col gap-4">
            {SCAN_TYPES.map(({ type, label, description, chips, icon: Icon }) => {
              const isSelected = selected === type
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => setSelected(type)}
                  className={[
                    'flex flex-1 items-center gap-6 rounded-lg border-2 bg-surface px-7 py-5 text-left transition active:scale-[0.99]',
                    isSelected ? 'border-primary-600 bg-primary-50' : 'border-neutral-200',
                  ].join(' ')}
                >
                  <span className={['grid h-[84px] w-[84px] shrink-0 place-items-center rounded-[20px] border', isSelected ? 'border-primary-600 bg-primary-600 text-surface' : 'border-neutral-200 bg-canvas text-primary-700'].join(' ')}>
                    <Icon className="h-11 w-11" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <b className="block font-serif text-[30px] font-bold tracking-normal">{label}</b>
                    <span className="mt-1 block text-[19px] leading-relaxed text-neutral-500">{description}</span>
                    <span className="mt-3 flex flex-wrap gap-2.5">
                      {chips.map((chip) => (
                        <span key={chip.label} className={['rounded-full px-3.5 py-1.5 text-base font-semibold', chipClass(chip.tone)].join(' ')}>
                          {chip.label}
                        </span>
                      ))}
                    </span>
                  </span>
                  <span className={['grid h-11 w-11 shrink-0 place-items-center rounded-full border-2', isSelected ? 'border-primary-600 bg-primary-600 text-surface' : 'border-neutral-200 text-transparent'].join(' ')}>
                    <CheckIcon className="h-6 w-6" />
                  </span>
                </button>
              )
            })}
          </div>

          <aside className="flex w-[400px] shrink-0 flex-col gap-4">
            <section className="flex flex-1 flex-col rounded-lg border border-primary-200 bg-surface p-5 shadow-sm">
              <b className="mb-3 block text-[21px] font-bold">扫描流程（共 4 步）</b>
              {FLOW_STEPS.map(([title, copy], index) => (
                <div key={title} className="flex flex-1 items-center gap-3 border-b border-dashed border-neutral-200 py-2 last:border-b-0">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary-50 text-lg font-bold text-primary-700">{index + 1}</span>
                  <p className="text-[17.5px] leading-relaxed text-neutral-500">
                    <b className="font-semibold text-neutral-900">{title}</b>，{copy}
                  </p>
                </div>
              ))}
            </section>

            <section className="rounded-lg border border-neutral-200 bg-surface p-5 shadow-sm">
              <b className="mb-3 block text-xl font-bold">
                本机扫描能力 <span className="text-[15px] font-normal text-neutral-500">以本机实际配置为准</span>
              </b>
              <div className="flex flex-wrap gap-2.5">
                {['彩色 / 黑白', 'A4 幅面', '输稿器一次最多 50 页', '平板适合证书单页', '生成 PDF 文件'].map((item, index) => (
                  <span key={item} className={['rounded-full px-3.5 py-1.5 text-base font-semibold', index === 0 ? 'bg-success-bg text-success-fg' : 'bg-neutral-50 text-neutral-600'].join(' ')}>
                    {item}
                  </span>
                ))}
              </div>
            </section>

            <div className="flex items-start gap-3 rounded-lg border border-primary-200 bg-primary-50 px-5 py-4 text-base leading-relaxed text-primary-800">
              <ShieldCheckIcon className="mt-0.5 h-5 w-5 shrink-0" />
              扫描文件设有效期，过期自动清理；未保存去向的文件在本次服务结束后删除。
            </div>
          </aside>
        </div>
      </main>

      <div className="mt-5 flex h-[76px] shrink-0 items-center gap-4 border-t border-neutral-200 bg-canvas pt-4">
        <button
          type="button"
          onClick={() => navigate('/print-scan')}
          className="inline-flex h-14 items-center gap-2 rounded-md border border-neutral-200 bg-surface px-7 text-lg font-semibold text-neutral-700"
        >
          <ArrowLeftIcon className="h-5 w-5" />
          返回
        </button>
        <span className="flex-1" />
        <button
          type="button"
          disabled={scannerStatus === 'offline'}
          onClick={() => navigate('/scan/settings', { state: { scanType: selected } })}
          className="inline-flex h-14 min-w-[420px] items-center justify-center gap-2 rounded-md bg-primary-600 px-9 text-lg font-bold text-surface disabled:bg-neutral-300 disabled:text-neutral-500"
        >
          <ArrowRightIcon className="h-5 w-5" />
          下一步 · 查看扫描指引
        </button>
      </div>
    </div>
  )
}
