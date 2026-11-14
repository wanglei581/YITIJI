/** 社区动态公开列表缓存前缀。撤销或恢复内容可信、停用或启用机构时按此前缀整段清掉。 */
export const COMMUNITY_FEED_CACHE_PREFIX = 'community:feeds:v2:'

/** 早报「当日新政策」缓存前缀。与社区动态同一时机清掉。 */
export const DAILY_BRIEF_CITY_CACHE_PREFIX = 'daily-brief:city-new:v2:'

/**
 * 上面两段缓存的寿命，也是清缓存失败时审计里的过期窗口。
 * 库已经改完、缓存没清掉时，公开读取最长还会按旧结果再露这么久。
 */
export const PUBLIC_CONTENT_CACHE_STALE_WINDOW_SECONDS = 15 * 60
