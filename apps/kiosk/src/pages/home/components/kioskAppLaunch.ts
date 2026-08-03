// Kiosk 扩展应用（KioskAppItem）启动助手 —— 单一真相源。
//
// 由来：这些启动语义原本私有于 ToolboxZonePage，导致「智慧校园」侧无法复用，
// 首页重写时 smart_campus 投放项一度变得无处可启动（回归）。抽到此处后由
// /toolbox 与 /smart-campus 共同消费，两侧启动行为不再各写一份、永不发散。
//
// 能力：站内路由（internal_route）/ 外部 H5（external_url，走离场确认弹窗）/
//       二维码（qr_code · mini_program_qr）。事件上报与离场确认在
//       ToolboxLaunchModals 内，本模块只负责「分发 + 可启动判定 + 徽标」。
import type { KioskToolboxItem } from '@ai-job-print/shared'
import type { useNavigate } from 'react-router-dom'

/** 按 launchMode 分发启动：站内直接 navigate；外链/二维码交给弹窗回调（承载离场确认与上报）。 */
export function launchKioskAppItem(
  item: KioskToolboxItem,
  navigate: ReturnType<typeof useNavigate>,
  onQr: (item: KioskToolboxItem) => void,
  onExternal: (item: KioskToolboxItem) => void,
): void {
  const launchMode = item.launchMode ?? 'internal_route'
  if (launchMode === 'internal_route' && item.to) {
    navigate(item.to)
    return
  }
  if (launchMode === 'external_url' && item.externalUrl) {
    onExternal(item)
    return
  }
  if ((launchMode === 'qr_code' || launchMode === 'mini_program_qr') && item.qrImageUrl) {
    onQr(item)
  }
}

/** 该项当前是否可启动（缺目标 URL/路由则不可启动，前台呈现「即将上线」不可点）。 */
export function itemLaunchable(item: KioskToolboxItem): boolean {
  const launchMode = item.launchMode ?? 'internal_route'
  if (launchMode === 'internal_route') return !!item.to
  if (launchMode === 'external_url') return !!item.externalUrl
  return !!item.qrImageUrl
}

/** 启动方式徽标；不可启动/禁用统一显示「即将上线」。 */
export function itemBadge(item: KioskToolboxItem): string | null {
  if (item.disabled || !itemLaunchable(item)) return '即将上线'
  if (item.launchMode === 'external_url') return '外部应用'
  if (item.launchMode === 'qr_code') return '扫码'
  if (item.launchMode === 'mini_program_qr') return '小程序'
  return null
}
