import { useNavigate } from 'react-router-dom'
import { Button, Card } from '@ai-job-print/ui'
import { ArrowRightIcon, FileTextIcon, InfoIcon, PrinterIcon, SaveIcon, ShieldCheckIcon } from 'lucide-react'
import { COMPLIANCE_COPY } from '@ai-job-print/shared'
import './resume-library-lightflow.css'
import './resume-fusion-youth.css'

const HOW_TO_PATHS = [
  {
    no: 1,
    title: '诊断优化后导出',
    desc: '上传简历 → AI 诊断 → 优化编辑 → 导出 PDF/Word/TXT/Markdown，并可当场打印。',
  },
  {
    no: 2,
    title: 'AI 生成简历后导出',
    desc: '没有电子简历时，引导式填写真实信息 → 预览编辑 → 导出 PDF → 打印。',
  },
  {
    no: 3,
    title: '求职材料库生成',
    desc: '求职信、感谢信等材料填写后生成 PDF，进入「我的文档」，可再次打印。',
  },
] as const

export function ResumeExportPage() {
  const navigate = useNavigate()

  return (
    <div className="resume-lightflow resume-export-lightflow">
      <div className="resume-lightflow__shell resume-lightflow__shell--narrow">
        <header className="resume-lightflow__header">
          <div>
            <p className="resume-lightflow__eyebrow">AI 简历服务 · 输出物</p>
            <h1>导出与打印</h1>
            <p>仅对已由真实导出流程生成的文件提供保存和打印。</p>
          </div>
          <Button size="sm" variant="secondary" className="resume-lightflow__return" onClick={() => navigate(-1)}>
            返回
          </Button>
        </header>

        <Card className="resume-lightflow__empty-export">
          <span className="resume-lightflow__empty-icon"><FileTextIcon aria-hidden="true" /></span>
          <p className="resume-lightflow__detail-label">暂无真实输出物</p>
          <h2>当前流程尚未生成可导出的真实文件</h2>
          <p>此页面不会虚构文件、保存结果或打印任务。请回到真实简历流程完成导出后，再使用对应的保存或打印操作。</p>
          <div className="resume-lightflow__split-actions">
            <Button size="lg" disabled title="尚无真实导出文件">
              <SaveIcon aria-hidden="true" /> 保存到我的简历
            </Button>
            <Button size="lg" variant="secondary" disabled title="尚无真实导出文件">
              <PrinterIcon aria-hidden="true" /> 打印
            </Button>
          </div>
          <Button size="lg" className="resume-lightflow__primary-action" onClick={() => navigate('/resume/source')}>
            返回真实简历流程 <ArrowRightIcon aria-hidden="true" />
          </Button>
        </Card>

        {/* 如何获得可打印文件的三条路径 */}
        <section className="rp-export__paths" aria-label="如何获得可打印的简历文件">
          <div className="rp-export__paths-head">
            <span className="rp-export__paths-icon" aria-hidden="true"><InfoIcon /></span>
            <div>
              <h2>如何获得可打印的简历文件</h2>
              <p>完成任一真实流程后，即可在对应页面保存、下载或打印</p>
            </div>
          </div>
          <div className="rp-export__paths-grid">
            {HOW_TO_PATHS.map((p) => (
              <div key={p.no} className="rp-export__path">
                <span className="rp-export__path-no">{p.no}</span>
                <strong>{p.title}</strong>
                <span>{p.desc}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="resume-lightflow__notice" aria-label="导出边界说明">
          <ShieldCheckIcon aria-hidden="true" />
          <div>
            <strong>真实文件才会开放保存和打印。</strong>
            <p>本页不会构造本人资产、成功状态或打印任务；文件短期保留后自动清理。</p>
          </div>
        </section>

        <p className="resume-lightflow__compliance">{COMPLIANCE_COPY.KIOSK_RESUME_NO_SEND_ENTERPRISE}</p>
      </div>
    </div>
  )
}
