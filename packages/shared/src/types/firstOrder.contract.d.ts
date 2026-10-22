/** First-order institutional delivery. All usage values are server aggregates. */
export interface FirstOrderProjectInput {
  name: string
  reference: string
  serviceStartAt: string
  serviceEndAt: string
  serviceScope: string
  supportContact: string
}

export interface FirstOrderTerminal {
  id: string
  terminalCode: string
  displayName: string | null
  locationLabel: string | null
  online: boolean
  printerStatus: string | null
  lastHeartbeatAt: string | null
}

export interface FirstOrderDeployment {
  id: string
  projectId: string
  terminalId: string
  terminalCode: string
  locationLabel: string
  startedAt: string
  endedAt: string | null
}

export interface FirstOrderProject extends FirstOrderProjectInput {
  id: string
  orgId: string
  version: number
  createdAt: string
  deployments: FirstOrderDeployment[]
}

export type FirstOrderIssue = 'offline' | 'paper' | 'jam' | 'quality' | 'scan' | 'other'
export type FirstOrderIncidentStatus = 'open' | 'processing' | 'resolved' | 'closed'
export type FirstOrderIncidentAction = 'start' | 'resolve' | 'confirm' | 'reopen'
export interface FirstOrderIncidentEvent {
  action: string
  note: string
  actorRole: 'admin' | 'partner'
  createdAt: string
}
export interface FirstOrderIncident {
  id: string
  projectId: string
  deploymentId: string
  terminalCode: string
  issueCode: FirstOrderIssue
  note: string
  status: FirstOrderIncidentStatus
  assignee: string | null
  resolution: string | null
  version: number
  createdAt: string
  updatedAt: string
  resolvedAt: string | null
  closedAt: string | null
  events: FirstOrderIncidentEvent[]
  historyTruncated: boolean
}
export interface FirstOrderIncidentInput {
  deploymentId: string
  issueCode: FirstOrderIssue
  note: string
  requestKey: string
}
export interface FirstOrderIncidentUpdate {
  action: FirstOrderIncidentAction
  version: number
  note: string
  assignee?: string
}
export type FirstOrderMetricState = 'measured' | 'sample_suppressed' | 'not_recorded' | 'unverified'
export interface FirstOrderMetric {
  value: number | null
  state: FirstOrderMetricState
  note: string
}
export interface FirstOrderReportSnapshot {
  schemaVersion: 'first-order-v1'
  project: FirstOrderProjectInput & { id: string }
  month: string
  timezone: 'Asia/Shanghai'
  window: { from: string; to: string }
  generatedAt: string
  complete: boolean
  limitations: string[]
  metrics: {
    sessions: FirstOrderMetric
    printedTasks: FirstOrderMetric
    printedFaces: FirstOrderMetric
    unconfirmedPrints: FirstOrderMetric
    failedPrints: FirstOrderMetric
    completedScans: FirstOrderMetric
    offlineMinutes: FirstOrderMetric
  }
  deployments: FirstOrderDeployment[]
  incidents: { open: number; processing: number; resolved: number; closed: number }
}
export interface FirstOrderReportSummary {
  id: string
  projectId: string
  month: string
  createdAt: string
  checksum: string
  acknowledgedAt: string | null
}
export interface FirstOrderReport extends FirstOrderReportSummary {
  snapshot: FirstOrderReportSnapshot
}
export interface FirstOrderOverview {
  projects: FirstOrderProject[]
  terminals: FirstOrderTerminal[]
  incidents: FirstOrderIncident[]
  reports: FirstOrderReportSummary[]
}
