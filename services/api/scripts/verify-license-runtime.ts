// 授权门禁按我方云上的默认配置（招聘托管关闭）运行；授权逻辑不读这个开关，显式写出是为了满足托管声明门禁。
process.env.RECRUITMENT_CONTENT_HOSTING_ENABLED = 'false'

/**
 * verify:license（下）—— 授权管控点与告警的真行为。真库（SQLite 或 PostgreSQL 都行）、真服务、真 HTTP。
 *
 *   C. 一体机会话：只拦「新会话签发」（换票、续期），错误码 TERMINAL_LICENSE_INACTIVE；已签发会话照常到自然过期；
 *      createBootTicket（Agent 链路）不拦；别的机构、不管控的机构、没绑机构的终端不受影响；续期后立刻恢复。
 *   D. 绑定终端：只管新增绑定——超台数拒绝、解绑 / 退役立即释放、降台数不自动解绑也不拦已绑终端；
 *      授权不可用拒绝；待生效（且是 active 的）授权可提前装机；预创建终端同口径；并发抢最后一个名额只有一个成功。
 *   E. 合作机构后台：授权不可用时写操作服务端拒绝（ORG_LICENSE_INACTIVE），查看与导出照常；撤回类放行；不管控的机构、管理员不受影响；
 *      放行的是登记表里逐条登记的 (方法, 路由, 处理函数)，首单前缀下没登记的写接口同样被拒。
 *   F. 机构只读视图：只看得到自己的，不含备注 / 暂停理由 / 工单号 / 信用代码 / 合同编号 / 版本号；current / upcoming 带含当天的期限。
 *   G. 「今天要处理」清单（每一行带期限）；到期前 30 / 7 / 1 天与宽限期内的告警推送（注入时钟、假 Redis、假 webhook），日期写成「…（北京时间，含当天）」。
 * （kiosk-profile 的授权块在 verify-branding.ts。）
 *
 * 运行：VERIFICATION_DATABASE_TARGET=isolated pnpm --filter @ai-job-print/api verify:license
 */
import { LicenseExpiryAlertService, planLicenseAlerts } from '../src/licenses/license-expiry-alert.service'
import type { RedisService } from '../src/common/redis/redis.service'
import { assignTerminalOrganization } from '../src/terminals/terminal-org-assignment'
import { TerminalAdminService } from '../src/terminals/terminals-admin.service'
import { CREDIT, createLicenseHarness, dateOf, iso, T0 } from './support/license-harness'

async function main(): Promise<void> {
  const h = await createLicenseHarness()
  const { c, prisma, call, sessions, api, detail, createLicense, newOrg, newTerminal, newUser, sessionOf, codeOf, redis, webhooks, fakeFetch, adminToken, suffix, terminalIds } = h
  const noAudit = async () => undefined
  try {
    // ── C. 一体机会话签发 ───────────────────────────────────────────────────
    console.log('\n[C] 一体机会话：只拦新签发')
    h.at(0.5)
    const orgS = await newOrg('s', 'required')
    const orgOther = await newOrg('other', 'required')
    const orgNone = await newOrg('none', 'none')
    const tS = await newTerminal('s1', orgS)
    const tOther = await newTerminal('o1', orgOther)
    const tNoneOrg = await newTerminal('n1', orgNone)
    const tFree = await newTerminal('f1', null)
    const licS = await createLicense(orgS, { from: 0, to: 30, graceDays: 7, terminalQuota: 5 })
    await createLicense(orgOther, { from: 0, to: 300, terminalQuota: 5 })
    await createLicense(orgNone, { from: -400, to: -300, terminalQuota: 5 })
    const oldSession = await sessionOf(tS)
    c.check('在期内：换票 / 续期都通过', (await codeOf(() => sessions.refresh(tS, oldSession))) === 'ok')
    h.at(31)
    c.equal('宽限期内：照常换票', await codeOf(() => sessionOf(tS)), 'ok')
    h.at(38)
    const boot = await codeOf(() => sessions.createBootTicket(tS, 'Bearer fixture'))
    c.equal('过了宽限：createBootTicket（Agent 链路）不拦', boot, 'ok')
    const ticket = await sessions.createBootTicket(tS, 'Bearer fixture')
    c.equal('过了宽限：换票被拒 403 TERMINAL_LICENSE_INACTIVE', await codeOf(() => sessions.exchangeBootTicket(ticket.bootTicket)), '403:TERMINAL_LICENSE_INACTIVE')
    c.equal('过了宽限：续期被拒 403 TERMINAL_LICENSE_INACTIVE', await codeOf(() => sessions.refresh(tS, oldSession)), '403:TERMINAL_LICENSE_INACTIVE')
    c.equal('已签发的在办会话照常用到自然过期（validate 不看授权）', await codeOf(() => sessions.validate(tS, oldSession)), 'ok')
    const refusal = await sessions.exchangeBootTicket((await sessions.createBootTicket(tS, 'Bearer fixture')).bootTicket).catch((e: { getResponse: () => { error: { message: string } } }) => e.getResponse().error.message)
    c.check('拒绝文案不写「授权」「到期」，不暴露商务信息', typeof refusal === 'string' && !/授权|到期|合同|续费|欠费/.test(refusal), String(refusal))
    c.equal('别的机构的终端不受影响', await codeOf(() => sessionOf(tOther)), 'ok')
    c.equal('不管控的机构（授权早过期）不受影响', await codeOf(() => sessionOf(tNoneOrg)), 'ok')
    c.equal('没绑机构的终端不受影响', await codeOf(() => sessionOf(tFree)), 'ok')
    // 续期后恢复
    const renewedS = await h.renewLicense(licS.id, { to: 90, contractNo: 'HT-S-2' })
    c.check('续期（新授权从原到期时刻起，覆盖当前）后立刻恢复', renewedS.status === 201 && (await codeOf(() => sessionOf(tS))) === 'ok')
    const newLicenseId = renewedS.json.data.licenseId as string
    const suspendedS = await h.suspendLicense(newLicenseId, { reason: '欠费暂停，等待补缴' })
    c.equal('暂停 → 换票被拒', `${suspendedS.status}:${await codeOf(() => sessionOf(tS))}`, '200:403:TERMINAL_LICENSE_INACTIVE')
    c.equal('暂停时已签发的会话仍可校验', await codeOf(() => sessions.validate(tS, oldSession)), 'ok')
    await h.resumeLicense(newLicenseId)
    c.equal('恢复 → 换票恢复', await codeOf(() => sessionOf(tS)), 'ok')
    await h.revokeLicense(newLicenseId, { reason: '合同解除，立即停用' })
    c.equal('吊销 → 换票被拒（旧授权已过宽限）', await codeOf(() => sessionOf(tS)), '403:TERMINAL_LICENSE_INACTIVE')
    const orgU = await newOrg('u', 'required')
    const tU = await newTerminal('u1', orgU)
    c.equal('required 但一条授权都没有 → 换票被拒', await codeOf(() => sessionOf(tU)), '403:TERMINAL_LICENSE_INACTIVE')
    await h.setMode(orgS, 'none')
    c.equal('改回 none → 换票恢复', await codeOf(() => sessionOf(tS)), 'ok')

    // ── D. 绑定终端：只管新增绑定 ───────────────────────────────────────────
    console.log('\n[D] 绑定终端台数')
    h.at(1)
    const orgQ = await newOrg('q', 'required')
    const q = await Promise.all(['q1', 'q2', 'q3', 'q4', 'q5'].map((k) => newTerminal(k, null)))
    const licQ = await createLicense(orgQ, { from: 0, to: 30, terminalQuota: 2 })
    const bind = (terminalId: string, orgId: string | null) => codeOf(() => assignTerminalOrganization(prisma, terminalId, orgId, undefined, noAudit))
    c.equal('第 1 台绑定通过', await bind(q[0]!, orgQ), 'ok')
    c.equal('第 2 台绑定通过', await bind(q[1]!, orgQ), 'ok')
    const third = await assignTerminalOrganization(prisma, q[2]!, orgQ, undefined, noAudit).catch((e: { getStatus: () => number; getResponse: () => { error: { code: string; message: string; details: unknown } } }) => e)
    c.check('第 3 台超台数 → 409 LICENSE_TERMINAL_QUOTA_EXCEEDED，说明已用 / 上限', 'getResponse' in third && third.getStatus() === 409 &&
      third.getResponse().error.code === 'LICENSE_TERMINAL_QUOTA_EXCEEDED' && /已绑定 2 台，授权上限 2 台/.test(third.getResponse().error.message))
    c.check('被拒的绑定没有改库', (await prisma.terminal.findUniqueOrThrow({ where: { id: q[2]! } })).orgId === null)
    c.equal('已绑定的再绑同一机构不算新增', await bind(q[0]!, orgQ), 'ok')
    c.equal('解绑不受限', await bind(q[0]!, null), 'ok')
    c.equal('解绑立即释放名额：第 3 台现在能绑', await bind(q[2]!, orgQ), 'ok')
    // 退役要满足库里的退役不变量（enabled=false、凭证哨兵、凭证代与生命周期版本各 +1），和真实退役流程一致。
    const retiring = await prisma.terminal.findUniqueOrThrow({ where: { id: q[1]! } })
    await prisma.terminal.update({
      where: { id: q[1]! },
      data: {
        lifecycleStatus: 'retired', enabled: false, agentToken: `cred$retired$${suffix}${suffix}`,
        credentialGeneration: retiring.credentialGeneration + 1, lifecycleVersion: retiring.lifecycleVersion + 1,
      },
    })
    c.equal('退役立即释放名额：第 4 台能绑', await bind(q[3]!, orgQ), 'ok')
    c.check('此时已绑 3 台（含 1 台退役），非退役 2 台', (await detail(orgQ)).terminalsBound === 2)
    const cut = await h.updateLicense(licQ.id, { terminalQuota: 1 })
    c.check('降低台数：不自动解绑，只提示超额', cut.status === 200 && cut.json.data.org.overQuota === true && (await detail(orgQ)).terminalsBound === 2)
    c.equal('降台数后运行期不拦已绑终端：两台照常换票', `${await codeOf(() => sessionOf(q[2]!))}/${await codeOf(() => sessionOf(q[3]!))}`, 'ok/ok')
    c.equal('降台数后新增绑定被拒', await bind(q[4]!, orgQ), '409:LICENSE_TERMINAL_QUOTA_EXCEEDED')
    await bind(q[3]!, null)
    c.equal('仍占满（1/1）时新增被拒', await bind(q[4]!, orgQ), '409:LICENSE_TERMINAL_QUOTA_EXCEEDED')
    await bind(q[2]!, null)
    c.equal('换机：先解绑旧机，新机立刻能绑', await bind(q[4]!, orgQ), 'ok')
    h.at(31)
    c.equal('宽限期内新增绑定仍按台数放行（已满 1/1 → 拒）', await bind(q[2]!, orgQ), '409:LICENSE_TERMINAL_QUOTA_EXCEEDED')
    await h.updateLicense(licQ.id, { terminalQuota: 3 })
    c.equal('宽限期内台数有余量 → 通过', await bind(q[2]!, orgQ), 'ok')
    h.at(38)
    c.equal('过期后新增绑定 → 409 LICENSE_NOT_AVAILABLE_FOR_BINDING', await bind(q[3]!, orgQ), '409:LICENSE_NOT_AVAILABLE_FOR_BINDING')
    c.equal('过期后解绑照常', await bind(q[3]!, null), 'ok')
    h.at(1)
    await h.suspendLicense(licQ.id, { reason: '暂停期间不许再装机' })
    c.equal('暂停 → 新增绑定被拒', await bind(q[3]!, orgQ), '409:LICENSE_NOT_AVAILABLE_FOR_BINDING')
    // 授权不可用时，已绑终端「再绑同一机构」是空操作，不能被误拦；新终端才被拦。
    const orgRB = await newOrg('rb', 'required')
    const rb = await Promise.all(['rb1', 'rb2'].map((k) => newTerminal(k, null)))
    await createLicense(orgRB, { from: 0, to: 30, terminalQuota: 1 })
    c.equal('同机构空操作：先绑第 1 台', await bind(rb[0]!, orgRB), 'ok')
    h.at(40)
    c.equal('授权过期后：已绑终端再绑同一机构是空操作，不被拦', await bind(rb[0]!, orgRB), 'ok')
    c.equal('授权过期后：新终端被拦', await bind(rb[1]!, orgRB), '409:LICENSE_NOT_AVAILABLE_FOR_BINDING')
    h.at(1)
    // 提前装机：只有待生效的授权
    const orgR = await newOrg('r', 'required')
    const r = await Promise.all(['r1', 'r2'].map((k) => newTerminal(k, null)))
    await createLicense(orgR, { from: 10, to: 40, terminalQuota: 1 })
    c.equal('只有待生效授权：按它的台数提前装机（第 1 台）', await bind(r[0]!, orgR), 'ok')
    c.equal('提前装机超台数被拒（第 2 台）', await bind(r[1]!, orgR), '409:LICENSE_TERMINAL_QUOTA_EXCEEDED')
    c.equal('提前装的终端此时不能开新会话（授权还没生效）', await codeOf(() => sessionOf(r[0]!)), '403:TERMINAL_LICENSE_INACTIVE')
    h.at(11)
    c.equal('授权生效后这台就能用', await codeOf(() => sessionOf(r[0]!)), 'ok')
    h.at(1)
    // 审查返工 #2：被暂停的未来授权不能用来提前绑定终端
    const orgPS = await newOrg('ps', 'required')
    const ps = await Promise.all(['ps1', 'ps2'].map((k) => newTerminal(k, null)))
    const futureLic = await createLicense(orgPS, { from: 10, to: 40, terminalQuota: 2 })
    c.equal('未来授权是 active：可以提前装机（正向对照）', await bind(ps[0]!, orgPS), 'ok')
    await bind(ps[0]!, null)
    c.equal('  先录入未来授权再暂停', (await h.suspendLicense(futureLic.id)).status, 200)
    c.equal('被暂停的未来授权：不能提前绑定 → 409 LICENSE_NOT_AVAILABLE_FOR_BINDING（原 bug：仍按它的台数放行）', await bind(ps[1]!, orgPS), '409:LICENSE_NOT_AVAILABLE_FOR_BINDING')
    c.check('  机构概览里 upcoming 不再是被暂停的那条，状态 unlicensed', (await detail(orgPS)).upcoming === null && (await detail(orgPS)).state === 'unlicensed')
    c.equal('  恢复后又可以提前装机', `${(await h.resumeLicense(futureLic.id)).status}:${await bind(ps[1]!, orgPS)}`, '200:ok')
    const orgBare = await newOrg('bare', 'required')
    const bare = await newTerminal('bare1', null)
    c.equal('required 但没有任何授权 → 新增绑定被拒', await bind(bare, orgBare), '409:LICENSE_NOT_AVAILABLE_FOR_BINDING')
    const orgFree = await newOrg('free', 'none')
    const free = await Promise.all(['fr1', 'fr2', 'fr3', 'fr4', 'fr5', 'fr6'].map((k) => newTerminal(k, null)))
    const freeResults: string[] = []
    for (const id of free) freeResults.push(await bind(id, orgFree))
    c.check('不管控的机构不限台数（绑 6 台全过）', freeResults.every((x) => x === 'ok'))
    // 预创建终端同口径
    const planned = new TerminalAdminService(prisma, null as never, null as never, null as never)
    const orgPlan = await newOrg('plan', 'required')
    await createLicense(orgPlan, { from: 0, to: 30, terminalQuota: 1 })
    const code1 = `LICP-${suffix}-1`
    const code2 = `LICP-${suffix}-2`
    const p1 = await planned.createPlannedTerminal({ terminalCode: code1, orgId: orgPlan })
    terminalIds.push(p1.terminalId)
    c.equal('预创建终端（绑机构）第 1 台通过', p1.orgId, orgPlan)
    c.equal('预创建终端第 2 台超台数 → 409', await codeOf(() => planned.createPlannedTerminal({ terminalCode: code2, orgId: orgPlan })), '409:LICENSE_TERMINAL_QUOTA_EXCEEDED')
    c.check('被拒的预创建没有留下终端', (await prisma.terminal.count({ where: { terminalCode: code2 } })) === 0)
    const p3 = await planned.createPlannedTerminal({ terminalCode: `LICP-${suffix}-3` })
    terminalIds.push(p3.terminalId)
    c.check('预创建不绑机构不受限', p3.orgId === null)
    // 并发：抢最后一个名额
    const orgK = await newOrg('k', 'required')
    await createLicense(orgK, { from: 0, to: 30, terminalQuota: 1 })
    const kt = await Promise.all(['k1', 'k2', 'k3'].map((k) => newTerminal(k, null)))
    const raced = await Promise.all(kt.map((id) => bind(id, orgK)))
    c.check('三台并发抢 1 个名额：恰好一台成功，其余被拒', raced.filter((x) => x === 'ok').length === 1 && raced.filter((x) => x !== 'ok').length === 2, raced.join(' | '))
    c.check('三台并发抢 1 个名额：库里绑定数恰好等于上限', (await prisma.terminal.count({ where: { orgId: orgK, lifecycleStatus: { not: 'retired' } } })) === 1)

    // ── E. 合作机构后台写操作 ───────────────────────────────────────────────
    console.log('\n[E] 合作机构后台写操作')
    h.at(1)
    const orgE1 = await newOrg('e1', 'required')
    const orgE2 = await newOrg('e2', 'required')
    const orgE3 = await newOrg('e3', 'none')
    const licE1 = await createLicense(orgE1, { from: 0, to: 30 })
    await createLicense(orgE2, { from: -90, to: -60 })
    const tokenE1 = await newUser('e1', 'partner', orgE1)
    const tokenE2 = await newUser('e2', 'partner', orgE2)
    const tokenE3 = await newUser('e3', 'partner', orgE3)
    const routes: Array<[string, string, boolean]> = [
      ['POST', '/partner/policies', true], ['PATCH', '/partner/policies/p1', true], ['PATCH', '/partner/policies/p1/release', true],
      ['POST', '/partner/official-channels', true], ['POST', '/partner/first-order/brand-new-write', true],
      ['PATCH', '/partner/policies/p1/publish', false], ['DELETE', '/partner/policies/p1', false], ['DELETE', '/partner/official-channels/c1', false],
      ['PUT', '/partner/profile', false], ['POST', '/partner/first-order/incidents', false], ['PATCH', '/partner/first-order/incidents/i1', false],
      ['POST', '/partner/first-order/projects/p1/reports', false], ['POST', '/partner/first-order/reports/r1/acknowledge', false],
      ['POST', '/partner/policies/p1/eligibility-preview', false], ['POST', '/partner/data-sources/preflight/jobs', false], ['POST', '/partner/data-sources/preflight/fairs', false],
      ['PATCH', '/partner/jobs/j1/publish', false], ['PATCH', '/partner/fairs/f1/publish', false], ['PATCH', '/partner/companies/c1/publish', false],
      ['PATCH', '/partner/data-sources/d1/archive', false], ['DELETE', '/partner/excel/b1', false],
      ['PATCH', '/partner/data-sources/d1/unarchive', true], ['PATCH', '/partner/data-sources/d1/toggle', true], ['PATCH', '/partner/jobs/j1', true],
      ['POST', '/partner/jobs/import', true], ['PATCH', '/partner/companies/c1', true],
      ['GET', '/partner/policies', false], ['GET', '/partner/policies/export.csv', false],
    ]
    const statusOf = async (method: string, path: string, token: string) => {
      const r = await call(method, `/api/v1${path}`, { token, body: method === 'GET' || method === 'DELETE' ? undefined : {} })
      return `${r.status}${r.json.error?.code ? ':' + r.json.error.code : ''}`
    }
    for (const [method, path, blocked] of routes) {
      c.equal(`授权已过期的机构：${method} ${path} ${blocked ? '被拒' : '放行'}`, await statusOf(method, path, tokenE2), blocked ? '403:ORG_LICENSE_INACTIVE' : (method === 'POST' ? '201' : '200'))
    }
    for (const [method, path] of routes) {
      c.check(`授权在期内：${method} ${path} 放行`, ['200', '201'].includes(await statusOf(method, path, tokenE1)))
    }
    for (const [method, path] of routes) {
      c.check(`不管控的机构：${method} ${path} 放行`, ['200', '201'].includes(await statusOf(method, path, tokenE3)))
    }
    h.at(33)
    c.check('宽限期内照常写（grace 照常服务）', (await statusOf('POST', '/partner/policies', tokenE1)) === '201')
    await h.suspendLicense(licE1.id, { reason: '欠费暂停，写操作冻结' })
    c.equal('暂停 → 写被拒', await statusOf('POST', '/partner/policies', tokenE1), '403:ORG_LICENSE_INACTIVE')
    c.equal('暂停 → 查看与导出照常', `${await statusOf('GET', '/partner/policies', tokenE1)}/${await statusOf('GET', '/partner/policies/export.csv', tokenE1)}`, '200/200')
    c.equal('暂停 → 撤回自己的内容（下架）照常', await statusOf('PATCH', '/partner/policies/p1/publish', tokenE1), '200')
    await h.resumeLicense(licE1.id)
    c.equal('恢复 → 写操作恢复', await statusOf('POST', '/partner/policies', tokenE1), '201')
    const mixedAdmin = await call('POST', '/api/v1/partner/mixed', { token: adminToken, body: {} })
    c.check('管理员走同一路径不受拦截器影响', mixedAdmin.status === 201)
    c.equal('未登录仍是 401（拦截器在鉴权之后）', (await call('POST', '/api/v1/partner/policies', { body: {} })).status, 401)
    const msg = (await call('POST', '/api/v1/partner/policies', { token: tokenE2, body: {} })).json.error?.message ?? ''
    c.check('拒绝文案告诉机构：写被拒、查看导出不受影响、联系平台', /授权/.test(msg) && /查看与导出不受影响/.test(msg))

    // ── F. 机构只读视图 ─────────────────────────────────────────────────────
    console.log('\n[F] 机构只看得到自己的授权')
    h.at(1)
    const viewE1 = await call('GET', '/api/v1/partner/license', { token: tokenE1 })
    const viewE2 = await call('GET', '/api/v1/partner/license', { token: tokenE2 })
    const viewE3 = await call('GET', '/api/v1/partner/license', { token: tokenE3 })
    c.check('机构拿到自己的授权：状态、期限、台数、宽限', viewE1.status === 200 && viewE1.json.data.state === 'ok' && viewE1.json.data.current.terminalQuota === 3 && viewE1.json.data.current.licenseeName === '青岛某某人力资源有限公司')
    c.equal('另一个机构（已过期）看到自己的状态', viewE2.json.data.state, 'expired')
    c.check('不管控的机构：managed=false', viewE3.json.data.managed === false && viewE3.json.data.licenseMode === 'none')
    const leak = JSON.stringify([viewE1.json.data, viewE2.json.data, viewE3.json.data])
    c.check('机构视图不含信用代码 / 合同编号 / 备注 / 暂停理由 / 工单号 / 经办人 / 授权编号', !/creditCode|contractNo|note|statusReason|statusTicketNo|createdBy|statusChangedBy|version|"id"/.test(leak) && !leak.includes(CREDIT))
    c.check('机构接口不接受机构参数：一个机构读不到另一个机构', viewE2.json.data.current.licenseeName !== undefined && JSON.stringify(viewE2.json.data) !== JSON.stringify(viewE1.json.data))
    c.equal('管理员访问机构只读接口 → 403', (await call('GET', '/api/v1/partner/license', { token: adminToken })).status, 403)
    await createLicense(orgE1, { from: 40, to: 70, contractNo: 'HT-E1-NEXT' })
    const viewE1b = (await call('GET', '/api/v1/partner/license', { token: tokenE1 })).json.data
    const cur = viewE1b.current
    const up = viewE1b.upcoming
    c.check('机构视图 current 带 startsOn / endsOn / periodText / graceEndsOn（界面直接显示，不自己换算）',
      cur.startsOn === dateOf(0) && cur.endsOn === dateOf(29) && cur.periodText === `${dateOf(0)} 至 ${dateOf(29)}（北京时间，含当天）` && cur.graceEndsOn === dateOf(36))
    c.check('机构视图 upcoming 也带', up.startsOn === dateOf(40) && up.endsOn === dateOf(69) && up.periodText === `${dateOf(40)} 至 ${dateOf(69)}（北京时间，含当天）` && 'graceEndsOn' in up)
    c.equal('机构视图 current 的字段固定', Object.keys(cur).sort(), ['endsAt', 'endsOn', 'graceDays', 'graceEndsAt', 'graceEndsOn', 'licenseeName', 'periodText', 'startsAt', 'startsOn', 'status', 'terminalQuota'])
    c.equal('机构视图 upcoming 的字段固定', Object.keys(up).sort(), ['endsAt', 'endsOn', 'graceEndsOn', 'periodText', 'startsAt', 'startsOn', 'terminalQuota'])

    // ── G. 今天要处理 + 告警 ────────────────────────────────────────────────
    console.log('\n[G] 「今天要处理」与到期告警')
    h.at(100)
    const attn = {
      soon: await newOrg('g_soon', 'required'), grace: await newOrg('g_grace', 'required'), expired: await newOrg('g_exp', 'required'),
      susp: await newOrg('g_susp', 'required'), bare: await newOrg('g_bare', 'required'), far: await newOrg('g_far', 'required'),
      none: await newOrg('g_none', 'none'), chain: await newOrg('g_chain', 'required'),
    }
    await createLicense(attn.soon, { from: 70, to: 110 })
    await createLicense(attn.grace, { from: 70, to: 98, graceDays: 7 })
    await createLicense(attn.expired, { from: 0, to: 50, graceDays: 7 })
    const sus = await createLicense(attn.susp, { from: 70, to: 300 })
    await h.suspendLicense(sus.id, { reason: '欠费暂停，进入处理清单' })
    await createLicense(attn.far, { from: 70, to: 400 })
    await createLicense(attn.none, { from: 0, to: 10 })
    await createLicense(attn.chain, { from: 70, to: 110, contractNo: 'HT-CH-1' })
    await createLicense(attn.chain, { from: 110, to: 300, contractNo: 'HT-CH-2' })
    const attention = (await api('GET', '/admin/licenses/attention')).json.data
    const mine = (list: Array<{ orgId: string }>) => list.map((o) => o.orgId).filter((id) => Object.values(attn).includes(id)).sort()
    c.equal('30 天内到期', mine(attention.expiringSoon), [attn.soon])
    c.equal('宽限中', mine(attention.grace), [attn.grace])
    c.equal('已停用（过期 / 暂停 / 没有授权）', mine(attention.inactive), [attn.expired, attn.susp, attn.bare].sort())
    c.check('远期的、不管控的、已录入首尾相接续期的都不在清单里', ![attn.far, attn.none, attn.chain].some((id) => [...attention.expiringSoon, ...attention.grace, ...attention.inactive].some((o: { orgId: string }) => o.orgId === id)))
    const rowOf = (list: Array<{ orgId: string }>, id: string) => list.find((o) => o.orgId === id) as any // eslint-disable-line @typescript-eslint/no-explicit-any
    const soonRow = rowOf(attention.expiringSoon, attn.soon)
    const graceRow = rowOf(attention.grace, attn.grace)
    const expRow = rowOf(attention.inactive, attn.expired)
    c.check('「30 天内到期」每一行带含当天的期限文字与连续覆盖终点', soonRow.current.periodText === `${dateOf(70)} 至 ${dateOf(109)}（北京时间，含当天）` &&
      soonRow.current.startsOn === dateOf(70) && soonRow.current.endsOn === dateOf(109) && soonRow.coveredUntilOn === dateOf(109))
    c.check('「宽限中」每一行带宽限最后一天', graceRow.current.endsOn === dateOf(97) && graceRow.current.graceEndsOn === dateOf(104) && graceRow.coveredUntilOn === null)
    c.check('「已停用」每一行（过期 / 暂停 / 没有授权）也带期限，没有授权的是 null', expRow.current.periodText === `${dateOf(0)} 至 ${dateOf(49)}（北京时间，含当天）` &&
      typeof rowOf(attention.inactive, attn.susp).current.periodText === 'string' && rowOf(attention.inactive, attn.bare).current === null)
    c.check('counts 与清单一致', attention.counts.expiringSoon === attention.expiringSoon.length && attention.counts.grace === attention.grace.length && attention.counts.inactive === attention.inactive.length)

    // 告警：注入时钟 + 假 Redis + 假 webhook
    process.env['ALERT_WEBHOOK_URL'] = 'http://alert.invalid/hook'
    const alertService = new LicenseExpiryAlertService(prisma, redis as unknown as RedisService, fakeFetch)
    const alertOrg = await newOrg('al', 'required')
    const alertName = `授权门禁机构al${suffix}`
    const chainOrg = await newOrg('alc', 'required')
    const noneOrg = await newOrg('aln', 'none')
    const revokedOrg = await newOrg('alr', 'required')
    const suspOrg = await newOrg('als', 'required')
    h.at(200)
    await createLicense(alertOrg, { from: 200, to: 300, contractNo: 'HT-SECRET-AL', graceDays: 7 })
    await createLicense(chainOrg, { from: 200, to: 230, contractNo: 'HT-SECRET-C1' })
    await createLicense(chainOrg, { from: 230, to: 300, contractNo: 'HT-SECRET-C2' })
    await createLicense(noneOrg, { from: 200, to: 201 })
    const rv = await createLicense(revokedOrg, { from: 200, to: 201 })
    await h.revokeLicense(rv.id, { reason: '合同解除，不再提醒' })
    const sv = await createLicense(suspOrg, { from: 200, to: 201 })
    await h.suspendLicense(sv.id, { reason: '已暂停，不再重复提醒' })
    const run = async (days: number) => {
      h.at(days)
      const before = webhooks.length
      const planned = await alertService.checkNow(new Date(h.nowMs()))
      return {
        planned: planned.filter((a) => a.subjectKey === `license_expiry:${alertOrg}`),
        plannedAll: planned,
        sent: webhooks.slice(before).filter((w) => w.text.includes(alertName)),
        sentAll: webhooks.slice(before),
      }
    }
    c.equal('剩 31 天：不推', (await run(268.9)).sent.length, 0)
    const t30 = await run(270.5)
    c.check('剩不到 30 天：推 1 条（警告），写明有效期至哪一天（含当天）', t30.sent.length === 1 && /还有 30 天到期/.test(t30.sent[0]!.text) && /警告/.test(t30.sent[0]!.text) &&
      t30.sent[0]!.text.includes(`有效期至 ${dateOf(299)}（北京时间，含当天）`), t30.sent[0]?.text)
    c.equal('同一回合再跑一遍：不重复推（去重）', (await run(270.6)).sent.length, 0)
    c.equal('剩不到 7 天：再推 1 条', (await run(294)).sent.length, 1)
    const t1 = await run(299.5)
    c.check('剩不到 1 天：再推 1 条（严重）', t1.sent.length === 1 && /严重/.test(t1.sent[0]!.text) && /还有 1 天到期/.test(t1.sent[0]!.text))
    const g1 = await run(301)
    c.check('宽限期内每天推：第 1 天，写明宽限最后一天（含当天）', g1.sent.length === 1 && g1.sent[0]!.text.includes(`宽限期到 ${dateOf(306)}（北京时间，含当天）`) && /不能开始新会话/.test(g1.sent[0]!.text), g1.sent[0]?.text)
    c.equal('同一天宽限期再跑：不重复', (await run(301.2)).sent.length, 0)
    c.equal('宽限期第 2 天：再推 1 条', (await run(302.2)).sent.length, 1)
    const expired = await run(308)
    c.check('结束宽限：推一次「已停用」', expired.sent.length === 1 && /宽限已结束/.test(expired.sent[0]!.text))
    c.equal('已停用只推一次', (await run(309)).sent.length, 0)
    c.equal('结束宽限超过 30 天不再翻旧账', (await run(400)).planned.length, 0)
    const plainAll = (await run(268.5)).plannedAll.map((a) => a.subjectKey)
    c.check('不管控 / 已吊销 / 已暂停的机构不在告警计划里', ![noneOrg, revokedOrg, suspOrg].some((id) => plainAll.includes(`license_expiry:${id}`)))
    const chainRun = await run(205)
    c.check('已录入首尾相接续期的机构：旧授权快到期也不推（连续覆盖到 300 天）', !chainRun.plannedAll.some((a) => a.subjectKey === `license_expiry:${chainOrg}`))
    const chainSoon = await run(272)
    c.check('续期链的终点剩不到 30 天才推', chainSoon.plannedAll.some((a) => a.subjectKey === `license_expiry:${chainOrg}`))
    const allText = webhooks.map((w) => w.text).join('\n')
    c.check('告警正文只写机构名与日期，不含合同编号 / 信用代码', !/HT-SECRET|91330100799655058B/.test(allText))
    c.check('告警发往配置的 webhook', webhooks.every((w) => w.url === 'http://alert.invalid/hook'))
    const planOnly = planLicenseAlerts([{ id: 'x', name: '纯函数机构', licenses: [] }], new Date(T0))
    c.equal('纯函数：没有授权的机构不计划告警', planOnly.length, 0)
    process.env['ALERT_WEBHOOK_URL'] = ''
    const quiet = new LicenseExpiryAlertService(prisma, redis as unknown as RedisService, fakeFetch)
    const sentBefore = webhooks.length
    h.at(270)
    await quiet.runDaily()
    c.equal('没配告警地址：定时任务什么都不发', webhooks.length, sentBefore)
  } finally {
    await h.close()
  }
  c.finish('verify:license（管控点与告警）')
}

void main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
