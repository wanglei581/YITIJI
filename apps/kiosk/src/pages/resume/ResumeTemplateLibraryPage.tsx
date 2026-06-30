import { useEffect, useMemo, useState, type ComponentType } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Button, Card, EmptyState, ErrorState, LoadingState, PageHeader } from '@ai-job-print/ui'
import type { JobMaterialGenerateInput, JobMaterialGenerateResponse, JobMaterialTemplate, JobMaterialTemplateType } from '@ai-job-print/shared'
import { makePrintParams } from '@ai-job-print/shared'
import {
  FileTextIcon,
  ImageIcon,
  LayoutTemplateIcon,
  MailIcon,
  PrinterIcon,
  SparklesIcon,
} from 'lucide-react'
import { useAuth } from '../../auth/useAuth'
import { generateJobMaterial, getJobMaterialTemplates } from '../../services/api/jobMaterials'

const FILTERS = ['全部', '简历模板', '求职信', '感谢信', '作品集', '材料清单', '校招', '社招', '通用'] as const

const TYPE_META: Record<JobMaterialTemplateType, {
  label: string
  icon: ComponentType<{ className?: string }>
  color: string
  bg: string
}> = {
  resume_template:     { label: '简历模板',   icon: LayoutTemplateIcon, color: 'text-primary-600', bg: 'bg-primary-50' },
  cover_letter:        { label: '求职信',     icon: MailIcon,           color: 'text-violet-600',  bg: 'bg-violet-50' },
  thank_you:           { label: '感谢信',     icon: FileTextIcon,       color: 'text-amber-600',   bg: 'bg-amber-50' },
  portfolio_cover:     { label: '作品集封面', icon: ImageIcon,          color: 'text-emerald-600', bg: 'bg-emerald-50' },
  materials_checklist: { label: '材料清单',   icon: FileTextIcon,       color: 'text-blue-600',    bg: 'bg-blue-50' },
}

type FormState = Pick<
  JobMaterialGenerateInput,
  'applicantName' | 'targetRole' | 'targetOrganization' | 'keyStrengths' | 'notes'
>

const EMPTY_FORM: FormState = {
  applicantName: '',
  targetRole: '',
  targetOrganization: '',
  keyStrengths: '',
  notes: '',
}

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '—'
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

function typeFilterLabel(type: JobMaterialTemplateType): (typeof FILTERS)[number] {
  if (type === 'resume_template') return '简历模板'
  if (type === 'cover_letter') return '求职信'
  if (type === 'thank_you') return '感谢信'
  if (type === 'portfolio_cover') return '作品集'
  return '材料清单'
}

function defaultFilter(tab: string | null): (typeof FILTERS)[number] {
  if (tab === 'templates') return '简历模板'
  if (tab === 'materials') return '求职信'
  return '全部'
}

export function ResumeTemplateLibraryPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { isLoggedIn, getToken } = useAuth()
  const [templates, setTemplates] = useState<JobMaterialTemplate[]>([])
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>(() => defaultFilter(searchParams.get('tab')))
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [generated, setGenerated] = useState<JobMaterialGenerateResponse | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    getJobMaterialTemplates()
      .then((items) => {
        if (cancelled) return
        setTemplates(items)
        setSelectedId((prev) => prev ?? items[0]?.id ?? null)
        setError(null)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : '素材加载失败')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [])

  const visible = useMemo(() => {
    if (filter === '全部') return templates
    return templates.filter((template) =>
      typeFilterLabel(template.type) === filter ||
      template.tags.includes(filter),
    )
  }, [filter, templates])

  const selected = useMemo(
    () => templates.find((template) => template.id === selectedId) ?? visible[0] ?? templates[0] ?? null,
    [selectedId, templates, visible],
  )

  const updateField = (key: keyof FormState, value: string) => {
    setGenerated(null)
    setSubmitError(null)
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  const selectTemplate = (template: JobMaterialTemplate) => {
    setSelectedId(template.id)
    setGenerated(null)
    setSubmitError(null)
  }

  const handleUseResumeTemplate = () => {
    navigate('/resume/source?intent=optimize')
  }

  const handleGenerate = async () => {
    if (!selected || selected.type === 'resume_template' || submitting) return
    if (!isLoggedIn || !getToken()) {
      navigate('/login', { state: { from: '/resume/templates' } })
      return
    }
    if (!form.applicantName.trim() || !form.targetRole.trim()) {
      setSubmitError('请填写姓名和目标岗位')
      return
    }
    setSubmitting(true)
    setSubmitError(null)
    try {
      const result = await generateJobMaterial({
        templateId: selected.id,
        applicantName: form.applicantName.trim(),
        targetRole: form.targetRole.trim(),
        targetOrganization: form.targetOrganization?.trim() || undefined,
        keyStrengths: form.keyStrengths?.trim() || undefined,
        notes: form.notes?.trim() || undefined,
      }, getToken())
      setGenerated(result)
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : '生成失败，请稍后重试')
    } finally {
      setSubmitting(false)
    }
  }

  const printGenerated = (file: JobMaterialGenerateResponse) => {
    if (!file.signedUrl) return
    navigate('/print/confirm', {
      state: {
        file: {
          name: file.filename,
          size: formatBytes(file.sizeBytes),
          pages: file.pageCount > 0 ? file.pageCount : null,
          fileUrl: file.signedUrl,
          mimeType: file.mimeType,
        },
        params: makePrintParams({
          copies: 1,
          duplex: file.pageCount > 1 ? 'double' : 'single',
          color: 'bw',
        }),
      },
    })
  }

  if (loading) return <LoadingState className="h-full" />

  return (
    <div className="flex h-full flex-col overflow-y-auto p-6">
      <PageHeader
        title="求职材料库"
        subtitle="从模板选择到生成 PDF、保存到我的文档、再按需打印"
        actions={
          <Button size="sm" variant="secondary" onClick={() => navigate('/')}>
            返回首页
          </Button>
        }
      />

      <div className="mt-4 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm leading-relaxed text-blue-700">
        本页仅用于个人求职材料整理、生成和打印。岗位申请、预约、投递仍需前往来源平台或官方渠道完成。
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
                  : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50',
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
          <EmptyState icon={LayoutTemplateIcon} title="该分类暂无素材" description="请切换其他标签查看" />
        </div>
      ) : (
        <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {visible.map((template) => {
              const meta = TYPE_META[template.type]
              const Icon = meta.icon
              const active = selected?.id === template.id
              const canGenerate = template.type !== 'resume_template'
              return (
                <Card key={template.id} className={['flex flex-col p-5', active ? 'ring-2 ring-primary-500' : ''].join(' ')}>
                  <button type="button" className="text-left" onClick={() => selectTemplate(template)}>
                    <div className="flex items-center gap-3">
                      <div className={['flex h-11 w-11 shrink-0 items-center justify-center rounded-lg', meta.bg].join(' ')}>
                        <Icon className={['h-6 w-6', meta.color].join(' ')} aria-hidden="true" />
                      </div>
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-gray-900">{template.title}</p>
                        <p className="text-xs text-gray-400">{meta.label}</p>
                      </div>
                    </div>
                    <p className="mt-3 min-h-[44px] text-sm leading-relaxed text-gray-500">{template.description}</p>
                    <p className="mt-2 text-xs leading-relaxed text-gray-400">{template.recommendedFor}</p>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {template.tags.map((tag) => (
                        <span key={tag} className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
                          {tag}
                        </span>
                      ))}
                    </div>
                  </button>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {canGenerate ? (
                      <Button size="sm" className="flex items-center gap-1.5" onClick={() => selectTemplate(template)}>
                        <SparklesIcon className="h-4 w-4" />
                        填写生成
                      </Button>
                    ) : (
                      <Button size="sm" variant="secondary" className="flex items-center gap-1.5" onClick={handleUseResumeTemplate}>
                        <SparklesIcon className="h-4 w-4" />
                        用于简历优化
                      </Button>
                    )}
                  </div>
                </Card>
              )
            })}
          </div>

          <Card className="h-fit p-5">
            {!selected ? (
              <EmptyState icon={FileTextIcon} title="请选择素材" />
            ) : selected.type === 'resume_template' ? (
              <div>
                <p className="text-base font-semibold text-gray-900">{selected.title}</p>
                <p className="mt-2 text-sm leading-relaxed text-gray-500">
                  简历模板需要结合你的简历内容生成正式成果物。请选择“用于简历优化”进入现有 AI 简历链路。
                </p>
                <Button size="lg" className="mt-5 w-full" onClick={handleUseResumeTemplate}>
                  用于简历优化
                </Button>
              </div>
            ) : (
              <div>
                <p className="text-base font-semibold text-gray-900">{selected.title}</p>
                <p className="mt-1 text-sm text-gray-500">生成后会保存到“我的文档”，仅本人可见。</p>
                <div className="mt-4 space-y-3">
                  {selected.fields.map((field) => {
                    const value = form[field.key] ?? ''
                    const commonClass = 'w-full rounded-lg border border-gray-200 bg-white px-3 text-sm outline-none focus:border-primary-500'
                    return (
                      <label key={field.key} className="block">
                        <span className="mb-1 block text-xs font-semibold text-gray-500">
                          {field.label}{field.required && <span className="text-red-500"> *</span>}
                        </span>
                        {field.multiline ? (
                          <textarea
                            value={value}
                            maxLength={field.maxLength}
                            rows={4}
                            placeholder={field.placeholder}
                            onChange={(event) => updateField(field.key, event.target.value)}
                            className={`${commonClass} py-2`}
                          />
                        ) : (
                          <input
                            value={value}
                            maxLength={field.maxLength}
                            placeholder={field.placeholder}
                            onChange={(event) => updateField(field.key, event.target.value)}
                            className={`${commonClass} h-11`}
                          />
                        )}
                      </label>
                    )
                  })}
                </div>

                {submitError && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{submitError}</p>}
                {generated && (
                  <div className="mt-4 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-700">
                    已生成 {generated.filename}，文件已进入我的文档。
                  </div>
                )}

                <div className="mt-5 grid gap-2">
                  <Button size="lg" disabled={submitting} onClick={() => void handleGenerate()}>
                    {submitting ? '生成中…' : isLoggedIn ? '生成可打印版' : '登录后生成'}
                  </Button>
                  {generated && (
                    <div className="grid grid-cols-2 gap-2">
                      <Button size="md" variant="secondary" onClick={() => navigate('/me/documents')}>
                        查看我的文档
                      </Button>
                      <Button size="md" className="flex items-center justify-center gap-1.5" onClick={() => printGenerated(generated)}>
                        <PrinterIcon className="h-4 w-4" />
                        打印材料
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </Card>
        </div>
      )}

      <p className="mt-6 text-center text-xs text-gray-400">
        素材仅供个人求职准备、查看和打印；系统不收取求职者简历给企业。
      </p>
      <div className="h-2" />
    </div>
  )
}
