export const TOOLBOX_MICRO_APP_ENTRY_TYPES = [
  'internal_route',
  'web_app',
  'qr_code',
  'mini_program_qr',
  'ai_skill',
] as const

export type ToolboxMicroAppEntryType = (typeof TOOLBOX_MICRO_APP_ENTRY_TYPES)[number]

export const TOOLBOX_MICRO_APP_CATEGORIES = [
  'print',
  'exam',
  'career',
  'legal',
  'hr',
  'campus',
  'life',
] as const

export type ToolboxMicroAppCategory = (typeof TOOLBOX_MICRO_APP_CATEGORIES)[number]

export const TOOLBOX_MICRO_APP_PERMISSIONS = [
  'ai_chat',
  'file_upload',
  'print_report',
  'external_open',
  'qr_display',
  'session_only_storage',
  'member_asset_write',
  'legal_disclaimer',
  'copyright_notice',
  'salary_advice',
  'exam_practice',
] as const

export type ToolboxMicroAppPermission = (typeof TOOLBOX_MICRO_APP_PERMISSIONS)[number]

export type ToolboxMicroAppRiskLevel = 'low' | 'medium' | 'high' | 'restricted'

export type ToolboxMicroAppStatus =
  | 'planned'
  | 'draft'
  | 'submitted'
  | 'approved'
  | 'published'
  | 'rejected'
  | 'suspended'
  | 'archived'

export type ToolboxMicroAppPriority = 'high' | 'medium' | 'low'

export interface ToolboxMicroAppDataPolicy {
  retention: 'none' | 'session_only' | 'member_asset'
  thirdPartyDataSharing: 'none' | 'user_phone_qr' | 'external_site'
  sensitiveDataAllowed: boolean
  requiresExplicitConsent: boolean
}

export interface ToolboxMicroAppLaunchPolicy {
  entryType: ToolboxMicroAppEntryType
  internalRoute?: string
  externalUrl?: string
  qrTargetUrl?: string
  assistantIntent?: string
  requiresHostAllowlist: boolean
  requiresHumanReview: boolean
  productionEnabledByDefault: boolean
}

export interface ToolboxMicroAppDefinition {
  id: string
  title: string
  shortDescription: string
  category: ToolboxMicroAppCategory
  priority: ToolboxMicroAppPriority
  status: ToolboxMicroAppStatus
  riskLevel: ToolboxMicroAppRiskLevel
  permissions: ToolboxMicroAppPermission[]
  launch: ToolboxMicroAppLaunchPolicy
  dataPolicy: ToolboxMicroAppDataPolicy
  disclaimers: string[]
  commercialValue: string
  acceptanceGates: string[]
}

export const BUILTIN_TOOLBOX_MICRO_APPS = [
  {
    id: 'offer-compare',
    title: 'Offer 对比',
    shortDescription: '帮助求职者对比薪资、福利、地点、发展机会和风险项。',
    category: 'career',
    priority: 'high',
    status: 'planned',
    riskLevel: 'medium',
    permissions: ['ai_chat', 'session_only_storage', 'salary_advice'],
    launch: {
      entryType: 'ai_skill',
      internalRoute: '/assistant?intent=offer_compare',
      assistantIntent: 'offer_compare',
      requiresHostAllowlist: false,
      requiresHumanReview: true,
      productionEnabledByDefault: false,
    },
    dataPolicy: {
      retention: 'session_only',
      thirdPartyDataSharing: 'none',
      sensitiveDataAllowed: false,
      requiresExplicitConsent: true,
    },
    disclaimers: ['对比结果仅供个人决策参考，不构成入职、涨薪或录用承诺。'],
    commercialValue: '提升求职决策效率，适合校园、招聘会和公共就业服务大厅。',
    acceptanceGates: ['首方 AI 通道', '不回传企业', '不生成企业侧 Offer 管理记录'],
  },
  {
    id: 'salary-negotiation',
    title: '薪资谈判话术',
    shortDescription: '按岗位、城市和经验生成薪资沟通话术与模拟练习。',
    category: 'career',
    priority: 'high',
    status: 'planned',
    riskLevel: 'low',
    permissions: ['ai_chat', 'session_only_storage', 'salary_advice'],
    launch: {
      entryType: 'ai_skill',
      internalRoute: '/assistant?intent=salary_negotiation',
      assistantIntent: 'salary_negotiation',
      requiresHostAllowlist: false,
      requiresHumanReview: true,
      productionEnabledByDefault: false,
    },
    dataPolicy: {
      retention: 'session_only',
      thirdPartyDataSharing: 'none',
      sensitiveDataAllowed: false,
      requiresExplicitConsent: false,
    },
    disclaimers: ['生成话术仅用于模拟练习，实际沟通效果取决于具体岗位和沟通场景。'],
    commercialValue: '低成本提高用户停留和复用率，适合做首批 AI 技能。',
    acceptanceGates: ['提示词防越界', '禁止保证涨薪或保证录用', '不保存谈判原文'],
  },
  {
    id: 'hr-qa',
    title: 'HR 知识问答',
    shortDescription: '回答入职、社保、公积金、试用期、离职等通用 HR 问题。',
    category: 'hr',
    priority: 'high',
    status: 'planned',
    riskLevel: 'medium',
    permissions: ['ai_chat', 'session_only_storage', 'legal_disclaimer'],
    launch: {
      entryType: 'ai_skill',
      internalRoute: '/assistant?intent=hr_qa',
      assistantIntent: 'hr_qa',
      requiresHostAllowlist: false,
      requiresHumanReview: true,
      productionEnabledByDefault: false,
    },
    dataPolicy: {
      retention: 'session_only',
      thirdPartyDataSharing: 'none',
      sensitiveDataAllowed: false,
      requiresExplicitConsent: false,
    },
    disclaimers: ['回答基于公开劳动与 HR 常识，仅供参考，具体以当地政策和官方口径为准。'],
    commercialValue: '分流线下咨询压力，适合作为公共服务场景的常驻能力。',
    acceptanceGates: ['知识边界提示', '不输出个案法律结论', '高风险问题引导咨询官方窗口'],
  },
  {
    id: 'legal-risk-check',
    title: '法律风险审查',
    shortDescription: '对劳动合同、离职纠纷、薪酬争议等问题做初步风险提示。',
    category: 'legal',
    priority: 'medium',
    status: 'planned',
    riskLevel: 'high',
    permissions: ['ai_chat', 'session_only_storage', 'legal_disclaimer'],
    launch: {
      entryType: 'ai_skill',
      internalRoute: '/assistant?intent=legal_risk_check',
      assistantIntent: 'legal_risk_check',
      requiresHostAllowlist: false,
      requiresHumanReview: true,
      productionEnabledByDefault: false,
    },
    dataPolicy: {
      retention: 'session_only',
      thirdPartyDataSharing: 'none',
      sensitiveDataAllowed: false,
      requiresExplicitConsent: true,
    },
    disclaimers: ['仅作风险提示，不构成正式法律意见；重大争议请咨询律师或官方窗口。'],
    commercialValue: '增强求职者风险识别能力，但需先经过法务评审。',
    acceptanceGates: ['法务评审', '首方 AI 通道', '不保存争议细节', '输出风险提示而非法律结论'],
  },
  {
    id: 'contract-review',
    title: '合同审查',
    shortDescription: '识别合同中的试用期、竞业、违约金、薪资和社保等风险条款。',
    category: 'legal',
    priority: 'medium',
    status: 'planned',
    riskLevel: 'restricted',
    permissions: ['ai_chat', 'file_upload', 'session_only_storage', 'legal_disclaimer'],
    launch: {
      entryType: 'ai_skill',
      internalRoute: '/assistant?intent=contract_review',
      assistantIntent: 'contract_review',
      requiresHostAllowlist: false,
      requiresHumanReview: true,
      productionEnabledByDefault: false,
    },
    dataPolicy: {
      retention: 'session_only',
      thirdPartyDataSharing: 'none',
      sensitiveDataAllowed: true,
      requiresExplicitConsent: true,
    },
    disclaimers: ['合同审查仅作条款风险提示，不构成正式法律意见；合同原文不得进入第三方百宝箱应用。'],
    commercialValue: '能形成高价值 AI 服务，但上线前必须完成隐私、法务和文件留存验收。',
    acceptanceGates: ['法务评审', '合同原文会话后即弃', '首方模型通道', '禁止第三方外传', '不在公共屏长期展示合同全文'],
  },
  {
    id: 'exam-paper-print',
    title: '试卷打印',
    shortDescription: '支持用户自带或已授权试卷材料的排版、预览和打印。',
    category: 'print',
    priority: 'low',
    status: 'planned',
    riskLevel: 'high',
    permissions: ['file_upload', 'print_report', 'qr_display', 'copyright_notice'],
    launch: {
      entryType: 'qr_code',
      qrTargetUrl: 'https://example.com/authorized-paper-print',
      requiresHostAllowlist: true,
      requiresHumanReview: true,
      productionEnabledByDefault: false,
    },
    dataPolicy: {
      retention: 'session_only',
      thirdPartyDataSharing: 'user_phone_qr',
      sensitiveDataAllowed: false,
      requiresExplicitConsent: true,
    },
    disclaimers: ['请仅上传本人有权使用或已获授权的试卷材料；平台不提供侵权题库。'],
    commercialValue: '可扩展打印收入，但必须先解决版权、支付和真机出纸闭环。',
    acceptanceGates: ['版权授权口径', '服务端生成二维码', '真实打印链路', '不内置未授权题库'],
  },
  {
    id: 'english-mock-practice',
    title: '英语模拟练习',
    shortDescription: '提供英语听说读写练习入口，优先引导用户在个人手机端完成。',
    category: 'exam',
    priority: 'low',
    status: 'planned',
    riskLevel: 'high',
    permissions: ['exam_practice', 'qr_display', 'external_open'],
    launch: {
      entryType: 'mini_program_qr',
      qrTargetUrl: 'weapp://english-practice-authorized-entry',
      requiresHostAllowlist: false,
      requiresHumanReview: true,
      productionEnabledByDefault: false,
    },
    dataPolicy: {
      retention: 'none',
      thirdPartyDataSharing: 'user_phone_qr',
      sensitiveDataAllowed: false,
      requiresExplicitConsent: true,
    },
    disclaimers: ['练习内容不得暗示官方考试授权；题库、商标和素材必须自有或已获授权。'],
    commercialValue: '适合作为合作方入口，不适合在公共一体机上做重度练习闭环。',
    acceptanceGates: ['商标授权核查', '题库版权核查', '扫码手机端优先', '不占用一体机长时练习'],
  },
] as const satisfies readonly ToolboxMicroAppDefinition[]

export type BuiltinToolboxMicroAppId = (typeof BUILTIN_TOOLBOX_MICRO_APPS)[number]['id']

export const TOOLBOX_MICRO_APP_FORBIDDEN_CAPABILITIES = [
  'platform_resume_delivery',
  'employer_receives_resume',
  'candidate_screening',
  'interview_invitation',
  'offer_management',
  'candidate_recommendation_to_employer',
  'third_party_code_execution',
  'third_party_device_bridge',
] as const

export type ToolboxMicroAppForbiddenCapability =
  (typeof TOOLBOX_MICRO_APP_FORBIDDEN_CAPABILITIES)[number]
