// 简历对照（岗位匹配，青序流光）共用呈现件。
//
// 稿：docs/design/kiosk-redesign-2026-08/46-resume-decision-workspace.html?screen=job-fit
// 对应 resume-decision-workspace.js 里的 sec / slots / checks / kit / waiting /
// ghosts / verdict / why / steps / nots / listRows / trace / guard / routes /
// nextSteps / dock 这几个生成函数。
//
// 这些件**只负责把已经确定的事实摆出来**：没有真实数据时渲染的是显式「尚未 /
// 等待返回」槽位，不是骨架假内容。不要给它们加默认值兜底 —— 那等于替服务端说话。

import type { ReactNode } from 'react'
import { AlertTriangleIcon, FileTextIcon, LockIcon, ShieldCheckIcon, TargetIcon, XIcon } from 'lucide-react'

export function Sec({ no, title, hint, copy, grow, children }: {
  no?: string
  title: string
  hint?: string
  copy?: string
  /** 定高屏的余量吸收块，一屏只指定一个（见 primitives.css 的 .qx-grow 注释）。 */
  grow?: boolean
  children: ReactNode
}) {
  return (
    <section className={grow ? 'jfq-sec qx-grow' : 'jfq-sec'}>
      <div className="jfq-sec-head">
        {no ? <span className="jfq-sec-no">{no}</span> : null}
        <h2>{title}</h2>
        {hint ? <span className="jfq-sec-hint">{hint}</span> : null}
      </div>
      {copy ? <p className="jfq-sec-copy">{copy}</p> : null}
      {children}
    </section>
  )
}

/** 输入槽位：`fixed` 表示这一项不是等服务端返回，而是产品边界已经钉死的事实。 */
export function Slots({ items }: { items: Array<{ label: string; value: string; fixed?: boolean }> }) {
  return (
    <div className="jfq-slots">
      {items.map((item) => (
        <div key={item.label} className="jfq-slot" data-fixed={item.fixed ? 'true' : undefined}>
          <small>{item.label}</small>
          <b>{item.value}</b>
        </div>
      ))}
    </div>
  )
}

export type CheckTone = 'ok' | 'wait' | 'off'

export function Checks({ items }: {
  items: Array<{ tone: CheckTone; icon: ReactNode; title: string; desc: string; chip: string }>
}) {
  return (
    <div className="jfq-checks">
      {items.map((item) => (
        <div key={item.title} className="jfq-check" data-tone={item.tone}>
          <span className="jfq-check-ic" aria-hidden="true">{item.icon}</span>
          <span className="jfq-check-tx">
            <b>{item.title}</b>
            <p>{item.desc}</p>
          </span>
          <span className="jfq-chip">{item.chip}</span>
        </div>
      ))}
    </div>
  )
}

/** 非 AI 退路条。一律走站内既有流程，不外跳、不开新标签页。 */
export function KitRows({ items }: {
  items: Array<{ icon: ReactNode; title: string; desc: string; onClick: () => void }>
}) {
  return (
    <div className="jfq-kit">
      {items.map((item) => (
        <button key={item.title} type="button" onClick={item.onClick}>
          <span className="jfq-kit-ic" aria-hidden="true">{item.icon}</span>
          <span>
            <b>{item.title}</b>
            <small>{item.desc}</small>
          </span>
        </button>
      ))}
    </div>
  )
}

/** 等待面板：只表达整体等待。没有进度条、百分比或预计时间。 */
export function Waiting({ icon, title, desc, tag }: { icon: ReactNode; title: string; desc: string; tag: string }) {
  return (
    <div className="jfq-wait" role="status" aria-live="polite">
      <span className="jfq-wait-ic" aria-hidden="true">{icon}</span>
      <div>
        <b>{title}</b>
        <p>{desc}</p>
        <span className="jfq-pulse">
          <i /><i /><i />
          <span>{tag}</span>
        </span>
      </div>
    </div>
  )
}

/** 未返回占位：虚线框写清「等待返回」，不拿上一次的值或默认值填。 */
export function Ghosts({ items }: { items: Array<{ title: string; desc: string; tag: string }> }) {
  return (
    <div className="jfq-ghosts">
      {items.map((item) => (
        <div key={item.title} className="jfq-ghost">
          <b>{item.title}</b>
          <p>{item.desc}</p>
          <span>{item.tag}</span>
        </div>
      ))}
    </div>
  )
}

export function Verdict({ items }: { items: Array<{ tone: 'ok' | 'warn' | 'bad'; label: string; value: string }> }) {
  return (
    <div className="jfq-verdict" data-cols={items.length === 2 ? '2' : undefined}>
      {items.map((item) => (
        <div key={item.label} data-tone={item.tone}>
          <small>{item.label}</small>
          <b>{item.value}</b>
        </div>
      ))}
    </div>
  )
}

export function Why({ items }: { items: Array<{ head: string; title: string; desc: string }> }) {
  return (
    <div className="jfq-why">
      {items.map((item) => (
        <div key={item.title}>
          <div>
            <span className="jfq-why-h">{item.head}</span>
            <b>{item.title}</b>
          </div>
          <p>{item.desc}</p>
        </div>
      ))}
    </div>
  )
}

export function Steps({ items }: { items: Array<{ title: string; desc: string }> }) {
  return (
    <div className="jfq-steps">
      {items.map((item, index) => (
        <div key={item.title} className="jfq-step">
          <span className="jfq-step-no" aria-hidden="true">{index + 1}</span>
          <span>
            <b>{item.title}</b>
            <p>{item.desc}</p>
          </span>
        </div>
      ))}
    </div>
  )
}

/** 明确否定：这些事现在没有发生。合规边界不随状态放宽。 */
export function Nots({ items }: { items: string[] }) {
  return (
    <div className="jfq-nots">
      {items.map((item) => (
        <div key={item} className="jfq-not">
          <XIcon size={20} aria-hidden="true" />
          <span>{item}</span>
        </div>
      ))}
    </div>
  )
}

export function ListRows({ items }: { items: string[] }) {
  return (
    <div className="jfq-list">
      {items.map((item, index) => (
        <div key={item} className="jfq-list-row">
          <i aria-hidden="true">{index + 1}</i>
          <span>{item}</span>
        </div>
      ))}
    </div>
  )
}

export function Trace({ items }: { items: Array<{ phase: string; title: string; desc: string; now?: boolean }> }) {
  return (
    <div className="jfq-trace">
      {items.map((item) => (
        <div key={item.title} data-now={item.now ? 'true' : undefined}>
          <small>{item.phase}</small>
          <b>{item.title}</b>
          <p>{item.desc}</p>
          {item.now ? <span className="jfq-now-tag">当前停在这里</span> : null}
        </div>
      ))}
    </div>
  )
}

/** 紧凑披露条：真实性 / 授权 / 服务端边界压成一行，不铺等权治理卡。 */
export function Guardline({ head, body }: { head: string; body: string }) {
  return (
    <div className="jfq-guard">
      <ShieldCheckIcon size={20} aria-hidden="true" />
      <p><b>{head}</b>{body}</p>
    </div>
  )
}

/** 恢复路径卡：AI 不可用时仍然成立的三条站内去处。 */
export function RouteCards({ items }: {
  items: Array<{ title: string; desc: string; action: string; onClick: () => void }>
}) {
  return (
    <div className="jfq-routes">
      {items.map((item) => (
        <button key={item.title} type="button" onClick={item.onClick}>
          <b>{item.title}</b>
          <p>{item.desc}</p>
          <span className="jfq-route-go">{item.action} →</span>
        </button>
      ))}
    </div>
  )
}

export function NextSteps({ items }: {
  items: Array<{ title: string; desc: string; onClick: () => void }>
}) {
  return (
    <div className="jfq-next">
      {items.map((item, index) => (
        <button key={item.title} type="button" onClick={item.onClick}>
          <span className="jfq-next-no" aria-hidden="true">{index + 1}</span>
          <span className="jfq-next-t">
            <b>{item.title}</b>
            <p>{item.desc}</p>
          </span>
          <span className="jfq-next-go" aria-hidden="true">→</span>
        </button>
      ))}
    </div>
  )
}

/** 底部操作条注脚：稿里 dock 的第一行，说清这一屏的边界。 */
export function CtaNote({ children }: { children: ReactNode }) {
  return (
    <p className="jfq-cta-note">
      <AlertTriangleIcon size={20} aria-hidden="true" />
      <span>{children}</span>
    </p>
  )
}

/** 手填目标岗位的两个输入。受控件，值与校验都留在页面。 */
export function ManualTargetFields({ title, requirement, onTitleChange, onRequirementChange }: {
  title: string
  requirement: string
  onTitleChange: (value: string) => void
  onRequirementChange: (value: string) => void
}) {
  return (
    <div className="jfq-field">
      <small>目标岗位</small>
      <input
        value={title}
        onChange={(e) => onTitleChange(e.target.value)}
        maxLength={50}
        placeholder="目标岗位名称，如：行政专员"
        aria-label="目标岗位名称"
        className="jfq-input"
      />
      <textarea
        value={requirement}
        onChange={(e) => onRequirementChange(e.target.value)}
        maxLength={2000}
        rows={5}
        placeholder="可粘贴岗位 JD / 任职要求（选填，提供后参考更有针对性）"
        aria-label="岗位 JD 或任职要求"
        className="jfq-textarea"
      />
    </div>
  )
}

/**
 * 分析前检查：四项输入的当前状态 + 边界声明。全部由页面算好后传入，本件不推断。
 * `manualOnly`：招聘内容托管关闭（3.13）时只能手填岗位要求，不再提「系统岗位」。
 */
export function PreflightChecklist({ targetLabel, hasTarget, consentConfirmed, manualOnly = false }: {
  targetLabel: string
  hasTarget: boolean
  consentConfirmed: boolean
  manualOnly?: boolean
}) {
  return (
    <>
      <Slots items={[
        { label: '本人简历任务', value: '已确认' },
        { label: '目标岗位', value: targetLabel },
        { label: '本人授权', value: consentConfirmed ? '已确认' : '待确认' },
        { label: '结果归属', value: '仅本人可见', fixed: true },
      ]} />
      <Checks items={[
        { tone: 'ok', icon: <FileTextIcon size={24} />, title: '本人简历任务', desc: '必须存在，且通过当前会话校验；不会读取别人的任务。', chip: '已确认' },
        { tone: hasTarget ? 'ok' : 'wait', icon: <TargetIcon size={24} />, title: '目标岗位', desc: manualOnly ? '手填岗位名称与要求，至少要有名称，不补默认内容。' : '系统岗位或手填目标，至少要有名称，不补默认内容。', chip: hasTarget ? '已选择' : '待选择' },
        { tone: consentConfirmed ? 'ok' : 'wait', icon: <ShieldCheckIcon size={24} />, title: '本人授权', desc: '匿名与会员按各自规则确认；未授权不分析。', chip: consentConfirmed ? '已确认' : '待确认' },
        { tone: 'ok', icon: <LockIcon size={24} />, title: '结果去向', desc: '对照结果只供本人准备，不提供给企业，也不形成投递记录。', chip: '已固定' },
      ]} />
      <Guardline
        head="只对照，不打分"
        body="不给档位或分数，也不预测通过率；分析过程中不显示进度百分比，返回前不提前放出结果。本平台不提供投递功能。"
      />
    </>
  )
}
