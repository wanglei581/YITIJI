import type { FC } from 'react'

interface AiDriverBannerProps {
  /** AI能力名称，如 「AI文件预检」 */
  feature: string
  /** 简短描述 */
  description: string
  /** 可选：点击整个banner的回调（如跳转AI顾问） */
  onClick?: () => void
}

/**
 * AI底层驱动层横幅——插在 pagehead 之后、main content 之前。
 * 视觉：青绿渐变背景，✦ 图标 + 功能名 + 描述。
 * 对应原型 docs/design/kiosk-proto-2026-07/shared.css 中的AI底层驱动层样式。
 */
export const AiDriverBanner: FC<AiDriverBannerProps> = ({ feature, description, onClick }) => {
  return (
    <div
      className="ai-driver-banner"
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') onClick()
            }
          : undefined
      }
      style={{
        flex: 'none',
        margin: '12px 48px 0',
        background: 'linear-gradient(90deg, rgba(31,158,134,.07), rgba(31,158,134,.04))',
        border: '1px solid rgba(31,158,134,.2)',
        borderRadius: '18px',
        padding: '14px 22px',
        display: 'flex',
        alignItems: 'center',
        gap: '14px',
        cursor: onClick ? 'pointer' : 'default',
      }}
    >
      <span style={{ fontSize: '20px', color: 'var(--pv-teal-deep, #157a67)' }}>✦</span>
      <span style={{ fontSize: '20px', color: 'var(--pv-teal-deep, #157a67)', fontWeight: 600 }}>
        {feature}
      </span>
      <span style={{ fontSize: '18px', color: 'var(--pv-muted, #5d6b63)', marginLeft: 'auto' }}>
        {description}
      </span>
    </div>
  )
}
