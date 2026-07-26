import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, KioskActionBar, KioskPageFrame, KioskPageHeader } from '@ai-job-print/ui'
import {
  ArrowRightIcon,
  CheckIcon,
  CreditCardIcon,
  FileTextIcon,
  ScanIcon,
  ShieldCheckIcon,
} from 'lucide-react'
import { ScanFlowSteps } from './ScanFlowSteps'
import './styles/scan-fusion.css'

type ScanType = 'resume' | 'id' | 'document'

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
  ['选择扫描类型', '下一步会创建真实扫描会话'],
  ['获取服务端指引', '只在会话创建成功后显示'],
  ['在设备上扫描', '按当前会话的服务端指引操作'],
  ['选择文件去向', '打印、保存到我的文档或 AI 简历识别'],
] as const

export function ScanStartPage() {
  const navigate = useNavigate()
  const [selected, setSelected] = useState<ScanType>('resume')

  return (
    <KioskPageFrame className="w2-scan-page">
      <div data-w2-page="scan-start" className="w2-scan-shell">
        <KioskPageHeader
          title="材料扫描"
          description="请先选择扫描类型；本页尚未创建任务"
          onBack={() => navigate('/print-scan')}
          backLabel="返回打印扫描服务"
          aside={<span className="w2-scan-status-chip"><span />会话尚未创建</span>}
        />

        <ScanFlowSteps activeIndex={0} />

        <section className="w2-scan-content">
          <p className="w2-scan-notice">
            下一步会创建真实扫描会话。只有服务端成功返回会话后，下一页才会显示任务编号和设备操作指引。
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
        </section>

        <KioskActionBar leading={<span className="w2-scan-action-note">进入下一步后才会向服务端创建真实会话</span>}>
          <Button variant="secondary" size="lg" onClick={() => navigate('/print-scan')}>返回</Button>
          <Button size="lg" onClick={() => navigate('/scan/settings', { state: { scanType: selected } })}>
            下一步 · 创建扫描会话 <ArrowRightIcon />
          </Button>
        </KioskActionBar>
      </div>
    </KioskPageFrame>
  )
}
