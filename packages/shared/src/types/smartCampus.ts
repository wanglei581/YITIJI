// ============================================================
// 智慧校园（按终端开关）共享类型
//
// 合规边界（compliance-boundary.md §九、CLAUDE.md §2）：
//   - 智慧校园是"按部署场景变脸"的渠道能力，机器在校内开、校外关。
//   - Kiosk 拉取端点免鉴权，返回体白名单：只含开关与子模块开关，
//     绝不含任何学生统计/个人数据（校园大数据本期冻结，仅留开关位）。
//   - 不碰招聘闭环；不在终端采集任何个人信息。
//
// 安全：updatedBy 等内部字段不进 Kiosk 拉取视图。
// ============================================================

/** 智慧校园子模块键。bigdata（校园大数据）本期冻结，仅保留开关位，前端不渲染真实数据。 */
export type SmartCampusModuleKey = 'welcome' | 'bigdata' | 'luggage' | 'panorama'

/** 子模块开关位。 */
export interface SmartCampusModules {
  /** 迎新系统（只读信息 + 官方外链） */
  welcome: boolean
  /** 校园大数据（本期冻结，需授权 + 合规就绪后才解冻） */
  bigdata: boolean
  /** 行李帮运（第三方信息入口） */
  luggage: boolean
  /** 校园全景（360 全景导览） */
  panorama: boolean
}

/** 默认全关（缺省一律 OFF，与 screensaver 的"失败保留上次"相反）。 */
export const DEFAULT_SMART_CAMPUS_MODULES: SmartCampusModules = {
  welcome: false,
  bigdata: false,
  luggage: false,
  panorama: false,
}

// ── Kiosk 拉取（免鉴权，白名单）──────────────────────────────────

/** Kiosk 拉取的智慧校园配置。enabled=false 时前端整张模块不渲染。 */
export interface KioskSmartCampusConfig {
  enabled: boolean
  modules: SmartCampusModules
}

// ── 管理员后台视图 ──────────────────────────────────────────────

/** 终端智慧校园配置视图（管理员）。 */
export interface TerminalSmartCampusConfigView {
  terminalId: string
  enabled: boolean
  modules: SmartCampusModules
  updatedAt: string | null
}

/** 管理员"终端配置"列表项：终端 + 其智慧校园配置。 */
export interface SmartCampusTerminalView {
  terminalId: string
  terminalCode: string | null
  /** 仅 admin / partner 管理视图可见；Kiosk 拉取不返回。 */
  orgId?: string | null
  /** 仅 admin / partner 管理视图可见。 */
  orgName?: string | null
  isOnline: boolean
  config: TerminalSmartCampusConfigView | null
}

// ── 管理员写操作入参 ────────────────────────────────────────────

export interface SaveSmartCampusConfigInput {
  enabled: boolean
  modules: SmartCampusModules
}
