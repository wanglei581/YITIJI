/**
 * verify:admin-order-filters —— 订单筛选不得静默失效
 *
 * 守的是这条真实故障（DATA-WALK-CONSOLE 实测，本批复核确认）：
 * `admin-orders-readonly.controller.ts` 自带一份四值支付状态白名单
 * `['unpaid','paid','refunded','failed']`，而 `Order.payStatus` 实际有八态。
 * 白名单外的值被静默丢成 `undefined` → 查询退化成无筛选 → **返回全量**。
 * 而 Admin 前端 `PAY_FILTERS` 恰好提供了「退款中」(refunding)：
 * 用户点它 → 后端丢弃 → 页面显示全部订单，而筛选芯片是选中态。
 * 这不是少一个筛选项，是给运营一个**没有任何报错的假结论**。
 *
 * 三段，都不写死清单：
 *   [A] 取值表与联合类型一致（跨 services/api 与 packages/shared 两份声明比对，
 *       全部从源码解析出来，不在门禁里再抄一遍）。
 *   [B] 控制器不得再就地写字面量白名单。
 *   [C] 行为实测：每个合法态都真的生效（造一条该态的订单，断言只返回它），
 *       非法态明确 400 而不是静默返回全量。
 */
import 'reflect-metadata'
import 'dotenv/config'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { assertIsolatedVerificationDatabase } from './support/isolated-verification-database'

const API_ROOT = join(__dirname, '..')
const REPO_ROOT = join(API_ROOT, '..', '..')

let failures = 0
let checks = 0

function check(name: string, ok: boolean, detail = ''): void {
  checks += 1
  if (ok) { console.log(`  ✅ ${name}`); return }
  failures += 1
  console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`)
}

/** 从源码里解析 `export type OrderPayStatus = 'a' | 'b' | …` 的成员。 */
function parseUnionMembers(source: string, typeName: string): string[] {
  const start = source.indexOf(`export type ${typeName} =`)
  if (start === -1) return []
  const rest = source.slice(start)
  const end = rest.search(/\n\s*\n/)
  const block = end === -1 ? rest : rest.slice(0, end)
  return [...block.matchAll(/'([a-z_]+)'/g)].map((m) => m[1] as string)
}

/** 从源码里解析 `export const ORDER_PAY_STATUSES = [ … ] as const` 的元素。 */
function parseConstArray(source: string, constName: string): string[] {
  const start = source.indexOf(`export const ${constName} = [`)
  if (start === -1) return []
  const open = source.indexOf('[', start)
  const close = source.indexOf(']', open)
  if (open === -1 || close === -1) return []
  return [...source.slice(open, close).matchAll(/'([a-z_]+)'/g)].map((m) => m[1] as string)
}

function parseLocalConstArray(source: string, constName: string): string[] {
  const match = source.match(new RegExp(`const ${constName} = \\[([^\\]]+)\\] as const`))
  return match ? [...match[1].matchAll(/'([a-z_]+)'/g)].map((item) => item[1] as string) : []
}

async function verifyNoDrift(): Promise<string[]> {
  console.log('\n[A] 支付状态取值表与联合类型一致（两份声明都从源码解析，门禁不另抄一份）')

  const apiTypes = await readFile(join(API_ROOT, 'src/payment/payment.types.ts'), 'utf8')
  const sharedTypes = await readFile(join(REPO_ROOT, 'packages/shared/src/types/payment.ts'), 'utf8')

  const apiUnion = parseUnionMembers(apiTypes, 'OrderPayStatus')
  const apiConst = parseConstArray(apiTypes, 'ORDER_PAY_STATUSES')
  const sharedUnion = parseUnionMembers(sharedTypes, 'OrderPayStatus')
  const sharedConst = parseConstArray(sharedTypes, 'ORDER_PAY_STATUSES')

  check('解析到 services/api 的 OrderPayStatus 联合成员', apiUnion.length >= 4, apiUnion.join(','))
  check('services/api：运行时取值表覆盖联合类型全部成员',
    apiUnion.every((v) => apiConst.includes(v)) && apiConst.length === apiUnion.length,
    `union=${apiUnion.join(',')} const=${apiConst.join(',')}`)
  check('packages/shared：运行时取值表覆盖联合类型全部成员',
    sharedUnion.every((v) => sharedConst.includes(v)) && sharedConst.length === sharedUnion.length,
    `union=${sharedUnion.join(',')} const=${sharedConst.join(',')}`)
  check('两个包的支付状态取值完全一致（跨包漂移守卫）',
    apiConst.length === sharedConst.length && apiConst.every((v) => sharedConst.includes(v)),
    `api=${apiConst.join(',')} shared=${sharedConst.join(',')}`)

  console.log('\n[B] 控制器不得再就地写字面量白名单')
  const controller = await readFile(
    join(API_ROOT, 'src/admin-orders-readonly/admin-orders-readonly.controller.ts'), 'utf8')
  check('payStatus 白名单引用统一取值表', controller.includes('ORDER_PAY_STATUSES'))
  check('控制器不再自带 payStatus 字面量集合',
    !/VALID_PAY_STATUS\s*=\s*(new Set\(\[|\[)\s*'/.test(controller))
  check('未知筛选值走明确拒绝而不是静默丢弃',
    controller.includes('INVALID_FILTER_VALUE') && !/\?\s*\w+\s*:\s*undefined/.test(
      controller.slice(controller.indexOf('this.orders.list('), controller.indexOf('search:'))),
  )
  const taskStatuses = parseLocalConstArray(controller, 'VALID_TASK_STATUS')
  check('订单筛选允许管理员处置产生的 abandoned 状态', taskStatuses.includes('abandoned'), taskStatuses.join(','))

  return apiConst
}

async function verifyBehaviour(payStatuses: string[]): Promise<void> {
  console.log('\n[C] 行为实测：合法态真的生效，非法态明确 400（不再静默返回全量）')

  const { PrismaService } = await import('../src/prisma/prisma.service')
  const { AdminOrdersReadonlyService } = await import('../src/admin-orders-readonly/admin-orders-readonly.service')
  const { AdminOrdersReadonlyController } = await import('../src/admin-orders-readonly/admin-orders-readonly.controller')

  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const controller = new AdminOrdersReadonlyController(new AdminOrdersReadonlyService(prisma))

  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
  const orderNoOf = (status: string): string => `VOF-${suffix}-${status}`

  try {
    // 每个合法支付状态各造一条订单，确保「按该状态筛选」有唯一正确答案。
    for (const status of payStatuses) {
      await prisma.order.create({
        data: { orderNo: orderNoOf(status), type: 'print', payStatus: status, taskStatus: 'pending' },
      })
    }
    const total = await prisma.order.count()
    check(`造数完成（库内订单共 ${total} 条，其中本轮 ${payStatuses.length} 条）`,
      total >= payStatuses.length)

    for (const status of payStatuses) {
      const page = await controller.list(undefined, status, undefined, undefined, undefined, undefined, '1', '100')
      const expected = await prisma.order.count({ where: { payStatus: status } })
      const returned = page.pagination.total
      check(
        `payStatus=${status} 真的生效（接口 ${returned} 条 = 库内 ${expected} 条，且不等于全量 ${total}）`,
        returned === expected && (expected === total || returned !== total),
        `接口 ${returned} / 库内 ${expected} / 全量 ${total}`,
      )
    }

    // 非法值：必须抛，绝不能静默返回全量。
    let rejected = false
    let code = ''
    try {
      await controller.list(undefined, 'definitely_not_a_status', undefined, undefined, undefined, undefined, '1', '1')
    } catch (error) {
      rejected = true
      const response = (error as { getResponse?: () => unknown }).getResponse?.() as
        { error?: { code?: string } } | undefined
      code = response?.error?.code ?? ''
    }
    check('未知 payStatus 被明确拒绝（不是静默返回全量）', rejected)
    check('拒绝时给出机器码 INVALID_FILTER_VALUE', code === 'INVALID_FILTER_VALUE', code)

    // 其余筛选维度同样不得静默放行 —— 它们和 payStatus 是同一个坑。
    for (const [index, field] of ([['type', 0], ['taskStatus', 2], ['channel', 3], ['pickupStatus', 4]] as const)
      .map(([f, i]) => [i, f] as const)) {
      const args: Array<string | undefined> = [undefined, undefined, undefined, undefined, undefined, undefined, '1', '1']
      args[index] = 'definitely_not_a_value'
      let threw = false
      try {
        await controller.list(...(args as Parameters<typeof controller.list>))
      } catch { threw = true }
      check(`未知 ${field} 同样被明确拒绝`, threw)
    }
  } finally {
    await prisma.order.deleteMany({ where: { orderNo: { startsWith: `VOF-${suffix}-` } } })
    await prisma.onModuleDestroy()
  }
}

async function main(): Promise<void> {
  console.log('=== 订单筛选静默失效门禁 verify:admin-order-filters ===')
  assertIsolatedVerificationDatabase()

  const payStatuses = await verifyNoDrift()
  assert.ok(payStatuses.length > 0, '解析支付状态取值表失败，门禁无法继续')
  await verifyBehaviour(payStatuses)

  console.log(`\n结果：${checks - failures}/${checks} 通过`)
  if (failures > 0) {
    console.error(`❌ ${failures} 项失败`)
    process.exit(1)
  }
  console.log('✅ 全部通过')
  process.exit(0)
}

void main()
