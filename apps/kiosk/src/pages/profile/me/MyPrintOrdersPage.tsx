// ============================================================
// 我的打印订单 — /me/print-orders（本人，只读）。
// 只展示安全元数据（文件名 / 状态 / 份数 / 彩黑 / 幅面 / 时间）；
// 无页数 / 设备名 / 金额（后端 PrintTask 无对应真实列，不编造）。
// ============================================================

import { useCallback, useEffect, useState } from 'react'
import { Card } from '@ai-job-print/ui'
import type { MemberPrintOrderItem } from '@ai-job-print/shared'
import { PrinterIcon } from 'lucide-react'
import { getMyPrintOrders } from '../../../services/api/memberPrintOrders'
import { useAuth } from '../../../auth/useAuth'
import { formatTime } from '../assets/format'
import { MeListShell, type MeListState } from './MeListShell'

const STATUS_META: Record<MemberPrintOrderItem['status'], { label: string; cls: string }> = {
  pending: { label: '待处理', cls: 'bg-amber-50 text-amber-600' },
  claimed: { label: '已接单', cls: 'bg-blue-50 text-blue-600' },
  printing: { label: '打印中', cls: 'bg-blue-50 text-blue-600' },
  completed: { label: '已完成', cls: 'bg-emerald-50 text-emerald-600' },
  failed: { label: '失败', cls: 'bg-red-50 text-red-600' },
  cancelled: { label: '已取消', cls: 'bg-gray-100 text-gray-500' },
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
        return (
          <Card key={item.id} className="flex items-center gap-4 p-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-amber-50">
              <PrinterIcon className="h-6 w-6 text-amber-600" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-gray-900">{item.fileName ?? '未命名文件'}</p>
              <p className="mt-0.5 truncate text-xs text-gray-400">{metaLine(item)}</p>
            </div>
            <span className={['shrink-0 rounded-full px-2.5 py-1 text-xs font-medium', status.cls].join(' ')}>
              {status.label}
            </span>
          </Card>
        )
      })}
      <p className="mt-1 text-center text-xs text-gray-400">仅展示本人打印任务的安全信息，不含文件内容与金额</p>
    </MeListShell>
  )
}
