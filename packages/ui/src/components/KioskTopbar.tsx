import type { ReactNode } from 'react'

export interface KioskTopbarProps {
  /** 顶栏左侧主标题，如「就业服务大厅 · 01号机」。 */
  brandTitle: ReactNode
  /** 顶栏左侧副标题，如「AI求职打印服务终端」。 */
  brandSubtitle?: ReactNode
  /** 顶栏右侧内容，通常为实时时钟 + 设备状态胶囊。 */
  right?: ReactNode
}

/**
 * Kiosk 顶部状态栏（唯一实现，原型 shared.css .topbar，76px 墨绿）。
 *
 * KioskLayout 内部使用它；顶级全屏路由（不经 KioskLayout）应通过
 * 应用层的 KioskAppTopbar 复用同一组件，禁止再自建第二套顶栏。
 */
export function KioskTopbar({ brandTitle, brandSubtitle, right }: KioskTopbarProps) {
  return (
    <header className="ui-kiosk-topbar">
      <div className="ui-kiosk-topbar__brand">
        <b>{brandTitle}</b>
        {brandSubtitle && <span>{brandSubtitle}</span>}
      </div>
      {right && <div className="ui-kiosk-topbar__right">{right}</div>}
    </header>
  )
}
