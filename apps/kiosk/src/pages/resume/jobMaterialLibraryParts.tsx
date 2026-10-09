// 求职材料库的展示块。页面逻辑、合规句和打印交接留在 JobMaterialLibraryPage.tsx。
import type { ReactNode } from 'react'
import type { JobMaterialDocumentTemplate, JobMaterialGenerateResponse, JobMaterialTemplateType } from '@ai-job-print/shared'
import { AlertTriangleIcon, ClockIcon, EyeIcon, FileTextIcon, InfoIcon } from 'lucide-react'
import { DEMO_MODE_NO_REAL_FILE_REASON } from '../../lib/capabilityReasons'
import type { JobMaterialDraftForm } from './jobMaterialDraft'

export const FILTERS = ['全部', '求职信', '感谢信', '作品集', '材料清单', '校招', '社招', '通用'] as const
export type Filter = (typeof FILTERS)[number]
export type FieldKey = keyof JobMaterialDraftForm
export type Tone = 'ok' | 'warn' | 'bad' | 'unknown'
export type Screen = 'loading' | 'error' | 'empty' | 'select' | 'submitting' | 'failed' | 'generated' | 'generated-no-print' | 'demo-result'

export const TYPE_LABEL: Record<Exclude<JobMaterialTemplateType, 'resume_template'>, string> = {
  cover_letter: '求职信', thank_you: '感谢信', portfolio_cover: '作品集封面', materials_checklist: '材料清单',
}

/** 生成接口的两个必填入参：无论模板怎么标，这两项空着都不发请求。 */
export const ALWAYS_REQUIRED: Partial<Record<FieldKey, string>> = { applicantName: '姓名', targetRole: '目标岗位' }

/**
 * 每一屏的顶栏胶囊与副标题（取自稿 25 的 PILL / SUB）。
 * 不伪造能力（CLAUDE.md §9）：本页后端没有 LLM，产物是固定模板加手填字段。
 * 因此只能写「模板生成」，不得宣称由 AI 撰写。
 */
export const VIEW: Record<Screen, [Tone, string, string]> = {
  loading: ['unknown', '正在读取已发布模板', '返回前不展示模板名称或数量。'],
  error: ['bad', '模板列表读取失败', '读取失败不伪装成空列表。'],
  empty: ['warn', '当前没有已发布模板', '读取成功，但已发布模板数量为 0。'],
  select: ['ok', '固定模板生成 · 内容由你填写', '选择已发布模板，填写真实信息后按固定模板生成本人可查看、可打印的 PDF。'],
  submitting: ['unknown', '正在生成 PDF', '真实文件返回前不显示文件名和打印入口。'],
  failed: ['bad', '本次文件生成失败', '失败就是失败，不用示例文件顶替结果。'],
  generated: ['ok', '真实文件已生成 · 可打印', '文件已进入本人文档；有打印凭证才能去打印。'],
  'generated-no-print': ['warn', '文件已生成 · 打印凭证未就绪', '文件存在，但没有打印凭证就不进入打印确认。'],
  'demo-result': ['warn', '演示结果 · 无真实文件', '演示模式不保存真实文件。'],
}

/** 目录没有可填的模板时（读取中 / 失败 / 空）整屏说明；三者各是独立状态，互不冒充。 */
export const STATUS_SCREENS = {
  loading: {
    kind: 'info', icon: <ClockIcon size={32} aria-hidden="true" />, title: '正在读取已发布的求职材料模板', action: null,
    facts: ['这一刻已经确定的事', '读取中', [['请求', '已经发出，正在读取模板目录'], ['模板数量', '返回前不展示'],
      ['本机缓存', '不拿上一次的列表顶替这一次'], ['表单', '读到模板之后才可以填写'],
      ['已生成文件', '本次读取不影响我的文档里已有的材料'], ['接下来', '有模板就可选；没有模板和读取失败分别提示']]],
    desc: '读取完成前不显示模板名称或数量；读取失败和空列表是两个独立状态。', why: '读取期间不显示任何模板，也不保存任何选择。',
  },
  error: {
    kind: 'error', icon: <AlertTriangleIcon size={32} aria-hidden="true" />, title: '模板列表读取失败', action: '重新读取',
    desc: '这次没有读到模板，不会拿内置默认模板或上一次的列表冒充当前目录。', why: '重新读取只再要一次目录，不改动你填过的内容。',
    facts: ['这次失败没有造成什么', '范围很窄', [['没有', '用内置默认模板或示例模板顶替'], ['没有', '生成文件或打印任务'],
      ['仍可用', '打印、扫描与简历诊断三条流程'], ['仍可用', '我的文档里此前生成过的材料'],
      ['自动重试', '没有 —— 只有点「重新读取」才会再请求一次'], ['失败原因', '不显示在屏幕上，只说明这次读不到']]],
  },
  empty: {
    kind: 'warn', icon: <InfoIcon size={32} aria-hidden="true" />, title: '当前没有已发布的求职材料模板', action: '重新读取一次',
    desc: '读取成功，但这次没有已发布的模板。发布后会出现在这里；本机不拿示例模板补位。', why: '模板发布后目录会出现在这一页，不需要你做设置。',
    facts: ['空列表和读取失败不是一回事', '已读取成功', [['这次读取', '已完成，没有报错'], ['已发布模板', '0 条'],
      ['原因', '模板尚未发布，或已发布的被全部下架'], ['本机不会', '拿示例模板或旧模板补位'], ['已生成过的材料', '不受影响，仍在我的文档里'],
      ['你填的内容', '还没有可填的表单，此时不保存草稿'], ['恢复方式', '模板发布后自动出现，不需要你做设置']]],
  },
} as const

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '未知'
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

function fileKindLabel(mimeType: string): string {
  if (mimeType === 'application/pdf') return 'PDF'
  if (mimeType.startsWith('image/')) return '图片'
  return '文档'
}

function formatTime(iso: string | null): string {
  const date = iso ? new Date(iso) : null
  if (!date || Number.isNaN(date.getTime())) return '未返回'
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function typeFilterLabel(type: JobMaterialDocumentTemplate['type']): Filter {
  if (type === 'cover_letter') return '求职信'
  if (type === 'thank_you') return '感谢信'
  if (type === 'portfolio_cover') return '作品集'
  return '材料清单'
}

export const isRequired = (field: JobMaterialDocumentTemplate['fields'][number]) => field.required || field.key in ALWAYS_REQUIRED
/** 只有服务端真实落库的文件才有预览入口：演示对象、缺文件编号或缺预览端点都不给，本页也不自己拼地址。 */
export const previewPathOf = (file: JobMaterialGenerateResponse, demo: boolean) => (!demo && file.fileId && file.previewUrlPath ? file.previewUrlPath : null)
export const fieldDomId = (key: FieldKey) => `material-field-${key}`

export function StateBlock({ kind, icon, title, size, children }: { kind: 'info' | 'warn' | 'error'; icon: ReactNode; title: string; size?: 'sm'; children: ReactNode }) {
  return <div className="qx-rm-state" data-kind={kind} data-size={size}><h2>{icon}{title}</h2><p>{children}</p></div>
}

export function Banner({ tone, icon, alert, testId, children }: { tone?: 'warn' | 'bad'; icon: ReactNode; alert?: boolean; testId?: string; children: ReactNode }) {
  return <div className="qx-rm-banner" data-tone={tone} data-testid={testId} role={alert ? 'alert' : undefined}>{icon}<span>{children}</span></div>
}

export function FileCard({ file, demo, onPreview, previewBusy, previewError }: {
  file: JobMaterialGenerateResponse; demo: boolean; onPreview?: () => void; previewBusy?: boolean; previewError?: string
}) {
  const canPrint = Boolean(file.printFileUrl)
  const rows: Array<[string, string, boolean?]> = [
    ['文件名', file.filename],
    ['页数', file.pageCount > 0 ? `${file.pageCount} 页` : '未返回', file.pageCount <= 0],
    ['大小', formatBytes(file.sizeBytes)],
    ['类型', fileKindLabel(file.mimeType)],
    ['核对这一份', '请按文件名、页数和大小核对'],
    ['查看链接有效至', demo ? '演示对象没有临时链接' : formatTime(file.signedUrlExpiresAt), demo],
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
      <p className="qx-rm-foot">下面这些都是这次生成的结果；查看链接不在屏幕上展示。</p>
      {demo ? <p id="material-docs-blocked" className="qx-rm-reason">演示模式未保存真实文件，我的文档里不会有这一份。</p> : null}
      {!canPrint ? (
        <p id="material-print-blocked" className="qx-rm-reason">{demo ? DEMO_MODE_NO_REAL_FILE_REASON : '打印链接未就绪，请重新生成后再试'}</p>
      ) : null}
    </div>
  )
}
