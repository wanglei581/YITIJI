import {
  ChevronRightIcon,
  FileInputIcon,
  FileTextIcon,
  PrinterIcon,
  ScanLineIcon,
  SparklesIcon,
  Trash2Icon,
  type LucideIcon,
} from 'lucide-react'
import { formatTime } from '../assets/format'
import { RowIconButton } from '../assets/ui'
import type { AIRecord, ResumeItem, ScanItem } from '../profileTypes'

// 仅在「本次会话确有记录」时由调用处渲染，不展示空横幅。
export function PendingTaskBanner({ onContinue }: { onContinue: () => void }) {
  return (
    <section className="kp-pending-banner" aria-label="本次服务待办">
      <span className="kp-pending-icon">
        <ScanLineIcon aria-hidden="true" />
      </span>
      <div>
        <h2>本次服务记录</h2>
        <p>本次服务产生的记录，可继续查看</p>
      </div>
      <button type="button" onClick={onContinue} className="kp-pending-action">
        查看记录
        <ChevronRightIcon aria-hidden="true" />
      </button>
    </section>
  )
}

export function ProfileSessionRecords({
  resumes,
  scans,
  aiRecords,
  onPrintFile,
  onDeleteResume,
  onDeleteScan,
  onDeleteAiRecord,
}: {
  resumes: ResumeItem[]
  scans: ScanItem[]
  aiRecords: AIRecord[]
  onPrintFile: (file: { name: string; size: string; pages?: number }) => void
  onDeleteResume: (id: string) => void
  onDeleteScan: (id: string) => void
  onDeleteAiRecord: (id: string) => void
}) {
  return (
    <section aria-label="本次服务记录" className="kp-session-records">
      <div className="kp-section-head">
        <span className="kp-session-group-icon">
          <ScanLineIcon aria-hidden="true" />
        </span>
        <div>
          <h2>本次服务记录</h2>
          <p>仅当前会话可见，可继续打印或删除。</p>
        </div>
      </div>
      <div className="kp-session-list">
        {resumes.map((resume) => (
          <SessionRow
            key={resume.id}
            icon={FileTextIcon}
            tone="resume"
            name={resume.name}
            meta={`简历 · ${resume.size} · ${resume.format} · ${formatTime(resume.savedAt)}`}
            onPrint={() => onPrintFile(resume)}
            onDelete={() => onDeleteResume(resume.id)}
          />
        ))}
        {scans.map((scan) => (
          <SessionRow
            key={scan.id}
            icon={FileInputIcon}
            tone="scan"
            name={scan.name}
            meta={`扫描 · ${scan.pages} 页 · ${scan.size} · ${formatTime(scan.savedAt)}`}
            onPrint={() => onPrintFile(scan)}
            onDelete={() => onDeleteScan(scan.id)}
          />
        ))}
        {aiRecords.map((record) => (
          <SessionRow
            key={record.id}
            icon={SparklesIcon}
            tone="ai"
            name={`${record.label} · ${record.fileName}`}
            meta={`AI · ${record.detail} · ${formatTime(record.createdAt)}`}
            onDelete={() => onDeleteAiRecord(record.id)}
          />
        ))}
      </div>
    </section>
  )
}

function SessionRow({
  icon: Icon,
  tone,
  name,
  meta,
  onPrint,
  onDelete,
}: {
  icon: LucideIcon
  tone: 'resume' | 'scan' | 'ai'
  name: string
  meta: string
  onPrint?: () => void
  onDelete: () => void
}) {
  return (
    <div className="kp-session-row">
      <span className={`kp-session-icon ${tone}`}>
        <Icon aria-hidden="true" />
      </span>
      <div className="kp-session-copy">
        <strong>{name}</strong>
        <span>{meta}</span>
      </div>
      <div className="kp-session-actions">
        {onPrint && <RowIconButton icon={PrinterIcon} title="打印" onClick={onPrint} />}
        <RowIconButton icon={Trash2Icon} title="删除" tone="danger" onClick={onDelete} />
      </div>
    </div>
  )
}
