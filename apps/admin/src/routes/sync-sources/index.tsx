import { formatDateTime } from '@ai-job-print/shared'
import { useEffect, useState, useCallback } from 'react'
import { Card, StatusBadge, EmptyState, LoadingState } from '@ai-job-print/ui'
import { Page } from '../Page'
import { RefreshCwIcon } from 'lucide-react'
import { API_MODE } from '../../services/api/client'
import { useRecruitmentHosting } from '../components/recruitment/useRecruitmentHosting'
import { RecruitmentHostingNotice } from '../components/recruitment/RecruitmentHostingNotice'
import { CircuitBreakDialog, type CircuitBreakTarget } from '../components/recruitment/CircuitBreakDialog'
import { fetchApiSources, type ApiSyncSourceItem } from './syncSourcesApi'

// 3.15：本平台不代为同步、启停或配置机构的数据来源。字段映射、立即同步、停用 / 审批启用、
// 批量下架内容四个写操作不论托管开关一律停放在 SyncSourceWriteActions.tsx（不被 import），
// 本页只留查看与「按来源熔断」。

const FREQ_LABELS: Record<string, string> = {
  manual:  '手动',
  hourly:  '每小时',
  daily:   '每天',
  weekly:  '每周',
  realtime:'实时',
}

const STATUS_BADGE: Record<string, 'success' | 'error' | 'warning' | 'default'> = {
  success: 'success',
  failed:  'error',
}

const SUBTITLE = '查看各机构的数据来源通道；本平台不代为同步、启停或配置，应急时按来源熔断'

// ─── Component ────────────────────────────────────────────────────────────────

export default function SyncSourcesPage() {
  const [sources,      setSources]      = useState<ApiSyncSourceItem[]>([])
  const [loading,      setLoading]      = useState(true)
  const [error,        setError]        = useState(false)
  const [circuitTarget, setCircuitTarget] = useState<CircuitBreakTarget | null>(null)
  // 开关只用于顶部说明；写操作不论开关一律停放（见文件头）。
  const hosting = useRecruitmentHosting()

  const load = useCallback(() => {
    setLoading(true)
    setError(false)
    fetchApiSources()
      .then(setSources)
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  if (loading) {
    return (
      <Page title="数据接入通道" subtitle={SUBTITLE}>
        <div className="flex h-48 items-center justify-center">
          <LoadingState text="加载中…" className="py-12" />
        </div>
      </Page>
    )
  }

  if (error) {
    return (
      <Page title="数据接入通道" subtitle={SUBTITLE}>
        <div className="flex h-48 flex-col items-center justify-center gap-3">
          <RefreshCwIcon className="h-10 w-10 text-neutral-200" />
          <p className="text-sm text-neutral-400">加载失败，请稍后重试</p>
          <button onClick={load} className="rounded-lg bg-primary-600 px-4 py-1.5 text-xs text-white hover:bg-primary-700">
            重试
          </button>
        </div>
      </Page>
    )
  }

  return (
    <Page
      title="数据接入通道"
      subtitle={SUBTITLE}
      actions={
        <button onClick={load} className="flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-surface px-3 py-1.5 text-xs text-neutral-600 hover:bg-neutral-50">
          <RefreshCwIcon className="h-3.5 w-3.5" />刷新
        </button>
      }
    >
      <RecruitmentHostingNotice
        hosting={hosting}
        detail="一体机与小程序不展示机构导入的岗位与招聘会。本平台不代为同步、启停或配置数据来源，本页只保留查看与按来源熔断。熔断是单向操作，提交后不能撤销，并会自动通知受影响的机构。"
      />
      {API_MODE !== 'http' && (
        <p className="mb-4 text-xs text-neutral-400">当前为 mock 模式，列表为演示数据。</p>
      )}

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                {['数据源名称', '机构', '接入方式', '同步频率', '最后同步', '状态', '配置', '操作'].map((h) => (
                  <th key={h} className="whitespace-nowrap border-b border-neutral-900/10 bg-neutral-50/90 px-4 py-2.5 text-left text-[11.5px] font-bold tracking-[0.04em] text-neutral-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-900/[0.06]">
              {sources.length === 0 ? (
                <tr>
                  <td colSpan={8}>
                    <EmptyState
                      title="暂无数据接入通道"
                      description="合作机构创建数据来源后将在此显示"
                      icon={RefreshCwIcon}
                      className="py-12"
                    />
                  </td>
                </tr>
              ) : (
                sources.map((s) => {
                  return (
                    <tr key={s.id} className="hover:bg-neutral-50">
                      <td className="px-4 py-3 font-medium text-neutral-800">{s.name}</td>
                      <td className="px-4 py-3 text-xs text-neutral-600">
                        <div>{s.orgName}</div>
                        <div className="font-mono text-[10px] text-neutral-400">{s.orgId.slice(0, 12)}…</div>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-neutral-600">{s.accessMode.toUpperCase()}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-neutral-600">
                        {FREQ_LABELS[s.syncFreq] ?? s.syncFreq}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-neutral-500">
                        {s.lastSyncAt ? formatDateTime(s.lastSyncAt, { fallback: '从未' }) : '从未'}
                      </td>
                      <td className="px-4 py-3">
                        {s.archived ? (
                          <StatusBadge dot status="default" label="已归档" />
                        ) : !s.enabled ? (
                          <StatusBadge dot status="warning" label="待启用 / 已停用" />
                        ) : s.lastSyncStatus ? (
                          <StatusBadge
                            dot
                            status={STATUS_BADGE[s.lastSyncStatus] ?? 'default'}
                            label={s.lastSyncStatus === 'success' ? '成功' : s.lastSyncStatus === 'failed' ? '失败' : s.lastSyncStatus}
                          />
                        ) : (
                          <span className="text-xs text-neutral-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1.5">
                          <span className={`rounded px-1.5 py-0.5 text-xs ${s.hasEndpoint ? 'bg-success-bg text-success-fg' : 'bg-neutral-100 text-neutral-400'}`}>
                            {s.hasEndpoint ? 'URL ✓' : 'URL —'}
                          </span>
                          <span className={`rounded px-1.5 py-0.5 text-xs ${s.hasCredential ? 'bg-success-bg text-success-fg' : 'bg-neutral-100 text-neutral-400'}`}>
                            {s.hasCredential ? '凭证 ✓' : '凭证 —'}
                          </span>
                          <span className={`rounded px-1.5 py-0.5 text-xs ${s.hasResponseConfig ? 'bg-success-bg text-success-fg' : 'bg-warning-bg text-warning-fg'}`}>
                            {s.hasResponseConfig ? '映射 ✓' : '映射 auto'}
                          </span>
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => setCircuitTarget({ scope: 'source', id: s.id, name: s.name, orgName: s.orgName })}
                            className="rounded px-2.5 py-1 text-xs font-medium text-error-fg hover:bg-error-bg"
                          >
                            按来源熔断
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <p className="mt-3 text-xs text-neutral-400">
        「按来源熔断」是应急处置：停用该来源，并把它导入的内容全部下架锁定，不可撤销，写入审计，并会通知所属机构。
      </p>

      <CircuitBreakDialog target={circuitTarget} onClose={() => setCircuitTarget(null)} onDone={load} />
    </Page>
  )
}
