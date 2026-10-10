import { formatCount, formatDateTime, formatTime } from '@ai-job-print/shared'
import { SectionCard, StatusBadge } from '@ai-job-print/ui'
import type { AdminPrintTaskItem } from '../../services/api/adminOps'
import { BlockError, BlockLoading, SectionLink } from './DashboardWidgets'

function clockTime(iso: string) { return formatTime(iso) }

const PRINT_STATUS_LABELS: Record<string, { label: string; status: 'success' | 'warning' | 'error' | 'info' | 'default' }> = {
  pending: { label: '排队中', status: 'info' },
  claimed: { label: '已领取', status: 'info' },
  printing: { label: '打印中', status: 'info' },
  completed: { label: '已完成', status: 'success' },
  failed: { label: '失败', status: 'error' },
  cancelled: { label: '已取消', status: 'default' },
  abandoned: { label: '已废弃', status: 'default' },
}

function printTypeLabel(task: AdminPrintTaskItem): string {
  const color = task.colorMode === 'color' ? '彩色' : task.colorMode === 'black_white' ? '黑白' : '—'
  const copies = task.copies != null ? ` · ${formatCount(task.copies)} 份` : ''
  return `${color}${copies}`
}

export function RecentPrintTasks({ tasks, total, loading, error, onRetry }: { tasks: AdminPrintTaskItem[]; total: number; loading: boolean; error: boolean; onRetry: () => void }) {
  return (
    <SectionCard
      title="最近打印任务"
      action={<SectionLink href="/orders">进入订单管理</SectionLink>}
      flush={!loading && !error && tasks.length > 0}
    >
      {loading ? <BlockLoading /> : error ? <BlockError message="打印任务加载失败" onRetry={onRetry} /> : tasks.length === 0 ? (
        <p className="py-8 text-center text-sm text-neutral-400">暂无打印任务</p>
      ) : (
        <>
          <div className="overflow-x-auto px-5">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr>
                  {['任务', '终端', '参数', '状态', '时间'].map((th) => (
                    <th
                      key={th}
                      className="whitespace-nowrap border-b border-neutral-900/10 px-2.5 py-2 text-left text-[11.5px] font-bold tracking-[0.04em] text-neutral-500"
                    >
                      {th}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tasks.map((task) => {
                  const st = PRINT_STATUS_LABELS[task.status] ?? { label: task.status, status: 'default' as const }
                  return (
                    <tr key={task.id} className="transition-colors hover:bg-neutral-50">
                      <td title={task.fileName ?? task.id} className="max-w-[180px] truncate whitespace-nowrap border-b border-neutral-900/[0.06] px-2.5 py-2.5 font-bold text-primary-700">
                        {task.fileName ?? task.id.slice(0, 8)}
                      </td>
                      <td className="whitespace-nowrap border-b border-neutral-900/[0.06] px-2.5 py-2.5 text-neutral-700">
                        {task.terminalCode ?? '—'}
                      </td>
                      <td className="whitespace-nowrap border-b border-neutral-900/[0.06] px-2.5 py-2.5 tabular-nums text-neutral-700">
                        {printTypeLabel(task)}
                      </td>
                      <td className="whitespace-nowrap border-b border-neutral-900/[0.06] px-2.5 py-2.5">
                        <StatusBadge dot status={st.status} label={st.label} />
                      </td>
                      <td className="whitespace-nowrap border-b border-neutral-900/[0.06] px-2.5 py-2.5 tabular-nums text-neutral-500" title={formatDateTime(task.createdAt)}>
                        {clockTime(task.createdAt)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="px-5 pb-4 pt-3 text-xs text-neutral-500">共 {formatCount(total)} 条打印任务</p>
        </>
      )}
    </SectionCard>
  )
}

