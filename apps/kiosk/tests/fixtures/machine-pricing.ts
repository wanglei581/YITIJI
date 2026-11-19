/**
 * 一体机展示价在终端配置 pricing.effective 上，不在 GET /print/price-config。
 * 这里只给浏览器用例造本机价。两个打印键都必须是非负整数，缺一个页面会当成没读到。
 * 三项按次付款的服务（简历优化、模拟面试、扫描）默认仍是 0；收费机器的用例显式传 services。
 */

export const KIOSK_CONFIG_PATH = '/api/v1/terminals/KSK-001/config'

/** 按次付款三项的本机价（分）。不传的项是 0。 */
export interface MachineServicePrices {
  resume_optimize?: number
  mock_interview?: number
  scan?: number
}

export function machinePricing(bw: number, color: number, services: MachineServicePrices = {}): Record<string, unknown> {
  return {
    personalChargeEnabled: true,
    userChargeMode: 'user_pays',
    isPublicSite: false,
    effective: {
      resume_optimize: services.resume_optimize ?? 0,
      mock_interview: services.mock_interview ?? 0,
      print_bw_page: bw,
      print_color_page: color,
      scan: services.scan ?? 0,
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
  services: MachineServicePrices = {},
): Record<string, unknown> {
  return { ...config, pricing: machinePricing(bw, color, services) }
}

type JsonMapperHost = {
  mapJson(method: string, path: string, map: (json: unknown) => unknown): void
}

/** 在已经登记的终端配置上盖上本机价，不改托管、百宝箱等其它字段。 */
export function attachMachinePricing(api: JsonMapperHost, bw: number, color: number, services: MachineServicePrices = {}): void {
  api.mapJson('GET', KIOSK_CONFIG_PATH, (json) => {
    const base = json && typeof json === 'object' ? (json as Record<string, unknown>) : {}
    return { ...base, pricing: machinePricing(bw, color, services) }
  })
}
