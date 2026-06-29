import { useEffect, useMemo, useState } from 'react'
import { Card, ComplianceBanner, EmptyState } from '@ai-job-print/ui'
import type { JobMaterialAdminSummary, JobMaterialTemplate, JobMaterialTemplateType } from '@ai-job-print/shared'
import { FileTextIcon, LayoutTemplateIcon, RefreshCwIcon } from 'lucide-react'
import { Page } from '../Page'
import { getJobMaterialAdminSummary, getJobMaterialTemplatesForAdmin } from '../../services/api/jobMaterials'

const TYPE_LABELS: Record<JobMaterialTemplateType, string> = {
  resume_template: '简历模板',
  cover_letter: '求职信',
  thank_you: '感谢信',
  portfolio_cover: '作品集封面',
  materials_checklist: '材料清单',
}

function statLabel(value: number): string {
  return Number.isFinite(value) ? String(value) : '0'
}

export default function JobMaterialsPage() {
  const [templates, setTemplates] = useState<JobMaterialTemplate[]>([])
  const [summary, setSummary] = useState<JobMaterialAdminSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

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
    return () => { cancelled = true }
  }, [reloadKey])

  const generatedByTemplate = useMemo(() => {
    const map = new Map<string, number>()
    for (const item of summary?.templates ?? []) map.set(item.id, item.generatedCount)
    return map
  }, [summary])

  return (
    <Page title="求职材料库" subtitle="内置模板、生成统计与商用闭环观测">
      <ComplianceBanner tone="info" title="只读运营口径">
        当前阶段模板由代码内置并统一发布，后台仅查看模板状态与生成统计；模板维护入口暂不开放，避免缺少审核与版权闭环时形成运营风险。
      </ComplianceBanner>

      <div className="mt-5 grid gap-4 md:grid-cols-4">
        <Card className="p-5">
          <p className="text-xs font-semibold text-neutral-500">模板总数</p>
          <p className="mt-2 text-3xl font-bold text-neutral-950">{statLabel(summary?.templateCount ?? templates.length)}</p>
        </Card>
        <Card className="p-5">
          <p className="text-xs font-semibold text-neutral-500">已发布模板</p>
          <p className="mt-2 text-3xl font-bold text-neutral-950">{statLabel(summary?.publishedTemplateCount ?? 0)}</p>
        </Card>
        <Card className="p-5">
          <p className="text-xs font-semibold text-neutral-500">生成文件数</p>
          <p className="mt-2 text-3xl font-bold text-neutral-950">{statLabel(summary?.generatedFileCount ?? 0)}</p>
        </Card>
        <Card className="p-5">
          <p className="text-xs font-semibold text-neutral-500">有效文件数</p>
          <p className="mt-2 text-3xl font-bold text-neutral-950">{statLabel(summary?.activeGeneratedFileCount ?? 0)}</p>
        </Card>
      </div>

      <div className="mt-5 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-neutral-800">模板目录</h2>
        <button
          type="button"
          onClick={() => setReloadKey((key) => key + 1)}
          className="inline-flex h-9 items-center gap-1 rounded-md border border-neutral-200 px-3 text-xs font-semibold text-neutral-600 hover:bg-neutral-50"
        >
          <RefreshCwIcon className="h-3.5 w-3.5" aria-hidden="true" />
          刷新
        </button>
      </div>

      {error && (
        <Card className="mt-4 border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </Card>
      )}

      <Card className="mt-3 overflow-hidden p-0">
        {loading ? (
          <div className="p-8 text-center text-sm text-neutral-500">加载中...</div>
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
              </tr>
            </thead>
            <tbody>
              {templates.map((template) => (
                <tr key={template.id} className="border-t border-neutral-100">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50">
                        <FileTextIcon className="h-4 w-4 text-blue-600" aria-hidden="true" />
                      </span>
                      <span>
                        <span className="block font-semibold text-neutral-900">{template.title}</span>
                        <span className="mt-0.5 block text-xs text-neutral-500">{template.description}</span>
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-neutral-600">{TYPE_LABELS[template.type]}</td>
                  <td className="px-4 py-3">
                    <span className="rounded-full bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700">
                      {template.status === 'published' ? '已发布' : '已停用'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-neutral-900">
                    {generatedByTemplate.get(template.id) ?? 0}
                  </td>
                </tr>
              ))}
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
    </Page>
  )
}
