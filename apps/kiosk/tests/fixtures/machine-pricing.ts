/**
 * 一体机展示价在终端配置 pricing.effective 上，不在 GET /print/price-config。
 * 这里只给浏览器用例造本机价。五个键都必须是非负整数，缺一个页面会当成没读到。
 */

export const KIOSK_CONFIG_PATH = '/api/v1/terminals/KSK-001/config'

/** 终端配置 pricing.effective 的五个键。 */
export type MachinePriceKey = 'resume_optimize' | 'mock_interview' | 'print_bw_page' | 'print_color_page' | 'scan'

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

export function machinePricing(bw: number, color: number): Record<string, unknown> {
  return machinePricingWith({ print_bw_page: bw, print_color_page: color })
}

/** 彩色单价不下发。首页「彩色缺价」用这个，页面不得把它当成 0 元。 */
export function machinePricingMissingColor(bw: number): Record<string, unknown> {
  return machinePricingWith({ print_bw_page: bw }, ['print_color_page'])
}

export function withMachinePricing(
  config: Record<string, unknown>,
  bw: number,
  color: number,
): Record<string, unknown> {
  return { ...config, pricing: machinePricing(bw, color) }
}

type JsonMapperHost = {
  mapJson(method: string, path: string, map: (json: unknown) => unknown): void
}

/** 在已经登记的终端配置上盖上本机价，不改托管、百宝箱等其它字段。 */
export function attachMachinePricing(api: JsonMapperHost, bw: number, color: number): void {
  attachMachinePricingWith(api, machinePricing(bw, color))
}

/** 同上，价目整段由调用方给（五个价分别设时用 machinePricingWith 造）。 */
export function attachMachinePricingWith(api: JsonMapperHost, pricing: Record<string, unknown>): void {
  api.mapJson('GET', KIOSK_CONFIG_PATH, (json) => {
    const base = json && typeof json === 'object' ? (json as Record<string, unknown>) : {}
    return { ...base, pricing }
  })
}
