/* 手机上传（/upload/phone）的事实、判定与逐态文案。视觉与口径真值：稿 51-phone-relay.html screen=phone-upload。
 * 只放纯函数与数据；请求与落版在 PhoneUploadPage。
 * 硬边界：URL fragment 里的 purpose 只是未经核对的提示，只能收紧不能放宽；用途只认上传成功回执里的 purpose；
 * 手机端读不到 expiresAt，只写「自一体机生成起」；不写「已上传到一体机 / 到期即删除」；错误码与令牌不上屏。
 * 文案里的 **xx** 由页面渲染成加粗。 */
import type { UploadSessionStatusResponse } from '@ai-job-print/shared'
import { ApiHttpError } from '../../services/api/httpAdapter'

/** upload-sessions.service.ts SESSION_TTL_SECONDS = 10 * 60，自一体机生成起算。 */
export const SESSION_TTL_MINUTES = 10
/** upload-sessions.service.ts MAX_SESSION_UPLOAD_BYTES：比按用途的 20MB 更紧，先生效的是它。 */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024

/** 一体机能开出会话的用途（CreateUploadSessionDto @IsIn）。signature_image 不在其中，会话在 DTO 就被拒。 */
export const SESSION_PURPOSES = ['resume_upload', 'print_doc', 'contract_upload'] as const
export type SessionPurpose = (typeof SESSION_PURPOSES)[number]
export function isSessionPurpose(value: unknown): value is SessionPurpose {
  return typeof value === 'string' && (SESSION_PURPOSES as readonly string[]).includes(value)
}

/** 链接本身的问题：invalid 只表示缺 sessionId / token（与过期无关）；用途读不懂不算链接坏。 */
export type LinkIssue = 'invalid' | 'signature-blocked' | null
export function linkIssueOf(sessionId: string, uploadToken: string, purpose: string): LinkIssue {
  if (purpose === 'signature_image') return 'signature-blocked'
  return sessionId && uploadToken ? null : 'invalid'
}

export type PrecheckState = 'empty-error' | 'too-large' | 'type-error' | 'content-type-error'
export type UploadFailure = 'service-error' | 'session-expired' | 'upload-in-progress' | 'outcome-unknown'
export type UploadState = 'idle' | 'uploading' | 'success' | PrecheckState | UploadFailure
export type TypeIssue = 'not-allowed' | 'mismatch' | null

export interface PickedFile { name: string; size: number; ext: string; type: string }

/** 与服务端 file-validation.ts 的 MIME_EXTS 同表：扩展名必须与声明类型一致（防伪装）。 */
const MIME_EXTS: Readonly<Record<string, readonly string[]>> = {
  'application/pdf': ['pdf'],
  'application/msword': ['doc'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['docx'],
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
  'image/webp': ['webp'],
}
/** 原始类型串是工程内部标识，用户可见处只用这张表的中文说法。 */
const MIME_LABEL: Readonly<Record<string, string>> = {
  'application/pdf': 'PDF 文档',
  'application/msword': 'Word 文档',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Word 文档',
  'image/jpeg': 'JPG 图片',
  'image/png': 'PNG 图片',
  'image/webp': 'WEBP 图片',
}
const CHIP_BY_EXT: Readonly<Record<string, string>> = { pdf: 'PDF', jpg: 'JPG', png: 'PNG', webp: 'WEBP', doc: 'Word' }

export function extOf(name: string): string {
  return name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? ''
}
export function extLabel(ext: string): string {
  if (ext === 'doc' || ext === 'docx') return 'Word'
  if (ext === 'jpeg') return 'JPG'
  return ext ? ext.toUpperCase() : '未知格式'
}
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export interface UploadPolicy { accept: string; exts: readonly string[]; mimes: readonly string[]; chips: readonly string[] }

/** 上传前的保守通用档：受支持用途各自 accept 的交集。真实用途要等回执才知道，在那之前放宽等于让可改的 URL 决定收什么。 */
export function genericPolicy(accepts: readonly string[]): UploadPolicy {
  const sets = accepts.map((accept) => new Set(accept.split(',').map((token) => token.trim().toLowerCase()).filter(Boolean)))
  const tokens = sets.length === 0 ? [] : [...sets[0]].filter((token) => sets.every((set) => set.has(token)))
  const exts = tokens.filter((token) => token.startsWith('.')).map((token) => token.slice(1))
  const mimes = tokens.filter((token) => token.includes('/'))
  const chips = [...new Set(exts.map((ext) => CHIP_BY_EXT[ext === 'jpeg' ? 'jpg' : ext === 'docx' ? 'doc' : ext]).filter(Boolean))]
  return { accept: tokens.join(','), exts, mimes, chips }
}

/** 手机端预检：拦下的文件一个字节都不发出去。浏览器不给类型时按后缀继续（服务端还会拿真实字节重查）。 */
export function precheck(file: PickedFile, policy: UploadPolicy): { state: PrecheckState; typeIssue: TypeIssue } | null {
  if (!(file.size > 0)) return { state: 'empty-error', typeIssue: null }
  if (file.size > MAX_UPLOAD_BYTES) return { state: 'too-large', typeIssue: null }
  if (!policy.exts.includes(file.ext)) return { state: 'type-error', typeIssue: null }
  if (!file.type) return null
  if (!policy.mimes.includes(file.type)) return { state: 'content-type-error', typeIssue: 'not-allowed' }
  const allowed = MIME_EXTS[file.type]
  if (allowed && !allowed.includes(file.ext)) return { state: 'content-type-error', typeIssue: 'mismatch' }
  return null
}

const DEAD_SESSION_CODES = new Set(['UPLOAD_SESSION_EXPIRED', 'UPLOAD_SESSION_NOT_PENDING', 'UPLOAD_SESSION_NOT_FOUND', 'UPLOAD_TOKEN_INVALID'])

/** 按「服务端到底说了什么」分类：明确拒收可重选；死码只能回一体机；锁被占着只能等；没有结论（断网 / 5xx / 空回执）一律结果未知。 */
export function classifyUploadError(error: unknown): UploadFailure {
  if (!(error instanceof ApiHttpError)) return 'outcome-unknown'
  if (DEAD_SESSION_CODES.has(error.code)) return 'session-expired'
  if (error.code === 'UPLOAD_SESSION_UPLOAD_IN_PROGRESS') return 'upload-in-progress'
  if (error.status >= 400 && error.status < 500 && error.status !== 408) return 'service-error'
  return 'outcome-unknown'
}

/** 回执里服务端存的 purpose 是本页唯一可信的用途来源；不是 uploaded 就不算收到。 */
export function receiptOf(result: UploadSessionStatusResponse | null | undefined): { received: boolean; purpose: SessionPurpose | null } {
  if (!result || result.status !== 'uploaded' || !result.file?.fileId || !isSessionPurpose(result.purpose)) {
    return { received: false, purpose: null }
  }
  return { received: true, purpose: result.purpose }
}

/* ── 逐态文案 ─────────────────────────────────────────────────────────── */
export type Tone = 'calm' | 'ok' | 'warn' | 'error'
export type IconKey = 'alert' | 'ban' | 'check' | 'help' | 'info' | 'loader' | 'shield' | 'upload' | 'wait'
export type PickerMode = 'ready' | 'busy' | 'wait' | 'unknown' | 'dead'
export type FactRow = readonly [string, string]

export const UPLOAD_STEPS = ['选手机里的文件', '系统接收', '回一体机确认'] as const

export function chromeCopy(issue: LinkIssue, state: UploadState, confirmedLabel: string | null) {
  if (issue === 'signature-blocked') {
    return { sub: '签名 / 印章 · 手机端不可用', tag: '需回一体机', icon: 'ban' as IconKey, foot: '本页当前没有可用的上传入口，也不会发送任何文件；签名 / 印章图片请回一体机在原步骤上传。' }
  }
  if (issue === 'invalid' || state === 'session-expired') {
    return { sub: issue === 'invalid' ? '上传链接不可用' : '手机上传 · 需回一体机重新生成', tag: '需回一体机', icon: 'ban' as IconKey, foot: '本页当前不能再发送文件；请回一体机重新生成上传二维码后再扫一次。' }
  }
  if (state === 'outcome-unknown') {
    return { sub: '手机上传 · 结果需回一体机核对', tag: '结果待核对', icon: 'help' as IconKey, foot: '本页没有拿到这次上传的结果，既不代表已接收，也不代表未接收；请回一体机看屏幕上的状态。' }
  }
  return {
    sub: confirmedLabel ? `${confirmedLabel} · 请回一体机确认` : '手机上传 · 传完回一体机确认',
    tag: state === 'upload-in-progress' ? '处理中' : '上传接力',
    icon: 'shield' as IconKey,
    foot: '本页使用一次性上传链接，不会登录你的账号；这次上传的用途、允许格式和留存时长以系统核对结果为准。',
  }
}

export function takeoverCopy(issue: Exclude<LinkIssue, null>) {
  if (issue === 'signature-blocked') {
    return {
      kind: 'warn' as const, icon: 'ban' as IconKey, head: '签名 / 印章暂不支持手机上传',
      body: '请回到一体机，在「签名盖章」的第 2 步用「本机上传」选一张已有的 JPG / PNG 图片。',
      facts: [
        ['为什么不可用', '手机上传当前只接受 **简历 / 打印文件 / 合同**，签名与印章不在其中，系统不会为它开出上传链接。'],
        ['不是你的问题', '不是文件格式不对，也不是网络问题，换张图或换台手机都不会变。'],
        ['现场怎么办', '回一体机在「签名盖章」的第 2 步点**本机上传**，选一张已有的 JPG / PNG 图片。'],
        ['还是不行', '返回上一步，或请现场工作人员协助；本页没有别的上传方式可试。'],
      ] as FactRow[],
    }
  }
  return {
    kind: 'warn' as const, icon: 'alert' as IconKey, head: '这个链接不能用来上传',
    body: '链接里缺少必要信息，本页不知道该把文件发到哪一次上传。请回到一体机，在屏幕上重新生成上传二维码。',
    facts: [
      ['常见原因', '链接是转发或收藏来的，里面的信息不完整；也可能复制时被截断了。'],
      ['和过期无关', '本页连这次要发到哪里都没读到，所以不是「二维码超时」那种情况。'],
      ['怎么办', '回一体机，在需要上传的那一步重新生成二维码，用手机相机扫屏幕上的码。'],
    ] as FactRow[],
  }
}

export function pickerCopy(mode: PickerMode, chips: readonly string[]) {
  switch (mode) {
    case 'busy': return { head: '正在上传，请稍候', hint: '这次上传结束前不能再选别的文件。', pill: '上传中', icon: 'loader' as IconKey }
    case 'wait': return { head: '这个二维码上已有一次上传在处理', hint: '同一个二维码同一时间只处理一次上传，请稍候，不要重复选择文件。', pill: '处理中', icon: 'wait' as IconKey }
    case 'unknown': return { head: '这次上传的结果还不确定', hint: '在弄清上一次到底成没成之前，本页不让你再传一份。', pill: '暂不可选', icon: 'help' as IconKey }
    case 'dead': return { head: '这个二维码不能再上传了', hint: '请回一体机重新生成上传二维码，再用新的二维码选择文件。', pill: '不可用', icon: 'ban' as IconKey }
    default: return {
      head: '选择手机里的文件',
      hint: `支持 ${chips.join(' / ')}，单个不超过 **10MB**；选中后立即开始上传。本页只做基本预检，最终以系统检查为准。`,
      pill: '选择文件', icon: 'upload' as IconKey,
    }
  }
}

export interface ProgressCopy { head: string; right: string; fill: 'idle' | 'busy' | 'done' | 'error' | 'unknown'; tone: Tone; note: string }
export interface UploadView {
  picker: PickerMode
  removable: boolean
  fileNote: { tone: Tone; text: string } | null
  chips: boolean
  progress: ProgressCopy
  /** null = 用留存事实表；否则整屏接管的恢复事实。 */
  facts: FactRow[] | null
}

const TTL_FACT: FactRow = ['链接时限', `二维码自**一体机生成起 ${SESSION_TTL_MINUTES} 分钟**内有效。`]
const PHONE_FILE_FACT: FactRow = ['你手机里的文件', '没有任何变化，本页也没有删除它。']

/** 除 success 外每一态的选择区、文件行、进度与事实。拆分依据只有一条：用户能做的下一步不同，就必须是不同状态。 */
export function uploadView(state: Exclude<UploadState, 'success'>, ctx: { file: PickedFile | null; typeIssue: TypeIssue; unknownType: boolean; chips: readonly string[] }): UploadView {
  const { file, chips } = ctx
  const failed = (head: string, note: string, text: string, withChips = false): UploadView => ({
    picker: 'ready', removable: true, fileNote: { tone: 'error', text }, chips: withChips,
    progress: { head, right: '未发送', fill: 'error', tone: 'error', note }, facts: null,
  })
  switch (state) {
    case 'uploading':
      return {
        picker: 'busy', removable: false, chips: false, facts: null,
        fileNote: ctx.unknownType ? { tone: 'calm', text: '手机没有告诉本页这个文件的类型，本页只能按文件名后缀预检；能不能收下以系统的检查结果为准。' } : null,
        progress: { head: '正在上传，请稍候…', right: '请勿关闭本页', fill: 'busy', tone: 'calm', note: '上传完成只表示系统收到了文件，还需要你回一体机确认才会被使用。' },
      }
    case 'empty-error':
      return failed('文件为空，未上传', '这是手机端的预检，系统没有收到这份文件。', '这个文件是 **0 字节**，没有内容，本页没有把它发出去。请确认文件是否下载完整，或者换一个文件。')
    case 'too-large':
      return failed('文件太大，未上传', '体积是在手机上就拦下的，系统没有收到这份文件。', `这个文件 **${file ? formatSize(file.size) : ''}**，超过单个 **10MB** 的上限，没有发出去。请压缩后再选一次。`)
    case 'type-error':
      return failed('格式不支持，未上传', `系统还没有告诉本页这次上传的真实用途，所以只放行 ${chips.join(' / ')} 这几种通用格式；要传别的格式请回一体机按那一步的说明操作。`,
        `这份${file ? extLabel(file.ext) : '文件'}不在本页现在能发送的格式里，没有发出去。`, true)
    case 'content-type-error': {
      const label = file?.type ? MIME_LABEL[file.type] ?? '另一种格式' : '另一种格式'
      return failed('文件类型不匹配，未上传', '这是手机端的预检，不能代替系统检查；请换一个文件，或用原始格式重新导出一次。',
        ctx.typeIssue === 'mismatch'
          ? `这个文件的后缀是 **.${file?.ext ?? ''}**，手机却把它认成了**${label}**。两者对不上，系统会因此拒收，本页先拦下了。`
          : `手机把这个文件认成了**${label}**，不在本页现在能发送的格式里，没有把它发出去。`, true)
    }
    case 'service-error':
      return {
        picker: 'ready', removable: true, chips: false,
        fileNote: { tone: 'error', text: '系统明确回了失败：这次上传没有被接收。可能是系统对这个文件的检查没通过，也可能是存储没写成。' },
        progress: { head: '系统未接收，可以重试', right: '可重新选择', fill: 'error', tone: 'error', note: '系统已经把这个二维码退回到可以再传一次的状态，原链接**可能**还能继续用；本页无法保证它一定还有效。' },
        facts: [
          ['再试一次', '重新选择文件即可；如果换个文件就好了，多半是刚才那份系统不接受。'],
          ['和断网不同', '这一条是系统明确说了「没收下」。如果是网络断开或没拿到结果，本页会告诉你「结果未知」，那种情况不要重复发送。'],
          ['连着失败', '别在这里反复试。回一体机看屏幕上的结果，需要的话在一体机上重新生成二维码。'],
          TTL_FACT,
        ],
      }
    case 'session-expired':
      return {
        picker: 'dead', removable: false, chips: false,
        fileNote: { tone: 'error', text: '系统没有接收**刚才这一次**上传。如果这个二维码之前已经被用过一次，那一次是否成功，本页看不到。' },
        progress: { head: '这次没有被接收', right: '需回一体机', fill: 'error', tone: 'error', note: '这个二维码已经失效或已经用过了，本页不能再发送文件。' },
        facts: [
          ['常见原因', `二维码自一体机生成起 **${SESSION_TTL_MINUTES} 分钟**内有效，超时就不能再用；一张二维码也只接收一个文件，已经用过就不能再传。`],
          ['先做这个', '回一体机看屏幕：那边已经收到文件就直接确认使用，不用再传一遍。'],
          ['一体机上没有', '在一体机上重新生成上传二维码，再用新的二维码选择文件。'],
          PHONE_FILE_FACT,
        ],
      }
    case 'upload-in-progress':
      return {
        picker: 'wait', removable: false, chips: false,
        fileNote: { tone: 'calm', text: '系统正在处理这个二维码上的一次上传。那一次会不会成功，本页还不知道。' },
        progress: { head: '系统正在处理', right: '请稍候', fill: 'busy', tone: 'calm', note: '请稍等片刻，不要重复选择文件；处理结果以一体机屏幕上的显示为准。' },
        facts: [
          ['为什么不能重选', '同一个二维码同一时间只处理一次上传，系统已经在处理了。'],
          ['现在做什么', '稍等片刻，然后回一体机看屏幕：收到文件就直接在一体机上确认使用。'],
          ['一直没动静', '回一体机看屏幕；需要的话在一体机上重新生成上传二维码。'],
          TTL_FACT,
        ],
      }
    case 'outcome-unknown':
      return {
        picker: 'unknown', removable: false, chips: false,
        fileNote: { tone: 'warn', text: '这份文件有没有被系统接收，本页**不知道**：既不能说已经接收，也不能说没有接收。' },
        progress: { head: '结果未知', right: '需回一体机核对', fill: 'unknown', tone: 'warn', note: '网络中断、或者结果没能传回这一页时会这样。请回一体机看屏幕上的结果。' },
        facts: [
          ['第一步', '回一体机看屏幕：那边已经收到文件，就直接在一体机上确认使用。'],
          ['不要反复重传', '万一刚才那次其实成功了，再传一份只会让人分不清这次任务用的是哪一份。'],
          ['一体机上没有', '在一体机上刷新或重新生成上传二维码，再用新的二维码选一次文件。'],
          PHONE_FILE_FACT,
        ],
      }
    default:
      return {
        picker: 'ready', removable: true, chips: false, fileNote: null, facts: null,
        progress: { head: '等待选择文件', right: `自生成起 ${SESSION_TTL_MINUTES} 分钟内有效`, fill: 'idle', tone: 'calm', note: '本页只做这一次上传，不会登录你的账号，也读不到手机里的其他文件。' },
      }
  }
}

/** 留存事实：未确认与确认后是两条规则；具体时长只在回执确认用途后才写，清理只「可能」发生，不给删除时点。 */
export function retainFacts(confirmedRetain: string | null, formatsNote: string): FactRow[] {
  const rows: FactRow[] = [
    ['链接时限', `这个二维码自**一体机生成起 ${SESSION_TTL_MINUTES} 分钟**内有效；本页看不到已经过去多久，来不及就回一体机重新生成。`],
    ['没去确认', '没有在一体机上确认的文件，**不会**进入本次任务，也不会进入你的会员资料；系统按短期留存策略处理，后续状态核对或取消时可能触发清理。'],
    ['到期不等于已删除', '二维码到期只说明这个链接不能再用来上传，**不等于**这份文件当场就被删掉。'],
    ['确认之后', confirmedRetain ?? '按系统核定的用途留存，时长以一体机上那一步的说明为准；系统给出结果之前，本页不显示具体时长。'],
  ]
  if (!confirmedRetain) rows.push(['其他格式', formatsNote])
  return rows
}
