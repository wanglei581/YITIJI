import { useCallback, useMemo, type ReactNode } from 'react'
import { replaceIfChanged, useRefreshable } from '@ai-job-print/refresh'
import type { AdminScreenProfile, ScreenSnapshot } from '@ai-job-print/shared'
import {
  TwinBanner,
  TwinHeader,
  TwinScreen,
  TwinSlot,
  TwinStatePanel,
  type ScreenHeadingLevel,
  type TwinLayout,
  type TwinTab,
} from '@ai-job-print/ui'
import {
  ScreenFetchError,
  loadAdminScreenSnapshot,
  type ScreenFetchResult,
} from '../../services/api/consoleScreen'
import { accessText, countFailedSlices, generatedAtText } from './screenMeta'

/**
 * 大屏外壳：页眉（标题 / 页签 / 时钟 / 动作）+ 整屏级横幅 + 块位栅格，以及取数失败的整屏状态。
 * 各页签只写「有数据时长什么样」，登录过期、断网、部分失败的说法统一在这里。
 */

export type ScreenFailure = Exclude<ScreenFetchResult, { kind: 'ok' }>

/** 页面层下发给各页签的公共件。 */
export interface ScreenChrome {
  /** 页眉标题层级：嵌在后台 Page 里是 2（外层 PageHeader 占 h1），新窗口展示是 1。 */
  headingLevel: ScreenHeadingLevel
  presenting: boolean
  lite: boolean
  tabs: TwinTab[]
  onNavigate: (href: string) => void
  pageActions: ReactNode
  params: URLSearchParams
  setParam: (key: string, value: string | null) => void
  onRelogin: () => void
}

export function failureOf(error: unknown): ScreenFailure | null {
  return error instanceof ScreenFetchError ? error.result : null
}

/** 大屏快照取数：失败保留上一次成功的数据（keep-last），陈旧由横幅说明。 */
export function useAdminSnapshot(profile: AdminScreenProfile, pollSeconds: number, keySuffix?: string) {
  const fetcher = useCallback(() => loadAdminScreenSnapshot(profile), [profile])
  const result = useRefreshable<ScreenSnapshot>(
    keySuffix ? `admin:screen:${profile}:${keySuffix}` : `admin:screen:${profile}`,
    fetcher,
    useMemo(
      () => ({
        intervalMs: pollSeconds * 1000,
        merge: replaceIfChanged<ScreenSnapshot>,
        failPolicy: 'keep-last' as const,
      }),
      [pollSeconds],
    ),
  )
  return { ...result, failure: failureOf(result.error) }
}

export function FailurePanel({ result, onRetry, onRelogin }: { result: ScreenFailure; onRetry: () => void; onRelogin: () => void }) {
  if (result.kind === 'mock') {
    return (
      <TwinStatePanel
        title="演示模式不展示大屏数值"
        description="当前构建为 mock 模式（VITE_API_MODE 不等于 http），没有连接真实后端。大屏只展示真实取数，因此这里一个数字都不显示。联调请配置 VITE_API_MODE=http 与 VITE_API_BASE_URL。"
      />
    )
  }
  if (result.kind === 'unauthorized') {
    return (
      <TwinStatePanel
        title="登录已过期"
        description="大屏只在已登录的后台会话里展示，本期未签发免登录的只读展示令牌。重新登录后即可继续显示。"
        action={
          <button type="button" className="twin-btn is-primary" onClick={onRelogin}>
            重新登录
          </button>
        }
      />
    )
  }
  if (result.kind === 'forbidden') {
    return <TwinStatePanel title="无权查看本大屏" description={result.message} />
  }
  if (result.kind === 'offline') {
    return (
      <TwinStatePanel
        title="与服务器断开"
        description="没有取到任何一次成功数据，因此这里不显示任何数值。恢复网络后可手动重试。"
        action={
          <button type="button" className="twin-btn" onClick={onRetry}>
            重试
          </button>
        }
      />
    )
  }
  return (
    <TwinStatePanel
      title="大屏数据获取失败"
      description={result.message}
      action={
        <button type="button" className="twin-btn" onClick={onRetry}>
          重试
        </button>
      }
    />
  )
}

export interface TwinShellProps {
  chrome: ScreenChrome
  title: string
  subtitle: string
  layout: TwinLayout
  /** 桌面档筛选栏；展示模式不渲染。 */
  toolbar?: ReactNode
  /** 已取到的主快照；没有时由调用方渲染整屏状态。 */
  snapshot: ScreenSnapshot | null
  pollSeconds: number
  /** 最近一次刷新失败的原因（已有数据时也要传，身份类失败要说清楚）。 */
  failure: ScreenFailure | null
  onRefresh: () => void
  refreshing: boolean
  children: ReactNode
}

export function TwinShell({
  chrome,
  title,
  subtitle,
  layout,
  toolbar,
  snapshot,
  pollSeconds,
  failure,
  onRefresh,
  refreshing,
  children,
}: TwinShellProps) {
  const headingLevel = chrome.headingLevel
  const stamp = snapshot ? `数据时间 ${generatedAtText(snapshot)} · 每 ${pollSeconds} 秒刷新` : '正在取数，未取到之前不显示任何数值'
  const header = (
    <TwinHeader
      title={title}
      headingLevel={headingLevel}
      subtitle={`${subtitle}　｜　${stamp}`}
      tabs={chrome.tabs}
      onNavigate={chrome.onNavigate}
      actions={
        <>
          {chrome.presenting ? null : (
            <button type="button" className="twin-btn" onClick={onRefresh} disabled={refreshing}>
              刷新
            </button>
          )}
          {chrome.pageActions}
        </>
      }
    />
  )
  const failed = snapshot ? countFailedSlices(snapshot.metrics) : 0
  const banners: ReactNode[] = []
  if (snapshot && failure?.kind === 'offline') {
    banners.push(
      <TwinBanner key="offline" tone="error">
        <b>与服务器断开</b>，正在按刷新节奏重试。屏上仍是上次成功取数的数据（{generatedAtText(snapshot)}），没有用 0 代替。
      </TwinBanner>,
    )
  } else if (snapshot && failure?.kind === 'failed') {
    banners.push(
      <TwinBanner key="stale" tone="warn">
        最近一次刷新失败，屏上是 {generatedAtText(snapshot)} 取到的数据。{failure.message}
      </TwinBanner>,
    )
  }
  if (snapshot && failure?.kind === 'unauthorized') {
    banners.push(
      <TwinBanner key="auth" tone="error">
        <b>登录已过期</b>，屏上数字停在上一次成功取数的时刻。本期未签发免登录的只读展示令牌，重新登录后会继续自动刷新。
        <button type="button" className="twin-btn" onClick={chrome.onRelogin}>
          重新登录
        </button>
      </TwinBanner>,
    )
  }
  if (snapshot && failure?.kind === 'forbidden') {
    banners.push(
      <TwinBanner key="forbidden" tone="error">
        <b>已无权查看本大屏</b>，屏上数字停在权限变更前的最后一次成功取数。{failure.message}
      </TwinBanner>,
    )
  }
  if (snapshot?.status === 'unavailable') {
    banners.push(
      <TwinBanner key="unavailable" tone="error">
        <b>本次快照的全部数据源均查询失败。</b>各块都写明了原因，页面不会用 0 顶替；等下次刷新恢复即可。
      </TwinBanner>,
    )
  } else if (snapshot?.status === 'degraded') {
    banners.push(
      <TwinBanner key="degraded" tone="warn">
        <b>部分数据源本次查询失败（{failed} 项）。</b>失败的块已单独标注，其余数字仍是本次真实取数。
      </TwinBanner>,
    )
  }
  return (
    <TwinScreen
      header={header}
      headingLevel={headingLevel}
      toolbar={
        chrome.presenting ? undefined : (
          <>
            {toolbar}
            {snapshot ? <span className="twin-cap twin-access">{accessText(snapshot)}</span> : null}
          </>
        )
      }
      banners={banners.length ? banners : undefined}
      layout={layout}
      lite={chrome.lite}
    >
      {children}
    </TwinScreen>
  )
}

/** 没有任何一次成功数据时的整屏：失败状态或骨架，一个数字都不出现。 */
export function TwinShellEmpty({
  chrome,
  title,
  subtitle,
  failure,
  onRetry,
}: {
  chrome: ScreenChrome
  title: string
  subtitle: string
  failure: ScreenFailure | null
  onRetry: () => void
}) {
  return (
    <TwinScreen
      header={
        <TwinHeader
          title={title}
          headingLevel={chrome.headingLevel}
          subtitle={`${subtitle}　｜　${failure ? '没有取到数据' : '正在取数，未取到之前不显示任何数值'}`}
          tabs={chrome.tabs}
          onNavigate={chrome.onNavigate}
          actions={chrome.pageActions}
        />
      }
      headingLevel={chrome.headingLevel}
      layout="full"
      lite={chrome.lite}
    >
      <TwinSlot slot="full">
        {failure ? (
          <FailurePanel result={failure} onRetry={onRetry} onRelogin={chrome.onRelogin} />
        ) : (
          <TwinStatePanel title="正在取数" description="首次取数完成前不显示任何数值。" />
        )}
      </TwinSlot>
    </TwinScreen>
  )
}
