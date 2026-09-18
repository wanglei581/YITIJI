import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useRefreshable, replaceIfChanged } from '@ai-job-print/refresh'
import type { AdminScreenProfile, ScreenSnapshot } from '@ai-job-print/shared'
import {
  ScreenBody,
  ScreenDesk,
  ScreenGrid,
  ScreenHeader,
  ScreenStage,
  ScreenStatePanel,
  useScreenPresent,
} from '@ai-job-print/ui'
import { Page } from '../Page'
import {
  ScreenFetchError,
  loadAdminScreenSnapshot,
  normalizeAdminScreenProfile,
  isKnownAdminScreenProfile,
  type ScreenFetchResult,
} from '../../services/api/consoleScreen'
import { redirectToLogin } from '../../services/auth'
import { GovGrid } from './GovGrid'
import { OpsGrid } from './OpsGrid'
import { ScreenShell } from './screenView'

/**
 * 管理员数据大屏 —— `/screen?profile=gov|ops`。
 *
 * 一条路由两种观看距离：
 *   desk —— 默认，嵌在后台内容区里，运维在自己桌上看；
 *   wall —— 点「全屏演示」后的 1920×1080 舞台，领导 / 来访在墙上看。
 * 两档是同一份数据、同一套组件，只有栅格行高与字阶不同。
 *
 * `?profile=` 非法值在**前端**纠正为 gov 并改写地址，绝不把非法值发出去 ——
 * 服务端 DTO 是 `@IsIn(['gov','ops'])`，发出去只会换来一个 400，对看屏的人没有意义。
 */

const PROFILE_META: Record<
  AdminScreenProfile,
  { label: string; title: string; subtitle: string; pollSeconds: number }
> = {
  gov: {
    label: '政务版',
    title: '就业服务终端 · 运行概览',
    subtitle:
      '数据来源：本平台终端心跳、打印订单、AI 服务日志、已审核发布的第三方岗位与招聘会信息。每一块都带来源脚注，可逐条追溯。',
    pollSeconds: 60,
  },
  ops: {
    label: '运营版',
    title: '终端运营看板',
    subtitle: '面向运维与内容审核。含告警与队列，仅限管理员登录后访问，不投放到公开场所。',
    pollSeconds: 15,
  },
}

function resultOf(error: unknown): Exclude<ScreenFetchResult, { kind: 'ok' }> | null {
  return error instanceof ScreenFetchError ? error.result : null
}

/** 骨架：只有块位、没有数字。3 米外的呼吸动画只会晃眼，所以是静态的。 */
function ScreenSkeleton({ count }: { count: number }) {
  return (
    <ScreenGrid layout="gov">
      {Array.from({ length: count }, (_, index) => (
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

type ScreenFailure = Exclude<ScreenFetchResult, { kind: 'ok' }>

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
    return <ScreenStatePanel title="无权查看本大屏" description={result.message} />
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

export default function AdminScreenPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const rawProfile = searchParams.get('profile')
  const profile = normalizeAdminScreenProfile(rawProfile)
  const meta = PROFILE_META[profile]
  const { presenting, setPresenting } = useScreenPresent()
  const [offlineHint, setOfflineHint] = useState(false)
  // 动效可显式关掉（低性能机 / 录屏）。关掉后纵深层次保留，只是静止。
  const [motion, setMotion] = useState(true)

  // 非法或缺省的 profile 就地纠正到 gov，地址栏与实际视图保持一致。
  useEffect(() => {
    if (!isKnownAdminScreenProfile(rawProfile)) {
      setSearchParams({ profile: 'gov' }, { replace: true })
    }
  }, [rawProfile, setSearchParams])

  const fetcher = useCallback(() => loadAdminScreenSnapshot(profile), [profile])
  const { data, status, error, refresh } = useRefreshable<ScreenSnapshot>(
    `admin:screen:${profile}`,
    fetcher,
    useMemo(
      () => ({
        intervalMs: meta.pollSeconds * 1000,
        merge: replaceIfChanged<ScreenSnapshot>,
        failPolicy: 'keep-last' as const,
      }),
      [meta.pollSeconds],
    ),
  )

  const failure = resultOf(error)
  useEffect(() => {
    setOfflineHint(failure?.kind === 'offline')
  }, [failure])

  const actions = (
    <>
      <div className="ops-seg" role="group" aria-label="大屏版本">
        {(['gov', 'ops'] as const).map((key) => (
          <button
            key={key}
            type="button"
            className="ops-btn"
            aria-pressed={profile === key}
            onClick={() => setSearchParams({ profile: key }, { replace: true })}
          >
            {PROFILE_META[key].label}
          </button>
        ))}
      </div>
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
          title={meta.title}
          headingLevel={headingLevel}
          subtitle={meta.subtitle}
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
          title={meta.title}
          headingLevel={headingLevel}
          subtitle={meta.subtitle}
          windowText="正在取数，未取到之前不显示任何数值"
          actions={actions}
        />
        <ScreenSkeleton count={profile === 'ops' ? 12 : 10} />
      </ScreenBody>
    )
  } else {
    content = (
      <ScreenShell
        title={meta.title}
        headingLevel={headingLevel}
        subtitle={meta.subtitle}
        snapshot={data}
        pollSeconds={meta.pollSeconds}
        stale={Boolean(failure)}
        offline={offlineHint}
        failure={failure}
        onRelogin={() => redirectToLogin()}
        actions={actions}
      >
        {profile === 'ops' ? <OpsGrid metrics={data.metrics} /> : <GovGrid metrics={data.metrics} />}
      </ScreenShell>
    )
  }

  if (presenting) {
    return (
      <ScreenStage
        label={`${meta.title}（全屏演示）`}
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
      subtitle={`${meta.label} · 面向领导展示与日常巡检的只读视图，全部数值来自真实取数，未接入的指标如实标注`}
    >
      <ScreenDesk label={meta.title} motion={motion}>{content}</ScreenDesk>
    </Page>
  )
}
