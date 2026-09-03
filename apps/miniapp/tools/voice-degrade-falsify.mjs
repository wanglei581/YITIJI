#!/usr/bin/env node
/**
 * 语音简历「降级链路」运行时证伪。**不是门禁**——同 tools/devtools-probe.mjs，
 * 需要微信开发者工具在本机跑着，所以不进 CI、不挂 verify:static、不起 verify:* 名。
 *
 * 它证明什么（无手机、无麦克风即可复现）：
 *   R1 录音同意没勾 → 点「同意并试音」停在 consent，不偷偷进录音
 *   R2 勾了 → 要么进试音，要么授权被拒直接整场手打；不允许「点了没反应」
 *   R3 点「用手打」→ textOnly=true 且人还在本页，功能不消失
 *   R4 试音第一次不对给重试，第二次不对整场降级（不让人白说三分钟）
 *   R5 降级后连过全部题目：qVoice 恒 false，且没有一题卡住不前进
 *   R6 正常态确有语音题（反恒真对照——否则上面那条什么都没证明）
 *   R7 敏感题（手机号）任何状态下都不开语音
 *   R9 授权查询挂死（success/fail 都不触发）时，5 秒内退化成整场手打，
 *      而不是让用户点完「同意并试音」对着不动的页面等
 *
 * 它证明不了（必须真机，别拿这份当验收）：
 *   RecorderManager 真实采集产物、iOS/Android 授权弹窗时序、拒绝后二次引导、
 *   60s 上限与弱网 uploadFile、基础库版本差异、大厅噪声与口音。
 *   隐私指引未声明麦克风时，微信底层到底抛什么错误码、是 fail 还是整个挡下——
 *   R8 只证明「挂死」这一种形态有兜底，不证明真机上就是这种形态。
 *
 * 用法（开发者工具须已 `cli auto --project <本目录> --auto-port 9520` 常驻）：
 *   MP_AUTOMATOR=/path/to/miniprogram-automator node tools/voice-degrade-falsify.mjs --port 9520
 *
 * 踩过的坑：
 *   1. agreeVoice 是异步的（ensureRecordAuth().then）。调完立刻读 data 会读到旧值，
 *      看起来像「勾选了也进不去」的假缺陷。必须等。
 *   2. page.$$() 在这个 automator/工具组合下挂死。DOM 存在性断言一律改成读 data 不变量，
 *      配合 wxml 里 wx:if="{{qVoice && ...}}" 的静态事实一起成立。
 *   3. 每条断言前 reLaunch 重进页面，否则上一条注入的 data 会污染下一条。
 *   4. 反恒真对照不能省：只断言「降级后没有语音题」，在题库全是手打题时也会绿。
 */
import { createRequire } from 'node:module'

const require_ = createRequire(import.meta.url)
const spec = process.env.MP_AUTOMATOR || 'miniprogram-automator'
let automator
try {
  automator = require_(spec)
  automator = automator.default || automator
} catch (e) {
  console.error('找不到 miniprogram-automator。它不能进 apps/miniapp（本目录必须零依赖），')
  console.error('装在别处后用 MP_AUTOMATOR=<安装目录> 指过来。原始错误：' + e.message)
  process.exit(2)
}
const argPort = (() => {
  const i = process.argv.indexOf('--port')
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : '9520'
})()

const ROUTE = '/pages/resume-voice/resume-voice'
let pass = 0, fail = 0
const ok  = (n, d='') => { pass++; console.log(`  ✓ ${n}${d?'  '+d:''}`) }
const bad = (n, d='') => { fail++; console.log(`  ✗ ${n}${d?'  '+d:''}`) }

setTimeout(() => { console.log('!! 超时自杀'); process.exit(3) }, 100000) // AUTOKILL
const mp = await automator.connect({ wsEndpoint: `ws://127.0.0.1:${argPort}` })

// 每条断言前重进页面，保证互不污染
async function fresh(patch) {
  await mp.reLaunch(ROUTE)
  await new Promise(r => setTimeout(r, 600))
  if (patch) {
    await mp.evaluate(function (p) {
      const s = getCurrentPages(); s[s.length - 1].setData(p)
    }, patch)
    await new Promise(r => setTimeout(r, 300))
  }
  return mp.currentPage()
}
const read = () => mp.evaluate(function () {
  const s = getCurrentPages(); const pg = s[s.length - 1]
  return { phase: pg.data.phase, textOnly: pg.data.textOnly, qVoice: pg.data.qVoice,
           reason: pg.data.textOnlyReason, route: pg.route }
})
const call = (fn, times = 1) => mp.evaluate(function (f, n) {
  const s = getCurrentPages(); const pg = s[s.length - 1]
  for (let i = 0; i < n; i++) pg[f]()
  return { phase: pg.data.phase, textOnly: pg.data.textOnly, qVoice: pg.data.qVoice,
           probeTries: pg.data.probeTries, route: pg.route, reason: pg.data.textOnlyReason }
}, fn, times)

// 页面上可见的录音入口文案
async function recEntries() {
  const pg = await mp.currentPage()
  const els = await pg.$$('.btn')
  const out = []
  for (const e of els) { try { out.push((await e.text()) || '') } catch {} }
  return out.filter(t => /开始录音|开始试音|结束录音|结束试音/.test(t))
}

console.log('R1 同意未勾选 → 不得进入试音')
await fresh({ phase: 'consent', consentChecked: false })
let r = await call('agreeVoice')
r.phase === 'consent' ? ok('未勾选点「同意并试音」停在 consent') : bad('未勾选竟进入 ' + r.phase)

console.log('R2 勾选后 → 授权结果必须落到两种诚实结局之一，不得卡死')
await fresh({ phase: 'consent', consentChecked: true })
await call('agreeVoice')
await new Promise(z => setTimeout(z, 1500))
r = await read()
if (r.phase === 'probe' && r.textOnly === false) ok('授权通过 → 进入强制试音')
else if (r.phase === 'ask' && r.textOnly === true) ok('授权被拒 → 整场手打（红线3）', JSON.stringify(r.reason))
else bad('卡死：既没进试音也没降级', JSON.stringify(r))

console.log('R3 拒绝录音 → 整场手打，功能仍在（不跳走）')
await fresh({ phase: 'consent', consentChecked: false })
r = await call('refuseVoice')
r.textOnly === true ? ok('textOnly=true') : bad('拒绝后 textOnly=' + r.textOnly)
r.route.indexOf('resume-voice') >= 0 ? ok('仍在本页，未把人踢走', r.route) : bad('被跳走到 ' + r.route)

console.log('R4 试音两次「不是」→ 整场降级手打')
await fresh({ phase: 'probe', consentChecked: true, probeTries: 0, recStatus: 'ready', transcript: '测试转写' })
r = await call('probeNo')
r.textOnly === false ? ok('第一次「不是」不降级，给重试', 'tries=' + r.probeTries) : bad('第一次就降级了')
r = await call('probeNo')
r.textOnly === true ? ok('第二次「不是」整场降级', JSON.stringify(r.reason)) : bad('两次失败仍未降级')

console.log('R5/R6/R7 降级后连过全部题目：qVoice 必须恒 false，且题目照常走完')
await fresh({ phase: 'consent', consentChecked: false })
await call('refuseVoice')
const trail = []
for (let i = 0; i < 40; i++) {
  const st = await mp.evaluate(function () {
    const s = getCurrentPages(); const pg = s[s.length - 1]
    return { q: pg.data.qTitle, v: pg.data.qVoice, sens: pg.data.qSensitive,
             phase: pg.data.phase, idx: pg.data.qIndex, skip: pg.data.qSkippable }
  })
  if (st.phase !== 'ask') break
  trail.push(st)
  await mp.evaluate(function () {
    const s = getCurrentPages(); const pg = s[s.length - 1]
    if (pg.data.qSkippable) pg.skipQuestion()
    else { pg.setData({ typedText: '占位内容' }); pg.confirmTyped() }
  })
  await new Promise(z => setTimeout(z, 260))
  const nx = await mp.evaluate(function () {
    const s = getCurrentPages(); const pg = s[s.length - 1]
    return { idx: pg.data.qIndex, phase: pg.data.phase }
  })
  if (nx.phase === 'ask' && nx.idx === st.idx) { bad('第 ' + (i+1) + ' 题「' + st.q + '」卡住不前进'); break }
}
trail.length >= 3 ? ok('降级后连过 ' + trail.length + ' 题未卡死') : bad('只走了 ' + trail.length + ' 题')
const voiceLeak = trail.filter(t => t.v === true)
voiceLeak.length === 0 ? ok('全程 qVoice 恒 false（无录音入口）')
                       : bad('降级后仍有语音题: ' + JSON.stringify(voiceLeak.map(t => t.q)))
console.log('   走过的题：' + trail.map(t => t.q).join(' / '))

console.log('R8 正常态对照：不降级时敏感题仍不得开语音（防上面恒真）')
await fresh({ phase: 'consent', consentChecked: true })
await call('agreeVoice')
await new Promise(z => setTimeout(z, 1200))
await mp.evaluate(function () {
  const s = getCurrentPages(); const pg = s[s.length - 1]
  pg.setData({ phase: 'ask' }); pg._showQuestion(0)
})
await new Promise(z => setTimeout(z, 400))
const norm = []
for (let i = 0; i < 40; i++) {
  const st = await mp.evaluate(function () {
    const s = getCurrentPages(); const pg = s[s.length - 1]
    return { q: pg.data.qTitle, v: pg.data.qVoice, sens: pg.data.qSensitive,
             phase: pg.data.phase, idx: pg.data.qIndex }
  })
  if (st.phase !== 'ask') break
  norm.push(st)
  await mp.evaluate(function () {
    const s = getCurrentPages(); const pg = s[s.length - 1]
    if (pg.data.qSkippable) pg.skipQuestion()
    else { pg.setData({ typedText: '占位内容' }); pg.confirmTyped() }
  })
  await new Promise(z => setTimeout(z, 260))
}
const anyVoice = norm.filter(t => t.v === true)
anyVoice.length > 0 ? ok('正常态确有语音题 ' + anyVoice.length + ' 道 —— 上面的「恒 false」是真降级')
                    : bad('正常态也没有语音题 —— R5/R7 是恒真的，证不了任何事')
const sensVoice = norm.filter(t => t.sens === true && t.v === true)
sensVoice.length === 0 ? ok('敏感题一道都没开语音', norm.filter(t=>t.sens).map(t=>t.q).join('/') || '(无敏感题)')
                       : bad('敏感题开了语音: ' + JSON.stringify(sensVoice.map(t => t.q)))

console.log('R9 授权查询挂死时必须退化成手打，不得让人干等')
await fresh({ phase: 'consent', consentChecked: true })
await mp.evaluate(function () {
  // 故意换成两个回调都不触发的桩：隐私指引未声明麦克风时观察到过这种形态
  wx.__origGetSetting = wx.getSetting
  wx.getSetting = function () {}
})
await call('agreeVoice')
let hung = null
const t0 = Date.now()
for (let i = 0; i < 14; i++) {
  await new Promise(z => setTimeout(z, 700))
  hung = await read()
  if (hung.textOnly === true || hung.phase === 'probe') break
}
const elapsed = Date.now() - t0
await mp.evaluate(function () { if (wx.__origGetSetting) wx.getSetting = wx.__origGetSetting })
hung && hung.textOnly === true
  ? ok('挂死 ' + elapsed + 'ms 后退化成整场手打', JSON.stringify(hung.reason))
  : bad('卡住不动：点完「同意并试音」既没进试音也没降级', JSON.stringify(hung))

await mp.disconnect()
console.log(`\n${pass} PASS / ${fail} FAIL`)
process.exit(fail ? 1 : 0)
