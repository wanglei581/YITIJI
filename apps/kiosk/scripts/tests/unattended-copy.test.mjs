/**
 * 无人值守文案与公开联系方式解析。
 * 转译真实源码来跑，不另抄一份句子。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
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
    '这单不能再接着打了。还要打，请重新下单，或拨打服务电话 18369161921（工作日 9:00–18:00）。',
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

test('10/9 漏掉的两种说法进了词表：问工作人员、工作人员会核实后现场处理', () => {
  assert.equal(copy.containsStaffHandoff('问工作人员'), true)
  assert.equal(copy.containsStaffHandoff('选择这次遇到的问题，工作人员会核实后现场处理'), true)
  assert.equal(copy.containsStaffHandoff('卡纸需要现场处理'), true)
  assert.equal(copy.preferUnattended('码找不到可以问工作人员', '标准句'), '标准句')
  // 现在页面上的两句不能被自己的词表拦住。
  assert.equal(copy.containsStaffHandoff('求助'), false)
  assert.equal(copy.containsStaffHandoff('联系我们或问小青'), false)
  assert.equal(copy.containsStaffHandoff(`选择这次遇到的问题。${copy.helpNeededLine(null)}`), false)
})

const clientStub = toDataUrl('export const API_BASE_URL = "/api/v1"')
const screenStub = toDataUrl('export function getTerminalId() { return globalThis.__kioskTerminalId || "" }')
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
    let seenRequest
    globalThis.fetch = async (url, init) => {
      seenRequest = { url, init }
      return new Response('missing', { status: 404 })
    }
    const missed = await contactMod.loadSupportContact()
    // 请求函数会捕获 fetch 失败；必须在外面断言，避免断言失败也被当成保守回落。
    assert.ok(seenRequest, '必须真发出联系方式请求')
    assert.match(String(seenRequest.url), /\/api\/v1\/public\/support-contact\?terminalId=KSK-001$/)
    assert.equal(seenRequest.init.credentials, 'omit', '公开联系方式不携带浏览器身份凭证')
    assert.deepEqual(seenRequest.init.headers, { Accept: 'application/json' }, '公开联系方式不附加会员鉴权头')
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

// 2026-10-11（合规 10/10 定字）：断网时远程指令到不了机器，帮助页是说明书、不写「我们已经收到提醒」。
test('断网句不承诺收到提醒和远程处理；帮助页不写机器故障已收到提醒', async () => {
  assert.equal(copy.networkDisconnectLine(), '网络断开时，这台机器暂时办不了需要联网的事，请稍后再来')
  const { readdirSync, statSync } = await import('node:fs')
  const stripComments = (code) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const walk = (dir) => readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    return statSync(full).isDirectory() ? walk(full) : /\.tsx?$/.test(name) ? [full] : []
  })
  const files = walk(join(kioskRoot, 'src'))
  assert.ok(files.length > 300, `源码文件数不对：${files.length}`)
  for (const file of files) {
    const code = stripComments(readFileSync(file, 'utf8'))
    assert.doesNotMatch(code, /远程处理/, `${file} 不得再说「远程处理」`)
    assert.doesNotMatch(code, /机器故障我们(?:已经|会)收到提醒/, `${file} 不得再写「机器故障我们已经收到提醒」`)
  }
  const help = readFileSync(join(kioskRoot, 'src/pages/help/HelpCenterPage.tsx'), 'utf8')
  assert.match(help, /hint="打不了请稍后再来"/)
  assert.match(help, /机器暂时打不了时，请稍后再来。/)
  const status = readFileSync(join(kioskRoot, 'src/pages/placeholders/ErrorOfflinePage.tsx'), 'utf8')
  assert.match(status, /写个时间只会让你白等。\{networkDisconnectLine\(\)\}。/)
})

// 2026-10-13（合规十 10/12 答复第四节 B，第八次 #1397）：
// 查询超时只是本机 10 分钟没问到结果，告警推送并不认这种状态，不能说「已经收到提醒」。
// 06 号稿跟上帮助页运行页：说明书不写「机器故障我们已经收到提醒」，断网也不写「收到提醒并远程处理」。
test('查询超时屏和 06、15 号稿不把未确认的状态说成已经收到提醒', () => {
  const stripComments = (code) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const progress = stripComments(readFileSync(join(kioskRoot, 'src/pages/print/components/PrintProgressSections.tsx'), 'utf8'))
  assert.doesNotMatch(progress, /machineCannotPrintLine/)
  assert.doesNotMatch(progress, /已经收到提醒|暂时打不了/)
  assert.match(progress, /可以先重新查询。\{helpNeededLine\(\)\}。/)
  assert.match(progress, /请先看出纸口。\{helpNeededLine\(\)\}。/)
  assert.match(progress, /请先看出纸口。\{refundApplyLine\(\)\}/)

  const draftRoot = join(kioskRoot, '../../docs/design/kiosk-redesign-2026-08-v2')
  const helpDraft = readFileSync(join(draftRoot, '06-help.html'), 'utf8')
  assert.doesNotMatch(helpDraft, /已经收到提醒/)
  assert.doesNotMatch(helpDraft, /收到提醒并远程处理/)
  assert.doesNotMatch(helpDraft, /机器故障我们会收到提醒/)
  assert.match(helpDraft, /hint">打不了请稍后再来</)
  assert.match(helpDraft, /机器暂时打不了时，请稍后再来。/)
  assert.match(helpDraft, /网络断开时，这台机器暂时办不了需要联网的事，请稍后再来。/)
  assert.match(helpDraft, /或者用下面的 AI 顾问把问题说一遍。需要帮助？/)
  assert.match(helpDraft, /连着两次都打不开。需要帮助？/)
  assert.doesNotMatch(helpDraft, /连着两次都打不开。需要帮助？[^<]*已经收到提醒/)

  const fulfill = readFileSync(join(draftRoot, '15-print-fulfill.html'), 'utf8')
  const timeoutStart = fulfill.indexOf('function rTimeout()')
  const timeoutEnd = fulfill.indexOf('function rUnconfirmed()')
  assert.ok(timeoutStart >= 0 && timeoutEnd > timeoutStart, '15 号稿须有 rTimeout')
  const timeout = fulfill.slice(timeoutStart, timeoutEnd)
  assert.match(timeout, /可以先重新查询。需要帮助？拨打服务电话/)
  // 稿的费用条画的是已付那一单（moneyBar 写死「支付状态 已支付」并自动接退款句），
  // 对的是运行页已付那支「请先看出纸口。{refundApplyLine()}」，实参只留「请先看出纸口。」；
  // 再加求助句会和后面的退款句各报一遍电话，两支都对不上。
  assert.match(timeout, /moneyBar\('请先看出纸口。'\)/)
  assert.doesNotMatch(timeout, /已经收到提醒|暂时打不了/)
})

// 2026-10-13 回话单第 25 条（第八次）：帮助中心补四问。问句、答句、两条概要都是定字，
// 不许改字、不许加句。第 2 问必须夹在「怎么打印文件？」和「扫描的文件保存在哪里？」之间，
// 挪到扫描那条后面这条要红。06 号稿去掉 <b> 后答句必须与运行页整句相同。
test('帮助中心四问按定字写在运行页和 06 号稿，答句不叫人、不说提醒、不说退款', () => {
  const help = readFileSync(join(kioskRoot, 'src/pages/help/HelpCenterPage.tsx'), 'utf8')
  const draft = readFileSync(join(kioskRoot, '../../docs/design/kiosk-redesign-2026-08-v2/06-help.html'), 'utf8')
  const faqs = [
    ['收不到短信验证码怎么办？', '先核对手机号有没有输错。验证码 6 位、5 分钟内有效，60 秒后可以重新获取；也看看手机有没有把短信拦进了骚扰短信。还是收不到，可以先不登录继续用——打印、扫描、复印、机构官方渠道和政策查询都不需要账号；也可以改用扫码登录，在手机上确认。', '先不登录继续用'],
    ['打印时卡纸了怎么办？', '别自己打开机器，也别拽纸——撕在里面更难取，也可能弄坏机器。先把出纸口里已经出来的纸取走收好，记下屏幕上的订单号。用到机码打印、屏上提示可以接着打的，回到这台机器再输一次同一个到机码就能接着打，每单最多 2 次。需要帮助请看本页「遇到问题怎么办」里的服务电话。', '别自己打开机器，也别拽纸'],
    ['确认打印以后没出纸怎么办？', '先看屏幕上这一单的状态：还在打印的，请在出纸口旁等一会儿。屏上写「打印结果未确认」时，照屏上的提示办：用到机码打印的，过 5 分钟回这台机器再输一次同一个到机码；在这台机器上打的 0 元单，可以回到打印重新选文件再打一次。登录过的，可以在「我的 → 打印订单」按订单号查。付过钱的单子先别重新下单，照屏上提示办，或打服务电话问。需要帮助请看本页「遇到问题怎么办」里的服务电话。', '付过钱的单子先别重新下单'],
    ['U 盘插上了读不出来怎么办？', '这台机器开通了 U 盘导入的，U 盘插在机器右侧的 USB 口。屏上只列最外层和下一层文件夹里能打印的文件（PDF、JPG、PNG，单份不超过 15MB）。读不出来先点「重新读一次 U 盘」，或换个 U 盘再读一次；还不行就改用手机扫码上传。', '重新读一次 U 盘'],
  ]
  const banned = ['工作人员', '现场', '已经收到提醒', '会收到提醒', '退款']
  assert.ok(help.includes("summary: '要不要登录、收不到验证码、为什么变回游客、怎么换账号'"))
  assert.ok(help.includes("summary: '怎么打印、卡纸和没出纸、U 盘读不出、扫描件保存在哪'"))
  assert.ok(draft.includes("brief:'要不要登录、收不到验证码、为什么会退出、怎么换账号'"))
  assert.ok(draft.includes("brief:'怎么打印、卡纸和没出纸、U 盘读不出、到机码在哪用、扫描件去哪了'"))

  const answerIn = (source, question) => {
    const at = source.indexOf(`q: '${question}'`)
    assert.ok(at >= 0, `运行页缺少问句 ${question}`)
    const block = source.slice(at, source.indexOf('},', at))
    assert.equal(block.includes('link'), false, `${question} 不带入口按钮`)
    const matched = block.match(/a: '([^']*)'/)
    assert.ok(matched, `运行页缺少答句 ${question}`)
    return matched[1]
  }
  const draftAnswer = (question) => {
    const token = `['${question}','`
    const start = draft.indexOf(token)
    assert.ok(start >= 0, `06 号稿缺少问句 ${question}`)
    const from = start + token.length
    let end = from
    while (end < draft.length && draft[end] !== "'") end += draft[end] === '\\' ? 2 : 1
    return draft.slice(from, end)
  }

  for (const [question, answer, emphasis] of faqs) {
    const runtime = answerIn(help, question)
    assert.equal(runtime, answer, question)
    for (const word of banned) assert.equal(runtime.includes(word), false, `${question} 答句不得含「${word}」`)
    const raw = draftAnswer(question)
    assert.deepEqual(raw.match(/<b>[^<]*<\/b>/g), [`<b>${emphasis}</b>`], `${question} 稿里只强调这一处`)
    assert.equal(raw.replace(/<\/?b>/g, ''), answer, `06 号稿去掉强调后应与运行页同句：${question}`)
  }
  if (draftAnswer(faqs[3][0]).includes('「<b>重新读一次 U 盘</b>」') === false) {
    assert.fail('第 4 问的强调必须包在「」里面的「重新读一次 U 盘」')
  }

  const runtimeOrder = [
    '一定要登录才能使用吗？',
    '收不到短信验证码怎么办？',
    '为什么离开或刷新后又变回游客了？',
    '怎么打印文件？',
    '打印时卡纸了怎么办？',
    '确认打印以后没出纸怎么办？',
    'U 盘插上了读不出来怎么办？',
    '扫描的文件保存在哪里？',
  ]
  let seen = -1
  for (const question of runtimeOrder) {
    const at = help.indexOf(`q: '${question}'`)
    assert.ok(at > seen, `${question} 的位置不对`)
    seen = at
  }
  const draftOrder = [
    '一定要登录才能用吗？',
    '收不到短信验证码怎么办？',
    '为什么离开一下就变回未登录了？',
    '怎么打印文件？',
    '打印时卡纸了怎么办？',
    '确认打印以后没出纸怎么办？',
    'U 盘插上了读不出来怎么办？',
    '手机上建的单，到机器上怎么用？',
  ]
  seen = -1
  for (const question of draftOrder) {
    const at = draft.indexOf(`['${question}'`)
    assert.ok(at > seen, `06 号稿 ${question} 的位置不对`)
    seen = at
  }
})
