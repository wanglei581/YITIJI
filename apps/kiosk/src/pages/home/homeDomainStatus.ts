/**
 * 首页服务域卡片的「真实能力」投影。
 *
 * 背景（2026-08-19）：`V6HomeView` 此前给两张大卡写死 `disabled={false}`，
 * 六个小卡里也只有 toolbox / campus 有真实判定 —— 而该区块标题当时写着
 * 「绿色入口可办理」。打印机离线时打印域照样是绿的，用户点进去才撞死路。
 *
 * 但**整域置灰同样是错的**：打印域七项能力里，手机扫码上传 / 文件加工 / 签名盖章
 * 不经过打印机，`PrintScanHomePage` 已按 `needsMfp` 逐卡诚实降级；把首页整卡封死
 * 会把这些还能用的功能一起堵掉。因此这里只做两件事：卡面说真话、按叶子精细禁用。
 *
 * 三条纪律：
 * 1. `loading` 时只说「正在确认」。把一次未完成的请求当结论，和写死 `disabled={false}`
 *    是同一种伪造，只是方向相反。
 * 2. 不整域置灰，只点名**确实**做不了的叶子动作。
 * 3. 文案要说清受影响范围，不写笼统的「服务不可用」。
 */
import type { HomeV6ActionId } from './homeV6Domains'

export interface HomeDomainStatus {
  /** 卡面如实说明；域完全可用时为 undefined。 */
  note?: string
  /** 域内确实做不了的叶子动作。 */
  unavailableActions?: ReadonlySet<HomeV6ActionId>
}

/**
 * 打印域。信号取自 `TerminalDeviceStatusView`（后端 printer-status 轮询，未知态 fail-closed）。
 * 「纸质扫描」用的是同一台一体机，出不了纸就扫不了；上传与文件加工不受影响。
 */
export function printDomainStatus(input: {
  deviceLoading: boolean
  deviceReady: boolean
  deviceLabel: string
}): HomeDomainStatus {
  if (input.deviceLoading) return { note: '正在确认打印机状态' }
  if (input.deviceReady) return {}
  return {
    note: `${input.deviceLabel} · 上传与文件加工仍可用，出纸与扫描暂停`,
    unavailableActions: new Set<HomeV6ActionId>(['scan-paper']),
  }
}
