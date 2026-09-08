import { Building2Icon, SearchIcon, SparklesIcon } from 'lucide-react'

export function JobsQxAiEntry({ onStart }: { onStart: () => void }) {
  return (
    <section className="qx-card qx-jobs-ai" data-live="true">
      <span className="qx-jobs-ai-icon"><SparklesIcon aria-hidden="true" /></span>
      <span className="qx-jobs-ai-copy">
        <b>用我的简历智能推荐</b>
        <span>选择一份本人已完成诊断的简历，从当前真实岗位中给出参考等级和理由；不向企业共享简历。</span>
      </span>
      <button type="button" className="qx-btn" data-variant="teal" onClick={onStart}>开始推荐</button>
    </section>
  )
}

export function JobsQxSourceNotice({ activeSourceName }: { activeSourceName?: string }) {
  return (
    <aside className="qx-state" data-tone="info">
      <span className="qx-state-ic"><Building2Icon aria-hidden="true" /></span>
      <span>
        <span className="qx-state-t">第三方 / 官方来源信息入口</span>
        <span className="qx-state-d">本系统不接收简历、不参与招聘流程，请前往来源平台办理。{activeSourceName ? ` 当前来源：${activeSourceName}。` : ''}</span>
      </span>
    </aside>
  )
}

export function JobsQxState({ error, onRetry }: { error: string | null; onRetry: () => void }) {
  if (!error) {
    return (
      <section className="qx-state qx-grow" data-tone="info" aria-live="polite">
        <span className="qx-state-ic"><SearchIcon aria-hidden="true" /></span>
        <span><span className="qx-state-t">正在取岗位名单</span><span className="qx-state-d">真实字段返回前不显示示例岗位，也不沿用上一次列表。</span></span>
      </section>
    )
  }
  return (
    <section className="qx-state qx-grow" data-tone="error" role="alert">
      <span className="qx-state-ic"><SearchIcon aria-hidden="true" /></span>
      <span><span className="qx-state-t">岗位名单这次没取到</span><span className="qx-state-d">{error}。本机不显示缓存结果冒充最新岗位。</span></span>
      <button type="button" className="qx-btn" data-variant="primary" onClick={onRetry}>重新加载</button>
    </section>
  )
}
