import type { ElementType, ReactNode } from 'react'
import { ArrowRightIcon } from 'lucide-react'

interface KpiCardProps {
  label: string
  value: string
  unit?: string
  sub: string
  icon: ElementType
  /** 数值转警示配色（陶色）。 */
  warn?: boolean
  /** 该指标的某个数据源加载失败：整卡转错误态并给「重试」，不再显示猜测值。 */
  failed?: boolean
  onRetry: () => void
}

export interface TodoRow {
  key: string
  icon: ElementType
  title: string
  sub: string
  href: string
  actionLabel: string
  warn?: boolean
  timeTitle?: string
}

export function SectionLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      className="inline-flex shrink-0 items-center gap-1 text-[12.5px] font-bold text-primary-700 hover:text-primary-600"
    >
      {children}
      <ArrowRightIcon className="h-3 w-3" aria-hidden="true" />
    </a>
  )
}

/** KPI 卡片；数据源失败时卡内给错误 + 重试，不让整页因单块失败而崩溃。 */
export function KpiCard({ label, value, unit, sub, icon: Icon, warn, failed, onRetry }: KpiCardProps) {
  return (
    <div
      className={
        'rounded-lg border bg-surface px-5 py-[18px] shadow-sm ' +
        (warn && !failed
          ? 'border-warning/30'
          : failed
            ? 'border-error/30'
            : 'border-neutral-900/[0.06]')
      }
    >
      <div className="flex items-center gap-1.5 text-[12px] font-semibold text-neutral-500">
        <Icon className="h-[14px] w-[14px] shrink-0" aria-hidden="true" />
        {label}
      </div>
      {failed ? (
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="text-[13px] text-error-fg">数据源加载失败</span>
          <button
            type="button"
            onClick={onRetry}
            className="shrink-0 rounded-md border border-neutral-200 px-2.5 py-1 text-xs font-bold text-neutral-700 hover:bg-neutral-50"
          >
            重试
          </button>
        </div>
      ) : (
        <>
          <div
            className={
              'mt-2 text-[1.9rem] font-extrabold tabular-nums leading-none ' +
              (warn ? 'text-warning' : 'text-neutral-900')
            }
          >
            {value}
            {unit && <span className="ml-1 text-sm font-bold opacity-50">{unit}</span>}
          </div>
          <p className="mt-2 text-[11.5px] text-neutral-500">{sub}</p>
        </>
      )}
    </div>
  )
}

/** 区块级错误：只影响所在卡片/区块，配独立重试。 */
export function BlockError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center gap-2.5 py-8 text-center">
      <p className="text-sm text-error-fg">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="rounded-lg border border-neutral-200 bg-surface px-4 py-1.5 text-xs font-bold text-neutral-700 hover:bg-neutral-50"
      >
        重试
      </button>
    </div>
  )
}

export function BlockLoading() {
  return <p className="py-8 text-center text-sm text-neutral-400">加载中…</p>
}

export function TodoItemRow({ row, isFirst }: { row: TodoRow; isFirst: boolean }) {
  const Icon = row.icon
  return (
    <div
      className={
        'flex items-center gap-3 py-[11px] text-[13px]' +
        (isFirst ? '' : ' border-t border-neutral-900/[0.06]')
      }
    >
      <span
        className={
          'grid h-8 w-8 shrink-0 place-items-center rounded-[9px] ' +
          (row.warn ? 'bg-warning-bg text-warning-fg' : 'bg-primary-100 text-primary-700')
        }
      >
        <Icon className="h-4 w-4" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-bold text-neutral-900">{row.title}</p>
        <p className="mt-0.5 truncate text-[11.5px] text-neutral-500" title={row.timeTitle}>{row.sub}</p>
      </div>
      <a href={row.href} className="shrink-0 text-xs font-bold text-primary-700 hover:text-primary-600">
        {row.actionLabel}
      </a>
    </div>
  )
}

