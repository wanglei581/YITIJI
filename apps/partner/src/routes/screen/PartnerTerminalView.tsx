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
import { loadPartnerTerminalTwin } from '../../services/api/consoleScreen'
import { screenHref } from './screenTabs'
import { FailurePanel, TwinShell, TwinShellEmpty, failureOf, snapshotMeta, stampText, usePartnerSnapshot, type ScreenChrome } from './screenView'

/**
 * 终端孪生（机构版）：与管理员端同一块设备模型，只能选本机构的终端。
 *
 * 终端来自地址上的 id；没有 id 时按「正在打印 → 在线 → 其余」挑第一台，
 * 这样新窗口展示直接打开也有画面。别家终端与不存在的终端服务端一律 404，
 * 前端不带任何机构标识。
 */

const TITLE = '终端数字孪生'
const SUBTITLE = '本机构终端 · 单台设备实时映射'
const UNASSIGNED = '未设置服务点位'
const POLL_SECONDS = 15

/** 新窗口展示直接打开时优先给一台正在工作的：打印中 → 在线 → 告警 → 离线 → 未上报，同状态按编号。 */
function pickDefault(terminals: TwinCityTerminal[]): TwinCityTerminal | null {
  const rank = { pr: 0, ok: 1, wa: 2, off: 3, un: 4 } as const
  const sorted = [...terminals].sort((a, b) => rank[twinTerminalState(a)] - rank[twinTerminalState(b)] || a.code.localeCompare(b.code))
  return sorted[0] ?? null
}

function useTerminalTwin(terminalId: string) {
  const fetcher = useCallback(() => loadPartnerTerminalTwin(terminalId), [terminalId])
  const result = useRefreshable<ScreenTerminalTwin>(
    `partner:screen:twin:${terminalId}`,
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

export function PartnerTerminalView({ chrome }: { chrome: ScreenChrome }) {
  const snap = usePartnerSnapshot(60)
  const cells = snap.data?.metrics.fleetWall?.available ? snap.data.metrics.fleetWall.value.cells : []
  const terminals = twinTerminalsFromCells(cells, 'location')
  const requested = chrome.params.get('id')
  const chosen = requested !== null ? requested : pickDefault(terminals)?.id ?? null

  if (!snap.data && !requested) {
    return <TwinShellEmpty chrome={chrome} title={TITLE} subtitle={SUBTITLE} failure={snap.failure} onRetry={() => void snap.refresh()} />
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
            {t.area ? ` · ${t.area}` : ''} · {TWIN_STATE_TEXT[twinTerminalState(t)]}
          </option>
        ))}
      </select>
    </label>
  )

  if (chosen === null) {
    return (
      <TwinShell
        chrome={chrome}
        title={TITLE}
        subtitle={SUBTITLE}
        layout="full"
        toolbar={toolbar}
        meta={snap.data ? snapshotMeta(snap.data) : null}
        pollSeconds={60}
        failure={snap.failure}
        onRefresh={() => void snap.refresh()}
        refreshing={snap.status === 'loading'}
      >
        <TwinSlot slot="full">
          <TwinStatePanel title="本机构还没有可查看的终端" description="终端登记到本机构并上报心跳后，可在这里查看单台设备的实时状态。" />
        </TwinSlot>
      </TwinShell>
    )
  }

  return <PartnerTerminalLive key={chosen} chrome={chrome} terminalId={chosen} toolbar={toolbar} fleetSnapshot={snap.data ?? null} />
}

function PartnerTerminalLive({
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
    ? `${current.terminal.code}　｜　${current.terminal.locationLabel ?? current.terminal.areaLabel ?? UNASSIGNED}`
    : SUBTITLE
  return (
    <TwinShell
      chrome={chrome}
      title={TITLE}
      subtitle={subtitle}
      layout={current ? 'terminal' : 'full'}
      toolbar={toolbar}
      meta={current ? { generatedAtText: stampText(current.generatedAt), status: 'ok', failedSlices: 0, access: fleetSnapshot ? snapshotMeta(fleetSnapshot).access : null } : null}
      pollSeconds={POLL_SECONDS}
      failure={twin.failure}
      onRefresh={() => void twin.refresh()}
      refreshing={twin.status === 'loading'}
    >
      {current ? (
        <TwinTerminalBoard twin={current} formatClock={(iso) => formatTime(iso)} formatDateTime={(iso) => formatDateTime(iso)} unassignedAreaLabel={UNASSIGNED} />
      ) : (
        <TwinSlot slot="full">
          {twin.failure ? (
            <FailurePanel result={twin.failure} onRetry={() => void twin.refresh()} onRelogin={chrome.onRelogin} describeForbidden={chrome.describeForbidden} />
          ) : (
            <TwinStatePanel title="正在取数" description="首次取数完成前不显示任何数值。" />
          )}
        </TwinSlot>
      )}
    </TwinShell>
  )
}
