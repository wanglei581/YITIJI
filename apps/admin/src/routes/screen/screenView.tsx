import type { ReactNode } from 'react'
import type { ScreenSnapshot } from '@ai-job-print/shared'
import { ScreenBanner, ScreenBody, ScreenHeader } from '@ai-job-print/ui'
import type { ScreenHeadingLevel } from '@ai-job-print/ui'
import type { ScreenFetchResult } from '../../services/api/consoleScreen'
import { accessText, countFailedSlices, freshnessText, generatedAtText, windowText } from './screenMeta'

/** 大屏页眉 + 整屏级横幅。取数口径的计算在 screenMeta.ts，本文件只出组件。 */

export type ScreenFailure = Exclude<ScreenFetchResult, { kind: 'ok' }>

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
  /**
   * 最近一次刷新的失败原因；已有上次成功数据时也必须传。
   *
   * 只说「最近一次刷新失败」对身份类失败是不够的：会话过期 / 角色被撤之后
   * 数字会一直冻在几小时前，而 `consoleScreen.ts` 文件头承诺的代价是
   * **由页面说清是登录过期并给出动作**。那句承诺此前只在 `!data` 一支兑现，
   * 取成功过一次后 data 永不为空（failPolicy: 'keep-last'），于是永远走不到。
   */
  failure?: ScreenFailure | null
  /** 401 横幅里「重新登录」的动作。刻意由调用方给：点了才跳，不自动跳。 */
  onRelogin?: () => void
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
  failure = null,
  onRelogin,
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
      {/*
        身份 / 权限类失败在**已有数据之后**发生时的说明。

        这一块与上面的 stale 标记是两件事，必须同时在：stale 负责「这些数字是旧的」，
        这里负责「旧在哪儿、该怎么办」。旧数据一个都不清、一个 0 都不伪造 ——
        清掉才是伪造的反面错误：屏上会变成一片空壳，同样说不清原因。
      */}
      {failure?.kind === 'unauthorized' ? (
        <ScreenBanner tone="error">
          <b>登录已过期</b>，屏上数字停在上一次成功取数的时刻，之后的变化未取到。
          本期未签发免登录的只读展示令牌，重新登录后会继续自动刷新。
          {onRelogin ? (
            <>
              {' '}
              <button type="button" className="ops-btn" onClick={onRelogin}>
                重新登录
              </button>
            </>
          ) : null}
        </ScreenBanner>
      ) : null}
      {failure?.kind === 'forbidden' ? (
        <ScreenBanner tone="error">
          <b>已无权查看本大屏</b>，屏上数字停在权限变更前的最后一次成功取数。{failure.message}。
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
