import type { ReactNode } from 'react'

export interface KioskTopbarProps {
  /** 可选品牌标记；V6 使用单字产品标，不由页面重复绘制顶栏。 */
  brandMark?: ReactNode
  /** 顶栏左侧主标题，如「就业服务大厅 · 01号机」。 */
  brandTitle: ReactNode
  /** 顶栏左侧副标题，如「AI求职打印服务终端」。 */
  brandSubtitle?: ReactNode
  /** 顶栏右侧内容，通常为实时时钟 + 设备状态胶囊。 */
  right?: ReactNode
  /** 二级域首屏可把品牌区作为返回首页的真实触控入口。 */
  onBrandClick?: () => void
  brandActionLabel?: string
}

/**
 * Kiosk 顶部状态栏（唯一实现，原型 shared.css .topbar，76px 墨绿）。
 *
 * KioskLayout 内部使用它；顶级全屏路由（不经 KioskLayout）应通过
 * 应用层的 KioskAppTopbar 复用同一组件，禁止再自建第二套顶栏。
 */
export function KioskTopbar({
  brandMark,
  brandTitle,
  brandSubtitle,
  right,
  onBrandClick,
  brandActionLabel,
}: KioskTopbarProps) {
  const brandContent = (
    <>
      {brandMark ? (
        <span className="ui-kiosk-topbar__brand-mark" aria-hidden="true">
          {brandMark}
        </span>
      ) : null}
      <span className="ui-kiosk-topbar__brand-copy">
        <b>{brandTitle}</b>
        {brandSubtitle && <span>{brandSubtitle}</span>}
      </span>
    </>
  )

  return (
    <header className="ui-kiosk-topbar">
      {onBrandClick ? (
        <button
          type="button"
          className="ui-kiosk-topbar__brand ui-kiosk-topbar__brand-action"
          onClick={onBrandClick}
          aria-label={brandActionLabel}
        >
          {brandContent}
        </button>
      ) : (
        <div className="ui-kiosk-topbar__brand">{brandContent}</div>
      )}
      {right && <div className="ui-kiosk-topbar__right">{right}</div>}
    </header>
  )
}
