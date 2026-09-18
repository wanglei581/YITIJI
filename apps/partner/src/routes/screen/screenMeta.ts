import { formatDateTime } from '@ai-job-print/shared'
import type { ScreenSnapshot, ScreenSnapshotMetrics } from '@ai-job-print/shared'
import { SCREEN_UNAVAILABLE_REASON } from '@ai-job-print/shared'

/**
 * 大屏页眉与整屏级横幅的取数口径。
 *
 * 全部文案从响应渲染，**没有一处硬编码窗口秒数或刷新节奏** ——
 * 设计稿要求把口径打在页眉上，写死就等于口径改了屏上还在说旧话。
 *
 * 时间一律走 `formatDateTime`（Asia/Shanghai）。禁止 `toISOString().slice(...)`：
 * 那是 UTC 墙钟冒充本地时间，`scripts/verify-datetime-honesty.mjs` 全树扫这个。
 */

const FRESHNESS_LABEL: Record<'hit' | 'miss', string> = {
  hit: '命中缓存',
  miss: '本次新取',
}

export function countFailedSlices(metrics: ScreenSnapshotMetrics): number {
  return Object.values(metrics).filter(
    (metric) =>
      metric
      && metric.available === false
      && metric.reason === SCREEN_UNAVAILABLE_REASON.sourceQueryFailed,
  ).length
}

export function generatedAtText(snapshot: ScreenSnapshot): string {
  return formatDateTime(snapshot.generatedAt, { fallback: '时间未知' })
}

/** 口径行：在线窗口 + 时区 + 三档 TTL + 本页轮询间隔 + 访问口径。 */
export function windowText(snapshot: ScreenSnapshot, pollSeconds: number): string {
  const w = snapshot.window
  const parts = [
    `在线判定窗口 ${w.onlineWindowSeconds} 秒`,
    `统计时区 ${w.timezone}`,
    `服务端缓存 实时 ${w.realtimeTtlSeconds} 秒 / 计数 ${w.countsTtlSeconds} 秒 / 累计 ${w.cumulativeTtlSeconds} 秒`,
    `本页每 ${pollSeconds} 秒请求一次`,
  ]
  return parts.join(' · ')
}

/** 本次取数是命中缓存还是新取。这是「陈旧」判断的服务端一侧。 */
export function freshnessText(snapshot: ScreenSnapshot): string {
  const entries: string[] = [
    `实时 ${FRESHNESS_LABEL[snapshot.freshness.realtime]}`,
    `计数 ${FRESHNESS_LABEL[snapshot.freshness.counts]}`,
  ]
  if (snapshot.freshness.cumulative) {
    entries.push(`累计 ${FRESHNESS_LABEL[snapshot.freshness.cumulative]}`)
  }
  return `取数来源：${entries.join(' · ')}`
}

/**
 * 访问口径提示。低干扰（页眉灰字一行）但明确：
 * 大屏没有免登录展示令牌，看到这一屏的人一定是登录过的后台账号。
 */
export function accessText(snapshot: ScreenSnapshot): string {
  return snapshot.limits.access === 'authenticated_console'
    && snapshot.limits.displayToken === 'not_issued'
    ? '访问口径：仅已登录后台会话可见，本期未签发免登录只读展示令牌'
    : '访问口径：以服务端下发为准'
}
