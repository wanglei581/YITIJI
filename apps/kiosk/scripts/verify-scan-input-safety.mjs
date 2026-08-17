// 门禁：扫码输入安全（FIX-SCAN-SAFETY）
//
// 守两条硬约束，任何一条回退都必须让 CI 红：
//
// 1. 付款码不落屏、不落 React state。付款码是一次性支付凭证、等同现金，而一体机是
//    27 寸公共竖屏，旁观者站在旁边就能看见。历史缺陷：CashierPaymentPanel 曾以
//    value={authCode} 把 18 位付款码明文渲染在可见输入框里。
//    规范来源：docs/design/kiosk-ai-os-v3-2026-08/hardware-camera-scanner-plan.md
//    「HID 输入进入仅内存缓冲区，不绑定可见输入框 / 不显示全码、尾号」。
//
// 2. 非授权页面必须吞掉扫码模组的 HID 突发输入。一体机装的是嵌入式影像扫码模组
//    （常亮、自动触发、朝外），误扫是默认状态：任何人举着任意码经过，内容就会落进
//    用户当前聚焦的控件，并可能被表单一起提交落库。
//    规范来源：同上，「其他页面必须吞掉扫码器的 HID 突发输入」。
//
// 纯静态分析，不联网、不构建。exit 0 = PASS，exit 1 = FAIL。

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const read = (rel) => readFileSync(join(root, rel), 'utf8')

/** 去掉注释，避免注释里的字面量把断言「喂饱」。 */
const stripComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

const files = {
  panel: stripComments(read('src/pages/print/CashierPaymentPanel.tsx')),
  cashier: stripComments(read('src/pages/print/PrintCashierPage.tsx')),
  detector: stripComments(read('src/components/hid-guard/hidBurstDetector.ts')),
  guard: stripComments(read('src/components/hid-guard/KioskHidScanGuard.tsx')),
  runtimeRoot: stripComments(read('src/layouts/KioskRuntimeRoot.tsx')),
  pickup: stripComments(read('src/pages/print/PrintPickupClaimPage.tsx')),
}

const failures = []
const assert = (condition, message) => {
  if (!condition) failures.push(message)
}
const must = (key, pattern, message) =>
  assert(
    pattern instanceof RegExp ? pattern.test(files[key]) : files[key].includes(pattern),
    `${key}: ${message}`,
  )
const mustNot = (key, pattern, message) =>
  assert(
    !(pattern instanceof RegExp ? pattern.test(files[key]) : files[key].includes(pattern)),
    `${key}: ${message}`,
  )

// ── 1. 付款码不落屏 ──────────────────────────────────────────────
// 明文回显的原始缺陷形态：<input value={authCode} />
mustNot('panel', /value=\{\s*authCode/, '付款码不得绑定到输入框 value（原缺陷：明文回显在公共大屏）')
mustNot('panel', /useState\([^)]*\)\s*;?\s*\/\/\s*authCode/, '付款码不得进入 React state')
// 容器层不得把付款码放进 React state —— state 会随渲染树、DevTools、错误边界外泄。
mustNot('cashier', /(useState|setState)[^\n]*authCode(?!BufferRef)/i, '付款码不得进入 React state')
mustNot('cashier', /const\s+\[\s*authCode\s*,/, '付款码不得进入 React state（useState 解构）')
must('cashier', 'authCodeBufferRef', '付款码必须存放在仅内存缓冲区 ref 中')
must('panel', 'authCodeBufferRef', '面板必须通过仅内存缓冲区 ref 读写付款码')

// 输入框必须被「抽干」：每次输入后立刻置空，DOM 里不留码值。
must('panel', /input\.value\s*=\s*''/, '付款码输入框必须在每次输入后立刻清空（DOM 不留码值）')
must('panel', 'drainInput', '必须保留 drainInput（把输入框字符抽进内存缓冲区）')

// 提交后必须立刻擦除缓冲区。
must('cashier', /authCodeBufferRef\.current\s*=\s*''/, '提交/失败后必须立刻擦除付款码缓冲区')

// 不得回显任何码值片段（含尾号）——一次性凭证整串即凭证。
mustNot('panel', /slice\(\s*-\s*4\s*\)/, '不得回显付款码尾号')
mustNot('panel', /authCodeBufferRef\.current\s*\}/, '不得把缓冲区内容渲染进 JSX')

// 付款码不得进入 URL / 日志 / storage。
for (const key of ['panel', 'cashier']) {
  mustNot(key, /console\.(log|info|warn|error)\([^)]*authCode/i, '付款码不得进入日志')
  mustNot(key, /(localStorage|sessionStorage)[^\n]*authCode/i, '付款码不得进入 storage')
  mustNot(key, /searchParams[^\n]*authCode/i, '付款码不得进入 URL')
}

// 18 位闸门必须保留。支付宝的「25–30」是码制前缀不是长度（2 位前缀 + 16 位 = 18 位），
// 把闸门改成 25–30 位会直接打断支付宝收款。
must('panel', /AUTH_CODE_LENGTH\s*=\s*18/, '付款码 18 位闸门必须保留')
must('cashier', /\\d\{18\}/, '付款码 18 位服务端前置校验必须保留')

// ── 2. 全局 HID 突发防护 ─────────────────────────────────────────
// 注意断言的是**渲染出来的 JSX 元素**，不是 import —— 只留 import 而删掉挂载
// 会让防护静默失效，而 import 行同样含有这个标识符（本门禁的变异测试抓到过这一点）。
must('runtimeRoot', /<KioskHidScanGuard\s*\/>/, '全局 HID 守卫必须真的渲染在 Kiosk 运行时根（不能只留 import）')
must('runtimeRoot', /import\s*\{\s*KioskHidScanGuard\s*\}/, '全局 HID 守卫必须被导入')
must('guard', /addEventListener\(\s*'keydown'[\s\S]{0,40}true\s*\)/, '守卫必须在捕获阶段监听 keydown')
must('guard', 'preventDefault', '确认为突发后必须 preventDefault')
must('guard', 'stopPropagation', '确认为突发后必须 stopPropagation')

// 默认拒绝：白名单只允许收银页与取件页，不得写成黑名单。
must('guard', 'SCAN_AUTHORIZED_ROUTES', '必须以白名单（默认拒绝）方式放行授权扫码页')
must('guard', "'/print/cashier'", '收银页必须在授权扫码白名单内')
must('guard', "'/print/pickup-claim'", '取件页必须在授权扫码白名单内')
assert(
  (files.guard.match(/SCAN_AUTHORIZED_ROUTES\s*=\s*new Set\(\[[^\]]*\]/)?.[0].match(/'/g)?.length ?? 0) / 2 === 2,
  'guard: 授权扫码白名单必须恰好两条路由（新增需评估误扫风险）',
)
must('guard', /!SCAN_AUTHORIZED_ROUTES\.has\(/, '非授权页面必须默认启用防护')

// 前缀回滚：突发要到第 N 个键才能确认，此前字符已落进控件，光 preventDefault 不够。
must('guard', 'snapshotActiveEditable', '必须在突发起始时快照焦点内容')
must('guard', 'restoreValue', '突发确认后必须回滚已落进控件的前缀字符')
must('guard', /Object\.getOwnPropertyDescriptor\([\s\S]{0,60}'value'\)/, '回滚必须走原生 setter，否则 React 受控组件状态不同步')

// 判据必须排除会误伤真实用户输入的四类事件。
must('detector', /isTrusted\s*===\s*false/, '必须排除合成事件（软键盘/脚本）')
must('detector', /event\.repeat/, '必须排除按键自动重复（长按形态与扫码极像）')
must('detector', /isComposing|keyCode\s*===\s*229/, '必须排除输入法组合态')
must('detector', /ctrlKey|metaKey|altKey/, '必须排除组合键')

// 阈值必须留足人类余量。人类最快持续打字 60–80ms/键，触屏软键盘 >200ms/键。
const gap = Number(files.detector.match(/HID_MAX_GAP_MS\s*=\s*(\d+)/)?.[1] ?? NaN)
assert(
  Number.isFinite(gap) && gap > 0 && gap <= 50,
  `detector: HID_MAX_GAP_MS 必须 ≤50ms（当前 ${gap}）—— 再大就可能误伤人类打字`,
)
const minLen = Number(files.detector.match(/HID_BURST_MIN_LEN\s*=\s*(\d+)/)?.[1] ?? NaN)
assert(
  Number.isFinite(minLen) && minLen >= 6,
  `detector: HID_BURST_MIN_LEN 必须 ≥6（当前 ${minLen}）—— 太短会误伤人类连打`,
)

// ── 3. 授权页扫码行为不得回归 ────────────────────────────────────
must('pickup', 'claimLockRef', '取件页的同步提交锁必须保留（挡扫码器尾随回车）')
must('cashier', 'codeSubmitLockRef', '收银页的同步提交锁必须保留（挡扫码器尾随回车）')
must('panel', /autoFocus/, '收银页付款码输入框必须保持自动聚焦，否则扫码枪无处落字')

if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL ${failure}`)
  console.error(`\n${failures.length} scan input safety check(s) failed`)
  process.exit(1)
}

console.log(`verify-scan-input-safety passed (${Object.keys(files).length} files checked)`)
