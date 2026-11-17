/**
 * 批量预建、一次性绑定码、作废重发、按批次看激活结果。
 * 默认自建临时 SQLite。--postgres 只用调用方给出的本机隔离库，不 db push。
 * 绑定码明文只出现在生成结果里。库、审计和列表都不许带明文。
 *
 * 终端管理服务只用来读列表。密钥必须写在动态加载终端模块之前。
 */
process.env['TERMINAL_ADMIN_SECRET'] ||= 'verify-terminal-batch-activation-admin-secret-0123456789'
process.env['TERMINAL_ACTION_TOKEN_SECRET'] ||= 'verify-terminal-batch-activation-action-secret-0123456789'
process.env['ADMIN_IP_ALLOWLIST'] = ''
process.env['RECRUITMENT_CONTENT_HOSTING_ENABLED'] = 'false'
process.env['TERMINAL_PLANNED_PROVISIONING_ENABLED'] = 'true'
process.env['NODE_ENV'] = 'test'

import 'reflect-metadata'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { closeSync, mkdtempSync, openSync, rmSync } from 'node:fs'
import { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { BadRequestException, HttpException, Module, ValidationPipe, type ValidationError } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { JwtService } from '@nestjs/jwt'
import { AuditService } from '../src/audit/audit.service'
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter'
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard'
import { RolesGuard } from '../src/common/guards/roles.guard'
import { RedisService } from '../src/common/redis/redis.service'
import { PrismaService } from '../src/prisma/prisma.service'
import { AdminTerminalBatchController } from '../src/terminals/admin-terminal-batch.controller'
import { TerminalCredentialSecurityService } from '../src/terminals/terminal-credential-security.service'
import { TerminalBatchService } from '../src/terminals/terminal-batch.service'
import { PLANNED_CREDENTIAL_PREFIX, hashBindCode } from '../src/terminals/terminal-utils'
import { assertIsolatedVerificationDatabase } from './support/isolated-verification-database'

const API_ROOT = resolve(__dirname, '..')

function flatten(errors: ValidationError[], parent = ''): string[] {
  const out: string[] = []
  for (const error of errors) {
    const label = parent ? `${parent}.${error.property}` : error.property
    if (error.constraints) out.push(...Object.values(error.constraints).map((item) => `${label}: ${item}`))
    if (error.children?.length) out.push(...flatten(error.children, label))
  }
  return out
}

function errorCode(error: unknown): string | undefined {
  if (!(error instanceof HttpException)) return undefined
  const body = error.getResponse() as { error?: { code?: string; message?: string } }
  return body.error?.code
}

function errorMessage(error: unknown): string {
  if (!(error instanceof HttpException)) return String(error)
  const body = error.getResponse() as { error?: { message?: string } }
  return body.error?.message ?? error.message
}

async function expectCode(action: () => Promise<unknown>, code: string, label: string): Promise<void> {
  try {
    await action()
  } catch (error) {
    assert.equal(errorCode(error), code, `${label} → ${errorCode(error) ?? 'no-code'} ${errorMessage(error)}`)
    return
  }
  throw new Error(`${label}: 期望 ${code}，实际成功了`)
}

function pushSqlite(url: string): void {
  const prismaBin = join(API_ROOT, 'node_modules/.bin/prisma')
  execFileSync(prismaBin, ['db', 'push', '--url', url, '--accept-data-loss'], {
    cwd: API_ROOT,
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'inherit',
    timeout: 120_000,
  })
}

async function main(): Promise<void> {
  const postgres = process.argv.includes('--postgres')
  let temporary: string | null = null
  if (postgres) {
    const url = process.env['DATABASE_URL'] ?? ''
    if (!/^postgres(ql)?:\/\//.test(url)) throw new Error('TERMINAL_BATCH_VERIFY_POSTGRES_REQUIRED')
  } else {
    if (/^postgres(ql)?:\/\//.test(process.env['DATABASE_URL'] ?? '')) {
      throw new Error('TERMINAL_BATCH_VERIFY_SQLITE_REQUIRED')
    }
    temporary = mkdtempSync(join(tmpdir(), 'terminal-batch-activation-'))
    const databasePath = join(temporary, 'verify-terminal-batch-activation.db')
    closeSync(openSync(databasePath, 'wx'))
    const databaseUrl = `file:${databasePath}`
    process.env['DATABASE_URL'] = databaseUrl
    try {
      pushSqlite(databaseUrl)
    } catch (error) {
      rmSync(temporary, { recursive: true, force: true })
      throw error
    }
  }
  process.env['VERIFICATION_DATABASE_TARGET'] = 'isolated'
  assertIsolatedVerificationDatabase()
  if (!postgres && !(process.env['DATABASE_URL'] ?? '').startsWith('file:')) {
    throw new Error('TERMINAL_BATCH_VERIFY_SQLITE_REQUIRED')
  }

  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const audit = new AuditService(prisma)
  const credentials = new TerminalCredentialSecurityService(prisma, audit)
  const batches = new TerminalBatchService(prisma, audit, credentials)
  const { TerminalAdminService } = await import('../src/terminals/terminals-admin.service')
  const { TerminalAgentService } = await import('../src/terminals/terminals-agent.service')
  const { TerminalToolboxService } = await import('../src/terminals/terminal-toolbox.service')
  const agent = new TerminalAgentService(prisma, audit)
  const releases = { toAdminObservation: () => null }
  const adminTerminals = new TerminalAdminService(
    prisma,
    agent,
    new TerminalToolboxService(prisma),
    releases as never,
  )

  const suffix = Math.random().toString(16).slice(2, 8)
  const adminId = `batch-admin-${suffix}`
  const partnerId = `batch-partner-${suffix}`
  const orgId = `batch-org-${suffix}`
  const prefixes: string[] = []
  const batchIds: string[] = []
  const actor = { actorId: adminId, actorRole: 'admin' }

  const store = new Map<string, string>()
  const redis = {
    async get(key: string) { return store.get(key) ?? null },
    async setEx(key: string, _ttl: number, value: string) { store.set(key, value) },
    async getDel(key: string) {
      const value = store.get(key) ?? null
      store.delete(key)
      return value
    },
    async setJsonIfVersionNotOlder() { return 'ok' as const },
  }
  const jwt = new JwtService({ secret: 'verify-terminal-batch-activation-jwt-secret' })

  @Module({
    controllers: [AdminTerminalBatchController],
    providers: [
      { provide: PrismaService, useValue: prisma },
      { provide: RedisService, useValue: redis },
      { provide: JwtService, useValue: jwt },
      { provide: AuditService, useValue: audit },
      { provide: TerminalCredentialSecurityService, useValue: credentials },
      { provide: TerminalBatchService, useValue: batches },
      JwtAuthGuard,
      RolesGuard,
    ],
  })
  class FixtureModule {}
  Module({})(FixtureModule)

  const app = await NestFactory.create(FixtureModule, { logger: false, abortOnError: false })
  try {
    await prisma.organization.create({ data: { id: orgId, name: '批量激活验证机构', type: 'public_service' } })
    await prisma.user.create({ data: { id: adminId, username: `batch-admin-${suffix}`, passwordHash: 'verify-only', name: '批量激活管理员', role: 'admin' } })
    await prisma.user.create({ data: { id: partnerId, username: `batch-partner-${suffix}`, passwordHash: 'verify-only', name: '批量激活机构账号', role: 'partner', orgId } })

    app.setGlobalPrefix('api/v1')
    app.useGlobalPipes(new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: (errors: ValidationError[]) => {
        const details = flatten(errors)
        return new BadRequestException({ error: { code: 'VALIDATION_FAILED', message: details[0] ?? '请求参数校验失败', details } })
      },
    }))
    app.useGlobalFilters(new HttpExceptionFilter())
    await app.listen(0, '127.0.0.1')
    const port = (app.getHttpServer().address() as AddressInfo).port
    const partnerToken = jwt.sign({ sub: partnerId, ver: 0 })

    const okPrefix = `A${suffix}`
    prefixes.push(okPrefix)
    const created = await batches.create({ range: { prefix: okPrefix, start: 1, end: 3, locationLabel: '一楼' } }, actor)
    batchIds.push(created.batchId)
    assert.equal(created.count, 3)
    assert.equal(created.terminals.length, 3)
    assert.equal(new Set(created.terminals.map((row) => row.terminalCode)).size, 3)
    const stored = await prisma.terminal.findMany({
      where: { provisionBatchId: created.batchId },
      select: { terminalCode: true, provisionBatchId: true, lifecycleStatus: true },
    })
    assert.equal(stored.length, 3)
    assert.deepEqual(stored.map((row) => row.provisionBatchId), [created.batchId, created.batchId, created.batchId])
    const createAudit = await prisma.auditLog.findFirst({
      where: { action: 'terminal.batch.create', targetId: created.batchId, actorId: adminId },
    })
    assert.ok(createAudit, '批量预建必须写审计')
    const createPayload = JSON.parse(createAudit.payloadJson) as { count?: number; batchId?: string; terminalCodes?: string[] }
    assert.equal(createPayload.count, 3)
    assert.equal(createPayload.batchId, created.batchId)
    assert.equal(createPayload.terminalCodes?.length, 3)
    assert.equal(JSON.stringify(createPayload).includes('bindCode'), false)
    console.log('PASS 批量建 3 台，同一批次号，审计记下谁、几台、批次号')

    const conflictPrefix = `C${suffix}`
    prefixes.push(conflictPrefix)
    await prisma.terminal.create({
      data: {
        id: `t_exist_${suffix}`,
        terminalCode: `${conflictPrefix}2`,
        agentToken: `planned$exist-${suffix}`,
        deviceFingerprint: `fp-exist-${suffix}`,
        lifecycleStatus: 'planned',
      },
    })
    let conflictMessage = ''
    await expectCode(async () => {
      try {
        await batches.create({
          rows: [
            { terminalCode: `${conflictPrefix}1`, displayName: '第一台' },
            { terminalCode: `${conflictPrefix}2`, displayName: '第二台' },
            { terminalCode: `${conflictPrefix}3`, displayName: '第三台' },
          ],
        }, actor)
      } catch (error) {
        conflictMessage = errorMessage(error)
        throw error
      }
    }, 'TERMINAL_BATCH_ROW_INVALID', '第 2 行冲突')
    assert.match(conflictMessage, /第 2 行/)
    const leftover = await prisma.terminal.findMany({
      where: { terminalCode: { in: [`${conflictPrefix}1`, `${conflictPrefix}3`] } },
      select: { terminalCode: true },
    })
    assert.equal(leftover.length, 0, `第 2 行出错时第 1、3 行不得留下，实际 ${leftover.map((row) => row.terminalCode).join(',')}`)
    const stillThere = await prisma.terminal.findUnique({ where: { terminalCode: `${conflictPrefix}2` }, select: { id: true } })
    assert.equal(stillThere?.id, `t_exist_${suffix}`)
    console.log('PASS 第 2 行出错时整批不建')

    const hugePrefix = `D${suffix}`
    prefixes.push(hugePrefix)
    await expectCode(
      () => batches.create({ range: { prefix: hugePrefix, start: 1, end: 201 } }, actor),
      'TERMINAL_BATCH_TOO_LARGE',
      '超过 200 台',
    )
    const hugeCount = await prisma.terminal.count({ where: { terminalCode: { startsWith: hugePrefix } } })
    assert.equal(hugeCount, 0)
    console.log('PASS 超过 200 台拒绝，一台都不建')

    const issued = await batches.issue({ batchId: created.batchId }, actor)
    assert.equal(issued.issued.length, 3)
    assert.equal(issued.skipped.length, 0)
    const plainCodes = issued.issued.map((row) => row.bindCode)
    for (const row of issued.issued) {
      assert.equal(row.bindCode.length, 20)
      const saved = await prisma.terminalBindCode.findFirst({
        where: { terminalId: row.terminalId, revokedAt: null, usedAt: null },
      })
      assert.ok(saved)
      assert.equal(saved.codeHash, hashBindCode(row.bindCode))
      assert.notEqual(saved.codeHash, row.bindCode)
      for (const value of Object.values(saved)) assert.notEqual(value, row.bindCode)
      const expiresIn = new Date(row.expiresAt).getTime() - Date.now()
      assert.ok(expiresIn > 9 * 60_000 && expiresIn < 11 * 60_000, '有效期与单台默认 10 分钟一致')
    }
    const issueAudits = await prisma.auditLog.findMany({
      where: { actorId: adminId, action: { in: ['terminal.bind_code.batch_create', 'terminal.bind_code.create'] } },
    })
    const auditText = issueAudits.map((row) => row.payloadJson).join('\n')
    for (const plain of plainCodes) {
      assert.equal(auditText.includes(plain), false, '审计里不能出现绑定码明文')
    }
    console.log('PASS 批量生成码只在响应里给明文，库里是哈希，审计没有明文')

    const activeId = `t_active_${suffix}`
    const disabledId = `t_disabled_${suffix}`
    const plannedId = `t_planned_${suffix}`
    const activeCode = `S${suffix}A`
    const disabledCode = `S${suffix}D`
    const plannedCode = `S${suffix}P`
    prefixes.push(`S${suffix}`)
    await prisma.terminal.create({ data: { id: activeId, terminalCode: activeCode, agentToken: `tok-a-${suffix}`, deviceFingerprint: `fp-a-${suffix}`, lifecycleStatus: 'active' } })
    await prisma.terminal.create({ data: { id: disabledId, terminalCode: disabledCode, agentToken: `${PLANNED_CREDENTIAL_PREFIX}d-${suffix}`, deviceFingerprint: `fp-d-${suffix}`, lifecycleStatus: 'planned', enabled: false } })
    await prisma.terminal.create({ data: { id: plannedId, terminalCode: plannedCode, agentToken: `${PLANNED_CREDENTIAL_PREFIX}p-${suffix}`, deviceFingerprint: `fp-p-${suffix}`, lifecycleStatus: 'planned' } })
    let skippedIssue: Awaited<ReturnType<TerminalBatchService['issue']>>
    try {
      skippedIssue = await batches.issue({ terminalIds: [activeId, disabledId, plannedId] }, actor)
    } catch (error) {
      throw new Error(`已激活或停用的终端必须跳过，实际抛出 ${errorCode(error) ?? errorMessage(error)}`)
    }
    assert.equal(skippedIssue.skipped.find((row) => row.terminalId === activeId)?.reason, '已激活')
    assert.equal(skippedIssue.skipped.find((row) => row.terminalId === disabledId)?.reason, '已停用')
    assert.equal(skippedIssue.issued.length, 1)
    assert.equal(skippedIssue.issued[0]?.terminalId, plannedId)
    assert.equal(skippedIssue.issued.some((row) => row.terminalId === activeId), false)
    console.log('PASS 已激活和已停用被跳过，未激活的仍发码')

    const revokeId = `t_revoke_${suffix}`
    const revokeCode = `V${suffix}1`
    prefixes.push(`V${suffix}`)
    await prisma.terminal.create({ data: { id: revokeId, terminalCode: revokeCode, agentToken: `${PLANNED_CREDENTIAL_PREFIX}v-${suffix}`, deviceFingerprint: `fp-v-${suffix}`, lifecycleStatus: 'planned' } })
    const revokeIssued = await batches.issue({ terminalIds: [revokeId] }, actor)
    const revokedPlain = revokeIssued.issued[0]?.bindCode
    assert.ok(revokedPlain)
    const revoked = await batches.revoke({ terminalIds: [revokeId] }, actor)
    assert.equal(revoked.revokedCount, 1)
    await expectCode(
      () => credentials.exchangeBindCode({ bindCode: revokedPlain, deviceFingerprint: `fp-exchange-v-${suffix}` }),
      'BIND_CODE_REVOKED',
      '作废后旧码兑换',
    )
    console.log('PASS 作废后旧码兑换失败')

    const reissueId = `t_reissue_${suffix}`
    const reissueCode = `R${suffix}1`
    prefixes.push(`R${suffix}`)
    await prisma.terminal.create({ data: { id: reissueId, terminalCode: reissueCode, agentToken: `${PLANNED_CREDENTIAL_PREFIX}r-${suffix}`, deviceFingerprint: `fp-r-${suffix}`, lifecycleStatus: 'planned' } })
    const firstCode = (await batches.issue({ terminalIds: [reissueId] }, actor)).issued[0]?.bindCode
    assert.ok(firstCode)
    const second = await batches.reissue({ terminalIds: [reissueId] }, actor)
    const secondCode = second.issued[0]?.bindCode
    assert.ok(secondCode)
    assert.notEqual(secondCode, firstCode)
    await expectCode(
      () => credentials.exchangeBindCode({ bindCode: firstCode, deviceFingerprint: `fp-exchange-old-${suffix}` }),
      'BIND_CODE_REVOKED',
      '重发后旧码兑换',
    )
    const exchanged = await credentials.exchangeBindCode({ bindCode: secondCode, deviceFingerprint: `fp-exchange-new-${suffix}` })
    assert.equal(exchanged.terminalCode, reissueCode)
    const reissueAudits = await prisma.auditLog.findMany({
      where: { actorId: adminId, action: 'terminal.bind_code.batch_reissue' },
    })
    for (const plain of [firstCode, secondCode]) {
      assert.equal(reissueAudits.some((row) => row.payloadJson.includes(plain)), false)
    }
    console.log('PASS 重发后新码能兑换，旧码不能，审计没有明文')

    const freshCode = `N${suffix}0`
    const freshId = `t_fresh_${suffix}`
    prefixes.push(`N${suffix}`)
    await prisma.terminal.create({
      data: {
        id: freshId,
        terminalCode: freshCode,
        agentToken: `${PLANNED_CREDENTIAL_PREFIX}n-${suffix}`,
        deviceFingerprint: `fp-n-${suffix}`,
        lifecycleStatus: 'planned',
        provisionBatchId: created.batchId,
      },
    })
    const expiredTarget = created.terminals[1]
    assert.ok(created.terminals[0] && expiredTarget)
    await prisma.terminalBindCode.updateMany({
      where: { terminalId: expiredTarget.terminalId, usedAt: null, revokedAt: null },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    })
    const heartbeatAt = new Date()
    await prisma.terminalHeartbeat.create({
      data: { terminalId: created.terminals[0].terminalId, agentVersion: '1.2.3-verify' },
    })
    const listed = await adminTerminals.listTerminalsForAdmin()
    const withActivation = await batches.attachActivation(listed.terminals)
    const byCode = new Map(withActivation.map((row) => [row.terminalCode, row]))
    const unusedRow = byCode.get(created.terminals[0].terminalCode)
    const expiredRow = byCode.get(expiredTarget.terminalCode)
    const emptyRow = byCode.get(freshCode)
    const activatedRow = byCode.get(reissueCode)
    assert.equal(unusedRow?.provisionBatchId, created.batchId)
    assert.equal(unusedRow?.activationStatus, 'code_unused')
    assert.equal(unusedRow?.activationStatusLabel, '码未用')
    assert.equal(unusedRow?.agentVersion, '1.2.3-verify')
    assert.equal(typeof unusedRow?.lastHeartbeatAt, 'string')
    assert.ok(unusedRow?.lastHeartbeatAt && Math.abs(new Date(unusedRow.lastHeartbeatAt).getTime() - heartbeatAt.getTime()) < 60_000)
    assert.equal(expiredRow?.activationStatus, 'code_expired')
    assert.equal(expiredRow?.activationStatusLabel, '码已过期')
    assert.equal(expiredRow?.firstActivatedAt, null)
    assert.equal(emptyRow?.activationStatus, 'no_code')
    assert.equal(emptyRow?.activationStatusLabel, '未生成码')
    assert.equal(emptyRow?.lastHeartbeatAt, null)
    assert.equal(emptyRow?.agentVersion, null)
    assert.equal(activatedRow?.activationStatus, 'activated')
    assert.equal(activatedRow?.activationStatusLabel, '已激活')
    assert.equal(typeof activatedRow?.firstActivatedAt, 'string')
    const listText = JSON.stringify(withActivation)
    for (const plain of [...plainCodes, firstCode, secondCode, revokedPlain, skippedIssue.issued[0]?.bindCode ?? '']) {
      if (plain) assert.equal(listText.includes(plain), false, '列表不能带回绑定码明文')
    }
    console.log('PASS 列表带批次号、激活状态、首次激活、最后心跳和程序版本；没有心跳则为空')

    const forbiddenPrefix = `F${suffix}`
    prefixes.push(forbiddenPrefix)
    const response = await fetch(`http://127.0.0.1:${port}/api/v1/admin/terminals/batches`, {
      method: 'POST',
      headers: { authorization: `Bearer ${partnerToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ range: { prefix: forbiddenPrefix, start: 1, end: 1 } }),
    })
    const forbidden = await response.json() as { error?: { code?: string } }
    assert.equal(response.status, 403, `非管理员应 403，实际 ${response.status} ${JSON.stringify(forbidden)}`)
    assert.equal(forbidden.error?.code, 'AUTH_ROLE_FORBIDDEN')
    const forbiddenCount = await prisma.terminal.count({ where: { terminalCode: { startsWith: forbiddenPrefix } } })
    assert.equal(forbiddenCount, 0)
    console.log('PASS 非管理员 403')

    console.log(postgres ? 'verify:terminal-batch-activation:postgres PASS' : 'verify:terminal-batch-activation PASS')
  } finally {
    await app.close().catch(() => undefined)
    const or = prefixes.map((prefix) => ({ terminalCode: { startsWith: prefix } }))
    if (or.length > 0) {
      const rows = await prisma.terminal.findMany({ where: { OR: or }, select: { id: true, terminalCode: true } })
      const ids = rows.map((row) => row.id)
      const codes = rows.map((row) => row.terminalCode)
      if (ids.length > 0) {
        await prisma.terminalHeartbeat.deleteMany({ where: { terminalId: { in: ids } } })
        await prisma.terminal.deleteMany({ where: { id: { in: ids } } })
      }
      await prisma.auditLog.deleteMany({
        where: {
          OR: [
            { actorId: adminId },
            { actorId: partnerId },
            ...(codes.length > 0 ? [{ targetId: { in: codes } }] : []),
            ...(batchIds.length > 0 ? [{ targetId: { in: batchIds } }] : []),
          ],
        },
      })
    }
    await prisma.user.deleteMany({ where: { id: { in: [adminId, partnerId] } } }).catch(() => undefined)
    await prisma.organization.deleteMany({ where: { id: orgId } }).catch(() => undefined)
    await prisma.onModuleDestroy().catch(() => undefined)
    if (temporary) rmSync(temporary, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
