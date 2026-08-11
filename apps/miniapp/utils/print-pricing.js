// 打印价目适配与金额计算。
//
// 运行时唯一价源是后端 GET /api/v1/print/price-config（数据库 PriceConfig）。
// 本文件只负责校验后端响应和用整数「分」计算预估金额，不保存任何兜底单价。

const SERVICE_KEY = {
  bw: 'print_bw_page',
  color: 'print_color_page',
}

function formatCents(cents) {
  if (!Number.isSafeInteger(cents) || cents < 0) return '—'
  return (cents / 100).toFixed(2)
}

function normalizePriceConfig(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('价目响应为空')

  // 整机免费模式由后端显式控制；前端不能自行恢复任何正式单价。
  if (raw.billingEnabled === false) {
    return {
      billingEnabled: false,
      cents: { bw: 0, color: 0 },
      labels: { bw: '免费', color: '免费' },
    }
  }

  const items = Array.isArray(raw.items) ? raw.items : []
  const cents = {}

  Object.keys(SERVICE_KEY).forEach((mode) => {
    const item = items.find((candidate) => candidate && candidate.serviceKey === SERVICE_KEY[mode])
    if (!item || item.unit !== 'page' || !Number.isSafeInteger(item.unitCents) || item.unitCents < 0) {
      throw new Error(`缺少有效价目：${SERVICE_KEY[mode]}`)
    }
    cents[mode] = item.unitCents
  })

  return {
    billingEnabled: true,
    cents,
    labels: {
      bw: cents.bw === 0 ? '免费' : `¥${formatCents(cents.bw)}/页`,
      color: cents.color === 0 ? '免费' : `¥${formatCents(cents.color)}/页`,
    },
  }
}

function estimateCents(priceCents, mode, pages, copies = 1) {
  const unitCents = priceCents && priceCents[mode]
  const safePages = Number(pages)
  const safeCopies = Number(copies)
  if (!Number.isSafeInteger(unitCents) || unitCents < 0) return null
  if (!Number.isSafeInteger(safePages) || safePages < 0) return null
  if (!Number.isSafeInteger(safeCopies) || safeCopies < 1) return null
  return unitCents * safePages * safeCopies
}

function estimateText(priceCents, mode, pages, copies = 1) {
  const cents = estimateCents(priceCents, mode, pages, copies)
  return cents === null ? '—' : formatCents(cents)
}

module.exports = {
  SERVICE_KEY,
  formatCents,
  normalizePriceConfig,
  estimateCents,
  estimateText,
}
