import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRefreshable, replaceIfChanged } from '@ai-job-print/refresh'
import type { ScreenSnapshot } from '@ai-job-print/shared'
import {
  ScreenBody,
  ScreenDesk,
  ScreenGrid,
  ScreenHeader,
  ScreenStage,
  ScreenStatePanel,
  useScreenPresent,
} from '@ai-job-print/ui'
import { FRONTEND_HINT, Page, withFrontendHint } from '../Page'
import {
  ScreenFetchError,
  loadPartnerScreenSnapshot,
  type ScreenFetchResult,
} from '../../services/api/consoleScreen'
import { redirectToLogin } from '../../services/auth'
import { PartnerGrid } from './PartnerGrid'
import { ScreenShell } from './screenView'

/**
 * 合作机构数据大屏 —— `/screen`，无任何 query 参数。
 *
 * 与管理员版的差别只有三处：没有 profile 切换（机构只有一种视图）、
 * 数据全部按本机构收窄、账号没绑机构时要单独提示（403 ORG_REQUIRED，
 * 与「角色不符」不是一回事，否则机构管理员会以为是权限没开）。
 */

const TITLE = '本机构运营概览'
const SUBTITLE =
  '数据来源：本机构终端心跳、本机构已审核发布的岗位 / 招聘会 / 政策 / 企业资料、本机构数据源同步日志。每一块都带来源脚注。'
const POLL_SECONDS = 60

type ScreenFailure = Exclude<ScreenFetchResult, { kind: 'ok' }>

function resultOf(error: unknown): ScreenFailure | null {
  return error instanceof ScreenFetchError ? error.result : null
}

function ScreenSkeleton() {
  return (
    <ScreenGrid layout="partner">
      {Array.from({ length: 8 }, (_, index) => (
        <div className="ops-card ops-span-3" key={index} aria-hidden="true">
          <div className="ops-skel" style={{ height: 14, width: '38%' }} />
          <div className="ops-body">
            <div className="ops-skel" style={{ height: 28, width: '52%' }} />
          </div>
          <div className="ops-foot">
            <div className="ops-skel" style={{ height: 10, width: '84%' }} />
          </div>
        </div>
      ))}
    </ScreenGrid>
  )
}

function FailurePanel({ result, onRetry }: { result: ScreenFailure; onRetry: () => void }) {
  if (result.kind === 'mock') {
    return (
      <ScreenStatePanel
        title="演示模式不展示大屏数值"
        description="当前构建为 mock 模式（VITE_API_MODE 不等于 http），没有连接真实后端。大屏只展示真实取数，因此这里一个数字都不显示。联调请配置 VITE_API_MODE=http 与 VITE_API_BASE_URL。"
      />
    )
  }
  if (result.kind === 'unauthorized') {
    return (
      <ScreenStatePanel
        title="登录已过期"
        description="大屏只在已登录的后台会话里展示，本期未签发免登录的只读展示令牌。重新登录后即可继续显示。"
        action={
          <button type="button" className="ops-btn" onClick={() => redirectToLogin()}>
            重新登录
          </button>
        }
      />
    )
  }
  if (result.kind === 'forbidden') {
    return (
      <ScreenStatePanel
        title={result.code === 'ORG_REQUIRED' ? '当前账号未绑定机构' : '无权查看本大屏'}
        description={
          result.code === 'ORG_REQUIRED'
            ? `${result.message}。大屏只展示本机构数据，账号没有机构归属时没有可展示的范围，请联系平台侧为该账号绑定机构。`
            : result.message
        }
      />
    )
  }
  if (result.kind === 'offline') {
    return (
      <ScreenStatePanel
        title="与服务器断开"
        description="没有取到任何一次成功数据，因此这里不显示任何数值。恢复网络后可手动重试。"
        action={
          <button type="button" className="ops-btn" onClick={onRetry}>
            重试
          </button>
        }
      />
    )
  }
  return (
    <ScreenStatePanel
      title="大屏数据获取失败"
      description={result.message}
      action={
        <button type="button" className="ops-btn" onClick={onRetry}>
          重试
        </button>
      }
    />
  )
}

export default function PartnerScreenPage() {
  const { presenting, setPresenting } = useScreenPresent()
  const [offlineHint, setOfflineHint] = useState(false)
  // 动效可显式关掉（低性能机 / 录屏）。关掉后纵深层次保留，只是静止。
  const [motion, setMotion] = useState(true)

  const fetcher = useCallback(() => loadPartnerScreenSnapshot(), [])
  const { data, status, error, refresh } = useRefreshable<ScreenSnapshot>(
    'partner:screen',
    fetcher,
    useMemo(
      () => ({
        intervalMs: POLL_SECONDS * 1000,
        merge: replaceIfChanged<ScreenSnapshot>,
        failPolicy: 'keep-last' as const,
      }),
      [],
    ),
  )

  const failure = resultOf(error)
  useEffect(() => {
    setOfflineHint(failure?.kind === 'offline')
  }, [failure])

  const actions = (
    <>
      <button
        type="button"
        className="ops-btn"
        onClick={() => {
          void refresh()
        }}
        disabled={status === 'loading'}
      >
        刷新
      </button>
      <button
        type="button"
        className="ops-btn"
        aria-pressed={!motion}
        onClick={() => setMotion(!motion)}
      >
        {motion ? '关闭动效' : '开启动效'}
      </button>
      <button
        type="button"
        className="ops-btn"
        aria-pressed={presenting}
        onClick={() => setPresenting(!presenting)}
      >
        {presenting ? '退出全屏演示' : '全屏演示'}
      </button>
    </>
  )

  // 标题层级随寄居方式变：嵌在 Page 里外层 PageHeader 已是 h1，这里降 h2；
  // 全屏演示时覆盖层就是整份文档，标题回到 h1。不做条件 CSS 隐藏 —— 那只骗眼睛，
  // 读屏器与 locator('h1') 照样看见两个。
  const headingLevel = presenting ? 1 : 2

  let content: JSX.Element
  if (!data && failure) {
    content = (
      <ScreenBody>
        <ScreenHeader
          title={TITLE}
          headingLevel={headingLevel}
          subtitle={SUBTITLE}
          actions={actions}
        />
        <FailurePanel
          result={failure}
          onRetry={() => {
            void refresh()
          }}
        />
      </ScreenBody>
    )
  } else if (!data) {
    content = (
      <ScreenBody>
        <ScreenHeader
          title={TITLE}
          headingLevel={headingLevel}
          subtitle={SUBTITLE}
          windowText="正在取数，未取到之前不显示任何数值"
          actions={actions}
        />
        <ScreenSkeleton />
      </ScreenBody>
    )
  } else {
    content = (
      <ScreenShell
        title={TITLE}
        headingLevel={headingLevel}
        subtitle={SUBTITLE}
        snapshot={data}
        pollSeconds={POLL_SECONDS}
        stale={Boolean(failure)}
        offline={offlineHint}
        failure={failure}
        onRelogin={() => redirectToLogin()}
        actions={actions}
      >
        <PartnerGrid metrics={data.metrics} />
      </ScreenShell>
    )
  }

  if (presenting) {
    return (
      <ScreenStage
        label={`${TITLE}（全屏演示）`}
        motion={motion}
        onExit={() => setPresenting(false)}
      >
        {content}
      </ScreenStage>
    )
  }

  return (
    <Page
      title="数据大屏"
      subtitle={withFrontendHint(
        '本机构运营概览只读视图，可全屏演示；全部数值来自真实取数，给不出机构维度的指标如实标注',
        FRONTEND_HINT.screen,
      )}
    >
      <ScreenDesk label={TITLE} motion={motion}>{content}</ScreenDesk>
    </Page>
  )
}
