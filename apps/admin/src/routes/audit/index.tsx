import { useCallback, useEffect, useState } from 'react'
import { Card, StatusBadge, EmptyState } from '@ai-job-print/ui'
import { ScrollTextIcon, RefreshCwIcon } from 'lucide-react'
import { Page } from '../Page'
import { Pagination, useTableState } from '../components/DataTable'
import { getAuditLogs, type AuditLogRecord } from '../../services/api/audit'
import { API_MODE } from '../../services/api/client'

// ─── Action 中文标签(覆盖契约枚举,未知动作回退原始字符串)──────────────────

const ACTION_LABELS: Record<string, string> = {
  'file.upload':              '文件上传',
  'file.force_delete':        '文件强制删除',
  'file.cleanup_expired':     '过期文件清理',
  'job.review':               '岗位审核',
  'job.publish':              '岗位发布',
  'job.import':               '岗位导入',
  'job_source.create':        '岗位数据源创建',
  'job_source.update':        '岗位数据源更新',
  'fair.review':              '招聘会审核',
  'fair.publish':             '招聘会发布',
  'fair.import':              '招聘会导入',
  'data_source.create':       '数据源创建',
  'data_source.toggle':       '数据源启停',
  'resume.parse_submitted':   '简历解析提交',
  'resume.optimize_requested':'简历优化请求',
  'assistant.chat_message':   'AI 助手消息',
  'organization.create':      '机构创建',
  'organization.update':      '机构更新',
  'user.create':              '用户创建',
  'user.disable':             '用户停用',
  'system.login':             '登录',
  'system.config_change':     '系统配置变更',
}

// 筛选下拉常用动作(全部为查询用,空 = 不筛选)
const ACTION_FILTERS: Array<{ value: string; label: string }> = [
  { value: '',                   label: '全部动作' },
  { value: 'system.login',       label: '登录' },
  { value: 'job.review',         label: '岗位审核' },
  { value: 'job.publish',        label: '岗位发布' },
  { value: 'job.import',         label: '岗位导入' },
  { value: 'fair.review',        label: '招聘会审核' },
  { value: 'fair.publish',       label: '招聘会发布' },
  { value: 'file.force_delete',  label: '文件强制删除' },
  { value: 'file.cleanup_expired', label: '过期文件清理' },
  { value: 'data_source.create', label: '数据源创建' },
  { value: 'data_source.toggle', label: '数据源启停' },
  { value: 'organization.update',label: '机构更新' },
  { value: 'user.disable',       label: '用户停用' },
]

const ROLE_BADGE: Record<string, 'info' | 'success' | 'warning' | 'default'> = {
  admin:   'info',
  partner: 'success',
  kiosk:   'warning',
  system:  'default',
}

const ROLE_LABEL: Record<string, string> = {
  admin: '管理员', partner: '合作机构', kiosk: '一体机', system: '系统',
}

const COLUMNS = ['时间', '操作人', '角色', '动作', '目标对象', '终端 IP', '请求 ID']

// 把 datetime-local 值(本地时区)转成 ISO,供后端 startAt/endAt 用
function toIso(localValue: string): string | undefined {
  if (!localValue) return undefined
  const d = new Date(localValue)
  return isNaN(d.getTime()) ? undefined : d.toISOString()
}

export default function AuditPage() {
  const { page, pageSize, setPage, setPageSize } = useTableState(20)
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
          className="flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs text-neutral-600 hover:bg-neutral-50"
        >
          <RefreshCwIcon className="h-3.5 w-3.5" />刷新
        </button>
      }
    >
      {/* 筛选栏 */}
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-neutral-500">
          动作
          <select
            value={action}
            onChange={(e) => { setAction(e.target.value); setPage(1) }}
            className="h-9 w-44 rounded-lg border border-neutral-200 bg-white px-2 text-sm text-neutral-700 focus:border-primary-300 focus:outline-none"
          >
            {ACTION_FILTERS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-neutral-500">
          起始时间
          <input
            type="datetime-local"
            value={startAt}
            onChange={(e) => { setStartAt(e.target.value); setPage(1) }}
            className="h-9 rounded-lg border border-neutral-200 bg-white px-2 text-sm text-neutral-700 focus:border-primary-300 focus:outline-none"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-neutral-500">
          结束时间
          <input
            type="datetime-local"
            value={endAt}
            onChange={(e) => { setEndAt(e.target.value); setPage(1) }}
            className="h-9 rounded-lg border border-neutral-200 bg-white px-2 text-sm text-neutral-700 focus:border-primary-300 focus:outline-none"
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
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-neutral-100 bg-neutral-50">
              <tr>
                {COLUMNS.map((h) => (
                  <th key={h} className="whitespace-nowrap px-4 py-3 text-left text-xs font-medium text-neutral-500">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {loading ? (
                [0, 1, 2, 3, 4, 5].map((i) => (
                  <tr key={i}>
                    {COLUMNS.map((_, j) => (
                      <td key={j} className="px-4 py-4">
                        <div className="h-3 w-3/4 animate-pulse rounded bg-neutral-100" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : error ? (
                <tr>
                  <td colSpan={COLUMNS.length}>
                    <div className="flex flex-col items-center gap-3 py-12">
                      <p className="text-sm text-neutral-400">日志加载失败,请稍后重试</p>
                      <button onClick={load} className="rounded-lg bg-primary-600 px-4 py-1.5 text-xs text-white hover:bg-primary-700">
                        重试
                      </button>
                    </div>
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={COLUMNS.length}>
                    <EmptyState
                      title="暂无审计日志"
                      description={action || startAt || endAt ? '当前筛选条件下没有记录' : undefined}
                      icon={ScrollTextIcon}
                      className="py-12"
                    />
                  </td>
                </tr>
              ) : (
                items.map((r) => (
                  <tr key={r.id} className="hover:bg-neutral-50">
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-neutral-600">
                      {new Date(r.createdAt).toLocaleString('zh-CN')}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-neutral-700">
                      {r.actorId ?? <span className="text-neutral-300">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={ROLE_BADGE[r.actorRole] ?? 'default'} label={ROLE_LABEL[r.actorRole] ?? r.actorRole} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-neutral-700">
                      {ACTION_LABELS[r.action] ?? r.action}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-neutral-600">
                      <span className="text-neutral-400">{r.targetType}</span>
                      {r.targetId && <span className="ml-1 font-mono text-neutral-500">#{r.targetId}</span>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-neutral-500">
                      {r.ipAddress ?? <span className="text-neutral-300">—</span>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-neutral-400">
                      {r.requestId ?? '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <Pagination
          total={total}
          page={page}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={(s) => { setPageSize(s); setPage(1) }}
        />
      </Card>
    </Page>
  )
}
