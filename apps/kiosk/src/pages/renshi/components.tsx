import { SourceUrlQr } from '../../components/SourceUrlQr'
import {
  CheckCircle2Icon,
  ClipboardListIcon,
  FileTextIcon,
  ScrollTextIcon,
  ShieldCheckIcon,
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
    <div className="flex shrink-0 gap-3">
      {tabs.map(({ key, label, icon: Icon }) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          aria-pressed={active === key}
          className={[
            'flex min-h-[58px] flex-1 items-center justify-center gap-2 rounded-full border px-5 text-[20px] transition-colors active:scale-[.98]',
            active === key
              ? 'font-semibold text-wheat-fg bg-wheat-bg'
              : 'border-neutral-200 bg-surface font-medium text-neutral-500 hover:border-neutral-300 hover:text-neutral-700',
          ].join(' ')}
          style={active === key ? { borderColor: 'rgba(169,120,31,.50)' } : undefined}
        >
          <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
          {label}
        </button>
      ))}
    </div>
  )
}

/** 政策匹配筛选条：选身份即筛选下方「就业政策」事项。 */
export function AudienceFilter({ value, onChange }: { value: AudienceKey; onChange: (k: AudienceKey) => void }) {
  return (
    <div className="shrink-0">
      <p className="text-[20px] font-semibold text-neutral-900">
        先选你的情况
        <span className="ml-3 text-[16px] font-normal text-neutral-500">选择身份后自动筛出更相关的政策事项，通用事项始终展示</span>
      </p>
      <div className="mt-3 flex flex-wrap gap-2.5">
        {AUDIENCE_CHIPS.map(({ key, label, icon: Icon }) => {
          const activeChip = value === key
          return (
            <button
              key={key}
              type="button"
              onClick={() => onChange(key)}
              aria-pressed={activeChip}
              className={[
                'flex min-h-[56px] items-center justify-center gap-2 rounded-full border px-6 text-[19px] transition-colors active:scale-[.98]',
                activeChip
                  ? 'font-semibold text-wheat-fg bg-wheat-bg'
                  : 'border-neutral-200 bg-white font-medium text-neutral-600 hover:border-neutral-300',
              ].join(' ')}
              style={activeChip ? { borderColor: 'rgba(169,120,31,.50)' } : undefined}
            >
              <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
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
    <section>
      <p className={`flex items-center gap-2.5 text-[20px] font-semibold ${iconColor}`}>
        <Icon className="h-[22px] w-[22px]" aria-hidden="true" />
        {title}
      </p>
      <ul className={['mt-2.5 gap-2.5', title === '需要准备材料' ? 'grid grid-cols-2' : 'flex flex-col'].join(' ')}>
        {items.map((text, i) => (
          <li key={i} className="flex items-start gap-3 rounded-[12px] border border-neutral-200 bg-neutral-50 px-3.5 py-2.5 text-[18px] leading-relaxed text-neutral-700">
            {ordered ? (
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[16px] font-bold text-wheat-fg bg-wheat-bg">
                {i + 1}
              </span>
            ) : (
              <CheckCircle2Icon className="mt-0.5 h-6 w-6 shrink-0 text-wheat-fg" aria-hidden="true" />
            )}
            {text}
          </li>
        ))}
      </ul>
    </section>
  )
}
