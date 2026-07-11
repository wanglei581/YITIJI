import { useNavigate } from 'react-router-dom'
import { SourceUrlQr } from '../../components/SourceUrlQr'
import {
  CheckCircle2Icon,
  ClipboardListIcon,
  FileTextIcon,
  PrinterIcon,
  ScrollTextIcon,
  ShieldCheckIcon,
  UserCheckIcon,
  XIcon,
  type LucideIcon,
} from 'lucide-react'
import { AUDIENCE_CHIPS, type AudienceKey, type TabKey } from './shared'

// ── Sub-components ─────────────────────────────────────────────────────────────

// 官方入口二维码弹层：承载政策事项的真实 officialUrl；info-only。
// 打开即记一条 external_open 跳转记录（仅记录打开入口动作，不记录办理结果）。
export function OfficialEntryQrOverlay({ title, url, onClose }: { title: string; url: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="relative w-[22rem] max-w-full rounded-2xl bg-white p-7 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <button
          onClick={onClose}
          aria-label="关闭"
          className="absolute right-4 top-4 flex h-12 w-12 items-center justify-center rounded-full text-neutral-400 hover:bg-neutral-100"
        >
          <XIcon className="h-5 w-5" />
        </button>
        <p className="text-center text-base font-semibold text-neutral-800">扫码打开官方入口</p>
        <p className="mt-1 truncate text-center text-xs text-neutral-400">{title}</p>
        <div className="mt-5 flex justify-center"><SourceUrlQr value={url} size={196} /></div>
        <p className="mt-3 break-all rounded-lg bg-neutral-50 px-3 py-2 text-center text-[11px] text-neutral-500">{url}</p>
        <p className="mt-4 text-xs leading-relaxed text-neutral-500">
          请使用手机扫码前往官方平台办理。办理结果以官方平台为准，本系统仅提供信息入口和材料服务。
        </p>
      </div>
    </div>
  )
}

export function TabBar({ active, onChange }: { active: TabKey; onChange: (k: TabKey) => void }) {
  const tabs: { key: TabKey; label: string; icon: LucideIcon }[] = [
    { key: 'policy', label: '就业政策', icon: FileTextIcon },
    { key: 'social', label: '社保指南', icon: ShieldCheckIcon },
    { key: 'register', label: '就业登记', icon: ClipboardListIcon },
    { key: 'notice', label: '政策公告', icon: ScrollTextIcon },
  ]

  return (
    <div className="flex gap-1 rounded-xl border border-neutral-200 bg-neutral-100 p-1">
      {tabs.map(({ key, label, icon: Icon }) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          aria-pressed={active === key}
          className={[
            'flex min-h-[52px] flex-1 items-center justify-center gap-1.5 rounded-lg px-2 text-sm transition-colors',
            active === key
              ? 'bg-white font-semibold text-warning-fg shadow-sm'
              : 'font-medium text-neutral-500 hover:text-neutral-700',
          ].join(' ')}
        >
          <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
          {label}
        </button>
      ))}
    </div>
  )
}

/** 政策匹配筛选条：选身份即筛选下方「就业政策」事项。 */
export function AudienceFilter({ value, onChange }: { value: AudienceKey; onChange: (k: AudienceKey) => void }) {
  return (
    <div>
      <p className="text-base font-semibold text-neutral-900">先选你的情况</p>
      <p className="mt-0.5 text-xs text-neutral-500">选择身份后，下方自动筛出更相关的政策事项；通用事项始终展示。</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {AUDIENCE_CHIPS.map(({ key, label, icon: Icon }) => {
          const activeChip = value === key
          return (
            <button
              key={key}
              type="button"
              onClick={() => onChange(key)}
              aria-pressed={activeChip}
              className={[
                'flex min-h-[48px] min-w-[120px] flex-1 items-center justify-center gap-2 rounded-xl border px-4 text-sm transition-colors',
                activeChip
                  ? 'border-warning/50 bg-warning-bg font-semibold text-warning-fg'
                  : 'border-neutral-200 bg-white font-medium text-neutral-600 hover:border-neutral-300',
              ].join(' ')}
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
              {label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function DetailList({ icon: Icon, iconColor, title, items, ordered }: {
  icon: LucideIcon
  iconColor: string
  title: string
  items: string[]
  ordered?: boolean
}) {
  return (
    <section className="rounded-xl bg-neutral-50 p-4">
      <p className="flex items-center gap-2 text-sm font-semibold text-neutral-900">
        <Icon className={`h-4 w-4 ${iconColor}`} aria-hidden="true" />
        {title}
      </p>
      <ul className="mt-2.5 flex flex-col gap-2">
        {items.map((text, i) => (
          <li key={i} className="flex gap-2 text-sm leading-relaxed text-neutral-600">
            {ordered ? (
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-warning/20 text-xs font-bold text-warning-fg">
                {i + 1}
              </span>
            ) : (
              <CheckCircle2Icon className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden="true" />
            )}
            {text}
          </li>
        ))}
      </ul>
    </section>
  )
}

// ─── 常用材料打印包 ─────────────────────────────────────────────────────────────

export function PrintPackBanner() {
  const navigate = useNavigate()
  const packs = [
    { label: '失业登记申请表', pages: '1页', icon: ScrollTextIcon },
    { label: '就业登记申请表', pages: '1页', icon: UserCheckIcon },
    { label: '社保查询操作指引', pages: '2页', icon: ShieldCheckIcon },
    { label: '创业担保贷款材料清单', pages: '1页', icon: ClipboardListIcon },
  ]

  return (
    <div className="rounded-xl border border-warning/30 bg-warning-bg/70 px-5 py-5">
      <div className="mb-4 flex items-center gap-2">
        <PrinterIcon className="h-4 w-4 text-warning-fg" aria-hidden="true" />
        <span className="text-sm font-semibold text-warning-fg">常用材料打印包</span>
        <span className="ml-auto text-xs text-warning-fg/80">只打印清单与指引，不上传或代办高敏材料</span>
      </div>
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        {packs.map(({ label, pages, icon: Icon }) => (
          <button
            key={label}
            type="button"
            onClick={() => navigate('/print/upload')}
            className="flex min-h-[96px] flex-col items-center justify-center gap-2 rounded-lg border border-warning/20 bg-white px-3 py-4 text-center hover:bg-warning-bg active:bg-warning/20"
          >
            <Icon className="h-5 w-5 text-warning-fg" aria-hidden="true" />
            <span className="text-sm font-medium leading-snug text-neutral-800">{label}</span>
            <span className="text-xs text-neutral-400">{pages}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
