import { Injectable, NotFoundException, OnModuleDestroy } from '@nestjs/common'
import { createHash } from 'node:crypto'
import { FilesService } from '../files/files.service'
import { PRINT_ARTIFACT_URL_TTL_MS, signFileUrl } from '../files/signing'
import { PrismaService } from '../prisma/prisma.service'
import { createPrismaClient, type AppPrismaClient } from '../prisma/create-client'
import { checklistMetadata } from './policy-checklist-metadata'
import { renderPolicyChecklist } from './policy-checklist-pdf'
import { publicPolicyLookupWhere } from './policy-public-visibility'

// 开发 SQLite 与同进程多个 service 实例共享；生产多进程再由 PostgreSQL 事务锁串行化。
const pendingFiles = new Map<string, Promise<string>>()

@Injectable()
export class PolicyChecklistService implements OnModuleDestroy {
  private lockClient: AppPrismaClient | null = null

  constructor(private readonly prisma: PrismaService, private readonly files: FilesService) {}

  async onModuleDestroy(): Promise<void> {
    await this.lockClient?.$disconnect()
    this.lockClient = null
  }

  async generate(policyId: string) {
    // 办事清单只给扶持条目：公告没有三栏，按编号来也当不在可查看范围。
    const policy = await this.prisma.policyPost.findFirst({
      where: await publicPolicyLookupWhere(this.prisma, {
        id: policyId, kind: 'policy_guide', reviewStatus: 'approved', publishStatus: 'published',
      }, { mode: 'all' }),
      include: { org: { select: { verifiedOfficialDomainsJson: true } } },
    })
    if (!policy) throw policyNotFound()
    const metadata = checklistMetadata(policy.id, policy.contentVersion)
    const cacheKey = `${process.env['DATABASE_URL']}\n${metadata}`
    let pending = pendingFiles.get(cacheKey)
    if (!pending) {
      pending = this.withGenerationLock(policy, metadata)
      pendingFiles.set(cacheKey, pending)
    }
    let fileId: string
    try { fileId = await pending } finally {
      if (pendingFiles.get(cacheKey) === pending) pendingFiles.delete(cacheKey)
    }
    // 渲染期间机构可能修改 / 下架；不签发已经不可公开的政策文件。
    const current = await this.prisma.policyPost.findFirst({
      where: await publicPolicyLookupWhere(this.prisma, {
        id: policy.id, contentVersion: policy.contentVersion, reviewStatus: 'approved', publishStatus: 'published',
      }, { mode: 'all' }),
      select: { id: true },
    })
    if (!current) throw policyNotFound()
    const file = await this.prisma.fileObject.findUniqueOrThrow({ where: { id: fileId } })
    const signed = signFileUrl(file.id, PRINT_ARTIFACT_URL_TTL_MS, file.expiresAt!.getTime())
    const phoneUrl = publicPhoneUrl(signed.url)
    return {
      policyId: policy.id, contentVersion: policy.contentVersion,
      fileId: file.id, filename: file.filename, pageCount: 1, sizeBytes: file.sizeBytes,
      printFileUrl: signed.url, phoneUrl,
      phoneUrlExpiresAt: phoneUrl ? signed.expiresAt.toISOString() : null,
    }
  }

  private async withGenerationLock(policy: Parameters<typeof renderPolicyChecklist>[0] & { id: string; contentVersion: number }, metadata: string) {
    if (this.prisma.dbKind !== 'postgres') return this.findOrGenerate(policy, metadata)
    // 独立连接池持锁，避免并发锁事务占满 FilesService 的工作连接池后互相等待。
    this.lockClient ??= createPrismaClient(process.env['DATABASE_URL']!).client
    // 文件复用查询在拿锁后执行。事务只持 advisory lock，不锁政策行；文件仍经 FilesService 落库。
    // 连接 / 进程退出会释放锁，不留下需要人工清理的租约或占位文件。
    const hash = createHash('sha256').update(metadata).digest('hex').slice(0, 16)
    const lockId = BigInt.asIntN(64, BigInt(`0x${hash}`))
    return this.lockClient.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(${lockId}::bigint)`
      return this.findOrGenerate(policy, metadata)
    }, { timeout: 60_000 })
  }

  private async findOrGenerate(policy: Parameters<typeof renderPolicyChecklist>[0] & { id: string; contentVersion: number }, metadata: string) {
    const existing = await this.prisma.fileObject.findFirst({
      where: { purpose: 'policy_checklist', createdBy: metadata, status: 'active', deletedAt: null,
        expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'asc' },
    })
    if (existing) return existing.id
    const pdf = await renderPolicyChecklist(policy)
    const file = await this.files.upload({
      buffer: pdf.buffer, filename: checklistFilename(policy.title), mimeType: 'application/pdf',
      purpose: 'policy_checklist', sensitiveLevel: 'normal', uploaderId: null, endUserId: null,
      assetCategory: 'derived', derivationKind: 'ai_generated', sourceFileId: null,
      actorRole: null, actorOrgId: null, createdBy: metadata,
    })
    return file.fileId
  }
}

export function checklistFilename(title: string): string {
  const safe = Array.from(title).filter((char) => char.codePointAt(0)! > 31 && char !== '\u007f')
    .join('').replace(/[<>:"/\\|?*]/gu, '').trim()
  const shortened = Array.from(safe).slice(0, 70).join('')
  return `材料清单-${shortened || '政策'}.pdf`
}

function policyNotFound() {
  return new NotFoundException({ error: {
    code: 'POLICY_NOT_FOUND', message: '这条政策已经撤下或不在可查看范围',
  } })
}

/** 复用手机上传的运营配置；没有公网 HTTPS 域名时不猜 host，不回 localhost / 相对地址。 */
export function publicPhoneUrl(path: string): string | null {
  const configured = process.env['KIOSK_PUBLIC_BASE_URL']?.trim()
  if (!configured) return null
  try {
    const origin = new URL(configured)
    const host = origin.hostname.toLowerCase()
    if (origin.protocol !== 'https:' || origin.username || origin.password
      || !host.includes('.') || /^[\d.]+$/u.test(host) || host.includes(':')
      || /(?:^|\.)(?:localhost|local|internal|test|invalid)$/u.test(host)) return null
    return new URL(`${path}&disposition=attachment`, origin.origin).toString()
  } catch { return null }
}
