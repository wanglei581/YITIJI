import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, KioskActionBar, KioskPageFrame, KioskPageHeader, KioskStatePanel } from '@ai-job-print/ui'
import {
  ArrowRightIcon,
  CheckIcon,
  ClockIcon,
  CreditCardIcon,
  FileTextIcon,
  HeadphonesIcon,
  RefreshCwIcon,
  ScanIcon,
  ShieldCheckIcon,
  UploadIcon,
} from 'lucide-react'
import { useAuth } from '../../auth/useAuth'
import { API_BASE_URL } from '../../services/api/client'
import { ScanFlowSteps } from './ScanFlowSteps'
import './styles/scan-fusion.css'

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

const ALT_PATHS = [
  { title: '上传文件打印', desc: '手机 / U盘里的现成文件仍可打印', tone: 'ok' as const, chip: '可使用' },
  { title: 'U盘直插打印', desc: '打印机自带能力，U盘插打印机即可', tone: 'ok' as const, chip: '可使用' },
  { title: '扫描到 U盘', desc: '打印机面板自带，以设备现场提示为准', tone: 'ok' as const, chip: '可尝试' },
  { title: '本机发起扫描任务', desc: '需扫描仪就绪后才可创建', tone: 'warn' as const, chip: '暂不可用' },
]

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
    if (raw.includes('ready') || raw.includes('idle') || raw.includes('online')) return 'ready'
    if ('online' in scanner && (scanner as { online?: unknown }).online === true) return 'ready'
    return 'offline'
  }
  const raw = typeof data === 'string' ? data.toLowerCase() : ''
  if (raw.includes('busy')) return 'busy'
  if (raw.includes('offline')) return 'offline'
  if (raw.includes('ready') || raw.includes('idle') || raw.includes('online')) return 'ready'
  return 'offline'
}

async function fetchScannerStatus(token?: string | null): Promise<ScannerStatus> {
  const url = new URL(`${API_BASE_URL}/kiosk/device/status`, window.location.origin)
  const headers = new Headers({ Accept: 'application/json' })
  if (token) headers.set('Authorization', `Bearer ${token}`)
  const response = await fetch(url.toString(), { method: 'GET', headers, credentials: 'include' })
  if (!response.ok) return 'offline'
  return normalizeScannerStatus(await response.json())
}

function formatCheckTime(ts: number | null): string {
  if (!ts) return '尚未完成首次检测'
  return new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
}

export function ScanStartPage() {
  const navigate = useNavigate()
  const { getToken } = useAuth()
  const [selected, setSelected] = useState<ScanType>('resume')
  const [scannerStatus, setScannerStatus] = useState<ScannerStatus>('offline')
  const [checking, setChecking] = useState(false)
  const [lastCheckedAt, setLastCheckedAt] = useState<number | null>(null)
  const [retryCount, setRetryCount] = useState(0)

  const refreshStatus = useCallback(async () => {
    setChecking(true)
    try {
      const next = await fetchScannerStatus(getToken())
      setScannerStatus(next)
    } catch {
      setScannerStatus('offline')
    } finally {
      setLastCheckedAt(Date.now())
      setRetryCount((count) => count + 1)
      setChecking(false)
    }
  }, [getToken])

  useEffect(() => {
    let stopped = false
    const refresh = async () => {
      try {
        const next = await fetchScannerStatus(getToken())
        if (!stopped) {
          setScannerStatus(next)
          setLastCheckedAt(Date.now())
          setRetryCount((count) => count + 1)
        }
      } catch {
        if (!stopped) {
          setScannerStatus('offline')
          setLastCheckedAt(Date.now())
          setRetryCount((count) => count + 1)
        }
      }
    }
    void refresh()
    const timer = window.setInterval(() => void refresh(), 30_000)
    return () => { stopped = true; window.clearInterval(timer) }
  }, [getToken])

  const hardwareBlocked = scannerStatus === 'offline' || scannerStatus === 'busy'
  const statusLabel =
    scannerStatus === 'busy' ? '扫描仪忙碌' :
    scannerStatus === 'offline' ? '扫描仪暂不可用' :
    '扫描仪就绪'

  return (
    <KioskPageFrame className="w2-scan-page">
      <div data-w2-page="scan-start" className="w2-scan-shell">
        <KioskPageHeader
          title="材料扫描"
          description={
            hardwareBlocked
              ? '扫描仪当前无法使用，暂不能创建扫描任务'
              : '请选择扫描类型，不同类型对应不同的后续用途'
          }
          onBack={() => navigate('/print-scan')}
          backLabel="返回打印扫描服务"
          aside={<span className={`w2-scan-status-chip is-${scannerStatus}`}><span />{statusLabel}</span>}
        />

        <ScanFlowSteps activeIndex={0} />

        <section className="w2-scan-content">
          {hardwareBlocked ? (
            <>
              <p className="w2-scan-notice is-warn">
                本机检测到扫描仪未就绪（离线、正忙或需要处理），现在无法开始扫描；请稍后重试或改用下方仍可用的方式。
              </p>
              <div className="w2-scan-off-wrap">
                <section className="w2-scan-off-main" aria-label="扫描仪不可用">
                  <KioskStatePanel
                    tone="offline"
                    title="扫描仪暂不可用"
                    description="本机与打印机 / 扫描仪的连接未就绪，或设备正在处理其他任务。系统正在自动检测，恢复后可继续创建扫描任务。"
                    icon={<ScanIcon aria-hidden="true" />}
                    actions={(
                      <>
                        <Button size="lg" className="min-h-14" disabled={checking} onClick={() => void refreshStatus()}>
                          <RefreshCwIcon aria-hidden="true" />
                          {checking ? '正在检测…' : '重新检测扫描仪'}
                        </Button>
                        <Button size="lg" variant="secondary" className="min-h-14" onClick={() => navigate('/help')}>
                          <HeadphonesIcon aria-hidden="true" />
                          联系工作人员
                        </Button>
                      </>
                    )}
                  />
                  <span className="w2-scan-check-meta">
                    <ClockIcon aria-hidden="true" />
                    最近检测 {formatCheckTime(lastCheckedAt)} · 每 30 秒自动重试，已检测 {retryCount} 次
                  </span>
                </section>
                <aside className="w2-scan-side-card w2-scan-alt-card">
                  <h2>你现在还能做什么</h2>
                  <ul className="w2-scan-alt-list">
                    {ALT_PATHS.map((item) => (
                      <li key={item.title}>
                        <span className="w2-scan-alt-copy">
                          <b>{item.title}</b>
                          <span>{item.desc}</span>
                        </span>
                        <small data-tone={item.tone}>{item.chip}</small>
                      </li>
                    ))}
                  </ul>
                  <div className="w2-scan-privacy">
                    <ShieldCheckIcon aria-hidden="true" />
                    若长时间未恢复，请到服务台联系现场工作人员检查设备连接与纸张状态。
                  </div>
                </aside>
              </div>
            </>
          ) : (
            <>
              <p className="w2-scan-notice">
                扫描说明：扫描在打印机设备上完成，本机负责创建任务并接收扫描文件；请按下一步指引在打印机操作面板上操作。
              </p>
              <div className="w2-scan-start-grid">
                <section className="w2-scan-type-list" aria-label="扫描类型">
                  {SCAN_TYPES.map(({ type, label, description, chips, icon: Icon }) => {
                    const isSelected = selected === type
                    return (
                      <button
                        key={type}
                        type="button"
                        onClick={() => setSelected(type)}
                        className={`w2-scan-choice ${isSelected ? 'is-selected' : ''}`}
                        aria-pressed={isSelected}
                      >
                        <span className="w2-scan-choice-icon"><Icon /></span>
                        <span className="w2-scan-choice-copy">
                          <b>{label}</b><span>{description}</span>
                          <span className="w2-scan-chips">
                            {chips.map((chip) => (
                              <small key={chip.label} data-tone={chip.tone}>{chip.label}</small>
                            ))}
                          </span>
                        </span>
                        <span className="w2-scan-choice-check"><CheckIcon /></span>
                      </button>
                    )
                  })}
                </section>
                <aside className="w2-scan-side-card">
                  <h2>扫描流程（共 4 步）</h2>
                  {FLOW_STEPS.map(([title, copy], index) => (
                    <div key={title} className="w2-scan-flow-row">
                      <span>{index + 1}</span><p><b>{title}</b>，{copy}</p>
                    </div>
                  ))}
                  <div className="w2-scan-privacy"><ShieldCheckIcon />扫描文件设有效期，未选择去向的文件会自动清理。</div>
                </aside>
              </div>
            </>
          )}
        </section>

        {hardwareBlocked ? (
          <KioskActionBar leading={<span className="w2-scan-action-note">设备恢复前不会创建扫描任务</span>}>
            <Button variant="secondary" size="lg" onClick={() => navigate('/print-scan')}>返回打印扫描</Button>
            <Button size="lg" onClick={() => navigate('/print/upload')}>
              <UploadIcon aria-hidden="true" />
              改用上传文件打印
            </Button>
          </KioskActionBar>
        ) : (
          <KioskActionBar leading={<span className="w2-scan-action-note">只有扫描仪就绪时才能创建任务</span>}>
            <Button variant="secondary" size="lg" onClick={() => navigate('/print-scan')}>返回</Button>
            <Button size="lg" disabled={scannerStatus !== 'ready'} onClick={() => navigate('/scan/settings', { state: { scanType: selected } })}>
              下一步 · 查看扫描指引 <ArrowRightIcon />
            </Button>
          </KioskActionBar>
        )}
      </div>
    </KioskPageFrame>
  )
}
