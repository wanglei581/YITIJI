// ============================================================
// URL 校验工具
// ============================================================

/** 仅允许 http/https 的来源链接，防止 javascript: 等非法 scheme 进入二维码/跳转 */
export function isValidSourceUrl(url: string | undefined | null): url is string {
  if (!url) return false
  try {
    const u = new URL(url)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

// ============================================================
// 招聘会场馆导航深链
//
// 一体机是固定设备，用户用手机扫码在自己手机上打开导航。
// 优先用经纬度生成高德 H5 路径规划链接（手机扫码后唤起高德/网页导航）；
// 无坐标时回退到「地址关键字搜索」H5 链接。
// 不依赖任何地图 SDK / API key，零外部费用。
// ============================================================

export interface FairNavInput {
  latitude?: number
  longitude?: number
  /** 场馆名称（导航终点名称展示） */
  venue?: string
  /** 详细地址（无坐标时回退搜索关键字） */
  address?: string
}

/**
 * 生成可放进二维码的手机导航 URL。
 * - 有经纬度 → 高德 H5 终点路径规划（`/dir`），到点名称用 venue。
 * - 无经纬度但有地址/场馆 → 高德 H5 关键字检索（`/search`）。
 * - 都没有 → 返回 null（调用方据此不展示导航二维码）。
 */
export function buildNavUrl(input: FairNavInput): string | null {
  const { latitude, longitude, venue, address } = input
  const name = (venue || address || '').trim()
  const hasCoord =
    typeof latitude === 'number' &&
    typeof longitude === 'number' &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude)

  if (hasCoord) {
    const params = new URLSearchParams({
      to: `${longitude},${latitude},${name || '目的地'}`,
      src: 'ai-job-print-terminal',
      callnative: '1',
    })
    return `https://uri.amap.com/navigation?${params.toString()}`
  }

  const keyword = (address || venue || '').trim()
  if (keyword) {
    const params = new URLSearchParams({
      keyword,
      src: 'ai-job-print-terminal',
      callnative: '1',
    })
    return `https://uri.amap.com/search?${params.toString()}`
  }

  return null
}
