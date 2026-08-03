// 百宝箱区页（/toolbox）
//
// 由来：01-home.html 原型把「百宝箱」画成首页聚合 zone-card（单卡入口），
// 生产的可启动 items + 启动弹窗 + 匿名事件上报能力需要承载页。原型无此屏，
// 本页为能力承载区页（同 60/61 系统屏性质），以 prototype-v1 壳呈现。
// 首页 zone-card 点击 → /toolbox；能力（config 驱动 / 站内·外部H5·二维码启动 /
// 离场确认 / sendBeacon 事件）由本页保留，零削减。
import type { KioskToolboxItem } from '@ai-job-print/shared'
import { KioskPageFrame, KioskPageHeader } from '@ai-job-print/ui'
import { ChevronRightIcon } from 'lucide-react'
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

function accentClass(item: KioskToolboxItem) {
  if (item.launchMode === 'external_url') return 'a-teal'
  if (item.launchMode === 'qr_code' || item.launchMode === 'mini_program_qr') return 'a-wheat'
  return 'a-plum'
}

function goLabel(item: KioskToolboxItem) {
  if (item.launchMode === 'qr_code' || item.launchMode === 'mini_program_qr') return '扫码获取'
  if (item.launchMode === 'external_url') return '打开(离场提示)'
  return '进入服务'
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
      className={`tb-tile accented ${accentClass(item)}${disabled ? ' disabled' : ''}`}
      title={item.description}
    >
      {badge ? <span className="launch-tag">{badge}</span> : null}
      <div className="c-top">
        <span className="c-icon">
          <KIcon name={TOOLBOX_ICONS[item.icon] ?? 'toolbox'} />
        </span>
        <div><h3>{item.title}</h3></div>
      </div>
      {item.description ? <p>{item.description}</p> : null}
      {!disabled && (
        <span className="c-go">
          {goLabel(item)}
          <ChevronRightIcon aria-hidden="true" />
        </span>
      )}
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
    <KioskPageFrame
      className="fusion-w5 fusion-w5--system kpv1 ktoolbox"
      header={
        <KioskPageHeader
          title="百宝箱"
          description="本机已配置的扩展服务，经审核后上架"
          onBack={() => navigate('/')}
          backLabel="返回"
        />
      }
    >
      <section data-kiosk-screen="toolbox" className="tb-content">
        {items.length > 0 ? (
          <div className="tb-tiles">
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
      </section>

      <QrLaunchModal item={qrItem} placement="toolbox" onClose={() => setQrItem(null)} />
      <ExternalLaunchModal item={externalItem} placement="toolbox" onClose={() => setExternalItem(null)} />
    </KioskPageFrame>
  )
}

export default ToolboxZonePage
