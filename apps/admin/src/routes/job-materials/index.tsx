import { useEffect, useMemo, useState } from 'react'
import { Card, ComplianceBanner, EmptyState, LoadingState } from '@ai-job-print/ui'
import type { JobMaterialAdminSummary } from '@ai-job-print/shared'
import { FileTextIcon, LayoutTemplateIcon, PlusIcon, RefreshCwIcon } from 'lucide-react'
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

function statLabel(value: number): string {
  return Number.isFinite(value) ? String(value) : '0'
}

export default function JobMaterialsPage() {
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
            {statLabel(summary?.templateCount ?? templates.length)}
          </p>
        </Card>
        <Card className="p-5">
          <p className="text-xs font-semibold text-neutral-500">已发布模板</p>
          <p className="mt-2 text-3xl font-bold text-neutral-950">
            {statLabel(summary?.publishedTemplateCount ?? 0)}
          </p>
        </Card>
        <Card className="p-5">
          <p className="text-xs font-semibold text-neutral-500">生成文件数</p>
          <p className="mt-2 text-3xl font-bold text-neutral-950">
            {statLabel(summary?.generatedFileCount ?? 0)}
          </p>
        </Card>
        <Card className="p-5">
          <p className="text-xs font-semibold text-neutral-500">有效文件数</p>
          <p className="mt-2 text-3xl font-bold text-neutral-950">
            {statLabel(summary?.activeGeneratedFileCount ?? 0)}
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

      {error && (
        <Card className="mt-4 border-error/30 bg-error-bg p-4 text-sm text-error-fg">{error}</Card>
      )}

      <Card className="mt-3 overflow-hidden p-0">
        {loading ? (
          <LoadingState text="加载中…" className="py-8" />
        ) : templates.length === 0 ? (
          <EmptyState icon={LayoutTemplateIcon} title="暂无模板" className="p-8" />
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-left text-xs font-semibold text-neutral-500">
              <tr>
                <th className="px-4 py-3">模板</th>
                <th className="px-4 py-3">类型</th>
                <th className="px-4 py-3">状态</th>
                <th className="px-4 py-3 text-right">生成次数</th>
                <th className="px-4 py-3 text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {templates.map((template) => {
                const busy = publishBusyId === template.id
                return (
                  <tr key={template.id} className="border-t border-neutral-100">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-info-bg">
                          <FileTextIcon className="h-4 w-4 text-info-fg" aria-hidden="true" />
                        </span>
                        <span>
                          <span className="block font-semibold text-neutral-900">
                            {template.title}
                          </span>
                          <span className="mt-0.5 block text-xs text-neutral-500">
                            {template.description}
                          </span>
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-neutral-600">
                      {JOB_MATERIAL_TYPE_LABELS[template.type]}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-1 text-xs font-semibold ${
                          template.status === 'published'
                            ? 'bg-success-bg text-success-fg'
                            : 'bg-neutral-100 text-neutral-600'
                        }`}
                      >
                        {template.status === 'published' ? '已发布' : '未发布'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-neutral-900">
                      {generatedByTemplate.get(template.id) ?? 0}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => openEdit(template)}
                          className="rounded-md border border-neutral-200 px-2.5 py-1 text-xs font-semibold text-neutral-600 hover:bg-neutral-50"
                        >
                          编辑
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => handlePublishToggle(template)}
                          className={`rounded-md px-2.5 py-1 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-60 ${
                            template.status === 'published'
                              ? 'border border-neutral-200 text-neutral-600 hover:bg-neutral-50'
                              : 'bg-primary-600 text-white hover:bg-primary-700'
                          }`}
                        >
                          {busy ? '处理中…' : template.status === 'published' ? '下架' : '发布'}
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </Card>

      <Card className="mt-5 p-5">
        <p className="text-sm font-semibold text-neutral-800">最近 7 天生成趋势</p>
        <div className="mt-4 grid grid-cols-7 gap-2">
          {(summary?.last7DaysGenerated ?? []).map((item) => (
            <div key={item.date} className="rounded-lg bg-neutral-50 p-3 text-center">
              <p className="text-xs text-neutral-500">{item.date.slice(5)}</p>
              <p className="mt-1 text-lg font-bold text-neutral-900">{item.count}</p>
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
