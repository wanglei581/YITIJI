/**
 * 打印失败告警：同一台机器之后打成功、且没有钱要退时，状态类失败不再算「正在发生」。
 * 真 SQLite、真 collectDerivedAlerts / resolveDerivedAlert。终端号和任务号带随机后缀，跑完删掉自己造的数据。
 *
 * 运行：接在 verify:admin-ops 后面（pnpm --filter @ai-job-print/api verify:admin-ops）。
 */
import 'reflect-metadata'
import 'dotenv/config'
import { randomUUID } from 'crypto'
import { AdminAlertPushService } from '../src/admin-ops/admin-alert-push.service'
import { collectDerivedAlerts, PRINT_FAILED_LIST_CAP, resolveDerivedAlert } from '../src/admin-ops/derived-alerts'
import { RedisService } from '../src/common/redis/redis.service'
import { PrismaService } from '../src/prisma/prisma.service'

function pass(message: string) {
  console.log(`  PASS ${message}`)
}

function fail(message: string): never {
  console.error(`  FAIL ${message}`)
  throw new Error(message)
}

class MemRedis {
  private readonly values = new Map<string, string>()
  private readonly keys = new Set<string>()

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null
  }

  async set(key: string, value: string, ...args: unknown[]): Promise<string | null> {
    if (args.includes('NX') && this.keys.has(key)) return null
    this.values.set(key, value)
    if (args.includes('NX')) this.keys.add(key)
    return 'OK'
  }

  async del(key: string): Promise<number> {
    this.keys.delete(key)
    this.values.delete(key)
    return 1
  }
}

const HOUR = 60 * 60 * 1000

async function main() {
  const prisma = new PrismaService()
  const suffix = randomUUID().replace(/-/g, '').slice(0, 12)
  const prefix = `pfar_${suffix}`
  const now = new Date()
  const failAt = new Date(now.getTime() - 2 * HOUR)
  const successAt = new Date(now.getTime() - 1 * HOUR)
  const earlierAt = new Date(now.getTime() - 3 * HOUR)
  let connected = false

  const cleanup = async () => {
    await prisma.printTaskStatusLog.deleteMany({ where: { taskId: { startsWith: `pt_${prefix}` } } })
    await prisma.order.deleteMany({ where: { id: { startsWith: `ord_${prefix}` } } })
    await prisma.printTask.deleteMany({ where: { id: { startsWith: `pt_${prefix}` } } })
    await prisma.terminalHeartbeat.deleteMany({ where: { terminalId: { startsWith: `term_${prefix}` } } })
    await prisma.terminal.deleteMany({ where: { id: { startsWith: `term_${prefix}` } } })
  }

  try {
    await prisma.onModuleInit()
    connected = true

    const terminal = async (label: string) => {
      const id = `term_${prefix}_${label}`
      const code = `PFAR-${label}-${suffix}`
      await prisma.terminal.create({
        data: {
          id,
          terminalCode: code,
          agentToken: `tok_${prefix}_${label}`,
          deviceFingerprint: 'fp',
        },
      })
      return { id, code }
    }

    const failedTask = async (input: {
      label: string
      terminalId: string
      errorCode: string
      updatedAt: Date
      /** 不传 = 没有订单。传了就按单文件订单挂上 Order.printTaskId，orderId 留空。 */
      amountCents?: number
    }) => {
      const id = `pt_${prefix}_${input.label}`
      await prisma.printTask.create({
        data: {
          id,
          terminalId: input.terminalId,
          fileUrl: 'https://internal/pfar',
          fileMd5: 'pfar',
          paramsJson: '{}',
          status: 'failed',
          errorCode: input.errorCode,
          createdAt: input.updatedAt,
          updatedAt: input.updatedAt,
        },
      })
      if (input.amountCents !== undefined) {
        await prisma.order.create({
          data: {
            id: `ord_${prefix}_${input.label}`,
            orderNo: `ORD-PFAR-${input.label}-${suffix}`.toUpperCase(),
            type: 'print',
            printTaskId: id,
            terminalId: input.terminalId,
            amountCents: input.amountCents,
            currency: 'CNY',
            payStatus: 'paid',
            taskStatus: 'failed',
            paymentSource: input.amountCents === 0 ? 'free' : 'sandbox',
            discountCents: 0,
          },
        })
      }
      return id
    }

    const laterTask = async (input: {
      label: string
      terminalId: string
      status: string
      printOutcome?: string | null
      completedAt: Date | null
    }) => {
      const id = `pt_${prefix}_${input.label}`
      const touchedAt = input.completedAt ?? successAt
      await prisma.printTask.create({
        data: {
          id,
          terminalId: input.terminalId,
          fileUrl: 'https://internal/pfar-later',
          fileMd5: 'pfarlater',
          paramsJson: '{}',
          status: input.status,
          printOutcome: input.printOutcome ?? null,
          completedAt: input.completedAt,
          createdAt: touchedAt,
          updatedAt: touchedAt,
        },
      })
      return id
    }

    // 列表和单条查证共用一份 where，count 也用它。resolve 返回 null 就是这条没进 count，firingTotal 不算它；
    // 返回告警则 count 算了它。再要求「应出现」的条真的在列表里，避免它只躲在 omitted 里还被当成测过了。
    const expectFiring = async (taskId: string, shouldFire: boolean, label: string) => {
      const collected = await collectDerivedAlerts(prisma, now)
      if (collected.firingTotal !== collected.alerts.length + collected.omitted) {
        fail(`${label}：firingTotal=${collected.firingTotal} 与列表 ${collected.alerts.length} + 省略 ${collected.omitted} 不一致`)
      }
      const alertId = `print_failed:${taskId}`
      const inList = collected.alerts.some((alert) => alert.id === alertId)
      const resolved = await resolveDerivedAlert(prisma, 'print_failed', taskId, now)
      if (shouldFire) {
        if (!inList) {
          fail(`${label}：应在列表里并计入 firingTotal，实际不在列表（omitted=${collected.omitted}，上限 ${PRINT_FAILED_LIST_CAP}）`)
        }
        if (!resolved) fail(`${label}：单条查证应返回这条告警，firingTotal 才算上它`)
        return
      }
      if (inList) fail(`${label}：不应在列表里，firingTotal 不应算它`)
      if (resolved) fail(`${label}：单条查证应返回 null，说明 count 仍把它算进 firingTotal`)
    }

    // 场景 1 / 9：0 元 PRINTER_ERROR，成功之前在列表里；同一台之后打成功则消失，并推「已恢复」。
    {
      const term = await terminal('s1')
      const taskId = await failedTask({
        label: 's1',
        terminalId: term.id,
        errorCode: 'PRINTER_ERROR',
        updatedAt: failAt,
        amountCents: 0,
      })
      await expectFiring(taskId, true, '场景 1 对照：后一单成功之前')
      await prisma.terminalHeartbeat.create({
        data: { terminalId: term.id, printerStatus: 'ok', createdAt: now },
      })
      const calls: Array<{ body?: string }> = []
      process.env.ALERT_WEBHOOK_URL = 'https://example.invalid'
      const push = new AdminAlertPushService(
        null as unknown as PrismaService,
        new RedisService(new MemRedis() as never),
        (_db, at) => collectDerivedAlerts(prisma, at),
        (async (_url, init) => {
          calls.push({ body: typeof init?.body === 'string' ? init.body : undefined })
          return { ok: true, status: 200 } as Response
        }) as typeof fetch,
      )
      const about = () => calls.map((call) => {
        const parsed = JSON.parse(call.body ?? '{}') as { text?: { content?: string } }
        return parsed.text?.content ?? ''
      }).filter((text) => text.includes(term.code))

      await push.pushDerivedAlerts()
      const firing = about()
      if (firing.length !== 1 || !firing[0]?.includes('正在发生')) {
        fail(`场景 9：第一轮应只推这条「正在发生」，实际 ${JSON.stringify(firing)}`)
      }
      await laterTask({ label: 's1ok', terminalId: term.id, status: 'completed', completedAt: successAt })
      await expectFiring(taskId, false, '场景 1：同一台之后打成功')
      await push.pushDerivedAlerts()
      const recovered = about().filter((text) => text.includes('已恢复'))
      if (recovered.length !== 1) fail(`场景 9：第二轮应推出一条「已恢复」，实际 ${JSON.stringify(about())}`)
      await push.pushDerivedAlerts()
      if (about().length !== 2) fail(`场景 9：第三轮不应再推这条，实际 ${JSON.stringify(about())}`)
      pass('场景 1 / 9：0 元卡纸在同一台之后打成功后消失，推送先「正在发生」再「已恢复」，第三轮不再推')
    }

    // 场景 2：之后成功的是另一台。对照：成功那台自己的失败要消失。
    {
      const termA = await terminal('s2a')
      const termB = await terminal('s2b')
      const onA = await failedTask({
        label: 's2a', terminalId: termA.id, errorCode: 'PRINTER_ERROR', updatedAt: failAt, amountCents: 0,
      })
      const onB = await failedTask({
        label: 's2b', terminalId: termB.id, errorCode: 'PRINTER_ERROR', updatedAt: failAt, amountCents: 0,
      })
      await laterTask({ label: 's2bok', terminalId: termB.id, status: 'completed', completedAt: successAt })
      await expectFiring(onB, false, '场景 2 对照：成功发生在 B，B 上更早的失败应消失')
      await expectFiring(onA, true, '场景 2：成功在另一台，A 上的失败仍在')
      pass('场景 2：别的终端之后打成功，不算这台恢复')
    }

    // 场景 3：成功在失败之前。对照：更早的那条失败会被这次成功清掉。
    {
      const term = await terminal('s3')
      const earlier = await failedTask({
        label: 's3early', terminalId: term.id, errorCode: 'PRINTER_ERROR', updatedAt: earlierAt, amountCents: 0,
      })
      await laterTask({ label: 's3ok', terminalId: term.id, status: 'completed', completedAt: failAt })
      const later = await failedTask({
        label: 's3late', terminalId: term.id, errorCode: 'PRINTER_ERROR', updatedAt: successAt, amountCents: 0,
      })
      await expectFiring(earlier, false, '场景 3 对照：成功之前的失败应消失')
      await expectFiring(later, true, '场景 3：成功发生在失败之前，失败仍在')
      pass('场景 3：出纸完成时间不晚于失败，不算恢复')
    }

    // 场景 4：收了 100 分。对照：同一台同一时刻的 0 元单会被清掉。订单按单文件关系挂，不写 PrintTask.orderId。
    {
      const term = await terminal('s4')
      const freeId = await failedTask({
        label: 's4free', terminalId: term.id, errorCode: 'PRINTER_ERROR', updatedAt: failAt, amountCents: 0,
      })
      const paidId = await failedTask({
        label: 's4paid', terminalId: term.id, errorCode: 'PRINTER_ERROR', updatedAt: failAt, amountCents: 100,
      })
      await laterTask({ label: 's4ok', terminalId: term.id, status: 'completed', completedAt: successAt })
      await expectFiring(freeId, false, '场景 4 对照：同机 0 元单应消失')
      await expectFiring(paidId, true, '场景 4：收了 100 分的单仍在')
      pass('场景 4：收过钱的单不因机器后来打成功而消失')
    }

    // 场景 5：出纸盘可能有纸，或文件问题。对照：同机的 PRINTER_ERROR 会被清掉。
    {
      const term = await terminal('s5')
      const control = await failedTask({
        label: 's5ok', terminalId: term.id, errorCode: 'PRINTER_ERROR', updatedAt: failAt, amountCents: 0,
      })
      const codes = [
        ['u', 'PRINT_JOB_UNCONFIRMED'],
        ['p', 'PARTIAL_OUTPUT'],
        ['t', 'PRINT_TIMEOUT'],
        ['f', 'FILE_NOT_FOUND'],
      ] as const
      const ids: Array<{ id: string; code: string }> = []
      for (const [mark, code] of codes) {
        ids.push({
          code,
          id: await failedTask({
            label: `s5${mark}`,
            terminalId: term.id,
            errorCode: code,
            updatedAt: failAt,
            amountCents: 0,
          }),
        })
      }
      await laterTask({ label: 's5later', terminalId: term.id, status: 'completed', completedAt: successAt })
      await expectFiring(control, false, '场景 5 对照：同机 PRINTER_ERROR 应消失')
      for (const item of ids) {
        await expectFiring(item.id, true, `场景 5：${item.code} 仍在`)
      }
      pass('场景 5：出纸未确认、只打出一部分、打印超时、文件失效都不自动消失')
    }

    // 场景 6：之后那单 completed 但被核实为没出纸。对照：另一台真的 completed 会把自己的失败清掉。
    {
      const term = await terminal('s6')
      const other = await terminal('s6b')
      const taskId = await failedTask({
        label: 's6', terminalId: term.id, errorCode: 'PRINTER_ERROR', updatedAt: failAt, amountCents: 0,
      })
      const otherFail = await failedTask({
        label: 's6b', terminalId: other.id, errorCode: 'PRINTER_ERROR', updatedAt: failAt, amountCents: 0,
      })
      await laterTask({
        label: 's6no', terminalId: term.id, status: 'completed', printOutcome: 'not_printed', completedAt: successAt,
      })
      await laterTask({ label: 's6bok', terminalId: other.id, status: 'completed', completedAt: successAt })
      await expectFiring(otherFail, false, '场景 6 对照：另一台真出纸应清掉自己的失败')
      await expectFiring(taskId, true, '场景 6：核实为没出纸的 completed 不算恢复')
      pass('场景 6：printOutcome=not_printed 不算出纸')
    }

    // 场景 7：核实为 printed 但没有完成时间，比不了先后。对照：有完成时间的核实出纸会清掉失败。
    {
      const term = await terminal('s7')
      const other = await terminal('s7b')
      const taskId = await failedTask({
        label: 's7', terminalId: term.id, errorCode: 'PRINTER_ERROR', updatedAt: failAt, amountCents: 0,
      })
      const otherFail = await failedTask({
        label: 's7b', terminalId: other.id, errorCode: 'PRINTER_ERROR', updatedAt: failAt, amountCents: 0,
      })
      await laterTask({
        label: 's7none', terminalId: term.id, status: 'failed', printOutcome: 'printed', completedAt: null,
      })
      await laterTask({
        label: 's7bok', terminalId: other.id, status: 'failed', printOutcome: 'printed', completedAt: successAt,
      })
      await expectFiring(otherFail, false, '场景 7 对照：有完成时间的核实出纸应清掉失败')
      await expectFiring(taskId, true, '场景 7：没有完成时间就比不了先后，失败仍在')
      pass('场景 7：completedAt 为空的核实出纸不算恢复')
    }

    // 场景 8：没有订单。对照：成功之前仍在。
    {
      const term = await terminal('s8')
      const taskId = await failedTask({
        label: 's8', terminalId: term.id, errorCode: 'PAPER_EMPTY', updatedAt: failAt,
      })
      await expectFiring(taskId, true, '场景 8 对照：后一单成功之前')
      await laterTask({ label: 's8ok', terminalId: term.id, status: 'completed', completedAt: successAt })
      await expectFiring(taskId, false, '场景 8：没有订单的缺纸，同一台之后打成功则消失')
      pass('场景 8：没有订单的 PAPER_EMPTY 在同一台之后打成功后消失')
    }

    console.log('print-failed alert recovery gates passed')
  } finally {
    if (connected) {
      await cleanup()
      await prisma.onModuleDestroy()
    }
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
