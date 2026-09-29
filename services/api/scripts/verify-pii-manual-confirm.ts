/**
 * verify:pii-manual-confirm —— A-04 隐私检查不完整时的「本人确认」留痕（2026-09-29）
 *
 * 按规格断言（主执行窗口采纳的提案 B + 四个条件）：
 *   [A] 确认接口：只接受 partial / degraded / unsupported_format 三种不完整结论；只许任务请求方本人；
 *       重复确认 200 且时间不变；并发两次只写一次；审计只记任务号、mode、请求方类型、时间（不记文件名与识别文字）。
 *   [B] 建单闸门（开关 PRINT_PII_MANUAL_CONFIRM_ENFORCED，默认关）：开关关时照旧放行；开时不完整且未确认被拒
 *       （400 PRINT_PII_MANUAL_CONFIRM_REQUIRED），确认后放行；同一原件重扫后以最新任务为准、旧确认不继承；
 *       完整扫描不需要确认；AI 生成件（derivationKind=ai_generated）不受影响、格式转换件与原件同样要确认
 *       （1.8 P-1）；非生产（requireCompleted=false）不受影响。
 *   [C] 两处口径一致：确认接口接受的 mode 与建单闸门要求确认的 mode 是同一组。
 */
import 'reflect-metadata'
import 'dotenv/config'
import { randomUUID } from 'crypto'
import { assertIsolatedVerificationDatabase } from './support/isolated-verification-database'
import { RecordingAudit, errorCode } from './support/internal-auth-verify-harness'

assertIsolatedVerificationDatabase()

let failures = 0
let checks = 0
function check(name: string, ok: boolean, detail = ''): void {
  checks += 1
  if (ok) { console.log(`  ✅ ${name}`); return }
  failures += 1
  console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`)
}
async function outcome(op: () => Promise<unknown>): Promise<{ ok: true; value: unknown } | { ok: false; status: number | null; code: string | undefined }> {
  try {
    return { ok: true, value: await op() }
  } catch (error) {
    const status = typeof (error as { getStatus?: () => number }).getStatus === 'function' ? (error as { getStatus: () => number }).getStatus() : null
    return { ok: false, status, code: errorCode(error) }
  }
}
const describe = (r: Awaited<ReturnType<typeof outcome>>) => (r.ok ? '成功' : `失败 ${r.status ?? '-'} ${r.code ?? ''}`)

async function main(): Promise<void> {
  const { PrismaService } = await import('../src/prisma/prisma.service')
  const { MaterialsService } = await import('../src/materials/materials.service')
  const { MaterialsManualConfirmationService, PII_MANUAL_CONFIRMABLE_MODES } = await import('../src/materials/materials-manual-confirmation.service')
  const { assertPiiScanned, PII_SCAN_INCOMPLETE_MODES } = await import('../src/print-jobs/pii-scan-gate')
  const { hashAccessToken } = await import('../src/materials/materials.access')

  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const audit = new RecordingAudit()
  const materials = new MaterialsService(prisma, {} as never, {} as never, {} as never)
  const confirm = new MaterialsManualConfirmationService(prisma, audit as never, materials)
  const suffix = randomUUID().replace(/-/g, '').slice(0, 10)
  const fileIds: string[] = []
  const savedSwitch = process.env['PRINT_PII_MANUAL_CONFIRM_ENFORCED']

  const sha = (n: number) => `${n}`.padStart(64, 'a')
  const makeFile = async (n: number, assetCategory = 'original', derivationKind: string | null = null) => {
    const file = await prisma.fileObject.create({ data: {
      storageKey: `verify-pii-confirm/${suffix}/${n}`, filename: `身份证复印件-${n}.pdf`, mimeType: 'application/pdf',
      sizeBytes: 100, sha256: sha(n), purpose: 'print_doc', assetCategory, derivationKind,
    } })
    fileIds.push(file.id)
    return file
  }
  const makeTask = async (fileId: string, n: number, mode: string, opts: { kind?: string; status?: string; token?: string; ageMs?: number } = {}) => {
    const token = opts.token ?? `tok-${suffix}-${n}-${randomUUID()}`
    const task = await prisma.documentProcessTask.create({ data: {
      kind: opts.kind ?? 'pii_scan', status: opts.status ?? 'completed', requesterMode: 'anonymous',
      accessTokenHash: hashAccessToken(token), sourceFileId: fileId,
      paramsJson: JSON.stringify({ sourceSha256: sha(n) }), resultJson: JSON.stringify({ mode, findingCount: 0 }),
      expiresAt: new Date(Date.now() + 3_600_000), createdAt: new Date(Date.now() - (opts.ageMs ?? 0)),
    } })
    return { task, token, requester: { kind: 'anonymous' as const, accessToken: token } }
  }
  const gate = (fileId: string, requireCompleted = true) => outcome(() => assertPiiScanned({
    prisma, fileId, requireCompleted, missingMessage: '未检查', pendingMessage: '待裁决',
  }))

  try {
    console.log('\n[A] 确认接口')
    const f1 = await makeFile(1)
    const t1 = await makeTask(f1.id, 1, 'degraded')
    const first = await outcome(() => confirm.confirm(t1.task.id, t1.requester))
    const confirmedAt = first.ok ? (first.value as { result?: Record<string, unknown> }).result?.['manualConfirmedAt'] : undefined
    check('扫描降级：本人确认成功，任务结果记下确认时间', first.ok && typeof confirmedAt === 'string', describe(first))
    const second = await outcome(() => confirm.confirm(t1.task.id, t1.requester))
    check('重复确认 200 且确认时间不变（幂等）',
      second.ok && (second.value as { result?: Record<string, unknown> }).result?.['manualConfirmedAt'] === confirmedAt, describe(second))
    const entries = audit.entries.filter((e) => e.action === 'material_task.pii_manual_confirmed' && e.targetId === t1.task.id)
    check('审计只写一条', entries.length === 1, `条数 ${entries.length}`)
    const payload = entries[0]?.payload ?? {}
    check('审计只记元数据（mode、请求方类型、会员号、时间），不记文件名与识别文字；actorId 为空（外键指向运营账号）',
      JSON.stringify(Object.keys(payload).sort()) === JSON.stringify(['confirmedAt', 'endUserId', 'mode', 'requesterKind'])
      && entries[0]?.actorId === null
      && !JSON.stringify(payload).includes('身份证'), JSON.stringify(payload))
    {
      // 审计写不进（事务里抛错）：确认必须失败、库里不留「已确认」——它是隐私检查不完整也放行打印的唯一依据。
      const failingAudit = { write: async () => 'x', writeRequired: async () => { throw new Error('audit store down') } }
      const confirmNoAudit = new MaterialsManualConfirmationService(prisma, failingAudit as never, materials)
      const fx = await makeFile(9)
      const tx9 = await makeTask(fx.id, 9, 'degraded')
      const rejected = await outcome(() => confirmNoAudit.confirm(tx9.task.id, tx9.requester))
      const after = await prisma.documentProcessTask.findUniqueOrThrow({ where: { id: tx9.task.id }, select: { resultJson: true } })
      check('审计写不进：确认失败，库里不留「已确认」（整体回滚）',
        !rejected.ok && !String(after.resultJson).includes('manualConfirmedAt'), `${describe(rejected)} ${after.resultJson}`)
    }
    const intruder = await outcome(() => confirm.confirm(t1.task.id, { kind: 'anonymous', accessToken: 'someone-else' }))
    check('别人的任务令牌不能替本人确认（403）', !intruder.ok && intruder.status === 403, describe(intruder))
    for (const mode of ['partial', 'unsupported_format']) {
      const f = await makeFile(mode === 'partial' ? 2 : 3)
      const t = await makeTask(f.id, mode === 'partial' ? 2 : 3, mode)
      const r = await outcome(() => confirm.confirm(t.task.id, t.requester))
      check(`${mode} 可以本人确认`, r.ok, describe(r))
    }
    const f4 = await makeFile(4)
    const real = await makeTask(f4.id, 4, 'real')
    const notNeeded = await outcome(() => confirm.confirm(real.task.id, real.requester))
    check('完整扫描不需要确认（409 MATERIAL_MANUAL_CONFIRM_NOT_NEEDED）', !notNeeded.ok && notNeeded.code === 'MATERIAL_MANUAL_CONFIRM_NOT_NEEDED', describe(notNeeded))
    const inspection = await makeTask(f4.id, 4, 'degraded', { kind: 'inspection' })
    const wrongKind = await outcome(() => confirm.confirm(inspection.task.id, inspection.requester))
    check('不是隐私检查任务不接受确认（400）', !wrongKind.ok && wrongKind.code === 'MATERIAL_TASK_KIND_INVALID', describe(wrongKind))
    const f5 = await makeFile(5)
    const t5 = await makeTask(f5.id, 5, 'degraded')
    const before = audit.entries.length
    const [c1, c2] = await Promise.all([outcome(() => confirm.confirm(t5.task.id, t5.requester)), outcome(() => confirm.confirm(t5.task.id, t5.requester))])
    const times = [c1, c2].map((r) => (r.ok ? (r.value as { result?: Record<string, unknown> }).result?.['manualConfirmedAt'] : null))
    check('并发两次确认：都成功、时间相同、审计只写一条',
      c1.ok && c2.ok && typeof times[0] === 'string' && times[0] === times[1] && audit.entries.length - before === 1,
      `${describe(c1)} / ${describe(c2)} 审计 +${audit.entries.length - before}`)

    console.log('\n[B] 建单闸门')
    delete process.env['PRINT_PII_MANUAL_CONFIRM_ENFORCED']
    const f6 = await makeFile(6)
    await makeTask(f6.id, 6, 'degraded')
    check('开关默认关：未确认的降级扫描照旧放行（小程序等建单方不被拦死）', (await gate(f6.id)).ok)
    process.env['PRINT_PII_MANUAL_CONFIRM_ENFORCED'] = 'true'
    const blocked = await gate(f6.id)
    check('开关打开：未确认的降级扫描被拒（400 PRINT_PII_MANUAL_CONFIRM_REQUIRED）',
      !blocked.ok && blocked.status === 400 && blocked.code === 'PRINT_PII_MANUAL_CONFIRM_REQUIRED', describe(blocked))
    check('开关打开：确认过的降级扫描放行', (await gate(f1.id)).ok, describe(await gate(f1.id)))
    // 同一原件重扫：新任务更晚、未确认 → 以最新为准，旧确认不继承。
    await makeTask(f1.id, 1, 'degraded', { ageMs: -1_000 })
    const rescan = await gate(f1.id)
    check('同一原件重扫后以最新任务为准，旧确认不继承', !rescan.ok && rescan.code === 'PRINT_PII_MANUAL_CONFIRM_REQUIRED', describe(rescan))
    check('完整扫描不需要确认即放行', (await gate(f4.id)).ok)
    const derived = await makeFile(7, 'derived', 'ai_generated')
    await makeTask(derived.id, 7, 'degraded')
    check('AI 生成件（derivationKind=ai_generated）不受这道闸影响', (await gate(derived.id)).ok)
    // 1.8 P-1：图片 / Office 转 PDF 的内容就是本人材料，与原件走同一条本人确认。
    const converted = await makeFile(8, 'derived', 'format_conversion')
    const t8 = await makeTask(converted.id, 8, 'degraded')
    const convertedBlocked = await gate(converted.id)
    check('格式转换件：未确认的降级扫描同样被拒（400 PRINT_PII_MANUAL_CONFIRM_REQUIRED）',
      !convertedBlocked.ok && convertedBlocked.code === 'PRINT_PII_MANUAL_CONFIRM_REQUIRED', describe(convertedBlocked))
    const convertedConfirm = await outcome(() => confirm.confirm(t8.task.id, t8.requester))
    check('格式转换件：本人确认后放行', convertedConfirm.ok && (await gate(converted.id)).ok, describe(convertedConfirm))
    check('非生产（不强制隐私检查）不受这道闸影响', (await gate(f6.id, false)).ok)

    console.log('\n[C] 口径一致')
    check('确认接口接受的 mode 与建单闸门要求确认的 mode 是同一组',
      JSON.stringify([...PII_MANUAL_CONFIRMABLE_MODES].sort()) === JSON.stringify([...PII_SCAN_INCOMPLETE_MODES].sort()))
  } finally {
    if (savedSwitch === undefined) delete process.env['PRINT_PII_MANUAL_CONFIRM_ENFORCED']
    else process.env['PRINT_PII_MANUAL_CONFIRM_ENFORCED'] = savedSwitch
    await prisma.documentProcessTask.deleteMany({ where: { sourceFileId: { in: fileIds } } })
    await prisma.fileObject.deleteMany({ where: { id: { in: fileIds } } })
    await prisma.onModuleDestroy()
  }
  console.log(`\nverify:pii-manual-confirm：${checks - failures}/${checks} 通过`)
  if (failures > 0) process.exit(1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
