// 百宝箱区页（/toolbox）
//
// 由来：01-home.html 原型把「百宝箱」画成首页聚合 zone-card（单卡入口），
// 生产的可启动 items + 启动弹窗 + 匿名事件上报能力需要承载页。原型无此屏，
// 本页为能力承载区页（同 60/61 系统屏性质），以 prototype-v1 壳呈现。
// 首页 zone-card 点击 → /toolbox；能力（config 驱动 / 站内·外部H5·二维码启动 /
// 离场确认 / sendBeacon 事件）由本页保留，零削减。
import type { KioskToolboxItem } from '@ai-job-print/shared'
import { InfoIcon } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { QxTouchBand } from '../../components/qingxu/touch/QxTouchBand'
import { QxTouchDock } from '../../components/qingxu/touch/QxTouchDock'
import { QxTouchIcon } from '../../components/qingxu/touch/QxTouchIcon'
import { QxTouchScreen } from '../../components/qingxu/touch/QxTouchScreen'
import { useToolboxCapabilitySnapshot } from '../../auth/KioskCapabilityGuard'
import { isLaunchableKioskAppItem } from '../../services/api/kioskCapabilityValidation'
import { itemBadge, launchKioskAppItem } from '../home/components/kioskAppLaunch'
import { ExternalLaunchModal, QrLaunchModal } from '../home/components/ToolboxLaunchModals'
import './toolbox-zone.css'

function goLabel(item: KioskToolboxItem) {
  if (item.launchMode === 'qr_code' || item.launchMode === 'mini_program_qr') return '扫码获取'
  if (item.launchMode === 'external_url') return '打开(离场提示)'
  return '进入服务'
}

function launchTag(item: KioskToolboxItem) {
  const badge = itemBadge(item)
  if (badge === '即将上线' || badge === '外部应用' || badge === '扫码') return badge
  if (badge === '小程序') return '扫码'
  return '站内'
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
  const disabled = !isLaunchableKioskAppItem(item)
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => !disabled && launchKioskAppItem(item, navigate, onQr, onExternal)}
      className="tb-tile"
      title={item.description}
    >
      <span className="tb-copy">
        <b>{item.title}</b>
        {item.description ? <span>{item.description}</span> : null}
      </span>
      <span className="tb-meta">
        <span className="tb-tag">{launchTag(item)}</span>
        {!disabled ? <span className="tb-go">{goLabel(item)}</span> : null}
      </span>
    </button>
  )
}

export function ToolboxZonePage() {
  const navigate = useNavigate()
  const { config } = useToolboxCapabilitySnapshot()
  const [qrItem, setQrItem] = useState<KioskToolboxItem | null>(null)
  const [externalItem, setExternalItem] = useState<KioskToolboxItem | null>(null)
  const items = config.enabled ? [...(config.items ?? [])].sort((a, b) => a.sortOrder - b.sortOrder) : []

  const launchOpen = Boolean(qrItem || externalItem)

  return (
    <div data-qx-page="toolbox">
    <QxTouchScreen
      testId="toolbox-touch"
      stateId={items.length > 0 ? 'items' : 'empty'}
      bodyClassName="qxt-body-scroll"
      band={(
        <QxTouchBand
          seal={null}
          eyebrow="百宝箱"
          title={items.length > 0 ? '选一个已上架的服务' : '还没有上架的服务'}
          sub={items.length > 0 ? '经审核后才出现在这里。' : '上架之后会出现在这里。'}
          back={false}
          status={{ text: items.length > 0 ? '按本机配置' : '待配置', tone: 'unknown' }}
        />
      )}
      dock={(
        <QxTouchDock
          onBack={() => navigate('/')}
          backLabel="返回首页"
          ask={{
            label: items.length ? '问小青：外链和扫码有什么不同？' : '问小青：这里为什么是空的？',
            draft: items.length ? '外链和扫码有什么不同？请只说明怎么打开，不要替我办理。' : '这里为什么是空的？请说明可能的原因，不要假称已查询配置。',
          }}
        />
      )}
      overlay={launchOpen ? (
        <>
          <QrLaunchModal item={qrItem} placement="toolbox" onClose={() => setQrItem(null)} />
          <ExternalLaunchModal item={externalItem} placement="toolbox" onClose={() => setExternalItem(null)} />
        </>
      ) : undefined}
    >
      <section data-kiosk-screen="toolbox" className="tb-content">
        {config.enabled && items.length > 0 ? (
          <>
            <div className="tb-hero">
              <span className="tb-hero-v" aria-hidden="true">
                <QxTouchIcon name="layers" size={96} strokeWidth={1.5} />
              </span>
              <div className="tb-hero-t">
                <b>本机已上架的扩展服务</b>
                <p>站内服务直接进入。扫码的用手机继续。外部入口会先请你确认再离开。</p>
              </div>
            </div>
            <div className="tb-tiles">
              {items.map((item) => (
                <ToolboxItemTile key={item.key} item={item} onQr={setQrItem} onExternal={setExternalItem} />
              ))}
            </div>
          </>
        ) : (
          <div className="tb-empty">
            <b>待配置</b>
            <span>后续功能上线后将在这里展示。</span>
          </div>
        )}
        <div className="tb-notice">
          <InfoIcon className="tb-notice-icon" aria-hidden="true" />
          <span>扩展服务由运营方审核后上架；进入第三方服务前会有明确提示，本终端不记录你在第三方页面的办理结果。</span>
        </div>
      </section>
    </QxTouchScreen>
    </div>
  )
}

export default ToolboxZonePage
