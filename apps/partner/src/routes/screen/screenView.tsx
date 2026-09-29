import { useCallback, useMemo } from 'react'
import { replaceIfChanged, useRefreshable } from '@ai-job-print/refresh'
import { formatDateTime, type ScreenSnapshot } from '@ai-job-print/shared'
import type { ScreenHeadingLevel, TwinChrome, TwinForbiddenCopy, TwinShellMeta } from '@ai-job-print/ui'
import { ScreenFetchError, loadPartnerScreenSnapshot, type ScreenFetchResult } from '../../services/api/consoleScreen'
import { accessText, countFailedSlices } from './screenMeta'

/**
 * 机构大屏的取数钩子与口径换算。外壳（页眉 / 横幅 / 整屏状态）在 @ai-job-print/ui 的 TwinShell，
 * 与管理员端共用；这里只负责把本机构的快照换成外壳要的几样东西。
 */

export { TwinFailurePanel as FailurePanel, TwinShell, TwinShellEmpty } from '@ai-job-print/ui'

export type ScreenFailure = Exclude<ScreenFetchResult, { kind: 'ok' }>

/**
 * 页面层下发给各页签的公共件。headingLevel: ScreenHeadingLevel 由页面按是否展示决定
 * （嵌入 h2 / 展示 h1），外壳用 headingLevel={headingLevel} 透传给页眉与面板，不自己决定层级。
 */
export type ScreenChrome = TwinChrome & { headingLevel: ScreenHeadingLevel }
export type ShellMeta = TwinShellMeta

export function failureOf(error: unknown): ScreenFailure | null {
  return error instanceof ScreenFetchError ? error.result : null
}

export function stampText(iso: string): string {
  return formatDateTime(iso, { fallback: '时间未知' })
}

export function snapshotMeta(snapshot: ScreenSnapshot): ShellMeta {
  return {
    generatedAtText: stampText(snapshot.generatedAt),
    status: snapshot.status,
    failedSlices: countFailedSlices(snapshot.metrics),
    access: accessText(snapshot),
  }
}

/**
 * ORG_REQUIRED 与「角色不符」必须分开说：机构管理员看到「无权限」会以为是权限没开，
 * 而真实原因是账号没有机构归属，大屏因此没有可展示的范围 —— 两者的下一步动作完全不同。
 */
export const describePartnerForbidden: TwinForbiddenCopy = (result) =>
  result.code === 'ORG_REQUIRED'
    ? {
        title: '当前账号未绑定机构',
        description: `${result.message}。大屏只展示本机构数据，账号没有机构归属时没有可展示的范围，请联系平台侧为该账号绑定机构。`,
      }
    : { title: '无权查看本大屏', description: result.message }

/** 本机构快照取数：不带任何 query；失败保留上一次成功的数据（keep-last），陈旧由横幅说明。 */
export function usePartnerSnapshot(pollSeconds: number) {
  const fetcher = useCallback(() => loadPartnerScreenSnapshot(), [])
  const result = useRefreshable<ScreenSnapshot>(
    'partner:screen',
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
