import { FileInputIcon, FileTextIcon, SparklesIcon, type LucideIcon } from 'lucide-react'
import { formatTime } from '../assets/format'
import type { AIRecord, ResumeItem, ScanItem } from '../profileTypes'

export function PendingTaskBanner({ onContinue }: { onContinue: () => void }) {
  return (
    <div className="qx-card" data-live="true">
      <div className="pf-todo">
        <span className="pf-todo-ic" data-tone="wheat">
          <FileInputIcon size={26} aria-hidden />
        </span>
        <span className="pf-todo-tx">
          <span className="pf-todo-t">本次服务记录</span>
          <span className="pf-todo-d">本次服务产生的记录，可继续查看</span>
        </span>
        <button type="button" className="pf-todo-btn pf-todo-btn--teal" onClick={onContinue}>
          查看记录
        </button>
      </div>
    </div>
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
  const empty = resumes.length + scans.length + aiRecords.length === 0
  return (
    <section aria-label="本次服务记录" className="kp-session-records">
      <div className="kp-section-head">
        <span className="t">这一趟做过什么</span>
        <span className="hint">{empty ? '只记这一次，不跨人累计' : '离开时这一段会清掉'}</span>
      </div>
      {empty ? (
        <div className="qx-card">
          <div className="pf-todo pf-todo--none">
            <span className="pf-todo-ic" data-tone="teal">
              <SparklesIcon size={26} aria-hidden />
            </span>
            <span className="pf-todo-tx">
              <span className="pf-todo-t">这一趟还没有留下记录</span>
              <span className="pf-todo-d">你在这台机器上做的每一步会记在这里，方便中途回头找。结束使用时这一段就清掉。</span>
            </span>
          </div>
        </div>
      ) : (
        <div className="qx-rows kp-session-list">
          {resumes.map((resume) => (
            <SessionRow
              key={resume.id}
              icon={FileTextIcon}
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
              name={`${record.label} · ${record.fileName}`}
              meta={`AI · ${record.detail} · ${formatTime(record.createdAt)}`}
              onDelete={() => onDeleteAiRecord(record.id)}
            />
          ))}
        </div>
      )}
    </section>
  )
}

function SessionRow({
  icon: Icon,
  name,
  meta,
  onPrint,
  onDelete,
}: {
  icon: LucideIcon
  name: string
  meta: string
  onPrint?: () => void
  onDelete: () => void
}) {
  return (
    <div className="kp-session-row">
      <span className="qx-row-ic kp-session-icon">
        <Icon size={24} aria-hidden />
      </span>
      <span className="qx-row-tx kp-session-copy">
        <span className="qx-row-t">{name}</span>
        <span className="qx-row-d">{meta}</span>
      </span>
      <span className="pf-session-actions kp-session-actions">
        {onPrint ? (
          <button type="button" className="qx-btn" data-variant="ghost" onClick={onPrint}>
            打印
          </button>
        ) : null}
        <button type="button" className="qx-btn" data-variant="ghost" onClick={onDelete}>
          删除
        </button>
      </span>
    </div>
  )
}
