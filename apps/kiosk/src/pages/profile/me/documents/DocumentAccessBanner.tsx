import type { ReactNode } from 'react'
import { ClockIcon, InfoIcon, RefreshCwIcon, TriangleAlertIcon } from 'lucide-react'

export type DocumentAccessPhase = 'loading' | 'expired' | 'error' | 'ready'
export type DocumentAccessIntent = 'preview' | 'print'

const COPY: Record<DocumentAccessPhase, { tone: 'calm' | 'warn'; title: (intent: DocumentAccessIntent) => string; desc: (action: string) => ReactNode; note: string }> = {
  loading: {
    tone: 'calm',
    title: () => '正在为这份文件取得新的访问链接',
    desc: (action) => <>列表里<b>不保存长期可用的文件地址</b>。每次{action}前都要凭本人登录态向系统重新取得短期链接。</>,
    note: '文件身份不进 URL',
  },
  expired: {
    tone: 'warn',
    title: () => '刚取得的访问链接已经过期',
    desc: () => <>短期链接过期不等于文件一定被删除。页面会<b>重新向系统申请</b>，不会继续使用旧地址。</>,
    note: '旧链接已弃用',
  },
  error: {
    tone: 'warn',
    title: () => '这次没有取得可用链接',
    desc: () => <>可能是网络失败、文件已到期或已被清理；本页<b>这里不猜测具体原因</b>，也不沿用上一次的链接。</>,
    note: '未创建新订单',
  },
  ready: {
    tone: 'calm',
    title: (intent) => (intent === 'print' ? '打印凭证已就绪' : '预览链接已就绪'),
    desc: (action) => (action === '用于打印'
      ? <>文件编号和打印凭证会交给打印确认；<b>这些内容不出现在地址栏</b>。</>
      : <>会在当前页面打开短期预览链接；关闭预览后仍停留在本人文档列表。</>),
    note: '短期有效',
  },
}

export function DocumentAccessBanner({
  phase,
  intent,
  onRetry,
}: {
  phase: DocumentAccessPhase
  intent: DocumentAccessIntent
  onRetry: () => void
}) {
  const action = intent === 'print' ? '用于打印' : '预览'
  const copy = COPY[phase]
  const Icon = copy.tone === 'warn' ? TriangleAlertIcon : phase === 'ready' ? InfoIcon : ClockIcon
  const retry = phase === 'expired' || phase === 'error'
  return (
    <section className="qx-me-banner" data-testid="member-assets-access" data-access={phase} data-intent={intent} data-kind={copy.tone}>
      <span className="qx-me-banner-ico" data-tone={copy.tone} aria-hidden="true"><Icon size={34} /></span>
      <span className="qx-me-banner-main">
        <h2 className="qx-me-banner-t">{copy.title(intent)}</h2>
        <span className="qx-me-banner-p">{copy.desc(action)}</span>
      </span>
      <span className="qx-me-banner-mini">
        <i>用途：{action}</i>
        <i>{copy.note}</i>
        {retry ? (
          <button type="button" className="qx-me-small" data-variant="primary" data-testid="member-assets-access-retry" onClick={onRetry}>
            <RefreshCwIcon size={19} aria-hidden="true" />
            重新取得链接
          </button>
        ) : null}
      </span>
    </section>
  )
}
