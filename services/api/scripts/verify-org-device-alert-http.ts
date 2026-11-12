/**
 * 机构设备告警通知走真实 HTTP 的用例。
 *
 * verify-org-device-alert 直接调服务方法。这里起真服务（全局入参校验、全局错误过滤器、登录与角色守卫都在），
 * 补上只有过了 HTTP 层、真实网络才看得出的部分：
 *   A. 未登录 401；机构账号打管理员接口、管理员打机构接口 403。
 *   B. 地址校验：http、白名单外、本机与内网、带账号、非 443 端口、打码串、过长、多带字段，报错原样到页面。
 *   C. 保存后各读接口（本接口、机构资料、管理员机构列表与详情、内容可信）都不回显密钥、密文和列名。
 *   D. 机构之间互不可见、互不可改；管理员代填只改那一家。
 *   E. 测试消息只发到本机构的地址；对方拒收、3xx 都如实失败；审计与服务日志不含密钥。
 *   F. 真实网络：3xx 不跟随，对方挂住 5 秒内放弃。
 *   G. 终端数据接口带出打印机状态与未恢复告警条数，只给本机构的终端。
 *
 * 运行：VERIFICATION_DATABASE_TARGET=isolated node -r @swc-node/register scripts/verify-org-device-alert-http.ts
 */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { issueInternalToken, startHarness, type HarnessEnv } from './support/content-pipeline-harness'

const KEY_A = `orgA-robot-key-${Date.now().toString(36)}`
const KEY_B = `orgB-robot-key-${Date.now().toString(36)}`
const URL_A = `https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=${KEY_A}`
const URL_B = `https://open.feishu.cn/open-apis/bot/v2/hook/${KEY_B}`
const FIXED_FAIL = '测试消息没有发出去，请核对地址后重试'

interface Reply {
  status: number
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any
  raw: string
}

function pass(line: string): void {
  console.log(`  PASS ${line}`)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function dataOf(res: Reply): any {
  return res.body && typeof res.body === 'object' && 'data' in res.body ? res.body.data : res.body
}

/** 把本进程（含服务端）写到 stdout / stderr 的内容留一份，最后核对密钥没进日志。 */
function captureOutput(): { text: () => string; restore: () => void } {
  const chunks: string[] = []
  const out = process.stdout.write.bind(process.stdout)
  const err = process.stderr.write.bind(process.stderr)
  process.stdout.write = ((chunk: unknown, ...rest: unknown[]) => {
    chunks.push(String(chunk))
    return (out as (...args: unknown[]) => boolean)(chunk, ...rest)
  }) as typeof process.stdout.write
  process.stderr.write = ((chunk: unknown, ...rest: unknown[]) => {
    chunks.push(String(chunk))
    return (err as (...args: unknown[]) => boolean)(chunk, ...rest)
  }) as typeof process.stderr.write
  return {
    text: () => chunks.join(''),
    restore: () => {
      process.stdout.write = out
      process.stderr.write = err
    },
  }
}

async function main(): Promise<void> {
  const output = captureOutput()
  const h: HarnessEnv = await startHarness(0)
  const { PrismaService } = await import('../src/prisma/prisma.service')
  const { OrgDeviceAlertWebhookService } = await import('../src/admin-ops/org-device-alert-webhook.service')
  const { DEVICE_ALERT_TEST_MESSAGE } = await import('../src/admin-ops/org-device-alert-push')
  const { postGroupRobot } = await import('../src/admin-ops/device-alert-webhook')
  const prisma = h.api.app.get(PrismaService)
  const webhooks = h.api.app.get(OrgDeviceAlertWebhookService)

  const run = h.run
  const orgA = `g4ahttp-org-a-${run}`
  const orgB = `g4ahttp-org-b-${run}`
  const adminName = `g4ahttp-admin-${run}`
  const partnerA = `g4ahttp-partner-a-${run}`
  const partnerB = `g4ahttp-partner-b-${run}`
  const termOk = `g4ahttp-term-a1-${run}`
  const termOff = `g4ahttp-term-a2-${run}`
  const termB = `g4ahttp-term-b1-${run}`

  async function call(method: string, path: string, opts: { bearer?: string; json?: unknown } = {}): Promise<Reply> {
    const headers: Record<string, string> = {}
    if (opts.bearer) headers['Authorization'] = `Bearer ${opts.bearer}`
    if (opts.json !== undefined) headers['Content-Type'] = 'application/json'
    const res = await fetch(`${h.api.base}${path}`, {
      method,
      headers,
      body: opts.json === undefined ? undefined : JSON.stringify(opts.json),
    })
    const raw = await res.text()
    try {
      return { status: res.status, body: JSON.parse(raw), raw }
    } catch {
      return { status: res.status, body: { raw }, raw }
    }
  }

  async function cipherOf(orgId: string): Promise<string | null> {
    return (await prisma.organization.findUnique({ where: { id: orgId }, select: { deviceAlertWebhookEnc: true } }))?.deviceAlertWebhookEnc ?? null
  }

  async function cleanup(): Promise<void> {
    await prisma.terminalHeartbeat.deleteMany({ where: { terminalId: { in: [termOk, termOff, termB] } } })
    await prisma.terminal.deleteMany({ where: { id: { in: [termOk, termOff, termB] } } })
    await prisma.auditLog.deleteMany({ where: { targetId: { in: [orgA, orgB] } } })
    await prisma.user.deleteMany({ where: { username: { in: [adminName, partnerA, partnerB] } } })
    await prisma.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } })
  }

  try {
    await prisma.organization.create({ data: { id: orgA, name: `告警用例机构甲 ${run}`, type: 'public_employment_service' } })
    await prisma.organization.create({ data: { id: orgB, name: `告警用例机构乙 ${run}`, type: 'public_employment_service' } })
    await prisma.user.create({ data: { username: adminName, passwordHash: 'not-used', name: '告警用例管理员', role: 'admin' } })
    await prisma.user.create({ data: { username: partnerA, passwordHash: 'not-used', name: '告警用例机构甲账号', role: 'partner', orgId: orgA } })
    await prisma.user.create({ data: { username: partnerB, passwordHash: 'not-used', name: '告警用例机构乙账号', role: 'partner', orgId: orgB } })
    const admin = await issueInternalToken(h, adminName)
    const tokA = await issueInternalToken(h, partnerA)
    const tokB = await issueInternalToken(h, partnerB)

    console.log('\n[A] 登录与角色')
    {
      assert.equal((await call('GET', '/partner/device-alert-notify')).status, 401)
      assert.equal((await call('GET', `/admin/orgs/${orgA}/device-alert-notify`)).status, 401)
      assert.equal((await call('GET', `/admin/orgs/${orgA}/device-alert-notify`, { bearer: tokA })).status, 403)
      assert.equal((await call('PUT', `/admin/orgs/${orgB}/device-alert-notify`, { bearer: tokA, json: { url: URL_A } })).status, 403)
      assert.equal((await call('GET', '/partner/device-alert-notify', { bearer: admin })).status, 403)
      assert.equal((await call('PUT', `/admin/orgs/missing-${run}/device-alert-notify`, { bearer: admin, json: { url: URL_A } })).status, 404)
      pass('未登录 401；机构账号打管理员接口、管理员打机构接口 403；管理员填不存在的机构 404')
    }

    console.log('\n[B] 地址校验（报错原样到页面）')
    {
      const cases: Array<[string, unknown, number, RegExp]> = [
        ['http', { url: 'http://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=x' }, 400, /只能使用 https/],
        ['白名单外', { url: 'https://example.com/hook' }, 400, /只接受企业微信、钉钉或飞书/],
        ['相似域名', { url: 'https://qyapi.weixin.qq.com.evil.example/hook' }, 400, /只接受企业微信、钉钉或飞书/],
        ['本机', { url: 'https://127.0.0.1/hook' }, 400, /只接受企业微信、钉钉或飞书/],
        ['内网元数据', { url: 'https://169.254.169.254/latest/meta-data' }, 400, /只接受企业微信、钉钉或飞书/],
        ['localhost', { url: 'https://localhost/hook' }, 400, /只接受企业微信、钉钉或飞书/],
        ['借账号段伪装', { url: 'https://qyapi.weixin.qq.com@evil.example/hook' }, 400, /不能带账号或密码/],
        ['非 443 端口', { url: 'https://qyapi.weixin.qq.com:8443/cgi-bin/webhook/send?key=x' }, 400, /只接受企业微信、钉钉或飞书/],
        ['打码串', { url: 'https://qyapi.weixin.qq.com/cgi-bin/web…（密钥已隐藏）' }, 400, /打码后的地址不能再次保存/],
        ['过长', { url: `https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=${'x'.repeat(520)}` }, 400, /通知地址过长/],
        ['多带机构编号', { url: URL_A, orgId: orgB }, 400, /orgId/],
        ['不是文字', { url: 12345 }, 400, /请填写通知地址|通知地址过长/],
      ]
      for (const [name, json, status, message] of cases) {
        const res = await call('PUT', '/partner/device-alert-notify', { bearer: tokA, json })
        assert.equal(res.status, status, `${name}：状态码 ${res.status} ${res.raw.slice(0, 200)}`)
        assert.match(String(res.body?.error?.message ?? ''), message, `${name}：${res.raw.slice(0, 200)}`)
      }
      assert.equal(await cipherOf(orgA), null, '被拒的地址一条都不能落库')
      assert.equal(await cipherOf(orgB), null, '多带的机构编号不能让乙机构被写')
      pass(`${cases.length} 种坏地址都被拒，报错原样到页面；多带的机构编号被拒；没有一条落库`)
    }

    console.log('\n[C] 保存后各读接口不回显密钥、密文和列名')
    {
      const saved = await call('PUT', '/partner/device-alert-notify', { bearer: tokA, json: { url: `  ${URL_A}  ` } })
      assert.equal(saved.status, 200, saved.raw.slice(0, 200))
      const view = dataOf(saved)
      assert.equal(view.configured, true)
      assert.match(view.maskedUrl, /^https:\/\/qyapi\.weixin\.qq\.com\/cgi-bin\/web…（密钥已隐藏）$/)
      const cipher = await cipherOf(orgA)
      assert.ok(cipher && !cipher.includes(KEY_A), '库里只能存密文')
      const reads = [
        await call('GET', '/partner/device-alert-notify', { bearer: tokA }),
        await call('GET', '/partner/profile', { bearer: tokA }),
        await call('GET', '/admin/orgs', { bearer: admin }),
        await call('GET', `/admin/orgs/${orgA}`, { bearer: admin }),
        await call('GET', `/admin/orgs/${orgA}/content-trust`, { bearer: admin }),
        await call('GET', `/admin/orgs/${orgA}/device-alert-notify`, { bearer: admin }),
      ]
      for (const res of [saved, ...reads]) {
        assert.equal(res.status, 200, res.raw.slice(0, 200))
        assert.equal(res.raw.includes(KEY_A), false, '响应里出现了机器人密钥')
        assert.equal(res.raw.includes(cipher), false, '响应里出现了密文')
        assert.equal(res.raw.includes('deviceAlertWebhookEnc'), false, '响应里出现了密文列名')
      }
      assert.equal(dataOf(reads[5]).configured, true)
      assert.equal(dataOf(reads[5]).maskedUrl, view.maskedUrl)
      pass('保存后本接口、机构资料、管理员机构列表与详情、内容可信 7 个响应都不含密钥、密文和列名；只给打码地址')
    }

    console.log('\n[D] 机构之间互不可见、互不可改')
    {
      const before = await cipherOf(orgA)
      const viewB = dataOf(await call('GET', '/partner/device-alert-notify', { bearer: tokB }))
      assert.deepEqual({ configured: viewB.configured, maskedUrl: viewB.maskedUrl }, { configured: false, maskedUrl: null })
      const savedB = await call('PUT', '/partner/device-alert-notify', { bearer: tokB, json: { url: URL_B } })
      assert.equal(savedB.status, 200, savedB.raw.slice(0, 200))
      assert.equal(savedB.raw.includes(KEY_B), false)
      assert.equal(await cipherOf(orgA), before, '乙机构保存不能改到甲机构')
      assert.notEqual(await cipherOf(orgB), null)
      const viewA = dataOf(await call('GET', '/partner/device-alert-notify', { bearer: tokA }))
      assert.equal(viewA.maskedUrl.includes('qyapi.weixin.qq.com'), true, '甲机构读到的仍是自己的地址')
      const cleared = await call('PUT', `/admin/orgs/${orgB}/device-alert-notify`, { bearer: admin, json: { url: '   ' } })
      assert.equal(dataOf(cleared).configured, false)
      assert.equal(await cipherOf(orgB), null)
      assert.equal(await cipherOf(orgA), before, '管理员清乙机构不能动甲机构')
      pass('乙机构读不到甲机构的地址、保存不改甲机构；管理员代清乙机构只动乙机构')
    }

    console.log('\n[E] 测试消息')
    {
      const calls: Array<{ url: string; body: string }> = []
      let reply: () => Response = () => new Response(JSON.stringify({ errcode: 0, errmsg: 'ok' }), { status: 200 })
      webhooks.useFetchForTest(async (url, init) => {
        calls.push({ url: String(url), body: String(init?.body ?? '') })
        return reply()
      })
      const ok = await call('POST', '/partner/device-alert-notify/test', { bearer: tokA })
      assert.ok(ok.status === 200 || ok.status === 201, ok.raw.slice(0, 200))
      assert.equal(dataOf(ok).sent, true)
      assert.equal(calls.length, 1)
      assert.equal(calls[0]?.url, URL_A, '只发到本机构保存的地址')
      assert.equal(calls[0]?.body.includes(DEVICE_ALERT_TEST_MESSAGE), true)
      assert.equal(ok.raw.includes(KEY_A), false)

      reply = () => new Response(JSON.stringify({ errcode: 310000, errmsg: 'keywords not in content' }), { status: 200 })
      const refused = await call('POST', '/partner/device-alert-notify/test', { bearer: tokA })
      assert.equal(refused.status, 400)
      assert.equal(refused.body?.error?.code, 'DEVICE_ALERT_WEBHOOK_DELIVERY_FAILED')
      assert.equal(refused.body?.error?.message, FIXED_FAIL)
      assert.equal(refused.raw.includes('keywords'), false, '对方的返回原文不透给页面')

      reply = () => new Response('', { status: 302, headers: { location: 'https://evil.example/next' } })
      const redirected = await call('POST', `/admin/orgs/${orgA}/device-alert-notify/test`, { bearer: admin })
      assert.equal(redirected.status, 400)
      assert.equal(redirected.body?.error?.message, FIXED_FAIL)
      assert.equal(calls.length, 3, '3xx 只请求一次，不跟随')

      webhooks.useFetchForTest(async (url) => { throw new Error(`connect ECONNREFUSED ${String(url)}`) })
      const broken = await call('POST', '/partner/device-alert-notify/test', { bearer: tokA })
      assert.equal(broken.status, 400)
      assert.equal(broken.body?.error?.message, FIXED_FAIL)
      assert.equal(broken.raw.includes(KEY_A), false)

      const unset = await call('POST', '/partner/device-alert-notify/test', { bearer: tokB })
      assert.equal(unset.status, 400)
      assert.equal(unset.body?.error?.code, 'DEVICE_ALERT_WEBHOOK_UNSET')

      const audits = await prisma.auditLog.findMany({ where: { action: 'organization.device_alert_webhook', targetId: { in: [orgA, orgB] } } })
      assert.ok(audits.length >= 4, `审计条数 ${audits.length}`)
      const packed = JSON.stringify(audits)
      assert.equal(packed.includes(KEY_A) || packed.includes(KEY_B), false, '审计里出现了密钥')
      assert.equal(packed.includes('qyapi.weixin.qq.com'), true, '审计记主机名')
      pass('测试消息只发到本机构地址；对方拒收、3xx、连不上都如实失败且不透原文；没保存时提示先保存；审计不含密钥')
    }

    console.log('\n[F] 真实网络：3xx 不跟随，挂住 5 秒内放弃')
    {
      let landed = 0
      const server = createServer((req, res) => {
        if (req.url === '/redirect') {
          res.writeHead(302, { location: '/landed' })
          res.end()
        } else if (req.url === '/landed') {
          landed += 1
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ errcode: 0 }))
        }
        // /hang：不回应，等对方放弃
      })
      await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
      const port = (server.address() as AddressInfo).port
      try {
        await assert.rejects(() => postGroupRobot(`http://127.0.0.1:${port}/redirect`, 'x', fetch), (error: unknown) =>
          error instanceof Error && error.message === FIXED_FAIL)
        assert.equal(landed, 0, '跟随了重定向')
        const t0 = Date.now()
        await assert.rejects(() => postGroupRobot(`http://127.0.0.1:${port}/hang`, 'x', fetch))
        const waited = Date.now() - t0
        assert.ok(waited >= 4500 && waited < 8000, `挂住时等了 ${waited} 毫秒`)
        pass(`真实请求：302 没有跟随；对方挂住时 ${waited} 毫秒放弃`)
      } finally {
        server.closeAllConnections()
        await new Promise<void>((done) => server.close(() => done()))
      }
    }

    console.log('\n[G] 终端数据接口带出打印机状态与未恢复告警条数')
    {
      const now = new Date()
      const bound = new Date(now.getTime() - 3 * 24 * 60 * 60_000)
      const terminal = (id: string, code: string, orgId: string) => prisma.terminal.create({
        data: {
          id, terminalCode: code, displayName: `告警用例 ${code}`, agentToken: `token-${id}`, deviceFingerprint: `fp-${id}`,
          credentialGeneration: 0, enabled: true, lifecycleStatus: 'active', orgId, orgBoundAt: bound,
        },
      })
      await terminal(termOk, `G4A-A1-${run}`, orgA)
      await terminal(termOff, `G4A-A2-${run}`, orgA)
      await terminal(termB, `G4A-B1-${run}`, orgB)
      await prisma.terminalHeartbeat.create({ data: { terminalId: termOk, printerStatus: 'low_paper', createdAt: now } })
      await prisma.terminalHeartbeat.create({ data: { terminalId: termOff, printerStatus: 'ready', createdAt: new Date(now.getTime() - 60 * 60_000) } })
      await prisma.terminalHeartbeat.create({ data: { terminalId: termB, printerStatus: 'paper_empty', createdAt: now } })
      const res = await call('GET', '/partner/terminal-operations?period=week', { bearer: tokA })
      assert.equal(res.status, 200, res.raw.slice(0, 200))
      const rows: Array<{ terminalCode: string; online: boolean; printerStatus: string | null; openAlertCount: number }> = dataOf(res).terminals
      const byCode = new Map(rows.map((row) => [row.terminalCode, row]))
      assert.deepEqual(
        { online: byCode.get(`G4A-A1-${run}`)?.online, printerStatus: byCode.get(`G4A-A1-${run}`)?.printerStatus, openAlertCount: byCode.get(`G4A-A1-${run}`)?.openAlertCount },
        { online: true, printerStatus: 'low_paper', openAlertCount: 1 },
      )
      assert.deepEqual(
        { online: byCode.get(`G4A-A2-${run}`)?.online, openAlertCount: byCode.get(`G4A-A2-${run}`)?.openAlertCount },
        { online: false, openAlertCount: 1 },
        '离线的终端计 1 条',
      )
      assert.equal(byCode.has(`G4A-B1-${run}`), false, '甲机构看到了乙机构的终端')
      const resB = dataOf(await call('GET', '/partner/terminal-operations?period=week', { bearer: tokB })).terminals as Array<{ terminalCode: string }>
      assert.deepEqual(resB.map((row) => row.terminalCode), [`G4A-B1-${run}`])
      pass('甲机构两台：在线纸张或墨粉不足计 1 条、离线计 1 条；看不到乙机构的终端')
    }

    const logged = output.text()
    assert.equal(logged.includes(KEY_A) || logged.includes(KEY_B), false, '服务日志里出现了机器人密钥')
    pass('整个过程的服务日志里没有机器人密钥')
  } finally {
    await cleanup().catch((error: unknown) => console.error('清理夹具失败', error))
    await h.close()
    output.restore()
  }
  console.log('\nverify:org-device-alert-http PASS')
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
