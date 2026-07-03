// ============================================================
// 我的打印订单 — /me/print-orders（本人，只读）。
// 只展示安全元数据（文件名 / 状态 / 份数 / 彩黑 / 幅面 / 时间）；
// 无页数 / 设备名 / 金额（后端 PrintTask 无对应真实列，不编造）。
// ============================================================

import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card } from '@ai-job-print/ui'
import type { MemberPrintOrderItem } from '@ai-job-print/shared'
import { MessageSquareIcon, PrinterIcon } from 'lucide-react'
import { getMyPrintOrders } from '../../../services/api/memberPrintOrders'
import { useAuth } from '../../../auth/useAuth'
import { formatTime } from '../assets/format'
import { MeListShell, type MeListState } from './MeListShell'

const STATUS_META: Record<MemberPrintOrderItem['status'], { label: string; cls: string }> = {
  pending: { label: '待处理', cls: 'bg-warning-bg text-warning-fg' },
  claimed: { label: '已接单', cls: 'bg-primary-50 text-primary-600' },
  printing: { label: '打印中', cls: 'bg-primary-50 text-primary-600' },
  completed: { label: '已完成', cls: 'bg-success-bg text-success-fg' },
  failed: { label: '失败', cls: 'bg-error-bg text-error-fg' },
  cancelled: { label: '已取消', cls: 'bg-neutral-100 text-neutral-500' },
}

function metaLine(item: MemberPrintOrderItem): string {
  const parts: string[] = []
  if (item.copies) parts.push(`${item.copies} 份`)
  if (item.colorMode) parts.push(item.colorMode === 'color' ? '彩色' : '黑白')
  if (item.paperSize) parts.push(item.paperSize)
  parts.push(formatTime(item.completedAt ?? item.createdAt))
  return parts.join(' · ')
}

export function MyPrintOrdersPage() {
  const { isLoggedIn, getToken } = useAuth()
  const navigate = useNavigate()
  const [items, setItems] = useState<MemberPrintOrderItem[]>([])
  const [state, setState] = useState<MeListState>('loading')
  const [reloadKey, setReloadKey] = useState(0)

  const load = useCallback(() => {
    if (!isLoggedIn) {
      setState('ready')
      return
    }
    setState('loading')
    getMyPrintOrders(getToken(), { pageSize: 50 })
      .then((r) => {
        setItems(r.items)
        setState('ready')
      })
      .catch(() => setState('error'))
  }, [isLoggedIn, getToken])

  useEffect(() => {
    load()
  }, [load, reloadKey])

  const openFeedback = useCallback(
    (printTaskId: string) => {
      const params = new URLSearchParams({ category: 'print', relatedPrintTaskId: printTaskId })
      navigate(`/me/feedback?${params.toString()}`)
    },
    [navigate],
  )

  return (
    <MeListShell
      title="打印订单"
      subtitle="本人打印任务记录（仅本人可见）"
      loginFrom="/me/print-orders"
      isLoggedIn={isLoggedIn}
      state={state}
      onRetry={() => setReloadKey((k) => k + 1)}
      isEmpty={items.length === 0}
      emptyIcon={PrinterIcon}
      emptyTitle="还没有打印订单"
      emptyDescription="完成一次打印后，这里会显示你的打印记录"
    >
      {items.map((item) => {
        const status = STATUS_META[item.status]
        const canCreateFeedback = item.status === 'completed' || item.status === 'failed'
        return (
          <Card
            key={item.id}
            className="grid grid-cols-[3rem_minmax(0,1fr)] items-center gap-4 p-4 sm:grid-cols-[3rem_minmax(0,1fr)_auto]"
          >
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-warning-bg">
              <PrinterIcon className="h-6 w-6 text-warning-fg" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-neutral-900">{item.fileName ?? '未命名文件'}</p>
              <p className="mt-0.5 truncate text-xs text-neutral-400">{metaLine(item)}</p>
            </div>
            <div className="col-span-2 flex items-center justify-end gap-2 sm:col-span-1">
              {canCreateFeedback && (
                <button
                  type="button"
                  onClick={() => openFeedback(item.id)}
                  className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-warning/20 bg-white px-3 text-xs font-semibold text-warning-fg transition-colors hover:bg-warning-bg focus:outline-none focus:ring-2 focus:ring-warning/30"
                  aria-label={`反馈打印订单 ${item.fileName ?? '未命名订单'}`}
                >
                  <MessageSquareIcon className="h-4 w-4" aria-hidden="true" />
                  反馈
                </button>
              )}
              <span className={['shrink-0 rounded-full px-2.5 py-1 text-xs font-medium', status.cls].join(' ')}>
                {status.label}
              </span>
            </div>
          </Card>
        )
      })}
      <p className="mt-1 text-center text-xs text-neutral-400">仅展示本人打印任务的安全信息，不含文件内容与金额</p>
    </MeListShell>
  )
}
