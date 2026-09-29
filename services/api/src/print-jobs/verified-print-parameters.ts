import { BadRequestException } from '@nestjs/common'

interface CapabilitySensitivePrintParams {
  colorMode?: string
  duplex?: string
  pagesPerSheet?: number
}

const KNOWN_COLOR_MODES = ['black_white', 'color']
const KNOWN_DUPLEX_MODES = ['simplex', 'duplex_long_edge', 'duplex_short_edge']

/** 全局仍未放开的组合：N-up 从未做过厂家确认，也没有产品决策。 */
const VERIFIED_PAGES_PER_SHEET = 1

/**
 * 打印能力门禁 **第 1 层：全局产品边界**（同步，与终端无关）。
 *
 * ⚠️ 本函数**不再单独构成完整门禁**。彩色 / 双面自 2026-08-18 起由产品负责人拍板开放
 * （硬件确为奔图 CM2800/CM2820 彩色激光 + 自动双面），因此这一层放行它们；
 * 「这台机器验过没有」由**第 2 层** `TerminalCapabilitiesService.assertPrintParamsAllowed()`
 * 按终端判定，未登记一律拒绝（见 terminal-capabilities.types.ts 的
 * DEFAULT_DENY_CAPABILITY_KEYS）。
 *
 * 两层各管一件事，不要合并：
 *   第 1 层（本函数）  = 「这个产品到底做不做这件事」 → N-up 不做，恒拒。
 *   第 2 层（能力开关）= 「这台机器验过这件事没有」 → 未验过恒拒，验过才放。
 *
 * **任何计价 / 落库路径都必须同时过两层**。只调本函数就去 quotePrint 是资损级漏洞：
 * 用户会按彩色付费却拿到黑白纸。verify:print-color-duplex-capability 有静态断言
 * 守住「两层都在 quotePrint 之前」，新增建单路径时会失败提醒。
 */
export function assertVerifiedPrintParameters(params?: CapabilitySensitivePrintParams): void {
  const colorMode = params?.colorMode ?? 'black_white'
  const duplex = params?.duplex ?? 'simplex'
  const pagesPerSheet = params?.pagesPerSheet ?? 1

  const known = KNOWN_COLOR_MODES.includes(colorMode) && KNOWN_DUPLEX_MODES.includes(duplex)
  if (known && pagesPerSheet === VERIFIED_PAGES_PER_SHEET) return

  throw new BadRequestException({
    error: {
      code: 'PRINT_PARAMETER_NOT_VERIFIED',
      message: '多页合一（N-up）须完成厂家确认及 Windows 真机验收后开放；彩色与双面需该终端已登记对应能力',
    },
  })
}

/**
 * 一单最多打印的面数。真源在 `packages/shared/src/types/print.ts` 的同名常量；
 * 本行是 CJS 镜像，必须逐字一致。面数 = 计费页数 × 份数，双面不折算。
 * Windows Agent 应引用共享包那一份，不要在 Agent 里再抄。
 */
export const PRINT_MAX_SIDES_PER_ORDER = 100

const PRINT_JOB_TOO_LARGE_MESSAGE = `每单最多打印 ${PRINT_MAX_SIDES_PER_ORDER} 面，请分几单打印`

/** 超过上限才拒绝。页数不是正整数时交给原有的页数 / 范围错误，不改写成这一码。 */
export function assertPrintOrderSides(sides: number): void {
  if (sides > PRINT_MAX_SIDES_PER_ORDER) {
    throw new BadRequestException({
      error: {
        code: 'PRINT_JOB_TOO_LARGE',
        message: PRINT_JOB_TOO_LARGE_MESSAGE,
        details: [String(sides), String(PRINT_MAX_SIDES_PER_ORDER)],
      },
    })
  }
}

/** 无订单行时，从建单写入的打印参数里取份数。读不出就按 1 份，页数本身超限仍会拦住。 */
export function copiesFromPrintParamsJson(raw: string | null | undefined): number {
  if (!raw) return 1
  try {
    const parsed = JSON.parse(raw) as { copies?: unknown }
    const copies = parsed.copies
    if (typeof copies === 'number' && Number.isInteger(copies) && copies > 0) return copies
  } catch {
    return 1
  }
  return 1
}

/**
 * 整单面数。有订单行时按每行「计费页数 × 份数」相加（材料包各行份数相同，口径仍按行乘）；
 * 没有行时用订单上的计费页数 × 参数里的份数。
 */
export function printOrderSideCount(
  items: ReadonlyArray<{ billablePages: number; copies: number }>,
  fallback?: { billablePages: number | null; printParamsJson: string | null },
): number {
  if (items.length > 0) {
    return items.reduce((sum, item) => sum + item.billablePages * item.copies, 0)
  }
  const pages = fallback?.billablePages
  if (typeof pages !== 'number' || !Number.isInteger(pages) || pages < 1) return 0
  return pages * copiesFromPrintParamsJson(fallback?.printParamsJson)
}
