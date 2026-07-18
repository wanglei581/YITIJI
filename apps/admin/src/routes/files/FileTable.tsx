import { Card, EmptyState, StatusBadge } from '@ai-job-print/ui'
import { FolderIcon } from 'lucide-react'
import { Pagination } from '../components/DataTable'
import type { ViewFile } from './fileMeta'
import {
  CLEAN_MAP,
  fmtDate,
} from './fileMeta'
import {
  assetCategoryLabel,
  ownerTypeLabel,
  retentionPolicyLabel,
  retentionSetByLabel,
} from './retentionMeta'

interface FileTableProps {
  loading: boolean
  error: boolean
  search: string
  files: ViewFile[]
  total: number
  page: number
  pageSize: number
  busyId: string | null
  onRetry: () => void
  onView: (id: string) => void
  onDelete: (id: string, name: string) => void
  onPageChange: (page: number) => void
  onPageSizeChange: (pageSize: number) => void
}

export function FileTable({
  loading,
  error,
  search,
  files,
  total,
  page,
  pageSize,
  busyId,
  onRetry,
  onView,
  onDelete,
  onPageChange,
  onPageSizeChange,
}: FileTableProps) {
  const headers = ['文件名', '类型', '用户', '来源', '大小', '敏感级别', '保存策略', '策略来源', '同意时间', '清理状态', '操作']
  return (
    <Card className="overflow-hidden p-0">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              {headers.map((h) => (
                <th key={h} className="sticky top-0 whitespace-nowrap border-b border-neutral-900/10 bg-neutral-50/90 px-4 py-2.5 text-left text-[11.5px] font-bold tracking-[0.04em] text-neutral-500 backdrop-blur-sm">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-900/[0.06]">
            {loading ? (
              [0, 1, 2, 3, 4].map((i) => (
                <tr key={i}>
                  {Array.from({ length: headers.length }).map((_, j) => (
                    <td key={j} className="px-4 py-4"><div className="h-3 w-3/4 animate-pulse rounded bg-neutral-100" /></td>
                  ))}
                </tr>
              ))
            ) : error ? (
              <tr>
                <td colSpan={headers.length}>
                  <div className="flex flex-col items-center gap-3 py-12">
                    <p className="text-sm text-neutral-400">文件数据加载失败，请稍后重试</p>
                    <button onClick={onRetry} className="rounded-lg bg-primary-600 px-4 py-1.5 text-xs text-white hover:bg-primary-700">重试</button>
                  </div>
                </td>
              </tr>
            ) : files.length === 0 ? (
              <tr>
                <td colSpan={headers.length}>
                  <EmptyState title={search ? '未找到匹配的文件' : '当前筛选条件下无文件'} description={search ? '请尝试其他关键词' : undefined} icon={FolderIcon} className="py-12" />
                </td>
              </tr>
            ) : (
              files.map((v) => {
                const clean = CLEAN_MAP[v.clean]
                const isAlive = v.clean !== 'cleaned'
                const rowBusy = busyId === v.raw.id
                return (
                  <tr key={v.raw.id} className={`hover:bg-neutral-50 ${v.clean === 'cleaned' ? 'opacity-50' : ''}`}>
                    <td className="max-w-[180px] truncate px-4 py-3 font-mono text-xs text-neutral-700" title={v.name}>{v.name}</td>
                    <td className="whitespace-nowrap px-4 py-3"><span className={`rounded px-2 py-0.5 text-xs font-medium ${v.typeStyle}`}>{v.typeLabel}</span></td>
                    <td className="max-w-[140px] truncate whitespace-nowrap px-4 py-3 text-xs text-neutral-600" title={v.user}>{v.user}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-neutral-500">{v.source}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-neutral-500">{v.size}</td>
                    <td className="px-4 py-3"><StatusBadge dot status={v.sensitiveBadge} label={v.sensitiveLabel} /></td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-neutral-600">
                      <div className="font-medium">{retentionPolicyLabel(v.raw.retentionPolicy)}</div>
                      <div className="text-neutral-400">{assetCategoryLabel(v.raw.assetCategory)} · {ownerTypeLabel(v.raw.ownerType)}</div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-neutral-500">
                      {retentionSetByLabel(v.raw.retentionSetBy)}
                      {v.raw.retentionLockedReason && <div className="mt-1 text-error-fg">{v.raw.retentionLockedReason}</div>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-neutral-500">
                      {fmtDate(v.raw.retentionConsentAt, '-')}
                      {v.raw.retentionConsentVersion && <div className="mt-1 text-neutral-400">{v.raw.retentionConsentVersion}</div>}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge dot status={clean.badge} label={clean.label} />
                      <div className="mt-1 whitespace-nowrap text-xs text-neutral-400">{v.cleanPolicy}</div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <div className="flex gap-2">
                        {isAlive ? (
                          <>
                            <button disabled={rowBusy} onClick={() => onView(v.raw.id)} className="rounded px-2 py-1 text-xs font-medium text-primary-600 hover:bg-primary-50 disabled:opacity-40">查看文件</button>
                            <button disabled={rowBusy} onClick={() => onDelete(v.raw.id, v.name)} className="rounded px-2 py-1 text-xs font-medium text-error-fg hover:bg-error-bg disabled:opacity-40">手动删除</button>
                          </>
                        ) : (
                          <span className="px-2 py-1 text-xs text-neutral-300">已清理</span>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
      <Pagination total={total} page={page} pageSize={pageSize} onPageChange={onPageChange} onPageSizeChange={onPageSizeChange} />
    </Card>
  )
}
