// ============================================================
// 合作机构类型、场景模板、模块权限
// ============================================================

/**
 * 合作机构种类（描述机构性质，决定可用场景模板和权限范围）
 */
export type PartnerType =
  | 'school_employment_center'   // 高校就业中心
  | 'public_employment_service'  // 公共就业服务机构（人社局/就业服务中心/人才交流中心）
  | 'licensed_hr_agency'         // 持证人力资源服务机构
  | 'fair_organizer'             // 招聘会主办方/承办方
  | 'enterprise_source'          // 企业数据来源方

/**
 * 场景模板（预设模块组合 + 界面风格，按运营场景选择）
 */
export type SceneTemplate =
  | 'school'              // 高校版：面向在校生，侧重 AI简历 + 岗位/招聘会
  | 'public_employment'   // 人社版：面向社会求职者，侧重打印 + 政策 + 公共岗位/招聘会
  | 'licensed_hr_service' // 持证机构版：面向灵活就业/社招，含人力资源服务特性

/**
 * 可启用的前台功能模块
 */
export type EnabledModule =
  | 'resume_service'          // AI简历服务（上传/解析/优化/打印）
  | 'print_scan'              // 打印扫描
  | 'policy_service'          // 政策服务（就业政策、补贴、社保等）
  | 'job_info'                // 岗位信息（外部来源展示）
  | 'job_fair'                // 招聘会（外部来源展示）
  | 'smart_campus'            // 智慧校园（学校终端专属服务）
  | 'ai_interview'            // AI模拟面试
  | 'device_status'           // 设备状态（终端屏显）
  | 'service_statistics'      // 服务统计（管理后台可见）
  | 'external_apply_redirect' // 外部投递/预约跳转（扫码跳转来源平台）

/**
 * 永久禁用模块（无论任何配置均不允许启用）
 * 对应产品合规边界中的招聘闭环禁止项
 */
export const PROHIBITED_MODULES = [
  'in_platform_apply',             // 禁止：平台内一键投递
  'candidate_management',          // 禁止：候选人管理
  'resume_delivery_to_enterprise', // 禁止：简历推送给企业
  'interview_invitation',          // 禁止：企业端面试邀约
  'offer_management',              // 禁止：Offer 管理
] as const

export type ProhibitedModule = typeof PROHIBITED_MODULES[number]

// ============================================================
// 合作机构状态
// ============================================================

export type PartnerCoopStatus = 'active' | 'suspended' | 'pending'

/** 公共就业服务机构行政层级（public_employment_service 专用） */
export type PublicServiceLevel = 'municipal' | 'district' | 'street' | 'village'

// ============================================================
// 场景配置接口
// ============================================================

/**
 * 场景与权限配置（服务端存储并下发到终端，前端只读）
 */
export interface PartnerSceneConfig {
  sceneTemplate: SceneTemplate
  enabledModules: EnabledModule[]

  // public_employment_service 专用字段
  jurisdictionArea?: string          // 辖区范围，如"本市全辖区"
  serviceLevel?: PublicServiceLevel  // 行政服务层级
  govOrgCode?: string                // 政府单位编码

  // licensed_hr_agency 专用字段
  licenseNumber?: string  // 人力资源服务许可证号
  licenseExpiry?: string  // 许可证到期日（ISO date）
}

/**
 * 合作机构完整档案（前端可见部分，不含凭证密钥）
 */
export interface PartnerProfile {
  id: string
  name: string
  partnerType: PartnerType
  sceneConfig: PartnerSceneConfig
  contact: string
  contactPhone: string
  contactEmail?: string
  qualification?: string
  coopStatus: PartnerCoopStatus
  coopSince: string
  boundTerminalIds: string[]
}

// ============================================================
// 各场景模板的默认启用模块（服务端建议值，机构可在此基础上调整）
// ============================================================

export const SCENE_DEFAULT_MODULES: Record<SceneTemplate, EnabledModule[]> = {
  school: [
    'resume_service',
    'print_scan',
    'job_info',
    'job_fair',
    'smart_campus',
    'external_apply_redirect',
    'service_statistics',
  ],
  public_employment: [
    'print_scan',
    'policy_service',
    'job_info',
    'job_fair',
    'external_apply_redirect',
    'device_status',
  ],
  licensed_hr_service: [
    'resume_service',
    'print_scan',
    'job_info',
    'job_fair',
    'external_apply_redirect',
    'service_statistics',
  ],
}

// ============================================================
// 机构类型 → 场景模板（服务端 ORG_TYPE_MATRIX 的只读投影）
//
// ⚠️ 2026-08-11 新增。这不是"建议值"，而是**严格 1:1 的硬约束**：
// 服务端 `admin-orgs.service.ts` 的 ORG_TYPE_MATRIX 为每个机构类型指定了唯一场景模板，
// 组合不符会直接抛 ORG_TYPE_MATRIX_VIOLATION。
//
// 新增本常量的原因：Admin 建机构 UI 此前把场景模板做成自由下拉框，
// 导致 ① 新建默认组合（人社 + 空场景）必被服务端拒绝；
//     ② 编辑时选"未设置"写成 undefined、JSON 省略字段，服务端保留旧值，UI 改不动。
// 两个 bug 同源——**场景本就不该由人选**。
//
// 维护约定：本常量必须与服务端 ORG_TYPE_MATRIX 保持同步。
// 服务端校验是唯一权威，本常量只用于前端自动带出与展示，**不替代服务端校验**。
// null 表示该类型为 source-only（纯内容供给方，不拥有终端场景）。
// ============================================================

export const ORG_TYPE_SCENE_TEMPLATE: Record<PartnerType, SceneTemplate | null> = {
  school_employment_center:  'school',
  public_employment_service: 'public_employment',
  licensed_hr_agency:        'licensed_hr_service',
  fair_organizer:            null,
  enterprise_source:         null,
}

/** 该机构类型是否为 source-only（不拥有终端场景，只供给内容） */
export function isSourceOnlyOrgType(type: PartnerType): boolean {
  return ORG_TYPE_SCENE_TEMPLATE[type] === null
}

// ============================================================
// 展示标签（供前端组件直接使用，避免各端重复定义）
// ============================================================

export const PARTNER_TYPE_LABELS: Record<PartnerType, string> = {
  school_employment_center:  '高校就业中心',
  public_employment_service: '公共就业服务机构',
  licensed_hr_agency:        '持证人力资源机构',
  fair_organizer:            '招聘会主办方',
  enterprise_source:         '企业数据来源',
}

export const SCENE_TEMPLATE_LABELS: Record<SceneTemplate, string> = {
  school:               '高校版',
  public_employment:    '人社版',
  licensed_hr_service:  '持证机构版',
}

export const MODULE_LABELS: Record<EnabledModule, string> = {
  resume_service:          'AI简历服务',
  print_scan:              '打印扫描',
  policy_service:          '政策服务',
  job_info:                '岗位信息',
  job_fair:                '招聘会',
  smart_campus:            '智慧校园',
  ai_interview:            'AI模拟面试',
  device_status:           '设备状态',
  service_statistics:      '服务统计',
  external_apply_redirect: '外部跳转',
}

export const PUBLIC_SERVICE_LEVEL_LABELS: Record<PublicServiceLevel, string> = {
  municipal: '市级',
  district:  '区/县级',
  street:    '街道/乡镇级',
  village:   '村/社区级',
}
