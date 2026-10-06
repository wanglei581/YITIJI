/**
 * 远程重启终端程序：真实 Nest HTTP + 真实守卫。
 * 覆盖接口定稿第 7 节。终端名与网点名用真实网点口径。
 */
import { createServer, type AddressInfo } from 'node:http'
import { inspect } from 'node:util'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { BadRequestException, ValidationPipe } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { NestFactory } from '@nestjs/core'
import type { INestApplication } from '@nestjs/common'
import { AppModule } from '../src/app.module'
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter'
import { PrismaService } from '../src/prisma/prisma.service'
import { TerminalCommandService } from '../src/terminals/terminal-commands.service'
import { TerminalsModule } from '../src/terminals/terminals.module'

let failed = 0
function assert(cond: boolean, message: string): void {
  if (cond) console.log(`  PASS ${message}`)
  else {
    failed += 1
    console.error(`  FAIL ${message}`)
  }
}

type Json = Record<string, any>
type HttpResult = { status: number; body: Json; text: string }

async function main(): Promise<void> {
  const secret = process.env['JWT_SECRET']
  if (!secret || secret.length < 16) throw new Error('JWT_SECRET 未配置')
  const suffix = randomUUID().replace(/-/g, '').slice(0, 8)
  const orgId = `org_tcmd_${suffix}`
  const adminId = `u_tcmd_admin_${suffix}`
  const partnerId = `u_tcmd_partner_${suffix}`
  const endUserId = `eu_tcmd_${suffix}`
  const memberNickname = '林书衡'
  const memberPhone = '13966081234'
  const orderId = `ord_tcmd_${suffix}`
  const fileId = `file_tcmd_${suffix}`
  const leaked = [memberNickname, memberPhone, orderId, fileId, endUserId]

  const app = await NestFactory.create<INestApplication>(AppModule, { logger: ['error'] })
  app.setGlobalPrefix('api/v1')
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: () => new BadRequestException({ error: { code: 'VALIDATION_FAILED', message: '请求参数校验失败' } }),
  }))
  app.useGlobalFilters(new HttpExceptionFilter())
  await app.listen(0, '127.0.0.1')
  const address = app.getHttpServer().address() as AddressInfo
  const base = `http://127.0.0.1:${address.port}/api/v1`
  const prisma = app.get(PrismaService)
  const commands = app.select(TerminalsModule).get(TerminalCommandService)
  // CI 的 SQLite 基线是 db push。条件唯一索引表达不了进 schema，只在迁移里。
  // 不补上的话，并发两次下发会各自插成功，门禁会假绿。
  await prisma.$transaction(async (tx) => {
    await (tx as unknown as { $executeRawUnsafe(sql: string): Promise<number> }).$executeRawUnsafe(
      `CREATE UNIQUE INDEX IF NOT EXISTS "TerminalCommand_terminalId_open_unique" ON "TerminalCommand"("terminalId") WHERE "status" IN ('pending', 'accepted')`,
    )
  })
  const jwt = new JwtService({ secret })
  const adminToken = jwt.sign({ sub: adminId, role: 'admin', orgId: null, ver: 0, jti: randomUUID() })
  const partnerToken = jwt.sign({ sub: partnerId, role: 'partner', orgId, ver: 0, jti: randomUUID() })
  const captured: string[] = []

  async function send(method: string, path: string, token: string | undefined, body?: unknown): Promise<HttpResult> {
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (token) headers.Authorization = token.startsWith('Bearer ') ? token : `Bearer ${token}`
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    const response = await fetch(`${base}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await response.text()
    captured.push(text)
    let parsed: Json = {}
    try { parsed = text ? JSON.parse(text) as Json : {} } catch { parsed = { raw: text } }
    return { status: response.status, body: parsed, text }
  }

  const terminalIds: string[] = []
  const terminalCodes: string[] = []
  function terminal(input: {
    key: string
    code: string
    name: string
    token: string
    lifecycleStatus?: string
    enabled?: boolean
  }) {
    const id = `t_tcmd_${input.key}_${suffix}`
    terminalIds.push(id)
    terminalCodes.push(input.code)
    return prisma.terminal.create({
      data: {
        id,
        terminalCode: input.code,
        agentToken: input.token,
        deviceFingerprint: `fp-${input.key}-${suffix}`,
        displayName: input.name,
        locationLabel: '青岛',
        lifecycleStatus: input.lifecycleStatus ?? 'active',
        enabled: input.enabled ?? true,
        orgId,
      },
    })
  }

  const hits: string[] = []
  const webhook = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      hits.push(Buffer.concat(chunks).toString('utf8'))
      res.writeHead(200).end('ok')
    })
  })

  try {
    await new Promise<void>((resolve) => webhook.listen(0, '127.0.0.1', () => resolve()))
    await prisma.organization.create({
      data: { id: orgId, name: '青岛市南区公共就业服务中心', type: 'partner', enabled: true },
    })
    await prisma.user.create({
      data: { id: adminId, username: `zhou-${suffix}`, passwordHash: 'verify-only', name: '周启明', role: 'admin' },
    })
    await prisma.user.create({
      data: {
        id: partnerId,
        username: `chen-${suffix}`,
        passwordHash: 'verify-only',
        name: '陈晓宁',
        role: 'partner',
        orgId,
      },
    })
    await prisma.endUser.create({
      data: { id: endUserId, phoneHash: `ph_${suffix}`, phoneEnc: memberPhone, nickname: memberNickname },
    })
    const south = await terminal({
      key: 'south',
      code: `QD-SN-${suffix}`,
      name: '市南区就业服务中心 1 号机',
      token: `tok-south-${suffix}`,
    })
    const north = await terminal({
      key: 'north',
      code: `QD-SB-${suffix}`,
      name: '市北区就业服务中心 2 号机',
      token: `tok-north-${suffix}`,
    })
    const licang = await terminal({
      key: 'licang',
      code: `QD-LC-${suffix}`,
      name: '李沧区就业服务中心 3 号机',
      token: `tok-licang-${suffix}`,
    })
    const laoshan = await terminal({
      key: 'laoshan',
      code: `QD-LS-${suffix}`,
      name: '崂山区就业服务中心 4 号机',
      token: `tok-laoshan-${suffix}`,
    })
    const blocked = [
      ['planned', '黄岛区就业服务中心 5 号机', 'planned', true, `planned$${suffix}huangdao`],
      ['suspended', '即墨区就业服务中心 7 号机', 'suspended', true, `tok-suspended-${suffix}`],
      ['commissioning', '胶州市就业服务中心 8 号机', 'commissioning', true, `tok-commissioning-${suffix}`],
      ['maintenance', '平度市就业服务中心 9 号机', 'maintenance', true, `tok-maintenance-${suffix}`],
      ['disabled', '莱西市就业服务中心 10 号机', 'active', false, `tok-disabled-${suffix}`],
    ] as const
    for (const [key, name, lifecycleStatus, enabled, token] of blocked) {
      await terminal({ key, code: `QD-${key}-${suffix}`, name, token, lifecycleStatus, enabled })
    }
    const retired = await terminal({
      key: 'retired',
      code: `QD-retired-${suffix}`,
      name: '城阳区就业服务中心 6 号机',
      token: `tok-retired-${suffix}`,
    })
    await prisma.terminal.update({
      where: { id: retired.id },
      data: {
        lifecycleStatus: 'retired',
        enabled: false,
        agentToken: `cred$retired$${suffix}x`,
        credentialGeneration: { increment: 1 },
        lifecycleVersion: { increment: 1 },
      },
    })

    const issuePath = (id: string) => `/admin/terminals/${id}/commands`
    const partnerTry = await send('POST', issuePath(south.id), partnerToken, { type: 'restart_agent' })
    assert(partnerTry.status === 403 && partnerTry.body.error?.code === 'AUTH_ROLE_FORBIDDEN', '合作机构下发被拒绝')
    const agentTry = await send('POST', issuePath(south.id), south.agentToken, { type: 'restart_agent' })
    assert(agentTry.status === 401 && agentTry.body.error?.code === 'AUTH_TOKEN_INVALID', '终端令牌不能下发')
    assert(await prisma.terminalCommand.count({ where: { terminalId: south.id } }) === 0, '被拒绝的下发没有落库')

    const missing = await send('POST', issuePath(`missing_${suffix}`), adminToken, { type: 'restart_agent' })
    assert(missing.status === 404 && missing.body.error?.code === 'TERMINAL_NOT_FOUND', '终端不存在')
    for (const row of [...blocked.map(([key]) => `t_tcmd_${key}_${suffix}`), retired.id]) {
      const found = await prisma.terminal.findFirstOrThrow({ where: { id: row } })
      const denied = await send('POST', issuePath(found.id), adminToken, { type: 'restart_agent' })
      assert(denied.status === 409 && denied.body.error?.code === 'TERMINAL_NOT_OPERATIONAL', `${found.displayName} 不在运营中`)
    }
    const badType = await send('POST', issuePath(south.id), adminToken, { type: 'reboot_os' })
    assert(badType.status === 400 && badType.body.error?.code === 'TERMINAL_COMMAND_TYPE_INVALID', '其它类型被拒绝')
    const badNumber = await send('POST', issuePath(south.id), adminToken, { type: 1 })
    assert(badNumber.status === 400 && badNumber.body.error?.code === 'TERMINAL_COMMAND_TYPE_INVALID', '非字符串类型被拒绝')
    const missingType = await send('POST', issuePath(south.id), adminToken, {})
    assert(missingType.status === 400 && missingType.body.error?.code === 'TERMINAL_COMMAND_TYPE_INVALID', '缺类型被拒绝')
    const extra = await send('POST', issuePath(south.id), adminToken, { type: 'restart_agent', reason: '试试' })
    assert(extra.status === 400 && extra.body.error?.code === 'VALIDATION_FAILED', '多余字段被拒绝')

    const [first, second] = await Promise.all([
      send('POST', issuePath(south.id), adminToken, { type: 'restart_agent' }),
      send('POST', issuePath(south.id), adminToken, { type: 'restart_agent' }),
    ])
    const ok = [first, second].find((item) => item.status === 200)
    const pending = [first, second].find((item) => item.status === 409)
    assert(Boolean(ok && pending), '并发两次下发只有一条成功')
    assert(pending?.body.error?.code === 'TERMINAL_COMMAND_PENDING', '未结束冲突返回 TERMINAL_COMMAND_PENDING')
    assert(pending?.body.error?.commandId === ok?.body.data?.id, '冲突带上已存在命令的 id')
    assert(await prisma.terminalCommand.count({ where: { terminalId: south.id, status: { in: ['pending', 'accepted'] } } }) === 1, '库里只有一条未结束命令')
    const openId = ok?.body.data?.id as string
    assert(ok?.body.data?.type === 'restart_agent' && ok?.body.data?.status === 'pending', '下发返回待执行命令')
    assert(ok?.body.data?.requestedBy?.id === adminId && ok?.body.data?.requestedBy?.name === '周启明', '下发人是管理员姓名')
    assert(ok?.body.data?.acceptedAt === null && ok?.body.data?.finishedAt === null, '新命令还没有接受或结束时间')
    assert(ok?.body.data?.completedVerified === null && ok?.body.data?.resultCode === null, '新命令还没有核实结果')

    const beat = async (row: { id: string; agentToken: string }, body?: unknown) =>
      send('PUT', `/terminals/${row.id}/heartbeat`, row.agentToken, body ?? {})
    const seen = await beat(south)
    assert(seen.status === 200 && seen.body.acknowledged === true && typeof seen.body.config?.claimIntervalMs === 'number', '心跳原有字段还在')
    assert(seen.body.commands?.length === 1 && seen.body.commands[0].id === openId, '心跳带上本终端未结束命令')
    assert(seen.body.commands[0].type === 'restart_agent', '心跳命令类型是 restart_agent')
    assert(seen.body.commands[0].issuedAt === ok?.body.data?.requestedAt && seen.body.commands[0].expiresAt === ok?.body.data?.expiresAt, '心跳带上下发与到期时间')
    const seenAgain = await beat(south)
    assert(seenAgain.body.commands?.[0]?.id === openId, '回执前每次心跳都再给同一条')
    const northBeat = await beat(north)
    const northIds = (northBeat.body.commands ?? []).map((item: { id: string }) => item.id)
    assert(!northIds.includes(openId), '心跳不给别的终端的命令')
    assert(!Object.prototype.hasOwnProperty.call(northBeat.body, 'commands'), '没有命令时不带 commands 字段')

    // 命令表出错时心跳本身必须照常成功：心跳失败会让终端被判离线，远程重启这层不许拖垮它。
    const patched = commands as unknown as { pendingForAgent: (...args: unknown[]) => Promise<unknown> }
    const originalPending = patched.pendingForAgent
    patched.pendingForAgent = async () => {
      throw Object.assign(new Error('postgres://drill:secret@db/terminal'), { code: 'P1001' })
    }
    try {
      const brokenBeat = await beat(south)
      assert(brokenBeat.status === 200 && brokenBeat.body.acknowledged === true, '命令表出错时心跳照常成功')
      assert(!Object.prototype.hasOwnProperty.call(brokenBeat.body, 'commands'), '命令表出错时这一轮不带 commands')
    } finally {
      patched.pendingForAgent = originalPending
    }

    const northIssued = await send('POST', issuePath(north.id), adminToken, { type: 'restart_agent' })
    assert(northIssued.status === 200, '另一台终端可以单独下发')
    const cross = await send('POST', `/terminals/${south.id}/commands/${northIssued.body.data.id}/ack`, south.agentToken, { result: 'accepted' })
    assert(cross.status === 404 && cross.body.error?.code === 'TERMINAL_COMMAND_NOT_FOUND', '不能回执别的终端的命令')
    const wrongToken = await send('POST', `/terminals/${north.id}/commands/${northIssued.body.data.id}/ack`, south.agentToken, { result: 'accepted' })
    assert(wrongToken.status === 401, '别的终端令牌不能回执')

    const accepted = await send('POST', `/terminals/${south.id}/commands/${openId}/ack`, south.agentToken, { result: 'accepted' })
    assert(accepted.status === 200 && accepted.body.data?.result === 'accepted', '接受回执')
    const busyAfter = await send('POST', `/terminals/${south.id}/commands/${openId}/ack`, south.agentToken, { result: 'rejected_busy' })
    assert(busyAfter.body.data?.result === 'accepted', '接受之后不能退回终端忙')
    const again = await send('POST', `/terminals/${south.id}/commands/${openId}/ack`, south.agentToken, { result: 'accepted' })
    assert(again.body.data?.result === 'accepted', '重复回执幂等')
    const acceptedRow = await prisma.terminalCommand.findUniqueOrThrow({ where: { id: openId } })
    assert(acceptedRow.status === 'accepted' && acceptedRow.acceptedAt instanceof Date, '状态停在已接受')
    await prisma.terminalCommand.update({ where: { id: openId }, data: { expiresAt: new Date(Date.now() - 1000) } })
    const expiredAck = await send('POST', `/terminals/${south.id}/commands/${openId}/ack`, south.agentToken, { result: 'rejected_busy' })
    assert(expiredAck.body.data?.result === 'accepted', '已经接受的命令过了有效期也不改成过期')
    const startedAt = new Date(acceptedRow.acceptedAt!.getTime() + 5000).toISOString()
    const verifiedBeat = await beat(south, { agentStartedAt: startedAt })
    assert(!Object.prototype.hasOwnProperty.call(verifiedBeat.body, 'commands'), '完成后心跳不再带这条命令')
    const verified = await prisma.terminalCommand.findUniqueOrThrow({ where: { id: openId } })
    assert(verified.status === 'completed' && verified.completedVerified === true, '启动时刻晚于接受时刻才算已核实')

    const unverifiedIssue = await send('POST', issuePath(south.id), adminToken, { type: 'restart_agent' })
    assert(unverifiedIssue.status === 200, '第二台命令可以下发')
    const unverifiedId = unverifiedIssue.body.data.id as string
    await send('POST', `/terminals/${south.id}/commands/${unverifiedId}/ack`, south.agentToken, { result: 'accepted' })
    await beat(south, {})
    const unverified = await prisma.terminalCommand.findUniqueOrThrow({ where: { id: unverifiedId } })
    assert(unverified.status === 'completed' && unverified.completedVerified === false, '没带启动时刻只记未核实完成')

    const equalIssue = await send('POST', issuePath(south.id), adminToken, { type: 'restart_agent' })
    const equalId = equalIssue.body.data.id as string
    await send('POST', `/terminals/${south.id}/commands/${equalId}/ack`, south.agentToken, { result: 'accepted' })
    const equalRow = await prisma.terminalCommand.findUniqueOrThrow({ where: { id: equalId } })
    const notLater = await beat(south, { agentStartedAt: equalRow.acceptedAt!.toISOString() })
    assert(notLater.status === 200, '启动时刻不晚于接受时刻时心跳仍然成功')
    const notLaterRow = await prisma.terminalCommand.findUniqueOrThrow({ where: { id: equalId } })
    assert(notLaterRow.status === 'accepted' && notLaterRow.completedVerified === null, '启动时刻不晚于接受时刻不算完成')
    const earlier = new Date(equalRow.acceptedAt!.getTime() - 1000).toISOString()
    await beat(south, { agentStartedAt: earlier })
    const earlierRow = await prisma.terminalCommand.findUniqueOrThrow({ where: { id: equalId } })
    assert(earlierRow.status === 'accepted', '更早的启动时刻也不算完成')

    await prisma.terminalCommand.update({
      where: { id: northIssued.body.data.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    })
    await commands.sweep(new Date())
    const swept = await prisma.terminalCommand.findUniqueOrThrow({ where: { id: northIssued.body.data.id } })
    assert(swept.status === 'expired' && swept.resultCode === 'expired', '过期清扫把待执行改成已过期')
    const northAfter = await beat(north)
    assert(!Object.prototype.hasOwnProperty.call(northAfter.body, 'commands'), '过期命令不再出现在心跳里')

    const serverExpired = await send('POST', issuePath(north.id), adminToken, { type: 'restart_agent' })
    await prisma.terminalCommand.update({
      where: { id: serverExpired.body.data.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    })
    const forced = await send('POST', `/terminals/${north.id}/commands/${serverExpired.body.data.id}/ack`, north.agentToken, { result: 'accepted' })
    assert(forced.body.data?.result === 'expired', '过期命令无论回什么都返回 expired')
    const forcedRow = await prisma.terminalCommand.findUniqueOrThrow({ where: { id: serverExpired.body.data.id } })
    assert(forcedRow.status === 'expired', '过期回执落成已过期')

    const localExpired = await send('POST', issuePath(north.id), adminToken, { type: 'restart_agent' })
    const localAck = await send('POST', `/terminals/${north.id}/commands/${localExpired.body.data.id}/ack`, north.agentToken, { result: 'expired' })
    assert(localAck.body.data?.result === 'expired', '终端自己判断过期')
    const localAgain = await send('POST', `/terminals/${north.id}/commands/${localExpired.body.data.id}/ack`, north.agentToken, { result: 'accepted' })
    assert(localAgain.body.data?.result === 'expired', '已结束的过期回执幂等')
    const finishedBefore = await prisma.auditLog.count({
      where: { action: 'terminal.command.finished', payloadJson: { contains: localExpired.body.data.id } },
    })
    await send('POST', `/terminals/${north.id}/commands/${localExpired.body.data.id}/ack`, north.agentToken, { result: 'expired' })
    const finishedAfter = await prisma.auditLog.count({
      where: { action: 'terminal.command.finished', payloadJson: { contains: localExpired.body.data.id } },
    })
    assert(finishedBefore === 1 && finishedAfter === 1, '重复回执不再写第二条结束审计')

    for (let index = 0; index < 3; index += 1) {
      const issued = await send('POST', issuePath(licang.id), adminToken, { type: 'restart_agent' })
      assert(issued.status === 200, `一小时内第 ${index + 1} 次可以下发`)
      const rejected = await send('POST', `/terminals/${licang.id}/commands/${issued.body.data.id}/ack`, licang.agentToken, { result: 'rejected_busy' })
      assert(rejected.body.data?.result === 'rejected_busy', `第 ${index + 1} 次因终端忙结束`)
    }
    const fourth = await send('POST', issuePath(licang.id), adminToken, { type: 'restart_agent' })
    assert(fourth.status === 429 && fourth.body.error?.code === 'TERMINAL_COMMAND_RATE_LIMITED', '一小时内第 4 次被限频')

    const stalled = await send('POST', issuePath(laoshan.id), adminToken, { type: 'restart_agent' })
    await send('POST', `/terminals/${laoshan.id}/commands/${stalled.body.data.id}/ack`, laoshan.agentToken, { result: 'accepted' })
    // 用脚本自己的时刻，不把 acceptedAt 改到真实的 15 分钟前，避免每分钟清扫抢先判失败。
    const acceptedAt = new Date()
    const sweepAt = new Date(acceptedAt.getTime() + 15 * 60 * 1000)
    await prisma.terminalCommand.update({ where: { id: stalled.body.data.id }, data: { acceptedAt } })
    await commands.sweep(sweepAt)
    const stillAccepted = await prisma.terminalCommand.findUniqueOrThrow({ where: { id: stalled.body.data.id } })
    assert(stillAccepted.status === 'accepted', '刚满 15 分钟还不算失败')
    await prisma.terminalCommand.update({
      where: { id: stalled.body.data.id },
      data: { acceptedAt: new Date(acceptedAt.getTime() - 1000) },
    })
    const hookPort = (webhook.address() as AddressInfo).port
    process.env['ALERT_WEBHOOK_URL'] = `http://127.0.0.1:${hookPort}/hook`
    await commands.sweep(sweepAt)
    const failedRow = await prisma.terminalCommand.findUniqueOrThrow({ where: { id: stalled.body.data.id } })
    assert(failedRow.status === 'failed' && failedRow.resultCode === 'no_heartbeat_after_restart', '超过 15 分钟没有完成则失败')
    assert(hits.some((hit) => hit.includes('远程重启后没有恢复心跳') && hit.includes('崂山区就业服务中心 4 号机')), '失败时推送没有恢复心跳')

    const listed = await send('GET', `${issuePath(south.id)}?limit=20`, adminToken)
    assert(listed.status === 200 && Array.isArray(listed.body.data) && listed.body.data.length >= 2, '可以查看最近命令')
    assert(listed.body.data[0].requestedAt >= listed.body.data[1].requestedAt, '命令按时间倒序')
    const sample = listed.body.data[0]
    for (const key of ['id', 'type', 'status', 'requestedBy', 'requestedAt', 'expiresAt', 'acceptedAt', 'finishedAt', 'completedVerified', 'resultCode']) {
      assert(Object.prototype.hasOwnProperty.call(sample, key), `视图含 ${key}`)
    }
    assert(sample.requestedBy?.name === '周启明', '视图里的下发人姓名正确')

    const audits = await prisma.auditLog.findMany({ where: { targetId: { in: terminalCodes } } })
    const actions = new Set(audits.map((row) => row.action))
    assert(actions.has('terminal.command.requested'), '有下发审计')
    assert(actions.has('terminal.command.acked'), '有回执审计')
    assert(actions.has('terminal.command.finished'), '有结束审计')
    const allowedKeys = new Set(['terminalCode', 'type', 'commandId', 'result', 'resultCode'])
    for (const row of audits) {
      const payload = JSON.parse(row.payloadJson) as Record<string, unknown>
      assert(Object.keys(payload).every((key) => allowedKeys.has(key)), `审计只含约定字段 ${row.action}`)
      assert(!JSON.stringify(payload).includes(memberNickname), '审计不含会员昵称')
    }
    const blob = `${captured.join('\n')}\n${audits.map((row) => row.payloadJson).join('\n')}`
    for (const secretText of leaked) assert(!blob.includes(secretText), `响应和审计不含 ${secretText}`)
    assert(!blob.includes('工作人员'), '响应不含工作人员')

    const labels = readFileSync(resolve(__dirname, '../../../apps/admin/src/lib/auditActionLabels.ts'), 'utf8')
    assert(labels.includes("'terminal.command.requested': '下发远程重启终端程序'"), '下发审计有中文名')
    assert(labels.includes("'terminal.command.acked': '终端回执远程重启'"), '回执审计有中文名')
    assert(labels.includes("'terminal.command.finished': '远程重启结束'"), '结束审计有中文名')
  } finally {
    await prisma.terminalCommand.deleteMany({ where: { terminalId: { in: terminalIds } } }).catch(() => undefined)
    await prisma.auditLog.deleteMany({
      where: { OR: [{ targetId: { in: terminalCodes } }, { actorId: { in: [adminId, partnerId] } }] },
    }).catch(() => undefined)
    await prisma.terminal.deleteMany({ where: { id: { in: terminalIds } } }).catch(() => undefined)
    await prisma.user.deleteMany({ where: { id: { in: [adminId, partnerId] } } }).catch(() => undefined)
    await prisma.endUser.deleteMany({ where: { id: endUserId } }).catch(() => undefined)
    await prisma.organization.deleteMany({ where: { id: orgId } }).catch(() => undefined)
    webhook.close()
    await app.close()
  }

  if (failed > 0) {
    console.error(`FAIL verify:terminal-remote-command ${failed}`)
    process.exit(1)
  }
  console.log('OK verify:terminal-remote-command')
}

main().catch((error) => {
  console.error(inspect(error, { depth: 6 }))
  process.exit(1)
})
