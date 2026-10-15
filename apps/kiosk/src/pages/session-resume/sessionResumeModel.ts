import type { OrderPayStatus } from '@ai-job-print/shared'
import type { PendingPrintStatus, PendingTask } from '../../services/api/pendingTasks'

export type ResumeDest = 'payment' | 'print-progress'
export type ResumeScreen = 'loading' | 'empty' | 'unavailable' | 'list'

export type ResumeVerdict =
  | { ok: true; dest: ResumeDest; legacy?: true }
  | { ok: false; why: string }

const ACTIVE_STATUS: readonly PendingPrintStatus[] = ['pending', 'claimed', 'printing']
const TERMINAL_PAY: readonly OrderPayStatus[] = [
  'refunding',
  'partial_refunded',
  'refunded',
  'failed',
  'closed',
]

export function isActivePrintStatus(status: string): status is PendingPrintStatus {
  return (ACTIVE_STATUS as readonly string[]).includes(status)
}

export function resumeVerdict(task: PendingTask): ResumeVerdict {
  if (!isActivePrintStatus(task.status)) {
    return { ok: false, why: '任务已结束，不能继续' }
  }
  if (task.payStatus && TERMINAL_PAY.includes(task.payStatus)) {
    return { ok: false, why: '付款状态已结束' }
  }
  if (task.status === 'pending' && (task.payStatus === 'unpaid' || task.payStatus === 'paying')) {
    if (task.resume.kind !== 'payment') return { ok: false, why: '读不出该回到哪一步' }
    if (!task.resume.orderNo) return { ok: false, why: '缺这一单的订单号' }
    if (!(task.resume.amountCents > 0)) return { ok: false, why: '缺这一单的应付金额' }
    if (!task.resume.paymentSessionToken) return { ok: false, why: '缺服务端签发的支付凭证' }
    return { ok: true, dest: 'payment' }
  }
  if (task.payStatus === null) return { ok: true, dest: 'print-progress', legacy: true }
  if (task.payStatus === 'paid') return { ok: true, dest: 'print-progress' }
  return { ok: false, why: '状态与付款状态对不上' }
}

export function resumeContinueRoute(dest: ResumeDest): '/print/cashier' | '/print/progress' {
  return dest === 'payment' ? '/print/cashier' : '/print/progress'
}

export function resumeRowCopy(task: PendingTask): { label: string; sub: string; tone: 'clay' | 'wheat' | 'slate' | 'teal' | 'sage' | 'off' } {
  const verdict = resumeVerdict(task)
  if (!verdict.ok) return { label: '不可继续', sub: verdict.why, tone: 'off' }
  if (task.status === 'pending' && task.payStatus === 'unpaid') {
    return { label: '待付款', sub: '订单还没付款，付完才会开始排队打印', tone: 'clay' }
  }
  if (task.status === 'pending' && task.payStatus === 'paying') {
    return { label: '支付处理中', sub: '支付正在处理，本页不判定成功或失败', tone: 'clay' }
  }
  if (task.status === 'pending' && task.payStatus === 'paid') {
    return { label: '等待领取', sub: '已付款，等待终端领取这一单', tone: 'wheat' }
  }
  if (task.status === 'pending' && task.payStatus === null) {
    return { label: '早期任务', sub: '这一单没有关联订单记录，继续会回到打印进度', tone: 'sage' }
  }
  if (task.status === 'claimed') {
    return { label: '终端已领取', sub: '终端已领取任务，正在准备打印', tone: 'slate' }
  }
  if (task.status === 'printing') {
    return { label: '正在出纸', sub: '打印机正在出纸，去进度页看还剩多少', tone: 'teal' }
  }
  return { label: '状态异常', sub: '状态与付款状态对不上', tone: 'off' }
}

export function deriveResumeScreen(args: {
  authReady: boolean
  isLoggedIn: boolean
  loading: boolean
  error: boolean
  taskCount: number
}): ResumeScreen {
  if (!args.authReady || !args.isLoggedIn || args.loading) return 'loading'
  if (args.error) return 'unavailable'
  if (args.taskCount === 0) return 'empty'
  return 'list'
}

export function formatResumeAmount(cents: number | undefined): string | null {
  if (typeof cents !== 'number' || !(cents > 0)) return null
  return `￥${(cents / 100).toFixed(2)}`
}

export function formatResumeUpdatedAt(iso: string, now = Date.now()): string {
  const diff = now - new Date(iso).getTime()
  if (!Number.isFinite(diff)) return '更新时间未知'
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 2) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  return `${Math.floor(hours / 24)} 天前`
}

export const RESUME_EMPTY_EXITS = [
  { id: 'print', title: '直接办新的', sub: '上传文件、扫描原件、用手机传过来，几步就能开印。', route: '/print-scan' },
  { id: 'code', title: '手机上已经下过单', sub: '到机码还在有效期内、且就在这台机器上核销时，可以直接继续那一单。', route: '/print/pickup-claim' },
  { id: 'records', title: '查以前办过的', sub: '打印订单、服务记录、我的文档都在我的记录里，只有本人看得到。', route: '/me/activity' },
  { id: 'help', title: '刚下过单却看不到', sub: '先确认是不是用另一个手机号建的单；这里只列当前登录账号名下的任务。', route: '/help' },
] as const

export const RESUME_UNAVAILABLE_EXITS = [
  { id: 'code', title: '用到机码继续', sub: '到机码还在有效期内、且就在这台机器上核销时，可以绕开这一页。', route: '/print/pickup-claim' },
  { id: 'records', title: '去我的记录看看', sub: '打印订单和状态在我的记录里，同样能确认这一单还在不在。', route: '/me/activity' },
  { id: 'help', title: '一直读不出来', sub: '按常见问题里的方式找现场工作人员，请他们帮你核对这一单的真实状态。', route: '/help' },
] as const
