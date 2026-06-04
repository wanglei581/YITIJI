import type { KioskScreensaverItem } from '@ai-job-print/shared'

/**
 * 宣传屏素材本地缓存(Cache Storage)。
 *
 * 评审 bug #4:网络断时广告黑屏 → 素材预缓存,断网放缓存。
 * 缓存 key 用 sha256(内容指纹),不用签名 URL —— 签名每次签发都变,
 * 内容不变则 sha256 不变,签名过期/轮换不会让缓存失效。
 *
 * Kiosk(Edge/Chrome 全屏)均支持 Cache Storage;不支持时静默降级为直连网络。
 */
const CACHE_NAME = 'screensaver-assets-v1'

function cacheKey(sha256: string): string {
  return `/__ss_cache__/${sha256}`
}

function supported(): boolean {
  return typeof window !== 'undefined' && 'caches' in window
}

/** 预缓存单个素材(已缓存则跳过)。失败(离线)静默忽略,播放时再兜底。 */
export async function prefetchAsset(item: KioskScreensaverItem): Promise<void> {
  if (!supported()) return
  try {
    const cache = await caches.open(CACHE_NAME)
    const key = cacheKey(item.sha256)
    if (await cache.match(key)) return
    const res = await fetch(item.url)
    if (res.ok) await cache.put(key, res.clone())
  } catch {
    /* 离线 / 拉取失败:跳过,resolveAssetUrl 会回退直连 */
  }
}

/**
 * 解析可播放 URL:优先缓存(blob,离线可用),否则回退签名 URL(直连)。
 * 返回 blob: 开头的 URL 时,调用方播放完必须 URL.revokeObjectURL 释放。
 */
export async function resolveAssetUrl(item: KioskScreensaverItem): Promise<string> {
  if (supported()) {
    try {
      const cache = await caches.open(CACHE_NAME)
      const hit = await cache.match(cacheKey(item.sha256))
      if (hit) {
        const blob = await hit.blob()
        return URL.createObjectURL(blob)
      }
    } catch {
      /* 读缓存失败:回退直连 */
    }
  }
  return item.url
}

/** 清理已不在播放列表里的旧缓存(按 sha256 白名单)。 */
export async function pruneCache(validShas: string[]): Promise<void> {
  if (!supported()) return
  try {
    const cache = await caches.open(CACHE_NAME)
    const valid = new Set(validShas.map(cacheKey))
    const keys = await cache.keys()
    await Promise.all(
      keys.map((req) => {
        const path = new URL(req.url).pathname
        return valid.has(path) ? Promise.resolve(false) : cache.delete(req)
      }),
    )
  } catch {
    /* 清理失败无害,忽略 */
  }
}
