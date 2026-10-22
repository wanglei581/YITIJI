import type { FirstOrderDeployment, FirstOrderProject, FirstOrderReportSummary } from '../../../../packages/shared/src/types/firstOrder.contract'
import type { ServiceDeployment, ServiceProject, ServiceReport } from '../generated/prisma/client'

export function deploymentView(row: ServiceDeployment): FirstOrderDeployment {
  return {
    id: row.id, projectId: row.projectId, terminalId: row.terminalId,
    terminalCode: row.terminalCode, locationLabel: row.locationLabel,
    startedAt: row.startedAt.toISOString(), endedAt: row.endedAt?.toISOString() ?? null,
  }
}
export function projectView(row: ServiceProject & { deployments: ServiceDeployment[] }): FirstOrderProject {
  return {
    id: row.id, orgId: row.orgId, name: row.name, reference: row.reference,
    serviceStartAt: row.serviceStartAt.toISOString(), serviceEndAt: row.serviceEndAt.toISOString(),
    serviceScope: row.serviceScope, supportContact: row.supportContact, version: row.version,
    createdAt: row.createdAt.toISOString(), deployments: row.deployments.map(deploymentView),
  }
}
export function reportView(row: ServiceReport): FirstOrderReportSummary {
  return {
    id: row.id, projectId: row.projectId, month: row.month, checksum: row.checksum,
    createdAt: row.createdAt.toISOString(), acknowledgedAt: row.acknowledgedAt?.toISOString() ?? null,
  }
}
