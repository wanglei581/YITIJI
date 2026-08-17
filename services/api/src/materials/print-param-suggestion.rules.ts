// ============================================================
// S3-1 · P06 打印参数预填 —— 推导规则（纯函数，无 IO、无 DB、无模型调用）
//
// 为什么是确定性规则而不是模型：
//   矩阵 §5.2 D5 的倾向结论 —— 「确定性规则 + 标 E1，不标 E3」，更稳、更便宜、
//   更可解释，且**不受 AI 可用性影响**。这与 CLAUDE.md §9「不伪造能力」一致：
//   页数是数出来的，不是猜出来的，所以它不该披上 AI 判断的外衣。
//
// 能力边界怎么保证不漂移：
//   本文件**不写死**「当前只允许黑白/单面/1页」，而是拿候选值去问生产环境真正的
//   门禁 assertVerifiedPrintParameters()。门禁放开哪一项，建议就自动跟着放开哪一项；
//   门禁收紧了，建议也立刻跟着收紧。杜绝「建议了一个建单会被 400 拒掉的值」。
//
//   2026-08-18 起门禁分成两层：第 1 层是全局产品边界（本文件探测的就是它），
//   第 2 层是**按终端**的彩色/双面能力登记。只过第 1 层的取值在未验证的机器上
//   仍会被拒，所以 readCapabilityProfile 必须再与终端放行集求交集 ——
//   参数 terminalAllows **默认全 false**（fail-closed）：没有终端上下文时
//   一律按「没验过」处理，宁可少建议，也不建议一个会被 403 拒掉的值。
// ============================================================

import { assertVerifiedPrintParameters } from '../print-jobs/verified-print-parameters'
import type {
  InspectionFacts,
  PrintCapabilityProfile,
  PrintParamNotice,
  PrintParamSuggestionItem,
} from './print-param-suggestion.types'

/** 当前门禁下恒定安全的三元组；也是所有探测的基线。 */
const SAFE_BASELINE = {
  colorMode: 'black_white',
  duplex: 'simplex',
  pagesPerSheet: 1,
} as const

/** copies 取值范围与 PrintJobParamsDto 的 @Min(1) @Max(99) 对齐。 */
const COPIES_RANGE = { min: 1, max: 99 } as const

const CANDIDATE_COLOR_MODES = ['black_white', 'color'] as const
const CANDIDATE_DUPLEX_MODES = ['simplex', 'duplex_long_edge', 'duplex_short_edge'] as const
const CANDIDATE_PAGES_PER_SHEET = [1, 2, 4] as const

/**
 * 拿候选值去问生产门禁：这个取值现在能不能建单？
 * 单字段探测（其余两项保持安全基线），因此结果就是该字段自身的放行状态。
 */
function isAccepted(patch: { colorMode?: string; duplex?: string; pagesPerSheet?: number }): boolean {
  try {
    assertVerifiedPrintParameters({ ...SAFE_BASELINE, ...patch })
    return true
  } catch {
    return false
  }
}

/**
 * 终端侧放行集。默认全 false = fail-closed：调用方没给终端上下文时，
 * 彩色/双面一律当作「本机未验证」，不进建议集合。
 */
export interface TerminalPrintAllows {
  color?: boolean
  duplex?: boolean
}

/** 由门禁探测出当前真实放行集合，不写死常量。 */
export function readCapabilityProfile(terminalAllows: TerminalPrintAllows = {}): PrintCapabilityProfile {
  const colorAllowed = terminalAllows.color === true
  const duplexAllowed = terminalAllows.duplex === true

  const verifiedColorModes = CANDIDATE_COLOR_MODES.filter(
    (value) => isAccepted({ colorMode: value }) && (value === 'black_white' || colorAllowed),
  )
  const verifiedDuplexModes = CANDIDATE_DUPLEX_MODES.filter(
    (value) => isAccepted({ duplex: value }) && (value === 'simplex' || duplexAllowed),
  )

  return {
    paperSize: 'A4',
    verifiedColorModes,
    verifiedDuplexModes,
    verifiedPagesPerSheet: CANDIDATE_PAGES_PER_SHEET.filter((value) => isAccepted({ pagesPerSheet: value })),
    copiesRange: { ...COPIES_RANGE },
    note:
      '奔图 CM2800/CM2820 系列仅支持 A4，不支持 A3。多页合一须完成厂家确认后开放；' +
      '彩色与自动双面只在管理员已为该终端登记并验收后才会出现在已验证取值里。',
  }
}

/**
 * 从 inspection 任务的 result 解析实测事实。
 * 读不出 checks 结构时返回 null —— 宁可整体报不可用，也不拿空对象继续推导。
 */
export function readInspectionFacts(result: Record<string, unknown> | null): InspectionFacts | null {
  if (!result || typeof result !== 'object') return null
  if (result['mode'] !== 'basic_inspection') return null
  const checks = result['checks']
  if (!checks || typeof checks !== 'object') return null
  const c = checks as Record<string, unknown>

  const pageCount = typeof c['pageCount'] === 'number' && Number.isFinite(c['pageCount'])
    ? (c['pageCount'] as number)
    : null

  return {
    pageCount,
    pageCountSource: typeof c['pageCountSource'] === 'string' ? c['pageCountSource'] : null,
    canPrint: c['canPrint'] === true,
    mimeType: typeof c['mimeType'] === 'string' ? c['mimeType'] : null,
    sizeBytes: typeof c['sizeBytes'] === 'number' ? (c['sizeBytes'] as number) : null,
    imageQuality: readImageQuality(c['imageQuality']),
    warnings: Array.isArray(c['warnings']) ? c['warnings'].filter((w): w is string => typeof w === 'string') : [],
    messages: readMessages(c['messages']),
  }
}

function readImageQuality(value: unknown): InspectionFacts['imageQuality'] {
  if (!value || typeof value !== 'object') return null
  const q = value as Record<string, unknown>
  if (typeof q['widthPx'] !== 'number' || typeof q['heightPx'] !== 'number') return null
  return {
    widthPx: q['widthPx'],
    heightPx: q['heightPx'],
    estimatedDpiForA4: typeof q['estimatedDpiForA4'] === 'number' ? q['estimatedDpiForA4'] : 0,
    minRecommendedDpi: typeof q['minRecommendedDpi'] === 'number' ? q['minRecommendedDpi'] : 0,
    quality: typeof q['quality'] === 'string' ? q['quality'] : 'unknown',
  }
}

function readMessages(value: unknown): PrintParamNotice[] {
  if (!Array.isArray(value)) return []
  const notices: PrintParamNotice[] = []
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue
    const m = entry as Record<string, unknown>
    if (typeof m['code'] !== 'string' || typeof m['text'] !== 'string') continue
    notices.push({
      code: m['code'],
      severity: m['severity'] === 'warning' ? 'warning' : 'info',
      text: m['text'],
    })
  }
  return notices
}

/** 只透出 warning 级体检提示，逐字原文，不改写、不新造。 */
export function selectNotices(facts: InspectionFacts): PrintParamNotice[] {
  return facts.messages.filter((message) => message.severity === 'warning')
}

// ── 四项推导 ────────────────────────────────────────────────────────────────

/**
 * 份数：体检只能读出文件本身的属性，读不出用户要打几份。
 * 这里**恒为 not_derivable** —— 返回一个「1 份」冒充建议就是瞎猜，不做。
 * 若将来要预填份数，依据只能来自用户自己的历史订单或明确用途输入，不是体检。
 */
function deriveCopies(): PrintParamSuggestionItem {
  return {
    field: 'copies',
    label: '份数',
    status: 'not_derivable',
    suggestedValue: null,
    basis: null,
    reason: {
      code: 'COPIES_NOT_DERIVABLE_FROM_INSPECTION',
      text: '份数取决于你要用几份，文件体检读不出来，这一项需要你自己设。',
    },
    blockedPreference: null,
    editable: true,
  }
}

/**
 * 黑白/彩色：**体检当前不做色彩检测**（inspection 只算页数、像素尺寸与空白页）。
 * 因此内容侧没有任何色彩依据。
 *   - 门禁只放行黑白时：值唯一，按 E2 系统事实预填，并说明彩色为何不可选。
 *   - 门禁放开彩色后：内容侧仍无依据 → 诚实返回 not_derivable，而不是随手给一个。
 * 要让这一项变成 E1 内容依据，前置条件是 inspection 增加真实色彩检测。
 */
function deriveColorMode(profile: PrintCapabilityProfile): PrintParamSuggestionItem {
  const colorAllowed = profile.verifiedColorModes.includes('color')
  if (!colorAllowed) {
    return {
      field: 'colorMode',
      label: '黑白 / 彩色',
      status: 'suggested',
      suggestedValue: SAFE_BASELINE.colorMode,
      basis: {
        code: 'COLOR_MODE_LOCKED_TO_VERIFIED_BW',
        evidenceLevel: 'E2',
        text: '当前只验证过黑白输出，彩色须完成厂家确认与 Windows 真机验收后才会开放，所以这一项只有黑白可选。',
        facts: {
          verifiedColorModes: profile.verifiedColorModes,
          colorContentAnalyzed: false,
        },
      },
      reason: null,
      blockedPreference: null,
      editable: true,
    }
  }
  return {
    field: 'colorMode',
    label: '黑白 / 彩色',
    status: 'not_derivable',
    suggestedValue: null,
    basis: null,
    reason: {
      code: 'COLOR_CONTENT_NOT_ANALYZED',
      text: '文件体检没有做色彩检测，判断不出该用彩色还是黑白，这一项需要你自己设。',
    },
    blockedPreference: null,
    editable: true,
  }
}

/**
 * 单/双面：唯一一项有真实内容依据的参数 —— 页数是体检数出来的。
 *   1 页            → 单面（E1，内容依据）
 *   ≥2 页           → 内容侧偏好双面（省纸）；门禁未放行时压回单面并登记 blockedPreference
 *   页数未识别       → 门禁只允许单面时按 E2 预填；门禁放开后诚实返回 not_derivable
 */
function deriveDuplex(facts: InspectionFacts, profile: PrintCapabilityProfile): PrintParamSuggestionItem {
  const duplexAllowed = profile.verifiedDuplexModes.includes('duplex_long_edge')
  const pageFacts = { pageCount: facts.pageCount, pageCountSource: facts.pageCountSource }

  if (facts.pageCount === 1) {
    return {
      field: 'duplex',
      label: '单面 / 双面',
      status: 'suggested',
      suggestedValue: 'simplex',
      basis: {
        code: 'SINGLE_PAGE_SIMPLEX',
        evidenceLevel: 'E1',
        text: '文件体检识别到这份文件只有 1 页，单面打印即可。',
        facts: pageFacts,
      },
      reason: null,
      blockedPreference: null,
      editable: true,
    }
  }

  if (typeof facts.pageCount === 'number' && facts.pageCount >= 2) {
    if (duplexAllowed) {
      return {
        field: 'duplex',
        label: '单面 / 双面',
        status: 'suggested',
        suggestedValue: 'duplex_long_edge',
        basis: {
          code: 'MULTI_PAGE_DUPLEX_SAVES_PAPER',
          evidenceLevel: 'E1',
          text: `文件体检识别到 ${facts.pageCount} 页，双面打印可以少用一半纸。`,
          facts: pageFacts,
        },
        reason: null,
        blockedPreference: null,
        editable: true,
      }
    }
    return {
      field: 'duplex',
      label: '单面 / 双面',
      status: 'suggested',
      suggestedValue: 'simplex',
      basis: {
        code: 'DUPLEX_LOCKED_TO_VERIFIED_SIMPLEX',
        evidenceLevel: 'E2',
        text: `文件体检识别到 ${facts.pageCount} 页，双面本可省纸；但自动双面尚未完成真机验收，当前只能单面。`,
        facts: { ...pageFacts, verifiedDuplexModes: profile.verifiedDuplexModes },
      },
      reason: null,
      blockedPreference: {
        value: 'duplex_long_edge',
        code: 'PRINT_DUPLEX_NOT_VERIFIED',
        text: '自动双面须完成厂家确认及 Windows 真机验收后才能开放。',
      },
      editable: true,
    }
  }

  // 页数未识别
  if (!duplexAllowed) {
    return {
      field: 'duplex',
      label: '单面 / 双面',
      status: 'suggested',
      suggestedValue: 'simplex',
      basis: {
        code: 'DUPLEX_LOCKED_TO_VERIFIED_SIMPLEX',
        evidenceLevel: 'E2',
        text: '自动双面尚未完成真机验收，当前只有单面可选。',
        facts: { ...pageFacts, verifiedDuplexModes: profile.verifiedDuplexModes },
      },
      reason: null,
      blockedPreference: null,
      editable: true,
    }
  }
  return {
    field: 'duplex',
    label: '单面 / 双面',
    status: 'not_derivable',
    suggestedValue: null,
    basis: null,
    reason: {
      code: 'PAGE_COUNT_UNKNOWN',
      text: '文件体检没能识别出页数，判断不出单面还是双面更合适，这一项需要你自己设。',
    },
    blockedPreference: null,
    editable: true,
  }
}

/**
 * 每页张数（N-up）：
 *   1 页            → 只有 1 页，没有可合并的内容（E1）
 *   门禁未放行 N-up  → 值唯一，按 E2 预填并说明原因
 *   门禁放行后       → 求职材料以可读性优先，默认保持每张 1 页（E2 规则依据），用户可自己改
 */
function derivePagesPerSheet(facts: InspectionFacts, profile: PrintCapabilityProfile): PrintParamSuggestionItem {
  const nupAllowed = profile.verifiedPagesPerSheet.some((value) => value > 1)

  if (facts.pageCount === 1) {
    return {
      field: 'pagesPerSheet',
      label: '每页张数',
      status: 'suggested',
      suggestedValue: 1,
      basis: {
        code: 'SINGLE_PAGE_NO_NUP',
        evidenceLevel: 'E1',
        text: '这份文件只有 1 页，没有可以合并到同一张纸上的内容。',
        facts: { pageCount: facts.pageCount, pageCountSource: facts.pageCountSource },
      },
      reason: null,
      blockedPreference: null,
      editable: true,
    }
  }

  if (!nupAllowed) {
    return {
      field: 'pagesPerSheet',
      label: '每页张数',
      status: 'suggested',
      suggestedValue: 1,
      basis: {
        code: 'PAGES_PER_SHEET_LOCKED_TO_VERIFIED_1',
        evidenceLevel: 'E2',
        text: '多页合一尚未完成真机验收，当前只能每张 1 页。',
        facts: { verifiedPagesPerSheet: profile.verifiedPagesPerSheet },
      },
      reason: null,
      blockedPreference: null,
      editable: true,
    }
  }

  return {
    field: 'pagesPerSheet',
    label: '每页张数',
    status: 'suggested',
    suggestedValue: 1,
    basis: {
      code: 'NUP_DEFAULT_KEEP_READABLE',
      evidenceLevel: 'E2',
      text: '求职材料多页合一会明显缩小字号，默认保持每张 1 页；需要省纸可以自己改。',
      facts: { pageCount: facts.pageCount, verifiedPagesPerSheet: profile.verifiedPagesPerSheet },
    },
    reason: null,
    blockedPreference: null,
    editable: true,
  }
}

/**
 * 四项推导入口。返回顺序固定，前端可直接按序渲染。
 *
 * 出口自检：任何 status='suggested' 的取值组合都必须能通过生产门禁；不通过就是
 * 规则写错了，宁可整体不可用也不能把一个建单会被拒的值发给用户。
 */
export function derivePrintParamSuggestions(
  facts: InspectionFacts,
  profile: PrintCapabilityProfile,
): PrintParamSuggestionItem[] {
  const items = [
    deriveCopies(),
    deriveColorMode(profile),
    deriveDuplex(facts, profile),
    derivePagesPerSheet(facts, profile),
  ]
  assertSuggestionsWithinCapability(items)
  return items
}

/** 出口自检：把建议出来的三项能力敏感参数原样交给生产门禁复核。 */
export function assertSuggestionsWithinCapability(items: PrintParamSuggestionItem[]): void {
  const pick = (field: string): string | number | null =>
    items.find((item) => item.field === field && item.status === 'suggested')?.suggestedValue ?? null
  const colorMode = pick('colorMode')
  const duplex = pick('duplex')
  const pagesPerSheet = pick('pagesPerSheet')
  assertVerifiedPrintParameters({
    colorMode: typeof colorMode === 'string' ? colorMode : SAFE_BASELINE.colorMode,
    duplex: typeof duplex === 'string' ? duplex : SAFE_BASELINE.duplex,
    pagesPerSheet: typeof pagesPerSheet === 'number' ? pagesPerSheet : SAFE_BASELINE.pagesPerSheet,
  })
}
