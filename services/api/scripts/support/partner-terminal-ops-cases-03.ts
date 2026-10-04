import { randomUUID } from 'crypto'


import { collectPaths } from './partner-terminal-ops-cases-01'
import { verifyTerminalOperationsSetup } from './partner-terminal-ops-cases-02'
import { MIN, TERMINAL_OPS_KEY_PATHS, carryContext, Assert } from './partner-terminal-ops-cases-04'
import type { PrismaService } from '../../src/prisma/prisma.service'
import { verifyTerminalRebindIsolation } from './partner-terminal-rebind-cases'



export async function verifyTerminalOperationsPhase1(context: Awaited<ReturnType<typeof verifyTerminalOperationsSetup>>) {
const { assert, prisma, service, suffix, orgA, orgB, ta1, ta2, ta3, tb1, now, periodEnd, ago, cleanup } = context
await cleanup()
await prisma.organization.createMany({
      data: [orgA, orgB].map((id, i) => ({
        id, name: `终端数据验证机构${i === 0 ? 'A' : 'B'}`, type: 'school_employment_center', sceneTemplate: 'school', enabled: true,
      })),
    })
await prisma.terminal.createMany({
      data: [
        { id: ta1, orgId: orgA, name: 'A1' },
        { id: ta2, orgId: orgA, name: 'A2' },
        { id: ta3, orgId: orgA, name: 'A3' },
        { id: tb1, orgId: orgB, name: 'B1' },
      ].map((t) => ({
        id: t.id,
        terminalCode: `PTO-${t.name}-${suffix}`,
        agentToken: `pto-token-${t.id}`,
        deviceFingerprint: `pto-fp-${t.id}`,
        displayName: `验证终端${t.name}`,
        locationLabel: `验证位置${t.name}`,
        orgId: t.orgId,
      })),
    })
const beforeVisits = await service.getTerminalOperations(orgA, 'week', now)
const from = new Date(beforeVisits.window.from)
assert(
      'T4k0. 一体机还没上报过会话时 recordingStarted=false，服务人次按 0 计但页面据此显示「暂无」',
      beforeVisits.visitCount.recordingStarted === false && beforeVisits.totals.visitCount === 0,
      JSON.stringify(beforeVisits.visitCount),
    )
const task = (id: string, terminalId: string, data: Record<string, unknown>) => ({
      id: `pto_${id}_${suffix}`, terminalId, fileUrl: 'https://example.invalid/f.pdf', fileMd5: 'md5', createdAt: ago(120), ...data,
    })
await prisma.printTask.createMany({
      data: [
        task('c1', ta1, { status: 'completed', completedAt: ago(60) }),
        task('c2', ta1, { status: 'completed', completedAt: ago(60) }),
        task('c3', ta1, { status: 'completed', completedAt: ago(60) }),
        task('c4', ta1, { status: 'failed', completedAt: ago(100), errorCode: 'PRINTER_ERROR' }),
        task('f1', ta1, { status: 'failed', completedAt: ago(60), errorCode: 'PRINT_JOB_UNCONFIRMED', printOutcome: 'printed' }),
        task('f2', ta1, { status: 'failed', completedAt: ago(60), errorCode: 'PRINT_JOB_UNCONFIRMED' }),
        task('f3', ta1, { status: 'failed', completedAt: ago(60), errorCode: 'PRINT_JOB_UNCONFIRMED', printOutcome: 'not_printed' }),
        task('x1', ta1, { status: 'cancelled', completedAt: ago(60) }),
        task('x2', ta1, { status: 'abandoned', completedAt: ago(60) }),
        task('p1', ta1, { status: 'failed', completedAt: ago(90), errorCode: 'PRINTER_ERROR' }),
        // 窗口前建单、窗口前结束：两项都不计
        task('o1', ta1, { status: 'completed', createdAt: new Date(from.getTime() - 24 * 60 * MIN), completedAt: new Date(from.getTime() - 23 * 60 * MIN) }),
        // 窗口前建单、窗口内结束：进出纸成功率，不进服务次数
        task('o2', ta1, { status: 'completed', createdAt: new Date(from.getTime() - 60 * MIN), completedAt: new Date(from.getTime() + 60 * MIN) }),
        ...[1, 2, 3, 4].map((n) => task(`s${n}`, ta3, { status: 'completed', completedAt: ago(30) })),
        ...[1, 2, 3, 4, 5, 6].map((n) => task(`b${n}`, tb1, { status: 'completed', completedAt: ago(30) })),
      ],
    })
// 一体机重试：failed → pending 并清 completedAt（print-jobs.service 同款写法）；c4 之后再次出纸完成。
    const retry = { status: 'pending', claimedAt: null, claimExpiry: null, completedAt: null, errorCode: null, errorMessage: null }
await prisma.printTask.updateMany({ where: { id: { in: [`pto_c4_${suffix}`, `pto_p1_${suffix}`] }, status: 'failed' }, data: retry })
await prisma.printTask.update({ where: { id: `pto_c4_${suffix}` }, data: { status: 'completed', completedAt: ago(50) } })
await prisma.scanTask.createMany({
      data: [1, 2].map((n) => ({ id: `pto_scan${n}_${suffix}`, terminalId: ta1, scanType: 'document', status: 'completed', expiresAt: ago(0), createdAt: ago(110) })),
    })
const beats: Array<[number, string | null]> = [
      [300, 'ready'], [298, 'ready'], [296, 'ready'], [270, 'error'], [268, 'unknown'], [266, null],
      [264, 'ready'], [262, 'unknown'], [260, 'ready'], [258, 'ready'],
    ]
await prisma.terminalHeartbeat.createMany({
      data: beats.map(([minutes, printerStatus]) => ({ terminalId: ta1, printerStatus, createdAt: ago(minutes) })),
    })
// B：超过一批（2000 条）的心跳，走分批游标；每 30 秒一条直到刚才，在线且无离线。
    await prisma.terminalHeartbeat.createMany({
      data: Array.from({ length: 2003 }, (_, i) => ({ terminalId: tb1, printerStatus: 'ready', createdAt: new Date(periodEnd.getTime() - 10_000 - i * 30_000) })),
    })
// 服务人次（一体机会话）：A1 6 次、A3 2 次（压制）、A1 另有 1 次快照属 B（改绑前的历史，不算给 A）、
    // A1 窗口前 1 次（不计），B1 5 次（A 看不到）。
    const visit = (terminalId: string, orgId: string, startedAt: Date) => ({
      terminalId, orgId, clientSessionId: randomUUID(), startedAt, lastActiveAt: startedAt,
      expiresAt: new Date(startedAt.getTime() + 30 * MIN), categoriesJson: '["print"]',
    })
await prisma.kioskSession.createMany({
      data: [
        ...[1, 2, 3, 4, 5, 6].map((n) => visit(ta1, orgA, ago(40 + n))),
        ...[1, 2].map((n) => visit(ta3, orgA, ago(40 + n))),
        visit(ta1, orgB, ago(80)),
        visit(ta1, orgA, new Date(from.getTime() - 60 * MIN)),
        ...[1, 2, 3, 4, 5].map((n) => visit(tb1, orgB, ago(40 + n))),
      ],
    })
await prisma.terminalHeartbeat.create({ data: { terminalId: tb1, printerStatus: 'ready', createdAt: new Date(now.getTime() - 3000) } })
const a = await service.getTerminalOperations(orgA, 'week', now)
const b = await service.getTerminalOperations(orgB, 'week', now)
const row = (code: string) => a.terminals.find((t) => t.terminalCode === `PTO-${code}-${suffix}`)
const a1 = row('A1')
const a2 = row('A2')
const a3 = row('A3')
assert(
      'T4a. 机构隔离：A 只看到自己的 3 台，B 只看到自己的 1 台',
      a.terminals.length === 3 && Boolean(a1 && a2 && a3) && !a.terminals.some((t) => t.terminalCode.includes('B1'))
        && b.terminals.length === 1 && b.terminals[0]!.terminalCode === `PTO-B1-${suffix}`,
      a.terminals.map((t) => t.terminalCode).join(','),
    )
assert(
      'T4b. 出纸成功率：分母8与另一台4形成公开合计12，补充隐藏；比率因低频未确认隐藏',
      a1?.output.settled === null && a1?.output.printed === null && a1?.output.successRate === null,
      JSON.stringify(a1?.output),
    )
assert(
      'T4c. 未确认 1 单（压制为 null）；核查为未出纸的不算未确认',
      a1?.output.unconfirmed === null,
      JSON.stringify(a1?.output),
    )
assert(
      'T4d. 打印扫描服务次数原始12，另一台4时按公开合计16补充隐藏',
      a1?.serviceCount === null,
      String(a1?.serviceCount),
    )
assert(
      'T4e. 4 单的终端：服务次数、分子、分母全部压制，比率不给',
      a3?.serviceCount === null && a3?.output.settled === null && a3?.output.printed === null && a3?.output.successRate === null,
      JSON.stringify(a3),
    )
assert(
      'T4f. 0 单的终端保留 0；从未上报心跳的终端不在线、不推断离线',
      a2?.serviceCount === 0 && a2?.output.settled === 0 && a2?.output.printed === 0 && a2?.output.successRate === null && a2?.online === false && a2?.lastHeartbeatAt === null
        && a2?.faults.reportedInWindow === false && a2?.faults.offlineCount === 0,
      JSON.stringify(a2),
    )
assert(
      'T4g. 心跳折叠：离线 2 次共 274 分钟（21 已恢复 + 253 未恢复），打印机故障 1 次 6 分钟',
      a1?.faults.offlineCount === 2 && a1?.faults.offlineMinutes === 274
        && a1?.faults.printerFaultCount === 1 && a1?.faults.printerFaultMinutes === 6
        && a1?.faults.recoveredCount === 2 && a1?.faults.avgRecoveryMinutes === 13.5
        && a1?.faults.longestMinutes === 253 && a1?.faults.unrecovered === true,
      JSON.stringify(a1?.faults),
    )
assert(
      'T4h. 当前状态：最后心跳 258 分钟前 → 不在线',
      a1?.online === false && a1?.lastHeartbeatAt === ago(258).toISOString(),
    )
assert(
      'T4i. 合计独立投影：服务16、已结束12；未出纸2与未确认1使成功数和比率隐藏',
      a.totals.terminalCount === 3 && a.totals.serviceCount === 16
        && a.totals.output.settled === 12 && a.totals.output.printed === null && a.totals.output.successRate === null
        && a.totals.unrecoveredTerminals === 1 && a.totals.silentTerminals === 2 && a.totals.onlineTerminals === 0,
      JSON.stringify(a.totals),
    )
assert(
      'T4j. 超过一批的心跳分批读完：B 在线、无离线、分子分母只含 B 自己的 6 单',
      b.terminals[0]!.online === true && b.terminals[0]!.faults.offlineCount === 0
        && b.terminals[0]!.output.settled === 6 && b.totals.output.settled === 6,
      JSON.stringify(b.terminals[0]),
    )
assert(
      'T4k. 服务人次按会话数：A1原6补充隐藏、A2保留0、A3原2隐藏、合计8公开；快照属 B 与窗口外的不算；B 只看到自己的 5 次',
      a.visitCount.available === true && a.visitCount.recordingStarted === true && a1?.visitCount === null && a2?.visitCount === 0 && a3?.visitCount === null
        && a.totals.visitCount === 8 && b.terminals[0]!.visitCount === 5 && b.totals.visitCount === 5,
      JSON.stringify({ a1: a1?.visitCount, a2: a2?.visitCount, a3: a3?.visitCount, total: a.totals.visitCount, b: b.totals.visitCount }),
    )
assert(
      'T4k2. AI 可用率如实标为不可用',
      a.aiAvailability.available === false && a.aiAvailability.reason.length > 0,
    )
assert(
      'T4l. 窗口到当前为止，时区由服务端声明，最小样本 5',
      a.window.to === periodEnd.toISOString() && a.timezone === 'Asia/Shanghai' && a.minSample === 5
        && new Date(a.window.from).getTime() < now.getTime(),
    )
const actual = collectPaths(JSON.parse(JSON.stringify(a)))
const extra = [...actual].filter((path) => !TERMINAL_OPS_KEY_PATHS.has(path))
return carryContext(context, { beforeVisits, from, task, retry, beats, visit, a, b, row, a1, a2, a3, actual, extra })
}


export async function verifyTerminalOperationsPhase2(context: Awaited<ReturnType<typeof verifyTerminalOperationsPhase1>>) {
const { assert, bannedKeys, suffix, orgA, ta1, a, actual, extra } = context
const missing = [...TERMINAL_OPS_KEY_PATHS].filter((path) => !actual.has(path))
assert(
      'T4m. 响应键全集 = 白名单（递归比对，多一个少一个都不行）',
      extra.length === 0 && missing.length === 0,
      `多出 ${extra.join(',') || '无'}；缺少 ${missing.join(',') || '无'}`,
    )
const keys = terminalOpsKeys(a)
const hit = bannedKeys.filter((key) => keys.has(key))
assert('T4n0. 响应不含 3j/3k 禁用键与机构、终端内部、单据字段', hit.length === 0 && bannedKeys.length > 10, hit.join(','))
const serialized = JSON.stringify(a)
assert(
      'T4n. 响应里没有机构 id、终端内部 id 与任务 id',
      !serialized.includes(orgA) && !serialized.includes(ta1) && !serialized.includes(`pto_c1_${suffix}`),
    )
return carryContext(context, { missing, keys, hit, serialized })
}


export async function verifyTerminalOperations(
  assert: Assert,
  prisma: PrismaService,
  bannedKeys: readonly string[],
): Promise<void> {
const context = await verifyTerminalOperationsSetup(assert, prisma, bannedKeys)
const { cleanup } = context
try {
const phase1 = await verifyTerminalOperationsPhase1(context)
await verifyTerminalOperationsPhase2(phase1)

}  finally {
    await cleanup()
  }
await verifyTerminalRebindIsolation(assert, prisma)
}


export function terminalOpsKeys(value: unknown): Set<string> {
  const keys = new Set<string>()
  for (const path of collectPaths(value)) keys.add(path.split('.').pop()!.replace('[]', ''))
  return keys
}
