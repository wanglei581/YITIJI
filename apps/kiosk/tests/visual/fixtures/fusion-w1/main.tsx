import {
  KioskActionBar,
  KioskModal,
  KioskPageFrame,
  KioskPageHeader,
  KioskStatePanel,
  type KioskStateTone,
  type KioskViewport,
} from '@ai-job-print/ui'
import React, { useState, type CSSProperties } from 'react'
import { createRoot } from 'react-dom/client'
import '../../../../src/index.css'

const STATES: ReadonlyArray<{
  tone: KioskStateTone
  title: string
  description: string
}> = [
  { tone: 'loading', title: '正在准备示例', description: '请稍候，这是合成加载状态。' },
  { tone: 'empty', title: '暂无示例内容', description: '这是合成空状态。' },
  { tone: 'error', title: '示例处理失败', description: '这是合成错误状态。' },
  { tone: 'offline', title: '示例网络离线', description: '这是合成离线状态。' },
  { tone: 'success', title: '示例处理完成', description: '这是合成成功状态。' },
  { tone: 'permission', title: '示例权限不足', description: '这是合成权限状态。' },
]

const buttonStyle: CSSProperties = {
  minWidth: 120,
  minHeight: 56,
  padding: '0 20px',
  border: '1px solid #cfc9b6',
  borderRadius: 14,
  background: '#fffdf8',
  color: '#10302b',
  font: 'inherit',
}

function getViewport(): KioskViewport {
  const requestedViewport = new URLSearchParams(window.location.search).get('viewport')
  return requestedViewport === 'kiosk' || requestedViewport === 'mobile'
    ? requestedViewport
    : 'kiosk'
}

function Fixture() {
  const [modalOpen, setModalOpen] = useState(true)
  const viewport = getViewport()

  return (
    <div
      data-testid="fixture-root"
      data-kiosk-presentation="fusion-youth"
      data-kiosk-viewport={viewport}
      style={{ minHeight: '100dvh' }}
    >
      <KioskPageFrame
        header={(
          <KioskPageHeader
            title="Fusion W1 组件验收"
            description="仅用于浏览器隔离验证的合成界面"
            onBack={() => undefined}
            backLabel="返回示例"
            headingId="fixture-heading"
          />
        )}
        footer={(
          <KioskActionBar leading={<span>合成操作栏</span>}>
            <button type="button" style={buttonStyle} data-testid="secondary-action">次要操作</button>
            <button type="button" style={buttonStyle} data-testid="primary-action">主要操作</button>
          </KioskActionBar>
        )}
      >
        <div
          data-testid="state-grid"
          style={{ display: 'grid', gap: 20, padding: viewport === 'mobile' ? '4px 0' : '0 48px' }}
        >
          {STATES.map((state) => (
            <div key={state.tone} data-testid={`state-${state.tone}`}>
              <KioskStatePanel
                tone={state.tone}
                title={state.title}
                description={state.description}
                compact
              />
            </div>
          ))}
        </div>
        <div style={{ padding: viewport === 'mobile' ? '20px' : '28px 48px' }}>
          <button
            type="button"
            style={buttonStyle}
            data-testid="open-modal"
            onClick={() => setModalOpen(true)}
          >
            打开示例弹窗
          </button>
        </div>
      </KioskPageFrame>
      <KioskModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="示例确认弹窗"
        description="用于验证焦点、关闭与滚动锁定。"
        closeLabel="关闭示例弹窗"
        actions={(
          <button type="button" style={buttonStyle} onClick={() => setModalOpen(false)}>
            确认关闭
          </button>
        )}
      >
        <p>这里只包含合成验收文案，不发起任何网络请求。</p>
      </KioskModal>
    </div>
  )
}

document.body.style.margin = '0'
document.body.style.overflow = 'auto'

const root = document.getElementById('root')
if (!root) throw new Error('Fixture root element is missing')

createRoot(root).render(
  <React.StrictMode>
    <Fixture />
  </React.StrictMode>,
)
