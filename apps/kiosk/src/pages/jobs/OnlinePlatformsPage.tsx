import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { KioskPageFrame } from '@ai-job-print/ui'
import { ExternalLinkIcon, XIcon, InfoIcon } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import '../../styles/prototype-v1.css'

interface Platform {
  id: string
  name: string
  tagline: string
  category: string
  url: string
}

const PLATFORMS: readonly Platform[] = [
  {
    id: 'boss',
    name: 'Boss直聘',
    tagline: '直连招聘，直接与招聘负责人沟通',
    category: '直聘平台',
    url: 'https://www.zhipin.com',
  },
  {
    id: '51job',
    name: '前程无忧',
    tagline: '综合招聘求职一站式服务平台',
    category: '综合平台',
    url: 'https://www.51job.com',
  },
  {
    id: 'zhilian',
    name: '智联招聘',
    tagline: '职业发展综合服务，岗位丰富',
    category: '综合平台',
    url: 'https://www.zhaopin.com',
  },
  {
    id: 'liepin',
    name: '猎聘',
    tagline: '中高端人才招聘，精准匹配职位',
    category: '中高端平台',
    url: 'https://www.liepin.com',
  },
] as const

export function OnlinePlatformsPage() {
  const navigate = useNavigate()
  const [activePlatform, setActivePlatform] = useState<Platform | null>(null)

  function openPanel(platform: Platform) {
    setActivePlatform(platform)
  }

  function closePanel() {
    setActivePlatform(null)
  }

  return (
    <KioskPageFrame
      className="kpv1 kpv1--content-only a-clay"
      title="线上招聘平台"
      subtitle="用手机扫码前往来源平台投递"
      onBack={() => navigate(-1)}
      backLabel="返回"
    >
      {/* 平台卡片列表 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {PLATFORMS.map((platform) => (
          <div
            key={platform.id}
            className="card"
            style={{
              padding: '20px 24px',
              display: 'flex',
              alignItems: 'center',
              gap: 20,
            }}
          >
            {/* 平台图标（首字缩写） */}
            <div
              style={{
                width: 60,
                height: 60,
                borderRadius: 16,
                flexShrink: 0,
                background: 'var(--pv-clay-soft)',
                border: '1px solid color-mix(in srgb, var(--pv-clay) 25%, transparent)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 22,
                fontWeight: 700,
                color: 'var(--pv-clay-deep)',
                fontFamily: 'var(--pv-serif)',
              }}
            >
              {platform.name.slice(0, 1)}
            </div>

            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
                <span style={{ fontSize: 23, fontWeight: 700, color: 'var(--pv-ink)', letterSpacing: 0.5 }}>
                  {platform.name}
                </span>
                <span
                  style={{
                    fontSize: 13,
                    color: 'var(--pv-clay-deep)',
                    background: 'var(--pv-clay-soft)',
                    border: '1px solid color-mix(in srgb, var(--pv-clay) 25%, transparent)',
                    borderRadius: 999,
                    padding: '3px 10px',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {platform.category}
                </span>
              </div>
              <div style={{ fontSize: 16, color: 'var(--pv-muted)', marginTop: 5 }}>
                {platform.tagline}
              </div>
            </div>

            <button
              type="button"
              onClick={() => openPanel(platform)}
              style={{
                flexShrink: 0,
                minHeight: 56,
                padding: '0 28px',
                borderRadius: 'var(--pv-r-sm)',
                border: 'none',
                background: 'var(--pv-clay)',
                color: 'var(--pv-paper)',
                fontSize: 18,
                fontWeight: 600,
                cursor: 'pointer',
                fontFamily: 'var(--pv-sans)',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <ExternalLinkIcon aria-hidden="true" style={{ width: 18, height: 18 }} />
              去来源平台投递
            </button>
          </div>
        ))}
      </div>

      {/* 合规提示 */}
      <div className="notice" style={{ marginTop: 8 }}>
        <InfoIcon aria-hidden="true" />
        投递请前往来源平台，本终端不参与投递流程，不收取求职者简历，不参与企业筛选。
      </div>

      {/* 二维码面板（全屏遮罩） */}
      {activePlatform != null && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`扫码访问 ${activePlatform.name}`}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 200,
            background: 'rgba(16, 48, 43, 0.65)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onClick={closePanel}
        >
          <div
            style={{
              background: 'var(--pv-surface)',
              borderRadius: 'var(--pv-r-md)',
              padding: '36px 40px',
              width: 'min(480px, 90vw)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 20,
              boxShadow: '0 20px 60px rgba(16,48,43,0.3)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* 关闭按钮 */}
            <div style={{ width: '100%', display: 'flex', justifyContent: 'flex-end', marginBottom: -8 }}>
              <button
                type="button"
                aria-label="关闭"
                onClick={closePanel}
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 12,
                  border: '1px solid var(--pv-line)',
                  background: 'var(--pv-paper)',
                  color: 'var(--pv-muted)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <XIcon aria-hidden="true" style={{ width: 22, height: 22 }} />
              </button>
            </div>

            <div
              style={{
                fontSize: 26,
                fontWeight: 700,
                fontFamily: 'var(--pv-serif)',
                color: 'var(--pv-ink)',
                letterSpacing: 1,
                textAlign: 'center',
              }}
            >
              {activePlatform.name}
            </div>

            <div
              style={{
                fontSize: 17,
                color: 'var(--pv-muted)',
                textAlign: 'center',
                lineHeight: 1.5,
              }}
            >
              请用手机扫描下方二维码访问来源平台
            </div>

            {/* QR码 */}
            <div
              style={{
                background: '#fff',
                borderRadius: 16,
                padding: 16,
                border: '1px solid var(--pv-line)',
              }}
            >
              <QRCodeSVG value={activePlatform.url} size={200} level="M" marginSize={0} />
            </div>

            <div
              style={{
                fontSize: 14,
                color: 'var(--pv-muted)',
                textAlign: 'center',
                background: 'var(--pv-paper)',
                borderRadius: 8,
                padding: '10px 16px',
                border: '1px dashed var(--pv-line)',
                width: '100%',
              }}
            >
              {activePlatform.url}
            </div>

            {/* 合规提示 */}
            <div
              style={{
                fontSize: 14,
                color: 'var(--pv-muted)',
                textAlign: 'center',
                lineHeight: 1.6,
                borderTop: '1px solid var(--pv-line)',
                paddingTop: 16,
                width: '100%',
              }}
            >
              投递请前往来源平台，本终端不参与投递流程
            </div>
          </div>
        </div>
      )}
    </KioskPageFrame>
  )
}
