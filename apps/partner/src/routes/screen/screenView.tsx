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
   * 机构大屏同样可能挂在无人看管的屏上，401 刻意不自动跳登录（见 consoleScreen.ts）。
   * 代价是页面必须自己说清是登录过期还是权限/机构归属问题，否则数字冻住而屏上
   * 只有一句「最近一次刷新失败」—— 机构管理员会当成网络故障一直等。
   */
  failure?: ScreenFailure | null
  /** 401 横幅里「重新登录」的动作。点了才跳，不自动跳。 */
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
        身份 / 权限 / 机构归属类失败在**已有数据之后**发生时的说明。
        stale 只说「数字是旧的」，这里说「旧在哪儿、该怎么办」。
        旧数据一个都不清、一个 0 都不伪造。
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
      {/*
        ORG_REQUIRED 与「角色不符」必须分开说，理由同 index.tsx 的无数据分支：
        机构管理员看到「无权限」会以为是权限没开，而真实原因是账号没有机构归属，
        大屏因此没有可展示的范围 —— 两者的下一步动作完全不同。
      */}
      {failure?.kind === 'forbidden' ? (
        failure.code === 'ORG_REQUIRED' ? (
          <ScreenBanner tone="error">
            <b>当前账号未绑定机构</b>，屏上数字停在机构归属变更前的最后一次成功取数。
            {failure.message}。大屏只展示本机构数据，账号没有机构归属时没有可展示的范围，
            请联系平台侧为该账号绑定机构。
          </ScreenBanner>
        ) : (
          <ScreenBanner tone="error">
            <b>已无权查看本大屏</b>，屏上数字停在权限变更前的最后一次成功取数。{failure.message}。
          </ScreenBanner>
        )
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
