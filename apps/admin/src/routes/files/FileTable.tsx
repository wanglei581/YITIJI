import { useState } from 'react'
import { formatDateTime } from '@ai-job-print/shared'
import { Card, ConsoleTable, Drawer, StatusBadge, type ConsoleColumn } from '@ai-job-print/ui'
import { CLEAN_MAP, type ViewFile } from './fileMeta'
import { assetCategoryLabel, ownerTypeLabel, retentionPolicyLabel, retentionSetByLabel } from './retentionMeta'

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

export function FileTable({ loading, error, search, files, total, page, pageSize, busyId, onRetry, onView, onDelete, onPageChange, onPageSizeChange }: FileTableProps) {
  const [detailId, setDetailId] = useState<string | null>(null)
  const detail = files.find((v) => v.raw.id === detailId)
  const columns: ConsoleColumn<ViewFile>[] = [
    { id: 'file', header: '文件名', headerClassName: 'w-[21%]', truncate: true, title: (v) => v.name,
      cell: (v) => <button type="button" title={v.name} onClick={() => setDetailId(v.raw.id)}
        className="block w-full truncate text-left font-medium text-primary-700 hover:underline">{v.name}</button> },
    { id: 'type', header: '类型', headerClassName: 'w-[9%]', cell: (v) => <span className={`whitespace-nowrap rounded px-1 py-0.5 text-xs ${v.typeStyle}`}>{v.typeLabel}</span> },
    { id: 'user', header: '用户', headerClassName: 'w-[10%]', truncate: true,
      title: (v) => v.raw.endUserId ?? v.raw.uploaderId ?? undefined, cell: (v) => v.user },
    { id: 'size', header: '大小', align: 'right', headerClassName: 'w-[7%]', cellClassName: 'whitespace-nowrap', cell: (v) => v.size },
    { id: 'sensitive', header: '敏感级别', headerClassName: 'w-[9%]', cell: (v) => <StatusBadge dot status={v.sensitiveBadge} label={v.sensitiveLabel} /> },
    { id: 'retention', header: '保存策略', headerClassName: 'w-[10%]', cellClassName: 'whitespace-nowrap', cell: (v) => retentionPolicyLabel(v.raw.retentionPolicy) },
    { id: 'clean', header: '清理状态', headerClassName: 'w-[13%]', cell: (v) => <>
      <StatusBadge dot status={CLEAN_MAP[v.clean].badge} label={CLEAN_MAP[v.clean].label} />
      <div title={v.cleanPolicy} className="mt-1 truncate text-[11px] text-neutral-500">{v.cleanPolicy}</div>
    </> },
    { id: 'actions', header: '操作', sticky: true, align: 'right', headerClassName: 'w-[21%]', cell: (v) => (
      <div className="flex flex-wrap justify-end gap-x-2 gap-y-1 text-xs">
        <button type="button" onClick={() => setDetailId(v.raw.id)} className="text-primary-600 hover:underline">详情</button>
        {v.clean !== 'cleaned' ? <>
          <button type="button" disabled={busyId === v.raw.id} onClick={() => onView(v.raw.id)} className="whitespace-nowrap text-primary-600 hover:underline disabled:opacity-40">查看文件</button>
          <button type="button" disabled={busyId === v.raw.id} onClick={() => onDelete(v.raw.id, v.name)} className="whitespace-nowrap text-error-fg hover:underline disabled:opacity-40">手动删除</button>
        </> : <span className="text-neutral-400">已清理</span>}
      </div>
    ) },
  ]
  return (
    <>
      <Card className="overflow-hidden p-0">
        <ConsoleTable items={files} columns={columns} loading={loading}
          error={error ? { message: '文件数据加载失败，请稍后重试', onRetry } : null}
          empty={{ title: search ? '未找到匹配的文件' : '当前筛选条件下无文件', description: search ? '请尝试其他关键词' : undefined }}
          page={page} pageSize={pageSize} total={total} onPageChange={onPageChange} onPageSizeChange={onPageSizeChange}
          rowClassName={(v) => v.clean === 'cleaned' ? 'opacity-50' : undefined}
          className="[&_table]:table-fixed [&_th]:px-2 [&_td]:px-2 [&_td]:text-xs"
        />
      </Card>
      <Drawer open={!!detail} onClose={() => setDetailId(null)} title="文件详情">
        {detail && <dl className="space-y-3 py-4">
          {fileDetails(detail).map(([label, value]) => <div key={label} className="grid grid-cols-[100px_1fr] gap-3 text-sm">
            <dt className="text-neutral-500">{label}</dt><dd className="min-w-0 break-words text-neutral-800">{value}</dd>
          </div>)}
        </dl>}
      </Drawer>
    </>
  )
}

function fileDetails(v: ViewFile): [string, string][] {
  return [
    ['文件名', v.name], ['类型', v.typeLabel], ['用户', v.user], ['来源', v.source], ['大小', v.size],
    ['敏感级别', v.sensitiveLabel], ['保存策略', retentionPolicyLabel(v.raw.retentionPolicy)],
    ['文件类别', assetCategoryLabel(v.raw.assetCategory)], ['归属', ownerTypeLabel(v.raw.ownerType)],
    ['策略来源', retentionSetByLabel(v.raw.retentionSetBy)], ['锁定原因', v.raw.retentionLockedReason ?? '未记录'],
    ['同意时间', formatDateTime(v.raw.retentionConsentAt, { fallback: '-' })],
    ['同意版本', v.raw.retentionConsentVersion ?? '未记录'], ['清理状态', CLEAN_MAP[v.clean].label],
    ['清理规则', v.cleanPolicy], ['上传时间', v.createdAt], ['到期时间', v.expiresAt],
  ]
}
