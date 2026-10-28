// 授权门禁按我方云上的默认配置（招聘托管关闭）运行；授权逻辑不读这个开关，显式写出是为了满足托管声明门禁。
process.env.RECRUITMENT_CONTENT_HOSTING_ENABLED = 'false'

/**
 * verify:license（中）—— 授权管理后端的真行为之一：管理员接口。真库（SQLite 或 PostgreSQL 都行）、真服务、真 HTTP。
 * 状态推导、契约、路由表扫描在 verify-license-state.ts；版本 / 并发 / 理由矩阵 / 日期边界 / 审计在 verify-license-writes.ts；
 * 会话 / 绑定 / 机构写操作 / 只读视图 / 告警在 verify-license-runtime.ts。本文件管：
 *
 *   A. 管理员接口：增改、校验（信用代码 18 位 + 校验位 / 合同编号必填 / 日期真实存在且含当天 / 宽限 0–30 / 台数 1–10000）、
 *      期限不重叠、回执里的 startsOn / endsOn / periodText / graceEndsOn / version、审计。
 *   I. 暂停 / 恢复 / 吊销 / 更正 / 续期：理由与工单号、二次状态冲突被挡、吊销不可恢复、续期默认接上一条到期日次日、全部审计。
 *   B. 授权方式：none 默认不管控；切到 required 且会锁住终端时必须二次确认；切换（含切回 none）必填理由。
 *
 * 运行：VERIFICATION_DATABASE_TARGET=isolated pnpm --filter @ai-job-print/api verify:license
 */
import { createLicenseHarness, CREDIT, CREDIT_B, dateOf, iso } from './support/license-harness'

async function main(): Promise<void> {
  const h = await createLicenseHarness()
  const { c, prisma, api, detail, createLicense, newOrg, newTerminal, newUser, adminId } = h
  try {
    // ── A. 管理员接口、校验、期限不重叠、审计 ───────────────────────────────
    console.log('\n[A] 管理员接口')
    const orgA = await newOrg('a')
    const base = await api('GET', `/admin/orgs/${orgA}/licenses`)
    c.check('新机构默认 none：不管控、状态 ok、没有授权', base.status === 200 && base.json.data.licenseMode === 'none' && base.json.data.managed === false &&
      base.json.data.state === 'ok' && base.json.data.items.length === 0)
    const partnerOfA = await newUser('pa', 'partner', orgA)
    for (const [method, path, body] of [
      ['GET', `/admin/orgs/${orgA}/licenses`, undefined], ['POST', `/admin/orgs/${orgA}/licenses`, {}], ['GET', '/admin/licenses/attention', undefined],
      ['PUT', `/admin/orgs/${orgA}/license-mode`, { licenseMode: 'required', reason: '无权限的尝试' }], ['POST', '/admin/licenses/x/suspend', { version: 1, reason: '十个字的理由说明', approvalTicketNo: 'WO-1' }],
    ] as const) {
      c.check(`非管理员 403：${method} ${path}`, (await api(method, path, body, partnerOfA)).status === 403)
    }
    c.check('不带令牌 401', (await h.call('GET', `/api/v1/admin/orgs/${orgA}/licenses`)).status === 401)
    c.equal('机构不存在 → 404 ORG_NOT_FOUND', (await api('GET', '/admin/orgs/no-such-org/licenses')).json.error?.code, 'ORG_NOT_FOUND')
    const valid = { licenseeName: '青岛某某人力资源有限公司', creditCode: CREDIT, contractNo: 'HT-2026-001', startsOn: dateOf(0), endsOn: dateOf(29), terminalQuota: 3 }
    const badCases: Array<[string, Record<string, unknown>, string]> = [
      ['信用代码少一位', { creditCode: '91330100799655058' }, 'LICENSE_CREDIT_CODE_INVALID'],
      ['信用代码校验位不对', { creditCode: '91330100799655058C' }, 'LICENSE_CREDIT_CODE_INVALID'],
      ['信用代码含禁用字母 O', { creditCode: '91330100799655O58B' }, 'LICENSE_CREDIT_CODE_INVALID'],
      ['合同编号为空白', { contractNo: '   ' }, 'LICENSE_CONTRACT_NO_INVALID'],
      ['合同编号 65 位', { contractNo: 'H'.repeat(65) }, 'LICENSE_CONTRACT_NO_INVALID'],
      ['被授权企业名称太短', { licenseeName: '甲' }, 'LICENSE_LICENSEE_INVALID'],
      ['生效日带了时间和时区', { startsOn: '2026-11-01T00:00:00+08:00' }, 'LICENSE_PERIOD_INVALID'],
      ['生效日不是真实日期（2 月 30 日）', { startsOn: '2027-02-30' }, 'LICENSE_PERIOD_INVALID'],
      ['到期日格式不对（斜杠）', { endsOn: '2027/10/31' }, 'LICENSE_PERIOD_INVALID'],
      ['到期日早于生效日', { endsOn: dateOf(-1) }, 'LICENSE_PERIOD_INVALID'],
      ['期限超过 10 年', { endsOn: '2037-12-31' }, 'LICENSE_PERIOD_INVALID'],
      ['宽限 31 天', { graceDays: 31 }, 'LICENSE_GRACE_INVALID'],
      ['宽限 -1 天', { graceDays: -1 }, 'LICENSE_GRACE_INVALID'],
      ['台数 0', { terminalQuota: 0 }, 'LICENSE_QUOTA_INVALID'],
      ['台数 10001', { terminalQuota: 10001 }, 'LICENSE_QUOTA_INVALID'],
      ['备注超 500 字', { note: '备'.repeat(501) }, 'LICENSE_NOTE_INVALID'],
    ]
    for (const [label, over, code] of badCases) {
      const r = await api('POST', `/admin/orgs/${orgA}/licenses`, { ...valid, ...over })
      c.equal(`新建被拒：${label}`, `${r.status}:${r.json.error?.code}`, `400:${code}`)
    }
    for (const [label, body] of [
      ['缺合同编号字段', { ...valid, contractNo: undefined }], ['缺信用代码字段', { ...valid, creditCode: undefined }], ['缺被授权企业字段', { ...valid, licenseeName: undefined }],
      ['多余字段（岗位数）', { ...valid, jobCount: 10 }], ['台数是字符串', { ...valid, terminalQuota: '3' }],
      ['旧字段 startsAt / endsAt 不再收', { ...valid, startsOn: undefined, endsOn: undefined, startsAt: iso(0), endsAt: iso(30) }],
      ['旧字段混着发也拒（多余字段）', { ...valid, startsAt: iso(0) }],
    ] as const) {
      const r = await api('POST', `/admin/orgs/${orgA}/licenses`, body)
      c.equal(`新建被拒：${label}`, `${r.status}:${r.json.error?.code}`, '400:VALIDATION_FAILED')
    }
    c.equal('机构不存在时新建 → 404', (await api('POST', '/admin/orgs/no-such-org/licenses', valid)).status, 404)
    c.check('被拒的新建没有写库', (await detail(orgA)).items.length === 0)

    h.at(1)
    const created = await api('POST', `/admin/orgs/${orgA}/licenses`, { ...valid, creditCode: ' 91330100799655058b ', note: ' 首期合同 ' })
    const lic1 = created.json.data?.org?.items?.[0]
    c.check('新建 → 201，返回被改动的编号 + 刷新后的整节', created.status === 201 && created.json.data.licenseId === lic1?.id && created.json.data.org.orgId === orgA)
    c.check('信用代码转大写、备注去空白、宽限默认 7 天、状态 active、阶段 active、版本从 1 起',
      lic1.creditCode === CREDIT && lic1.note === '首期合同' && lic1.graceDays === 7 && lic1.status === 'active' && lic1.phase === 'active' && lic1.version === 1)
    c.equal('存库：生效日当天北京 0 点、到期日次日北京 0 点（不含）', [lic1.startsAt, lic1.endsAt], [iso(0), iso(30)])
    c.equal('回执带含当天的日期与可直接显示的期限文字', [lic1.startsOn, lic1.endsOn, lic1.periodText],
      [dateOf(0), dateOf(29), `${dateOf(0)} 至 ${dateOf(29)}（北京时间，含当天）`])
    c.equal('宽限：graceEndsAt = 到期 + 7 天（不含），graceEndsOn = 宽限最后一天（含当天）', [lic1.graceEndsAt, lic1.graceEndsOn], [iso(37), dateOf(36)])
    c.check('createdBy 记操作者', lic1.createdBy === adminId)
    c.check('新建写审计 license.create（含授权快照：合同编号 + 信用代码 + 含当天的日期，与机构状态前后）', await (async () => {
      const row = await prisma.auditLog.findFirst({ where: { action: 'license.create', targetId: lic1.id } })
      const payload = row ? (JSON.parse(row.payloadJson) as { license: { contractNo: string; creditCode: string; startsOn: string; endsOn: string }; orgState: { before: unknown; after: unknown } }) : null
      return !!row && row.actorId === adminId && payload?.license.contractNo === 'HT-2026-001' && payload.license.creditCode === CREDIT &&
        payload.license.startsOn === dateOf(0) && payload.license.endsOn === dateOf(29) && !!payload.orgState
    })())
    const overlap = await createLicense(orgA, { from: 10, to: 40 })
    c.equal('期限重叠 → 409 LICENSE_PERIOD_OVERLAP', `${overlap.status}:${overlap.error}`, '409:LICENSE_PERIOD_OVERLAP')
    c.check('  重叠文案点名冲突的合同，并用 periodText 的写法给出它的期限', (overlap.message ?? '').includes('HT-2026-001') && (overlap.message ?? '').includes(`${dateOf(0)} 至 ${dateOf(29)}（北京时间，含当天）`), overlap.message)
    const adjacent = await createLicense(orgA, { from: 30, to: 60, contractNo: 'HT-2026-002' })
    c.check('首尾相接可以新建（提前录入未来生效的）', adjacent.status === 201 && adjacent.org.items.find((i: { id: string }) => i.id === adjacent.id).phase === 'pending')
    const orgAfter = await detail(orgA)
    c.check('历史新的在前、认定当前那条、待生效的是 upcoming（带含当天的日期）', orgAfter.items[0].id === adjacent.id && orgAfter.upcoming?.id === adjacent.id && orgAfter.current?.id === lic1.id &&
      orgAfter.upcoming.startsOn === dateOf(30) && orgAfter.upcoming.endsOn === dateOf(59))
    c.check('授权方式仍是 none：不管控，状态 ok，不影响任何终端', orgAfter.licenseMode === 'none' && orgAfter.managed === false && orgAfter.usable === true)
    const one = (await api('GET', `/admin/licenses/${lic1.id}`)).json.data
    c.equal('GET 单条授权带版本与期限文字', [one.version, one.periodText], [1, lic1.periodText])

    // ── I. 状态变更：理由、工单号、冲突、吊销不可恢复、审计 ───────────────────
    console.log('\n[I] 暂停 / 恢复 / 吊销 / 更正 / 续期')
    c.equal('暂停不带任何字段 → 400', (await api('POST', `/admin/licenses/${adjacent.id}/suspend`, {})).status, 400)
    c.equal('暂停理由只有 1 个字 → 400 LICENSE_REASON_INVALID', (await h.suspendLicense(adjacent.id, { reason: '停' })).json.error?.code, 'LICENSE_REASON_INVALID')
    c.equal('暂停不带工单号字段 → 400', (await h.suspendLicense(adjacent.id, { approvalTicketNo: undefined })).status, 400)
    c.equal('暂停工单号为空白 → 400 LICENSE_TICKET_INVALID', (await h.suspendLicense(adjacent.id, { approvalTicketNo: '   ' })).json.error?.code, 'LICENSE_TICKET_INVALID')
    c.equal('暂停工单号超长 → 400 LICENSE_TICKET_INVALID', (await h.suspendLicense(adjacent.id, { approvalTicketNo: 'T'.repeat(65) })).json.error?.code, 'LICENSE_TICKET_INVALID')
    c.check('以上被拒的暂停一次都没生效', (await api('GET', `/admin/licenses/${adjacent.id}`)).json.data.status === 'active')
    const suspended = await h.suspendLicense(adjacent.id, { reason: '欠费未续，商务确认暂停', approvalTicketNo: 'WO-20261101-7' })
    const sRow = suspended.json.data.org.items.find((i: { id: string }) => i.id === adjacent.id)
    c.check('暂停 → 200、status suspended、记理由与工单号与经办人、版本 +1', suspended.status === 200 && sRow.status === 'suspended' && sRow.statusReason === '欠费未续，商务确认暂停' &&
      sRow.statusTicketNo === 'WO-20261101-7' && sRow.statusChangedBy === adminId && sRow.version === 2)
    const sAudit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'license.suspend', targetId: adjacent.id } })
    const sPayload = JSON.parse(sAudit.payloadJson) as { reason: string; approvalTicketNo: string; version: { before: number; after: number }; before: { status: string }; after: { status: string }; orgState: { before: { state: string }; after: { state: string } } }
    c.check('暂停审计：理由、审批工单号、版本前后、改前改后状态、机构状态快照', sAudit.actorId === adminId && sPayload.reason === '欠费未续，商务确认暂停' && sPayload.approvalTicketNo === 'WO-20261101-7' &&
      sPayload.version.before === 1 && sPayload.version.after === 2 && sPayload.before.status === 'active' && sPayload.after.status === 'suspended' && !!sPayload.orgState.before && !!sPayload.orgState.after)
    c.equal('重复暂停（带最新版本）→ 409 LICENSE_STATUS_CONFLICT', (await h.suspendLicense(adjacent.id, { reason: '再暂停一次试试看' })).json.error?.code, 'LICENSE_STATUS_CONFLICT')
    c.equal('对生效中的授权恢复 → 409 LICENSE_STATUS_CONFLICT', (await h.resumeLicense(lic1.id)).json.error?.code, 'LICENSE_STATUS_CONFLICT')
    c.equal('恢复不带理由 → 400', (await h.resumeLicense(adjacent.id, { reason: undefined })).status, 400)
    c.equal('恢复理由只有 1 个字 → 400 LICENSE_REASON_INVALID', (await h.resumeLicense(adjacent.id, { reason: '好' })).json.error?.code, 'LICENSE_REASON_INVALID')
    const resumed = await h.resumeLicense(adjacent.id, { reason: '已补缴，恢复' })
    const rRow = resumed.json.data.org.items.find((i: { id: string }) => i.id === adjacent.id)
    c.check('恢复 → active，当前理由与工单号清空（历史在审计里），版本再 +1', resumed.status === 200 && rRow.status === 'active' && rRow.statusReason === null && rRow.statusTicketNo === null && rRow.version === 3)
    const rAudit = JSON.parse((await prisma.auditLog.findFirstOrThrow({ where: { action: 'license.resume', targetId: adjacent.id } })).payloadJson) as { reason: string; version: { before: number; after: number } }
    c.check('恢复审计带理由与版本前后', rAudit.reason === '已补缴，恢复' && rAudit.version.before === 2 && rAudit.version.after === 3)

    // 更正 / 改期 / 改台数
    const noChange = await h.updateLicense(lic1.id, { terminalQuota: 3, contractNo: 'HT-2026-001' })
    c.check('更正一个字没变 → 200，不加版本、不写审计', noChange.status === 200 && (await prisma.auditLog.count({ where: { action: 'license.update', targetId: lic1.id } })) === 0 && (await h.versionOfLicense(lic1.id)) === 1)
    const updated = await h.updateLicense(lic1.id, { terminalQuota: 5, note: '补充协议：加 2 台', graceDays: 10 }, { reason: '补充协议加台数' })
    c.check('更正台数 / 宽限 / 备注 → 生效，版本 +1', updated.status === 200 && updated.json.data.org.current.terminalQuota === 5 && updated.json.data.org.current.graceDays === 10 && updated.json.data.org.current.version === 2)
    const uAudit = JSON.parse((await prisma.auditLog.findFirstOrThrow({ where: { action: 'license.update', targetId: lic1.id } })).payloadJson) as { reason: string; before: Record<string, unknown>; after: Record<string, unknown>; version: { before: number; after: number } }
    c.check('更正审计：理由、版本前后、只记真正变了的字段、改前改后齐全', uAudit.reason === '补充协议加台数' && uAudit.version.before === 1 && uAudit.version.after === 2 &&
      uAudit.before['terminalQuota'] === 3 && uAudit.after['terminalQuota'] === 5 && uAudit.before['graceDays'] === 7 && !('contractNo' in uAudit.after))
    c.equal('更正期限改成与后续授权重叠 → 409', (await h.updateLicense(lic1.id, { endsOn: dateOf(44) })).json.error?.code, 'LICENSE_PERIOD_OVERLAP')
    c.equal('更正非法信用代码 → 400', (await h.updateLicense(lic1.id, { creditCode: '123' })).json.error?.code, 'LICENSE_CREDIT_CODE_INVALID')
    c.equal('更正日期不是真实日期 → 400 LICENSE_PERIOD_INVALID', (await h.updateLicense(lic1.id, { endsOn: '2027-02-30' })).json.error?.code, 'LICENSE_PERIOD_INVALID')
    c.equal('更正旧字段 endsAt 不再收 → 400', (await h.updateLicense(lic1.id, { endsAt: iso(31) })).json.error?.code, 'VALIDATION_FAILED')
    c.equal('不存在的授权 → 404', (await api('GET', '/admin/licenses/no-such-license')).json.error?.code, 'LICENSE_NOT_FOUND')
    c.equal('GET 单条授权', (await api('GET', `/admin/licenses/${lic1.id}`)).json.data.id, lic1.id)
    c.equal('不存在的授权更正 → 404 LICENSE_NOT_FOUND', (await api('PATCH', '/admin/licenses/no-such-license', { version: 1, reason: '不存在的授权' })).json.error?.code, 'LICENSE_NOT_FOUND')

    // 续期 = 新建首尾相接的后续授权
    const renewOrg = await newOrg('renew')
    const renewBase = await createLicense(renewOrg, { from: 0, to: 30, terminalQuota: 4, graceDays: 3 })
    const renewed = await h.renewLicense(renewBase.id, { to: 60, contractNo: 'HT-2026-R2', licenseeName: '青岛新续约人力资源有限公司', creditCode: CREDIT_B })
    const succ = renewed.json.data.org.items.find((i: { id: string }) => i.id === renewed.json.data.licenseId)
    c.check('续期：新建一条，起点默认 = 上一条到期日的次日，台数 / 宽限沿用，企业 / 信用代码 / 合同编号用新的', renewed.status === 201 && succ.startsAt === iso(30) && succ.startsOn === dateOf(30) &&
      succ.terminalQuota === 4 && succ.graceDays === 3 && succ.creditCode === CREDIT_B && succ.licenseeName === '青岛新续约人力资源有限公司' && succ.contractNo === 'HT-2026-R2' && succ.version === 1)
    c.equal('续期后旧的不动、历史两条', renewed.json.data.org.items.length, 2)
    c.equal('续期回执：endsOn 含当天，periodText 可直接显示', [succ.endsOn, succ.periodText], [dateOf(59), `${dateOf(30)} 至 ${dateOf(59)}（北京时间，含当天）`])
    for (const [label, over] of [['合同编号', { contractNo: undefined }], ['信用代码', { creditCode: undefined }], ['被授权企业', { licenseeName: undefined }], ['到期日', { endsOn: undefined }]] as const) {
      c.equal(`续期不带${label} → 400`, (await h.renewLicense(renewBase.id, { to: 90, ...over })).status, 400)
    }
    c.equal('续期的信用代码校验位不对 → 400 LICENSE_CREDIT_CODE_INVALID', (await h.renewLicense(renewBase.id, { to: 90, creditCode: '91330100799655058C' })).json.error?.code, 'LICENSE_CREDIT_CODE_INVALID')
    c.equal('续期与已有后续授权重叠 → 409', (await h.renewLicense(renewBase.id, { to: 90, contractNo: 'HT-2026-R3' })).json.error?.code, 'LICENSE_PERIOD_OVERLAP')
    c.check('续期不带版本号也行（它新建一条，不改旧的）', (await h.renewLicense(renewed.json.data.licenseId, { to: 90 })).status === 201)
    const rnAudit = JSON.parse((await prisma.auditLog.findFirstOrThrow({ where: { action: 'license.renew', targetId: renewed.json.data.licenseId } })).payloadJson) as { predecessor: { id: string; contractNo: string }; license: { contractNo: string; creditCode: string } }
    c.check('续期写审计 license.renew（前任编号与合同编号、新合同编号与信用代码）', rnAudit.predecessor.id === renewBase.id && rnAudit.predecessor.contractNo.startsWith('HT-') && rnAudit.license.contractNo === 'HT-2026-R2' && rnAudit.license.creditCode === CREDIT_B)
    const gapOrg = await newOrg('gap')
    const gapBase = await createLicense(gapOrg, { from: 0, to: 30 })
    const gapped = await h.renewLicense(gapBase.id, { from: 35, to: 60 })
    c.check('续期显式给 startsOn：可以留空档（不重叠就行）', gapped.status === 201 && gapped.json.data.org.items[0].startsOn === dateOf(35))
    c.equal('续期显式给 startsOn 但与旧授权重叠 → 409（照样走重叠校验）', (await h.renewLicense(gapBase.id, { from: 20, to: 25 })).json.error?.code, 'LICENSE_PERIOD_OVERLAP')

    // 吊销
    const forRevoke = await createLicense(await newOrg('revoke'), {})
    const revoked = await h.revokeLicense(forRevoke.id, { reason: '合同解除，书面通知已送达', approvalTicketNo: 'WO-9' })
    c.check('吊销 → revoked', revoked.status === 200 && revoked.json.data.org.items[0].status === 'revoked' && revoked.json.data.org.items[0].phase === 'revoked')
    c.equal('吊销不带理由 → 400', (await h.revokeLicense((await createLicense(await newOrg('revoke2'), {})).id, { reason: '' })).status, 400)
    c.equal('吊销不带工单号 → 400', (await h.revokeLicense((await createLicense(await newOrg('revoke3'), {})).id, { approvalTicketNo: undefined })).status, 400)
    const goneVersion = await h.versionOfLicense(forRevoke.id)
    for (const [label, call] of [
      ['再吊销', () => h.revokeLicense(forRevoke.id, { reason: '再来一次吊销试试' })], ['恢复', () => h.resumeLicense(forRevoke.id)],
      ['暂停', () => h.suspendLicense(forRevoke.id, { reason: '对吊销的暂停试试' })], ['更正', () => h.updateLicense(forRevoke.id, { terminalQuota: 9 })],
      ['续期', () => h.renewLicense(forRevoke.id, { to: 90 })],
    ] as const) {
      c.equal(`吊销不可恢复：${label} → 409 LICENSE_REVOKED`, (await call()).json.error?.code, 'LICENSE_REVOKED')
    }
    c.equal('被拒的操作没有改版本', await h.versionOfLicense(forRevoke.id), goneVersion)
    const rvAudit = JSON.parse((await prisma.auditLog.findFirstOrThrow({ where: { action: 'license.revoke', targetId: forRevoke.id } })).payloadJson) as { approvalTicketNo: string; reason: string }
    c.check('吊销写审计（理由、审批工单号）', rvAudit.approvalTicketNo === 'WO-9' && rvAudit.reason === '合同解除，书面通知已送达')
    const afterRevokeOverlap = await createLicense(forRevoke.org.orgId, { from: 0, to: 30 })
    c.check('吊销的授权不再占用期限（同一时段可重新录入）', afterRevokeOverlap.status === 201)

    // ── B. 授权方式 ─────────────────────────────────────────────────────────
    console.log('\n[B] 授权方式')
    const orgB = await newOrg('b')
    await newTerminal('b1', orgB)
    const lock = await h.setMode(orgB, 'required')
    c.check('没有授权的机构有终端，切 required → 409 LICENSE_MODE_WOULD_LOCK_TERMINALS，文案写明受影响的终端数',
      lock.status === 409 && lock.json.error?.code === 'LICENSE_MODE_WOULD_LOCK_TERMINALS' && /名下 1 台终端/.test(lock.json.error?.message ?? ''), JSON.stringify(lock.json))
    c.check('被拒时没有切换', (await detail(orgB)).licenseMode === 'none')
    c.equal('切换不带理由字段 → 400', (await h.setMode(orgB, 'required', { reason: undefined, confirmLockout: true })).status, 400)
    c.equal('切换理由只有 1 个字 → 400 LICENSE_REASON_INVALID', (await h.setMode(orgB, 'required', { reason: '停', confirmLockout: true })).json.error?.code, 'LICENSE_REASON_INVALID')
    c.check('理由不合格时没有切换', (await detail(orgB)).licenseMode === 'none')
    const forced = await h.setMode(orgB, 'required', { confirmLockout: true, reason: '合同到期未续，确认停用' })
    c.check('带 confirmLockout 才切换，状态 unlicensed、不可用', forced.status === 200 && forced.json.data.licenseMode === 'required' && forced.json.data.state === 'unlicensed' && forced.json.data.usable === false)
    const mAudit = JSON.parse((await prisma.auditLog.findFirstOrThrow({ where: { action: 'license.mode_update', targetId: orgB }, orderBy: { createdAt: 'desc' } })).payloadJson)
    c.check('切换写审计：改前改后、理由、是否二次确认、受影响终端数', mAudit.before === 'none' && mAudit.after === 'required' && mAudit.reason === '合同到期未续，确认停用' && mAudit.confirmLockout === true && mAudit.lockout === true && mAudit.terminalCount === 1)
    await h.setMode(orgB, 'required')
    c.equal('同一模式再切 → 不写审计', await prisma.auditLog.count({ where: { action: 'license.mode_update', targetId: orgB } }), 1)
    c.equal('非法授权方式 → 400', (await h.setMode(orgB, 'free')).status, 400)
    const orgEmpty = await newOrg('empty')
    c.check('没有终端的机构切 required 不需要二次确认', (await h.setMode(orgEmpty, 'required')).status === 200)
    const lockedButLicensed = await newOrg('licensedlock')
    await newTerminal('ll1', lockedButLicensed)
    await createLicense(lockedButLicensed, {})
    c.check('已有可用授权的机构切 required 不需要二次确认', (await h.setMode(lockedButLicensed, 'required')).status === 200)
    c.equal('切回 none 也必须带理由 → 400', (await h.setMode(orgB, 'none', { reason: undefined })).status, 400)
    c.equal('切回 none 理由太短 → 400 LICENSE_REASON_INVALID', (await h.setMode(orgB, 'none', { reason: '好' })).json.error?.code, 'LICENSE_REASON_INVALID')
    c.check('切回 none（带理由）→ 不管控', (await h.setMode(orgB, 'none', { reason: '合同续上了，改回不管控' })).json.data.managed === false)
    const backAudit = JSON.parse((await prisma.auditLog.findFirstOrThrow({ where: { action: 'license.mode_update', targetId: orgB }, orderBy: { createdAt: 'desc' } })).payloadJson)
    c.check('切回 none 的审计带理由', backAudit.before === 'required' && backAudit.after === 'none' && backAudit.reason === '合同续上了，改回不管控')
  } finally {
    await h.close()
  }
  c.finish('verify:license（管理员接口）')
}

void main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
