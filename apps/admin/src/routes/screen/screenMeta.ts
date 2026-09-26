import { formatDateTime } from '@ai-job-print/shared'
import type { ScreenSnapshot, ScreenSnapshotMetrics } from '@ai-job-print/shared'
import { SCREEN_UNAVAILABLE_REASON } from '@ai-job-print/shared'

/**
 * 大屏页眉与整屏级横幅的取数口径。
 *
 * 全部文案从响应渲染，不硬编码。时间一律走 `formatDateTime`（Asia/Shanghai）。
 * 禁止 `toISOString().slice(...)`：那是 UTC 墙钟冒充本地时间，`scripts/verify-datetime-honesty.mjs` 全树扫这个。
 */

export function countFailedSlices(metrics: ScreenSnapshotMetrics): number {
  return Object.values(metrics).filter(
    (metric) =>
      metric
      && metric.available === false
      && metric.reason === SCREEN_UNAVAILABLE_REASON.sourceQueryFailed,
  ).length
}

/**
 * 不可用指标的原因，交给原因表去说「暂时取不到」还是「未接入」。
 * 服务端整个没下发这个指标时按取数失败处理（与 TwinMetricPanel 的缺省一致），不猜成数据层缺口。
 */
export function metricReason(metric: { available: boolean; reason?: string } | undefined): string {
  return metric && metric.available === false && metric.reason ? metric.reason : SCREEN_UNAVAILABLE_REASON.sourceQueryFailed
}

export function generatedAtText(snapshot: ScreenSnapshot): string {
  return formatDateTime(snapshot.generatedAt, { fallback: '时间未知' })
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
