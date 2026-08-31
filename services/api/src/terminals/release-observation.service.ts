import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { AuditService } from '../audit/audit.service'
import { PrismaService } from '../prisma/prisma.service'
import type { CreateReleaseObservationPlanDto } from './dto/create-release-observation-plan.dto'
import type { ReportReleaseObservationDto } from './dto/report-release-observation.dto'
import type { UpdateReleaseObservationPlanDto } from './dto/update-release-observation-plan.dto'
import { TerminalCredentialSecurityService } from './terminal-credential-security.service'
import { isUniqueConstraintError } from './terminal-utils'

const OBSERVATION_PROTOCOL = 'release-observation-v1'
const HASH = /^[A-F0-9]{64}$/
const AUTHENTICODE_THUMBPRINT = /^[A-F0-9]{40}$/
const MAX_FUTURE_OBSERVATION_MS = 60_000

type AuditContext = {
  actorId: string | null
  actorRole: string
  ipAddress?: string | null
  userAgent?: string | null
  requestId?: string | null
}

export type ReleaseObservationState = 'draft' | 'paused' | 'expired' | 'not_seen' | 'unverified' | 'current' | 'mismatch' | 'stale'

export interface AdminReleaseObservationView {
  planId: string
  planStatus: 'draft' | 'active' | 'paused' | 'cancelled'
  planVersion: number
  targetVersion: string
  signerTrustLevel: string
  observedVersion: string | null
  observedAt: string | null
  state: ReleaseObservationState
}

export interface AgentReleaseObservationPlanView {
  planId: string
  planVersion: number
  artifactVersion: string
  observationProtocolVersion: string
}

function normalizeHash(value: string): string {
  const normalized = value.trim().toUpperCase()
  if (!HASH.test(normalized)) {
    throw new BadRequestException({ error: { code: 'RELEASE_HASH_INVALID', message: '制品摘要必须是 64 位 SHA-256 十六进制值' } })
  }
  return normalized
}

function normalizeSignerCertificateThumbprint(value: string): string {
  const normalized = value.trim().toUpperCase()
  if (!AUTHENTICODE_THUMBPRINT.test(normalized)) {
    throw new BadRequestException({ error: { code: 'RELEASE_SIGNER_INVALID', message: 'Windows Authenticode 证书指纹必须是 40 位十六进制值' } })
  }
  return normalized
}

function normalizeRuntimeVersion(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null
  const normalized = value.trim()
  if (normalized.length === 0 || normalized.length > 64) {
    throw new BadRequestException({ error: { code: 'RELEASE_RUNTIME_VERSION_INVALID', message: '运行版本格式无效' } })
  }
  return normalized
}

function normalizeArtifactVersion(value: string): string {
  const normalized = value.trim()
  if (normalized.length === 0 || normalized.length > 64) {
    throw new BadRequestException({ error: { code: 'RELEASE_ARTIFACT_VERSION_INVALID', message: '制品版本必须是 1–64 个有效字符' } })
  }
  return normalized
}

function normalizeReason(value: string): string {
  const normalized = value.trim()
  if (normalized.length < 8 || normalized.length > 500) {
    throw new BadRequestException({ error: { code: 'RELEASE_REASON_INVALID', message: '观察原因须为 8–500 个有效字符' } })
  }
  return normalized
}

@Injectable()
export class ReleaseObservationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly credentials: TerminalCredentialSecurityService,
    private readonly audit: AuditService,
  ) {}

  async createPlan(dto: CreateReleaseObservationPlanDto, auditContext: AuditContext) {
    const reason = normalizeReason(dto.reason)
    const observationEndsAt = new Date(dto.observationEndsAt)
    if (!Number.isFinite(observationEndsAt.getTime()) || observationEndsAt <= new Date()) {
      throw new BadRequestException({ error: { code: 'RELEASE_OBSERVATION_WINDOW_INVALID', message: '观察截止时间必须晚于当前时间' } })
    }
    const targetIds = dto.targets.map((target) => target.terminalId.trim())
    if (new Set(targetIds).size !== targetIds.length || targetIds.some((id) => !id)) {
      throw new BadRequestException({ error: { code: 'RELEASE_TARGETS_INVALID', message: '目标终端必须为不重复的显式列表' } })
    }
    if (dto.signerTrustLevel === 'unsigned_internal' && dto.signerCertificateThumbprint) {
      throw new BadRequestException({ error: { code: 'RELEASE_SIGNER_INVALID', message: '未签名内部候选不能填写签名者指纹' } })
    }
    if (dto.signerTrustLevel !== 'unsigned_internal' && !dto.signerCertificateThumbprint) {
      throw new BadRequestException({ error: { code: 'RELEASE_SIGNER_REQUIRED', message: '已签名制品必须填写签名者证书指纹' } })
    }

    const identity = {
      version: normalizeArtifactVersion(dto.artifactVersion),
      targetPlatform: dto.targetPlatform?.trim() || 'windows-x64',
      packageSha256: normalizeHash(dto.packageSha256),
      runtimeManifestSha256: normalizeHash(dto.runtimeManifestSha256),
      signerTrustLevel: dto.signerTrustLevel,
      signerCertificateThumbprint: dto.signerCertificateThumbprint
        ? normalizeSignerCertificateThumbprint(dto.signerCertificateThumbprint)
        : null,
    }
    if (identity.targetPlatform !== 'windows-x64') {
      throw new BadRequestException({ error: { code: 'RELEASE_TARGET_PLATFORM_UNSUPPORTED', message: '当前观察协议仅支持 windows-x64 终端' } })
    }

    return this.prisma.$transaction(async (tx) => {
      const terminals = await tx.terminal.findMany({
        where: { id: { in: targetIds } },
        select: { id: true, terminalCode: true, enabled: true, lifecycleStatus: true, orgId: true },
      })
      if (terminals.length !== targetIds.length) {
        throw new NotFoundException({ error: { code: 'RELEASE_TARGET_NOT_FOUND', message: '至少一个目标终端不存在' } })
      }
      for (const terminal of terminals) {
        if (!terminal.enabled || terminal.lifecycleStatus !== 'active') {
          throw new BadRequestException({ error: { code: 'RELEASE_TARGET_INELIGIBLE', message: `终端 ${terminal.terminalCode} 未处于运行中，不能加入观察计划` } })
        }
      }

      const existingArtifact = await tx.agentReleaseArtifact.findUnique({
        where: { version_packageSha256: { version: identity.version, packageSha256: identity.packageSha256 } },
      })
      const artifact = existingArtifact ?? await tx.agentReleaseArtifact.create({
        data: { ...identity, createdBy: auditContext.actorId },
      })
      if (
        artifact.targetPlatform !== identity.targetPlatform ||
        artifact.runtimeManifestSha256 !== identity.runtimeManifestSha256 ||
        artifact.signerTrustLevel !== identity.signerTrustLevel ||
        artifact.signerCertificateThumbprint !== identity.signerCertificateThumbprint ||
        artifact.observationProtocolVersion !== OBSERVATION_PROTOCOL
      ) {
        throw new ConflictException({ error: { code: 'RELEASE_ARTIFACT_IDENTITY_CONFLICT', message: '相同版本和包摘要的制品身份不一致，已拒绝覆盖' } })
      }

      const plan = await tx.agentReleasePlan.create({
        data: {
          artifactId: artifact.id,
          reason,
          observationEndsAt,
          createdBy: auditContext.actorId,
          targets: {
            create: dto.targets.map((target) => {
              const terminal = terminals.find((item) => item.id === target.terminalId.trim())!
              return {
                terminalId: terminal.id,
                orgIdSnapshot: terminal.orgId,
              }
            }),
          },
        },
        include: { targets: { include: { terminal: { select: { terminalCode: true } } } } },
      })
      await this.audit.writeRequired(tx, {
        actorId: auditContext.actorId,
        actorRole: auditContext.actorRole,
        action: 'terminal.release_observation_plan.create',
        targetType: 'agent_release_plan',
        targetId: plan.id,
        payload: {
          artifactVersion: artifact.version,
          packageSha256: artifact.packageSha256,
          runtimeManifestSha256: artifact.runtimeManifestSha256,
          signerTrustLevel: artifact.signerTrustLevel,
          signerCertificateThumbprint: artifact.signerCertificateThumbprint,
          observationEndsAt: observationEndsAt.toISOString(),
          terminalCodes: plan.targets.map((target) => target.terminal.terminalCode),
          reason,
          execution: 'not_supported',
        },
        ipAddress: auditContext.ipAddress ?? null,
        userAgent: auditContext.userAgent ?? null,
        requestId: auditContext.requestId ?? null,
      })
      return this.toPlanView(plan, artifact)
    }, { isolationLevel: 'Serializable', maxWait: 5_000, timeout: 10_000 })
  }

  async updatePlan(planId: string, dto: UpdateReleaseObservationPlanDto, auditContext: AuditContext) {
    const reason = normalizeReason(dto.reason)
    const now = new Date()
    try {
      return await this.prisma.$transaction(async (tx) => {
      const plan = await tx.agentReleasePlan.findUnique({
        where: { id: planId },
        include: { artifact: true, targets: { include: { terminal: { select: { terminalCode: true } } } } },
      })
      if (!plan) throw new NotFoundException({ error: { code: 'RELEASE_PLAN_NOT_FOUND', message: '观察计划不存在' } })
      if (plan.version !== dto.expectedVersion) {
        throw new ConflictException({ error: { code: 'RELEASE_PLAN_VERSION_CONFLICT', message: '计划版本已变化，请刷新后重试' } })
      }
      const nextStatus = dto.action === 'activate' ? 'active' : dto.action === 'pause' ? 'paused' : 'cancelled'
      if (plan.status === 'cancelled') {
        throw new BadRequestException({ error: { code: 'RELEASE_PLAN_CANCELLED', message: '已取消的观察计划不能再修改' } })
      }
      if (dto.action === 'activate') {
        if (plan.observationEndsAt <= now) {
          throw new BadRequestException({ error: { code: 'RELEASE_OBSERVATION_WINDOW_EXPIRED', message: '观察窗口已结束，不能激活计划' } })
        }
        const terminalIds = plan.targets.map((target) => target.terminalId)
        const terminals = await tx.terminal.findMany({
          where: { id: { in: terminalIds } },
          select: { id: true, terminalCode: true, enabled: true, lifecycleStatus: true },
        })
        if (terminals.length !== terminalIds.length) {
          throw new NotFoundException({ error: { code: 'RELEASE_TARGET_NOT_FOUND', message: '至少一个目标终端不存在' } })
        }
        for (const terminal of terminals) {
          if (!terminal.enabled || terminal.lifecycleStatus !== 'active') {
            throw new BadRequestException({ error: { code: 'RELEASE_TARGET_INELIGIBLE', message: `终端 ${terminal.terminalCode} 未处于运行中，不能激活观察计划` } })
          }
        }
        // Expired or otherwise inactive assignments are no longer effective;
        // remove them before acquiring the terminal-keyed active assignments.
        await tx.activeReleaseObservationAssignment.deleteMany({
          where: {
            terminalId: { in: terminalIds },
            plan: {
              OR: [
                { status: { not: 'active' } },
                { observationEndsAt: { lte: now } },
              ],
            },
          },
        })
      }
      const updated = await tx.agentReleasePlan.updateMany({
        where: { id: plan.id, version: dto.expectedVersion, status: plan.status },
        data: {
          status: nextStatus,
          version: { increment: 1 },
          ...(dto.action === 'activate' ? { activatedBy: auditContext.actorId, activatedAt: now } : {}),
          ...(dto.action === 'pause' ? { pausedBy: auditContext.actorId, pausedAt: now } : {}),
          ...(dto.action === 'cancel' ? { cancelledBy: auditContext.actorId, cancelledAt: now } : {}),
        },
      })
      if (updated.count !== 1) {
        throw new ConflictException({ error: { code: 'RELEASE_PLAN_VERSION_CONFLICT', message: '计划状态已变化，请刷新后重试' } })
      }
      if (dto.action === 'activate') {
        await tx.activeReleaseObservationAssignment.createMany({
          data: plan.targets.map((target) => ({
            terminalId: target.terminalId,
            planId: plan.id,
            targetId: target.id,
          })),
        })
      } else {
        await tx.activeReleaseObservationAssignment.deleteMany({ where: { planId: plan.id } })
      }
      await this.audit.writeRequired(tx, {
        actorId: auditContext.actorId,
        actorRole: auditContext.actorRole,
        action: `terminal.release_observation_plan.${dto.action}`,
        targetType: 'agent_release_plan',
        targetId: plan.id,
        payload: {
          oldStatus: plan.status,
          newStatus: nextStatus,
          oldVersion: plan.version,
          newVersion: plan.version + 1,
          reason,
          execution: 'not_supported',
        },
        ipAddress: auditContext.ipAddress ?? null,
        userAgent: auditContext.userAgent ?? null,
        requestId: auditContext.requestId ?? null,
      })
      return {
        planId: plan.id,
        status: nextStatus,
        version: plan.version + 1,
        artifactVersion: plan.artifact.version,
      }
      }, { isolationLevel: 'Serializable', maxWait: 5_000, timeout: 10_000 })
    } catch (error) {
      const code = (error as { code?: string }).code
      if (isUniqueConstraintError(error) || code === 'P2034') {
        throw new ConflictException({ error: { code: 'RELEASE_TARGET_ALREADY_OBSERVED', message: '目标终端已有有效观察计划或并发状态变化，请刷新后重试' } })
      }
      throw error
    }
  }

  async listPlans() {
    const now = new Date()
    const plans = await this.prisma.agentReleasePlan.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        artifact: true,
        targets: {
          include: {
            terminal: { select: { terminalCode: true } },
            observation: true,
          },
        },
      },
    })
    return {
      plans: plans.map((plan) => ({
        planId: plan.id,
        status: plan.status,
        version: plan.version,
        targetVersion: plan.artifact.version,
        signerTrustLevel: plan.artifact.signerTrustLevel,
        observationEndsAt: plan.observationEndsAt.toISOString(),
        targets: plan.targets.map((target) => ({
          terminalCode: target.terminal.terminalCode,
          state: this.toAdminObservation({ plan, observation: target.observation }, now).state,
          observedVersion: target.observation?.runtimeVersion ?? null,
          observedAt: target.observation?.observedAt.toISOString() ?? null,
        })),
        execution: 'not_supported' as const,
      })),
    }
  }

  async getPlanForTerminal(terminalId: string, authHeader: string | undefined): Promise<{ plan: AgentReleaseObservationPlanView | null }> {
    await this.credentials.validateTerminalToken(terminalId, authHeader, { allowDisabled: true })
    const terminal = await this.prisma.terminal.findUnique({
      where: { id: terminalId },
      select: { enabled: true, lifecycleStatus: true },
    })
    if (!terminal || !terminal.enabled || terminal.lifecycleStatus !== 'active') return { plan: null }

    const assignment = await this.prisma.activeReleaseObservationAssignment.findUnique({
      where: { terminalId },
      include: { plan: { include: { artifact: true } } },
    })
    if (!assignment || assignment.plan.status !== 'active' || assignment.plan.observationEndsAt <= new Date()) return { plan: null }
    return { plan: this.toAgentPlan(assignment.plan) }
  }

  async reportObservation(terminalId: string, dto: ReportReleaseObservationDto, authHeader: string | undefined) {
    await this.credentials.validateTerminalToken(terminalId, authHeader, { allowDisabled: true })
    const observedAt = new Date(dto.observedAt)
    if (!Number.isFinite(observedAt.getTime()) || observedAt.getTime() > Date.now() + MAX_FUTURE_OBSERVATION_MS) {
      throw new BadRequestException({ error: { code: 'RELEASE_OBSERVED_AT_INVALID', message: '观察时间无效或晚于服务器当前时间' } })
    }
    if (dto.observationProtocolVersion !== OBSERVATION_PROTOCOL) {
      throw new BadRequestException({ error: { code: 'RELEASE_OBSERVATION_PROTOCOL_INVALID', message: '终端观察协议版本不兼容' } })
    }
    return this.prisma.$transaction(async (tx) => {
      // Re-check eligibility inside the write transaction so a pause/cancel
      // racing this report cannot leave a new observation on an inactive plan.
      const assignment = await tx.activeReleaseObservationAssignment.findUnique({
        where: { terminalId },
        include: { plan: true },
      })
      if (
        !assignment ||
        assignment.planId !== dto.seenPlanId ||
        assignment.plan.status !== 'active' ||
        assignment.plan.version !== dto.seenPlanVersion ||
        assignment.plan.observationEndsAt <= new Date()
      ) {
        throw new ForbiddenException({ error: { code: 'RELEASE_OBSERVATION_TARGET_INVALID', message: '当前终端没有可回报的有效观察计划' } })
      }

      const target = await tx.agentReleaseTarget.findFirst({
        where: {
          terminalId,
          id: assignment.targetId,
          planId: dto.seenPlanId,
          terminal: { is: { enabled: true, lifecycleStatus: 'active' } },
          plan: { is: { status: 'active', version: dto.seenPlanVersion, observationEndsAt: { gt: new Date() } } },
        },
        select: { id: true },
      })
      if (!target) {
        throw new ForbiddenException({ error: { code: 'RELEASE_OBSERVATION_TARGET_INVALID', message: '当前终端没有可回报的有效观察计划' } })
      }

      const existing = await tx.terminalReleaseObservation.findUnique({ where: { targetId: target.id } })
      if (existing && existing.observedAt > observedAt) {
        return { accepted: true, ignoredAsOutOfOrder: true }
      }
      const receivedAt = new Date()
      if (existing) {
        await tx.terminalReleaseObservation.update({
          where: { targetId: target.id },
          data: {
            seenPlanId: dto.seenPlanId,
            seenPlanVersion: dto.seenPlanVersion,
            runtimeVersion: normalizeRuntimeVersion(dto.runtimeVersion),
            observationProtocolVersion: dto.observationProtocolVersion,
            observedAt,
            receivedAt,
          },
        })
      } else {
        await tx.terminalReleaseObservation.create({
          data: {
            targetId: target.id,
            seenPlanId: dto.seenPlanId,
            seenPlanVersion: dto.seenPlanVersion,
            runtimeVersion: normalizeRuntimeVersion(dto.runtimeVersion),
            observationProtocolVersion: dto.observationProtocolVersion,
            observedAt,
            receivedAt,
          },
        })
      }
      return { accepted: true, ignoredAsOutOfOrder: false }
    }, { isolationLevel: 'Serializable', maxWait: 5_000, timeout: 10_000 })
  }

  toAdminObservation(target: {
    plan: { id: string; status: string; version: number; observationEndsAt: Date; artifact: { version: string; signerTrustLevel: string } }
    observation: { runtimeVersion: string | null; observedAt: Date; receivedAt: Date } | null
  }, now = new Date()): AdminReleaseObservationView {
    const planStatus = target.plan.status as AdminReleaseObservationView['planStatus']
    let state: ReleaseObservationState
    if (planStatus === 'draft') state = 'draft'
    else if (planStatus === 'paused' || planStatus === 'cancelled') state = 'paused'
    else if (target.plan.observationEndsAt <= now) state = 'expired'
    else if (!target.observation) state = 'not_seen'
    else if (now.getTime() - target.observation.receivedAt.getTime() > 15 * 60_000) state = 'stale'
    else if (!target.observation.runtimeVersion) state = 'unverified'
    else state = target.observation.runtimeVersion === target.plan.artifact.version ? 'current' : 'mismatch'
    return {
      planId: target.plan.id,
      planStatus,
      planVersion: target.plan.version,
      targetVersion: target.plan.artifact.version,
      signerTrustLevel: target.plan.artifact.signerTrustLevel,
      observedVersion: target.observation?.runtimeVersion ?? null,
      observedAt: target.observation?.observedAt.toISOString() ?? null,
      state,
    }
  }

  private toAgentPlan(plan: {
    id: string
    version: number
    artifact: {
      version: string
      observationProtocolVersion: string
    }
  }): AgentReleaseObservationPlanView {
    return {
      planId: plan.id,
      planVersion: plan.version,
      artifactVersion: plan.artifact.version,
      observationProtocolVersion: plan.artifact.observationProtocolVersion,
    }
  }

  private toPlanView(
    plan: { id: string; status: string; version: number; observationEndsAt: Date; targets: { terminal: { terminalCode: string } }[] },
    artifact: { version: string; signerTrustLevel: string },
  ) {
    return {
      planId: plan.id,
      status: plan.status,
      version: plan.version,
      targetVersion: artifact.version,
      signerTrustLevel: artifact.signerTrustLevel,
      observationEndsAt: plan.observationEndsAt.toISOString(),
      terminalCodes: plan.targets.map((target) => target.terminal.terminalCode),
      execution: 'not_supported' as const,
    }
  }
}
