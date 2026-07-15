export type DeviceFleetHealth = 'healthy' | 'degraded' | 'offline' | 'unknown'

export type DeviceFleetHealthReason =
  | 'heartbeat_fresh'
  | 'agent_reported_degraded'
  | 'agent_reported_offline'
  | 'agent_reported_error'
  | 'heartbeat_stale'
  | 'never_reported'

export type DeviceFleetConfigState =
  | 'unconfigured'
  | 'configured'
  | 'legacy_reference'
  | 'conflict'

export type DeviceFleetConfigArea = 'screensaver' | 'smart_campus' | 'toolbox'

export type DeviceFleetIssueKind =
  | 'dual_reference_config'
  | 'cross_terminal_reference_collision'
  | 'orphan_config'

export interface DeviceFleetScreensaverSummary {
  readonly state: DeviceFleetConfigState
  readonly enabled: boolean | null
  readonly playlistConfigured: boolean | null
  readonly updatedAt: string | null
}

export interface DeviceFleetSmartCampusSummary {
  readonly state: DeviceFleetConfigState
  readonly enabled: boolean | null
  readonly enabledModuleCount: number | null
  readonly updatedAt: string | null
}

export interface DeviceFleetToolboxSummary {
  readonly state: DeviceFleetConfigState
  readonly enabled: boolean | null
  readonly itemCount: number | null
  readonly updatedAt: string | null
}

export interface DeviceFleetTerminalOverview {
  readonly terminalCode: string
  readonly displayName: string | null
  readonly locationLabel: string | null
  readonly orgName: string | null
  readonly enabled: boolean
  readonly health: DeviceFleetHealth
  readonly healthReason: DeviceFleetHealthReason
  readonly lastHeartbeatAt: string | null
  readonly agentVersion: string | null
  readonly hasConfigurationConflict: boolean
  readonly config: {
    readonly screensaver: DeviceFleetScreensaverSummary
    readonly smartCampus: DeviceFleetSmartCampusSummary
    readonly toolbox: DeviceFleetToolboxSummary
  }
}

export interface DeviceFleetIssue {
  readonly area: DeviceFleetConfigArea
  readonly kind: DeviceFleetIssueKind
  readonly affectedTerminalCodes: readonly string[]
}

export interface DeviceFleetOverview {
  readonly generatedAt: string
  readonly onlineWindowSeconds: 180
  readonly summary: {
    readonly total: number
    readonly healthy: number
    readonly degraded: number
    readonly offline: number
    readonly unknown: number
    readonly disabled: number
    readonly configurationConflictTerminals: number
    readonly orphanConfigurationRecords: number
  }
  readonly terminals: readonly DeviceFleetTerminalOverview[]
  readonly issues: readonly DeviceFleetIssue[]
}

export interface DeviceFleetRawHeartbeat {
  readonly status: string | null
  readonly agentVersion: string | null
  readonly createdAt: Date
}

export interface DeviceFleetRawTerminal {
  readonly id: string
  readonly terminalCode: string
  readonly displayName: string | null
  readonly locationLabel: string | null
  readonly enabled: boolean
  readonly org: { readonly name: string } | null
  readonly heartbeats: readonly DeviceFleetRawHeartbeat[]
}

interface DeviceFleetRawConfigBase {
  readonly terminalId: string
  readonly enabled: boolean
  readonly updatedAt: Date
}

export interface DeviceFleetRawScreensaverConfig extends DeviceFleetRawConfigBase {
  readonly playlistId: string | null
}

export interface DeviceFleetRawSmartCampusConfig extends DeviceFleetRawConfigBase {
  readonly modulesJson: string
}

export interface DeviceFleetRawToolboxConfig extends DeviceFleetRawConfigBase {
  readonly itemsJson: string
}

export interface DeviceFleetProjectionInput {
  readonly terminals: readonly DeviceFleetRawTerminal[]
  readonly screensaverConfigs: readonly DeviceFleetRawScreensaverConfig[]
  readonly smartCampusConfigs: readonly DeviceFleetRawSmartCampusConfig[]
  readonly toolboxConfigs: readonly DeviceFleetRawToolboxConfig[]
}
