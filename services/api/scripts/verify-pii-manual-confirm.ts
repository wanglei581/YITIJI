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
    // 同一原件重扫：新任务更晚（超出孪生检查的时间窗）、未确认 → 以最新为准，旧确认不继承。
    await makeTask(f1.id, 1, 'degraded', { ageMs: -60_000 })
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

    console.log('\n[D] W-118：同一次进页面并发建出的两条检查，只裁决了一条')
    delete process.env['PRINT_PII_MANUAL_CONFIRM_ENFORCED']
    const finding = (taskId: string, action: string, snippet = '138****0602') => prisma.piiFinding.create({ data: {
      taskId, type: 'phone', label: '手机号', pageNumber: 1, snippet, action,
    } })
    const twinFile = await makeFile(20)
    const twinA = await makeTask(twinFile.id, 20, 'real', { ageMs: 23 })
    const twinB = await makeTask(twinFile.id, 20, 'real')
    const pendingA = await finding(twinA.task.id, 'pending'); await finding(twinB.task.id, 'pending')
    const both = await gate(twinFile.id)
    check('两条都没裁决 → 拒绝（400 PRINT_PII_SCAN_REQUIRED）', !both.ok && both.status === 400 && both.code === 'PRINT_PII_SCAN_REQUIRED', describe(both))
    const raw = await assertPiiScanned({ prisma, fileId: twinFile.id, requireCompleted: true, missingMessage: '未检查', pendingMessage: '待裁决' }).catch((error: { getResponse: () => { error: Record<string, unknown> } }) => error.getResponse().error)
    check('被拒的响应带「回材料检查页」的下一步标识', (raw as Record<string, unknown> | undefined)?.['nextAction'] === 'return_to_material_check', JSON.stringify(raw))
    await prisma.piiFinding.update({ where: { id: pendingA.id }, data: { action: 'keep' } })
    const one = await gate(twinFile.id)
    check('只裁决了较早那条、较晚那条没裁决 → 放行（线上那一半被拒的情形）', one.ok, describe(one))
    // 反过来：裁决的是较晚那条，较早那条没裁决，本来就放行，保持。
    const twinFile2 = await makeFile(21)
    const early = await makeTask(twinFile2.id, 21, 'real', { ageMs: 15 })
    const late = await makeTask(twinFile2.id, 21, 'real')
    await finding(early.task.id, 'pending'); await finding(late.task.id, 'keep')
    check('只裁决了较晚那条 → 放行', (await gate(twinFile2.id)).ok)
    // 换了文件（新的文件对象）必须重新检查：别的文件上裁决过的检查不算数。
    const otherFile = await makeFile(22)
    const swapped = await gate(otherFile.id)
    check('换了文件（新的文件对象，没有自己的检查）→ 拒绝', !swapped.ok && swapped.code === 'PRINT_PII_SCAN_REQUIRED', describe(swapped))
    const otherScan = await makeTask(otherFile.id, 22, 'real'); await finding(otherScan.task.id, 'pending')
    const swappedPending = await gate(otherFile.id)
    check('换了文件且新文件的检查没裁决 → 拒绝，旧文件的裁决不继承', !swappedPending.ok, describe(swappedPending))
    // 不是孪生的三种情形：隔得久的重扫、命中不一样、内容变了。
    const rescanFile = await makeFile(23)
    const old = await makeTask(rescanFile.id, 23, 'real', { ageMs: 60_000 }); await finding(old.task.id, 'keep')
    const again = await makeTask(rescanFile.id, 23, 'real'); await finding(again.task.id, 'pending')
    check('一分钟前裁决过、刚才重扫没裁决 → 拒绝（重扫以最新为准）', !(await gate(rescanFile.id)).ok)
    const diffFile = await makeFile(24)
    const few = await makeTask(diffFile.id, 24, 'real', { ageMs: 20 }); await finding(few.task.id, 'keep')
    const more = await makeTask(diffFile.id, 24, 'real'); await finding(more.task.id, 'keep'); await finding(more.task.id, 'pending', '3702**********1234')
    check('挨着的两条检查命中不一样（晚的多查出一处没裁决）→ 拒绝', !(await gate(diffFile.id)).ok)
    const modeFile = await makeFile(25)
    await makeTask(modeFile.id, 25, 'degraded', { ageMs: 20 })
    const full = await makeTask(modeFile.id, 25, 'real'); await finding(full.task.id, 'pending')
    check('挨着的两条检查覆盖程度不同（早的没查全、晚的查全了没裁决）→ 拒绝', !(await gate(modeFile.id)).ok)
    const staleFile = await makeFile(26)
    const staleTask = await makeTask(staleFile.id, 26, 'real'); await finding(staleTask.task.id, 'keep')
    await prisma.fileObject.update({ where: { id: staleFile.id }, data: { sha256: sha(99) } })
    const stale = await gate(staleFile.id)
    check('检查后文件内容变了 → 409 PII_SCAN_STALE', !stale.ok && stale.status === 409 && stale.code === 'PII_SCAN_STALE', describe(stale))
    // 挨着的两条但内容哈希不同（早的那条是对旧内容做的）：不是孪生，按最晚那条算「还没裁决」。
    const shaFile = await makeFile(31)
    const oldContent = await makeTask(shaFile.id, 30, 'real', { ageMs: 20 }); await finding(oldContent.task.id, 'keep')
    const newContent = await makeTask(shaFile.id, 31, 'real'); await finding(newContent.task.id, 'pending')
    const shaDiff = await gate(shaFile.id)
    check('挨着的两条检查内容哈希不同 → 按最晚那条算没裁决（400 PRINT_PII_SCAN_REQUIRED）', !shaDiff.ok && shaDiff.code === 'PRINT_PII_SCAN_REQUIRED', describe(shaDiff))
    // 本人确认开关打开时同样按孪生算：确认了其中一条即可。
    process.env['PRINT_PII_MANUAL_CONFIRM_ENFORCED'] = 'true'
    const confirmFile = await makeFile(27)
    const c1st = await makeTask(confirmFile.id, 27, 'degraded', { ageMs: 12 })
    await makeTask(confirmFile.id, 27, 'degraded')
    check('孪生的降级检查都没确认 → 拒绝', !(await gate(confirmFile.id)).ok)
    await confirm.confirm(c1st.task.id, c1st.requester)
    check('孪生的降级检查确认了较早那条 → 放行', (await gate(confirmFile.id)).ok, describe(await gate(confirmFile.id)))
    // 挨着的两条、都没有命中，但早的查全了、晚的没查全也没确认：不是孪生，晚的那条仍要本人确认。
    const mixedFile = await makeFile(29)
    await makeTask(mixedFile.id, 29, 'real', { ageMs: 18 })
    await makeTask(mixedFile.id, 29, 'degraded')
    const mixed = await gate(mixedFile.id)
    check('挨着的两条都无命中但覆盖程度不同（晚的没查全、没确认）→ 仍要本人确认', !mixed.ok && mixed.code === 'PRINT_PII_MANUAL_CONFIRM_REQUIRED', describe(mixed))
    delete process.env['PRINT_PII_MANUAL_CONFIRM_ENFORCED']

    console.log('\n[E] W-118：建任务去重')
    const { PII_SCAN_DEDUPE_MS } = await import('../src/materials/materials.service')
    const dedupe = new MaterialsService(prisma, { getObject: async () => Buffer.from('不是 PDF 的内容') } as never, {} as never, {} as never)
    const dedupeFile = await makeFile(28)
    const dto = { kind: 'pii_scan', sourceFileId: dedupeFile.id } as never
    const anon = { kind: 'anonymous' as const }
    const [d1, d2] = await Promise.all([dedupe.createTask(dto, anon), dedupe.createTask(dto, anon)])
    const created = () => prisma.documentProcessTask.count({ where: { sourceFileId: dedupeFile.id, kind: 'pii_scan' } })
    check('同一文件并发两次建隐私检查：只建一条，两次拿到同一个任务和同一个访问口令',
      d1.id === d2.id && !!d1.accessToken && d1.accessToken === d2.accessToken && (await created()) === 1, `${d1.id}/${d2.id} 共 ${await created()} 条`)
    const d3 = await dedupe.createTask(dto, anon)
    check('窗口内再提交一次仍是同一条', d3.id === d1.id && (await created()) === 1)
    const realNow = Date.now
    Date.now = () => realNow() + PII_SCAN_DEDUPE_MS + 1
    try {
      const d4 = await dedupe.createTask(dto, anon)
      check('过了去重窗口再提交是一次新的检查', d4.id !== d1.id && (await created()) === 2)
    } finally { Date.now = realNow }
    // 已经裁决 / 确认过的任务不再复用：之后再提交是重扫，要一条新的、待处理的检查。
    const touchedFile = await makeFile(32)
    const touchedDto = { kind: 'pii_scan', sourceFileId: touchedFile.id } as never
    const firstScan = await dedupe.createTask(touchedDto, anon)
    await confirm.confirm(firstScan.id, { kind: 'anonymous', accessToken: firstScan.accessToken })
    const secondScan = await dedupe.createTask(touchedDto, anon)
    check('窗口内但前一条已被本人确认过：新建一条，不复用', secondScan.id !== firstScan.id, `${firstScan.id}/${secondScan.id}`)
    // 去重按请求方分开：会员请求不能拿到匿名任务（连同它的访问口令）。
    const asMember = await outcome(() => dedupe.createTask(dto, { kind: 'member', endUserId: `verify-pii-member-${suffix}` }))
    check('窗口内换一个请求方：不复用匿名任务，也拿不到它的访问口令',
      !asMember.ok || ((asMember.value as { id: string; accessToken?: string }).id !== d1.id && (asMember.value as { accessToken?: string }).accessToken === undefined), describe(asMember))
    const missing = { kind: 'pii_scan', sourceFileId: `no-such-file-${suffix}` } as never
    const m1 = await outcome(() => dedupe.createTask(missing, anon)); const m2 = await outcome(() => dedupe.createTask(missing, anon))
    check('建任务失败不留在去重表里（两次都如实报错）', !m1.ok && !m2.ok && ![...(dedupe as unknown as { recentPiiScans: Map<string, unknown> }).recentPiiScans.keys()].some((key) => key.includes('no-such-file')))
    const otherKind = await Promise.all([1, 2].map(() => outcome(() => dedupe.createTask({ kind: 'inspection', sourceFileId: dedupeFile.id } as never, anon))))
    check('别的任务种类不走去重', otherKind.every((r) => !r.ok) || (otherKind[0].ok && otherKind[1].ok && (otherKind[0].value as { id: string }).id !== (otherKind[1].value as { id: string }).id))

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
