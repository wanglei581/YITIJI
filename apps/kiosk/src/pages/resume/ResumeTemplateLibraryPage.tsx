// 简历素材库 · 版式参考（/resume/templates）。
//
// 视觉真值（2026-09-23 迁入青序流光）：
//   docs/design/kiosk-redesign-2026-08/46-resume-decision-workspace.html?screen=templates
// 本路由在 KioskRoot 之内：舞台缩放由 KioskRoot 负责（已登记 QX_MIGRATED_ROUTES，
// 旧顶栏 / 底栏退出），本页只套 .jfq-root 取宿主 46 的窄屏壳层样式，不再自挂舞台。
//
// 真话边界：模板列表只来自服务端已发布的 resume_template；读取失败 / 为空各有一屏，
// 不用内置默认模板顶替。选中只是本页的版式参考 —— 不保存、不应用、不生成简历。
// 版式示意只画服务端预设里的「栏数」与「分区顺序」这两个事实，不拿示例图冒充预览。
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import type { ResumeTemplate, ResumeTemplateSectionKey } from '@ai-job-print/shared'
import { CheckCircle2Icon, FileTextIcon, LayoutTemplateIcon, LockIcon, PenLineIcon, PrinterIcon, TargetIcon, UserIcon } from 'lucide-react'
import { getResumeTemplates } from '../../services/api/jobMaterials'
import { userMessageOf } from '../../services/api/userErrorMessage'
import { QxAppNavbar } from '../../components/qingxu/QxAppNavbar'
import { QxPageFrame } from '../../components/qingxu/QxPageFrame'
import { Checks, CtaNote, Ghosts, KitRows, ListRows, Nots, RouteCards, Sec, Verdict, Waiting } from './jobFit/jobFitQxKit'
import './job-fit-qx.css'
import './resume-decision-qx.css'

const FILTERS = ['全部', '简历模板', '通用'] as const

type TemplatesScreen = 'loading' | 'error' | 'empty' | 'list' | 'selected'

const SECTION_LABELS: Record<ResumeTemplateSectionKey, string> = {
  header: '基本信息',
  summary: '个人总结',
  education: '教育经历',
  experience: '工作 / 实习经历',
  projects: '项目经历',
  skills: '技能',
  certificates: '证书',
}

const STYLE_LABELS: Record<ResumeTemplate['resumeLayoutPreset']['style'], string> = {
  clean: '清爽',
  compact: '紧凑',
  formal: '正式',
}

function columnsLabel(template: ResumeTemplate): string {
  const columns = template.resumeLayoutPreset.defaultLayout.columns
  return columns === 2 ? '双栏' : columns === 1 ? '单栏' : '栏数未注明'
}

function matchesFilter(template: ResumeTemplate, filter: (typeof FILTERS)[number]): boolean {
  if (filter === '全部') return true
  return template.tags.includes(filter)
}

function QxAction({ label, variant, onClick }: { label: ReactNode; variant: 'ghost' | 'primary'; onClick: () => void }) {
  return <button type="button" className="qx-btn" data-variant={variant} onClick={onClick}>{label}</button>
}

export function ResumeTemplateLibraryPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const legacyMaterialsTab = searchParams.get('tab') === 'materials'
  const [templates, setTemplates] = useState<ResumeTemplate[]>([])
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('全部')
  /** 不自动选中第一份：选中是用户的动作，列表屏与选中屏必须一眼分得出。 */
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  /** 「重新读取模板」只是再发一次同一个 GET，不带缓存、不回填上一次的列表。 */
  const [reloadKey, setReloadKey] = useState(0)

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
    setError(null)
    setTemplates([])
    getResumeTemplates()
      .then((items) => {
        if (cancelled) return
        setTemplates(items)
        setSelectedId((prev) => (prev && items.some((item) => item.id === prev) ? prev : null))
      })
      .catch((err) => {
        if (!cancelled) setError(userMessageOf(err, '简历素材加载失败，请稍后重试'))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [legacyMaterialsTab, reloadKey])

  const visible = useMemo(
    () => templates.filter((template) => matchesFilter(template, filter)),
    [filter, templates],
  )

  const selected = useMemo(
    () => templates.find((template) => template.id === selectedId) ?? null,
    [selectedId, templates],
  )

  const handleUseResumeTemplate = () => {
    navigate('/resume/source?intent=optimize')
  }
  const reload = () => setReloadKey((key) => key + 1)
  const goResumeHub = () => navigate('/resume-service')

  const screen: TemplatesScreen = loading
    ? 'loading'
    : error
      ? 'error'
      : templates.length === 0
        ? 'empty'
        : selected
          ? 'selected'
          : 'list'

  const fallbackKit = (
    <KitRows items={[
      { icon: <PenLineIcon size={22} />, title: '直接去简历优化', desc: '按目标岗位重排已有内容，不依赖模板', onClick: handleUseResumeTemplate },
      { icon: <FileTextIcon size={22} />, title: '生成一份新简历', desc: '还没有简历时从结构化填写开始', onClick: () => navigate('/resume/generate') },
      { icon: <PrinterIcon size={22} />, title: '打印现有简历', desc: '手上已有可用文件就直接打印', onClick: () => navigate('/print-scan') },
    ]} />
  )

  function buildView(): { title: string; subtitle: string; pill: { tone: 'ok' | 'warn' | 'bad' | 'unknown'; label: string }; body: ReactNode; cta: ReactNode } {
    if (screen === 'loading') return {
      title: '正在读取版式，还没有列表',
      subtitle: '简历素材库的模板列表由服务端发布。读取完成前不显示任何模板名称、数量或已选状态。',
      pill: { tone: 'unknown', label: '正在读取简历模板列表' },
      body: (
        <>
          <Sec title="正在读取可用的简历模板" hint="无进度条 · 无预计时间">
            <Waiting icon={<LayoutTemplateIcon size={34} />} title="读取请求已提交，等待服务端返回" desc="只显示服务端已发布的模板。读取失败或没有模板时会直接说明，不用内置默认模板顶替。" tag="整体等待中，没有百分比" />
          </Sec>
          <Sec title="这一步会做什么、不会做什么" hint="读取范围写在前面" grow>
            <Checks items={[
              { tone: 'ok', icon: <UserIcon size={24} />, title: '只读列表', desc: '这一步只读取模板列表，不读取你的简历内容。', chip: '已确认' },
              { tone: 'wait', icon: <LayoutTemplateIcon size={24} />, title: '模板数量', desc: '有几个模板由服务端发布结果决定，本页不预设。', chip: '等待返回' },
              { tone: 'ok', icon: <LockIcon size={24} />, title: '不自动应用', desc: '读到列表也不会自动套用到你的简历上。', chip: '已固定' },
            ]} />
          </Sec>
          <Sec title="还没有返回的内容" hint="返回前一律留空">
            <Ghosts items={[
              { title: '模板名称', desc: '标题与适用场景由服务端提供。', tag: '等待返回' },
              { title: '版式结构', desc: '栏数与分区顺序随模板返回。', tag: '等待返回' },
              { title: '适用说明', desc: '适合哪类经历由发布方说明。', tag: '等待返回' },
            ]} />
          </Sec>
        </>
      ),
      cta: (
        <>
          <CtaNote>读取期间不显示任何模板，也不保存任何选择。</CtaNote>
          <QxAction label="返回简历服务" variant="ghost" onClick={goResumeHub} />
          <QxAction label="不等模板，直接去简历优化" variant="primary" onClick={handleUseResumeTemplate} />
        </>
      ),
    }

    if (screen === 'error') return {
      title: '模板列表这次没读到',
      subtitle: '读取失败。系统不会用内置默认模板冒充服务端列表，也不显示上一次的缓存内容。',
      pill: { tone: 'bad', label: '简历模板列表读取失败' },
      body: (
        <>
          <Sec title="这次的结果" hint="只写已确认的事实">
            <Verdict items={[
              { tone: 'bad', label: '模板列表', value: '未读取到' },
              { tone: 'ok', label: '简历优化', value: '不依赖模板' },
            ]} />
            <p className="jfq-alert" role="alert">{error}</p>
          </Sec>
          <Sec title="这次没有发生的事" hint="失败不影响你已有的内容" grow>
            <Nots items={[
              '没有显示任何模板名称或版式',
              '没有用内置默认模板冒充服务端列表',
              '没有把任何版式套用到你的简历上',
              '没有修改或保存你的简历内容',
            ]} />
          </Sec>
          <Sec title="接下来" hint="版式不是前提，内容才是">
            <RouteCards items={[
              { title: '重新读取模板', desc: '网络或服务恢复之后可以再试一次。', action: '重新读取', onClick: reload },
              { title: '不用模板，直接优化', desc: '先按目标岗位调整内容重点，版式随后再说。', action: '去简历优化', onClick: handleUseResumeTemplate },
            ]} />
          </Sec>
        </>
      ),
      cta: (
        <>
          <CtaNote>模板只影响排版，不影响你已有的简历内容。</CtaNote>
          <QxAction label="返回简历服务" variant="ghost" onClick={goResumeHub} />
          <QxAction label="重新读取模板" variant="primary" onClick={reload} />
        </>
      ),
    }

    if (screen === 'empty') return {
      title: '当前没有已发布的简历模板',
      subtitle: '服务端这次没有返回任何已发布模板。这不影响你继续准备简历 —— 内容比版式更重要。',
      pill: { tone: 'warn', label: '当前没有可用的简历模板' },
      body: (
        <>
          <Sec title="当前状态" hint="读取成功，只是内容为空">
            <Verdict items={[
              { tone: 'warn', label: '已发布模板', value: '数量为 0' },
              { tone: 'ok', label: '本次读取', value: '已成功完成' },
              { tone: 'ok', label: '简历优化', value: '可以直接进行' },
            ]} />
          </Sec>
          <Sec title="没有模板时，这样准备一样有效" hint="一页 A4 就够" grow>
            <ListRows items={[
              '用一页 A4 说清楚：目标岗位、核心能力、可验证的成果',
              '把与目标岗位最相关的经历放在最前面，其余往后压',
              '每段经历写清楚：做了什么、怎么做的、结果是什么',
              '只写你本人能解释清楚的事实，不写无法印证的内容',
              '打印前先看一遍分页，避免关键内容被切到第二页',
            ]} />
          </Sec>
          <Sec title="不用等版式也能推进" hint="都是既有入口">{fallbackKit}</Sec>
        </>
      ),
      cta: (
        <>
          <CtaNote>模板列表为空不代表服务异常；发布后会出现在这一页。</CtaNote>
          <QxAction label="重新读取模板" variant="ghost" onClick={reload} />
          <QxAction label="去简历优化" variant="primary" onClick={handleUseResumeTemplate} />
        </>
      ),
    }

    const tips = selected
      ? [
          { icon: <CheckCircle2Icon size={22} aria-hidden="true" />, title: '经历与成果属实', desc: '版式不改事实：写上去的每一条都要是你能解释清楚的。' },
          { icon: <TargetIcon size={22} aria-hidden="true" />, title: '和目标岗位对得上', desc: '把与目标最相关的经历放前面，其余往后压。' },
          { icon: <PrinterIcon size={22} aria-hidden="true" />, title: '分页别切断内容', desc: '打印前看一遍分页，避免关键段落被切到第二页。' },
        ]
      : [
          { icon: <PenLineIcon size={22} aria-hidden="true" />, title: '内容优先', desc: '版式只影响排版，不会改写你的经历、技能或成果。' },
          { icon: <FileTextIcon size={22} aria-hidden="true" />, title: '一页 A4 最稳', desc: '多数岗位一页就够；写不下时先压缩不相关的经历。' },
          { icon: <LockIcon size={22} aria-hidden="true" />, title: '选了也能反悔', desc: '这一页只做版式参考，换一个或不选都不影响你的材料。' },
        ]

    return {
      title: selected ? '版式选好了，再核对内容' : '先挑一个版式，内容仍由你决定',
      subtitle: selected
        ? '选中只是这次的版式参考。正式简历在后续流程结合你的真实内容生成，这里不冒充已生成。'
        : '简历素材库：模板由服务端发布。选中后可以看版式结构，不会自动应用，也不会直接生成简历。',
      pill: selected
        ? { tone: 'ok', label: '已选中一个版式 · 未保存' }
        : { tone: 'ok', label: '模板列表以服务端返回为准' },
      body: (
        <>
          <Sec title="选择一个版式参考" hint={selected ? '已选中 1 个' : '按真实分类筛选'}>
            <nav className="rdq-filters" aria-label="简历素材分类">
              {FILTERS.map((item) => (
                <button key={item} type="button" aria-pressed={filter === item} onClick={() => setFilter(item)}>
                  {item}
                </button>
              ))}
            </nav>
            {visible.length === 0 ? (
              <p className="jfq-notice">该分类暂无简历素材，切换其他分类查看；空列表不使用占位模板填充。</p>
            ) : (
              <div className="rdq-tpl-grid" aria-label="可选简历素材">
                {visible.map((template) => (
                  <button
                    key={template.id}
                    type="button"
                    className="rdq-tpl"
                    aria-pressed={selected?.id === template.id}
                    onClick={() => setSelectedId(template.id)}
                    data-testid={`resume-templates-template-${template.id}`}
                  >
                    <span className="rdq-tpl-art" data-columns={template.resumeLayoutPreset.defaultLayout.columns === 2 ? '2' : '1'} aria-hidden="true">
                      <i /><i /><i />
                    </span>
                    <h3>{template.title}</h3>
                    <p>{template.description}</p>
                    <small>{template.recommendedFor}</small>
                    <span className="rdq-tags">{template.tags.map((tag) => <span key={tag}>{tag}</span>)}</span>
                    <span className="rdq-tpl-state">{selected?.id === template.id ? '当前选择' : '选择此版式'}</span>
                  </button>
                ))}
              </div>
            )}
          </Sec>
          <Sec title={selected ? '进入优化前核对' : '版式怎么选'} hint={selected ? '内容比版式更重要' : '选之前先看这几点'}>
            <div className="rdq-split">
              <div className="rdq-preview" data-selected={selected ? 'true' : undefined} aria-live="polite">
                <div className="rdq-preview-head">
                  <b>版式结构</b>
                  <small>{selected ? selected.title : '尚未选择'}</small>
                </div>
                {selected ? (
                  <>
                    <p className="jfq-sec-copy">
                      {STYLE_LABELS[selected.resumeLayoutPreset.style]}风格 · {columnsLabel(selected)} · 分区顺序来自该模板的服务端预设：
                    </p>
                    <ol className="rdq-sections">
                      {selected.resumeLayoutPreset.sectionOrder.map((key) => <li key={key}>{SECTION_LABELS[key] ?? key}</li>)}
                    </ol>
                    <p className="rdq-muted">正式版式在简历优化页重新确认；本页不会保存或应用模板。</p>
                  </>
                ) : (
                  <p className="rdq-muted">选中一份已发布模板后，这里显示它的栏数与分区顺序。这里不拿示例图顶替预览。</p>
                )}
              </div>
              <div className="rdq-tips">
                {tips.map((tip) => (
                  <div key={tip.title} className="rdq-tip">
                    {tip.icon}
                    <span><b>{tip.title}</b><p>{tip.desc}</p></span>
                  </div>
                ))}
              </div>
            </div>
          </Sec>
          <Sec title="不用等版式也能推进" hint="都是既有入口">{fallbackKit}</Sec>
          <p className="rdq-muted">素材仅供个人求职准备、查看和打印；系统不收取求职者简历给企业。岗位申请和投递仍在来源平台或官方渠道完成。</p>
        </>
      ),
      cta: (
        <>
          <CtaNote>{selected ? '此页不会保存模板选择，也不会直接生成简历。' : '模板由服务端发布；此页不会保存模板选择，也不会直接生成简历。'}</CtaNote>
          {selected
            ? <QxAction label="换一个版式" variant="ghost" onClick={() => setSelectedId(null)} />
            : <QxAction label="重新读取模板" variant="ghost" onClick={reload} />}
          <QxAction label="进入简历优化" variant="primary" onClick={handleUseResumeTemplate} />
        </>
      ),
    }
  }

  const view = buildView()

  return (
    <div className="jfq-root">
      <QxPageFrame
        title={view.title}
        subtitle={view.subtitle}
        status={view.pill}
        back={{ label: '返回简历服务', onBack: goResumeHub }}
        ctabar={view.cta}
        navbar={(
          <QxAppNavbar
            onHome={() => navigate('/')}
            onAdvisor={() => navigate('/assistant')}
            onProfile={() => navigate('/profile')}
          />
        )}
      >
        <section
          className="qx-scroll"
          data-kiosk-domain="resume"
          data-kiosk-screen="resume-templates"
          data-state={screen}
          data-testid={`resume-templates-state-${screen}`}
          aria-label="简历素材库"
        >
          {view.body}
        </section>
      </QxPageFrame>
    </div>
  )
}
