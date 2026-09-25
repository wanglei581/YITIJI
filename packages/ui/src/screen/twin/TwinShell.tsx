import type { ReactNode } from 'react'
import type { ScreenHeadingLevel } from '../ScreenFrame'
import { TwinBanner, TwinHeader, TwinScreen, TwinSlot, TwinStatePanel, type TwinLayout, type TwinTab } from './TwinFrame'

/**
 * 孪生大屏的外壳：页眉（标题 / 页签 / 时钟 / 动作）+ 整屏级横幅 + 块位栅格 + 取数失败的整屏状态。
 * 管理员与机构两端共用；取数与时间格式化（上海时区）由各端做好后传入，本包不依赖 shared。
 *
 * 各页签只写「有数据时长什么样」，登录过期、断网、部分失败的说法统一在这里：
 * 旧数据一个都不清、一个 0 都不伪造，横幅说清旧在哪儿、该怎么办。
 */

export type TwinFailure =
  | { kind: 'mock' }
  | { kind: 'unauthorized' }
  | { kind: 'forbidden'; code: string; message: string }
  | { kind: 'offline' }
  | { kind: 'failed'; message: string }

export type TwinForbiddenCopy = (result: Extract<TwinFailure, { kind: 'forbidden' }>) => { title: string; description: string }

/** 页面层下发给各页签的公共件。 */
export interface TwinChrome {
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
  /** 机构端「账号未绑定机构」等需要单独说明的 403。 */
  describeForbidden?: TwinForbiddenCopy
}

/** 页眉时间戳与横幅需要的最小信息；generatedAtText 由调用方按上海时区格式化。 */
export interface TwinShellMeta {
  generatedAtText: string
  status: 'ok' | 'degraded' | 'unavailable'
  failedSlices: number
  access: string | null
}

export function TwinFailurePanel({
  result,
  onRetry,
  onRelogin,
  describeForbidden,
}: {
  result: TwinFailure
  onRetry: () => void
  onRelogin: () => void
  describeForbidden?: TwinForbiddenCopy
}) {
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
    const copy = describeForbidden ? describeForbidden(result) : { title: '无权查看本大屏', description: result.message }
    return <TwinStatePanel title={copy.title} description={copy.description} />
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
  chrome: TwinChrome
  title: string
  subtitle: string
  layout: TwinLayout
  /** 桌面档筛选栏；展示模式不渲染。 */
  toolbar?: ReactNode
  /** 已取到的主数据的时间与状态；没有时由调用方渲染 TwinShellEmpty。 */
  meta: TwinShellMeta | null
  pollSeconds: number
  /** 最近一次刷新失败的原因（已有数据时也要传，身份类失败要说清楚）。 */
  failure: TwinFailure | null
  onRefresh: () => void
  refreshing: boolean
  children: ReactNode
}

export function TwinShell({ chrome, title, subtitle, layout, toolbar, meta, pollSeconds, failure, onRefresh, refreshing, children }: TwinShellProps) {
  const headingLevel = chrome.headingLevel
  const stamp = meta ? `数据时间 ${meta.generatedAtText} · 每 ${pollSeconds} 秒刷新` : '正在取数，未取到之前不显示任何数值'
  const banners: ReactNode[] = []
  if (meta && failure?.kind === 'offline') {
    banners.push(
      <TwinBanner key="offline" tone="error">
        <b>与服务器断开</b>，正在按刷新节奏重试。屏上仍是上次成功取数的数据（{meta.generatedAtText}），没有用 0 代替。
      </TwinBanner>,
    )
  } else if (meta && failure?.kind === 'failed') {
    banners.push(
      <TwinBanner key="stale" tone="warn">
        最近一次刷新失败，屏上是 {meta.generatedAtText} 取到的数据。{failure.message}
      </TwinBanner>,
    )
  }
  if (meta && failure?.kind === 'unauthorized') {
    banners.push(
      <TwinBanner key="auth" tone="error">
        <b>登录已过期</b>，屏上数字停在上一次成功取数的时刻。本期未签发免登录的只读展示令牌，重新登录后会继续自动刷新。
        <button type="button" className="twin-btn" onClick={chrome.onRelogin}>
          重新登录
        </button>
      </TwinBanner>,
    )
  }
  if (meta && failure?.kind === 'forbidden') {
    banners.push(
      <TwinBanner key="forbidden" tone="error">
        <b>已无权查看本大屏</b>，屏上数字停在权限变更前的最后一次成功取数。{failure.message}
      </TwinBanner>,
    )
  }
  if (meta?.status === 'unavailable') {
    banners.push(
      <TwinBanner key="unavailable" tone="error">
        <b>本次快照的全部数据源均查询失败。</b>各块都写明了原因，页面不会用 0 顶替；等下次刷新恢复即可。
      </TwinBanner>,
    )
  } else if (meta?.status === 'degraded') {
    banners.push(
      <TwinBanner key="degraded" tone="warn">
        <b>部分数据源本次查询失败（{meta.failedSlices} 项）。</b>失败的块已单独标注，其余数字仍是本次真实取数。
      </TwinBanner>,
    )
  }
  return (
    <TwinScreen
      header={
        <TwinHeader
          title={title}
          headingLevel={headingLevel}
          subtitle={`${subtitle}　｜　${stamp}`}
          tabs={chrome.tabs}
          onNavigate={chrome.onNavigate}
          actions={chrome.presenting ? chrome.pageActions : undefined}
        />
      }
      headingLevel={headingLevel}
      toolbar={
        chrome.presenting ? undefined : (
          <>
            {toolbar}
            {meta?.access ? <span className="twin-cap">{meta.access}</span> : null}
            <div className="twin-toolbar-actions">
              <button type="button" className="twin-btn" onClick={onRefresh} disabled={refreshing}>
                刷新
              </button>
              {chrome.pageActions}
            </div>
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
  chrome: TwinChrome
  title: string
  subtitle: string
  failure: TwinFailure | null
  onRetry: () => void
}) {
  const headingLevel = chrome.headingLevel
  return (
    <TwinScreen
      header={
        <TwinHeader
          title={title}
          headingLevel={headingLevel}
          subtitle={`${subtitle}　｜　${failure ? '没有取到数据' : '正在取数，未取到之前不显示任何数值'}`}
          tabs={chrome.tabs}
          onNavigate={chrome.onNavigate}
          actions={chrome.presenting ? chrome.pageActions : undefined}
        />
      }
      toolbar={chrome.presenting ? undefined : <div className="twin-toolbar-actions">{chrome.pageActions}</div>}
      headingLevel={headingLevel}
      layout="full"
      lite={chrome.lite}
    >
      <TwinSlot slot="full">
        {failure ? (
          <TwinFailurePanel result={failure} onRetry={onRetry} onRelogin={chrome.onRelogin} describeForbidden={chrome.describeForbidden} />
        ) : (
          <TwinStatePanel title="正在取数" description="首次取数完成前不显示任何数值。" />
        )}
      </TwinSlot>
    </TwinScreen>
  )
}
