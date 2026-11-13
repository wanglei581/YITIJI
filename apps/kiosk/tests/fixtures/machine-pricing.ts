/**
 * 一体机展示价在终端配置 pricing.effective 上，不在 GET /print/price-config。
 * 这里只给浏览器用例造本机价。两个打印键都必须是非负整数，缺一个页面会当成没读到。
 */

export const KIOSK_CONFIG_PATH = '/api/v1/terminals/KSK-001/config'

export function machinePricing(bw: number, color: number): Record<string, unknown> {
  return {
    personalChargeEnabled: true,
    userChargeMode: 'user_pays',
    isPublicSite: false,
    effective: {
      resume_optimize: 0,
      mock_interview: 0,
      print_bw_page: bw,
      print_color_page: color,
      scan: 0,
    },
  }
}

/** 彩色单价不下发。首页「彩色缺价」用这个，页面不得把它当成 0 元。 */
export function machinePricingMissingColor(bw: number): Record<string, unknown> {
  const pricing = machinePricing(bw, 0)
  const effective = { ...(pricing.effective as Record<string, number>) }
  delete effective.print_color_page
  return { ...pricing, effective }
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
  api.mapJson('GET', KIOSK_CONFIG_PATH, (json) => {
    const base = json && typeof json === 'object' ? (json as Record<string, unknown>) : {}
    return { ...base, pricing: machinePricing(bw, color) }
  })
}
