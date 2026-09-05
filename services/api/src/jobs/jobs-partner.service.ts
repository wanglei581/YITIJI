// ============================================================
// JobsPartnerService — Partner 数据源/岗位/招聘会/同步日志端点
// N1 拆分子服务：零行为变化。
// ============================================================

import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  InternalServerErrorException,
} from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import { JobQualityService } from '../job-ai/job-quality.service'
import type { AuthedUser } from '../common/decorators/current-user.decorator'
import { encryptSecret, generateWebhookSecret } from '../common/crypto/secret-cipher'
import type { CreateDataSourceDto, RotateDataSourceCredentialDto } from './dto/data-source.dto'
import {
  assertCredentialRotationConfirmed,
  assertCredentialRotationNotArchived,
  assertCredentialRotationOrgRateLimit,
  assertCredentialRotationSourceCooldown,
  assertWebhookSecretStrength,
  normalizeOptionalSecret,
} from './data-source-credential-policy'
import type { ImportJobItemDto } from './dto/import-jobs.dto'
import type { ImportFairsDto } from './dto/import-fairs.dto'
import type { UpdatePartnerFairDto, UpdatePartnerJobDto } from './dto/partner-edit.dto'
import {
  assertDataSourceCapability,
  assertPartnerDataTypeCapability,
  getPartnerCapabilities,
  isAdminManagedAccessMode,
} from './partner-capabilities'
import {
  type AccessMode,
  type PartnerDataSourceDto,
  type PartnerJobDto,
  type PartnerFairDto,
  type ImportResult,
  type SyncLogDto,
  type PaginatedResult,
  prismaJobSourceToPartnerDto,
  prismaJobToPartnerDto,
  prismaFairToPartnerDto,
  buildJobTags,
  mapWorkTypeToCategory,
  normalizeOptionalHttpUrl,
  fmtSyncTime,
} from './jobs-shared'

/**
 * 数据源列表项 + 生命周期字段。
 *
 * 为什么在这里扩展而不是直接改 jobs-shared.ts 的 PartnerDataSourceDto：
 * `prismaJobSourceToPartnerDto` 与 `PartnerDataSourceDto` 被 Kiosk/Admin 侧共用，
 * 归档与轮换是 **Partner 独有** 的生命周期语义，不应该扩散到共享映射层。
 * 契约形状与 packages/shared 的 PartnerDataSourceView 对齐（前端消费同一形状）。
 */
export interface PartnerDataSourceLifecycleDto extends PartnerDataSourceDto {
  archived: boolean
  archivedAt: string | null
  credentialRotatedAt: string | null
}

/** JobSource 行里与生命周期有关的两列（不含任何密钥内容，可安全回显）。 */
interface JobSourceLifecycleRow {
  archivedAt: Date | null
  webhookSecretRotatedAt: Date | null
}

/**
 * 凭证轮换响应契约的本地副本。
 *
 * **契约源**：packages/shared/src/types/job.ts 的 PartnerDataSourceCredentialRotationResult
 *
 * 为什么不直接 import @ai-job-print/shared：services/api 走 commonjs + node
 * moduleResolution，而 packages/shared 是 ESM-only（见 member-favorites.types.ts 顶部说明）。
 * 字段变更必须同时改两处。
 *
 * 安全口径：`webhookSecretOnce` 只在轮换那一次响应出现，任何 GET 都不回显。
 */
export interface PartnerDataSourceCredentialRotationResult {
  id: string
  accessMode: AccessMode
  credentialConfigured: boolean
  rotatedAt: string
  webhookSecretOnce?: string
}

function withLifecycle(
  dto: PartnerDataSourceDto,
  row: JobSourceLifecycleRow,
): PartnerDataSourceLifecycleDto {
  return {
    ...dto,
    archived: row.archivedAt != null,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    credentialRotatedAt: row.webhookSecretRotatedAt?.toISOString() ?? null,
  }
}

@Injectable()
export class JobsPartnerService {
  private readonly logger = new Logger(JobsPartnerService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly jobQuality: JobQualityService,
  ) {}

  private async refreshJobQualitySnapshots(jobIds: string[]): Promise<void> {
    try {
      await this.jobQuality.refreshJobQualitySnapshots(jobIds)
    } catch (error) {
      this.logger.warn(`refresh job quality snapshots failed: ${error instanceof Error ? error.message : 'unknown'}`)
    }
  }

  private async getEnabledPartnerOrg(orgId: string) {
    const org = await this.prisma.organization.findUnique({ where: { id: orgId } })
    if (!org || !org.enabled) {
      throw new BadRequestException({ error: { code: 'PARTNER_ORG_NOT_FOUND', message: '机构不存在或已停用' } })
    }
    return org
  }

  private async getDataSourceSyncSummaries(orgId: string, sourceIds: string[]) {
    if (sourceIds.length === 0) return new Map<string, {
      successCount: number
      failCount: number
    }>()
    const totals = await this.prisma.syncLog.groupBy({
      by: ['sourceId'],
      where: { orgId, sourceId: { in: sourceIds } },
      _sum: { addedCount: true, updatedCount: true, errorCount: true },
    })
    return new Map(totals.map((row) => {
      return [row.sourceId, {
        successCount: (row._sum.addedCount ?? 0) + (row._sum.updatedCount ?? 0),
        failCount: row._sum.errorCount ?? 0,
      }]
    }))
  }

  async getPartnerDataSources(user: AuthedUser): Promise<PartnerDataSourceLifecycleDto[]> {
    if (!user.orgId) {
      throw new BadRequestException({ error: { code: 'PARTNER_ORG_REQUIRED', message: 'partner 账号必须挂在机构下' } })
    }
    const sources = await this.prisma.jobSource.findMany({
      where: { orgId: user.orgId },
      orderBy: { updatedAt: 'desc' },
    })
    const summaries = await this.getDataSourceSyncSummaries(user.orgId, sources.map((source) => source.id))
    // 归档源仍然列出（运营要看得见历史来源与它导过的数据），只是标记为已归档。
    return sources.map((source) => withLifecycle(prismaJobSourceToPartnerDto(source, summaries.get(source.id)), source))
  }

  async getPartnerDataSourceCapabilities(user: AuthedUser) {
    if (!user.orgId) {
      throw new BadRequestException({ error: { code: 'PARTNER_ORG_REQUIRED', message: 'partner 账号必须挂在机构下' } })
    }
    const org = await this.getEnabledPartnerOrg(user.orgId)
    return getPartnerCapabilities(org.type)
  }

  async createPartnerDataSource(dto: CreateDataSourceDto, user: AuthedUser): Promise<PartnerDataSourceLifecycleDto> {
    if (!user.orgId) {
      throw new BadRequestException({ error: { code: 'PARTNER_ORG_REQUIRED', message: 'partner 账号必须挂在机构下' } })
    }
    const org = await this.getEnabledPartnerOrg(user.orgId)
    const accessMode = dto.accessMode ?? 'excel'
    const capabilities = getPartnerCapabilities(org.type)
    const sourceKind = dto.sourceKind ?? capabilities.defaultSourceKind
    const syncFreq = accessMode === 'api' ? (dto.syncFreq ?? 'manual') : 'manual'
    assertDataSourceCapability(org.type, accessMode, sourceKind)
    if (accessMode === 'api' && !dto.endpoint) {
      throw new BadRequestException({ error: { code: 'API_ENDPOINT_REQUIRED', message: 'API 数据源必须填写 endpoint' } })
    }
    const suppliedCredential = normalizeOptionalSecret(dto.credential)
    if (accessMode === 'webhook' && suppliedCredential) {
      assertWebhookSecretStrength(suppliedCredential)
    }
    const webhookSecretOnce = accessMode === 'webhook'
      ? (suppliedCredential ?? generateWebhookSecret())
      : undefined
    const source = await this.prisma.jobSource.create({
      data: {
        orgId: user.orgId,
        name: dto.name.trim(),
        sourceKind,
        accessMode,
        syncFreq,
        description: dto.description,
        endpoint: accessMode === 'api' ? dto.endpoint : undefined,
        authType: accessMode === 'api' ? dto.authType : undefined,
        // API/Webhook 必须由 Admin 完成风险检查后启用；文件/手工来源可立即使用。
        enabled: !isAdminManagedAccessMode(accessMode),
        encryptedCredential: accessMode === 'api' && suppliedCredential ? encryptSecret(suppliedCredential) : undefined,
        webhookSecret: webhookSecretOnce ? encryptSecret(webhookSecretOnce) : undefined,
        webhookSecretRotatedAt: webhookSecretOnce ? new Date() : undefined,
      },
    })
    await this.audit.write({
      actorId: user.userId,
      actorRole: user.role,
      action: 'data_source.create',
      targetType: 'job_source',
      targetId: source.id,
      payload: {
        accessMode,
        sourceKind,
        credentialConfigured: Boolean(suppliedCredential || webhookSecretOnce),
        enabled: source.enabled,
        activationManagedBy: isAdminManagedAccessMode(accessMode) ? 'admin' : 'partner',
      },
    })
    return {
      ...withLifecycle(prismaJobSourceToPartnerDto(source), source),
      webhookUrl: accessMode === 'webhook' ? `/api/v1/sync/webhook?source=${source.id}` : undefined,
      webhookSecretOnce,
    }
  }

  async togglePartnerDataSource(id: string, user: AuthedUser): Promise<PartnerDataSourceLifecycleDto> {
    if (!user.orgId) {
      throw new BadRequestException({ error: { code: 'PARTNER_ORG_REQUIRED', message: 'partner 账号必须挂在机构下' } })
    }
    const source = await this.prisma.jobSource.findUnique({ where: { id } })
    if (!source || source.orgId !== user.orgId) {
      throw new NotFoundException({ error: { code: 'DATA_SOURCE_NOT_FOUND', message: '数据源不存在' } })
    }
    const org = await this.getEnabledPartnerOrg(user.orgId)
    assertDataSourceCapability(org.type, source.accessMode, source.sourceKind)
    if (isAdminManagedAccessMode(source.accessMode)) {
      throw new ForbiddenException({
        error: {
          code: 'DATA_SOURCE_ADMIN_MANAGED',
          message: 'API/Webhook 数据源由管理员启停，请提交管理员完成接入风险检查',
        },
      })
    }
    // 归档源不得被重新启用：归档的全部意义就是"停止进数据"，
    // 允许 toggle 打开会让 archivedAt != null 且 enabled = true 的矛盾状态进库，
    // 而下游（sync.service 只看 enabled、治理链只看 archivedAt）会各读一半，判断分叉。
    if (source.archivedAt != null && !source.enabled) {
      throw new BadRequestException({
        error: {
          code: 'DATA_SOURCE_ARCHIVED',
          message: '数据源已归档，无法启用；请先取消归档',
        },
      })
    }
    const updated = await this.prisma.jobSource.update({
      where: { id },
      data: { enabled: !source.enabled },
    })
    const summaries = await this.getDataSourceSyncSummaries(user.orgId, [id])
    await this.audit.write({
      actorId: user.userId,
      actorRole: user.role,
      action: 'data_source.toggle',
      targetType: 'job_source',
      targetId: id,
      payload: { enabled: updated.enabled },
    })
    return withLifecycle(prismaJobSourceToPartnerDto(updated, summaries.get(id)), updated)
  }

  /**
   * 凭证轮换 —— 修复"密钥只写一次、丢了就永久废件"的上线阻塞。
   *
   * 安全口径（CLAUDE.md §12 / §18）：
   *   - 新密钥经 AES-256-GCM（common/crypto/secret-cipher）加密后落库，沿用建源时同一套加解密，
   *     不另起第二套密钥体系。
   *   - webhook 模式的新密钥**只在本次响应返回一次**；库里存的是密文，
   *     任何 GET（getPartnerDataSources）都只回 credentialConfigured / credentialRotatedAt。
   *   - 明文只在本方法栈内存在，不写日志、不进审计 payload。
   *
   * 旧密钥的失效时机：**立即**。webhookSecret 是单值列，覆盖写即生效，
   * 没有双密钥灰度窗口——sync.service 校验 HMAC 时只会解出当前这一个值。
   * 所以调用方（Partner 控制台）必须提示机构先与对接方约好切换时间。
   *
   * 停用但未归档时允许轮换：API/Webhook 创建后是 enabled=false，机构必须能在
   * 管理员启用前补发密钥。归档则禁止——归档是受害机构的自助止血（置 enabled=false
   * 且冻结密钥），不把 toggle 权限放给 partner。
   */
  async rotatePartnerDataSourceCredential(
    id: string,
    dto: RotateDataSourceCredentialDto,
    user: AuthedUser,
  ): Promise<PartnerDataSourceCredentialRotationResult> {
    if (!user.orgId) {
      throw new BadRequestException({ error: { code: 'PARTNER_ORG_REQUIRED', message: 'partner 账号必须挂在机构下' } })
    }
    const source = await this.prisma.jobSource.findUnique({ where: { id } })
    if (!source || source.orgId !== user.orgId) {
      throw new NotFoundException({ error: { code: 'DATA_SOURCE_NOT_FOUND', message: '数据源不存在' } })
    }
    const org = await this.getEnabledPartnerOrg(user.orgId)
    assertDataSourceCapability(org.type, source.accessMode, source.sourceKind)
    assertCredentialRotationConfirmed(dto.confirmPhrase)
    assertCredentialRotationNotArchived(source.archivedAt)
    assertCredentialRotationSourceCooldown(source)
    await assertCredentialRotationOrgRateLimit(this.prisma, user.orgId)

    const rotatedAt = new Date()
    let webhookSecretOnce: string | undefined
    const suppliedCredential = normalizeOptionalSecret(dto.credential)

    // 并发轮换必须打成冲突，不能各写各的（丢失更新）。
    //
    // 场景（2026-09-03 对抗性审查实证）：同一 webhook 源，两个已登录会话同时
    // POST rotate-credential，此前两次都返回 200、各带一枚不同的新密钥，库里只留
    // 最后写入的那一枚。先拿到响应的人把密钥交给对接方 → 推送全部 401，而两条审计
    // 都显示轮换成功，事后无从判断哪一枚才是有效的。前端的 submitting 挡不住两个标签页。
    //
    // 判据用读到的 webhookSecretRotatedAt 做 compare-and-set：只有仍是我读到的那个值
    // 才允许写。CAS 未命中即说明有人在我之前刚轮换过，直接拒绝，让调用方重取当前状态。
    const casWhere = { id, webhookSecretRotatedAt: source.webhookSecretRotatedAt }
    const assertRotationWon = (res: { count: number }) => {
      if (res.count === 0) {
        throw new BadRequestException({
          error: {
            code: 'CREDENTIAL_ROTATION_CONFLICT',
            message: '该数据源刚刚已被轮换，本次未生效；请刷新后确认当前密钥再决定是否再次轮换',
          },
        })
      }
    }

    if (source.accessMode === 'webhook') {
      // 留空则服务端用 CSPRNG 生成；传值则用机构自带密钥（对方系统密钥不可改时）。
      if (suppliedCredential) assertWebhookSecretStrength(suppliedCredential)
      webhookSecretOnce = suppliedCredential ?? generateWebhookSecret()
      assertRotationWon(await this.prisma.jobSource.updateMany({
        where: casWhere,
        data: {
          webhookSecret: encryptSecret(webhookSecretOnce),
          webhookSecretRotatedAt: rotatedAt,
        },
      }))
    } else if (source.accessMode === 'api') {
      // 上游 token 只能由机构从来源平台取得，平台无法代为签发，所以必填。
      if (!suppliedCredential) {
        throw new BadRequestException({
          error: {
            code: 'CREDENTIAL_REQUIRED',
            message: 'API 数据源轮换必须提供新的凭证（平台无法代为签发上游 token）',
          },
        })
      }
      assertRotationWon(await this.prisma.jobSource.updateMany({
        where: casWhere,
        data: {
          encryptedCredential: encryptSecret(suppliedCredential),
          webhookSecretRotatedAt: rotatedAt,
        },
      }))
    } else {
      // excel / csv / json / manual 没有任何凭证概念，轮换无意义。
      throw new BadRequestException({
        error: {
          code: 'DATA_SOURCE_HAS_NO_CREDENTIAL',
          message: '该接入方式不使用凭证，无需轮换',
        },
      })
    }

    await this.audit.write({
      actorId: user.userId,
      actorRole: user.role,
      action: 'data_source.credential_rotate',
      targetType: 'job_source',
      targetId: id,
      payload: {
        accessMode: source.accessMode,
        // 只记"轮换发生过"与来源，绝不记密钥本身或其任何片段/摘要。
        secretOrigin: suppliedCredential ? 'partner_supplied' : 'server_generated',
        rotatedAt: rotatedAt.toISOString(),
        previousRotatedAt: source.webhookSecretRotatedAt?.toISOString() ?? null,
        oldCredentialInvalidatedImmediately: true,
      },
    })

    return {
      id,
      accessMode: source.accessMode as PartnerDataSourceCredentialRotationResult['accessMode'],
      credentialConfigured: true,
      rotatedAt: rotatedAt.toISOString(),
      webhookSecretOnce,
    }
  }

  /**
   * 归档 / 取消归档数据源 —— 数据源的退役路径。
   *
   * ## 为什么是归档而不是物理删除
   *
   * 1. **三条必填外键指回来**：`SyncLog.sourceId`、`ImportBatch.sourceId`、
   *    `FieldMappingRule.sourceId` 都是非空 `String`（prisma/schema.prisma:1557/1586/1642）。
   *    硬删要么被外键约束挡下，要么必须级联删掉同步日志与导入批次——
   *    那正是 CLAUDE.md §11/§12 要求必须留存的记录。
   * 2. **会打断已导内容的来源链**：`Job.sourceId` / `JobFair.sourceId` 可空，硬删只能置空，
   *    而 CLAUDE.md §10 要求岗位详情展示来源机构与同步时间；置空后这些已发布内容
   *    就成了追不回源头的孤儿数据。
   * 3. **产品口径早已定过**：docs/product/partner-permission-matrix.md:44
   *    「删除数据源 ❌ 未上线，P1 改为归档」，五类机构全部不开放删除。
   * 4. **归档语义在下游已经生效**：治理链 recruitment-wave2-plan.ts:183 已经把
   *    `source.archivedAt` 判为 `source_archived` 发布阻断原因——字段和语义都是现成的，
   *    这里只是补上写入口，不是新造一套状态机。
   *
   * ## 归档做什么、不做什么
   *
   * 做：置 `archivedAt` 并同时 `enabled = false`。停止进数据这一步不需要改 sync 侧代码——
   * Webhook 接收（sync.service.ts:87 的 `!source.enabled`）与 API 拉取
   * （job-sync.service.ts:183/224/340）本来就以 enabled 为闸门。
   *
   * 不做：**不下架已发布的岗位/招聘会**。批量下架是独立的、需要单独确认的管理员动作
   * （job-sync.service 的 `unpublishSourceContent`，带影响面预览），
   * 且现有 verify 明确断言"停用来源不得级联下架已发布内容"。归档沿用同一口径。
   *
   * 取消归档只清 `archivedAt`，**不自动恢复 enabled**：重新进数据必须是一次显式动作
   * （API/Webhook 走管理员 setSourceEnabled，文件/手工来源走 partner 自助 toggle）。
   */
  async archivePartnerDataSource(
    id: string,
    archived: boolean,
    user: AuthedUser,
  ): Promise<PartnerDataSourceLifecycleDto> {
    if (!user.orgId) {
      throw new BadRequestException({ error: { code: 'PARTNER_ORG_REQUIRED', message: 'partner 账号必须挂在机构下' } })
    }
    const source = await this.prisma.jobSource.findUnique({ where: { id } })
    if (!source || source.orgId !== user.orgId) {
      throw new NotFoundException({ error: { code: 'DATA_SOURCE_NOT_FOUND', message: '数据源不存在' } })
    }
    const org = await this.getEnabledPartnerOrg(user.orgId)
    assertDataSourceCapability(org.type, source.accessMode, source.sourceKind)

    const alreadyInTargetState = (source.archivedAt != null) === archived
    if (alreadyInTargetState) {
      const summaries = await this.getDataSourceSyncSummaries(user.orgId, [id])
      return withLifecycle(prismaJobSourceToPartnerDto(source, summaries.get(id)), source)
    }

    const updated = await this.prisma.jobSource.update({
      where: { id },
      data: archived
        ? { archivedAt: new Date(), enabled: false }
        : { archivedAt: null },
    })
    const summaries = await this.getDataSourceSyncSummaries(user.orgId, [id])
    await this.audit.write({
      actorId: user.userId,
      actorRole: user.role,
      action: archived ? 'data_source.archive' : 'data_source.unarchive',
      targetType: 'job_source',
      targetId: id,
      payload: {
        accessMode: source.accessMode,
        fromEnabled: source.enabled,
        toEnabled: updated.enabled,
        archivedAt: updated.archivedAt?.toISOString() ?? null,
        // 说清这次动作没碰内容：已发布岗位/招聘会保持原状,下架是另一条需单独确认的路径。
        publishedContentUntouched: true,
      },
    })
    return withLifecycle(prismaJobSourceToPartnerDto(updated, summaries.get(id)), updated)
  }

  async getPartnerJobs(user: AuthedUser): Promise<PartnerJobDto[]> {
    if (!user.orgId) return []
    const rows = await this.prisma.job.findMany({
      where: { sourceOrgId: user.orgId },
      orderBy: { createdAt: 'desc' },
    })
    return rows.map(prismaJobToPartnerDto)
  }

  async importJobs(items: ImportJobItemDto[], user: AuthedUser): Promise<ImportResult<PartnerJobDto>> {
    if (user.role !== 'partner' || !user.orgId) {
      throw new BadRequestException({ error: { code: 'PARTNER_ORG_REQUIRED', message: 'partner 账号必须挂在机构下' } })
    }
    const org = await this.getEnabledPartnerOrg(user.orgId)
    assertPartnerDataTypeCapability(org.type, 'job')
    const sourceOrgId = org.id
    const sourceName  = org.name
    const sync        = new Date()
    const out: PartnerJobDto[] = []
    const touchedJobIds: string[] = []
    for (const item of items) {
      try {
        const job = await this.prisma.job.upsert({
          where: { sourceOrgId_externalId: { sourceOrgId, externalId: item.externalId } },
          create: {
            sourceOrgId, externalId: item.externalId, sourceName,
            sourceUrl: normalizeOptionalHttpUrl(item.sourceUrl, 'sourceUrl') ?? '',
            title: item.title, company: item.company, city: item.city,
            category: item.workType ? mapWorkTypeToCategory(item.workType) : undefined,
            salary: item.salary,
            description: item.description, requirements: item.requirements,
            tagsJson: JSON.stringify(buildJobTags(item.tags, item.industry)),
            educationRequirement: item.educationRequirement,
            experienceRequirement: item.experienceRequirement,
            skillsJson: JSON.stringify(item.skills ?? []),
            benefitsJson: JSON.stringify(item.benefits ?? []),
            salaryMin: item.salaryMin,
            salaryMax: item.salaryMax,
            salaryUnit: item.salaryUnit,
            validThrough: item.validThrough ? new Date(item.validThrough) : undefined,
            headcount: item.headcount ?? undefined,
            reviewStatus: 'pending', publishStatus: 'draft',
            syncTime: sync,
          },
          update: {
            sourceName, sourceUrl: normalizeOptionalHttpUrl(item.sourceUrl, 'sourceUrl') ?? '',
            title: item.title, company: item.company, city: item.city,
            category: item.workType ? mapWorkTypeToCategory(item.workType) : undefined,
            salary: item.salary,
            description: item.description, requirements: item.requirements,
            tagsJson: JSON.stringify(buildJobTags(item.tags, item.industry)),
            educationRequirement: item.educationRequirement,
            experienceRequirement: item.experienceRequirement,
            skillsJson: JSON.stringify(item.skills ?? []),
            benefitsJson: JSON.stringify(item.benefits ?? []),
            salaryMin: item.salaryMin,
            salaryMax: item.salaryMax,
            salaryUnit: item.salaryUnit,
            validThrough: item.validThrough ? new Date(item.validThrough) : undefined,
            headcount: item.headcount ?? undefined,
            // Partner 主动导入一律回 pending+draft 强制重审，即使已发布也立即下架。
            // 同时清空上一次审核元数据，否则会出现「当前 pending 却仍显示上次审核人/时间/拒绝原因」的脏状态。
            reviewStatus: 'pending',
            publishStatus: 'draft',
            rejectReason: null,
            reviewedBy: null,
            reviewedAt: null,
            syncTime: sync,
          },
        })
        touchedJobIds.push(job.id)
        out.push(prismaJobToPartnerDto(job))
      } catch (e) {
        this.logger.error(`importJobs upsert failed: orgId=${sourceOrgId} extId=${item.externalId}`, e as Error)
        throw new InternalServerErrorException({ error: { code: 'IMPORT_FAILED', message: '岗位导入失败,请稍后重试' } })
      }
    }
    await this.audit.write({
      actorId: user.userId,
      actorRole: 'partner',
      action: 'job.import',
      targetType: 'job',
      targetId: null,
      payload: { count: out.length, externalIds: out.map((o) => o.externalId).slice(0, 20) },
    })
    this.logger.log(`importJobs: orgId=${sourceOrgId} count=${out.length}`)
    await this.refreshJobQualitySnapshots(touchedJobIds)
    return { imported: out.length, items: out }
  }

  async importJobsFromWebhook(orgId: string, sourceId: string, items: ImportJobItemDto[]): Promise<ImportResult<PartnerJobDto>> {
    const org = await this.getEnabledPartnerOrg(orgId)
    assertPartnerDataTypeCapability(org.type, 'job')
    const sourceName = org.name
    const sync = new Date()
    const out: PartnerJobDto[] = []
    const touchedJobIds: string[] = []
    let added = 0
    let updated = 0
    let currentExternalId = ''
    try {
      await this.prisma.$transaction(async (tx) => {
        const existingExternalIds = new Set(
          (await tx.job.findMany({
            where: { sourceOrgId: orgId, externalId: { in: items.map((item) => item.externalId) } },
            select: { externalId: true },
          })).map((job) => job.externalId),
        )
        for (const item of items) {
          currentExternalId = item.externalId
          const job = await tx.job.upsert({
            where: { sourceOrgId_externalId: { sourceOrgId: orgId, externalId: item.externalId } },
            create: {
              sourceOrgId: orgId, sourceId, externalId: item.externalId, sourceName,
              sourceUrl: normalizeOptionalHttpUrl(item.sourceUrl, 'sourceUrl') ?? '',
              title: item.title, company: item.company, city: item.city,
              category: item.workType ? mapWorkTypeToCategory(item.workType) : undefined,
              salary: item.salary,
              description: item.description, requirements: item.requirements,
              tagsJson: JSON.stringify(buildJobTags(item.tags, item.industry)),
              educationRequirement: item.educationRequirement,
              experienceRequirement: item.experienceRequirement,
              skillsJson: JSON.stringify(item.skills ?? []),
              benefitsJson: JSON.stringify(item.benefits ?? []),
              salaryMin: item.salaryMin,
              salaryMax: item.salaryMax,
              salaryUnit: item.salaryUnit,
              validThrough: item.validThrough ? new Date(item.validThrough) : undefined,
            headcount: item.headcount ?? undefined,
              reviewStatus: 'pending', publishStatus: 'draft',
              syncTime: sync,
            },
            update: {
              sourceId,
              sourceName, sourceUrl: normalizeOptionalHttpUrl(item.sourceUrl, 'sourceUrl') ?? '',
              title: item.title, company: item.company, city: item.city,
              category: item.workType ? mapWorkTypeToCategory(item.workType) : undefined,
              salary: item.salary,
              description: item.description, requirements: item.requirements,
              tagsJson: JSON.stringify(buildJobTags(item.tags, item.industry)),
              educationRequirement: item.educationRequirement,
              experienceRequirement: item.experienceRequirement,
              skillsJson: JSON.stringify(item.skills ?? []),
              benefitsJson: JSON.stringify(item.benefits ?? []),
              salaryMin: item.salaryMin,
              salaryMax: item.salaryMax,
              salaryUnit: item.salaryUnit,
              validThrough: item.validThrough ? new Date(item.validThrough) : undefined,
            headcount: item.headcount ?? undefined,
              // Partner Webhook 主动推送一律回 pending+draft 强制重审，即使已发布也立即下架。
              // 同时清空上一次审核元数据，避免 pending 记录仍带旧审核人/时间/拒绝原因。
              reviewStatus: 'pending',
              publishStatus: 'draft',
              rejectReason: null,
              reviewedBy: null,
              reviewedAt: null,
              syncTime: sync,
            },
          })
          touchedJobIds.push(job.id)
          out.push(prismaJobToPartnerDto(job))
          if (existingExternalIds.has(item.externalId)) updated++
          else added++
        }
      })
    } catch (e) {
      this.logger.error(`importJobsFromWebhook upsert failed: orgId=${orgId} extId=${currentExternalId}`, e as Error)
      throw new InternalServerErrorException({ error: { code: 'IMPORT_FAILED', message: 'Webhook 导入失败,请稍后重试' } })
    }
    await this.refreshJobQualitySnapshots(touchedJobIds)
    return { imported: out.length, items: out, added, updated }
  }

  async unpublishPartnerJob(id: string, user: AuthedUser): Promise<PartnerJobDto> {
    if (!user.orgId) {
      throw new BadRequestException({ error: { code: 'PARTNER_ORG_REQUIRED', message: 'partner 账号必须挂在机构下' } })
    }
    const job = await this.prisma.job.findUnique({ where: { id } })
    if (!job || job.sourceOrgId !== user.orgId) {
      throw new NotFoundException({ error: { code: 'JOB_NOT_FOUND', message: `Job ${id} not found` } })
    }
    const updated = await this.prisma.job.update({
      where: { id },
      data: { publishStatus: 'unpublished' },
    })
    await this.audit.write({
      actorId: user.userId,
      actorRole: user.role,
      action: 'job.partner_unpublish',
      targetType: 'job',
      targetId: id,
      payload: { fromPublishStatus: job.publishStatus, toPublishStatus: 'unpublished' },
    })
    return prismaJobToPartnerDto(updated)
  }

  async updatePartnerJob(id: string, dto: UpdatePartnerJobDto, user: AuthedUser): Promise<PartnerJobDto> {
    if (user.role !== 'partner' || !user.orgId) {
      throw new BadRequestException({ error: { code: 'PARTNER_ORG_REQUIRED', message: 'partner 账号必须挂在机构下' } })
    }
    const org = await this.getEnabledPartnerOrg(user.orgId)
    assertPartnerDataTypeCapability(org.type, 'job')
    const job = await this.prisma.job.findUnique({ where: { id } })
    if (!job || job.sourceOrgId !== user.orgId) {
      throw new NotFoundException({ error: { code: 'JOB_NOT_FOUND', message: `Job ${id} not found` } })
    }
    const changedFields = Object.keys(dto).filter((k) => (dto as Record<string, unknown>)[k] !== undefined)
    const updated = await this.prisma.job.update({
      where: { id },
      data: {
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.company !== undefined ? { company: dto.company } : {}),
        ...(dto.city !== undefined ? { city: dto.city } : {}),
        ...(dto.sourceUrl !== undefined ? { sourceUrl: normalizeOptionalHttpUrl(dto.sourceUrl, 'sourceUrl') ?? '' } : {}),
        ...(dto.salary !== undefined ? { salary: dto.salary } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.requirements !== undefined ? { requirements: dto.requirements } : {}),
        ...(dto.tags !== undefined ? { tagsJson: JSON.stringify(dto.tags) } : {}),
        ...(dto.workType !== undefined ? { category: mapWorkTypeToCategory(dto.workType) } : {}),
        ...(dto.educationRequirement !== undefined ? { educationRequirement: dto.educationRequirement } : {}),
        ...(dto.experienceRequirement !== undefined ? { experienceRequirement: dto.experienceRequirement } : {}),
        ...(dto.skills !== undefined ? { skillsJson: JSON.stringify(dto.skills) } : {}),
        ...(dto.benefits !== undefined ? { benefitsJson: JSON.stringify(dto.benefits) } : {}),
        ...(dto.salaryMin !== undefined ? { salaryMin: dto.salaryMin } : {}),
        ...(dto.salaryMax !== undefined ? { salaryMax: dto.salaryMax } : {}),
        ...(dto.salaryUnit !== undefined ? { salaryUnit: dto.salaryUnit } : {}),
        ...(dto.validThrough !== undefined ? { validThrough: new Date(dto.validThrough) } : {}),
        ...(dto.headcount !== undefined ? { headcount: dto.headcount } : {}),
        reviewStatus: 'pending',
        publishStatus: 'draft',
        rejectReason: null,
        reviewedBy: null,
        reviewedAt: null,
        syncTime: new Date(),
      },
    })
    await this.audit.write({
      actorId: user.userId,
      actorRole: 'partner',
      action: 'job.partner_update',
      targetType: 'job',
      targetId: id,
      payload: { changedFields, fromReviewStatus: job.reviewStatus, fromPublishStatus: job.publishStatus },
    })
    await this.refreshJobQualitySnapshots([updated.id])
    this.logger.log(`updatePartnerJob: id=${id} orgId=${user.orgId} fields=${changedFields.join(',')}`)
    return prismaJobToPartnerDto(updated)
  }

  async getPartnerFairs(user: AuthedUser): Promise<PartnerFairDto[]> {
    if (!user.orgId) return []
    const rows = await this.prisma.jobFair.findMany({
      where: { sourceOrgId: user.orgId },
      orderBy: { createdAt: 'desc' },
    })
    return rows.map(prismaFairToPartnerDto)
  }

  async importFairs(dto: ImportFairsDto, user: AuthedUser): Promise<ImportResult<PartnerFairDto>> {
    if (user.role !== 'partner' || !user.orgId) {
      throw new BadRequestException({ error: { code: 'PARTNER_ORG_REQUIRED', message: 'partner 账号必须挂在机构下' } })
    }
    const org = await this.getEnabledPartnerOrg(user.orgId)
    assertPartnerDataTypeCapability(org.type, 'fair')
    const sourceOrgId = org.id
    const sourceName  = org.name
    const sync        = new Date()
    const out: PartnerFairDto[] = []
    for (const item of dto.items) {
      const startAt = new Date(item.startAt)
      const endAt   = new Date(item.endAt)
      const checkinUrl = normalizeOptionalHttpUrl(item.checkinUrl, 'checkinUrl')
      if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
        throw new BadRequestException({
          error: { code: 'INVALID_DATETIME', message: `招聘会 ${item.externalId} 的时间格式无效(需 ISO 8601)` },
        })
      }
      if (endAt.getTime() <= startAt.getTime()) {
        throw new BadRequestException({
          error: { code: 'INVALID_DATE_RANGE', message: `招聘会 ${item.externalId} 的结束时间必须晚于开始时间` },
        })
      }
      try {
        const fair = await this.prisma.jobFair.upsert({
          where: { sourceOrgId_externalId: { sourceOrgId, externalId: item.externalId } },
          create: {
            sourceOrgId, externalId: item.externalId, sourceName,
            sourceUrl: normalizeOptionalHttpUrl(item.sourceUrl, 'sourceUrl') ?? '',
            checkinUrl,
            title: item.title,
            theme: item.theme ?? 'general',
            startAt, endAt,
            venue: item.venue, city: item.city,
            address: item.address,
            mapImageUrl: item.mapImageUrl,
            coverImageUrl: item.coverImageUrl,
            description: item.description,
            companyCount: item.companyCount ?? 0,
            jobCount: item.jobCount ?? 0,
            reviewStatus: 'pending', publishStatus: 'draft',
            syncTime: sync,
          },
          update: {
            sourceName, sourceUrl: normalizeOptionalHttpUrl(item.sourceUrl, 'sourceUrl') ?? '',
            checkinUrl: normalizeOptionalHttpUrl(item.checkinUrl, 'checkinUrl'),
            title: item.title,
            theme: item.theme ?? 'general',
            startAt, endAt,
            venue: item.venue, city: item.city,
            address: item.address,
            mapImageUrl: item.mapImageUrl,
            coverImageUrl: item.coverImageUrl,
            description: item.description,
            companyCount: item.companyCount ?? undefined,
            jobCount: item.jobCount ?? undefined,
            // Partner 主动导入招聘会一律回 pending+draft 强制重审，即使已发布也立即下架。
            // 同时清空上一次审核元数据，避免 pending 记录仍带旧审核人/时间/拒绝原因。
            reviewStatus: 'pending',
            publishStatus: 'draft',
            rejectReason: null,
            reviewedBy: null,
            reviewedAt: null,
            syncTime: sync,
          },
        })
        out.push(prismaFairToPartnerDto(fair))
      } catch (e) {
        this.logger.error(`importFairs upsert failed: orgId=${sourceOrgId} extId=${item.externalId}`, e as Error)
        throw new InternalServerErrorException({ error: { code: 'IMPORT_FAILED', message: '招聘会导入失败,请稍后重试' } })
      }
    }
    await this.audit.write({
      actorId: user.userId,
      actorRole: 'partner',
      action: 'fair.import',
      targetType: 'fair',
      targetId: null,
      payload: { count: out.length, externalIds: out.map((o) => o.externalId).slice(0, 20) },
    })
    this.logger.log(`importFairs: orgId=${sourceOrgId} count=${out.length}`)
    return { imported: out.length, items: out }
  }

  async unpublishPartnerFair(id: string, user: AuthedUser): Promise<PartnerFairDto> {
    if (!user.orgId) {
      throw new BadRequestException({ error: { code: 'PARTNER_ORG_REQUIRED', message: 'partner 账号必须挂在机构下' } })
    }
    const fair = await this.prisma.jobFair.findUnique({ where: { id } })
    if (!fair || fair.sourceOrgId !== user.orgId) {
      throw new NotFoundException({ error: { code: 'FAIR_NOT_FOUND', message: `Fair ${id} not found` } })
    }
    const updated = await this.prisma.jobFair.update({
      where: { id },
      data: { publishStatus: 'unpublished' },
    })
    await this.audit.write({
      actorId: user.userId,
      actorRole: user.role,
      action: 'fair.partner_unpublish',
      targetType: 'fair',
      targetId: id,
      payload: { fromPublishStatus: fair.publishStatus, toPublishStatus: 'unpublished' },
    })
    return prismaFairToPartnerDto(updated)
  }

  async updatePartnerFair(id: string, dto: UpdatePartnerFairDto, user: AuthedUser): Promise<PartnerFairDto> {
    if (user.role !== 'partner' || !user.orgId) {
      throw new BadRequestException({ error: { code: 'PARTNER_ORG_REQUIRED', message: 'partner 账号必须挂在机构下' } })
    }
    const org = await this.getEnabledPartnerOrg(user.orgId)
    assertPartnerDataTypeCapability(org.type, 'fair')
    const fair = await this.prisma.jobFair.findUnique({ where: { id } })
    if (!fair || fair.sourceOrgId !== user.orgId) {
      throw new NotFoundException({ error: { code: 'FAIR_NOT_FOUND', message: `Fair ${id} not found` } })
    }
    const startAt = dto.startAt ? new Date(dto.startAt) : fair.startAt
    const endAt   = dto.endAt ? new Date(dto.endAt) : fair.endAt
    const checkinUrlUpdate = dto.checkinUrl !== undefined
      ? { checkinUrl: normalizeOptionalHttpUrl(dto.checkinUrl, 'checkinUrl') }
      : {}
    if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime()) || endAt.getTime() <= startAt.getTime()) {
      throw new BadRequestException({ error: { code: 'INVALID_DATE_RANGE', message: '结束时间必须晚于开始时间' } })
    }
    const changedFields = Object.keys(dto).filter((k) => (dto as Record<string, unknown>)[k] !== undefined)
    const updated = await this.prisma.jobFair.update({
      where: { id },
      data: {
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.theme !== undefined ? { theme: dto.theme } : {}),
        ...(dto.startAt !== undefined ? { startAt } : {}),
        ...(dto.endAt !== undefined ? { endAt } : {}),
        ...(dto.venue !== undefined ? { venue: dto.venue } : {}),
        ...(dto.city !== undefined ? { city: dto.city } : {}),
        ...(dto.address !== undefined ? { address: dto.address } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.sourceUrl !== undefined ? { sourceUrl: normalizeOptionalHttpUrl(dto.sourceUrl, 'sourceUrl') ?? '' } : {}),
        ...checkinUrlUpdate,
        reviewStatus: 'pending',
        publishStatus: 'draft',
        rejectReason: null,
        reviewedBy: null,
        reviewedAt: null,
        syncTime: new Date(),
      },
    })
    await this.audit.write({
      actorId: user.userId,
      actorRole: 'partner',
      action: 'fair.partner_update',
      targetType: 'fair',
      targetId: id,
      payload: { changedFields, fromReviewStatus: fair.reviewStatus, fromPublishStatus: fair.publishStatus },
    })
    this.logger.log(`updatePartnerFair: id=${id} orgId=${user.orgId} fields=${changedFields.join(',')}`)
    return prismaFairToPartnerDto(updated)
  }

  async getPartnerDashboard(user: AuthedUser) {
    if (!user.orgId) {
      throw new ForbiddenException({ error: { code: 'ORG_REQUIRED', message: '当前账号未绑定机构' } })
    }
    const orgId = user.orgId
    const [
      jobsTotal, jobsPublished, jobsPending,
      fairsTotal, fairsPublished, fairsPending,
      policiesTotal, policiesPublished, policiesPending,
      sourcesTotal, sourcesEnabled,
      recentSyncRows,
    ] = await Promise.all([
      this.prisma.job.count({ where: { sourceOrgId: orgId } }),
      this.prisma.job.count({ where: { sourceOrgId: orgId, publishStatus: 'published' } }),
      this.prisma.job.count({ where: { sourceOrgId: orgId, reviewStatus: 'pending' } }),
      this.prisma.jobFair.count({ where: { sourceOrgId: orgId } }),
      this.prisma.jobFair.count({ where: { sourceOrgId: orgId, publishStatus: 'published' } }),
      this.prisma.jobFair.count({ where: { sourceOrgId: orgId, reviewStatus: 'pending' } }),
      this.prisma.policyPost.count({ where: { sourceOrgId: orgId } }),
      this.prisma.policyPost.count({ where: { sourceOrgId: orgId, publishStatus: 'published' } }),
      this.prisma.policyPost.count({ where: { sourceOrgId: orgId, reviewStatus: 'pending' } }),
      this.prisma.jobSource.count({ where: { orgId } }),
      this.prisma.jobSource.count({ where: { orgId, enabled: true } }),
      this.prisma.syncLog.findMany({
        where: { orgId },
        orderBy: { createdAt: 'desc' },
        take: 5,
        include: { source: { select: { name: true } } },
      }),
    ])
    return {
      jobs: { total: jobsTotal, published: jobsPublished, pending: jobsPending },
      fairs: { total: fairsTotal, published: fairsPublished, pending: fairsPending },
      policies: { total: policiesTotal, published: policiesPublished, pending: policiesPending },
      pendingTotal: jobsPending + fairsPending + policiesPending,
      sources: { total: sourcesTotal, enabled: sourcesEnabled },
      recentSyncs: recentSyncRows.map((r) => ({
        id: r.id,
        source: r.source?.name ?? r.sourceId,
        dataType: r.dataType,
        status: r.result,
        addedCount: r.addedCount,
        updatedCount: r.updatedCount,
        errorCount: r.errorCount,
        syncTime: fmtSyncTime(r.createdAt),
      })),
    }
  }

  async getPartnerSyncLogs(
    user: AuthedUser,
    query: {
      page: number
      pageSize: number
      sourceId?: string
      result?: 'success' | 'partial' | 'failed'
    },
  ): Promise<PaginatedResult<SyncLogDto>> {
    if (!user.orgId) {
      return {
        data: [],
        pagination: { page: query.page, pageSize: query.pageSize, total: 0, totalPages: 1 },
      }
    }
    const where = {
      orgId: user.orgId,
      ...(query.sourceId ? { sourceId: query.sourceId } : {}),
      ...(query.result ? { result: query.result } : {}),
    }
    const [total, rows] = await Promise.all([
      this.prisma.syncLog.count({ where }),
      this.prisma.syncLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { source: { select: { name: true } } },
      }),
    ])
    return {
      data: rows.map((r) => ({
        id: r.id,
        no: r.id,
        source: r.source?.name ?? r.sourceId,
        dataType: r.dataType as 'job' | 'fair',
        addedCount: r.addedCount,
        updatedCount: r.updatedCount,
        errorCount: r.errorCount,
        dupCount: r.dupCount,
        errorFields: r.errorFields === '[]' ? null : r.errorFields,
        errorDetail: r.errorDetail,
        syncTime: fmtSyncTime(r.createdAt),
        status: r.result as 'success' | 'partial' | 'failed',
      })),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      },
    }
  }
}
