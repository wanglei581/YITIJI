// HomeHeroHeader — 首页 Hero 顶行（稿 01-home `.hero-top`）：品牌 · 终端号 · 设备状态 · 时钟。
// 首页不走 QxPageFrame 的独立顶栏，品牌在 Hero 内，并承担全页唯一的 h1。
// 仍挂 qx-topbar / qx-pill：设备状态胶囊的测试锚点是 `.qx-topbar .qx-pill`。

import { useEffect, useState } from 'react'

export interface HomeDeviceStatus {
  tone: 'ok' | 'warn' | 'bad' | 'unknown'
  label: string
}

interface HomeHeroHeaderProps {
  /** 真实终端码；未绑定时由容器传「设备未绑定」，这里照实显示，不补示例机号。 */
  terminalCode: string
  /** 真实设备状态；拿不到时由容器传 unknown，不得默认 ok。 */
  deviceStatus: HomeDeviceStatus
}

function QxHomeClock() {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 10_000)
    return () => window.clearInterval(timer)
  }, [])

  return (
    <time className="qx-home-clock" dateTime={now.toISOString()}>
      <strong>{new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(now)}</strong>
      <span>{new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' }).format(now)}</span>
    </time>
  )
}

export function HomeHeroHeader({ terminalCode, deviceStatus }: HomeHeroHeaderProps) {
  return (
    <header className="qx-topbar qx-home-hero-top">
      <span className="qx-topbar-mark" aria-hidden="true">职</span>
      <div className="qx-home-brand">
        <h1 className="qx-topbar-brand">职易达</h1>
        <span className="qx-topbar-sub">职易达AI求职操作系统</span>
        <span className="qx-home-terminal">就业服务大厅 · {terminalCode}</span>
      </div>
      <span className="qx-topbar-spacer" />
      {/* 状态未知时照实显示「状态未知」而不是隐藏——公共终端上"没显示"会被读成"一切正常"。 */}
      <span className="qx-pill" data-tone={deviceStatus.tone}>{deviceStatus.label}</span>
      <QxHomeClock />
    </header>
  )
}
