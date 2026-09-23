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
import type { JobMaterialDocumentTemplate, JobMaterialGenerateResponse, JobMaterialTemplateType } from '@ai-job-print/shared'
import { makePrintParams } from '@ai-job-print/shared'
import {
  AlertTriangleIcon, CheckCircle2Icon, ChevronRightIcon, ClockIcon, EyeIcon, FileTextIcon, FolderOpenIcon, InfoIcon, PenLineIcon, PrinterIcon, SparklesIcon,
} from 'lucide-react'
import { useAuth } from '../../auth/useAuth'
import { FilePreviewDialog } from '../../components/FilePreviewDialog'
import { QxAppNavbar } from '../../components/qingxu/QxAppNavbar'
import { QxPageFrame } from '../../components/qingxu/QxPageFrame'
import { useBusyLock } from '../../contexts/KioskBusyContext'
import { DEMO_MODE_NO_REAL_FILE_REASON } from '../../lib/capabilityReasons'
import { generateJobMaterial, getJobMaterialTemplates } from '../../services/api/jobMaterials'
import { fetchAccessUrl } from '../../services/api/memberAssets'
import { userMessageOf } from '../../services/api/userErrorMessage'
import { API_MODE } from '../../services/api/client'
import { clearJobMaterialDraft, readJobMaterialDraft, saveJobMaterialDraft, type JobMaterialDraftForm } from './jobMaterialDraft'
import './resume-materials-qx.css'

const FILTERS = ['全部', '求职信', '感谢信', '作品集', '材料清单', '校招', '社招', '通用'] as const
type Filter = (typeof FILTERS)[number]
type FieldKey = keyof JobMaterialDraftForm
type Tone = 'ok' | 'warn' | 'bad' | 'unknown'
type Screen = 'loading' | 'error' | 'empty' | 'select' | 'submitting' | 'failed' | 'generated' | 'generated-no-print' | 'demo-result'

const TYPE_LABEL: Record<Exclude<JobMaterialTemplateType, 'resume_template'>, string> = {
  cover_letter: '求职信', thank_you: '感谢信', portfolio_cover: '作品集封面', materials_checklist: '材料清单',
}
const EMPTY_FORM: JobMaterialDraftForm = { applicantName: '', targetRole: '', targetOrganization: '', keyStrengths: '', notes: '' }
/** 生成接口的两个必填入参：无论模板怎么标，这两项空着都不发请求。 */
const ALWAYS_REQUIRED: Partial<Record<FieldKey, string>> = { applicantName: '姓名', targetRole: '目标岗位' }

/**
 * 每一屏的顶栏胶囊与副标题（取自稿 25 的 PILL / SUB）。
 * 不伪造能力（CLAUDE.md §9）：本页后端 services/api/src/job-materials 全链没有 LLM 调用，
 * 产物由 job-material-templates.ts 的固定模板 + 用户手填字段渲染而成。
 * 因此这里只能写「模板生成」，不得宣称由 AI 撰写；
 * verify:job-material-library-ui 会按后端真实能力守住这条文案。
 */
const VIEW: Record<Screen, [Tone, string, string]> = {
  loading: ['unknown', '正在读取已发布模板', '返回前不展示模板名称或数量。'],
  error: ['bad', '模板列表读取失败', '读取失败不伪装成空列表。'],
  empty: ['warn', '当前没有已发布模板', '读取成功，但已发布模板数量为 0。'],
  select: ['ok', '固定模板生成 · 内容由你填写','选择已发布模板，填写真实信息后按固定模板生成本人可查看、可打印的 PDF。'],
  submitting: ['unknown', '正在生成 PDF', '真实文件返回前不显示文件名和打印入口。'],
  failed: ['bad', '本次文件生成失败', '失败就是失败，不用示例文件顶替结果。'],
  generated: ['ok', '真实文件已生成 · 可打印', '文件已进入本人文档；打印只认服务端给出的打印凭证。'],
  'generated-no-print': ['warn', '文件已生成 · 打印凭证未就绪', '文件存在，但没有打印凭证就不进入打印确认。'],
  'demo-result': ['warn', '演示结果 · 无真实文件', '演示模式不保存真实文件。'],
}

/** 目录没有可填的模板时（读取中 / 失败 / 空）整屏说明；三者各是独立状态，互不冒充。 */
const STATUS_SCREENS = {
  loading: {
    kind: 'info', icon: <ClockIcon size={32} aria-hidden="true" />, title: '正在读取已发布的求职材料模板', action: null, facts: null,
    desc: '读取完成前不显示模板名称或数量；读取失败和空列表是两个独立状态。', why: '读取期间不显示任何模板，也不保存任何选择。',
  },
  error: {
    kind: 'error', icon: <AlertTriangleIcon size={32} aria-hidden="true" />, title: '模板列表读取失败', action: '重新读取',
    desc: '这次没有读到模板，不会拿内置默认模板或上一次的列表冒充当前目录。', why: '重新读取只重发这一次目录请求，不改动你填过的字段。',
    facts: ['这次失败没有造成什么', '范围很窄', [['没有', '用内置默认模板或示例模板顶替'], ['没有', '生成文件、打印任务或费用'],
      ['仍可用', '打印、扫描与简历诊断三条链路'], ['仍可用', '我的文档里此前生成过的材料'],
      ['自动重试', '没有 —— 只有点「重新读取」才会再请求一次'], ['错误原文', '不显示在公共屏幕上，只说明这次读不到']]],
  },
  empty: {
    kind: 'warn', icon: <InfoIcon size={32} aria-hidden="true" />, title: '当前没有已发布的求职材料模板', action: '重新读取一次',
    desc: '读取成功，但服务端返回的已发布模板数量为 0。发布后会出现在这里；本机不拿示例模板补位。', why: '模板发布后目录会出现在这一页，不需要你做设置。',
    facts: ['空列表和读取失败不是一回事', '已读取成功', [['接口', '已返回，没有报错'], ['已发布模板', '0 条'],
      ['本机不会', '拿示例模板或旧模板补位'], ['已生成过的材料', '不受影响，仍在我的文档里'],
      ['费用', '没有产生任何生成或打印费用'], ['恢复方式', '模板发布后自动出现，不需要你做设置']]],
  },
} as const

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '未知'
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

function formatTime(iso: string | null): string {
  const date = iso ? new Date(iso) : null
  if (!date || Number.isNaN(date.getTime())) return '未返回'
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function typeFilterLabel(type: JobMaterialDocumentTemplate['type']): Filter {
  if (type === 'cover_letter') return '求职信'
  if (type === 'thank_you') return '感谢信'
  if (type === 'portfolio_cover') return '作品集'
  return '材料清单'
}

const isRequired = (field: JobMaterialDocumentTemplate['fields'][number]) => field.required || field.key in ALWAYS_REQUIRED
/** 只有服务端真实落库的文件才有预览入口：演示对象、缺文件编号或缺预览端点都不给，本页也不自己拼地址。 */
const previewPathOf = (file: JobMaterialGenerateResponse, demo: boolean) => (!demo && file.fileId && file.previewUrlPath ? file.previewUrlPath : null)
const fieldDomId = (key: FieldKey) => `material-field-${key}`

function StateBlock({ kind, icon, title, size, children }: { kind: 'info' | 'warn' | 'error'; icon: ReactNode; title: string; size?: 'sm'; children: ReactNode }) {
  return <div className="qx-rm-state" data-kind={kind} data-size={size}><h2>{icon}{title}</h2><p>{children}</p></div>
}

function Banner({ tone, icon, alert, children }: { tone?: 'warn' | 'bad'; icon: ReactNode; alert?: boolean; children: ReactNode }) {
  return <div className="qx-rm-banner" data-tone={tone} role={alert ? 'alert' : undefined}>{icon}<span>{children}</span></div>
}

function FileCard({ file, demo, onPreview, previewBusy, previewError }: {
  file: JobMaterialGenerateResponse; demo: boolean; onPreview?: () => void; previewBusy?: boolean; previewError?: string
}) {
  const canPrint = Boolean(file.printFileUrl)
  const rows: Array<[string, string, boolean?]> = [
    ['文件名', file.filename],
    ['页数', file.pageCount > 0 ? `${file.pageCount} 页` : '未返回', file.pageCount <= 0],
    ['大小', formatBytes(file.sizeBytes)],
    ['类型', file.mimeType],
    ['文件编号', demo ? '演示对象无文件编号' : file.fileId, demo],
    ['查看链接有效至', demo ? '演示对象无签名链接' : formatTime(file.signedUrlExpiresAt), demo],
    ['文件留存到', demo ? '不保存' : formatTime(file.fileExpiresAt), demo || !file.fileExpiresAt],
    ['打印凭证', canPrint ? '已就绪（只交给打印确认页）' : '未返回（打印保持禁用）', !canPrint],
  ]
  const head = demo ? '演示对象 · 未保存真实文件' : canPrint ? '真实 PDF 已生成 · 已进入我的文档' : '真实 PDF 已生成 · 打印凭证未就绪'
  return (
    <div className="qx-rm-file" data-tone={demo ? 'demo' : canPrint ? 'ok' : 'warn'} data-print-ready={canPrint ? '1' : '0'} data-testid="material-workshop-file">
      <div className="qx-rm-file-h">
        <FileTextIcon size={28} aria-hidden="true" />
        <span className="tx">
          <b>{head}</b>
          <span>{demo ? `已生成 ${file.filename} 的演示结果；演示模式未保存真实文件，暂不可打印。` : `已生成 ${file.filename}，文件已进入我的文档。`}</span>
        </span>
        <span className="badge">{demo ? '演示对象' : '当前文件'}</span>
      </div>
      <div className="qx-rm-grid">
        {rows.map(([label, value, off]) => <div key={label}><u>{label}</u><b data-off={off ? 'true' : undefined}>{value}</b></div>)}
      </div>
      {/* 预览失败就写在按钮旁边（点哪儿就在哪儿说），只讲预览这一件事，不说成生成或上传失败。 */}
      {onPreview ? (
        <div className="qx-rm-file-act" data-tone={previewError ? 'bad' : undefined}>
          <button type="button" className="qx-btn" data-variant="teal" disabled={previewBusy} onClick={onPreview}>
            <EyeIcon size={22} aria-hidden="true" /> {previewBusy ? '正在打开预览…' : '预览文件'}
          </button>
          {previewError ? (
            <span role="alert"><AlertTriangleIcon size={18} aria-hidden="true" /> 预览没能打开：{previewError}。预览失败不代表文件生成失败，文件以本卡信息为准；可以再点一次，或稍后到我的文档里查看。</span>
          ) : <span>凭本人登录现换一次短期查看链接，只在本页弹窗里显示，不保存。</span>}
        </div>
      ) : null}
      <p className="qx-rm-foot">字段取自本次生成的服务端返回；查看链接是一次性签名链接，不在屏幕上展示。</p>
      {demo ? <p id="material-docs-blocked" className="qx-rm-reason">演示模式未保存真实文件，我的文档里不会有这一份。</p> : null}
      {!canPrint ? (
        <p id="material-print-blocked" className="qx-rm-reason">{demo ? DEMO_MODE_NO_REAL_FILE_REASON : '打印链接未就绪，请重新生成后再试'}</p>
      ) : null}
    </div>
  )
}

export function JobMaterialLibraryPage() {
  const navigate = useNavigate()
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
    navigate('/print/confirm', {
      state: {
        file: {
          name: file.filename,
          size: formatBytes(file.sizeBytes),
          pages: file.pageCount > 0 ? file.pageCount : null,
          fileUrl: file.printFileUrl,
          mimeType: file.mimeType,
        },
        params: makePrintParams({ copies: 1, duplex: file.pageCount > 1 ? 'double' : 'single', color: 'bw' }),
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

  // 模板读不到时的四个既有出口（稿 25 的 manualFallback）；这一块吸收整屏余量。
  const fallbackRows = (
    <div className="qx-rm-alt">
      <div className="qx-sec-h"><span className="t">模板读不到时仍可处理</span><span className="hint">都是既有入口</span></div>
      <div className="qx-rows">
        {[
          { to: '/print/upload', icon: <PrinterIcon size={26} />, t: '打印已有材料', d: 'U 盘、手机传输或扫描原件都可以，不依赖模板目录。' },
          { to: '/resume/source', icon: <SparklesIcon size={26} />, t: '先做一次简历诊断', d: '诊断和材料模板是两条链路，这条照常可用。' },
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
        <span className="hint">{generated ? '改动字段后需重新生成' : '一次生成一份 PDF'}</span>
      </div>
      <h2>{template.title}</h2>
      <p className="qx-rm-lead">{template.recommendedFor}。模板只组合你填写的字段，不读取简历，不调用 AI；生成的材料仅对本人可见。</p>
      <div className="qx-rm-tmeta" data-testid="material-workshop-template-meta">
        <div><u>输出文件名</u><b>{template.outputFilename}</b></div>
        <div><u>材料类型</u><b>{TYPE_LABEL[template.type]}</b></div>
        <div><u>可填字段</u><b>{template.fields.length} 项 · {template.fields.filter(isRequired).length} 必填</b></div>
        <div><u>页数</u><b>生成后返回</b></div>
      </div>
      {demoMode ? <Banner tone="warn" icon={<InfoIcon size={20} aria-hidden="true" />}>演示模式不会保存真实文件，也不会开放打印。</Banner> : null}
      {draftRestored && !generated ? (
        <Banner icon={<CheckCircle2Icon size={20} aria-hidden="true" />}>
          <b>草稿已原样带回。</b>确认下面的内容无误，再点「生成可打印版」——登录本身不会自动替你提交。
        </Banner>
      ) : null}
      {/* 单行字段两两成排；多行字段各占整行并吸收余量（稿 25 的 form.grow），不留一片空白。 */}
      <div className="qx-rm-form" role="group" aria-label="材料字段">
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
      ) : (
        <div className="qx-rm-after" data-testid="material-workshop-after">
          <b>生成后</b>
          <span className="st"><i>1</i>返回真实文件</span><span className="sep">›</span>
          <span className="st"><i>2</i>进入我的文档</span><span className="sep">›</span>
          <span className="st"><i>3</i>有打印凭证才能去打印</span>
        </div>
      )}
    </>
  )

  let body: ReactNode
  let cta: ReactNode
  if (screen === 'loading' || screen === 'error' || screen === 'empty') {
    const status = STATUS_SCREENS[screen]
    body = (
      <>
        <StateBlock kind={status.kind} icon={status.icon} title={status.title}>
          {screen === 'error' ? <span className="qx-rm-alert" role="alert">{error}</span> : null}{status.desc}
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
    cta = <><p className="why">{status.why}</p>{status.action ? btn('primary', status.action, reload) : btn('ghost', '返回简历服务', goResumeHub)}</>
  } else {
    body = (
      <>
        <nav className="qx-rm-filters" aria-label="求职材料分类">
          {FILTERS.map((item) => (
            <button key={item} type="button" aria-pressed={filter === item} onClick={() => setFilter(item)}>{item}</button>
          ))}
        </nav>
        <div className="qx-rm-workspace">
          <section className="qx-rm-catalog" aria-label="可选求职材料">
            {visible.length === 0 ? (
              <StateBlock kind="warn" size="sm" icon={<InfoIcon size={24} aria-hidden="true" />} title="该分类暂无求职材料">
                请切换其他分类查看；空列表不使用内置假模板填充。
              </StateBlock>
            ) : visible.map((template) => (
              <button key={template.id} type="button" className="qx-rm-template" aria-pressed={selected?.id === template.id} disabled={submitting}
                onClick={() => selectTemplate(template)} data-testid={`material-workshop-template-${template.id}`}>
                <b>{template.title}</b>
                <span className="qx-rm-desc">{template.description}</span>
                <span className="qx-rm-use">适用：{template.recommendedFor}</span>
                <span className="qx-rm-tags"><i>{TYPE_LABEL[template.type]}</i>{template.tags.map((tag) => <i key={tag}>{tag}</i>)}</span>
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
                左侧选一份模板，这里显示它要填的字段。
              </StateBlock>
            )}
          </aside>
        </div>
      </>
    )
    cta = generated && !submitting && !submitError ? (
      <>
        <p className="why qx-rm-why-full" data-testid="material-workshop-why">
          这一份是刚生成的文件；改动模板或字段后这张文件卡会收起，需要重新生成。
          {demoMode ? '演示模式不保存真实文件，我的文档与打印都停用。' : generated.printFileUrl ? '' : '本次没有打印凭证，只有打印被禁用，我的文档不受影响。'}
        </p>
        {btn('ghost', '重新生成一份', () => void handleGenerate())}
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
      </>
    ) : (
      <>
        <p className="why">姓名和目标岗位为必填；未登录时会先保存当前模板与表单草稿再去登录，登录后仍要你再点一次才提交。</p>
        <button type="button" className="qx-btn" data-variant="primary" disabled={submitting || !selected} onClick={() => void handleGenerate()}>
          {submitting ? '生成中…' : isLoggedIn ? '生成可打印版' : '登录后生成'}
        </button>
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
          <p className="qx-rm-truth">
            <b>材料只交给你本人。</b>这里生成的是个人求职材料，不会代替你向任何岗位投递；素材仅供个人求职准备、查看和打印；系统不收取求职者简历给企业。
            岗位申请、预约和投递需前往来源平台或官方渠道完成；打印费用以现场公示与服务端报价为准。
          </p>
        </section>
      </QxPageFrame>
      {generated && currentPreview?.url ? (
        <FilePreviewDialog fileUrl={currentPreview.url} fileName={generated.filename} mimeType={generated.mimeType} onClose={() => setPreview(null)} />
      ) : null}
    </div>
  )
}
