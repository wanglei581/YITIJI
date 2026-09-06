/**
 * TRTC 会话归属（Redis）— 后端 E2E 验证脚本
 *
 * 背景：原设计把 `taskId → clientKey(IP|UA)` 落 Redis，靠比对 IP+UA 判断"谁有权终止"。
 * 该模型有两个洞：**同一个展厅的多台一体机走同一出口 IP、同一 UA，clientKey 完全相同**，
 * 彼此可以互相终止会话；而 IP 与 UA 本来就是请求方可控的，攻击者可以直接伪造。
 *
 * 现设计（任务包 5）：对外返回的 `taskId` 是每会话一次性随机的**停止能力令牌**
 * （32 字节随机数），Redis 存 `trtc:owner:{stopToken} → 真实腾讯 TaskId`。
 * 真实 TaskId 永不出服务端；不持有令牌就无法终止，与 IP/UA 是否相同无关。
 *
 * 本脚本在真实 Redis 下端到端验证该模型，**stub 掉 TrtcService 不调用腾讯云**（不计费）。
 *
 * 前置：services/api/.env 含 REDIS_URL；Redis 已启动（redis-cli ping → PONG）。
 * 运行（services/api/ 目录）：pnpm verify:trtc-ownership
 *
 * 验证项：
 *   1. 对外 taskId 是随机令牌，不等于真实腾讯 TaskId（真实 TaskId 不外泄）
 *   2. Redis trtc:owner:{stopToken} = 真实 TaskId，且 TTL 在 1..1800（与 MaxIdleTime 对齐）
 *   3. 两次会话拿到不同令牌，各自只映射到自己的 TaskId（无串号）
 *   4. 同 IP/UA 的另一台终端用**自己的**令牌只能停自己的会话（旧模型在此处会误杀）
 *   5. 猜/伪造的令牌是空操作：不停任何人的会话（幂等返回，绝不误杀）
 *   6. 模拟 API 重启（新 controller 实例）后令牌仍可用 —— 归属在 Redis 不在进程内
 *   7. 成功终止后令牌失效，重放不会二次调用腾讯云（防重复计费）
 */
import 'dotenv/config'
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

const OWNER_KEY = (token: string) => `trtc:owner:${token}`

// 同一展厅的两台一体机：出口 IP 与 UA **完全相同**。
// 旧的 clientKey(IP|UA) 模型在这种最常见的现场部署下形同虚设，本脚本刻意用它做对照。
function mockReq(): Request {
  return { headers: { 'user-agent': 'kiosk-agent' }, ip: '10.0.0.1' } as unknown as Request
}

async function main() {
  console.log('\n=== TRTC 会话归属（Redis 停止令牌）— 后端 E2E 验证 ===')
  console.log(`Redis: ${process.env['REDIS_URL'] ?? '(未设置)'}\n`)
  if (!process.env['REDIS_URL']) { fail('REDIS_URL 未设置'); process.exit(1) }

  info('Bootstrapping NestJS DI container (无 HTTP 监听)...')
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn'] })
  await app.init()

  const redis = app.get(RedisService)
  const rawRedis = app.get<Redis>(REDIS_CLIENT)

  const tail = Date.now().toString().slice(-9)
  const REAL_TASK_A = `e2e_trtc_A_${tail}`
  const REAL_TASK_B = `e2e_trtc_B_${tail}`
  const TERMINAL = 'e2e-terminal-01'
  const reqA = mockReq()
  const reqB = mockReq() // 与 A 同 IP、同 UA

  // stub TrtcService：绝不调用腾讯云；按调用顺序发不同的真实 TaskId。
  const started: string[] = []
  const stopped: string[] = []
  const stubTrtc = {
    startSession: async (userId: string) => {
      const taskId = started.length === 0 ? REAL_TASK_A : REAL_TASK_B
      started.push(taskId)
      return { taskId, sdkAppId: 0, userId, userSig: 'stub', roomId: 'stub-room', expireTime: 0 }
    },
    stopSession: async (taskId: string) => { stopped.push(taskId) },
  }

  const controller = new TrtcController(stubTrtc as never, redis)
  const issuedTokens: string[] = []

  try {
    // ── 1. 对外 taskId 是随机令牌，不是真实 TaskId ────────────────────────────
    console.log('── 1. startSession → 对外只给随机停止令牌 ────────────────────')
    const startA = await controller.startSession({ userId: 'e2euserA' }, reqA, TERMINAL)
    const tokenA = startA.taskId
    issuedTokens.push(tokenA)
    if (started.length === 1 && started[0] === REAL_TASK_A) pass('TrtcService.startSession 被调用 1 次（stub，未触腾讯云）')
    else fail(`startSession 调用异常: ${JSON.stringify(started)}`)
    if (typeof tokenA === 'string' && tokenA.length >= 32 && tokenA !== REAL_TASK_A) {
      pass(`对外 taskId 是随机令牌（${tokenA.length} 字符），真实腾讯 TaskId 未外泄`)
    } else {
      fail(`对外 taskId 不该等于真实 TaskId，也不该短于 32 字符: "${String(tokenA)}"`)
    }

    // ── 2. Redis 映射与 TTL ───────────────────────────────────────────────────
    console.log('\n── 2. Redis 令牌 → 真实 TaskId，且有 TTL ─────────────────────')
    const mapped = await redis.get(OWNER_KEY(tokenA))
    if (mapped === REAL_TASK_A) pass(`Redis trtc:owner:{token} = "${REAL_TASK_A}"（真实 TaskId 只存服务端）`)
    else fail(`映射值异常: 期望 "${REAL_TASK_A}"，实得 "${String(mapped)}"`)
    const ttl = await rawRedis.ttl(OWNER_KEY(tokenA))
    if (ttl > 0 && ttl <= 1800) pass(`TTL=${ttl}s（>0 且 ≤1800，与 MaxIdleTime 对齐，会自动过期）`)
    else fail(`TTL 异常: ${ttl}（应在 1..1800；-1=永久未设过期，-2=key 不存在）`)

    // ── 3. 两次会话令牌不同、各归其主 ─────────────────────────────────────────
    console.log('\n── 3. 第二台终端（同 IP/同 UA）另起会话 ──────────────────────')
    const startB = await controller.startSession({ userId: 'e2euserB' }, reqB, TERMINAL)
    const tokenB = startB.taskId
    issuedTokens.push(tokenB)
    if (tokenB !== tokenA) pass('两次会话拿到不同令牌（令牌是每会话随机，不可复用）')
    else fail('两次会话令牌相同 —— 令牌不是每会话随机')
    const mappedB = await redis.get(OWNER_KEY(tokenB))
    if (mappedB === REAL_TASK_B) pass('第二个令牌映射到它自己的 TaskId（无串号）')
    else fail(`第二个令牌映射异常: 期望 "${REAL_TASK_B}"，实得 "${String(mappedB)}"`)

    // ── 4. 同 IP/UA 的终端只能停自己那一路 ────────────────────────────────────
    console.log('\n── 4. 同 IP/UA 终端用自己的令牌 → 只停自己 ───────────────────')
    await controller.stopSession({ taskId: tokenB }, reqB, TERMINAL)
    if (stopped.length === 1 && stopped[0] === REAL_TASK_B) {
      pass('只终止了 B 自己的会话；A 的会话未被误杀（旧 IP|UA 模型在此处必然误杀）')
    } else {
      fail(`终止范围异常: stopped=${JSON.stringify(stopped)}`)
    }
    const aStillAlive = await redis.get(OWNER_KEY(tokenA))
    if (aStillAlive === REAL_TASK_A) pass('A 的令牌仍然有效（互不影响）')
    else fail(`A 的令牌被连带清掉了: ${String(aStillAlive)}`)

    // ── 5. 伪造/猜测的令牌是空操作 ────────────────────────────────────────────
    console.log('\n── 5. 伪造令牌 → 空操作，绝不误杀 ────────────────────────────')
    const before = stopped.length
    const forged = await controller.stopSession({ taskId: 'forged-token-not-in-redis' }, reqB, TERMINAL)
    if ((forged as { ok?: boolean })?.ok === true && stopped.length === before) {
      pass('伪造令牌 → 幂等返回 ok，且未调用 TrtcService.stopSession（不误杀他人会话）')
    } else {
      fail(`伪造令牌处理异常: ${JSON.stringify(forged)} stopped=${JSON.stringify(stopped)}`)
    }

    // ── 6. 模拟 API 重启后令牌仍可用 ──────────────────────────────────────────
    console.log('\n── 6. 模拟重启：新 controller 实例仍认这枚令牌 ───────────────')
    const controllerAfterRestart = new TrtcController(stubTrtc as never, redis)
    await controllerAfterRestart.stopSession({ taskId: tokenA }, reqA, TERMINAL)
    if (stopped.length === 2 && stopped[1] === REAL_TASK_A) {
      pass('重启后（新实例）令牌仍解析到真实 TaskId —— 归属在 Redis，不在进程内')
    } else {
      fail(`重启后终止异常: stopped=${JSON.stringify(stopped)}`)
    }
    const afterStop = await redis.get(OWNER_KEY(tokenA))
    if (afterStop === null) pass('终止后令牌已从 Redis 删除')
    else fail(`终止后令牌未删除: ${afterStop}`)

    // ── 7. 令牌重放不会二次计费 ───────────────────────────────────────────────
    console.log('\n── 7. 令牌重放 → 不再调用腾讯云（防重复计费）─────────────────')
    const replayBefore = stopped.length
    await controller.stopSession({ taskId: tokenA }, reqA, TERMINAL)
    if (stopped.length === replayBefore) pass('重放已用过的令牌 → 未再调用 TrtcService.stopSession')
    else fail(`重放导致二次调用: stopped=${JSON.stringify(stopped)}`)

  } finally {
    for (const t of issuedTokens) await redis.del(OWNER_KEY(t))
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
