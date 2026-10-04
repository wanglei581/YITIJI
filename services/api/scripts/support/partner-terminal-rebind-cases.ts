/**
 * 终端从 A 改绑到 B 之后，B 的「终端数据」只含 B 名下期间的打印、扫描和心跳。
 * 改绑走 TerminalAdminService.assignTerminalOrg（可注入现在时间），不直接改表。
 *
 * A 的语义：getTerminalOperations 只列出当前 orgId 等于本机构的终端。
 * 改绑之后这台终端不在 A 的结果里，不是一行全 0。
 */
import { randomUUID } from 'crypto'
import { AuditService } from '../../src/audit/audit.service'
import type { PartnerOrgId } from '../../src/console-screen/console-screen.org'
import { PartnerStatsService } from '../../src/orgs/partner-stats.service'
import type { PrismaService } from '../../src/prisma/prisma.service'
import { TerminalAdminService } from '../../src/terminals/terminals-admin.service'
import { TerminalAgentService } from '../../src/terminals/terminals-agent.service'
import { ReleaseObservationService } from '../../src/terminals/release-observation.service'
import { TerminalCredentialSecurityService } from '../../src/terminals/terminal-credential-security.service'
import { TerminalToolboxService } from '../../src/terminals/terminal-toolbox.service'

type Assert = (label: string, condition: boolean, detail?: string) => void

const MIN = 60_000

export async function verifyTerminalRebindIsolation(assert: Assert, prisma: PrismaService): Promise<void> {
  const suffix = randomUUID().replace(/-/g, '').slice(0, 10)
  const orgA = `org_rebind_a_${suffix}`
  const orgB = `org_rebind_b_${suffix}`
  const terminalId = `t_rebind_${suffix}`
  const queryNow = new Date()
  const end = new Date(new Date(queryNow.getTime() + 8 * 3600000).setUTCHours(0, 0, 0, 0) - 8 * 3600000)
  const ago = (minutes: number) => new Date(end.getTime() - minutes * MIN)
  const boundAAt = ago(120)
  const boundBAt = ago(60)
  const sameOrgAt = ago(30)
  const unbindAt = ago(10)

  const audit = new AuditService(prisma)
  const toolbox = new TerminalToolboxService(prisma)
  const agent = new TerminalAgentService(prisma, audit)
  // 只调用 assignTerminalOrg，不跑 onModuleInit（避免播种打印任务、避免心跳定时器）。
  const admin = new TerminalAdminService(prisma, agent, toolbox, new ReleaseObservationService(prisma, new TerminalCredentialSecurityService(prisma, audit), audit))
  const stats = new PartnerStatsService(prisma)

  async function cleanup(): Promise<void> {
    await prisma.terminalHeartbeat.deleteMany({ where: { terminalId } })
    await prisma.printTask.deleteMany({ where: { terminalId } })
    await prisma.scanTask.deleteMany({ where: { terminalId } })
    await prisma.terminal.deleteMany({ where: { id: terminalId } })
    await prisma.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } })
  }

  try {
    await cleanup()
    await prisma.organization.createMany({
      data: [orgA, orgB].map((id, index) => ({
        id,
        name: `改绑隔离机构${index === 0 ? 'A' : 'B'}`,
        type: 'school_employment_center',
        sceneTemplate: 'school',
        enabled: true,
      })),
    })
    await prisma.terminal.create({
      data: {
        id: terminalId,
        terminalCode: `REBIND-${suffix}`,
        agentToken: `rebind-token-${suffix}`,
        deviceFingerprint: `rebind-fp-${suffix}`,
        displayName: '改绑隔离终端',
        locationLabel: '改绑隔离位置',
        orgId: null,
      },
    })

    await admin.assignTerminalOrg(terminalId, orgA, boundAAt)
    const afterA = await prisma.terminal.findUnique({
      where: { id: terminalId },
      select: { orgId: true, orgBoundAt: true },
    })
    assert(
      'T5a. 绑到 A 时写入 orgBoundAt',
      afterA?.orgId === orgA && afterA.orgBoundAt?.getTime() === boundAAt.getTime(),
      String(afterA?.orgBoundAt?.toISOString()),
    )

    const task = (id: string, createdAt: Date, status: string) => ({
      id: `rebind_${id}_${suffix}`,
      terminalId,
      fileUrl: 'https://example.invalid/f.pdf',
      fileMd5: 'md5',
      createdAt,
      status,
      completedAt: createdAt,
    })
    await prisma.printTask.createMany({
      data: [
        ...[1, 2, 3, 4, 5, 6].map((n) => task(`a${n}`, ago(90), 'completed')),
        task('afail', ago(90), 'failed'),
      ],
    })
    await prisma.terminalHeartbeat.createMany({
      data: [
        { terminalId, printerStatus: 'error', createdAt: ago(100) },
        { terminalId, printerStatus: 'error', createdAt: ago(94) },
      ],
    })

    await admin.assignTerminalOrg(terminalId, orgB, boundBAt)
    const afterB = await prisma.terminal.findUnique({
      where: { id: terminalId },
      select: { orgId: true, orgBoundAt: true },
    })
    assert(
      'T5b. 改绑到 B 时 orgBoundAt 更新为这次绑定的时间',
      afterB?.orgId === orgB && afterB.orgBoundAt?.getTime() === boundBAt.getTime(),
      String(afterB?.orgBoundAt?.toISOString()),
    )

    await prisma.printTask.createMany({
      data: [1, 2, 3, 4, 5, 6].map((n) => task(`b${n}`, ago(20), 'completed')),
    })
    await prisma.scanTask.create({
      data: {
        id: `rebind_scan_${suffix}`,
        terminalId,
        scanType: 'document',
        status: 'completed',
        expiresAt: ago(0),
        createdAt: ago(20),
      },
    })
    await prisma.terminalHeartbeat.create({
      data: { terminalId, printerStatus: 'low_paper', createdAt: ago(2) },
    })

    await prisma.terminalHeartbeat.create({ data: { terminalId, printerStatus: 'low_paper', createdAt: new Date(queryNow.getTime() - 3000) } })
    const a = await stats.getTerminalOperations(orgA as PartnerOrgId, 'week', queryNow)
    const b = await stats.getTerminalOperations(orgB as PartnerOrgId, 'week', queryNow)
    const bRow = b.terminals[0]

    assert(
      'T5c. A 看不到这台终端：只列出当前 orgId 等于本机构的终端，改绑后不返回零值行',
      a.terminals.length === 0
        && a.totals.terminalCount === 0
        && a.totals.output.settled === 0
        && a.totals.serviceCount === 0
        && a.totals.faults.printerFaultCount === 0,
      JSON.stringify({ terminals: a.terminals.length, totals: a.totals }),
    )
    assert(
      'T5d. B 只计入改绑之后的打印：6 单结束且全部出纸；A 时期的 6 单成功和 1 单失败都不计',
      b.terminals.length === 1
        && bRow?.output.settled === 6
        && bRow.output.printed === 6
        && bRow.output.successRate === 100
        && b.totals.output.settled === 6
        && b.totals.output.printed === 6,
      JSON.stringify(bRow?.output),
    )
    assert(
      'T5e. B 的服务次数只有改绑后的 6 个打印任务和 1 个扫描任务；纸张不足不算故障、不算未恢复；A 时期的故障和离线不带过来',
      bRow?.serviceCount === 7
        && b.totals.serviceCount === 7
        && bRow.faults.printerFaultCount === 0
        && bRow.faults.unrecovered === false
        && bRow.faults.offlineCount === 0
        && bRow.faults.reportedInWindow === true
        && bRow.online === true
        && b.totals.faults.printerFaultCount === 0
        && b.totals.unrecoveredTerminals === 0,
      JSON.stringify({ service: bRow?.serviceCount, faults: bRow?.faults, online: bRow?.online }),
    )

    await admin.assignTerminalOrg(terminalId, orgB, sameOrgAt)
    const same = await prisma.terminal.findUnique({
      where: { id: terminalId },
      select: { orgId: true, orgBoundAt: true },
    })
    assert(
      'T5f. orgId 未变的再次绑定不刷新 orgBoundAt',
      same?.orgId === orgB && same.orgBoundAt?.getTime() === boundBAt.getTime(),
      String(same?.orgBoundAt?.toISOString()),
    )

    await admin.assignTerminalOrg(terminalId, null, unbindAt)
    const unbound = await prisma.terminal.findUnique({
      where: { id: terminalId },
      select: { orgId: true, orgBoundAt: true },
    })
    assert(
      'T5g. 解绑后 orgId 与 orgBoundAt 都是 null',
      unbound?.orgId === null && unbound?.orgBoundAt === null,
      JSON.stringify({ orgId: unbound?.orgId, orgBoundAt: unbound?.orgBoundAt?.toISOString() ?? null }),
    )
  } finally {
    await cleanup()
  }
}
