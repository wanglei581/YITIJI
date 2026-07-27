import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, KioskActionBar, KioskPageFrame, KioskPageHeader, KioskStatePanel } from '@ai-job-print/ui'
import { canCreateFormalPrintScanTask } from '@ai-job-print/shared'
import {
  ArrowRightIcon,
  CheckIcon,
  CreditCardIcon,
  FileTextIcon,
  HeadphonesIcon,
  RefreshCwIcon,
  ScanIcon,
  ShieldCheckIcon,
  UploadIcon,
} from 'lucide-react'
import {
  loadConfiguredCapabilities,
  type ConfiguredCapability,
} from '../../services/api/printScanCapabilities'
import { ScanFlowSteps } from './ScanFlowSteps'
import './styles/scan-fusion.css'

type ScanType = 'resume' | 'id' | 'document'
/** 能力门禁态：禁止伪装「硬件已就绪」类文案。 */
type ScanGate = 'loading' | 'allowed' | 'blocked' | 'unknown'

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
    description: '扫描纸质简历生成 PDF，可进入 AI 识别与优化，也可打印',
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
    description: '扫描通用文件生成 PDF；登录后可在「我的文档」查看与管理',
    chips: [{ label: '生成 PDF' }, { label: '可打印 / 管理' }],
    icon: ScanIcon,
  },
]

const FLOW_STEPS = [
  ['选择扫描类型', '点击下方「下一步」创建扫描任务'],
  ['按屏幕指引', '到打印机放好原件，在操作面板上扫描到本机接收目录'],
  ['本机自动检测', '扫描结果，期间请勿关闭页面'],
  ['选择文件去向', '打印、前往我的文档或 AI 简历识别'],
] as const

const ALT_PATHS = [
  { title: '上传文件打印', desc: '手机 / U盘里的现成文件仍可打印', tone: 'ok' as const, chip: '可使用' },
  { title: 'U盘直插打印', desc: '打印机自带能力，U盘插打印机即可', tone: 'ok' as const, chip: '可尝试' },
  { title: '扫描到 U盘', desc: '打印机面板自带，以设备现场提示为准', tone: 'ok' as const, chip: '可尝试' },
  { title: '本机扫描任务', desc: '当前终端扫描能力未开放或状态未知', tone: 'warn' as const, chip: '暂不可用' },
]

const CAPABILITY_STATUS_NOTES: Record<string, string> = {
  testing: '测试中，暂未对用户开放',
  maintenance: '维护中，暂时不可用',
  unsupported: '本终端不支持该能力',
  not_verified: '待验收，暂未开放',
}

function resolveGate(scanCap: ConfiguredCapability | undefined, loadStatus: 'ok' | 'skipped' | 'error'): ScanGate {
  if (loadStatus === 'error') return 'unknown'
  if (!scanCap) return 'allowed'
  return canCreateFormalPrintScanTask(scanCap.status) ? 'allowed' : 'blocked'
}

export function ScanStartPage() {
  const navigate = useNavigate()
  const [selected, setSelected] = useState<ScanType>('resume')
  const [gate, setGate] = useState<ScanGate>('loading')
  const [blockedNote, setBlockedNote] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)

  const refreshGate = useCallback(async () => {
    setChecking(true)
    try {
      const result = await loadConfiguredCapabilities()
      const scanCap = result.map.scan
      setGate(resolveGate(scanCap, result.status))
      if (scanCap && !canCreateFormalPrintScanTask(scanCap.status)) {
        setBlockedNote(scanCap.note ?? CAPABILITY_STATUS_NOTES[scanCap.status] ?? '该终端当前不提供扫描服务')
      } else {
        setBlockedNote(null)
      }
    } catch {
      setGate('unknown')
      setBlockedNote(null)
    } finally {
      setChecking(false)
    }
  }, [])

  useEffect(() => {
    void refreshGate()
  }, [refreshGate])

  const blocked = gate === 'blocked' || gate === 'unknown' || gate === 'loading'
  const statusLabel =
    gate === 'loading' ? '正在确认扫描能力' :
    gate === 'blocked' ? '扫描能力暂未开放' :
    gate === 'unknown' ? '能力状态暂不可用' :
    '可创建扫描任务 · 需面板操作'
  const statusChipClass =
    gate === 'allowed' ? 'is-ready' :
    gate === 'loading' ? 'is-busy' :
    'is-offline'

  return (
    <KioskPageFrame className="w2-scan-page">
      <div data-w2-page="scan-start" className="w2-scan-shell">
        <KioskPageHeader
          title="材料扫描"
          description={
            blocked
              ? '当前无法创建扫描任务，请查看说明或改用其他方式'
              : '请选择扫描类型；扫描在打印机面板完成，本机负责接收文件'
          }
          onBack={() => navigate('/print-scan')}
          backLabel="返回打印扫描服务"
          aside={<span className={`w2-scan-status-chip ${statusChipClass}`}><span />{statusLabel}</span>}
        />

        <ScanFlowSteps activeIndex={0} />

        <section className="w2-scan-content">
          {blocked ? (
            <>
              <p className="w2-scan-notice is-warn">
                {gate === 'loading'
                  ? '正在确认本终端是否开放扫描服务，请稍候。'
                  : gate === 'unknown'
                    ? '暂时无法确认扫描能力状态，不会创建扫描任务；请重试或联系工作人员。'
                    : `扫描能力暂未开放${blockedNote ? `：${blockedNote}` : ''}。请改用下方仍可用的方式，或联系工作人员。`}
              </p>
              <div className="w2-scan-off-wrap">
                <section className="w2-scan-off-main" aria-label="扫描能力不可用">
                  <KioskStatePanel
                    tone="offline"
                    title={gate === 'loading' ? '正在确认扫描能力' : gate === 'unknown' ? '能力状态暂不可用' : '扫描能力暂未开放'}
                    description={
                      gate === 'loading'
                        ? '正在读取本终端的扫描服务配置。'
                        : gate === 'unknown'
                          ? '本机未能读取扫描能力配置。恢复后可继续创建扫描任务（仍需在打印机面板操作）。'
                          : (blockedNote ?? '管理员尚未对本终端开放扫描服务，或该能力处于维护 / 待验收状态。')
                    }
                    icon={<ScanIcon aria-hidden="true" />}
                    actions={(
                      <>
                        <Button size="lg" className="min-h-14" disabled={checking || gate === 'loading'} onClick={() => void refreshGate()}>
                          <RefreshCwIcon aria-hidden="true" />
                          {checking || gate === 'loading' ? '正在确认…' : '重新确认能力'}
                        </Button>
                        <Button size="lg" variant="secondary" className="min-h-14" onClick={() => navigate('/help')}>
                          <HeadphonesIcon aria-hidden="true" />
                          联系工作人员
                        </Button>
                      </>
                    )}
                  />
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
                    若长时间未恢复，请到服务台联系现场工作人员检查终端能力配置。
                  </div>
                </aside>
              </div>
            </>
          ) : (
            <>
              <p className="w2-scan-notice">
                扫描说明：请在打印机操作面板完成扫描，并选择扫描到本机已配置的网络接收目录；本机创建任务后自动检测文件，不会远程替你按下扫描键。
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
                  <div className="w2-scan-privacy"><ShieldCheckIcon />扫描文件设有效期；未登录时离开后可能无法在「我的文档」找回。</div>
                </aside>
              </div>
            </>
          )}
        </section>

        {blocked ? (
          <KioskActionBar leading={<span className="w2-scan-action-note">能力确认前不会创建扫描任务</span>}>
            <Button variant="secondary" size="lg" onClick={() => navigate('/print-scan')}>返回打印扫描</Button>
            <Button size="lg" onClick={() => navigate('/print/upload')}>
              <UploadIcon aria-hidden="true" />
              改用上传文件打印
            </Button>
          </KioskActionBar>
        ) : (
          <KioskActionBar leading={<span className="w2-scan-action-note">创建后请到打印机面板操作</span>}>
            <Button variant="secondary" size="lg" onClick={() => navigate('/print-scan')}>返回</Button>
            <Button size="lg" onClick={() => navigate('/scan/settings', { state: { scanType: selected } })}>
              下一步 · 查看扫描指引 <ArrowRightIcon />
            </Button>
          </KioskActionBar>
        )}
      </div>
    </KioskPageFrame>
  )
}
