import { shanghaiDayKey, shanghaiDayStart } from '../src/console-screen/console-screen.metric'
import { assertServiceContractSetup } from './console-screen-snapshot-cases-09'
import { carryContext } from './console-screen-snapshot-cases-18'



export async function assertServiceContractPhase1(context: Awaited<ReturnType<typeof assertServiceContractSetup>>) {
const { prisma, suffix, orgA, orgB, srcA, srcB, termA, termB, userA, userB, adminId, memberId, taskA, taskHist1, taskHist2, taskHist3, taskRecovered, userBlank, resumeFileName, cleanup } = context
await cleanup()
const now = new Date()
await prisma.organization.createMany({
      data: [
        { id: orgA, name: '大屏机构A', type: 'school_employment_center', sceneTemplate: 'school', enabled: true },
        { id: orgB, name: '大屏机构B', type: 'school_employment_center', sceneTemplate: 'school', enabled: true },
      ],
    })
await prisma.jobSource.createMany({
      data: [
        { id: srcA, orgId: orgA, name: 'A源', sourceKind: 'manual', accessMode: 'manual', enabled: true },
        { id: srcB, orgId: orgB, name: 'B源', sourceKind: 'manual', accessMode: 'manual', enabled: true },
      ],
    })
await prisma.user.createMany({
      data: [
        { id: adminId, username: `scrn_admin_${suffix}`, name: 'scrn admin', passwordHash: 'hash', role: 'admin', enabled: true, tokenVersion: 0 },
        { id: userA, username: `scrn_pa_${suffix}`, name: 'scrn partner a', passwordHash: 'hash', role: 'partner', orgId: orgA, enabled: true, tokenVersion: 0 },
        { id: userB, username: `scrn_pb_${suffix}`, name: 'scrn partner b', passwordHash: 'hash', role: 'partner', orgId: orgB, enabled: true, tokenVersion: 0 },
        { id: userBlank, username: `scrn_nb_${suffix}`, name: 'scrn partner blank', passwordHash: 'hash', role: 'partner', orgId: null, enabled: true, tokenVersion: 0 },
      ],
    })
const phoneEnc = `penc_${suffix}`
const pickupCode = `pck_${suffix}`
await prisma.endUser.create({
      data: { id: memberId, phoneHash: `ph_${suffix}`, phoneEnc },
    })
await prisma.terminal.createMany({
      data: [
        { id: termA, terminalCode: `SCRN-A-${suffix}`, agentToken: `tok_a_${suffix}`, deviceFingerprint: `fp_a_${suffix}`, orgId: orgA, enabled: true, displayName: '天河一体机', areaLabel: '天河区', locationLabel: '体育中心', geoLat: 23.125, geoLng: 113.5 },
        { id: termB, terminalCode: `SCRN-B-${suffix}`, agentToken: `tok_b_${suffix}`, deviceFingerprint: `fp_b_${suffix}`, orgId: orgB, enabled: true },
      ],
    })
await prisma.terminalHeartbeat.createMany({
      data: [
        { terminalId: termA, status: 'online', createdAt: now },
        { terminalId: termB, status: 'online', printerStatus: 'paper_empty', createdAt: now },
      ],
    })
await prisma.job.createMany({
      data: [
        { sourceOrgId: orgA, sourceId: srcA, externalId: `a1-${suffix}`, sourceName: 'A源', sourceUrl: 'https://example.com/a1', title: 'A岗1', company: 'A公司', city: '青岛', reviewStatus: 'approved', publishStatus: 'published' },
        { sourceOrgId: orgA, sourceId: srcA, externalId: `a2-${suffix}`, sourceName: 'A源', sourceUrl: 'https://example.com/a2', title: 'A岗2', company: 'A公司', city: '青岛', reviewStatus: 'pending', publishStatus: 'draft' },
        { sourceOrgId: orgB, sourceId: srcB, externalId: `b1-${suffix}`, sourceName: 'B源', sourceUrl: 'https://example.com/b1', title: 'B岗1', company: 'B公司', city: '青岛', reviewStatus: 'approved', publishStatus: 'published' },
        { sourceOrgId: orgB, sourceId: srcB, externalId: `b2-${suffix}`, sourceName: 'B源', sourceUrl: 'https://example.com/b2', title: 'B岗2', company: 'B公司', city: '青岛', reviewStatus: 'approved', publishStatus: 'published' },
      ],
    })
await prisma.syncLog.createMany({
      data: [
        { sourceId: srcA, orgId: orgA, dataType: 'job', syncMode: 'manual', result: 'success', addedCount: 1, createdAt: now },
        { sourceId: srcB, orgId: orgB, dataType: 'job', syncMode: 'manual', result: 'success', addedCount: 99, createdAt: now },
        { sourceId: srcB, orgId: orgB, dataType: 'job', syncMode: 'manual', result: 'failed', addedCount: 0, createdAt: now },
      ],
    })
const yesterdayInstant = new Date(shanghaiDayStart(now).getTime() - 60_000)
const todayKey = shanghaiDayKey(now)
const yesterdayKey = shanghaiDayKey(yesterdayInstant)
const taskStarted = new Date(now.getTime() - 5 * 60_000)
await prisma.printTask.create({
      data: {
        id: taskA,
        terminalId: termA,
        endUserId: memberId,
        fileUrl: 'https://internal/secret',
        fileMd5: 'md5',
        paramsJson: JSON.stringify({ fileName: resumeFileName, billablePages: 6, colorMode: 'black_white', copies: 2 }),
        status: 'printing',
        claimedAt: taskStarted,
        createdAt: taskStarted,
      },
    })
await prisma.printTask.createMany({
      data: [
        { id: taskHist1, terminalId: termA, fileUrl: 'https://internal/hist1', fileMd5: 'md5h1', paramsJson: '{}', status: 'failed', createdAt: yesterdayInstant },
        { id: taskHist2, terminalId: termA, fileUrl: 'https://internal/hist2', fileMd5: 'md5h2', paramsJson: '{}', status: 'failed', createdAt: yesterdayInstant },
        { id: taskHist3, terminalId: termA, fileUrl: 'https://internal/hist3', fileMd5: 'md5h3', paramsJson: '{}', status: 'failed', createdAt: yesterdayInstant },
        { id: taskRecovered, terminalId: termA, fileUrl: 'https://internal/ok', fileMd5: 'md5ok', paramsJson: '{}', status: 'completed', createdAt: now },
      ],
    })
await prisma.printTaskStatusLog.createMany({
      data: [
        { taskId: taskHist1, fromStatus: 'printing', toStatus: 'failed', createdAt: yesterdayInstant },
        { taskId: taskHist2, fromStatus: 'printing', toStatus: 'failed', createdAt: yesterdayInstant },
        { taskId: taskHist3, fromStatus: 'printing', toStatus: 'failed', createdAt: yesterdayInstant },
        { taskId: taskRecovered, fromStatus: 'printing', toStatus: 'failed', createdAt: now },
      ],
    })
const paidSeed = await prisma.order.create({
      data: {
        orderNo: `SCRN-${suffix}`,
        type: 'print',
        terminalId: termA,
        amountCents: 50,
        billablePages: 3,
        payStatus: 'paid',
        taskStatus: 'printing',
        paidAt: now,
        pickupCode,
        printParamsJson: JSON.stringify({ copies: 9 }),
      },
    })
await prisma.orderItem.create({
      data: {
        orderId: paidSeed.id,
        seq: 1,
        fileId: `file_scrn_${suffix}`,
        colorMode: 'bw',
        duplex: 'one_sided',
        copies: 9,
        billablePages: 3,
        amountCents: 50,
      },
    })
return carryContext(context, { now, phoneEnc, pickupCode, yesterdayInstant, todayKey, yesterdayKey, taskStarted, paidSeed })
}
