import type { MiniappEnvVersion } from './miniapp-code.service'

/** 公开展示的机构关联打印终端白名单字段（不含密钥、内部运维状态或非公开字段）。 */
export interface PublicMiniappOrgTerminal {
  id: string
  displayName: string
  locationLabel: string | null
  isOnline: true
}

/**
 * 小程序「一机构一码」公开只读视图（免登录）。
 *
 * 合规与隐私边界：
 * - 只返回机构联名品牌标识与当前在线打印服务点目录；
 * - 不返回岗位、招聘会、企业资料、外部招聘链接、联系人、手机号、邮箱或内部授权详情；
 * - 停用、归档、授权不可用或不存在的机构统一 404 fail-closed。
 */
export interface PublicMiniappOrgEntry {
  orgId: string
  orgName: string
  orgType: string
  brandName: string
  brandMark: string
  brandLogoUrl: string | null
  terminals: PublicMiniappOrgTerminal[]
  terminalSelectionNote: string
}

/** 合作机构后台「本机构专属小程序入口」配置摘要。 */
export interface PartnerMiniappEntryInfo {
  orgId: string
  orgName: string
  brandName: string
  miniappPath: string
  miniappScene: string
  sceneValid: boolean
  miniappCodeAvailable: boolean
  envVersion: MiniappEnvVersion
  onlineTerminalCount: number
  totalTerminalCount: number
}

/** 合作机构后台生成本机构专属无限制小程序码的结果。 */
export interface PartnerMiniappEntryCodeResult {
  orgId: string
  miniappPath: string
  miniappScene: string
  envVersion: MiniappEnvVersion
  mimeType: 'image/jpeg' | 'image/png'
  imageBase64: string
  dataUri: string
}
