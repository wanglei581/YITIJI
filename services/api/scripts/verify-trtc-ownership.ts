/**
 * TRTC 会话归属（Redis）— 后端 E2E 验证脚本
 *
 * 背景：专家审查阶段 A 把 TRTC 会话归属从进程内 Map 改为 Redis（trtc:owner:{taskId}），
 * 修复"API 重启后归属清空 → 任意请求方可跨会话终止他人会话 → 触发腾讯云异常计费"。
 * 本脚本在真实 Redis 下端到端验证归属逻辑，**stub 掉 TrtcService 不调用腾讯云**（不计费）。
 *
 * 前置：services/api/.env 含 REDIS_URL；Redis 已启动（redis-cli ping → PONG）。
 * 运行（services/api/ 目录）：pnpm verify:trtc-ownership
 *
 * 验证项：
 *   1. startSession → Redis 写入 trtc:owner:{taskId} = clientKey(发起方 IP|UA)
 *   2. 该 key 存在 TTL（≈1800s，与 TRTC MaxIdleTime 对齐），不是永久 key
 *   3. stopSession 同 clientKey → 放行 + 删除 key
 *   4. stopSession 不同 clientKey → 401/403 拒绝（TASK_NOT_OWNED），key 仍在
 *   5. （持久化语义）owner key 在"模拟重启"后仍可读到，归属校验依然生效
 */
import 'dotenv/config'
import { ForbiddenException } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import type { Request } from 'express'
import { AppModule } from '../src/app.module'
import { TrtcController } from '../src/trtc/trtc.controller'
import { RedisService } from '../src/common/redis/redis.service'
import { REDIS_CLIENT } from '../src/common/redis/redis.service'
import type { Redis } from 'ioredis'

function pass(msg: string) { console.log(`  ✅ ${msg}`) }
function fail(msg: string) { console.error(`  ❌ ${msg}`); process.exitCode = 1 }
function info(msg: string) { console.log(`  ℹ  ${msg}`) }

const OWNER_KEY = (taskId: string) => `trtc:owner:${taskId}`

// 构造携带 IP + UA 的最小 Request，供 makeClientKey 派生 clientKey。
function mockReq(ip: string, ua: string): Request {
  return { headers: { 'user-agent': ua }, ip } as unknown as Request
}

async function main() {
  console.log('\n=== TRTC 会话归属（Redis）— 后端 E2E 验证 ===')
  console.log(`Redis: ${process.env['REDIS_URL'] ?? '(未设置)'}\n`)
  if (!process.env['REDIS_URL']) { fail('REDIS_URL 未设置'); process.exit(1) }

  info('Bootstrapping NestJS DI container (无 HTTP 监听)...')
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn'] })
  await app.init()

  const redis = app.get(RedisService)
  const rawRedis = app.get<Redis>(REDIS_CLIENT)

  // 唯一 taskId，避免与历史 Redis 冲突
  const tail = Date.now().toString().slice(-9)
  const TASK_ID = `e2e_trtc_${tail}`
  const TERMINAL = 'e2e-terminal-01'

  // 两个不同的客户端（IP|UA 不同 → clientKey 不同）
  const reqA = mockReq('10.0.0.1', 'kiosk-agent-A')   // clientKey = "10.0.0.1|kiosk-agent-A"
  const reqB = mockReq('10.0.0.2', 'kiosk-agent-B')   // clientKey = "10.0.0.2|kiosk-agent-B"
  const clientKeyA = '10.0.0.1|kiosk-agent-A'

  // stub TrtcService：固定返回我们的 TASK_ID，绝不调用腾讯云
  let startCalls = 0
  let stopCalls = 0
  const stubTrtc = {
    startSession: async (userId: string) => {
      startCalls++
      return { taskId: TASK_ID, sdkAppId: 0, userId, userSig: 'stub', roomId: 'stub-room', expireTime: 0 }
    },
    stopSession: async (_taskId: string) => { stopCalls++ },
  }

  // 直接实例化 controller，注入真实 RedisService + stub TrtcService
  const controller = new TrtcController(stubTrtc as never, redis)

  try {
    // 预清理
    await redis.del(OWNER_KEY(TASK_ID))

    // ── 1. startSession 写入归属 ────────────────────────────────────────────────
    console.log('── 1. startSession → Redis 写入归属 ──────────────────────────')
    const startRes = await controller.startSession({ userId: 'e2euserA' }, reqA, TERMINAL)
    if (startRes?.taskId === TASK_ID && startCalls === 1) pass(`startSession 返回 taskId=${TASK_ID}（TrtcService 被调用，未触腾讯云为 stub）`)
    else fail(`startSession 返回异常: ${JSON.stringify(startRes)}`)
    const ownerVal = await redis.get(OWNER_KEY(TASK_ID))
    if (ownerVal === clientKeyA) pass(`Redis trtc:owner:${TASK_ID} = "${ownerVal}"（= 发起方 clientKey）`)
    else fail(`归属值异常: 期望 "${clientKeyA}"，实得 "${ownerVal}"`)

    // ── 2. TTL 存在且 ≈1800s ────────────────────────────────────────────────────
    console.log('\n── 2. owner key 存在 TTL（非永久）─────────────────────────────')
    const ttl = await rawRedis.ttl(OWNER_KEY(TASK_ID))
    if (ttl > 0 && ttl <= 1800) pass(`TTL=${ttl}s（>0 且 ≤1800，与 MaxIdleTime 对齐，会自动过期）`)
    else fail(`TTL 异常: ${ttl}（应在 1..1800；-1=永久未设过期，-2=key 不存在）`)

    // ── 3. 不同 clientKey 终止被拒（key 仍在）──────────────────────────────────
    console.log('\n── 3. 不同 clientKey stopSession → 拒绝 ───────────────────────')
    let rejected = false
    let rejectCode = ''
    try {
      await controller.stopSession({ taskId: TASK_ID }, reqB, TERMINAL)
    } catch (e) {
      rejected = e instanceof ForbiddenException
      const resp = e instanceof ForbiddenException ? (e.getResponse() as { error?: { code?: string } }) : {}
      rejectCode = resp.error?.code ?? ''
    }
    if (rejected && rejectCode === 'TASK_NOT_OWNED') pass('不同 clientKey 终止 → 403 TASK_NOT_OWNED（跨会话终止被拦截）')
    else fail(`不同 clientKey 终止未被正确拒绝: rejected=${rejected} code=${rejectCode}`)
    const stillThere = await redis.get(OWNER_KEY(TASK_ID))
    if (stillThere === clientKeyA && stopCalls === 0) pass('被拒后 owner key 仍在、TrtcService.stopSession 未被调用（不误杀）')
    else fail(`被拒后状态异常: owner=${stillThere} stopCalls=${stopCalls}`)

    // ── 4. 模拟"API 重启"后仍能正确校验归属 ───────────────────────────────────
    console.log('\n── 4. 模拟重启：新 controller 实例仍能读到 Redis 归属 ─────────')
    // 旧设计中进程内 Map 会清空 → 任意请求放行；Redis 持久化下新实例仍读到归属。
    const controllerAfterRestart = new TrtcController(stubTrtc as never, redis)
    let rejectedAfterRestart = false
    try {
      await controllerAfterRestart.stopSession({ taskId: TASK_ID }, reqB, TERMINAL)
    } catch (e) {
      rejectedAfterRestart = e instanceof ForbiddenException
    }
    if (rejectedAfterRestart) pass('重启后（新实例）不同 clientKey 终止仍被拒 → 修复了"重启窗口放行"风险')
    else fail('重启后归属校验失效（不同 clientKey 被放行）')

    // ── 5. 同 clientKey 终止放行 + 删除 key ────────────────────────────────────
    console.log('\n── 5. 同 clientKey stopSession → 放行 + 清除归属 ──────────────')
    const stopRes = await controller.stopSession({ taskId: TASK_ID }, reqA, TERMINAL)
    if ((stopRes as { ok?: boolean })?.ok === true && stopCalls === 1) pass('同 clientKey 终止 → ok，TrtcService.stopSession 被调用 1 次')
    else fail(`同 clientKey 终止异常: ${JSON.stringify(stopRes)} stopCalls=${stopCalls}`)
    const afterStop = await redis.get(OWNER_KEY(TASK_ID))
    if (afterStop === null) pass('终止后 owner key 已从 Redis 删除（幂等清理）')
    else fail(`终止后 key 未删除: ${afterStop}`)

  } finally {
    await redis.del(OWNER_KEY(TASK_ID))
    info('测试数据已清理。')
    await app.close()
  }

  const exitCode = process.exitCode ?? 0
  console.log(`\n${'─'.repeat(60)}`)
  console.log(exitCode === 0 ? '✅ ALL PASS' : '❌ SOME CHECKS FAILED')
  console.log('─'.repeat(60))
  if (exitCode !== 0) process.exit(exitCode)
}

main().catch((e: unknown) => {
  console.error('\nFatal error:', (e as Error).message)
  console.error((e as Error).stack)
  process.exit(1)
})
