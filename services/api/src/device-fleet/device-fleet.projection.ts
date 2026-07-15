import type {
  DeviceFleetConfigArea,
  DeviceFleetHealth,
  DeviceFleetHealthReason,
  DeviceFleetIssue,
  DeviceFleetIssueKind,
  DeviceFleetOverview,
  DeviceFleetProjectionInput,
  DeviceFleetRawScreensaverConfig,
  DeviceFleetRawSmartCampusConfig,
  DeviceFleetRawTerminal,
  DeviceFleetRawToolboxConfig,
  DeviceFleetScreensaverSummary,
  DeviceFleetSmartCampusSummary,
  DeviceFleetTerminalOverview,
  DeviceFleetToolboxSummary,
} from './device-fleet.types'

export const DEVICE_FLEET_ONLINE_WINDOW_SECONDS = 180 as const
export const DEVICE_FLEET_ONLINE_WINDOW_MS = DEVICE_FLEET_ONLINE_WINDOW_SECONDS * 1000

interface RawConfigReference {
  readonly terminalId: string
}

interface ConfigReferences<TConfig extends RawConfigReference> {
  readonly canonical?: TConfig
  readonly legacy?: TConfig
}

interface AreaResolution<TSummary> {
  readonly summaries: ReadonlyMap<string, TSummary>
  readonly conflictTerminalIds: ReadonlySet<string>
  readonly issues: readonly DeviceFleetIssue[]
  readonly orphanCount: number
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function issueSortKey(issue: DeviceFleetIssue): string {
  return `${issue.area}/${issue.kind}/${issue.affectedTerminalCodes.join(',')}`
}

function countEnabledModules(json: string): number {
  try {
    const parsed: unknown = JSON.parse(json)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return 0
    return Object.values(parsed).filter((value) => value === true).length
  } catch {
    return 0
  }
}

function countToolboxItems(json: string): number {
  try {
    const parsed: unknown = JSON.parse(json)
    return Array.isArray(parsed) ? parsed.length : 0
  } catch {
    return 0
  }
}

function resolveHealth(
  terminal: DeviceFleetRawTerminal,
  now: Date,
): {
  readonly health: DeviceFleetHealth
  readonly healthReason: DeviceFleetHealthReason
  readonly lastHeartbeatAt: string | null
  readonly agentVersion: string | null
} {
  const heartbeat = terminal.heartbeats[0]
  if (!heartbeat) {
    return {
      health: 'unknown',
      healthReason: 'never_reported',
      lastHeartbeatAt: null,
      agentVersion: null,
    }
  }

  const heartbeatAgeMs = now.getTime() - heartbeat.createdAt.getTime()
  if (heartbeatAgeMs > DEVICE_FLEET_ONLINE_WINDOW_MS) {
    return {
      health: 'offline',
      healthReason: 'heartbeat_stale',
      lastHeartbeatAt: heartbeat.createdAt.toISOString(),
      agentVersion: heartbeat.agentVersion,
    }
  }

  if (heartbeat.status === 'offline') {
    return {
      health: 'offline',
      healthReason: 'agent_reported_offline',
      lastHeartbeatAt: heartbeat.createdAt.toISOString(),
      agentVersion: heartbeat.agentVersion,
    }
  }

  if (heartbeat.status === 'agent_degraded') {
    return {
      health: 'degraded',
      healthReason: 'agent_reported_degraded',
      lastHeartbeatAt: heartbeat.createdAt.toISOString(),
      agentVersion: heartbeat.agentVersion,
    }
  }

  if (heartbeat.status !== null && heartbeat.status !== 'online') {
    return {
      health: 'degraded',
      healthReason: 'agent_reported_error',
      lastHeartbeatAt: heartbeat.createdAt.toISOString(),
      agentVersion: heartbeat.agentVersion,
    }
  }

  return {
    health: 'healthy',
    healthReason: 'heartbeat_fresh',
    lastHeartbeatAt: heartbeat.createdAt.toISOString(),
    agentVersion: heartbeat.agentVersion,
  }
}

function resolveConfigArea<TConfig extends RawConfigReference, TSummary>(
  terminals: readonly DeviceFleetRawTerminal[],
  configs: readonly TConfig[],
  area: DeviceFleetConfigArea,
  emptySummary: (state: 'unconfigured' | 'conflict') => TSummary,
  configuredSummary: (
    config: TConfig,
    state: 'configured' | 'legacy_reference',
  ) => TSummary,
): AreaResolution<TSummary> {
  const terminalById = new Map(terminals.map((terminal) => [terminal.id, terminal]))
  const terminalByCode = new Map(terminals.map((terminal) => [terminal.terminalCode, terminal]))
  const referencesByTerminalId = new Map<string, ConfigReferences<TConfig>>()
  const conflictTerminalIds = new Set<string>()
  const issuesByKey = new Map<string, DeviceFleetIssue>()
  let orphanCount = 0

  const addIssue = (kind: DeviceFleetIssueKind, terminalCodes: readonly string[]): void => {
    const affectedTerminalCodes = [...new Set(terminalCodes)].sort(compareText)
    const issue = { area, kind, affectedTerminalCodes } as const
    issuesByKey.set(issueSortKey(issue), issue)
  }

  for (const config of configs) {
    const codeOwner = terminalByCode.get(config.terminalId)
    const idOwner = terminalById.get(config.terminalId)
    if (!codeOwner && !idOwner) {
      orphanCount += 1
      addIssue('orphan_config', [])
      continue
    }

    if (codeOwner && idOwner && codeOwner.id !== idOwner.id) {
      conflictTerminalIds.add(codeOwner.id)
      conflictTerminalIds.add(idOwner.id)
      addIssue('cross_terminal_reference_collision', [codeOwner.terminalCode, idOwner.terminalCode])
      continue
    }

    const owner = codeOwner ?? idOwner
    if (!owner) continue
    const current = referencesByTerminalId.get(owner.id) ?? {}
    referencesByTerminalId.set(owner.id, codeOwner
      ? { ...current, canonical: config }
      : { ...current, legacy: config })
  }

  for (const terminal of terminals) {
    const references = referencesByTerminalId.get(terminal.id)
    if (references?.canonical && references.legacy) {
      conflictTerminalIds.add(terminal.id)
      addIssue('dual_reference_config', [terminal.terminalCode])
    }
  }

  const summaries = new Map<string, TSummary>()
  for (const terminal of terminals) {
    const references = referencesByTerminalId.get(terminal.id)
    if (conflictTerminalIds.has(terminal.id)) {
      summaries.set(terminal.id, emptySummary('conflict'))
    } else if (references?.canonical) {
      summaries.set(terminal.id, configuredSummary(references.canonical, 'configured'))
    } else if (references?.legacy) {
      summaries.set(terminal.id, configuredSummary(references.legacy, 'legacy_reference'))
    } else {
      summaries.set(terminal.id, emptySummary('unconfigured'))
    }
  }

  return {
    summaries,
    conflictTerminalIds,
    issues: [...issuesByKey.values()].sort((left, right) => compareText(issueSortKey(left), issueSortKey(right))),
    orphanCount,
  }
}

function emptyScreensaverSummary(state: 'unconfigured' | 'conflict'): DeviceFleetScreensaverSummary {
  return { state, enabled: null, playlistConfigured: null, updatedAt: null }
}

function emptySmartCampusSummary(state: 'unconfigured' | 'conflict'): DeviceFleetSmartCampusSummary {
  return { state, enabled: null, enabledModuleCount: null, updatedAt: null }
}

function emptyToolboxSummary(state: 'unconfigured' | 'conflict'): DeviceFleetToolboxSummary {
  return { state, enabled: null, itemCount: null, updatedAt: null }
}

export function buildDeviceFleetOverview(
  input: DeviceFleetProjectionInput,
  now: Date,
): DeviceFleetOverview {
  const screensaver = resolveConfigArea<DeviceFleetRawScreensaverConfig, DeviceFleetScreensaverSummary>(
    input.terminals,
    input.screensaverConfigs,
    'screensaver',
    emptyScreensaverSummary,
    (config, state) => ({
      state,
      enabled: config.enabled,
      playlistConfigured: Boolean(config.playlistId),
      updatedAt: config.updatedAt.toISOString(),
    }),
  )
  const smartCampus = resolveConfigArea<DeviceFleetRawSmartCampusConfig, DeviceFleetSmartCampusSummary>(
    input.terminals,
    input.smartCampusConfigs,
    'smart_campus',
    emptySmartCampusSummary,
    (config, state) => ({
      state,
      enabled: config.enabled,
      enabledModuleCount: countEnabledModules(config.modulesJson),
      updatedAt: config.updatedAt.toISOString(),
    }),
  )
  const toolbox = resolveConfigArea<DeviceFleetRawToolboxConfig, DeviceFleetToolboxSummary>(
    input.terminals,
    input.toolboxConfigs,
    'toolbox',
    emptyToolboxSummary,
    (config, state) => ({
      state,
      enabled: config.enabled,
      itemCount: countToolboxItems(config.itemsJson),
      updatedAt: config.updatedAt.toISOString(),
    }),
  )

  const conflictTerminalIds = new Set([
    ...screensaver.conflictTerminalIds,
    ...smartCampus.conflictTerminalIds,
    ...toolbox.conflictTerminalIds,
  ])
  const terminals: DeviceFleetTerminalOverview[] = input.terminals.map((terminal) => ({
    terminalCode: terminal.terminalCode,
    displayName: terminal.displayName,
    locationLabel: terminal.locationLabel,
    orgName: terminal.org?.name ?? null,
    enabled: terminal.enabled,
    ...resolveHealth(terminal, now),
    hasConfigurationConflict: conflictTerminalIds.has(terminal.id),
    config: {
      screensaver: screensaver.summaries.get(terminal.id) ?? emptyScreensaverSummary('unconfigured'),
      smartCampus: smartCampus.summaries.get(terminal.id) ?? emptySmartCampusSummary('unconfigured'),
      toolbox: toolbox.summaries.get(terminal.id) ?? emptyToolboxSummary('unconfigured'),
    },
  })).sort((left, right) => compareText(left.terminalCode, right.terminalCode))

  const healthCount = (health: DeviceFleetHealth): number =>
    terminals.filter((terminal) => terminal.health === health).length
  const issues = [...screensaver.issues, ...smartCampus.issues, ...toolbox.issues]
    .sort((left, right) => compareText(issueSortKey(left), issueSortKey(right)))

  return {
    generatedAt: now.toISOString(),
    onlineWindowSeconds: DEVICE_FLEET_ONLINE_WINDOW_SECONDS,
    summary: {
      total: terminals.length,
      healthy: healthCount('healthy'),
      degraded: healthCount('degraded'),
      offline: healthCount('offline'),
      unknown: healthCount('unknown'),
      disabled: terminals.filter((terminal) => !terminal.enabled).length,
      configurationConflictTerminals: conflictTerminalIds.size,
      orphanConfigurationRecords: screensaver.orphanCount + smartCampus.orphanCount + toolbox.orphanCount,
    },
    terminals,
    issues,
  }
}
