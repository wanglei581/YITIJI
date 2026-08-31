/**
 * Release observation is intentionally non-executing. It can only read this
 * terminal's active plan and report the version this Agent is already running.
 * Package retrieval, validation, installation, service management and local
 * persistence belong to a later, separately approved updater phase.
 */
import fs from 'fs'
import path from 'path'
import type { AgentConfig } from './types'
import { createApiClient, axiosErrorMessage, isUnauthorizedHttpError } from './api-client'
import { log, warn } from '../logger'

export const RELEASE_OBSERVATION_PROTOCOL = 'release-observation-v1'

export interface ReleaseObservationPlan {
  planId: string
  planVersion: number
  artifactVersion: string
  observationProtocolVersion: string
}

interface ReleaseObservationPlanResponse {
  plan: ReleaseObservationPlan | null
}

interface RuntimeManifest {
  productVersion?: unknown
}

/**
 * The ProgramData config is deliberately not a runtime-version source: it can
 * survive an MSI upgrade. The staged installation manifest is the local
 * package identity written alongside the installed runtime.
 */
export function readInstalledRuntimeVersion(): string | null {
  const programFiles = process.env.ProgramW6432 || process.env.ProgramFiles
  if (!programFiles) return null

  try {
    const manifestPath = path.join(programFiles, 'AIJobPrintAgent', 'manifest.json')
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as RuntimeManifest
    if (typeof manifest.productVersion !== 'string') return null
    const version = manifest.productVersion.trim()
    return version.length > 0 && version.length <= 64 ? version : null
  } catch {
    return null
  }
}

/**
 * Best-effort control-plane observation. Failure is deliberately isolated from
 * heartbeat/claim/print behavior because this phase has no operational action.
 */
export async function observeReleasePlan(config: AgentConfig): Promise<void> {
  if (!config.terminalId || !config.agentToken) return
  const client = createApiClient(config.apiBaseUrl, config.agentToken, config.terminalId)
  try {
    const planResponse = await client.get<ReleaseObservationPlanResponse>(
      `/terminals/${config.terminalId}/release-observation-plan`,
    )
    const plan = planResponse.data.plan
    if (!plan) return
    if (plan.observationProtocolVersion !== RELEASE_OBSERVATION_PROTOCOL) {
      warn(`release-observation: incompatible protocol=${plan.observationProtocolVersion}; no action taken`)
      return
    }
    const runtimeVersion = readInstalledRuntimeVersion()
    await client.put(`/terminals/${config.terminalId}/release-observation`, {
      seenPlanId: plan.planId,
      seenPlanVersion: plan.planVersion,
      runtimeVersion,
      observationProtocolVersion: RELEASE_OBSERVATION_PROTOCOL,
      observedAt: new Date().toISOString(),
    })
    log(`release-observation: plan=${plan.planId} target=${plan.artifactVersion} current=${runtimeVersion ?? 'unverified'}`)
  } catch (error) {
    if (isUnauthorizedHttpError(error)) {
      warn('release-observation: authorization unavailable; no action taken')
      return
    }
    warn(`release-observation: unavailable — ${axiosErrorMessage(error)}`)
  }
}
