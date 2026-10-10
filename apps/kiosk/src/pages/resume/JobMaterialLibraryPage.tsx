// 求职材料库（/resume/materials）。
//
// 视觉真值（2026-09-23 迁入青序流光）：docs/design/kiosk-redesign-2026-08/25-material-workshop.html
// 本路由在 KioskRoot 之内（已登记 QX_MIGRATED_ROUTES）：舞台缩放由 KioskRoot 负责，本页不再自挂舞台。
//
// 真话边界（照稿 25 顶部注释；本次只换装，不新增链路）：
//   · 模板目录只来自服务端；读取失败与空列表各有一屏，不用内置模板补位。
//   · 必填为空不发请求：就地标红并聚焦第一个出错字段。
//   · 生成中不画百分比 / 阶段点；文件卡只摊开 POST 返回的真实字段，签名链接本身不上屏。
//   · 没有 printFileUrl 只禁打印；演示模式不保存真实文件，我的文档与打印都停用。
//   · 预览只给服务端真实文件（fileId + previewUrlPath）：凭本人令牌现换一次短期查看链接，交给既有 FilePreviewDialog；
//     链接只放内存、只认这一次生成的文件，不上屏、不进地址栏。演示对象不给预览（稿 25 的全屏预览层版式未照搬）。
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import type { JobMaterialDocumentTemplate, JobMaterialGenerateResponse } from '@ai-job-print/shared'
import {
  AlertTriangleIcon, CheckCircle2Icon, ChevronRightIcon, ClockIcon, FileTextIcon, FolderOpenIcon, InfoIcon, PenLineIcon, PrinterIcon, SparklesIcon,
} from 'lucide-react'
import { useAuth } from '../../auth/useAuth'
import { FilePreviewDialog } from '../../components/FilePreviewDialog'
import { QxAiHelp, QxStepActions } from '../../components/qingxu/QxAiHelp'
import { QxAppNavbar } from '../../components/qingxu/QxAppNavbar'
import { QxPageFrame } from '../../components/qingxu/QxPageFrame'
import { useBusyLock } from '../../contexts/KioskBusyContext'
import { generateJobMaterial, getJobMaterialTemplates } from '../../services/api/jobMaterials'
import { fetchAccessUrl } from '../../services/api/memberAssets'
import { userMessageOf } from '../../services/api/userErrorMessage'
import { API_MODE } from '../../services/api/client'
import { clearJobMaterialDraft, readJobMaterialDraft, saveJobMaterialDraft, type JobMaterialDraftForm } from './jobMaterialDraft'
import { useStartPrintHandoff } from '../print/usePrintHandoff'
import {
  ALWAYS_REQUIRED, Banner, fieldDomId, FileCard, FILTERS, formatBytes, isRequired, previewPathOf,
  StateBlock, STATUS_SCREENS, typeFilterLabel, TYPE_LABEL, VIEW, type FieldKey, type Filter, type Screen,
} from './jobMaterialLibraryParts'
import './resume-materials-qx.css'

const EMPTY_FORM: JobMaterialDraftForm = { applicantName: '', targetRole: '', targetOrganization: '', keyStrengths: '', notes: '' }

export function JobMaterialLibraryPage() {
  const navigate = useNavigate()
  const startPrint = useStartPrintHandoff()
  const { isLoggedIn, getToken } = useAuth()
  const [templates, setTemplates] = useState<JobMaterialDocumentTemplate[]>([])
  const [filter, setFilter] = useState<Filter>('全部')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [form, setForm] = useState<JobMaterialDraftForm>(EMPTY_FORM)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  /** 「重新读取」只是再发一次同一个 GET，不带缓存、不回填上一次的列表。 */
  const [reloadKey, setReloadKey] = useState(0)
  const [draftRestored, setDraftRestored] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldKey, string>>>({})
  const [submitting, setSubmitting] = useState(false)
  // 生成求职材料是长调用（可达 150s+），期间不能被隐私硬截止清场（SES-10）
  useBusyLock(submitting)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [generated, setGenerated] = useState<JobMaterialGenerateResponse | null>(null)
  /** 预览结果绑定到这一次生成返回的对象：改字段 / 重新生成后，旧链接或旧失败都不会挂到新文件卡上。 */
  const [preview, setPreview] = useState<{ file: JobMaterialGenerateResponse; url?: string; error?: string } | null>(null)
  const [previewBusy, setPreviewBusy] = useState(false)

  useEffect(() => {
    const draft = readJobMaterialDraft()
    if (!draft) return
    setSelectedId(draft.selectedId)
    setForm(draft.form)
    setDraftRestored(true)
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setTemplates([])
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
      .catch((err) => { if (!cancelled) setError(userMessageOf(err, '求职材料加载失败，请稍后重试')) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [reloadKey])

  const visible = useMemo(() => {
    if (filter === '全部') return templates
    return templates.filter((template) => typeFilterLabel(template.type) === filter || template.tags.includes(filter))
  }, [filter, templates])

  const selected = useMemo(
    () => templates.find((template) => template.id === selectedId) ?? visible[0] ?? templates[0] ?? null,
    [selectedId, templates, visible],
  )

  // 改字段 / 换模板都会收起已生成的文件卡：屏幕上不能一边写「已生成」一边其实是旧草稿。
  const updateField = (key: FieldKey, value: string) => {
    setGenerated(null)
    setSubmitError(null)
    setFieldErrors((prev) => (prev[key] && value.trim() ? { ...prev, [key]: undefined } : prev))
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
    const labels: Partial<Record<FieldKey, string>> = { ...ALWAYS_REQUIRED }
    for (const field of selected.fields) if (field.required) labels[field.key] = field.label
    const missing = (Object.keys(labels) as FieldKey[]).filter((key) => !(form[key] ?? '').trim())
    if (missing.length > 0) {
      setFieldErrors(Object.fromEntries(missing.map((key) => [key, `请填写${labels[key]}`])))
      setSubmitError(null)
      document.getElementById(fieldDomId(missing[0]))?.focus()
      return
    }
    setFieldErrors({})
    setDraftRestored(false)
    setSubmitting(true)
    setSubmitError(null)
    try {
      const result = await generateJobMaterial({
        templateId: selected.id, applicantName: form.applicantName.trim(), targetRole: form.targetRole.trim(),
        targetOrganization: form.targetOrganization?.trim() || undefined,
        keyStrengths: form.keyStrengths?.trim() || undefined, notes: form.notes?.trim() || undefined,
      }, getToken())
      setGenerated(result)
      clearJobMaterialDraft()
    } catch (err) {
      setSubmitError(userMessageOf(err, '生成失败，请稍后重试'))
    } finally {
      setSubmitting(false)
    }
  }

  const printGenerated = (file: JobMaterialGenerateResponse) => {
    if (!file.printFileUrl) return
    startPrint({
      origin: 'job_material',
      returnPath: window.location.pathname,
      paramsSuggestion: file.pageCount > 1 ? { duplex: 'duplex_long_edge' } : undefined,
      file: {
        name: file.filename,
        size: formatBytes(file.sizeBytes),
        pages: file.pageCount > 0 ? file.pageCount : null,
        fileId: file.fileId,
        fileUrl: file.printFileUrl,
        mimeType: file.mimeType,
      },
    })
  }

  const reload = () => setReloadKey((key) => key + 1)
  const goResumeHub = () => navigate('/resume-service')
  const demoMode = API_MODE !== 'http'
  const openPreview = async (file: JobMaterialGenerateResponse) => {
    const path = previewPathOf(file, demoMode)
    const token = getToken()
    if (!path || !token || previewBusy) return
    setPreviewBusy(true)
    setPreview(null)
    try {
      const res = await fetchAccessUrl(path, token)
      if (!res?.url) throw new Error('preview url missing')
      setPreview({ file, url: res.url })
    } catch (err) {
      setPreview({ file, error: userMessageOf(err, '预览链接没能生成，可能已到期或被清理') })
    } finally {
      setPreviewBusy(false)
    }
  }

  const screen: Screen = loading ? 'loading'
    : error ? 'error'
      : templates.length === 0 ? 'empty'
        : submitting ? 'submitting'
          : submitError ? 'failed'
            : generated ? (demoMode ? 'demo-result' : generated.printFileUrl ? 'generated' : 'generated-no-print')
              : 'select'
  const signedOutSelect = screen === 'select' && !isLoggedIn
  const [tone, pillLabel, subtitle] = signedOutSelect
    ? ['warn' as const, '未登录 · 生成前先存草稿', '模板目录随便看；点「登录后生成」时才需要登录，草稿不会丢。']
    : VIEW[screen]
  const others = filter === '全部' ? [] : templates.filter((template) => !visible.includes(template))
  const currentPreview = generated && preview?.file === generated ? preview : null
  const btn = (variant: 'ghost' | 'primary', label: ReactNode, onClick: () => void) => (
    <button type="button" className="qx-btn" data-variant={variant} onClick={onClick}>{label}</button>
  )
  // 稿 25 底栏一句边界：不代投递与「不收取简历给企业」合并，费用句照稿。核对页数挪到生成后的说明。
  const truthBar = (
    <div className="qx-rm-truth" data-testid="material-workshop-truth">
      <p>模板按你填的内容排版，不调用 AI；不代投递，系统不收取求职者简历给企业，费用以确认时显示为准。</p>
      <button type="button" className="qx-rm-help" onClick={() => navigate('/help')}>遇到问题</button>
    </div>
  )

  // 模板读不到时的四个既有出口（稿 25 的 manualFallback）；这一块吸收整屏余量。
  const fallbackRows = (
    <div className="qx-rm-alt">
      <div className="qx-sec-h"><span className="t">模板读不到时仍可处理</span><span className="hint">都是既有入口</span></div>
      <div className="qx-rows">
        {[
          { to: '/print/upload', icon: <PrinterIcon size={26} />, t: '打印已有材料', d: 'U 盘、手机传输或扫描原件都可以，不依赖模板目录。' },
          { to: '/resume/source', icon: <SparklesIcon size={26} />, t: '先做一次简历诊断', d: '诊断和材料模板是两条流程，这条照常可用。' },
          { to: '/me/documents', icon: <FolderOpenIcon size={26} />, t: '翻我的文档里已有的材料', d: '此前生成过的材料不受影响；登录后可以查看和打印。' },
          { to: '/assistant', icon: <PenLineIcon size={26} />, t: '向 AI 顾问要通用写作建议', d: '顾问建议不等于生成文件，也不会自动保存。' },
        ].map((row) => (
          <button key={row.to} type="button" className="qx-row" onClick={() => navigate(row.to)}>
            <span className="qx-row-ic" aria-hidden="true">{row.icon}</span>
            <span className="qx-row-tx"><span className="qx-row-t">{row.t}</span><span className="qx-row-d">{row.d}</span></span>
            <ChevronRightIcon className="qx-row-go" size={24} aria-hidden="true" />
          </button>
        ))}
      </div>
    </div>
  )

  const renderField = (field: JobMaterialDocumentTemplate['fields'][number]) => {
    const id = fieldDomId(field.key)
    const fieldError = fieldErrors[field.key]
    const common = {
      id, value: form[field.key] ?? '', maxLength: field.maxLength, placeholder: field.placeholder, disabled: submitting,
      'aria-invalid': fieldError ? true : undefined, 'aria-describedby': fieldError ? `${id}-error` : undefined,
    }
    return (
      <label key={field.key} className="qx-rm-field" data-wide={field.multiline ? 'true' : undefined}>
        <span>{field.label}{isRequired(field) && <em> *</em>} · 最多 {field.maxLength} 字</span>
        {field.multiline
          ? <textarea {...common} rows={4} onChange={(event) => updateField(field.key, event.target.value)} />
          : <input {...common} onChange={(event) => updateField(field.key, event.target.value)} />}
        {fieldError ? <span className="fe" id={`${id}-error`} role="alert">{fieldError}</span> : null}
      </label>
    )
  }

  const renderDetail = (template: JobMaterialDocumentTemplate) => (
    <>
      <div className="qx-rm-detail-h">
        <span className="no">{generated ? '已生成' : '正在准备'}</span>
        <span className="hint">{generated ? '改过内容后需重新生成' : '一次生成一份 PDF'}</span>
      </div>
      <h2>{template.title}</h2>
      <p className="qx-rm-lead">{template.recommendedFor}。模板只按你填写的内容排版，不读取简历，不调用 AI；生成的材料仅对本人可见。</p>
      <div className="qx-rm-tmeta" data-testid="material-workshop-template-meta">
        <div><u>输出文件名</u><b>{template.outputFilename}</b></div>
        <div><u>材料类型</u><b>{TYPE_LABEL[template.type]}</b></div>
        <div><u>要填的项</u><b>{template.fields.length} 项 · {template.fields.filter(isRequired).length} 必填</b></div>
        <div><u>页数</u><b>生成后返回</b></div>
      </div>
      {demoMode ? <Banner tone="warn" icon={<InfoIcon size={20} aria-hidden="true" />}>演示模式不会保存真实文件，也不会开放打印。</Banner> : null}
      {draftRestored && !generated ? (
        <Banner testId="material-workshop-draft-restored" icon={<CheckCircle2Icon size={20} aria-hidden="true" />}>
          <b>草稿已原样带回。</b>确认下面的内容无误，再点「生成可打印版」——登录本身不会自动替你提交。
        </Banner>
      ) : null}
      {/* 单行字段两两成排；多行字段各占整行并吸收余量（稿 25 的 form.grow），不留一片空白。 */}
      <div className="qx-rm-form" role="group" aria-label="要填写的内容">
        <div className="qx-rm-form-grid">{template.fields.filter((field) => !field.multiline).map(renderField)}</div>
        {template.fields.filter((field) => field.multiline).map(renderField)}
      </div>
      {submitting ? (
        <Banner icon={<ClockIcon size={20} aria-hidden="true" />}>
          <b>正在生成《{template.title}》这一份 PDF。</b>没有阶段进度和预计时间；返回真实文件前不显示文件名、页数或打印入口。
        </Banner>
      ) : null}
      {submitError ? (
        <Banner tone="bad" alert icon={<AlertTriangleIcon size={20} aria-hidden="true" />}>
          <b>这次没能生成出来：{submitError}</b> 你填的内容还在，改一改再试一次；本机不会用示例文件冒充结果。
        </Banner>
      ) : null}
      {generated && !submitting ? (
        <FileCard file={generated} demo={demoMode} previewBusy={previewBusy} previewError={currentPreview?.error}
          onPreview={previewPathOf(generated, demoMode) && isLoggedIn ? () => void openPreview(generated) : undefined} />
      ) : null}
    </>
  )

  const afterFlow = (
    <div className="qx-rm-after" data-testid="material-workshop-after">
      <b>生成后</b>
      <span className="st"><i>1</i>获得材料 PDF</span><span className="sep">›</span>
      <span className="st"><i>2</i>核对完整内容</span><span className="sep">›</span>
      <span className="st"><i>3</i>带走电子版或打印件</span>
    </div>
  )

  let body: ReactNode
  let cta: ReactNode
  if (screen === 'loading' || screen === 'error' || screen === 'empty') {
    const status = STATUS_SCREENS[screen]
    body = (
      <>
        {screen !== 'loading' && <div className="qx-rm-after">
          <b>{screen === 'empty' ? '模板发布后' : '重新读取会'}</b>
          <span className="st"><i>1</i>{screen === 'empty' ? '目录里自动出现' : '只重发这一次目录请求'}</span><span className="sep">›</span>
          <span className="st"><i>2</i>{screen === 'empty' ? '你选好模板再填写' : '不改动你填过的内容'}</span><span className="sep">›</span>
          <span className="st"><i>3</i>{screen === 'empty' ? '生成可打印 PDF' : '读到才显示模板名'}</span>
        </div>}
        <StateBlock kind={status.kind} icon={status.icon} title={status.title}>
          {screen === 'error' ? <span className="qx-rm-alert" role="alert">{error}</span> : null}{status.desc}
          {status.action ? btn('primary', status.action, reload) : null}
        </StateBlock>
        {status.facts ? (
          <div className="qx-rm-facts">
            <div className="qx-rm-facts-h">{status.facts[0]}<span>{status.facts[1]}</span></div>
            <div className="qx-rm-grid">
              {status.facts[2].map(([label, value]) => <div key={`${label}-${value}`}><u>{label}</u><b>{value}</b></div>)}
            </div>
          </div>
        ) : null}
        {fallbackRows}
      </>
    )
    cta = <><p className="why">{status.why}</p>{screen === 'loading' ? btn('ghost', '返回简历服务', goResumeHub) : null}
      <QxStepActions onPrev={goResumeHub}><QxAiHelp label="让小青帮我整理材料亮点 →" draft="我正在准备求职材料，请先问材料用途和真实经历，帮我整理可填写的亮点。" testId="material-workshop-ai-help" /></QxStepActions>{truthBar}</>
  } else if ((screen === 'submitting' || screen === 'failed') && selected) {
    const waiting = screen === 'submitting'
    const statusRows = waiting
      ? [['请求', '已经提交，正在生成文件'], ['已核对', '姓名与目标岗位非空'], ['还没有确认', '文件、页数、大小、保存期限与打印链接'], ['办理进度', '等待系统返回，不显示百分比或预计时间'], ['成功之后', '先核对返回文件，再决定带走或打印'], ['失败之后', '保留填写内容，由你决定是否再试']]
      : [['这次结果', '系统未返回可使用的文件'], ['打印', '没有可交接的文件，不会自动打印'], ['仍然保留', '你刚才填写的内容'], ['已有材料', '不改动我的文档里此前生成的材料'], ['可能原因', '必填项不完整、模板停用或生成失败，以当前提示为准'], ['再试一次', '由你点击提交，不会自动重试']]
    body = <>
      <div className="qx-rm-after"><b>{waiting ? '接下来' : '再试一次会'}</b>
        <span className="st"><i>1</i>{waiting ? '等待系统返回文件' : '沿用你填写的内容'}</span><span className="sep">›</span>
        <span className="st"><i>2</i>{waiting ? '核对完整内容' : '重新提交这一份'}</span><span className="sep">›</span>
        <span className="st"><i>3</i>{waiting ? '有链接才能去打印' : '成功才显示文件卡'}</span>
      </div>
      <StateBlock kind={waiting ? 'info' : 'error'} icon={waiting ? <ClockIcon size={32} /> : <AlertTriangleIcon size={32} />} title={waiting ? `正在生成《${selected.title}》这一份 PDF` : '这次没能生成出来'}>
        {waiting ? '请求已提交；返回真实文件前不展示结果文件名、页数或打印入口。' : <span role="alert">这次没能生成出来：{submitError}。你填写的内容还在，可以回表单核对后再试。</span>}
      </StateBlock>
      <div className="qx-rm-facts"><div className="qx-rm-facts-h">{waiting ? '这次提交的内容' : '这次失败的确切范围'}<span>{waiting ? '只发这些项，不含简历原文' : '只影响这一次办理'}</span></div>
        <div className="qx-rm-grid">{(waiting ? selected.fields.map((field) => [field.label, form[field.key]?.trim() || '未填']) : statusRows).map(([label, value]) => <div key={label}><u>{label}</u><b>{value}</b></div>)}</div>
      </div>
      {waiting && <div className="qx-rm-facts"><div className="qx-rm-facts-h">这一刻的确切状态<span>等待系统返回</span></div><div className="qx-rm-grid">{statusRows.map(([label, value]) => <div key={label}><u>{label}</u><b>{value}</b></div>)}</div></div>}
      {waiting ? <div className="qx-rm-facts"><div className="qx-rm-facts-h">这次用的是哪一份模板<span>{TYPE_LABEL[selected.type]}</span></div><div className="qx-rm-grid"><div><u>模板名称</u><b>{selected.title}</b></div><div><u>适用场景</u><b>{selected.recommendedFor}</b></div></div></div> : fallbackRows}
    </>
    cta = <>
      <p className="why">{waiting ? '正在等待结果，内容已提交；此时不再重复生成。' : '回表单核对内容后，再由你点击生成。'}</p>
      {waiting ? <button type="button" className="qx-btn" data-variant="primary" disabled>正在生成 PDF…</button> : btn('primary', '改一改再试一次', () => setSubmitError(null))}
      <QxStepActions onPrev={goResumeHub}><QxAiHelp label="让小青帮我整理材料亮点 →" draft="请先问我的材料用途和真实经历，帮我整理可以填写的亮点。" testId="material-workshop-ai-help" /></QxStepActions>
      {truthBar}
    </>
  } else {
    body = (
      <>
        {generated ? null : afterFlow}
        <nav className="qx-rm-filters" aria-label="求职材料分类">
          {FILTERS.map((item) => (
            <button key={item} type="button" aria-pressed={filter === item} onClick={() => setFilter(item)}>{item}</button>
          ))}
        </nav>
        <div className="qx-rm-workspace">
          <section className="qx-rm-catalog" aria-label="可选求职材料" tabIndex={0}>
            <p className="qx-rm-catalog-hint">上下滑动，查看全部模板</p>
            {visible.length === 0 ? (
              <StateBlock kind="warn" size="sm" icon={<InfoIcon size={24} aria-hidden="true" />} title="该分类暂无求职材料">
                请切换其他分类查看；空列表不使用内置假模板填充。
              </StateBlock>
            ) : visible.map((template) => (
              <button key={template.id} type="button" className="qx-rm-template" aria-pressed={selected?.id === template.id} disabled={submitting}
                onClick={() => selectTemplate(template)} data-testid={`material-workshop-template-${template.id}`}>
                <b>{template.title}</b>
                <span className="qx-rm-desc">{template.description}</span>
                <span className="qx-rm-use">带走：{template.outputFilename}</span>
                <span className="qx-rm-tags"><i>模板生成</i><i>{TYPE_LABEL[template.type]}</i>{template.tags.map((tag) => <i key={tag}>{tag}</i>)}</span>
              </button>
            ))}
            {others.length > 0 ? (
              <div className="qx-rm-others" data-testid="material-workshop-others">
                <b>不在「{filter}」里的还有 {others.length} 份</b>
                <p>它们没有被删掉，只是被当前分类筛掉了。点一份可以切回全部并选中它。</p>
                <div className="qx-rm-others-list">
                  {others.map((template) => (
                    <button key={template.id} type="button" disabled={submitting} onClick={() => { setFilter('全部'); selectTemplate(template) }}>
                      {template.title}<i>{TYPE_LABEL[template.type]}</i>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </section>
          <aside className="qx-rm-detail" aria-live="polite">
            {selected ? renderDetail(selected) : (
              <StateBlock kind="info" size="sm" icon={<FileTextIcon size={24} aria-hidden="true" />} title="请选择求职材料">
                左边选一份模板，这里显示要填写的内容。
              </StateBlock>
            )}
          </aside>
        </div>
      </>
    )
    cta = generated && !submitting && !submitError ? (
      <>
        <p className="why qx-rm-why-full" data-testid="material-workshop-why">
          这一份是刚生成的文件；改动模板或填写内容后这张文件卡会收起，需要重新生成。生成后请先核对文件内容和页数。
          {demoMode ? '演示模式不保存真实文件，我的文档与打印都停用。' : generated.printFileUrl ? '' : '本次没有打印凭证，只有打印被禁用，我的文档不受影响。'}
        </p>
        {btn('ghost', '重新生成一份', () => void handleGenerate())}
        <QxStepActions onPrev={goResumeHub}>
          <QxAiHelp
            label="让小青帮我整理材料亮点 →"
            draft="我正在准备求职材料，请先问材料用途和真实经历，帮我整理可填写的亮点。"
            testId="material-workshop-ai-help"
          />
        </QxStepActions>
        {/* 两个都是能力门禁：aria-disabled + 文件卡里那句常显原因（触屏没有 hover，title 永远显示不出来）。 */}
        <button type="button" className="qx-btn" data-variant="ghost" aria-disabled={demoMode || undefined}
          aria-describedby={demoMode ? 'material-docs-blocked' : undefined} onClick={() => { if (!demoMode) navigate('/me/documents') }}>
          <FolderOpenIcon size={22} aria-hidden="true" /> 查看我的文档
        </button>
        <button type="button" className="qx-btn" data-variant="primary" aria-disabled={!generated.printFileUrl || undefined}
          aria-describedby={!generated.printFileUrl ? 'material-print-blocked' : undefined}
          onClick={() => { if (generated.printFileUrl) printGenerated(generated) }}>
          <PrinterIcon size={22} aria-hidden="true" /> 打印材料
        </button>
        {truthBar}
      </>
    ) : (
      <>
        <p className="why">姓名和目标岗位为必填；未登录时会先保存当前模板与表单草稿再去登录，登录后仍要你再点一次才提交。</p>
        <button type="button" className="qx-btn" data-variant="primary" disabled={submitting || !selected} onClick={() => void handleGenerate()}>
          {submitting ? '生成中…' : isLoggedIn ? '生成可打印版' : '登录后生成'}
        </button>
        <QxStepActions onPrev={goResumeHub}>
          <QxAiHelp
            label="让小青帮我整理材料亮点 →"
            draft="我正在准备求职材料，请先问材料用途和真实经历，帮我整理可填写的亮点。"
            testId="material-workshop-ai-help"
          />
        </QxStepActions>
        {truthBar}
      </>
    )
  }

  return (
    <div className="qx-resume-materials">
      <QxPageFrame
        title="求职材料库"
        subtitle={subtitle}
        status={{ tone, label: pillLabel }}
        back={{ label: '返回简历服务', onBack: goResumeHub }}
        ctabar={cta}
        navbar={<QxAppNavbar onHome={() => navigate('/')} onAdvisor={() => navigate('/assistant')} onProfile={() => navigate('/profile')} />}
      >
        <section className="qx-scroll qx-rm-scroll" data-kiosk-domain="resume" data-kiosk-screen="resume-materials"
          data-state={screen} data-testid={`material-workshop-state-${screen}`} aria-label="求职材料库">
          {body}
        </section>
      </QxPageFrame>
      {generated && currentPreview?.url ? (
        <FilePreviewDialog fileUrl={currentPreview.url} fileName={generated.filename} mimeType={generated.mimeType} onClose={() => setPreview(null)} />
      ) : null}
    </div>
  )
}
