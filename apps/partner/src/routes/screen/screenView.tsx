import type { ReactNode } from 'react'
import type { ScreenSnapshot } from '@ai-job-print/shared'
import { ScreenBanner, ScreenBody, ScreenHeader } from '@ai-job-print/ui'
import type { ScreenHeadingLevel } from '@ai-job-print/ui'
import { accessText, countFailedSlices, freshnessText, generatedAtText, windowText } from './screenMeta'

/** 大屏页眉 + 整屏级横幅。取数口径的计算在 screenMeta.ts，本文件只出组件。 */

export interface ScreenShellProps {
  title: string
  /** 页眉标题层级：嵌在 Page 里是 2（外层 PageHeader 占 h1），全屏演示是 1。 */
  headingLevel: ScreenHeadingLevel
  subtitle: string
  snapshot: ScreenSnapshot
  pollSeconds: number
  /** 上次刷新失败但仍有上次成功的数据。 */
  stale: boolean
  /** 连续失败或浏览器判定离线。 */
  offline: boolean
  actions: ReactNode
  children: ReactNode
}

export function ScreenShell({
  title,
  headingLevel,
  subtitle,
  snapshot,
  pollSeconds,
  stale,
  offline,
  actions,
  children,
}: ScreenShellProps) {
  const failed = countFailedSlices(snapshot.metrics)
  return (
    <ScreenBody>
      <ScreenHeader
        title={title}
        headingLevel={headingLevel}
        subtitle={subtitle}
        generatedAtText={generatedAtText(snapshot)}
        windowText={`${windowText(snapshot, pollSeconds)} · ${freshnessText(snapshot)} · ${accessText(snapshot)}`}
        stale={stale}
        staleText="最近一次刷新失败，下方为上次成功取数的数据"
        actions={actions}
      />
      {offline ? (
        <ScreenBanner tone="error">
          <b>与服务器断开</b>，正在按刷新节奏重试。屏上仍是上次成功取数的数据，没有用 0 代替。
        </ScreenBanner>
      ) : null}
      {snapshot.status === 'unavailable' ? (
        <ScreenBanner tone="error">
          <b>本次快照的全部数据源均查询失败。</b>
          下面每一块都写明了原因，页面不会用 0 顶替；等下次刷新恢复即可。
        </ScreenBanner>
      ) : null}
      {snapshot.status === 'degraded' ? (
        <ScreenBanner tone="warn">
          <b>部分数据源本次查询失败（{failed} 项）。</b>
          失败的块已单独标注为「取数失败」，其余数字仍是本次真实取数。
        </ScreenBanner>
      ) : null}
      {children}
    </ScreenBody>
  )
}
