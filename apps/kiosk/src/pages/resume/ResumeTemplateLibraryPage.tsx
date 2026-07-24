import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Button, Card, EmptyState, ErrorState, KioskPageFrame, LoadingState } from '@ai-job-print/ui'
import type { ResumeTemplate } from '@ai-job-print/shared'
import { ArrowRightIcon, BookOpenIcon, CheckIcon } from 'lucide-react'
import { getResumeTemplates } from '../../services/api/jobMaterials'
import './resume-library-lightflow.css'
import './resume-library-ext.css'
import './resume-fusion-youth.css'

const FILTERS = ['全部', '简历模板', '通用'] as const

type TemplateLayout = 'single' | 'double' | 'side'

function guessLayout(template: ResumeTemplate): TemplateLayout {
  const t = template.title ?? ''
  if (t.includes('双栏') || t.includes('项目')) return 'double'
  if (t.includes('侧栏') || t.includes('侧边')) return 'side'
  return 'single'
}

function TemplateThumbnail({ layout }: { layout: TemplateLayout }) {
  const tl = (extra?: string) => (
    <span className={['rp-tl', extra].filter(Boolean).join(' ')} />
  )
  if (layout === 'side') {
    return (
      <div className="rp-thumb">
        <span className="rp-thumb__side" />
        <div className="rp-thumb__col">
          {tl('rp-tl--title')}
          {tl('rp-tl--w5')}
          {tl('rp-tl--accent')}
          {tl('rp-tl--w9')}
          {tl('rp-tl--w7')}
          {tl('rp-tl--accent')}
          {tl('rp-tl--w9')}
          {tl('rp-tl--w5')}
        </div>
      </div>
    )
  }
  if (layout === 'double') {
    return (
      <div className="rp-thumb">
        <div className="rp-thumb__col">
          {tl('rp-tl--title')}
          {tl('rp-tl--accent')}
          {tl('rp-tl--w9')}
          {tl('rp-tl--w7')}
          {tl('rp-tl--w9')}
          {tl('rp-tl--w5')}
        </div>
        <div className="rp-thumb__col">
          {tl('rp-tl--accent')}
          {tl('rp-tl--w9')}
          {tl('rp-tl--w7')}
          {tl('rp-tl--accent')}
          {tl('rp-tl--w9')}
          {tl('rp-tl--w5')}
        </div>
      </div>
    )
  }
  // single
  return (
    <div className="rp-thumb">
      <div className="rp-thumb__col">
        {tl('rp-tl--title')}
        {tl('rp-tl--w5')}
        {tl('rp-tl--accent')}
        {tl('rp-tl--w9')}
        {tl('rp-tl--w9')}
        {tl('rp-tl--w7')}
        {tl('rp-tl--accent')}
        {tl('rp-tl--w9')}
        {tl('rp-tl--w7')}
        {tl('rp-tl--w5')}
      </div>
    </div>
  )
}

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

  if (loading) {
    return (
      <KioskPageFrame className="fusion-w3 fusion-w3--resume"><main data-kiosk-domain="resume" data-kiosk-screen="resume-templates" className="resume-lightflow resume-templates-lightflow">
        <LoadingState className="resume-lightflow__state" />
      </main></KioskPageFrame>
    )
  }

  return (
    <KioskPageFrame className="fusion-w3 fusion-w3--resume">
    <main data-kiosk-domain="resume" data-kiosk-screen="resume-templates" className="resume-lightflow resume-templates-lightflow">
      <div className="resume-lightflow__shell">
        <header className="resume-lightflow__header">
          <div>
            <p className="resume-lightflow__eyebrow">AI 简历服务 · 版式参考</p>
            <h1>简历素材库</h1>
            <p>先选版式方向，再进入现有简历优化流程生成正式内容。</p>
          </div>
          <Button size="sm" variant="secondary" className="resume-lightflow__return" onClick={() => navigate('/')}>
            返回首页
          </Button>
        </header>

        <section className="resume-lightflow__notice" aria-label="使用范围说明">
          <BookOpenIcon aria-hidden="true" />
          <div>
            <strong>选择仅代表版式参考，不会自动生成或应用简历。</strong>
            <p>正式简历需要在后续流程结合你的真实内容生成；岗位申请和投递仍在来源平台或官方渠道完成。</p>
          </div>
        </section>

        <nav className="resume-lightflow__filters" aria-label="简历素材分类">
          {FILTERS.map((item) => {
            const active = filter === item
            return (
              <button
                key={item}
                type="button"
                aria-pressed={active}
                onClick={() => setFilter(item)}
                className={active ? 'is-active' : undefined}
              >
                {item}
              </button>
            )
          })}
        </nav>

        {error ? (
          <ErrorState message={error} className="resume-lightflow__state" />
        ) : visible.length === 0 ? (
          <div className="resume-lightflow__state">
            <EmptyState icon={BookOpenIcon} title="该分类暂无简历素材" description="请切换其他分类查看" />
          </div>
        ) : (
          <main className="resume-lightflow__workspace">
            <section className="resume-lightflow__catalog" aria-label="可选简历素材">
              {visible.map((template) => {
                const active = selected?.id === template.id
                return (
                  <Card key={template.id} className={['resume-lightflow__item', active ? 'is-selected' : ''].join(' ')}>
                    <button
                      type="button"
                      aria-pressed={selected?.id === template.id}
                      onClick={() => selectTemplate(template)}
                    >
                      <TemplateThumbnail layout={guessLayout(template)} />
                      <span className="resume-lightflow__item-copy">
                        <strong>{template.title}{active && <CheckIcon style={{ width: 16, height: 16, display: 'inline', marginLeft: 6, verticalAlign: 'middle' }} aria-label="当前选择" />}</strong>
                        <span>简历模板</span>
                      </span>
                    </button>
                    <p>{template.description}</p>
                    <small>{template.recommendedFor}</small>
                    <div className="resume-lightflow__tags">
                      {template.tags.map((tag) => <span key={tag}>{tag}</span>)}
                    </div>
                    <Button size="sm" variant="secondary" onClick={() => selectTemplate(template)}>
                      {active ? '当前选择' : '选择此版式'}
                    </Button>
                  </Card>
                )
              })}
            </section>

            <aside className="resume-lightflow__detail" aria-live="polite">
              {!selected ? (
                <EmptyState icon={BookOpenIcon} title="请选择简历素材" />
              ) : (
                <>
                  <p className="resume-lightflow__detail-label">当前版式参考</p>
                  <h2>{selected.title}</h2>
                  <p>{selected.description}</p>
                  <div className="resume-lightflow__boundary">
                    <strong>选择仅代表版式参考</strong>
                    <span>不会自动生成或应用简历；正式简历需要在后续流程结合你的真实内容生成。</span>
                  </div>
                  <div className="rp-boundary-2">
                    <strong>下一步会发生什么</strong>
                    <span>进入 AI 简历优化后，系统会基于你的内容生成正式简历，模板在优化页重新确认；本页不会保存或应用模板。</span>
                  </div>
                  <Button size="lg" className="resume-lightflow__primary-action" onClick={handleUseResumeTemplate}>
                    进入简历优化 <ArrowRightIcon aria-hidden="true" />
                  </Button>
                </>
              )}
            </aside>
          </main>
        )}

        <p className="resume-lightflow__compliance">素材仅供个人求职准备、查看和打印；系统不收取求职者简历给企业。</p>
      </div>
    </main>
    </KioskPageFrame>
  )
}
