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
