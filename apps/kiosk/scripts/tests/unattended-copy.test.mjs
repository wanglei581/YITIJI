/**
 * 无人值守文案与公开联系方式解析。
 * 转译真实源码来跑，不另抄一份句子。
 */
import assert from 'node:assert/strict'
import test, { mock } from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const kioskRoot = join(dirname(fileURLToPath(import.meta.url)), '../..')
const toDataUrl = (code) => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`

function transpile(absolutePath, replacements = {}) {
  let out = ts.transpileModule(readFileSync(absolutePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName: absolutePath,
  }).outputText
  for (const [specifier, url] of Object.entries(replacements)) {
    out = out.split(`'${specifier}'`).join(`'${url}'`).split(`"${specifier}"`).join(`"${url}"`)
  }
  const leftover = [...out.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]).filter((s) => !s.startsWith('data:'))
  assert.deepEqual(leftover, [], `${absolutePath} 还有没替换的运行时依赖：${leftover.join(', ')}`)
  return toDataUrl(out)
}

const copy = await import(transpile(join(kioskRoot, 'src/copy/unattendedCopy.ts')))

const none = {
  servicePhone: null,
  serviceHours: null,
  otherOnlineTerminalNearby: false,
  miniappPublished: false,
}
const phoneOnly = { ...none, servicePhone: '18369161921' }
const phoneHours = { ...phoneOnly, serviceHours: '工作日 9:00–18:00' }
const nearby = { ...phoneHours, otherOnlineTerminalNearby: true }
const published = { ...phoneHours, miniappPublished: true }

test('电话片段：有号码带时间、只有号码、没有号码', () => {
  assert.equal(copy.servicePhoneLine(phoneHours), '拨打服务电话 18369161921（工作日 9:00–18:00）')
  assert.equal(copy.servicePhoneLine(phoneOnly), '拨打服务电话 18369161921')
  assert.equal(copy.servicePhoneLine(none), '查看《隐私政策》里的联系方式')
  assert.equal(copy.servicePhoneLine(null), '查看《隐私政策》里的联系方式')
  assert.equal(copy.helpNeededLine(none), '需要帮助？查看《隐私政策》里的联系方式')
})

test('空白号码与服务时间当成没有', () => {
  assert.equal(copy.servicePhoneLine({ ...phoneHours, servicePhone: '  ', serviceHours: '  ' }), '查看《隐私政策》里的联系方式')
})

test('故障句：附近没有别的终端不写换机，小程序未发布不写手机上能看到', () => {
  const line = copy.machineCannotPrintLine(phoneHours, { orderKept: true })
  assert.match(line, /请稍后再来/)
  assert.doesNotMatch(line, /换一台机器/)
  assert.doesNotMatch(line, /手机上能看到/)
  assert.match(line, /拨打服务电话 18369161921（工作日 9:00–18:00）/)
  assert.doesNotMatch(line, /退款|已付|金额/)
})

test('故障句：附近有终端才写换机；小程序已发布且订单还在才写手机上能看到', () => {
  const far = copy.machineCannotPrintLine(nearby, { orderKept: true })
  assert.match(far, /你可以换一台机器继续，或稍后再来/)
  assert.doesNotMatch(far, /手机上能看到/)
  const both = copy.machineCannotPrintLine({ ...nearby, miniappPublished: true }, { orderKept: true })
  assert.match(both, /换一台机器/)
  assert.match(both, /这单还在，手机上能看到。/)
  const noOrder = copy.machineCannotPrintLine({ ...nearby, miniappPublished: true })
  assert.doesNotMatch(noOrder, /手机上能看到/)
})

test('暂停接单：单点位写稍后再来，附近有终端才写换一台机器', () => {
  assert.match(copy.machineUnusableLine(phoneHours), /请稍后再来，或拨打服务电话/)
  assert.doesNotMatch(copy.machineUnusableLine(phoneHours), /换一台机器/)
  assert.match(copy.machineUnusableLine(nearby), /请换一台机器，或拨打服务电话/)
})

test('完成页核查与退款句不写在手机上申请', () => {
  assert.equal(copy.printProblemLine(phoneHours), '打印有问题？拨打服务电话 18369161921（工作日 9:00–18:00），或问小青')
  const refund = copy.refundApplyLine(phoneHours)
  assert.equal(refund, '如需退款，请拨打服务电话 18369161921（工作日 9:00–18:00），我们核实后原路退回。')
  assert.doesNotMatch(refund, /在手机上申请/)
})

test('小程序未发布时不给出用手机继续', () => {
  assert.equal(copy.whenMiniapp(phoneHours, '用手机继续'), '')
  assert.equal(copy.whenMiniapp(published, '用手机继续'), '用手机继续')
})

test('续打：缺字段两句都不出现；可续打写次数；次数用尽才说不能再续打', () => {
  assert.equal(copy.reprintHintLine(undefined, undefined, phoneHours), null)
  assert.equal(copy.reprintHintLine(false, null, phoneHours), null)
  assert.equal(copy.reprintHintLine(false, 2, phoneHours), null)
  assert.equal(copy.reprintHintLine(true, 1.5, phoneHours), null)
  assert.equal(
    copy.reprintHintLine(true, 2, phoneHours),
    '没打完？同一个到机码再输一次就能接着打（还能续打 2 次）。',
  )
  assert.equal(
    copy.reprintHintLine(false, 0, phoneHours),
    '这单不能再续打了，回到订单重新打印，或拨打服务电话 18369161921（工作日 9:00–18:00）。',
  )
})

test('readReprintFields 缺字段保持 undefined，不把缺省当成 false', () => {
  assert.deepEqual(copy.readReprintFields({}), { reprintAllowed: undefined, reprintRemaining: undefined })
  assert.deepEqual(copy.readReprintFields({ reprintAllowed: false, reprintRemaining: 0 }), {
    reprintAllowed: false,
    reprintRemaining: 0,
  })
  assert.deepEqual(copy.readReprintFields(null), { reprintAllowed: undefined, reprintRemaining: undefined })
})

test('服务端原话叫人找现场工作人员时换成登记句，干净原话留下', () => {
  assert.equal(copy.preferUnattended('请找现场工作人员', '标准句'), '标准句')
  assert.equal(copy.preferUnattended('请向现场工作人员出示', '标准句'), '标准句')
  assert.equal(copy.preferUnattended('本机暂停接单，请稍后再来', '标准句'), '本机暂停接单，请稍后再来')
  assert.equal(copy.UNATTENDED_FORBIDDEN_PHRASES.includes('取件凭证码'), true)
  assert.equal(copy.containsStaffHandoff('缺纸时一体机会自动停止接单'), true)
})

const clientStub = toDataUrl('export const API_BASE_URL = "/api/v1"')
// 终端身份桩：号由 globalThis.__kioskTerminalId 给，改完调 globalThis.__fireTerminalIdentity() 通知订阅者（对应 screensaver.ts 的 subscribeTerminalIdentity）。
const screenStub = toDataUrl(`
const listeners = new Set()
export function getTerminalId() { return globalThis.__kioskTerminalId || "" }
export function subscribeTerminalIdentity(listener) { listeners.add(listener); return () => listeners.delete(listener) }
globalThis.__fireTerminalIdentity = () => { for (const listener of [...listeners]) listener() }
`)
const contactMod = await import(transpile(join(kioskRoot, 'src/services/api/supportContact.ts'), {
  '../../copy/unattendedCopy': transpile(join(kioskRoot, 'src/copy/unattendedCopy.ts')),
  './client': clientStub,
  './screensaver': screenStub,
}))

test('文案层 resolveSupportContact：缺字段或非布尔一律按保守值，不把缺省当成已发布 / 附近有终端', () => {
  const partial = copy.resolveSupportContact({ servicePhone: ' 18369161921 ', serviceHours: '', otherOnlineTerminalNearby: true })
  assert.equal(partial.servicePhone, '18369161921')
  assert.equal(partial.serviceHours, null)
  assert.equal(partial.otherOnlineTerminalNearby, true)
  assert.equal(partial.miniappPublished, false, '小程序发布字段缺失不能当成已发布')
  const truthy = copy.resolveSupportContact({ servicePhone: null, serviceHours: null, otherOnlineTerminalNearby: 'yes', miniappPublished: 1 })
  assert.equal(truthy.otherOnlineTerminalNearby, false)
  assert.equal(truthy.miniappPublished, false)
  assert.deepEqual(copy.resolveSupportContact(null), copy.CONSERVATIVE_SUPPORT_CONTACT)
})

test('联系方式缺字段按保守值，布尔只有 true 才当真', () => {
  assert.deepEqual(contactMod.supportContactFromPayload({ success: true, data: { servicePhone: '18369161921' } }), {
    servicePhone: '18369161921',
    serviceHours: null,
    otherOnlineTerminalNearby: false,
    miniappPublished: false,
  })
  assert.equal(contactMod.supportContactFromPayload({ success: true, data: { otherOnlineTerminalNearby: 'yes' } }).otherOnlineTerminalNearby, false)
  assert.deepEqual(contactMod.supportContactFromPayload({ success: true }), copy.CONSERVATIVE_SUPPORT_CONTACT)
})

test('联系方式 404 与超时都缓存成最保守的一套', async () => {
  contactMod.resetSupportContactCacheForTests()
  globalThis.__kioskTerminalId = 'KSK-001'
  const original = globalThis.fetch
  try {
    globalThis.fetch = async (url) => {
      assert.match(String(url), /\/api\/v1\/public\/support-contact\?terminalId=KSK-001$/)
      return new Response('missing', { status: 404 })
    }
    const missed = await contactMod.loadSupportContact()
    assert.deepEqual(missed, copy.CONSERVATIVE_SUPPORT_CONTACT)

    contactMod.resetSupportContactCacheForTests()
    globalThis.fetch = (_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
    })
    const timed = await contactMod.loadSupportContact()
    assert.deepEqual(timed, copy.CONSERVATIVE_SUPPORT_CONTACT)
  } finally {
    globalThis.fetch = original
    delete globalThis.__kioskTerminalId
    contactMod.resetSupportContactCacheForTests()
  }
})

// ── 运行时根读取与续期（startSupportContactKeeper）、订阅与终端号切换 ──────────────────────────
const PHONE_A = '18369161921'
const PHONE_B = '13800138000'
const HOURS = '工作日 9:00–18:00'
const flush = () => new Promise((resolve) => setImmediate(resolve))
const contactBody = (servicePhone, serviceHours = HOURS) =>
  new Response(JSON.stringify({
    success: true,
    data: { servicePhone, serviceHours, otherOnlineTerminalNearby: false, miniappPublished: false },
  }), { status: 200, headers: { 'content-type': 'application/json' } })

/** 装一个假 fetch，记下每次请求带的终端号（没带为 null）。 */
function installContactFetch(respond) {
  const calls = []
  globalThis.fetch = async (url) => {
    const terminalId = new URL(String(url), 'http://kiosk.test').searchParams.get('terminalId')
    calls.push(terminalId)
    return respond(terminalId, calls.length)
  }
  return calls
}

async function withContactSandbox(run) {
  const original = globalThis.fetch
  contactMod.resetSupportContactCacheForTests()
  globalThis.__kioskTerminalId = 'KSK-001'
  try {
    await run()
  } finally {
    mock.timers.reset()
    globalThis.fetch = original
    delete globalThis.__kioskTerminalId
    contactMod.resetSupportContactCacheForTests()
  }
}

test('订阅：号码到了、被后台改了、被清空都通知；值没变的续期不通知也不换对象', async () => {
  await withContactSandbox(async () => {
    let phone = PHONE_A
    installContactFetch(() => contactBody(phone))
    let notified = 0
    const unsubscribe = contactMod.subscribeSupportContact(() => { notified += 1 })
    try {
      assert.equal(contactMod.peekSupportContact(), copy.CONSERVATIVE_SUPPORT_CONTACT, '还没读到之前是保守值')
      await contactMod.loadSupportContact()
      assert.equal(notified, 1, '号码到了要通知')
      assert.equal(contactMod.peekSupportContact().servicePhone, PHONE_A)
      assert.match(copy.machineUnusableLine(), new RegExp(`拨打服务电话 ${PHONE_A}（${HOURS}）`), '文案层省略写法读到同一份缓存')

      const held = contactMod.peekSupportContact()
      await contactMod.refreshSupportContact()
      assert.equal(notified, 1, '值没变的续期不通知')
      assert.equal(contactMod.peekSupportContact(), held, '值没变就沿用旧对象，订阅者不白白重绘')

      phone = PHONE_B
      await contactMod.refreshSupportContact()
      assert.equal(notified, 2, '后台改了号码要通知')
      assert.equal(contactMod.peekSupportContact().servicePhone, PHONE_B)

      phone = null
      await contactMod.refreshSupportContact()
      assert.equal(notified, 3, '后台清空号码也要通知')
      assert.equal(contactMod.peekSupportContact().servicePhone, null)
      assert.match(copy.machineUnusableLine(), /查看《隐私政策》里的联系方式/, '清空后回到保守句')

      unsubscribe()
      phone = PHONE_A
      await contactMod.refreshSupportContact()
      assert.equal(notified, 3, '取消订阅后不再通知')
    } finally {
      unsubscribe()
    }
  })
})

test('运行时根：挂载读一次（带终端号），每 4 分钟强制续一次，缓存不断档，卸载后不再读', async () => {
  await withContactSandbox(async () => {
    mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'], now: 1_000_000 })
    const calls = installContactFetch(() => contactBody(PHONE_A))
    const stop = contactMod.startSupportContactKeeper()
    try {
      await flush()
      assert.deepEqual(calls, ['KSK-001'], '挂载时读一次，带终端号')
      assert.equal(contactMod.peekSupportContact().servicePhone, PHONE_A)

      mock.timers.tick(contactMod.SUPPORT_CONTACT_RENEW_MS - 1)
      await flush()
      assert.equal(calls.length, 1, '没到续期点不读')
      mock.timers.tick(1)
      await flush()
      assert.equal(calls.length, 2, '到点强制续一次——此刻 5 分钟缓存还没过期，不强制就根本不会去读')

      // 续期之后再过一个周期仍有号码：每一次续期都发生在缓存过期之前，中间没有掉回保守句的空档。
      for (let round = 3; round <= 5; round += 1) {
        mock.timers.tick(contactMod.SUPPORT_CONTACT_RENEW_MS)
        await flush()
        assert.equal(calls.length, round)
        assert.equal(contactMod.peekSupportContact().servicePhone, PHONE_A, `第 ${round} 次续期后缓存仍新`)
      }

      stop()
      mock.timers.tick(contactMod.SUPPORT_CONTACT_RENEW_MS * 2)
      await flush()
      assert.equal(calls.length, 5, '卸载后不再读')
    } finally {
      stop()
    }
  })
})

test('运行时根：开发版 StrictMode 的挂载→卸载→再挂载只有一次读取、一个续期计时', async () => {
  await withContactSandbox(async () => {
    mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'], now: 1_000_000 })
    const calls = installContactFetch(() => contactBody(PHONE_A))
    contactMod.startSupportContactKeeper()()
    const stop = contactMod.startSupportContactKeeper()
    try {
      await flush()
      assert.equal(calls.length, 1)
      mock.timers.tick(contactMod.SUPPORT_CONTACT_RENEW_MS)
      await flush()
      assert.equal(calls.length, 2, '第一次挂载的计时已随卸载停掉，只剩一个')
    } finally {
      stop()
    }
  })
})

test('终端号变了：旧号缓存立刻作废、订阅者回到保守值、按新号重读；旧号晚到的结果盖不掉新号', async () => {
  await withContactSandbox(async () => {
    let releaseOld = () => {}
    const calls = installContactFetch((terminalId) => terminalId === 'KSK-001'
      ? new Promise((resolve) => { releaseOld = () => resolve(contactBody(PHONE_A)) })
      : contactBody(PHONE_B))
    const seen = []
    const unsubscribe = contactMod.subscribeSupportContact(() => { seen.push(contactMod.peekSupportContact().servicePhone) })
    const stop = contactMod.startSupportContactKeeper()
    try {
      await flush()
      assert.deepEqual(calls, ['KSK-001'], '旧号的请求还没回来')

      globalThis.__kioskTerminalId = 'KSK-002'
      globalThis.__fireTerminalIdentity()
      await flush()
      assert.deepEqual(calls, ['KSK-001', 'KSK-002'], '换号后按新号重读，不等续期计时')
      assert.equal(contactMod.peekSupportContact().servicePhone, PHONE_B)

      releaseOld()
      await flush()
      assert.equal(contactMod.peekSupportContact().servicePhone, PHONE_B, '旧号晚到的结果不进缓存')
      assert.deepEqual(seen, [null, PHONE_B], '订阅者先回到保守值（没号码），再拿到新号的结果；旧号的号码一次也没闪过')
    } finally {
      stop()
      unsubscribe()
    }
  })
})

test('终端号变了而根没在跑：缓存认终端号，换号后不复用旧号的结果', async () => {
  await withContactSandbox(async () => {
    const calls = installContactFetch((terminalId) => contactBody(terminalId === 'KSK-001' ? PHONE_A : PHONE_B))
    await contactMod.loadSupportContact()
    assert.equal(contactMod.peekSupportContact().servicePhone, PHONE_A)

    globalThis.__kioskTerminalId = 'KSK-002'
    assert.equal(contactMod.peekSupportContact(), copy.CONSERVATIVE_SUPPORT_CONTACT, '换号后旧号的缓存不算数')
    const reloaded = await contactMod.loadSupportContact()
    assert.equal(reloaded.servicePhone, PHONE_B)
    assert.deepEqual(calls, ['KSK-001', 'KSK-002'])
  })
})

test('没有终端身份时也读（机器未登记正是需要电话的时候），身份到了再带终端号重读', async () => {
  await withContactSandbox(async () => {
    globalThis.__kioskTerminalId = ''
    const calls = installContactFetch((terminalId) => contactBody(terminalId ? PHONE_B : PHONE_A))
    const stop = contactMod.startSupportContactKeeper()
    try {
      await flush()
      assert.deepEqual(calls, [null], '没有终端号时请求不带 terminalId')
      assert.equal(contactMod.peekSupportContact().servicePhone, PHONE_A)

      globalThis.__kioskTerminalId = 'KSK-001'
      globalThis.__fireTerminalIdentity()
      await flush()
      assert.deepEqual(calls, [null, 'KSK-001'])
      assert.equal(contactMod.peekSupportContact().servicePhone, PHONE_B)
    } finally {
      stop()
    }
  })
})
