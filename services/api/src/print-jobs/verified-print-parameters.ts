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
