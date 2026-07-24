import { useEffect, useMemo, useState, type ComponentType } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Card, EmptyState, ErrorState, KioskPageFrame, LoadingState } from '@ai-job-print/ui'
import type {
  JobMaterialDocumentTemplate,
  JobMaterialGenerateResponse,
  JobMaterialTemplateType,
} from '@ai-job-print/shared'
import { makePrintParams } from '@ai-job-print/shared'
import { ArrowRightIcon, FileTextIcon, ImageIcon, MailIcon, PrinterIcon } from 'lucide-react'
import { useAuth } from '../../auth/useAuth'
import { generateJobMaterial, getJobMaterialTemplates } from '../../services/api/jobMaterials'
import { API_MODE } from '../../services/api/client'
import {
  clearJobMaterialDraft,
  readJobMaterialDraft,
  saveJobMaterialDraft,
  type JobMaterialDraftForm,
} from './jobMaterialDraft'
import './resume-library-lightflow.css'
import './resume-library-ext.css'
import './resume-fusion-youth.css'

const FILTERS = ['全部', '求职信', '感谢信', '作品集', '材料清单', '校招', '社招', '通用'] as const

const TYPE_META: Record<Exclude<JobMaterialTemplateType, 'resume_template'>, {
  label: string
  icon: ComponentType<{ className?: string }>
}> = {
  cover_letter: { label: '求职信', icon: MailIcon },
  thank_you: { label: '感谢信', icon: FileTextIcon },
  portfolio_cover: { label: '作品集封面', icon: ImageIcon },
  materials_checklist: { label: '材料清单', icon: FileTextIcon },
}

type FormState = JobMaterialDraftForm

const EMPTY_FORM: FormState = {
  applicantName: '',
  targetRole: '',
  targetOrganization: '',
  keyStrengths: '',
  notes: '',
}

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '未知'
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

function typeFilterLabel(type: JobMaterialDocumentTemplate['type']): (typeof FILTERS)[number] {
  if (type === 'cover_letter') return '求职信'
  if (type === 'thank_you') return '感谢信'
  if (type === 'portfolio_cover') return '作品集'
  return '材料清单'
}

export function JobMaterialLibraryPage() {
  const navigate = useNavigate()
  const { isLoggedIn, getToken } = useAuth()
  const [templates, setTemplates] = useState<JobMaterialDocumentTemplate[]>([])
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('全部')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [generated, setGenerated] = useState<JobMaterialGenerateResponse | null>(null)

  useEffect(() => {
    const draft = readJobMaterialDraft()
    if (!draft) return
    setSelectedId(draft.selectedId)
    setForm(draft.form)
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    getJobMaterialTemplates()
      .then((items) => {
        if (cancelled) return
        setTemplates(items)
        setSelectedId((prev) => {
          const firstTemplateId = items[0]?.id ?? null
          if (!prev) return firstTemplateId
          return items.some((item) => item.id === prev) ? prev : firstTemplateId
        })
        setError(null)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : '求职材料加载失败')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [])

  const visible = useMemo(() => {
    if (filter === '全部') return templates
    return templates.filter((template) => typeFilterLabel(template.type) === filter || template.tags.includes(filter))
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

  const selectTemplate = (template: JobMaterialDocumentTemplate) => {
    setSelectedId(template.id)
    setGenerated(null)
    setSubmitError(null)
  }

  const handleGenerate = async () => {
    if (!selected || submitting) return
    if (!isLoggedIn || !getToken()) {
      saveJobMaterialDraft(selected.id, form)
      navigate('/login', { state: { from: '/resume/materials' } })
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
      clearJobMaterialDraft()
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : '生成失败，请稍后重试')
    } finally {
      setSubmitting(false)
    }
  }

  const printGenerated = (file: JobMaterialGenerateResponse) => {
    if (!file.printFileUrl) return
    navigate('/print/confirm', {
      state: {
        file: {
          name: file.filename,
          size: formatBytes(file.sizeBytes),
          pages: file.pageCount > 0 ? file.pageCount : null,
          fileUrl: file.printFileUrl,
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

  if (loading) {
    return (
      <KioskPageFrame className="fusion-w3 fusion-w3--resume"><section data-kiosk-domain="resume" data-kiosk-screen="resume-materials" className="resume-lightflow resume-materials-lightflow">
        <LoadingState className="resume-lightflow__state" />
      </section></KioskPageFrame>
    )
  }

  return (
    <KioskPageFrame className="fusion-w3 fusion-w3--resume">
    <section data-kiosk-domain="resume" data-kiosk-screen="resume-materials" className="resume-lightflow resume-materials-lightflow">
      <div className="resume-lightflow__shell">
        <header className="resume-lightflow__header">
          <div>
            <p className="resume-lightflow__eyebrow">AI 求职材料 · 真实生成</p>
            <h1>求职材料库</h1>
            <p>选择所需材料，补充真实信息后生成个人可查看、可打印的 PDF。</p>
          </div>
          <Button size="sm" variant="secondary" className="resume-lightflow__return" onClick={() => navigate('/')}>
            返回首页
          </Button>
        </header>

        <section className="resume-lightflow__notice" aria-label="使用范围说明">
          <FileTextIcon aria-hidden="true" />
          <div>
            <strong>这里生成的是个人求职材料，不会代替你向任何岗位投递。</strong>
            <p>生成、保存和打印都以真实文件状态为准；岗位申请、预约和投递需前往来源平台或官方渠道完成。</p>
          </div>
        </section>

        <nav className="resume-lightflow__filters" aria-label="求职材料分类">
          {FILTERS.map((item) => {
            const active = filter === item
            return (
              <button key={item} type="button" aria-pressed={active} onClick={() => setFilter(item)} className={active ? 'is-active' : undefined}>
                {item}
              </button>
            )
          })}
        </nav>

        {error ? (
          <ErrorState message={error} className="resume-lightflow__state" />
        ) : visible.length === 0 ? (
          <div className="resume-lightflow__state">
            <EmptyState icon={FileTextIcon} title="该分类暂无求职材料" description="请切换其他分类查看" />
          </div>
        ) : (
          <div className="resume-lightflow__workspace">
            <section className="resume-lightflow__catalog" aria-label="可选求职材料">
              {visible.map((template) => {
                const meta = TYPE_META[template.type]
                const Icon = meta.icon
                const active = selected?.id === template.id
                return (
                  <Card key={template.id} className={['resume-lightflow__item', active ? 'is-selected' : ''].join(' ')}>
                    <button type="button" aria-pressed={active} onClick={() => selectTemplate(template)}>
                      <span className="resume-lightflow__item-icon"><Icon aria-hidden="true" /></span>
                      <span className="resume-lightflow__item-copy">
                        <strong>{template.title}</strong>
                        <span>{meta.label}</span>
                      </span>
                    </button>
                    <p>{template.description}</p>
                    <small>{template.recommendedFor}</small>
                    <div className="resume-lightflow__tags">
                      {template.tags.map((tag) => <span key={tag}>{tag}</span>)}
                    </div>
                    <Button
                      size="sm"
                      variant="secondary"
                      className={['rp-state-badge', active ? '' : ''].join(' ').trim()}
                      onClick={() => selectTemplate(template)}
                    >
                      {active ? '正在填写' : '选择并填写'}
                    </Button>
                  </Card>
                )
              })}
            </section>

            <aside className="resume-lightflow__detail" aria-live="polite">
              {!selected ? (
                <EmptyState icon={FileTextIcon} title="请选择求职材料" />
              ) : (
                <>
                  <p className="resume-lightflow__detail-label">正在准备</p>
                  <h2>{selected.title}</h2>
                  <p>填写后生成的材料仅对本人可见。演示模式不会保存真实文件，也不会开放打印。</p>
                  <div className="resume-lightflow__form">
                    {selected.fields.map((field) => {
                      const value = form[field.key] ?? ''
                      return (
                        <label key={field.key}>
                          <span>{field.label}{field.required && <em> *</em>}</span>
                          {field.multiline ? (
                            <textarea
                              value={value}
                              maxLength={field.maxLength}
                              rows={4}
                              placeholder={field.placeholder}
                              onChange={(event) => updateField(field.key, event.target.value)}
                            />
                          ) : (
                            <input
                              value={value}
                              maxLength={field.maxLength}
                              placeholder={field.placeholder}
                              onChange={(event) => updateField(field.key, event.target.value)}
                            />
                          )}
                        </label>
                      )
                    })}
                  </div>

                  {submitError && <p className="resume-lightflow__error" role="alert">{submitError}</p>}
                  {generated && (
                    <div className="resume-lightflow__result">
                      {API_MODE === 'http'
                        ? `已生成 ${generated.filename}，文件已进入我的文档。`
                        : `已生成 ${generated.filename} 的演示结果；演示模式未保存真实文件，暂不可打印。`}
                      {!generated.printFileUrl && API_MODE === 'http' && <p>打印链接未就绪，请重新生成后再试。</p>}
                    </div>
                  )}

                  <div className="resume-lightflow__actions">
                    <Button size="lg" className="resume-lightflow__primary-action" disabled={submitting} onClick={() => void handleGenerate()}>
                      {submitting ? '生成中…' : isLoggedIn ? '生成可打印版' : '登录后生成'} <ArrowRightIcon aria-hidden="true" />
                    </Button>
                    {generated && (
                      <div className="resume-lightflow__split-actions">
                        <Button
                          size="md"
                          variant="secondary"
                          disabled={API_MODE !== 'http'}
                          title={API_MODE !== 'http' ? '演示模式未保存真实文件' : undefined}
                          onClick={() => navigate('/me/documents')}
                        >
                          查看我的文档
                        </Button>
                        <Button
                          size="md"
                          disabled={!generated.printFileUrl}
                          title={!generated.printFileUrl ? (API_MODE !== 'http' ? '演示模式未生成真实文件，暂不可打印' : '打印链接未就绪，请重新生成后再试') : undefined}
                          onClick={() => printGenerated(generated)}
                        >
                          <PrinterIcon aria-hidden="true" /> 打印材料
                        </Button>
                      </div>
                    )}
                  </div>
                </>
              )}
            </aside>
          </div>
        )}

        <p className="resume-lightflow__compliance">素材仅供个人求职准备、查看和打印；系统不收取求职者简历给企业。</p>
      </div>
    </section>
    </KioskPageFrame>
  )
}
