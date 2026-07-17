import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common'
import * as bcrypt from 'bcryptjs'
import { randomUUID } from 'crypto'
import { PrismaService } from '../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import type { AuthedUser } from '../common/decorators/current-user.decorator'
import { encryptPhone, hashPhone, maskPhoneFromEnc, normalizePhone } from '../common/crypto/phone-identity'
import { RedisService } from '../common/redis/redis.service'
import { Prisma } from '../generated/prisma/client'
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
  'smart_campus',
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

interface OrgTypeMatrixRule {
  sceneTemplate: string | null
  allowedModules: Set<string>
}

const matrixModules = (modules: string[]) => new Set(modules)

/** 机构类型矩阵: type 决定唯一场景模板和模块权限上限。 */
const ORG_TYPE_MATRIX: Record<string, OrgTypeMatrixRule> = {
  school_employment_center: {
    sceneTemplate: 'school',
    allowedModules: matrixModules([
      'resume_service',
      'print_scan',
      'policy_service',
      'job_info',
      'job_fair',
      'smart_campus',
      'ai_interview',
      'device_status',
      'service_statistics',
      'external_apply_redirect',
    ]),
  },
  public_employment_service: {
    sceneTemplate: 'public_employment',
    allowedModules: matrixModules([
      'resume_service',
      'print_scan',
      'policy_service',
      'job_info',
      'job_fair',
      'ai_interview',
      'device_status',
      'service_statistics',
      'external_apply_redirect',
    ]),
  },
  licensed_hr_agency: {
    sceneTemplate: 'licensed_hr_service',
    allowedModules: matrixModules([
      'resume_service',
      'print_scan',
      'job_info',
      'job_fair',
      'ai_interview',
      'device_status',
      'service_statistics',
      'external_apply_redirect',
    ]),
  },
  fair_organizer: {
    sceneTemplate: null,
    allowedModules: matrixModules([]),
  },
  enterprise_source: {
    sceneTemplate: null,
    allowedModules: matrixModules([]),
  },
}

export interface AdminOrgAccount {
  id: string
  username: string
  name: string
  enabled: boolean
  phoneMasked: string | null
  phoneVerifiedAt: string | null
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

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)]
}

function sameStringSet(a: string[], b: string[]): boolean {
  const left = new Set(a)
  const right = new Set(b)
  if (left.size !== right.size) return false
  for (const value of left) {
    if (!right.has(value)) return false
  }
  return true
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

function mapAccount(u: {
  id: string
  username: string
  name: string
  enabled: boolean
  phoneEnc: string | null
  phoneVerifiedAt: Date | null
  createdAt: Date
}): AdminOrgAccount {
  return {
    id: u.id,
    username: u.username,
    name: u.name,
    enabled: u.enabled,
    phoneMasked: u.phoneEnc ? maskPhoneFromEnc(u.phoneEnc) : null,
    phoneVerifiedAt: u.phoneVerifiedAt?.toISOString() ?? null,
    createdAt: u.createdAt.toISOString(),
  }
}

@Injectable()
export class AdminOrgsService {
  private readonly logger = new Logger(AdminOrgsService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly redis: RedisService,
  ) {}

  // ── 机构列表 / 详情 ─────────────────────────────────────────────────────────

  async listOrgs(): Promise<AdminOrgListItem[]> {
    const rows = await this.prisma.organization.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: {
            users: { where: { role: 'partner', deletedAt: null } },
            jobSources: true,
            jobs: true,
            jobFairs: true,
          },
        },
      },
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
        _count: {
          select: {
            users: { where: { role: 'partner', deletedAt: null } },
            jobSources: true,
            jobs: true,
            jobFairs: true,
          },
        },
        // 绝不 select passwordHash
        users: {
          where: { role: 'partner', deletedAt: null },
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            username: true,
            name: true,
            enabled: true,
            phoneEnc: true,
            phoneVerifiedAt: true,
            createdAt: true,
          },
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
      accounts: o.users.map(mapAccount),
    }
  }

  // ── 机构创建 / 编辑 / 启停 ──────────────────────────────────────────────────

  async createOrg(dto: CreateOrgDto, admin: AuthedUser): Promise<AdminOrgDetail> {
    const enabledModules = this.sanitizeModules(dto.enabledModules)
    const sceneTemplate = dto.sceneTemplate ?? null
    this.assertOrgTypeMatrix({ type: dto.type, sceneTemplate, enabledModules })

    if (dto.account) {
      const exists = await this.prisma.user.findUnique({ where: { username: dto.account.username } })
      if (exists) {
        throw new ConflictException({ error: { code: 'USERNAME_TAKEN', message: `用户名 ${dto.account.username} 已存在` } })
      }
      await this.assertPhoneAvailable(dto.account.phone)
    }

    const orgId = `org_${randomUUID().replace(/-/g, '').slice(0, 20)}`
    await this.prisma.organization.create({
      data: {
        id: orgId,
        name: dto.name,
        type: dto.type,
        contact: dto.contact ?? null,
        contactPhone: dto.contactPhone ?? null,
        sceneTemplate,
        enabledModulesJson: JSON.stringify(enabledModules),
      },
    })
    await this.writeAudit(admin, 'org.create', orgId, { name: dto.name, type: dto.type })

    if (dto.account) {
      const passwordHash = await bcrypt.hash(dto.account.password, 10)
      const normalizedPhone = normalizePhone(dto.account.phone)
      const account = await this.prisma.user.create({
        data: {
          username: dto.account.username,
          passwordHash,
          name: dto.account.name,
          role: 'partner',
          orgId,
          phoneHash: hashPhone(normalizedPhone),
          phoneEnc: encryptPhone(normalizedPhone),
        },
      })
      // 审计只记 username,绝不记密码 / hash
      await this.writeAudit(admin, 'org.account.create', orgId, {
        accountId: account.id,
        username: account.username,
        phoneMasked: mapAccount(account).phoneMasked,
      })
    }

    this.logger.log(`createOrg: id=${orgId} by=${admin.userId}`)
    return this.getOrgDetail(orgId)
  }

  async updateOrg(orgId: string, dto: UpdateOrgDto, admin: AuthedUser): Promise<AdminOrgDetail> {
    const current = await this.assertOrgExists(orgId)
    const changedFields = Object.keys(dto).filter((k) => (dto as Record<string, unknown>)[k] !== undefined)
    const currentModules = parseModules(current.enabledModulesJson)
    const enabledModulesInput = Array.isArray(dto.enabledModules) ? dto.enabledModules : null
    const requestedModules = enabledModulesInput ? uniqueStrings(enabledModulesInput) : currentModules
    const hasEnabledModulesInput = enabledModulesInput !== null
    const modulesChanged = hasEnabledModulesInput && !sameStringSet(requestedModules, currentModules)
    const nextModules = modulesChanged ? this.sanitizeModules(requestedModules) : currentModules
    const nextType = dto.type ?? current.type
    const nextSceneTemplate = dto.sceneTemplate !== undefined ? dto.sceneTemplate : current.sceneTemplate
    const matrixFieldsChanged =
      (dto.type !== undefined && dto.type !== current.type) ||
      (dto.sceneTemplate !== undefined && (dto.sceneTemplate ?? null) !== (current.sceneTemplate ?? null)) ||
      modulesChanged
    if (matrixFieldsChanged) {
      this.assertOrgTypeMatrix({
        type: nextType,
        sceneTemplate: nextSceneTemplate ?? null,
        enabledModules: nextModules,
      })
    }
    await this.prisma.organization.update({
      where: { id: orgId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.type !== undefined ? { type: dto.type } : {}),
        ...(dto.contact !== undefined ? { contact: dto.contact } : {}),
        ...(dto.contactPhone !== undefined ? { contactPhone: dto.contactPhone } : {}),
        ...(dto.sceneTemplate !== undefined ? { sceneTemplate: dto.sceneTemplate } : {}),
        ...(modulesChanged ? { enabledModulesJson: JSON.stringify(nextModules) } : {}),
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
      await this.invalidateOrgSessions(orgId)
    }
    return this.getOrgDetail(orgId)
  }

  // ── 机构账号管理 ────────────────────────────────────────────────────────────

  async createAccount(
    orgId: string,
    input: { username: string; password: string; name: string; phone: string },
    admin: AuthedUser,
  ): Promise<AdminOrgAccount> {
    await this.assertOrgExists(orgId)
    const exists = await this.prisma.user.findUnique({ where: { username: input.username } })
    if (exists) {
      throw new ConflictException({ error: { code: 'USERNAME_TAKEN', message: `用户名 ${input.username} 已存在` } })
    }
    await this.assertPhoneAvailable(input.phone)
    const passwordHash = await bcrypt.hash(input.password, 10)
    const normalizedPhone = normalizePhone(input.phone)
    const account = await this.prisma.user.create({
      data: {
        username: input.username,
        passwordHash,
        name: input.name,
        role: 'partner',
        orgId,
        phoneHash: hashPhone(normalizedPhone),
        phoneEnc: encryptPhone(normalizedPhone),
      },
    })
    const mapped = mapAccount(account)
    await this.writeAudit(admin, 'org.account.create', orgId, {
      accountId: account.id,
      username: account.username,
      phoneMasked: mapped.phoneMasked,
    })
    return mapped
  }

  async setAccountStatus(
    orgId: string,
    accountId: string,
    action: 'enable' | 'disable',
    admin: AuthedUser,
  ): Promise<AdminOrgAccount> {
    const account = await this.assertAccountInOrg(orgId, accountId)
    const toEnabled = action === 'enable'
    let updated = account
    if (account.enabled !== toEnabled) {
      const result = await this.prisma.user.updateMany({
        where: { id: accountId, orgId, role: 'partner', deletedAt: null },
        data: { enabled: toEnabled, tokenVersion: { increment: 1 } },
      })
      if (result.count !== 1) this.throwAccountNotFound(orgId, accountId)
      updated = { ...account, enabled: toEnabled, tokenVersion: account.tokenVersion + 1 }
    }
    if (account.enabled !== toEnabled) {
      await this.writeAudit(admin, toEnabled ? 'org.account.enable' : 'org.account.disable', orgId, {
        accountId,
        username: account.username,
      })
      await this.invalidateAccountSession(accountId)
    }
    return mapAccount(updated)
  }

  async resetAccountPassword(
    orgId: string,
    accountId: string,
    password: string,
    admin: AuthedUser,
  ): Promise<{ success: true }> {
    const account = await this.assertAccountInOrg(orgId, accountId)
    const passwordHash = await bcrypt.hash(password, 10)
    const updated = await this.prisma.user.updateMany({
      where: { id: accountId, orgId, role: 'partner', deletedAt: null },
      data: { passwordHash, tokenVersion: { increment: 1 } },
    })
    if (updated.count !== 1) this.throwAccountNotFound(orgId, accountId)
    await this.invalidateAccountSession(accountId)
    // 审计绝不含密码 / hash
    await this.writeAudit(admin, 'org.account.reset_password', orgId, { accountId, username: account.username })
    return { success: true }
  }

  /**
   * 安全移除机构成员账号：保留 User 主键与历史关联，但撤销访问并释放可复用凭据。
   * 最后有效账号判断、墓碑更新和审计必须在同一可串行化事务内完成。
   */
  async deleteAccount(
    orgId: string,
    accountId: string,
    admin: AuthedUser,
  ): Promise<{ success: true }> {
    const tombstonePasswordHash = await bcrypt.hash(randomUUID(), 10)
    const deleted = await this.withSerializableRetry(() => this.prisma.$transaction(
      async (tx) => {
        const account = await tx.user.findFirst({
          where: { id: accountId, orgId, role: 'partner', deletedAt: null },
        })
        if (!account) this.throwAccountNotFound(orgId, accountId)

        const activeCount = await tx.user.count({
          where: { orgId, role: 'partner', enabled: true, deletedAt: null },
        })
        if (activeCount - (account.enabled ? 1 : 0) < 1) {
          throw new ConflictException({
            error: {
              code: 'LAST_ACTIVE_PARTNER_ACCOUNT_REQUIRED',
              message: '请先新增并启用接替账号，再移除此账号',
            },
          })
        }

        const deletedAt = new Date()
        const updated = await tx.user.updateMany({
          where: { id: account.id, orgId, role: 'partner', deletedAt: null },
          data: {
            deletedAt,
            enabled: false,
            tokenVersion: { increment: 1 },
            username: `deleted:${account.id}`,
            passwordHash: tombstonePasswordHash,
            name: '已移除账号',
            phoneHash: null,
            phoneEnc: null,
            phoneVerifiedAt: null,
            lastLoginAt: null,
          },
        })
        if (updated.count !== 1) this.throwAccountNotFound(orgId, accountId)

        await tx.auditLog.create({
          data: {
            actorId: admin.userId,
            actorRole: 'admin',
            action: 'org.account.delete',
            targetType: 'organization',
            targetId: orgId,
            payloadJson: JSON.stringify({ accountId: account.id }),
          },
        })
        return {
          id: account.id,
          role: account.role,
          orgId: account.orgId,
          tokenVersion: account.tokenVersion + 1,
          deletedAt,
        }
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5_000,
        timeout: 10_000,
      },
    ))
    await this.publishDeletedSessionState(deleted)
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

  private assertOrgTypeMatrix(input: { type: string; sceneTemplate: string | null; enabledModules: string[] }): void {
    for (const moduleName of input.enabledModules) {
      if (PROHIBITED_MODULES.has(moduleName)) {
        throw new BadRequestException({
          error: { code: 'MODULE_PROHIBITED', message: `模块 ${moduleName} 属于招聘闭环功能,平台禁止启用` },
        })
      }
    }
    const rule = ORG_TYPE_MATRIX[input.type]
    if (!rule) {
      throw new BadRequestException({
        error: {
          code: 'ORG_TYPE_MATRIX_VIOLATION',
          message: `机构类型 ${input.type} 不在支持矩阵内`,
        },
      })
    }
    if ((input.sceneTemplate ?? null) !== rule.sceneTemplate) {
      const expected = rule.sceneTemplate ?? '空'
      const actual = input.sceneTemplate ?? '空'
      throw new BadRequestException({
        error: {
          code: 'ORG_TYPE_MATRIX_VIOLATION',
          message: `机构类型 ${input.type} 的场景模板必须为 ${expected},当前为 ${actual}`,
        },
      })
    }
    for (const moduleName of input.enabledModules) {
      if (!rule.allowedModules.has(moduleName)) {
        throw new BadRequestException({
          error: {
            code: 'ORG_TYPE_MATRIX_VIOLATION',
            message: `机构类型 ${input.type} 不允许启用模块 ${moduleName}`,
          },
        })
      }
    }
  }

  private throwOrgNotFound(orgId: string): never {
    throw new NotFoundException({ error: { code: 'ORG_NOT_FOUND', message: `Organization ${orgId} not found` } })
  }

  private throwAccountNotFound(orgId: string, accountId: string): never {
    throw new NotFoundException({
      error: { code: 'ACCOUNT_NOT_FOUND', message: `Account ${accountId} not found in org ${orgId}` },
    })
  }

  private async assertOrgExists(orgId: string) {
    const org = await this.prisma.organization.findUnique({ where: { id: orgId } })
    if (!org) this.throwOrgNotFound(orgId)
    return org
  }

  private async assertPhoneAvailable(phone: string): Promise<void> {
    const exists = await this.prisma.user.findFirst({ where: { phoneHash: hashPhone(phone), deletedAt: null } })
    if (exists) {
      throw new ConflictException({ error: { code: 'PHONE_ALREADY_BOUND', message: '该手机号已绑定其他账号' } })
    }
  }

  private async assertAccountInOrg(orgId: string, accountId: string) {
    await this.assertOrgExists(orgId)
    const account = await this.prisma.user.findFirst({ where: { id: accountId, orgId, role: 'partner', deletedAt: null } })
    if (!account) this.throwAccountNotFound(orgId, accountId)
    return account
  }

  private async withSerializableRetry<T>(operation: () => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await operation()
      } catch (error) {
        const retryable = error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034'
        if (!retryable || attempt === 2) throw error
      }
    }
    throw new Error('unreachable')
  }

  private sessionStateKey(userId: string): string {
    return `internal:session-state:${userId}`
  }

  private async invalidateAccountSession(userId: string): Promise<void> {
    await this.redis.del(this.sessionStateKey(userId))
  }

  /**
   * 写入高版本禁用状态而非只删除缓存，避免晚到的旧 Guard 写回可用会话。
   * Redis 故障不回滚已经提交的墓碑；Guard 会回源数据库并失败关闭。
   */
  private async publishDeletedSessionState(user: {
    id: string
    role: string
    orgId: string | null
    tokenVersion: number
    deletedAt: Date
  }): Promise<void> {
    try {
      await this.redis.setJsonIfVersionNotOlder(
        this.sessionStateKey(user.id),
        60,
        JSON.stringify({
          userId: user.id,
          role: user.role,
          orgId: user.orgId,
          enabled: false,
          tokenVersion: user.tokenVersion,
          deletedAt: user.deletedAt.toISOString(),
          orgEnabled: false,
        }),
        user.tokenVersion,
      )
    } catch {
      await this.invalidateAccountSession(user.id).catch(() => undefined)
      this.logger.warn(`account deletion session state publish failed: userId=${user.id}`)
    }
  }

  private async invalidateOrgSessions(orgId: string): Promise<void> {
    const users = await this.prisma.user.findMany({
      where: { orgId, role: 'partner', deletedAt: null },
      select: { id: true },
    })
    await Promise.all(users.map((user) => this.invalidateAccountSession(user.id)))
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

  // ── Partner 自助档案（审计修复：替换前端 MOCK_PROFILE）────────────────────

  /** 本机构档案（无凭证字段；enabledModules 解析为数组）。 */
  async getOwnProfile(user: AuthedUser) {
    if (!user.orgId) {
      throw new ForbiddenException({ error: { code: 'ORG_REQUIRED', message: '当前账号未绑定机构' } })
    }
    const o = await this.prisma.organization.findUnique({
      where: { id: user.orgId },
      select: {
        id: true, name: true, type: true, contact: true, contactPhone: true,
        sceneTemplate: true, enabledModulesJson: true, enabled: true, createdAt: true,
        _count: {
          select: { jobSources: true, users: { where: { role: 'partner', deletedAt: null } } },
        },
      },
    })
    if (!o) {
      throw new NotFoundException({ error: { code: 'ORG_NOT_FOUND', message: '机构不存在' } })
    }
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
      sourceCount: o._count.jobSources,
      accountCount: o._count.users,
    }
  }

  /** 机构自助更新：仅 联系人/联系电话（名称/类型/模块归管理员）；写审计。 */
  async updateOwnProfile(
    user: AuthedUser,
    dto: { contact?: string; contactPhone?: string },
    req: { headers?: Record<string, string | string[] | undefined>; ip?: string; requestId?: string },
  ) {
    if (!user.orgId) {
      throw new ForbiddenException({ error: { code: 'ORG_REQUIRED', message: '当前账号未绑定机构' } })
    }
    const data: Record<string, string> = {}
    if (dto.contact !== undefined) data['contact'] = dto.contact.trim()
    if (dto.contactPhone !== undefined) data['contactPhone'] = dto.contactPhone.trim()
    if (Object.keys(data).length === 0) {
      throw new BadRequestException({ error: { code: 'ORG_PROFILE_EMPTY', message: '没有可更新的字段' } })
    }
    await this.prisma.organization.update({ where: { id: user.orgId }, data })
    await this.audit.write({
      actorId: user.userId,
      actorRole: 'partner',
      action: 'org.self_profile_update',
      targetType: 'organization',
      targetId: user.orgId,
      payload: { fields: Object.keys(data) },
      ipAddress: typeof req.headers?.['x-forwarded-for'] === 'string'
        ? (req.headers['x-forwarded-for'] as string).split(',')[0].trim()
        : (req.ip ?? null),
      userAgent: typeof req.headers?.['user-agent'] === 'string' ? req.headers['user-agent'] : null,
      requestId: req.requestId ?? null,
    })
    return this.getOwnProfile(user)
  }
}
