// ============================================================
// S3-1 · P06 打印参数预填 —— 契约类型
//
// 红线（写在类型上，接线方不得绕开）：
//   1. 这里的一切都是**建议**，不是决定。服务端建单（print-jobs.service）与报价
//      （order-quote.service）**绝不读取本模块**，用户不确认就没有任何参数生效。
//   2. 建议值只能落在 assertVerifiedPrintParameters 允许的范围内。内容侧想要但
//      能力边界不允许的取值，如实登记在 blockedPreference，**不进 suggestedValue**。
//   3. 推不出来就说推不出来（not_derivable），不返回瞎猜的默认值冒充建议。
// ============================================================

/** 本能力在 AI_MODEL_FEATURES 里的独立功能位（不复用 resume_optimize）。 */
export const PRINT_PARAM_PREFILL_FEATURE_KEY = 'print_param_prefill' as const

/** 可预填的四项（与 PrintJobParamsDto 同名字段一一对应）。 */
export type PrintParamField = 'copies' | 'colorMode' | 'duplex' | 'pagesPerSheet'

/**
 * suggested     = 有真实依据，可直接预填（依据见 basis）
 * not_derivable = 依据本身不存在（体检读不出该维度），预填留空由用户自己设
 */
export type PrintParamSuggestionStatus = 'suggested' | 'not_derivable'

/**
 * E1 = 用户材料事实（体检实测：页数、像素、格式）
 * E2 = 系统事实（已验证打印能力边界、硬件幅面）
 * 确定性逻辑不标 E3 —— 本能力全程不调模型，因此不会出现 E3。
 */
export type PrintParamEvidenceLevel = 'E1' | 'E2'

export interface PrintParamSuggestionBasis {
  /** 稳定机读码，前端据此做文案与埋点，不要解析 text。 */
  code: string
  evidenceLevel: PrintParamEvidenceLevel
  /** 面向用户的一句话依据（「为什么这么建议」）。 */
  text: string
  /** 支撑该依据的实测字段快照，供前端展开细节。 */
  facts: Record<string, unknown>
}

export interface PrintParamSuggestionReason {
  code: string
  text: string
}

/** 内容侧想要、但当前已验证能力边界不允许的取值。能力开放后即可直接采纳。 */
export interface PrintParamBlockedPreference {
  value: string | number
  code: string
  text: string
}

export interface PrintParamSuggestionItem {
  field: PrintParamField
  label: string
  status: PrintParamSuggestionStatus
  /** status='suggested' 时为建议预填值；status='not_derivable' 时为 null。 */
  suggestedValue: string | number | null
  basis: PrintParamSuggestionBasis | null
  reason: PrintParamSuggestionReason | null
  blockedPreference: PrintParamBlockedPreference | null
  /** 恒为 true：四项全部可改，改动不需要额外确认步骤。 */
  editable: true
}

/** 体检原样透出的提示，逐字来自 inspection.messages，不改写、不新造。 */
export interface PrintParamNotice {
  code: string
  severity: 'info' | 'warning'
  text: string
}

/** 当前服务端实际放行的取值集合，由 assertVerifiedPrintParameters 探测得出，不写死。 */
export interface PrintCapabilityProfile {
  /** CM2800ADN / CM2820ADN 系列只有 A4，不支持 A3。 */
  paperSize: 'A4'
  verifiedColorModes: string[]
  verifiedDuplexModes: string[]
  verifiedPagesPerSheet: number[]
  copiesRange: { min: number; max: number }
  note: string
}

/** 推导所依赖的体检实测事实（全部来自 inspection.result.checks）。 */
export interface InspectionFacts {
  pageCount: number | null
  pageCountSource: string | null
  canPrint: boolean
  mimeType: string | null
  sizeBytes: number | null
  imageQuality: {
    widthPx: number
    heightPx: number
    estimatedDpiForA4: number
    minRecommendedDpi: number
    quality: string
  } | null
  warnings: string[]
  messages: PrintParamNotice[]
}

export interface PrintParamSuggestionView {
  taskId: string
  featureKey: typeof PRINT_PARAM_PREFILL_FEATURE_KEY
  /** 推导方式：确定性规则，不调模型。前端不得把本结果呈现为「AI 生成内容」。 */
  derivation: 'deterministic_rules'
  /** 恒为 true：只建议不裁决，服务端不会拿它建单。 */
  advisory: true
  available: boolean
  /** available=false 时必填；前端据此显示「四项都需要你自己设」。 */
  unavailableReason: PrintParamSuggestionReason | null
  capabilityProfile: PrintCapabilityProfile
  /** available=false 时为空数组。 */
  items: PrintParamSuggestionItem[]
  /** available=false 时为空数组。 */
  notices: PrintParamNotice[]
  /** available=false 时为 null。 */
  evidence: InspectionFacts | null
  disclaimer: string
  generatedAt: string
}
