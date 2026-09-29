#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const read = (p) => readFileSync(join(root, p), 'utf8')
const checks = [
  ['启动标记进入 sessionStorage 并移除 kiosk_launch', /KIOSK_LAUNCH_MARKER_KEY/.test(read('src/services/api/screensaver.ts')) && /delete\('kiosk_launch'\)/.test(read('src/services/api/screensaver.ts'))],
  ['无身份但有启动标记仍按一体机处理', /getTerminalId\(\) !== '' \|\| HAS_KIOSK_LAUNCH_MARKER/.test(read('src/services/api/screensaver.ts'))],
  ['设备状态订阅终端身份变化', /useSyncExternalStore\(subscribeTerminalIdentity, getTerminalId/.test(read('src/hooks/useTerminalDeviceStatus.ts'))],
  // 断言行为而不是字面：录音器一就绪，先判断「已松手 / 已换指」，是就立即取消并返回；
  // 松手处理器必须把 releasedRef 置真。只查变量名在不在，会放过把条件改成 if (false) 的回退。
  ['按住说话：录音器就绪后先查松手、已松手即取消', /const recorder = await startWavRecorder\(\)\s*\n\s*if \(releasedRef\.current \|\| pointerIdRef\.current !== event\.pointerId\) \{\s*\n\s*recorder\.cancel\(\)/.test(read('src/pages/assistant/AssistantHoldToTalk.tsx'))],
  ['按住说话：松手与取消都会置 releasedRef', (read('src/pages/assistant/AssistantHoldToTalk.tsx').match(/releasedRef\.current = true/g) ?? []).length >= 2],
  ['按住说话处理 lostpointercapture', /onLostPointerCapture=\{onPointerCancel\}/.test(read('src/pages/assistant/AssistantHoldToTalk.tsx'))],
  // 手机上没有本机身份、也没有一体机启动标记，kiosk=false，文件框照常出现；一体机上（有身份或有标记）必须不渲染。
  ['手机扫码页：手机保留文件选择、一体机上不渲染', /<input[\s\S]*type="file"/.test(read('src/pages/upload/PhoneUploadPage.tsx')) && /!kiosk\s*&&\s*<input/.test(read('src/pages/upload/PhoneUploadPage.tsx'))],
]
let failed = 0
for (const [name, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`)
  if (!ok) failed++
}
if (failed) process.exit(1)
console.log('verify-kiosk-field-safety: all checks passed')
