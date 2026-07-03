import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Button, Card, EmptyState, ErrorState, LoadingState, PageHeader } from '@ai-job-print/ui'
import type { ResumeTemplate } from '@ai-job-print/shared'
import { BookOpenIcon, LayoutTemplateIcon, SparklesIcon } from 'lucide-react'
import { getResumeTemplates } from '../../services/api/jobMaterials'

const FILTERS = ['全部', '简历模板', '通用'] as const

function matchesFilter(template: ResumeTemplate, filter: (typeof FILTERS)[number]): boolean {
  if (filter === '全部') return true
  return template.tags.includes(filter)
}

export function ResumeTemplateLibraryPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const legacyMaterialsTab = searchParams.get('tab') === 'materials'
  const [templates, setTemplates] = useState<ResumeTemplate[]>([])
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('全部')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (legacyMaterialsTab) {
      navigate('/resume/materials', { replace: true })
    }
  }, [legacyMaterialsTab, navigate])

  useEffect(() => {
    if (legacyMaterialsTab) {
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    getResumeTemplates()
      .then((items) => {
        if (cancelled) return
        setTemplates(items)
        setSelectedId((prev) => prev ?? items[0]?.id ?? null)
        setError(null)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : '简历素材加载失败')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [legacyMaterialsTab])

  const visible = useMemo(
    () => templates.filter((template) => matchesFilter(template, filter)),
    [filter, templates],
  )

  const selected = useMemo(
    () => templates.find((template) => template.id === selectedId) ?? visible[0] ?? templates[0] ?? null,
    [selectedId, templates, visible],
  )

  const selectTemplate = (template: ResumeTemplate) => {
    setSelectedId(template.id)
  }

  const handleUseResumeTemplate = () => {
    navigate('/resume/source?intent=optimize')
  }

  if (loading) return <LoadingState className="h-full" />

  return (
    <div className="flex h-full flex-col overflow-y-auto p-6">
      <PageHeader
        title="简历素材库"
        subtitle="选择简历版式方向，进入 AI 简历诊断或优化后生成正式简历"
        actions={
          <Button size="sm" variant="secondary" onClick={() => navigate('/')}>
            返回首页
          </Button>
        }
      />

      <div className="mt-4 rounded-xl border border-primary-100 bg-primary-50 px-4 py-3 text-sm leading-relaxed text-primary-700">
        本页仅用于个人简历素材查看、版式参考和简历优化引导。岗位申请、预约、投递仍需前往来源平台或官方渠道完成。
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {FILTERS.map((item) => {
          const active = filter === item
          return (
            <button
              key={item}
              type="button"
              onClick={() => setFilter(item)}
              className={[
                'min-h-[46px] rounded-full border px-4 text-sm font-semibold transition-colors',
                active
                  ? 'border-primary-600 bg-primary-50 text-primary-700'
                  : 'border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50',
              ].join(' ')}
            >
              {item}
            </button>
          )
        })}
      </div>

      {error ? (
        <ErrorState message={error} className="mt-8 flex-1" />
      ) : visible.length === 0 ? (
        <div className="mt-10">
          <EmptyState icon={BookOpenIcon} title="该分类暂无简历素材" description="请切换其他标签查看" />
        </div>
      ) : (
        <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {visible.map((template) => {
              const active = selected?.id === template.id
              return (
                <Card key={template.id} className={['flex flex-col p-5', active ? 'ring-2 ring-primary-500' : ''].join(' ')}>
                  <button type="button" className="text-left" onClick={() => selectTemplate(template)}>
                    <div className="flex items-center gap-3">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary-50">
                        <LayoutTemplateIcon className="h-6 w-6 text-primary-600" aria-hidden="true" />
                      </div>
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-neutral-900">{template.title}</p>
                        <p className="text-xs text-neutral-400">简历模板</p>
                      </div>
                    </div>
                    <p className="mt-3 min-h-[44px] text-sm leading-relaxed text-neutral-500">{template.description}</p>
                    <p className="mt-2 text-xs leading-relaxed text-neutral-400">{template.recommendedFor}</p>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {template.tags.map((tag) => (
                        <span key={tag} className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-500">
                          {tag}
                        </span>
                      ))}
                    </div>
                  </button>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button size="sm" variant="secondary" className="flex items-center gap-1.5" onClick={handleUseResumeTemplate}>
                      <SparklesIcon className="h-4 w-4" />
                      用于简历优化
                    </Button>
                  </div>
                </Card>
              )
            })}
          </div>

          <Card className="h-fit p-5">
            {!selected ? (
              <EmptyState icon={BookOpenIcon} title="请选择简历素材" />
            ) : (
              <div>
                <p className="text-base font-semibold text-neutral-900">{selected.title}</p>
                <p className="mt-2 text-sm leading-relaxed text-neutral-500">
                  简历模板需要结合你的简历内容生成正式成果物。请选择“用于简历优化”进入现有 AI 简历链路。
                </p>
                <Button size="lg" className="mt-5 w-full" onClick={handleUseResumeTemplate}>
                  用于简历优化
                </Button>
              </div>
            )}
          </Card>
        </div>
      )}

      <p className="mt-6 text-center text-xs text-neutral-400">
        素材仅供个人求职准备、查看和打印；系统不收取求职者简历给企业。
      </p>
      <div className="h-2" />
    </div>
  )
}
