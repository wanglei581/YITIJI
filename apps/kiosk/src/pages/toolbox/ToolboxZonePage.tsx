// 百宝箱区页（/toolbox）
//
// 由来：01-home.html 原型把「百宝箱」画成首页聚合 zone-card（单卡入口），
// 生产的可启动 items + 启动弹窗 + 匿名事件上报能力需要承载页。原型无此屏，
// 本页为能力承载区页（同 60/61 系统屏性质），以 prototype-v1 壳呈现。
// 首页 zone-card 点击 → /toolbox；能力（config 驱动 / 站内·外部H5·二维码启动 /
// 离场确认 / sendBeacon 事件）由本页保留，零削减。
import type { KioskToolboxItem } from '@ai-job-print/shared'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { KIcon, type KioskIconName } from '../../components/kiosk-icon'
import { useToolboxConfig } from '../../hooks/useToolboxConfig'
import { itemBadge, itemLaunchable, launchKioskAppItem } from '../home/components/kioskAppLaunch'
import { ExternalLaunchModal, QrLaunchModal } from '../home/components/ToolboxLaunchModals'
import { ProtoIcon } from '../home/prototypeIcons'
import '../../styles/prototype-v1.css'
import './toolbox-zone.css'

const TOOLBOX_ICONS: Record<string, KioskIconName> = {
  wrench: 'toolbox',
  'file-text': 'files',
  printer: 'printer',
  sparkles: 'sparkle',
  'book-open': 'book',
  'help-circle': 'help',
}

function ToolboxItemTile({
  item,
  onQr,
  onExternal,
}: {
  item: KioskToolboxItem
  onQr: (item: KioskToolboxItem) => void
  onExternal: (item: KioskToolboxItem) => void
}) {
  const navigate = useNavigate()
  const disabled = item.disabled || !itemLaunchable(item)
  const badge = itemBadge(item)
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => !disabled && launchKioskAppItem(item, navigate, onQr, onExternal)}
      className="tile"
      title={item.description}
    >
      <span className="t-icon">
        <KIcon name={TOOLBOX_ICONS[item.icon] ?? 'toolbox'} />
      </span>
      <span className="t-text">
        <b>{item.title}</b>
        {item.description && <span>{item.description}</span>}
      </span>
      {badge ? <span className="tag-soon">{badge}</span> : null}
    </button>
  )
}

export function ToolboxZonePage() {
  const navigate = useNavigate()
  const config = useToolboxConfig()
  const [qrItem, setQrItem] = useState<KioskToolboxItem | null>(null)
  const [externalItem, setExternalItem] = useState<KioskToolboxItem | null>(null)
  const items = config.enabled ? [...(config.items ?? [])].sort((a, b) => a.sortOrder - b.sortOrder) : []

  return (
    <div className="fusion-w5 fusion-w5--system kpv1 ktoolbox" data-kiosk-screen="toolbox">
      <div className="pagehead">
        <button type="button" className="back-btn" onClick={() => navigate('/')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}>
            <path d="M15 6l-6 6 6 6" />
          </svg>
          返回
        </button>
        <div className="titles">
          <h1>百宝箱</h1>
          <p>本机已配置的扩展服务，经审核后上架</p>
        </div>
      </div>

      <main className="tb-content">
        {items.length > 0 ? (
          <div className="tiles c3">
            {items.map((item) => (
              <ToolboxItemTile key={item.key} item={item} onQr={setQrItem} onExternal={setExternalItem} />
            ))}
          </div>
        ) : (
          <div className="tb-empty">
            <ProtoIcon name="zone-toolbox" />
            <b>待配置</b>
            <span>后续功能上线后将在这里展示。</span>
          </div>
        )}
        <div className="notice">
          <ProtoIcon name="info" />
          扩展服务由运营方审核后上架；进入第三方服务前会有明确提示，本终端不记录你在第三方页面的办理结果。
        </div>
      </main>

      <QrLaunchModal item={qrItem} placement="toolbox" onClose={() => setQrItem(null)} />
      <ExternalLaunchModal item={externalItem} placement="toolbox" onClose={() => setExternalItem(null)} />
    </div>
  )
}

export default ToolboxZonePage
