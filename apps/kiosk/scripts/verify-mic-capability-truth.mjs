// ============================================================
// 门禁：麦克风能力探测必须测「设备」，不是测「API」。
//
// 守的回归是一句具体的假话。修复前 InterviewSessionPage 用
//   const micSupported = !!navigator.mediaDevices?.getUserMedia
// 判断麦克风是否可用 —— 这只说明浏览器实现了这个方法。一台没有麦克风的
// 机器上它恒为 true，界面于是默认进语音模式、显示「语音回答可用」，
// 用户点录音才抛 NotFoundError，又被统一文案说成「请检查浏览器权限」。
// 用户被指去翻浏览器设置，而那里什么都查不出来。
//
// 浏览器套件断得到「某个 stub 状态下页面显示了什么」，但断不到
// 「代码里还有没有另一条把 API 存在当设备存在的路」，也断不到
// 「新增一个能力态时有没有人忘了配文案」。所以这里做静态 + 派生检查。
//
// 本门禁不维护硬编码清单：能力态集合从 MicCapabilityState 联合类型里
// 解析出来，再要求每张文案表都覆盖它。新增一个态而忘了配文案会直接失败。
// ============================================================

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const read = (relativePath) => readFileSync(join(root, relativePath), 'utf8')

const files = {
  capability: read('src/utils/micCapability.ts'),
  session: read('src/pages/interview/InterviewSessionPage.tsx'),
  dock: read('src/pages/interview/session/InterviewAnswerDock.tsx'),
}

const failures = []
const assert = (condition, message) => { if (!condition) failures.push(message) }
const must = (key, pattern, message) => assert(
  pattern instanceof RegExp ? pattern.test(files[key]) : files[key].includes(pattern),
  `${key}: ${message}`,
)
const mustNot = (key, pattern, message) => assert(
  !(pattern instanceof RegExp ? pattern.test(files[key]) : files[key].includes(pattern)),
  `${key}: ${message}`,
)

// ── ① 能力态集合从源码解析，不在门禁里硬编码 ──────────────────────────
function parseUnionMembers(source, typeName) {
  const start = source.indexOf(`export type ${typeName} =`)
  if (start === -1) return null
  // 联合体一直延伸到第一个空行（成员之间可以夹注释）
  const block = source.slice(start).split(/\n\s*\n/)[0]
  return [...block.matchAll(/\|\s*'([^']+)'/g)].map((m) => m[1])
}

function parseRecordKeys(source, constName) {
  const start = source.indexOf(`export const ${constName}`)
  if (start === -1) return null
  const open = source.indexOf('{', start)
  let depth = 0
  let end = open
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1
    else if (source[i] === '}') { depth -= 1; if (depth === 0) { end = i; break } }
  }
  const body = source.slice(open, end)
  return [...body.matchAll(/(?:^|\n)\s*'?([A-Za-z][A-Za-z-]*)'?\s*:/g)].map((m) => m[1])
}

const states = parseUnionMembers(files.capability, 'MicCapabilityState')
assert(Array.isArray(states) && states.length >= 3, 'micCapability.ts 未导出可解析的 MicCapabilityState 联合类型')

if (states) {
  // 协调者口径：三态要分清，不得合并成两态。available 之外至少要有
  // 「没有设备」和「有设备无权限」两种互不相同的结论。
  assert(states.includes('available'), 'MicCapabilityState 缺少 available')
  assert(states.includes('no-device'), 'MicCapabilityState 缺少 no-device（没有设备）')
  assert(
    states.includes('permission-denied'),
    'MicCapabilityState 缺少 permission-denied（有设备但无权限）—— 三态不得合并成两态',
  )

  // 每个能力态都必须有状态胶囊文案与常显原因，新增态忘配文案即失败
  for (const table of ['MIC_STATUS_LABEL', 'MIC_REASON']) {
    const keys = parseRecordKeys(files.capability, table)
    assert(Array.isArray(keys), `micCapability.ts 未导出可解析的 ${table}`)
    if (!keys) continue
    for (const state of states) {
      assert(keys.includes(state), `${table} 缺少能力态 ${state} 的文案（新增态必须同步配文案）`)
    }
  }

  const failureKeys = parseRecordKeys(files.capability, 'MIC_FAILURE_REASON')
  assert(Array.isArray(failureKeys), 'micCapability.ts 未导出可解析的 MIC_FAILURE_REASON')
  if (failureKeys) {
    for (const state of states) {
      assert(failureKeys.includes(state), `MIC_FAILURE_REASON 缺少 ${state} 的归因文案`)
    }
  }
}

// ── ② 三态文案必须互不相同（合并成同一句就等于没分清） ────────────────
function parseRecordEntries(source, constName) {
  const start = source.indexOf(`export const ${constName}`)
  if (start === -1) return {}
  const open = source.indexOf('{', start)
  let depth = 0
  let end = open
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1
    else if (source[i] === '}') { depth -= 1; if (depth === 0) { end = i; break } }
  }
  const body = source.slice(open, end)
  const entries = {}
  for (const m of body.matchAll(/(?:^|\n)\s*'?([A-Za-z][A-Za-z-]*)'?\s*:\s*([\s\S]*?)(?=,\n\s*'?[A-Za-z][A-Za-z-]*'?\s*:|,?\s*$)/g)) {
    entries[m[1]] = m[2].replace(/\s+/g, ' ').trim()
  }
  return entries
}

for (const table of ['MIC_STATUS_LABEL', 'MIC_REASON', 'MIC_FAILURE_REASON']) {
  const entries = parseRecordEntries(files.capability, table)
  const noDevice = entries['no-device']
  const denied = entries['permission-denied']
  assert(
    noDevice && denied && noDevice !== denied,
    `${table}: 「没有设备」与「有设备无权限」的文案相同或缺失 —— 两种情况必须给出不同提示`,
  )
}

// 「没有设备」的文案不得把用户支使去查权限；「无权限」的文案才谈权限。
const reasons = parseRecordEntries(files.capability, 'MIC_REASON')
const failureReasons = parseRecordEntries(files.capability, 'MIC_FAILURE_REASON')
for (const [table, entries] of [['MIC_REASON', reasons], ['MIC_FAILURE_REASON', failureReasons]]) {
  const noDevice = entries['no-device'] ?? ''
  assert(
    !/权限/.test(noDevice),
    `${table}: no-device 文案里出现「权限」—— 没有麦克风时不得把用户指去翻浏览器权限设置`,
  )
  const denied = entries['permission-denied'] ?? ''
  assert(/权限/.test(denied), `${table}: permission-denied 文案未说明这是权限问题`)
}

// ── ③ 探测实现必须真的查设备 ──────────────────────────────────────────
must('capability', 'enumerateDevices', '未调用 enumerateDevices —— 探测不到设备存在与否')
must('capability', "'audioinput'", "未按 kind === 'audioinput' 过滤音频输入设备")
must('capability', /NotFoundError/, '未把 NotFoundError 归因为「没有设备」')
must('capability', /NotAllowedError/, '未把 NotAllowedError 归因为「权限问题」')
// 归因函数必须把两者分到不同结论上
const classify = files.capability.slice(files.capability.indexOf('export function classifyMicError'))
assert(
  /NotFoundError[\s\S]{0,220}?'no-device'/.test(classify),
  'classifyMicError: NotFoundError 未映射到 no-device',
)
assert(
  /NotAllowedError[\s\S]{0,220}?'permission-denied'/.test(classify),
  'classifyMicError: NotAllowedError 未映射到 permission-denied',
)

// 运行时探测，不是构建期：用户可能后插 USB 麦克风
must('capability', 'devicechange', '未订阅 devicechange —— 后插 USB 麦克风无法恢复语音入口')

// ── ④ 会话页不得再用「API 存在」当「设备存在」 ────────────────────────
mustNot(
  'session',
  /!!\s*navigator\.mediaDevices\??\.\s*getUserMedia/,
  '又把 navigator.mediaDevices.getUserMedia 的存在性当成麦克风可用（这正是本门禁要守的回归）',
)
mustNot(
  'session',
  /micSupported/,
  '残留 micSupported 变量 —— 能力判断应走 detectMicCapability',
)
must('session', 'detectMicCapability', '未使用 detectMicCapability 做能力探测')
// 不得在没有探到设备时就说「可用」
assert(
  !/'语音回答可用'/.test(files.session) || files.session.includes('MIC_STATUS_LABEL'),
  'session: 直接硬编码「语音回答可用」而未走 MIC_STATUS_LABEL 能力表',
)

// 旧的「一律说成权限问题」文案不得复活
mustNot(
  'dock',
  '无法访问麦克风，请检查浏览器权限',
  '硬编码「请检查浏览器权限」文案复活 —— 没有设备时这句是假话',
)
mustNot(
  'session',
  '无法访问麦克风，请检查浏览器权限',
  '硬编码「请检查浏览器权限」文案复活 —— 没有设备时这句是假话',
)
must('session', 'classifyMicError', '录音失败未按 error.name 归因，仍会把无设备说成权限问题')

// ── ⑤ 触屏能力门禁：aria-disabled + 常显原因 + handler 内短路 ─────────
must('dock', 'aria-disabled', '语音入口未用 aria-disabled 做能力门禁')
must('dock', 'micBlockedReason', '未接收常显原因 micBlockedReason')
must('dock', /data-mic-reason/, '缺少常显原因节点（浏览器套件据此断言）')
// 一体机没有 hover，原因不能只挂在 title 上
mustNot('dock', /title=\{?['"]?[^}]*麦克风/, '用 title 承载麦克风原因 —— 触屏没有 hover，必须常显')
// 语音入口不能因为探测不到就整个消失（用户可能后插 USB 麦克风）
mustNot(
  'dock',
  /\{voiceAvailable\s*&&\s*<Button/,
  '语音入口在不可用时被整个隐藏 —— 应置灰并常显原因，保留后插麦克风后恢复的可能',
)
must('dock', 'onRecheckMic', '缺少「重新检测麦克风」入口 —— 后插设备 / 改权限后无法恢复')
// 置灰就必须有原因：voiceAvailable 的每个 false 分支都要有对应文案，
// 包括「硬件没问题但服务端 ASR 未启用」这一支。
assert(
  /micBlockedReason\s*=[\s\S]{0,400}?asrEnabled[\s\S]{0,120}?'[^']+'/.test(files.session),
  'session: micBlockedReason 未覆盖「ASR 未启用」分支 —— 会出现置灰但无原因的按钮',
)
// aria-disabled 不会阻止点击，短路守卫必须在 handler 内部
assert(
  /onUseVoice=\{\(\)\s*=>\s*\{[\s\S]{0,400}?if\s*\(!voiceAvailable\)[\s\S]{0,200}?return/.test(files.session),
  'session: onUseVoice 缺少 handler 内短路守卫（aria-disabled 不阻止点击，按钮真能点）',
)
assert(
  /const startRecording[\s\S]{0,400}?micCapability[\s\S]{0,200}?return/.test(files.session),
  'session: startRecording 缺少能力门禁短路守卫',
)

// ── ⑥ 自注册：package.json 与 CI 都必须真的跑这条门禁 ─────────────────
const pkg = read('package.json')
const ci = readFileSync(join(root, '../../.github/workflows/ci.yml'), 'utf8')
assert(pkg.includes('"verify:mic-capability-truth"'), 'kiosk package.json 未注册 verify:mic-capability-truth')
assert(
  ci.includes('pnpm --filter @ai-job-print/kiosk verify:mic-capability-truth'),
  'CI 未注册 verify:mic-capability-truth —— 门禁不进 CI 等于没有门禁',
)
assert(
  ci.includes('pnpm --filter @ai-job-print/kiosk test:browser:mic-capability'),
  'CI 未注册 test:browser:mic-capability 浏览器套件',
)

// ── ⑦ 合规文案红线（与其他 kiosk 门禁一致） ───────────────────────────
for (const forbidden of ['一键投递', '立即投递', '平台投递', '企业收简历', '候选人管理', '面试邀约']) {
  for (const [key, source] of Object.entries(files)) {
    assert(!source.includes(forbidden), `${key}: 出现越界文案「${forbidden}」`)
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL ${failure}`)
  console.error(`\n${failures.length} mic capability truth check(s) failed`)
  process.exit(1)
}
console.log(
  `verify-mic-capability-truth passed (${Object.keys(files).length} files, ` +
    `${states ? states.length : 0} capability states derived from source)`,
)
