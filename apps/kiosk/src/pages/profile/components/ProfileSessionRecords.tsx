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

const cardSurface = 'rounded-2xl border border-neutral-200 bg-white shadow-sm'

// 仅在「本次会话确有记录」时渲染（见调用处的 hasSessionRecords 门控）：
// 不展示空横幅，避免无记录时被误认为有未完成任务。
export function PendingTaskBanner({ onContinue }: { onContinue: () => void }) {
  return (
    <section className="-mt-12 rounded-2xl border border-neutral-100 bg-white px-5 py-4 shadow-sm">
      <div className="flex items-center gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-600">
          <ScanLineIcon className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-bold text-neutral-900">本次服务记录</h2>
          <p className="mt-0.5 truncate text-xs text-neutral-500">本次服务产生的记录，可继续查看</p>
        </div>
        <button
          type="button"
          onClick={onContinue}
          className="flex min-h-[44px] shrink-0 items-center gap-1 rounded-full bg-primary-50 px-4 text-sm font-semibold text-primary-600 active:bg-primary-100"
        >
          查看记录
          <ChevronRightIcon className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
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
    <section aria-label="本次服务记录" className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-medium text-neutral-500">本次服务记录</h2>
        <span className="text-xs text-neutral-400">仅本次会话</span>
      </div>
      <div className={`${cardSurface} divide-y divide-neutral-100 px-4`}>
        {resumes.map((r) => (
          <SessionRow
            key={r.id}
            icon={FileTextIcon}
            iconBg="bg-primary-50"
            iconColor="text-primary-600"
            name={r.name}
            meta={`简历 · ${r.size} · ${r.format} · ${formatTime(r.savedAt)}`}
            onPrint={() => onPrintFile(r)}
            onDelete={() => onDeleteResume(r.id)}
          />
        ))}
        {scans.map((s) => (
          <SessionRow
            key={s.id}
            icon={FileInputIcon}
            iconBg="bg-info-bg"
            iconColor="text-info"
            name={s.name}
            meta={`扫描 · ${s.pages} 页 · ${s.size} · ${formatTime(s.savedAt)}`}
            onPrint={() => onPrintFile(s)}
            onDelete={() => onDeleteScan(s.id)}
          />
        ))}
        {aiRecords.map((a) => (
          <SessionRow
            key={a.id}
            icon={SparklesIcon}
            iconBg="bg-plum-soft"
            iconColor="text-plum"
            name={`${a.label} · ${a.fileName}`}
            meta={`AI · ${a.detail} · ${formatTime(a.createdAt)}`}
            onDelete={() => onDeleteAiRecord(a.id)}
          />
        ))}
      </div>
    </section>
  )
}

function SessionRow({
  icon: Icon,
  iconBg,
  iconColor,
  name,
  meta,
  onPrint,
  onDelete,
}: {
  icon: LucideIcon
  iconBg: string
  iconColor: string
  name: string
  meta: string
  onPrint?: () => void
  onDelete: () => void
}) {
  return (
    <div className="flex items-center gap-3 py-3">
      <span className={['flex h-10 w-10 shrink-0 items-center justify-center rounded-lg', iconBg].join(' ')}>
        <Icon className={['h-5 w-5', iconColor].join(' ')} aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-neutral-900">{name}</p>
        <p className="truncate text-xs text-neutral-400">{meta}</p>
      </div>
      {onPrint && <RowIconButton icon={PrinterIcon} title="打印" onClick={onPrint} />}
      <RowIconButton icon={Trash2Icon} title="删除" tone="danger" onClick={onDelete} />
    </div>
  )
}
