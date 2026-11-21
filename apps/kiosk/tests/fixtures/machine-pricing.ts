/**
 * 一体机展示价在终端配置 pricing.effective 上，不在 GET /print/price-config。
 * 这里只给浏览器用例造本机价。五个键都必须是非负整数，缺一个页面会当成没读到。
 * 三项按次付款的服务（简历优化、模拟面试、扫描）默认仍是 0；收费机器的用例显式传 services 或用 machinePricingWith。
 */

export const KIOSK_CONFIG_PATH = '/api/v1/terminals/KSK-001/config'

/** 终端配置 pricing.effective 的五个键。 */
export type MachinePriceKey = 'resume_optimize' | 'mock_interview' | 'print_bw_page' | 'print_color_page' | 'scan'

/** 按次付款三项的本机价（分）。不传的项是 0。 */
export interface MachineServicePrices {
  resume_optimize?: number
  mock_interview?: number
  scan?: number
}

/**
 * 五个价分别设（分）。没给的键仍是 0，和改前 machinePricing 的默认一致。
 * 值原样写进去：要造「读不到」的用例可以给负数、字符串；omit 里的键整个去掉。
 */
export function machinePricingWith(
  prices: Partial<Record<MachinePriceKey, unknown>>,
  omit: readonly MachinePriceKey[] = [],
): Record<string, unknown> {
  const effective: Record<string, unknown> = {
    resume_optimize: 0,
    mock_interview: 0,
    print_bw_page: 0,
    print_color_page: 0,
    scan: 0,
    ...prices,
  }
  for (const key of omit) delete effective[key]
  return {
    personalChargeEnabled: true,
    userChargeMode: 'user_pays',
    isPublicSite: false,
    effective,
  }
}

export function machinePricing(bw: number, color: number, services: MachineServicePrices = {}): Record<string, unknown> {
  return machinePricingWith({
    resume_optimize: services.resume_optimize ?? 0,
    mock_interview: services.mock_interview ?? 0,
    print_bw_page: bw,
    print_color_page: color,
    scan: services.scan ?? 0,
  })
}

/** 彩色单价不下发。首页「彩色缺价」用这个，页面不得把它当成 0 元。 */
export function machinePricingMissingColor(bw: number): Record<string, unknown> {
  return machinePricingWith({ print_bw_page: bw }, ['print_color_page'])
}

export function withMachinePricing(
  config: Record<string, unknown>,
  bw: number,
  color: number,
  services: MachineServicePrices = {},
): Record<string, unknown> {
  return { ...config, pricing: machinePricing(bw, color, services) }
}

type JsonMapperHost = {
  mapJson(method: string, path: string, map: (json: unknown) => unknown): void
}

/** 简历优化单价（默认 1.00 元），其余四项全 0。 */
export function resumeOnlyMachinePricing(resumeCents = 100): Record<string, unknown> {
  return machinePricing(0, 0, { resume_optimize: resumeCents })
}

/** 五项生效价全 0（开启个人收费但各项都是免费）。 */
export function freeMachinePricing(): Record<string, unknown> {
  return machinePricing(0, 0)
}

/** 公共就业点位：永远不向个人收费（即便带价目也按免费处理）。 */
export function publicSiteMachinePricing(resumeCents = 100): Record<string, unknown> {
  return { ...machinePricing(0, 0, { resume_optimize: resumeCents }), isPublicSite: true }
}

/** 在已经登记的终端配置上盖上本机价，不改托管、百宝箱等其它字段。 */
export function attachMachinePricing(api: JsonMapperHost, bw: number, color: number, services: MachineServicePrices = {}): void {
  attachMachinePricingWith(api, machinePricing(bw, color, services))
}

/** 同上，价目整段由调用方给（五个价分别设时用 machinePricingWith 造）。 */
export function attachMachinePricingWith(api: JsonMapperHost, pricing: Record<string, unknown>): void {
  api.mapJson('GET', KIOSK_CONFIG_PATH, (json) => {
    const base = json && typeof json === 'object' ? (json as Record<string, unknown>) : {}
    return { ...base, pricing }
  })
}

/** 在已经登记的终端配置上盖上指定价目对象（传 undefined 表示去掉 pricing，模拟读不到价）。 */
export function attachRawMachinePricing(api: JsonMapperHost, pricing: Record<string, unknown> | undefined): void {
  api.mapJson('GET', KIOSK_CONFIG_PATH, (json) => {
    const base = json && typeof json === 'object' ? { ...(json as Record<string, unknown>) } : {}
    if (pricing === undefined) {
      delete base.pricing
      return base
    }
    return { ...base, pricing }
  })
}
