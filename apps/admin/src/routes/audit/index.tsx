import { useCallback, useEffect, useState } from 'react'
import { Card, ConsoleTable } from '@ai-job-print/ui'
import { RefreshCwIcon } from 'lucide-react'
import { Page } from '../Page'
import { useTableState } from '../components/DataTable'
import { getAuditLogs, type AuditLogRecord } from '../../services/api/audit'
import { auditColumns } from './auditColumns'
import { AuditDetailDrawer } from './AuditDetailDrawer'
import { getAuditActionLabel } from '../../lib/auditActionLabels'
import { API_MODE } from '../../services/api/client'

const ACTION_FILTERS = ['', 'auth.password_login', 'auth.sms_login', 'admin.user.detail.view', 'admin.user.disable', 'print_job.create', 'order.mark_paid', 'resume.diagnosis_exported', 'file.delete', 'file.cleanup_expired', 'job_ai_session.cleanup_expired', 'ai_resume_result.cleanup_expired', 'job.review', 'job.publish', 'job.import', 'fair.review', 'fair.publish', 'data_source.create', 'data_source.toggle', 'org.update', 'org.self_profile_update']

// 把 datetime-local 值(本地时区)转成 ISO,供后端 startAt/endAt 用
function toIso(localValue: string): string | undefined {
  if (!localValue) return undefined
  const d = new Date(localValue)
  return isNaN(d.getTime()) ? undefined : d.toISOString()
}

export default function AuditPage() {
  const { page, pageSize, setPage, setPageSize } = useTableState(20)
  const [selected, setSelected] = useState<AuditLogRecord | null>(null)
  const [action, setAction] = useState('')
  const [startAt, setStartAt] = useState('')
  const [endAt, setEndAt] = useState('')

  const [items, setItems] = useState<AuditLogRecord[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    setError(false)
    getAuditLogs({
      action: action || undefined,
      startAt: toIso(startAt),
      endAt: toIso(endAt),
      limit: pageSize,
      offset: (page - 1) * pageSize,
    })
      .then((res) => {
        setItems(res.items)
        setTotal(res.total)
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [action, startAt, endAt, page, pageSize])

  useEffect(() => { load() }, [load])

  const resetFilters = () => {
    setAction('')
    setStartAt('')
    setEndAt('')
    setPage(1)
  }

  return (
    <Page
      title="日志审计"
      subtitle={`管理员与合作机构操作日志、系统事件${API_MODE !== 'http' ? '（当前为 mock 演示数据）' : ''}`}
      actions={
        <button
          onClick={load}
          className="flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-surface px-3 py-1.5 text-xs text-neutral-600 hover:bg-neutral-50"
        >
          <RefreshCwIcon className="h-3.5 w-3.5" />刷新
        </button>
      }
    >
      {/* 筛选栏 */}
      <div lang="zh-CN" className="mb-4 grid min-w-0 grid-cols-1 gap-3 sm:flex sm:flex-wrap sm:items-end">
        <label className="flex min-w-0 flex-col gap-1 text-xs text-neutral-500">
          动作
          <select
            value={action}
            onChange={(e) => { setAction(e.target.value); setPage(1) }}
            className="h-9 w-full min-w-0 rounded-lg border border-neutral-200 bg-surface px-2 text-sm text-neutral-700 focus:border-primary-300 focus:outline-none sm:w-44"
          >
            {ACTION_FILTERS.map((value) => <option key={value} value={value}>{value ? getAuditActionLabel(value) : '全部动作'}</option>)}
          </select>
        </label>
        <label className="flex min-w-0 flex-col gap-1 text-xs text-neutral-500">
          起始时间（年/月/日 时:分）
          <input
            type="datetime-local"
            value={startAt}
            onChange={(e) => { setStartAt(e.target.value); setPage(1) }}
            className="h-9 w-full min-w-0 rounded-lg border border-neutral-200 bg-surface px-2 text-sm text-neutral-700 focus:border-primary-300 focus:outline-none"
          />
        </label>
        <label className="flex min-w-0 flex-col gap-1 text-xs text-neutral-500">
          结束时间（年/月/日 时:分）
          <input
            type="datetime-local"
            value={endAt}
            onChange={(e) => { setEndAt(e.target.value); setPage(1) }}
            className="h-9 w-full min-w-0 rounded-lg border border-neutral-200 bg-surface px-2 text-sm text-neutral-700 focus:border-primary-300 focus:outline-none"
          />
        </label>
        {(action || startAt || endAt) && (
          <button
            onClick={resetFilters}
            className="h-9 rounded-lg px-3 text-xs font-medium text-neutral-500 hover:bg-neutral-100"
          >
            清除筛选
          </button>
        )}
      </div>

      <Card className="overflow-hidden p-0">
        <div onClick={(event) => {
          const target = event.target as HTMLElement
          const row = target.closest('tbody tr') as HTMLTableRowElement | null
          if (row && !target.closest('button') && !loading && !error && items[row.sectionRowIndex]) setSelected(items[row.sectionRowIndex])
        }}>
        <ConsoleTable items={items} columns={auditColumns(setSelected)}
          loading={loading} error={error ? { message: '日志加载失败，请稍后重试', onRetry: load } : null}
          empty={{ title: '暂无审计日志', description: action || startAt || endAt ? '当前筛选条件下没有记录' : undefined }}
          total={total} page={page} pageSize={pageSize} onPageChange={setPage}
          onPageSizeChange={(s) => { setPageSize(s); setPage(1) }}
        />
        </div>
      </Card>
      <AuditDetailDrawer record={selected} onClose={() => setSelected(null)} />
    </Page>
  )
}
