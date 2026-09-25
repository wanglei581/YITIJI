import { useCallback, useMemo } from 'react'
import { replaceIfChanged, useRefreshable } from '@ai-job-print/refresh'
import { formatDateTime, type AdminScreenProfile, type ScreenSnapshot } from '@ai-job-print/shared'
import type { ScreenHeadingLevel, TwinChrome, TwinShellMeta } from '@ai-job-print/ui'
import { ScreenFetchError, loadAdminScreenSnapshot, type ScreenFetchResult } from '../../services/api/consoleScreen'
import { accessText, countFailedSlices } from './screenMeta'

/**
 * 管理员大屏的取数钩子与口径换算。外壳（页眉 / 横幅 / 整屏状态）在 @ai-job-print/ui 的 TwinShell，
 * 两端共用；这里只负责把本端的快照换成外壳要的几样东西。
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
