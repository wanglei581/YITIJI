// 授权门禁按我方云上的默认配置（招聘托管关闭）运行；授权逻辑不读这个开关，显式写出是为了满足托管声明门禁。
process.env.RECRUITMENT_CONTENT_HOSTING_ENABLED = 'false'

/**
 * verify:license（写操作语义）—— 乐观版本、并发、事务内读值、理由与工单号矩阵、含到期日期限、审计与事务同生共死。
 * 真库（SQLite 或 PostgreSQL 都行）、真服务、真 HTTP。这些是审查返工第 4、6、8 条的核心：
 *
 *   W1. 版本：新建 1，更正 / 暂停 / 恢复 / 吊销每次 +1；缺、错、旧版本分别回 400 / 409 LICENSE_VERSION_CONFLICT；被拒的不改版本；
 *       一个字没变的更正不加版本、不审计；续期不动上一条的版本。
 *   W2. 并发：两个更正带同一个版本同时改不同端——恰好一个成功、另一个 409，库里只有赢家的改动，审计只有一条且 before 是真正的改前；
 *       后到的拿新版本重来，期限校验用的是先到者刚写的值（原 bug：锁外读旧值，会拿旧的另一端校验，覆盖或写出倒挂的期限）；
 *       同时暂停两次（双击）恰好一次生效；暂停与更正同时来也只有一个成功。
 *   W3. 事务内审计：审计写失败则整个改动回滚（创建 / 续期 / 更正 / 暂停 / 切换授权方式）。
 *   W4. 理由 2–200 字、工单号 1–64 位字符集：每种写操作一遍矩阵。
 *   W5. 含到期日：到期日当天整天在期内、次日北京 0 点进宽限；只改一端时另一端不动；overview 的 coveredUntilOn。
 *
 * 运行：VERIFICATION_DATABASE_TARGET=isolated pnpm --filter @ai-job-print/api verify:license
 */
import { createLicenseHarness, CREDIT, dateOf, iso } from './support/license-harness'

async function main(): Promise<void> {
  const h = await createLicenseHarness()
  const { c, prisma, audit, createLicense, newOrg, detail } = h
  const auditRows = (action: string, targetId: string) => prisma.auditLog.count({ where: { action, targetId } })
  const lastAudit = async (action: string, targetId: string) =>
    JSON.parse((await prisma.auditLog.findFirstOrThrow({ where: { action, targetId }, orderBy: { createdAt: 'desc' } })).payloadJson) as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
  try {
    h.at(1)
    // ── W1. 版本 ────────────────────────────────────────────────────────────
    console.log('\n[W1] 乐观版本')
    const org1 = await newOrg('w1')
    const lic = await createLicense(org1, { from: 0, to: 30 })
    c.equal('新建 = 第 1 版', await h.versionOfLicense(lic.id), 1)
    const v: number[] = [1]
    const bump = async (label: string, run: () => Promise<{ status: number }>) => {
      const r = await run()
      v.push(await h.versionOfLicense(lic.id))
      c.check(`${label} → 200，版本 +1（现在第 ${v[v.length - 1]} 版）`, r.status === 200 && v[v.length - 1] === v[v.length - 2]! + 1)
    }
    await bump('更正台数', () => h.updateLicense(lic.id, { terminalQuota: 4 }))
    await bump('暂停', () => h.suspendLicense(lic.id))
    await bump('恢复', () => h.resumeLicense(lic.id))
    await bump('再更正备注', () => h.updateLicense(lic.id, { note: '第二次更正' }))
    c.equal('版本序列 1,2,3,4,5', v, [1, 2, 3, 4, 5])
    const before = await h.versionOfLicense(lic.id)
    const auditsBefore = await prisma.auditLog.count({ where: { targetId: lic.id } })
    const stale = await h.updateLicense(lic.id, { terminalQuota: 9 }, { version: 1 })
    c.equal('更正带旧版本 → 409 LICENSE_VERSION_CONFLICT', `${stale.status}:${stale.json.error?.code}`, '409:LICENSE_VERSION_CONFLICT')
    c.check('  文案告诉用户当前是第几版、要刷新后重来', /第 5 版/.test(stale.json.error?.message ?? '') && /刷新/.test(stale.json.error?.message ?? ''), stale.json.error?.message)
    for (const [label, run] of [
      ['暂停', () => h.suspendLicense(lic.id, { version: 1 })], ['吊销', () => h.revokeLicense(lic.id, { version: 3 })],
      ['更正（版本比当前大）', () => h.updateLicense(lic.id, { terminalQuota: 9 }, { version: 99 })],
    ] as const) {
      const r = await run()
      c.equal(`${label}带错版本 → 409 LICENSE_VERSION_CONFLICT`, `${r.status}:${r.json.error?.code}`, '409:LICENSE_VERSION_CONFLICT')
    }
    await h.suspendLicense(lic.id)
    const resumeStale = await h.resumeLicense(lic.id, { version: before })
    c.equal('恢复带旧版本 → 409 LICENSE_VERSION_CONFLICT', `${resumeStale.status}:${resumeStale.json.error?.code}`, '409:LICENSE_VERSION_CONFLICT')
    await h.resumeLicense(lic.id)
    c.check('被拒的操作不改库、不写审计、不加版本（只有那两次成功的暂停 / 恢复）', (await h.versionOfLicense(lic.id)) === before + 2 &&
      (await prisma.auditLog.count({ where: { targetId: lic.id } })) === auditsBefore + 2 && (await prisma.license.findUniqueOrThrow({ where: { id: lic.id } })).terminalQuota === 4)
    for (const [label, over] of [['缺版本', { version: undefined }], ['版本是字符串', { version: '5' }], ['版本是小数', { version: 5.5 }], ['版本是 null', { version: null }]] as const) {
      const r = await h.updateLicense(lic.id, { terminalQuota: 9 }, over)
      c.equal(`更正${label} → 400 VALIDATION_FAILED`, `${r.status}:${r.json.error?.code}`, '400:VALIDATION_FAILED')
    }
    for (const bad of [0, -3]) {
      const r = await h.updateLicense(lic.id, { terminalQuota: 9 }, { version: bad })
      c.equal(`更正版本 ${bad} → 400 LICENSE_VERSION_INVALID`, `${r.status}:${r.json.error?.code}`, '400:LICENSE_VERSION_INVALID')
    }
    const noop = await h.updateLicense(lic.id, { terminalQuota: 4, note: '第二次更正' })
    c.check('一个字没变的更正 → 200，不加版本、不审计', noop.status === 200 && (await h.versionOfLicense(lic.id)) === before + 2 && (await auditRows('license.update', lic.id)) === 2)
    const revokeOk = await h.revokeLicense(lic.id)
    c.check('吊销也 +1', revokeOk.status === 200 && (await h.versionOfLicense(lic.id)) === before + 3)
    const predecessor = await createLicense(await newOrg('w1r'), { from: 0, to: 30 })
    await h.renewLicense(predecessor.id, { to: 60 })
    c.equal('续期不动上一条的版本', await h.versionOfLicense(predecessor.id), 1)
    c.check('库里 version 有 CHECK >= 1（绕过应用直接写 0 被库拒绝）', await (async () => {
      try { await prisma.$executeRawUnsafe(`UPDATE "License" SET "version" = 0 WHERE "id" = '${predecessor.id}'`); return false } catch { return true }
    })())

    // ── W2. 并发 ────────────────────────────────────────────────────────────
    console.log('\n[W2] 并发：后到的不能覆盖先到的')
    const org2 = await newOrg('w2')
    const lic2 = await createLicense(org2, { from: 0, to: 30, terminalQuota: 3 })
    const [a, b] = await Promise.all([
      h.updateLicense(lic2.id, { terminalQuota: 7 }, { version: 1, reason: '甲管理员改台数' }),
      h.updateLicense(lic2.id, { note: '乙管理员改备注' }, { version: 1, reason: '乙管理员改备注' }),
    ])
    const outcomes = [a, b].map((r) => `${r.status}:${r.json.error?.code ?? 'ok'}`).sort()
    c.equal('两个更正带同一个版本同时到：恰好一个成功、另一个 409 LICENSE_VERSION_CONFLICT', outcomes, ['200:ok', '409:LICENSE_VERSION_CONFLICT'])
    const row2 = await prisma.license.findUniqueOrThrow({ where: { id: lic2.id } })
    const changed = [row2.terminalQuota !== 3, row2.note !== null].filter(Boolean).length
    c.check('库里只有赢家的改动（输家的字段没被写进去）', changed === 1 && row2.version === 2, `quota=${row2.terminalQuota} note=${row2.note} version=${row2.version}`)
    c.equal('审计恰好一条，且 before 是真正的改前', [await auditRows('license.update', lic2.id), (await lastAudit('license.update', lic2.id)).version], [1, { before: 1, after: 2 }])
    const winnerQuota = row2.terminalQuota !== 3
    const audit2 = await lastAudit('license.update', lic2.id)
    c.check('  审计里的 before 取自事务内读到的值（台数 3 / 备注空）', winnerQuota ? audit2.before.terminalQuota === 3 && audit2.after.terminalQuota === 7 : audit2.before.note === null && audit2.after.note === '乙管理员改备注')

    // 后到的拿新版本重来：期限校验必须基于先到者刚写的值
    const org3 = await newOrg('w3')
    const lic3 = await createLicense(org3, { from: 0, to: 30 })
    const [e1, e2] = await Promise.all([
      h.updateLicense(lic3.id, { startsOn: dateOf(10) }, { version: 1, reason: '甲改生效日' }),
      h.updateLicense(lic3.id, { endsOn: dateOf(20) }, { version: 1, reason: '乙改到期日' }),
    ])
    c.equal('同时改生效日和到期日：恰好一个成功', [e1, e2].map((r) => r.status).sort(), [200, 409])
    const loserIsEnd = e1.status === 200
    const retry = loserIsEnd
      ? await h.updateLicense(lic3.id, { endsOn: dateOf(20) }, { reason: '乙拿新版本重来' })
      : await h.updateLicense(lic3.id, { startsOn: dateOf(10) }, { reason: '甲拿新版本重来' })
    const row3 = await prisma.license.findUniqueOrThrow({ where: { id: lic3.id } })
    c.check('输家拿新版本重来成功，最终两个改动都在（基于对方刚写的值，没有互相覆盖）', retry.status === 200 && row3.startsAt.toISOString() === iso(10) && row3.endsAt.toISOString() === iso(21) && row3.version === 3,
      `${retry.status} ${row3.startsAt.toISOString()} ${row3.endsAt.toISOString()} v${row3.version}`)
    c.equal('两次成功的更正各一条审计', await auditRows('license.update', lic3.id), 2)

    // 期限校验用事务内的另一端：先把到期日提前，再有人带新版本把生效日挪到新到期日之后——必须被拒，而不是用旧的到期日放行
    const org4 = await newOrg('w4')
    const lic4 = await createLicense(org4, { from: 0, to: 30 })
    await h.updateLicense(lic4.id, { endsOn: dateOf(9) })
    const invert = await h.updateLicense(lic4.id, { startsOn: dateOf(15) })
    c.equal('到期日已被改到 10 号后，把生效日挪到 16 号 → 400 LICENSE_PERIOD_INVALID（用的是刚写入的到期日，不是旧的 30 号）', `${invert.status}:${invert.json.error?.code}`, '400:LICENSE_PERIOD_INVALID')
    const row4 = await prisma.license.findUniqueOrThrow({ where: { id: lic4.id } })
    c.check('  被拒后库里没有倒挂的期限', row4.startsAt.toISOString() === iso(0) && row4.endsAt.toISOString() === iso(10))
    const upd4 = JSON.parse((await prisma.auditLog.findFirstOrThrow({ where: { action: 'license.update', targetId: lic4.id }, orderBy: { createdAt: 'desc' } })).payloadJson) as { before: Record<string, unknown>; after: Record<string, unknown> }
    c.check('  更正审计的 before / after 带 endsAt 与含当天的 endsOn', upd4.before['endsOn'] === dateOf(29) && upd4.after['endsOn'] === dateOf(9) && upd4.before['endsAt'] === iso(30) && upd4.after['endsAt'] === iso(10))

    // 双击：同时暂停两次
    const org5 = await newOrg('w5')
    const lic5 = await createLicense(org5, { from: 0, to: 30 })
    const dbl = await Promise.all([h.suspendLicense(lic5.id, { version: 1 }), h.suspendLicense(lic5.id, { version: 1 })])
    c.equal('同时暂停两次（双击）：恰好一次生效，另一次 409', dbl.map((r) => `${r.status}:${r.json.error?.code ?? 'ok'}`).sort(), ['200:ok', '409:LICENSE_VERSION_CONFLICT'])
    c.equal('  审计恰好一条 license.suspend', await auditRows('license.suspend', lic5.id), 1)
    // 暂停与更正同时来
    const mix = await Promise.all([h.resumeLicense(lic5.id, { version: 2 }), h.updateLicense(lic5.id, { terminalQuota: 9 }, { version: 2 })])
    c.equal('恢复与更正带同一版本同时到：恰好一个成功', mix.map((r) => r.status).sort(), [200, 409])
    // 吊销与更正同时来：吊销赢则更正拿到 LICENSE_REVOKED 或版本冲突，绝不会改到已吊销的授权
    const org6 = await newOrg('w6')
    const lic6 = await createLicense(org6, { from: 0, to: 30, terminalQuota: 3 })
    const race = await Promise.all([h.revokeLicense(lic6.id, { version: 1 }), h.updateLicense(lic6.id, { terminalQuota: 8 }, { version: 1 })])
    const row6 = await prisma.license.findUniqueOrThrow({ where: { id: lic6.id } })
    c.check('吊销与更正同时来：不会出现「已吊销却被改了台数」', race.filter((r) => r.status === 200).length === 1 && (row6.status === 'revoked' ? row6.terminalQuota === 3 : row6.terminalQuota === 8))

    // 同一条授权同时续期两次、同一时段同时新建两条：机构行锁把它们排成队，后到的看到先到的，恰好一个成功
    const org13 = await newOrg('w13')
    const base13 = await createLicense(org13, { from: 0, to: 30 })
    const renewRace = await Promise.all([h.renewLicense(base13.id, { to: 60 }), h.renewLicense(base13.id, { to: 60 })])
    c.equal('同一条授权同时续期两次（双击）：恰好一次成功，另一次 409 LICENSE_PERIOD_OVERLAP', renewRace.map((r) => `${r.status}:${r.json.error?.code ?? 'ok'}`).sort(), ['201:ok', '409:LICENSE_PERIOD_OVERLAP'])
    c.equal('  库里只多了一条后续授权', (await detail(org13)).items.length, 2)
    const org14 = await newOrg('w14')
    const createRace = await Promise.all([createLicense(org14, { from: 0, to: 30 }), createLicense(org14, { from: 10, to: 40 })])
    c.equal('同一机构同时新建两条重叠的授权：恰好一条成功', createRace.map((r) => `${r.status}:${r.error ?? 'ok'}`).sort(), ['201:ok', '409:LICENSE_PERIOD_OVERLAP'])
    c.equal('  库里没有重叠的两条', (await detail(org14)).items.length, 1)

    // ── W3. 审计与改动同生共死 ───────────────────────────────────────────────
    console.log('\n[W3] 事务内审计：审计写失败则整个改动回滚')
    const org7 = await newOrg('w7')
    const lic7 = await createLicense(org7, { from: 0, to: 30, terminalQuota: 3 })
    const realWrite = audit.writeRequired.bind(audit)
    const broken = async (): Promise<never> => { throw new Error('audit down') }
    const withBrokenAudit = async <T>(work: () => Promise<T>): Promise<T> => {
      ;(audit as unknown as { writeRequired: unknown }).writeRequired = broken
      try { return await work() } finally { ;(audit as unknown as { writeRequired: unknown }).writeRequired = realWrite }
    }
    const items7 = async () => (await detail(org7)).items.length as number
    const state7 = async () => { const r = await prisma.license.findUniqueOrThrow({ where: { id: lic7.id } }); return `${r.status}/${r.terminalQuota}/${r.version}` }
    const base7 = await state7()
    const failedUpdate = await withBrokenAudit(() => h.updateLicense(lic7.id, { terminalQuota: 9 }))
    c.check('更正：审计写失败 → 500，台数与版本都没变', failedUpdate.status === 500 && (await state7()) === base7)
    const failedSuspend = await withBrokenAudit(() => h.suspendLicense(lic7.id))
    c.check('暂停：审计写失败 → 500，状态与版本都没变', failedSuspend.status === 500 && (await state7()) === base7)
    const before7 = await items7()
    const failedCreate = await withBrokenAudit(() => createLicense(org7, { from: 40, to: 50 }))
    c.check('新建：审计写失败 → 500，没有留下授权', failedCreate.status === 500 && (await items7()) === before7)
    const failedRenew = await withBrokenAudit(() => h.renewLicense(lic7.id, { to: 60 }))
    c.check('续期：审计写失败 → 500，没有留下授权', failedRenew.status === 500 && (await items7()) === before7)
    const failedMode = await withBrokenAudit(() => h.setMode(org7, 'required', { confirmLockout: true }))
    c.check('切换授权方式：审计写失败 → 500，仍是 none', failedMode.status === 500 && (await detail(org7)).licenseMode === 'none')
    c.check('正向对照：审计恢复后同样的操作都成功', (await h.updateLicense(lic7.id, { terminalQuota: 9 })).status === 200 && (await h.setMode(org7, 'required')).status === 200)

    // ── W4. 理由与工单号矩阵 ─────────────────────────────────────────────────
    console.log('\n[W4] 理由 2–200 字、工单号 1–64 位字符集：每种写操作一遍')
    const fresh = async (key: string) => {
      const orgId = await newOrg(`w8${key}`)
      const l = await createLicense(orgId, { from: 0, to: 30 })
      return { orgId, id: l.id }
    }
    const control = String.fromCharCode(7)
    const zeroWidth = String.fromCharCode(0x200b)
    const badReasons: Array<[string, string]> = [
      ['空', ''], ['全是空白', '   '], ['去空白后 1 个字', ' 好 '], ['1 个字', '好'], ['含控制字符', `${control}好好`],
      ['含零宽字符', `好${zeroWidth}好`], ['201 个字', '好'.repeat(201)],
    ]
    const goodReasons: Array<[string, string]> = [['恰好 2 个字', '好的'], ['恰好 200 个字', '好'.repeat(200)], ['两端有空白、去掉后 2 个字', '  好的  ']]
    const reasonOps: Array<[string, (reason: string, k: string) => Promise<{ status: number; json: { error?: { code?: string } } }>]> = [
      ['更正', async (reason, k) => { const f = await fresh(`u${k}`); return h.updateLicense(f.id, { note: `n${k}` }, { reason }) }],
      ['暂停', async (reason, k) => { const f = await fresh(`s${k}`); return h.suspendLicense(f.id, { reason }) }],
      ['恢复', async (reason, k) => { const f = await fresh(`r${k}`); await h.suspendLicense(f.id); return h.resumeLicense(f.id, { reason }) }],
      ['吊销', async (reason, k) => { const f = await fresh(`v${k}`); return h.revokeLicense(f.id, { reason }) }],
      ['切换授权方式', async (reason, k) => { const f = await fresh(`m${k}`); return h.setMode(f.orgId, 'required', { reason }) }],
    ]
    for (const [op, run] of reasonOps) {
      let n = 0
      for (const [label, reason] of badReasons) {
        n += 1
        const r = await run(reason, `b${n}`)
        // 空串在 DTO 里是合法字符串，由业务校验拒；以上都应是 400 LICENSE_REASON_INVALID
        c.equal(`${op}理由${label} → 400 LICENSE_REASON_INVALID`, `${r.status}:${r.json.error?.code}`, '400:LICENSE_REASON_INVALID')
      }
      for (const [label, reason] of goodReasons) {
        n += 1
        const r = await run(reason, `g${n}`)
        c.check(`${op}理由${label} → 通过`, r.status === 200, `${r.status} ${r.json.error?.code ?? ''}`)
      }
    }
    const badTickets: Array<[string, string]> = [['空', ''], ['全是空白', '   '], ['含中文', '工单1'], ['含空格', 'WO 1'], ['含 #', 'WO#1'], ['含点号', 'WO.1'], ['含制表符', 'WO\t1'], ['65 位', 'A'.repeat(65)]]
    const goodTickets: Array<[string, string, string]> = [['字母数字横线', 'WO-1', 'WO-1'], ['斜杠与下划线', 'a/b_c-9', 'a/b_c-9'], ['恰好 64 位', 'A'.repeat(64), 'A'.repeat(64)], ['两端空白会去掉', '  WO-2  ', 'WO-2']]
    for (const [op, run] of [
      ['暂停', async (ticket: string, k: string) => { const f = await fresh(`ts${k}`); return { f, r: await h.suspendLicense(f.id, { approvalTicketNo: ticket }) } }],
      ['吊销', async (ticket: string, k: string) => { const f = await fresh(`tv${k}`); return { f, r: await h.revokeLicense(f.id, { approvalTicketNo: ticket }) } }],
    ] as const) {
      let n = 0
      for (const [label, ticket] of badTickets) {
        n += 1
        const { r } = await run(ticket, `b${n}`)
        c.equal(`${op}工单号${label} → 400 LICENSE_TICKET_INVALID`, `${r.status}:${r.json.error?.code}`, '400:LICENSE_TICKET_INVALID')
      }
      for (const [label, ticket, stored] of goodTickets) {
        n += 1
        const { f, r } = await run(ticket, `g${n}`)
        const row = await prisma.license.findUniqueOrThrow({ where: { id: f.id } })
        c.check(`${op}工单号${label} → 通过，库里存 ${stored.length > 20 ? stored.slice(0, 8) + '…' : stored}`, r.status === 200 && row.statusTicketNo === stored, `${r.status} ${row.statusTicketNo}`)
      }
    }

    // ── W5. 含到期日 ────────────────────────────────────────────────────────
    console.log('\n[W5] 含到期日、只改一端、覆盖到哪一天')
    const org9 = await newOrg('w9', 'required')
    const lic9 = await createLicense(org9, { from: 0, to: 30, graceDays: 7 })
    const stateAt = async (ms: number) => { h.atMs(ms); const d = await detail(org9); return `${d.state}/${d.items[0].phase}` }
    const T0 = Date.parse(iso(0))
    const DAY = 24 * 60 * 60 * 1000
    c.equal('到期日（最后一天）中午 → ok / active', await stateAt(T0 + 29.5 * DAY), 'ok/active')
    c.equal('到期日 23:59:59.999（北京）→ 仍 ok / active', await stateAt(T0 + 30 * DAY - 1), 'ok/active')
    c.equal('到期日次日 0 点整（北京）→ grace / grace', await stateAt(T0 + 30 * DAY), 'grace/grace')
    c.equal('宽限最后一天 23:59:59.999 → 仍 grace', await stateAt(T0 + 37 * DAY - 1), 'grace/grace')
    c.equal('宽限最后一天的次日 0 点 → expired / expired', await stateAt(T0 + 37 * DAY), 'expired/expired')
    h.at(1)
    const org10 = await newOrg('w10')
    const lic10 = await createLicense(org10, { from: 0, to: 30 })
    await h.updateLicense(lic10.id, { endsOn: dateOf(39) })
    let row10 = await prisma.license.findUniqueOrThrow({ where: { id: lic10.id } })
    c.equal('只改到期日：生效时刻不动，到期 = 新到期日次日北京 0 点', [row10.startsAt.toISOString(), row10.endsAt.toISOString()], [iso(0), iso(40)])
    await h.updateLicense(lic10.id, { startsOn: dateOf(2) })
    row10 = await prisma.license.findUniqueOrThrow({ where: { id: lic10.id } })
    c.equal('只改生效日：到期时刻不动', [row10.startsAt.toISOString(), row10.endsAt.toISOString()], [iso(2), iso(40)])
    const v10 = await h.versionOfLicense(lic10.id)
    const same = await h.updateLicense(lic10.id, { startsOn: dateOf(2), endsOn: dateOf(39) })
    c.check('把两端改成现有的值：不算变化，不加版本', same.status === 200 && (await h.versionOfLicense(lic10.id)) === v10)
    const both = await h.updateLicense(lic10.id, { startsOn: dateOf(1), endsOn: dateOf(19) })
    c.check('两端一起改', both.status === 200 && both.json.data.org.current.periodText === `${dateOf(1)} 至 ${dateOf(19)}（北京时间，含当天）`)
    const chainOrg = await newOrg('w11', 'required')
    await createLicense(chainOrg, { from: 0, to: 30 })
    await createLicense(chainOrg, { from: 30, to: 60 })
    const chain = await detail(chainOrg)
    c.equal('首尾相接的两条：连续覆盖到最后一条的到期日（含当天）', [chain.state, chain.coveredUntil, chain.coveredUntilOn], ['ok', iso(60), dateOf(59)])
    const grace0 = await createLicense(await newOrg('w12'), { from: 0, to: 30, graceDays: 0 })
    c.equal('没有宽限（graceDays 0）时 graceEndsOn 为 null', grace0.org.items[0].graceEndsOn, null)
    c.equal('GET 单条授权的 version / startsOn / endsOn 与列表一致', (await h.api('GET', `/admin/licenses/${grace0.id}`)).json.data.endsOn, dateOf(29))
    c.check('机构概览不再多出旧字段', !('coveredUntilDate' in chain) && 'coveredUntilOn' in chain && CREDIT.length === 18)
  } finally {
    await h.close()
  }
  c.finish('verify:license（写操作语义）')
}

void main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
