// QxPageFrame — 青序流光页面壳。
//
// 为什么不复用 packages/ui 的 KioskPageFrame：
//   它带 standalone 时会挂 data-kiosk-presentation="fusion-youth"，激活
//   kiosk-shell.css 的暖褐令牌（--k-ink #1A1714 / --k-line #E5DDD0）。
//   新稿是青序流光（#10302b / #e3ddcb），两套色系落在同一页上必然打架——
//   上一代 V6 迁移"只做了一半所以效果不好"就是这个机制。
//
// 因此走并行双轨：已迁移的页用本壳，未迁移的页保持 KioskPageFrame 不动，
// 两套永远不在同一页相遇。51 页迁完后 KioskPageFrame 与旧样式一并删除。
//
// 舞台缩放**不在本组件做**：外层 KioskRoot 的 KioskStageFit 已经把 1080×1920
// 舞台按可视区等比缩放了。本组件再缩一次会叠乘，页面会塌成一小块——
// 这个 bug 我实际撞到过，只在特定窗口尺寸下显形，全屏截图里看不出来。
// 本组件只负责填满外层给的舞台。
//
// ⚠️ 缩放仍会影响像素断言——屏幕上量到的 px = CSS px × scale。写"按钮 ≥56px"
//    这类门禁时必须除以 stage scale，否则永远误判。

import { type ReactNode } from 'react'
import '../../styles/qingxu/index.css'

export interface QxPageFrameProps {
  /** 页面主标题。宋体，左侧带一道翡翠色竖条。 */
  title: ReactNode
  /** 一句话说明这一页负责什么。不要写成功能罗列。 */
  subtitle?: ReactNode
  /** 顶栏右侧状态胶囊。拿不到真实状态时必须传 unknown，不得默认 ok。 */
  status?: { tone: 'ok' | 'warn' | 'bad' | 'unknown'; label: string }
  /** 顶栏副标题，通常是「机构名 · 终端号」。 */
  terminalLabel?: ReactNode
  children: ReactNode
  /** 底部操作条。传了就渲染，通常放本页的出口按钮。 */
  ctabar?: ReactNode
  /** 底部导航。流程页一般不传（避免用户中途跳走丢失进度）。 */
  navbar?: ReactNode
}

export function QxPageFrame({
  title,
  subtitle,
  status,
  terminalLabel,
  children,
  ctabar,
  navbar,
}: QxPageFrameProps) {
  return (
    <div className="qx-stage" data-qx-frame="true">
      <header className="qx-topbar">
        <span className="qx-topbar-brand">
          <span className="qx-topbar-mark">职</span>
          职易达
        </span>
        {terminalLabel ? <span className="qx-topbar-sub">{terminalLabel}</span> : null}
        <span className="qx-topbar-spacer" />
        {/* 状态未知时显示「状态未知」而不是隐藏——公共终端上"没显示"会被读成"一切正常"。 */}
        <span className="qx-pill" data-tone={status?.tone ?? 'unknown'}>
          {status?.label ?? '状态未知'}
        </span>
      </header>

      <section className="qx-pagehead">
        <h1>{title}</h1>
        {subtitle ? <p>{subtitle}</p> : null}
      </section>

      <div className="qx-body">{children}</div>

      {ctabar ? <div className="qx-ctabar">{ctabar}</div> : null}
      {navbar ? <nav className="qx-navbar">{navbar}</nav> : null}
    </div>
  )
}
