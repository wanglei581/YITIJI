import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '../lib/cn'

/**
 * 标准分页器。
 *
 * 后台表格通用(Admin 审计 / 文件 / 用户 / 订单;Partner 岗位 / 同步日志)。
 * Kiosk 上一般不用(改用 "加载更多")。
 *
 * 设计:
 *   - 上限 7 个页码 + 头尾省略号(超过 7 才出现)
 *   - 显示"共 N 条 / 当前 X-Y"
 *   - 上一页 / 下一页按钮自动禁用
 */
export interface PaginationProps {
  /** 当前页(0 起始)。 */
  page: number
  /** 每页条数。 */
  pageSize: number
  /** 总条数。 */
  total: number
  /** 用户点页码或上下页时触发。 */
  onChange: (nextPage: number) => void
  className?: string
}

export function Pagination({ page, pageSize, total, onChange, className }: PaginationProps): ReactNode {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const current = Math.min(Math.max(page, 0), totalPages - 1)
  const start = total === 0 ? 0 : current * pageSize + 1
  const end = Math.min(total, (current + 1) * pageSize)
  const pages = buildPageList(current, totalPages)

  return (
    <div className={cn('flex items-center justify-between gap-4 py-3', className)}>
      <div className="text-sm text-neutral-500">
        共 <span className="font-medium text-neutral-700">{total}</span> 条 ·
        当前 <span className="font-medium text-neutral-700">{start}-{end}</span>
      </div>
      <nav className="flex items-center gap-1" aria-label="分页">
        <PaginationButton
          disabled={current === 0}
          onClick={() => onChange(current - 1)}
          aria-label="上一页"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
        </PaginationButton>
        {pages.map((p, i) =>
          p === '...' ? (
            <span key={`ellipsis-${i}`} className="px-2 text-sm text-neutral-400">…</span>
          ) : (
            <PaginationButton
              key={p}
              active={p === current}
              onClick={() => onChange(p)}
            >
              {p + 1}
            </PaginationButton>
          ),
        )}
        <PaginationButton
          disabled={current >= totalPages - 1}
          onClick={() => onChange(current + 1)}
          aria-label="下一页"
        >
          <ChevronRight className="h-4 w-4" aria-hidden />
        </PaginationButton>
      </nav>
    </div>
  )
}

function PaginationButton({
  active,
  children,
  ...props
}: { active?: boolean; children: ReactNode } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cn(
        'flex h-8 min-w-8 items-center justify-center rounded-md px-2 text-sm transition-colors',
        active
          ? 'bg-primary-600 text-white'
          : 'text-neutral-700 hover:bg-neutral-100 disabled:cursor-not-allowed disabled:text-neutral-300 disabled:hover:bg-transparent',
      )}
      {...props}
    >
      {children}
    </button>
  )
}

/**
 * 构造页码列表,最多 7 个 + 必要时省略号。
 *   总页 ≤ 7:全列
 *   当前靠前(<= 3):  0 1 2 3 4 … last
 *   当前靠后(>= total-4): 0 … total-5..last
 *   居中:0 … cur-1 cur cur+1 … last
 */
function buildPageList(current: number, total: number): (number | '...')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i)
  if (current <= 3) return [0, 1, 2, 3, 4, '...', total - 1]
  if (current >= total - 4) return [0, '...', total - 5, total - 4, total - 3, total - 2, total - 1]
  return [0, '...', current - 1, current, current + 1, '...', total - 1]
}
