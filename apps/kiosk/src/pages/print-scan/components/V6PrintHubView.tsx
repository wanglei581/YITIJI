import {
  ArrowRightIcon,
  CheckIcon,
  InfoIcon,
  ShieldCheckIcon,
  SparklesIcon,
  type LucideIcon,
} from 'lucide-react'

export interface V6PrintCapabilityView {
  key: string
  icon: LucideIcon
  title: string
  description: string
  accent: 'teal' | 'clay' | 'wheat' | 'plum' | 'slate'
  available: boolean
  actionable: boolean
  note?: string
  unavailableBadge?: string
}

export interface V6PrintQuickLinkView {
  key: string
  icon: LucideIcon
  title: string
  description: string
}

interface V6PrintHubViewProps {
  loadStatus: 'loading' | 'ok' | 'error'
  capabilities: readonly V6PrintCapabilityView[]
  quickLinks: readonly V6PrintQuickLinkView[]
  sensitiveNotice: string
  legalNotice: string
  onAiGuide: () => void
  onRetry: () => void
  onCapability: (key: string) => void
  onQuickLink: (key: string) => void
}

export function V6PrintHubView({
  loadStatus,
  capabilities,
  quickLinks,
  sensitiveNotice,
  legalNotice,
  onAiGuide,
  onRetry,
  onCapability,
  onQuickLink,
}: V6PrintHubViewProps) {
  const confirmed = loadStatus === 'ok'
  const loading = loadStatus === 'loading'

  return (
    <div data-v6-page="print-hub" data-w2-page="print-scan-home" className="v6-print-hub">
      <section className="v6-print-guide" aria-labelledby="v6-print-guide-title">
        <div className="v6-print-guide__title">
          <SparklesIcon aria-hidden="true" />
          <h2 id="v6-print-guide-title">这一屏的 AI 只做三件事，点一件我给你下一步</h2>
          <span>选哪件不依赖 AI</span>
        </div>
        <div className="v6-print-guide__actions">
          <button type="button" onClick={onAiGuide}>
            <b>我不知道该用哪个</b>
            <span>说你要办的事，按事推荐入口</span>
          </button>
          <button type="button" onClick={onAiGuide}>
            <b>帮我检查文件能不能打</b>
            <span>页数、清晰度和版面建议</span>
          </button>
          <button type="button" onClick={onAiGuide}>
            <b>打印前隐私检查</b>
            <span>提示身份证号等敏感信息</span>
          </button>
        </div>
        <p>AI 只给建议，不改动文件；材料检查与隐私处理必须由你确认。</p>
      </section>

      <section className="v6-print-state" aria-live="polite">
        <span className={`v6-print-state__dot${confirmed ? ' is-ready' : ''}`} aria-hidden="true" />
        <div>
          <strong>
            {confirmed
              ? '本机服务配置已读取'
              : loading
                ? '正在确认本机服务配置'
                : '本机服务状态无法确认'}
          </strong>
          <span>
            {confirmed
              ? '七项服务按后台配置开放，硬件状态提交前再次确认'
              : '未确认能力不会创建正式打印或扫描任务'}
          </span>
        </div>
        {!confirmed ? (
          <button type="button" onClick={onRetry} disabled={loading}>
            {loading ? '检查中' : '重新检测'}
          </button>
        ) : null}
      </section>

      <div className="v6-print-section-head">
        <h2>这个台面能做的七件事</h2>
        <span>右上角标明是否依赖 AI</span>
      </div>

      <section className="v6-print-capabilities" aria-label="打印扫描能力">
        {capabilities.map((capability) => {
          const Icon = capability.icon
          return (
            <button
              key={capability.key}
              type="button"
              className={`v6-print-capability v6-print-capability--${capability.accent}${!capability.available ? ' is-unavailable' : ''}`}
              disabled={!capability.actionable}
              onClick={() => onCapability(capability.key)}
            >
              <span className="v6-print-capability__top">
                <span className="v6-print-capability__icon">
                  <Icon aria-hidden="true" />
                </span>
                <b>{capability.title}</b>
                <span className="v6-print-capability__tag">
                  {capability.available
                    ? capability.key === 'phone-upload'
                      ? '不依赖 AI'
                      : 'AI · 仅供参考'
                    : (capability.unavailableBadge ?? '暂不可用')}
                </span>
              </span>
              <span className="v6-print-capability__description">{capability.description}</span>
              {capability.note ? (
                <span className="v6-print-capability__note">{capability.note}</span>
              ) : null}
              <span className="v6-print-capability__go">
                {capability.actionable ? (capability.available ? '进入' : '了解详情') : '暂不可用'}
                {capability.actionable ? <ArrowRightIcon aria-hidden="true" /> : null}
              </span>
            </button>
          )
        })}

        <article className="v6-print-device-card">
          <h3>本机服务配置</h3>
          <p>
            {confirmed
              ? '配置已读取；纸张、耗材与输稿器在提交前确认。'
              : '当前不推断任何硬件可用性。'}
          </p>
          <div>
            {[
              confirmed ? '入口按本机配置开放' : '能力配置未确认',
              '打印参数提交前再次校验',
              '未确认时不会创建正式任务',
            ].map((line) => (
              <span key={line}>
                {confirmed ? <CheckIcon aria-hidden="true" /> : <InfoIcon aria-hidden="true" />}
                {line}
              </span>
            ))}
          </div>
        </article>
      </section>

      <section className="v6-print-records" aria-labelledby="v6-print-records-title">
        <div>
          <h2 id="v6-print-records-title">我的打印记录</h2>
          <p>登录后可查看本人文件、任务状态与凭证</p>
        </div>
        <div className="v6-print-records__links">
          {quickLinks.map((link) => {
            const Icon = link.icon
            return (
              <button key={link.key} type="button" onClick={() => onQuickLink(link.key)}>
                <Icon aria-hidden="true" />
                <span>
                  <b>{link.title}</b>
                  <small>{link.description}</small>
                </span>
                <ArrowRightIcon aria-hidden="true" />
              </button>
            )
          })}
        </div>
      </section>

      <footer className="v6-print-notices">
        <div>
          <ShieldCheckIcon aria-hidden="true" />
          <p>{sensitiveNotice}</p>
        </div>
        <div>
          <InfoIcon aria-hidden="true" />
          <p>{legalNotice}</p>
        </div>
      </footer>
    </div>
  )
}
