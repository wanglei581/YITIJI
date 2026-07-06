// ============================================================
// Price Config API — W-A 价格真相源统一
//
// Kiosk 预览/确认页展示价的**唯一来源**：GET /api/v1/print/price-config（公开只读）。
// 计费口径与服务端 PricingService 完全一致：按**内容页**计价
// （unitCents × billablePages × copies），双面/多页合一不影响计费页数。
//
// 硬约束（守卫断言）：
// - 业务页面**不得**再持有任何硬编码单价常量；估价一律经本模块计算。
// - http 模式取价失败 → status='error'，页面显示「价格暂不可用/以收银台金额为准」，
//   **绝不回退硬编码价、绝不显示假价格**（实际扣款由服务端建单时计算，收银台必见真价）。
// - mock 模式（API_MODE!=='http'，仅本地演示）使用本文件内 DEMO 价目，明示演示用途；
//   生产构建强制 http 模式（client.ts 已断言），DEMO 价不可能进入生产展示。
// ============================================================

import { useEffect, useState } from 'react'
import type { PrintPriceConfigView } from '@ai-job-print/shared'
import { API_BASE_URL, API_MODE } from '../api/client'

/** 仅 mock 演示模式使用的价目（与 dev seed 同值；生产构建不可达）。 */
const DEMO_PRICE_CONFIG: PrintPriceConfigView = {
  billingEnabled: true,
  items: [
    { serviceKey: 'print_bw_page', unitCents: 20, unit: 'page', description: '黑白打印每页（演示价）' },
    { serviceKey: 'print_color_page', unitCents: 50, unit: 'page', description: '彩色打印每页（演示价）' },
  ],
}

export async function fetchPrintPriceConfig(): Promise<PrintPriceConfigView> {
  const res = await fetch(`${API_BASE_URL}/print/price-config`)
  if (!res.ok) throw new Error(`fetchPrintPriceConfig failed: ${res.status}`)
  const body = (await res.json()) as PrintPriceConfigView
  if (!Array.isArray(body.items)) throw new Error('fetchPrintPriceConfig: malformed response')
  return body
}

export interface PriceConfigState {
  status: 'loading' | 'ready' | 'error'
  config: PrintPriceConfigView | null
}

/** 取服务端价目（http 模式）；mock 模式立即返回演示价目。失败不重试轰炸，进入 error 态。 */
export function usePrintPriceConfig(): PriceConfigState {
  const [state, setState] = useState<PriceConfigState>(() =>
    API_MODE === 'http' ? { status: 'loading', config: null } : { status: 'ready', config: DEMO_PRICE_CONFIG },
  )

  useEffect(() => {
    if (API_MODE !== 'http') return
    let cancelled = false
    void fetchPrintPriceConfig()
      .then((config) => {
        if (!cancelled) setState({ status: 'ready', config })
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error', config: null })
      })
    return () => {
      cancelled = true
    }
  }, [])

  return state
}

/** 按色彩模式取单价（分）；价目缺失返回 null（调用方显示「价格暂不可用」）。 */
export function unitCentsFor(config: PrintPriceConfigView | null, colorMode: 'black_white' | 'color'): number | null {
  if (!config) return null
  const key = colorMode === 'color' ? 'print_color_page' : 'print_bw_page'
  const item = config.items.find((i) => i.serviceKey === key)
  return item && Number.isInteger(item.unitCents) && item.unitCents >= 0 ? item.unitCents : null
}

/**
 * 估价（分）：与服务端 PricingService 同一公式 —— 单价 × 内容页数 × 份数。
 * 页数未识别（null）或单价缺失时返回 null —— 不给假总价，以收银台金额为准。
 */
export function estimatePrintCents(
  config: PrintPriceConfigView | null,
  input: { pages: number | null; copies: number; colorMode: 'black_white' | 'color' },
): number | null {
  const unit = unitCentsFor(config, input.colorMode)
  if (unit === null || input.pages === null || !Number.isInteger(input.pages) || input.pages <= 0) return null
  if (!Number.isInteger(input.copies) || input.copies <= 0) return null
  return unit * input.pages * input.copies
}

/** 金额（分）→ 人民币展示串（整数分，绝不浮点误差累积）。 */
export function formatPriceCents(cents: number): string {
  const safe = Number.isFinite(cents) ? Math.round(cents) : 0
  return `¥${(safe / 100).toFixed(2)}`
}
