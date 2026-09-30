import { useEffect, useMemo, useState } from 'react'
import { Card, ComplianceBanner, ConsoleTable, StatusBadge, type ConsoleColumn } from '@ai-job-print/ui'
import { formatCount, type JobMaterialAdminSummary } from '@ai-job-print/shared'
import { PlusIcon, RefreshCwIcon } from 'lucide-react'
import { Page } from '../Page'
import {
  getJobMaterialAdminSummary,
  getJobMaterialTemplatesForAdmin,
  setJobMaterialTemplatePublish,
  type JobMaterialTemplateAdminRow,
  type JobMaterialTemplatePublishAction,
} from '../../services/api/jobMaterials'
import { JOB_MATERIAL_TYPE_LABELS } from './constants'
import { TemplateDrawer } from './TemplateDrawer'

export default function JobMaterialsPage() {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [templates, setTemplates] = useState<JobMaterialTemplateAdminRow[]>([])
  const [summary, setSummary] = useState<JobMaterialAdminSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [drawerMode, setDrawerMode] = useState<'create' | 'edit'>('create')
  const [editing, setEditing] = useState<JobMaterialTemplateAdminRow | null>(null)
  const [publishBusyId, setPublishBusyId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    Promise.all([getJobMaterialTemplatesForAdmin(), getJobMaterialAdminSummary()])
      .then(([templateRows, summaryRow]) => {
        if (cancelled) return
        setTemplates(templateRows)
        setSummary(summaryRow)
        setError(null)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : '加载失败')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [reloadKey])

  const generatedByTemplate = useMemo(() => {
    const map = new Map<string, number>()
    for (const item of summary?.templates ?? []) map.set(item.id, item.generatedCount)
    return map
  }, [summary])

  const openCreate = () => {
    setDrawerMode('create')
    setEditing(null)
    setDrawerOpen(true)
  }

  const openEdit = (template: JobMaterialTemplateAdminRow) => {
    setDrawerMode('edit')
    setEditing(template)
    setDrawerOpen(true)
  }

  const handlePublishToggle = async (template: JobMaterialTemplateAdminRow) => {
    const action: JobMaterialTemplatePublishAction =
      template.status === 'published' ? 'unpublish' : 'publish'
    setPublishBusyId(template.id)
    setError(null)
    try {
      await setJobMaterialTemplatePublish(template.id, action)
      setReloadKey((key) => key + 1)
    } catch (err) {
      setError(err instanceof Error ? err.message : '发布状态更新失败')
    } finally {
      setPublishBusyId(null)
    }
  }

  const columns: ConsoleColumn<JobMaterialTemplateAdminRow>[] = [
    { id: 'template', header: '模板', truncate: true, title: (template) => `${template.title}\n${template.description ?? ''}`,
      cell: (template) => <><div className="truncate font-semibold text-neutral-900">{template.title}</div><div className="mt-1 truncate text-xs text-neutral-500">{template.description}</div></> },
    { id: 'type', header: '类型', cellClassName: 'whitespace-nowrap', cell: (template) => JOB_MATERIAL_TYPE_LABELS[template.type] },
    { id: 'status', header: '状态', cell: (template) => <StatusBadge status={template.status === 'published' ? 'success' : 'default'} label={template.status === 'published' ? '已发布' : '已停用'} /> },
    { id: 'count', header: '生成次数', align: 'right', cell: (template) => formatCount(generatedByTemplate.get(template.id)) },
    { id: 'actions', header: '操作', sticky: true, align: 'right', cell: (template) => <div className="flex justify-end gap-2">
      <button type="button" onClick={() => openEdit(template)} className="rounded-md border border-neutral-200 px-2.5 py-1 text-xs font-semibold text-neutral-600 hover:bg-neutral-50">编辑</button>
      <button type="button" disabled={publishBusyId === template.id} onClick={() => handlePublishToggle(template)}
        className="rounded-md border border-neutral-200 px-2.5 py-1 text-xs font-semibold text-primary-700 disabled:opacity-60">
        {publishBusyId === template.id ? '处理中…' : template.status === 'published' ? '下架' : '发布'}
      </button>
    </div> },
  ]

  return (
    <Page title="求职材料库" subtitle="内置与运营模板、发布控制与生成统计">
      <ComplianceBanner tone="info" title="模板可编辑，生成统计与文件只读">
        后台可新建、编辑、发布与下架求职材料模板，改动对线上用户即时生效；发布前请核对字段结构与合规文案。
        生成文件与统计数据保持只读口径，运营数字只反映实际发生的生成行为，不做后台虚改。
      </ComplianceBanner>

      <div className="mt-5 grid gap-4 md:grid-cols-4">
        <Card className="p-5">
          <p className="text-xs font-semibold text-neutral-500">模板总数</p>
          <p className="mt-2 text-3xl font-bold text-neutral-950">
            {formatCount(summary?.templateCount ?? templates.length)}
          </p>
        </Card>
        <Card className="p-5">
          <p className="text-xs font-semibold text-neutral-500">已发布模板</p>
          <p className="mt-2 text-3xl font-bold text-neutral-950">
            {formatCount(summary?.publishedTemplateCount)}
          </p>
        </Card>
        <Card className="p-5">
          <p className="text-xs font-semibold text-neutral-500">生成文件数</p>
          <p className="mt-2 text-3xl font-bold text-neutral-950">
            {formatCount(summary?.generatedFileCount)}
          </p>
        </Card>
        <Card className="p-5">
          <p className="text-xs font-semibold text-neutral-500">有效文件数</p>
          <p className="mt-2 text-3xl font-bold text-neutral-950">
            {formatCount(summary?.activeGeneratedFileCount)}
          </p>
        </Card>
      </div>

      <div className="mt-5 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-neutral-800">模板目录</h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setReloadKey((key) => key + 1)}
            className="inline-flex h-9 items-center gap-1 rounded-md border border-neutral-200 px-3 text-xs font-semibold text-neutral-600 hover:bg-neutral-50"
          >
            <RefreshCwIcon className="h-3.5 w-3.5" aria-hidden="true" />
            刷新
          </button>
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex h-9 items-center gap-1 rounded-md bg-primary-600 px-3 text-xs font-semibold text-white hover:bg-primary-700"
          >
            <PlusIcon className="h-3.5 w-3.5" aria-hidden="true" />
            新建模板
          </button>
        </div>
      </div>

      <Card className="mt-3 overflow-hidden p-0">
        <ConsoleTable items={templates.slice((page - 1) * pageSize, page * pageSize)} columns={columns}
          loading={loading} error={error ? { message: error, onRetry: () => setReloadKey((key) => key + 1) } : null}
          empty={{ title: '暂无模板' }} page={page} pageSize={pageSize} total={templates.length}
          onPageChange={setPage} onPageSizeChange={(size) => { setPageSize(size); setPage(1) }} />
      </Card>

      <Card className="mt-5 p-5">
        <p className="text-sm font-semibold text-neutral-800">最近 7 天生成趋势</p>
        <div className="mt-4 grid grid-cols-7 gap-2">
          {(summary?.last7DaysGenerated ?? []).map((item) => (
            <div key={item.date} className="rounded-lg bg-neutral-50 p-3 text-center">
              <p className="text-xs text-neutral-500">{item.date.slice(5)}</p>
              <p className="mt-1 text-lg font-bold text-neutral-900">{formatCount(item.count)}</p>
            </div>
          ))}
        </div>
      </Card>

      <TemplateDrawer
        open={drawerOpen}
        mode={drawerMode}
        template={drawerMode === 'edit' ? editing : null}
        onClose={() => setDrawerOpen(false)}
        onSaved={() => {
          setDrawerOpen(false)
          setReloadKey((key) => key + 1)
        }}
      />
    </Page>
  )
}
