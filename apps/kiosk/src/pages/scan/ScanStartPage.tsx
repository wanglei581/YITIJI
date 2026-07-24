import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, KioskActionBar, KioskPageFrame, KioskPageHeader, KioskStatePanel } from '@ai-job-print/ui'
import {
  ArrowRightIcon,
  CheckIcon,
  CreditCardIcon,
  FileTextIcon,
  ScanIcon,
  ShieldCheckIcon,
} from 'lucide-react'
import { useAuth } from '../../auth/useAuth'
import { API_BASE_URL } from '../../services/api/client'
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

export function ScanStartPage() {
  const navigate = useNavigate()
  const { getToken } = useAuth()
  const [selected, setSelected] = useState<ScanType>('resume')
  const [scannerStatus, setScannerStatus] = useState<ScannerStatus>('offline')

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
    <KioskPageFrame className="w2-scan-page">
      <div data-w2-page="scan-start" className="w2-scan-shell">
        <KioskPageHeader
          title="材料扫描"
          description="请选择扫描类型，不同类型对应不同的后续用途"
          onBack={() => navigate('/print-scan')}
          backLabel="返回打印扫描服务"
          aside={<span className={`w2-scan-status-chip is-${scannerStatus}`}><span />{statusLabel}</span>}
        />

        <div className="w2-scan-steps" aria-label="扫描流程">
          {['选择类型', '扫描指引', '扫描中', '完成'].map((label, index) => (
            <div key={label} className={index === 0 ? 'is-active' : ''}><span>{index + 1}</span>{label}</div>
          ))}
        </div>

        <section className="w2-scan-content">
          <p className="w2-scan-notice">扫描在打印机设备上完成，本机只负责创建任务并接收扫描文件。</p>
          {scannerStatus === 'offline' && (
            <KioskStatePanel compact tone="offline" title="扫描仪当前离线" description="请检查设备连接或联系工作人员；设备恢复后本页会自动刷新。" />
          )}
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
        </section>

        <KioskActionBar leading={<span className="w2-scan-action-note">只有扫描仪就绪时才能创建任务</span>}>
          <Button variant="secondary" size="lg" onClick={() => navigate('/print-scan')}>返回</Button>
          <Button size="lg" disabled={scannerStatus !== 'ready'} onClick={() => navigate('/scan/settings', { state: { scanType: selected } })}>
            下一步 · 查看扫描指引 <ArrowRightIcon />
          </Button>
        </KioskActionBar>
      </div>
    </KioskPageFrame>
  )
}
