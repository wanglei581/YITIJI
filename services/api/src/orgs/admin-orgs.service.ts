import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import * as bcrypt from 'bcryptjs'
import { randomUUID } from 'crypto'
import { PrismaService } from '../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import type { AuthedUser } from '../common/decorators/current-user.decorator'
import type { CreateOrgDto, UpdateOrgDto } from './dto/admin-org.dto'

// ============================================================
// AdminOrgsService — 阶段1B:Admin 合作机构管理
//
// Organization 是合作机构(外部数据来源方 + 运营协作方),
// 其 partner 账号(User.role='partner')在机构后台维护岗位/招聘会/政策数据。
//
// 授权开关 enabled 的全链路效果:
//   - false → 该机构 partner 账号无法登录(auth.service 校验)
//   - false → 导入/写接口拒绝(jobs.service 既有 org.enabled 校验)
//   - 已发布数据不自动下架(如需下架走岗位/招聘会信息源逐条 unpublish,保持审计可溯)
//
// 合规:
//   - 启用模块白名单 = shared EnabledModule;招聘闭环模块(PROHIBITED)硬拒绝
//   - 账号密码 bcrypt 落库;任何响应/审计/日志绝不出现明文密码或 passwordHash
//   - 所有写操作落 AuditLog
// ============================================================

/** shared EnabledModule 本地副本(契约源 packages/shared/src/types/partner.ts)。 */
const ALLOWED_MODULES = new Set([
  'resume_service',
  'print_scan',
  'policy_service',
  'job_info',
  'job_fair',
  'ai_interview',
  'device_status',
  'service_statistics',
  'external_apply_redirect',
])

/** 招聘闭环禁用模块:无论任何配置均不允许写入(shared PROHIBITED_MODULES)。 */
const PROHIBITED_MODULES = new Set([
  'in_platform_apply',
  'candidate_management',
  'resume_delivery_to_enterprise',
  'interview_invitation',
  'offer_management',
])

export interface AdminOrgAccount {
  id: string
  username: string
  name: string
  enabled: boolean
  createdAt: string
}

export interface AdminOrgListItem {
  id: string
  name: string
  type: string
  contact: string | null
  contactPhone: string | null
  sceneTemplate: string | null
  enabledModules: string[]
  enabled: boolean
  createdAt: string
  updatedAt: string
  counts: { accounts: number; sources: number; jobs: number; fairs: number }
}

export interface AdminOrgDetail extends AdminOrgListItem {
  accounts: AdminOrgAccount[]
}

interface PrismaOrgRow {
  id: string
  name: string
  type: string
  contact: string | null
  contactPhone: string | null
  sceneTemplate: string | null
  enabledModulesJson: string
  enabled: boolean
  createdAt: Date
  updatedAt: Date
}

function parseModules(json: string): string[] {
  try {
    const v = JSON.parse(json)
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

function mapOrg(
  o: PrismaOrgRow,
  counts: { accounts: number; sources: number; jobs: number; fairs: number },
): AdminOrgListItem {
  return {
    id: o.id,
    name: o.name,
    type: o.type,
    contact: o.contact,
    contactPhone: o.contactPhone,
    sceneTemplate: o.sceneTemplate,
    enabledModules: parseModules(o.enabledModulesJson),
    enabled: o.enabled,
    createdAt: o.createdAt.toISOString(),
    updatedAt: o.updatedAt.toISOString(),
    counts,
  }
}

@Injectable()
export class AdminOrgsService {
  private readonly logger = new Logger(AdminOrgsService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ── 机构列表 / 详情 ─────────────────────────────────────────────────────────

  async listOrgs(): Promise<AdminOrgListItem[]> {
    const rows = await this.prisma.organization.findMany({
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { users: true, jobSources: true, jobs: true, jobFairs: true } } },
    })
    return rows.map((o) =>
      mapOrg(o, {
        accounts: o._count.users,
        sources: o._count.jobSources,
        jobs: o._count.jobs,
        fairs: o._count.jobFairs,
      }),
    )
  }

  async getOrgDetail(orgId: string): Promise<AdminOrgDetail> {
    const o = await this.prisma.organization.findUnique({
      where: { id: orgId },
      include: {
        _count: { select: { users: true, jobSources: true, jobs: true, jobFairs: true } },
        // 绝不 select passwordHash
        users: {
          orderBy: { createdAt: 'asc' },
          select: { id: true, username: true, name: true, enabled: true, createdAt: true },
        },
      },
    })
    if (!o) this.throwOrgNotFound(orgId)
    return {
      ...mapOrg(o, {
        accounts: o._count.users,
        sources: o._count.jobSources,
        jobs: o._count.jobs,
        fairs: o._count.jobFairs,
      }),
      accounts: o.users.map((u) => ({
        id: u.id,
        username: u.username,
        name: u.name,
        enabled: u.enabled,
        createdAt: u.createdAt.toISOString(),
      })),
    }
  }

  // ── 机构创建 / 编辑 / 启停 ──────────────────────────────────────────────────

  async createOrg(dto: CreateOrgDto, admin: AuthedUser): Promise<AdminOrgDetail> {
    const enabledModules = this.sanitizeModules(dto.enabledModules)

    if (dto.account) {
      const exists = await this.prisma.user.findUnique({ where: { username: dto.account.username } })
      if (exists) {
        throw new ConflictException({ error: { code: 'USERNAME_TAKEN', message: `用户名 ${dto.account.username} 已存在` } })
      }
    }

    const orgId = `org_${randomUUID().replace(/-/g, '').slice(0, 20)}`
    await this.prisma.organization.create({
      data: {
        id: orgId,
        name: dto.name,
        type: dto.type,
        contact: dto.contact ?? null,
        contactPhone: dto.contactPhone ?? null,
        sceneTemplate: dto.sceneTemplate ?? null,
        enabledModulesJson: JSON.stringify(enabledModules),
      },
    })
    await this.writeAudit(admin, 'org.create', orgId, { name: dto.name, type: dto.type })

    if (dto.account) {
      const passwordHash = await bcrypt.hash(dto.account.password, 10)
      const account = await this.prisma.user.create({
        data: {
          username: dto.account.username,
          passwordHash,
          name: dto.account.name,
          role: 'partner',
          orgId,
        },
      })
      // 审计只记 username,绝不记密码 / hash
      await this.writeAudit(admin, 'org.account.create', orgId, { accountId: account.id, username: account.username })
    }

    this.logger.log(`createOrg: id=${orgId} by=${admin.userId}`)
    return this.getOrgDetail(orgId)
  }

  async updateOrg(orgId: string, dto: UpdateOrgDto, admin: AuthedUser): Promise<AdminOrgDetail> {
    await this.assertOrgExists(orgId)
    const changedFields = Object.keys(dto).filter((k) => (dto as Record<string, unknown>)[k] !== undefined)
    await this.prisma.organization.update({
      where: { id: orgId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.type !== undefined ? { type: dto.type } : {}),
        ...(dto.contact !== undefined ? { contact: dto.contact } : {}),
        ...(dto.contactPhone !== undefined ? { contactPhone: dto.contactPhone } : {}),
        ...(dto.sceneTemplate !== undefined ? { sceneTemplate: dto.sceneTemplate } : {}),
        ...(dto.enabledModules !== undefined
          ? { enabledModulesJson: JSON.stringify(this.sanitizeModules(dto.enabledModules)) }
          : {}),
      },
    })
    await this.writeAudit(admin, 'org.update', orgId, { changedFields })
    return this.getOrgDetail(orgId)
  }

  /**
   * 授权启停。disable 后:该机构 partner 账号无法登录(auth)、导入接口拒绝(jobs)。
   * 已发布数据不自动下架 —— 如需下架,到岗位/招聘会信息源逐条操作,保持审计可溯。
   */
  async setOrgStatus(orgId: string, action: 'enable' | 'disable', admin: AuthedUser): Promise<AdminOrgDetail> {
    const org = await this.assertOrgExists(orgId)
    const toEnabled = action === 'enable'
    if (org.enabled !== toEnabled) {
      await this.prisma.organization.update({ where: { id: orgId }, data: { enabled: toEnabled } })
      await this.writeAudit(admin, toEnabled ? 'org.enable' : 'org.disable', orgId, {
        fromEnabled: org.enabled,
        toEnabled,
      })
    }
    return this.getOrgDetail(orgId)
  }

  // ── 机构账号管理 ────────────────────────────────────────────────────────────

  async createAccount(
    orgId: string,
    input: { username: string; password: string; name: string },
    admin: AuthedUser,
  ): Promise<AdminOrgAccount> {
    await this.assertOrgExists(orgId)
    const exists = await this.prisma.user.findUnique({ where: { username: input.username } })
    if (exists) {
      throw new ConflictException({ error: { code: 'USERNAME_TAKEN', message: `用户名 ${input.username} 已存在` } })
    }
    const passwordHash = await bcrypt.hash(input.password, 10)
    const account = await this.prisma.user.create({
      data: { username: input.username, passwordHash, name: input.name, role: 'partner', orgId },
    })
    await this.writeAudit(admin, 'org.account.create', orgId, { accountId: account.id, username: account.username })
    return {
      id: account.id,
      username: account.username,
      name: account.name,
      enabled: account.enabled,
      createdAt: account.createdAt.toISOString(),
    }
  }

  async setAccountStatus(
    orgId: string,
    accountId: string,
    action: 'enable' | 'disable',
    admin: AuthedUser,
  ): Promise<AdminOrgAccount> {
    const account = await this.assertAccountInOrg(orgId, accountId)
    const toEnabled = action === 'enable'
    const updated = account.enabled === toEnabled
      ? account
      : await this.prisma.user.update({ where: { id: accountId }, data: { enabled: toEnabled } })
    if (account.enabled !== toEnabled) {
      await this.writeAudit(admin, toEnabled ? 'org.account.enable' : 'org.account.disable', orgId, {
        accountId,
        username: account.username,
      })
    }
    return {
      id: updated.id,
      username: updated.username,
      name: updated.name,
      enabled: updated.enabled,
      createdAt: updated.createdAt.toISOString(),
    }
  }

  async resetAccountPassword(
    orgId: string,
    accountId: string,
    password: string,
    admin: AuthedUser,
  ): Promise<{ success: true }> {
    const account = await this.assertAccountInOrg(orgId, accountId)
    const passwordHash = await bcrypt.hash(password, 10)
    await this.prisma.user.update({ where: { id: accountId }, data: { passwordHash } })
    // 审计绝不含密码 / hash
    await this.writeAudit(admin, 'org.account.reset_password', orgId, { accountId, username: account.username })
    return { success: true }
  }

  // ── 内部 helpers ────────────────────────────────────────────────────────────

  /** 模块白名单过滤:未知模块拒绝,招聘闭环模块硬拒绝(给明确错误,不静默剥离)。 */
  private sanitizeModules(modules: string[] | undefined): string[] {
    if (!modules || modules.length === 0) return []
    const unique = [...new Set(modules)]
    for (const m of unique) {
      if (PROHIBITED_MODULES.has(m)) {
        throw new BadRequestException({
          error: { code: 'MODULE_PROHIBITED', message: `模块 ${m} 属于招聘闭环功能,平台禁止启用` },
        })
      }
      if (!ALLOWED_MODULES.has(m)) {
        throw new BadRequestException({
          error: { code: 'MODULE_UNKNOWN', message: `未知模块 ${m}` },
        })
      }
    }
    return unique
  }

  private throwOrgNotFound(orgId: string): never {
    throw new NotFoundException({ error: { code: 'ORG_NOT_FOUND', message: `Organization ${orgId} not found` } })
  }

  private async assertOrgExists(orgId: string) {
    const org = await this.prisma.organization.findUnique({ where: { id: orgId } })
    if (!org) this.throwOrgNotFound(orgId)
    return org
  }

  private async assertAccountInOrg(orgId: string, accountId: string) {
    await this.assertOrgExists(orgId)
    const account = await this.prisma.user.findFirst({ where: { id: accountId, orgId, role: 'partner' } })
    if (!account) {
      throw new NotFoundException({ error: { code: 'ACCOUNT_NOT_FOUND', message: `Account ${accountId} not found in org ${orgId}` } })
    }
    return account
  }

  private async writeAudit(admin: AuthedUser, action: string, orgId: string, payload: Record<string, unknown>): Promise<void> {
    await this.audit.write({
      actorId: admin.userId,
      actorRole: 'admin',
      action,
      targetType: 'organization',
      targetId: orgId,
      payload,
    })
  }
}
