import { useCallback, useMemo, type ReactNode } from 'react'
import { replaceIfChanged, useRefreshable } from '@ai-job-print/refresh'
import { formatDateTime, formatTime, type ScreenSnapshot, type ScreenTerminalTwin } from '@ai-job-print/shared'
import {
  TwinSlot,
  TwinStatePanel,
  TwinTerminalBoard,
  twinTerminalState,
  twinTerminalsFromCells,
  TWIN_STATE_TEXT,
  type TwinCityTerminal,
} from '@ai-job-print/ui'
import { loadAdminTerminalTwin } from '../../services/api/consoleScreen'
import { screenHref } from './screenTabs'
import { FailurePanel, TwinShell, TwinShellEmpty, failureOf, snapshotMeta, useAdminSnapshot, type ScreenChrome } from './screenView'

/**
 * 终端孪生：单台终端的设备模型与实时状态。
 *
 * 终端来自地址上的 id；没有 id 时按「正在打印 → 在线 → 其余」挑第一台，
 * 这样新窗口展示直接打开也有画面。终端清单取自政务总览同一份机队快照。
 */

const TITLE = '终端数字孪生'
const POLL_SECONDS = 15

function pickDefault(terminals: TwinCityTerminal[]): TwinCityTerminal | null {
  const rank = { pr: 0, ok: 1, wa: 2, off: 3, un: 4 } as const
  const sorted = [...terminals].sort((a, b) => rank[twinTerminalState(a)] - rank[twinTerminalState(b)] || a.code.localeCompare(b.code))
  return sorted[0] ?? null
}

function useTerminalTwin(terminalId: string) {
  const fetcher = useCallback(() => loadAdminTerminalTwin(terminalId), [terminalId])
  const result = useRefreshable<ScreenTerminalTwin>(
    `admin:screen:twin:${terminalId}`,
    fetcher,
    useMemo(
      () => ({
        intervalMs: POLL_SECONDS * 1000,
        merge: replaceIfChanged<ScreenTerminalTwin>,
        failPolicy: 'keep-last' as const,
      }),
      [],
    ),
  )
  return { ...result, failure: failureOf(result.error) }
}

export function TerminalTwinView({ chrome }: { chrome: ScreenChrome }) {
  const gov = useAdminSnapshot('gov', 60)
  const cells = gov.data?.metrics.fleetWall?.available ? gov.data.metrics.fleetWall.value.cells : []
  const terminals = twinTerminalsFromCells(cells)
  const requested = chrome.params.get('id')
  const chosen = requested !== null ? requested : pickDefault(terminals)?.id ?? null

  if (!gov.data && !requested) {
    return <TwinShellEmpty chrome={chrome} title={TITLE} subtitle="单台设备实时映射" failure={gov.failure} onRetry={() => void gov.refresh()} />
  }

  const toolbar = (
    <label className="twin-fgrp">
      <span className="twin-flabel">终端</span>
      <select
        className="twin-select"
        value={chosen ?? ''}
        onChange={(event) => chrome.onNavigate(screenHref('terminal', chrome.params, { id: event.target.value }))}
      >
        {chosen !== null && !terminals.some((t) => t.id === chosen) ? <option value={chosen}>当前终端</option> : null}
        {terminals.map((t) => (
          <option key={t.id} value={t.id}>
            {t.code}
            {t.name ? ` · ${t.name}` : ''} · {TWIN_STATE_TEXT[twinTerminalState(t)]}
          </option>
        ))}
      </select>
    </label>
  )

  if (chosen === null) {
    return (
      <TwinShell chrome={chrome} title={TITLE} subtitle="单台设备实时映射" layout="full" toolbar={toolbar} meta={gov.data ? snapshotMeta(gov.data) : null} pollSeconds={60} failure={gov.failure} onRefresh={() => void gov.refresh()} refreshing={gov.status === 'loading'}>
        <TwinSlot slot="full">
          <TwinStatePanel title="还没有可查看的终端" description="终端注册并上报心跳后，可在这里查看单台设备的实时状态。" />
        </TwinSlot>
      </TwinShell>
    )
  }

  return <TerminalTwinLive key={chosen} chrome={chrome} terminalId={chosen} toolbar={toolbar} fleetSnapshot={gov.data ?? null} />
}

function TerminalTwinLive({
  chrome,
  terminalId,
  toolbar,
  fleetSnapshot,
}: {
  chrome: ScreenChrome
  terminalId: string
  toolbar: ReactNode
  fleetSnapshot: ScreenSnapshot | null
}) {
  const twin = useTerminalTwin(terminalId)
  const current = twin.data && twin.data.terminal.id === terminalId ? twin.data : null
  const subtitle = current
    ? `${current.terminal.code}　｜　${current.terminal.areaLabel ?? '未设置所在区'}${current.terminal.locationLabel ? ` · ${current.terminal.locationLabel}` : ''}`
    : '单台设备实时映射'
  return (
    <TwinShell
      chrome={chrome}
      title={TITLE}
      subtitle={subtitle}
      layout={current ? 'terminal' : 'full'}
      toolbar={toolbar}
      meta={current ? { generatedAt: current.generatedAt, status: 'ok', failedSlices: 0, access: fleetSnapshot ? snapshotMeta(fleetSnapshot).access : null } : null}
      pollSeconds={POLL_SECONDS}
      failure={twin.failure}
      onRefresh={() => void twin.refresh()}
      refreshing={twin.status === 'loading'}
    >
      {current ? (
        <TwinTerminalBoard twin={current} formatClock={(iso) => formatTime(iso)} formatDateTime={(iso) => formatDateTime(iso)} unassignedAreaLabel="未设置所在区" />
      ) : (
        <TwinSlot slot="full">
          {twin.failure ? (
            <FailurePanel result={twin.failure} onRetry={() => void twin.refresh()} onRelogin={chrome.onRelogin} />
          ) : (
            <TwinStatePanel title="正在取数" description="首次取数完成前不显示任何数值。" />
          )}
        </TwinSlot>
      )}
    </TwinShell>
  )
}
