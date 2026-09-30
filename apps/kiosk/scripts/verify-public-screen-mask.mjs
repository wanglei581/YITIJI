#!/usr/bin/env node
/**
 * 公共屏打码：小青回显与导出核对都走 maskPii，
 * 且身份证（18 位含 X、15 位）、手机、邮箱、银行卡都会打码。
 * 作业页不得再把每次渲染的新对象当成读取依赖；扫码等人时不算忙。
 */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const kioskRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (relative) => readFileSync(join(kioskRoot, relative), 'utf8')

const failures = []
const check = (ok, message) => {
  if (ok) console.log(`  PASS ${message}`)
  else {
    failures.push(message)
    console.error(`  FAIL ${message}`)
  }
}

function loadPure(relative, dependencies = {}) {
  const source = ts.transpileModule(read(relative), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText
  const exports = {}
  new Function('exports', 'require', source)(exports, (name) => {
    if (!(name in dependencies)) throw new Error(`意外依赖 ${name}`)
    return dependencies[name]
  })
  return exports
}

console.log('\n=== 公共屏打码 ===')

const masking = loadPure('src/utils/maskPii.ts')
const copy = loadPure('src/pages/assistant/advisorUserCopy.ts', {
  '../../utils/maskPii': masking,
})

const sample = '证件 370200199001011234，旧证 110101900307123，大写 11010119900307867X，电话 13800000741，邮箱 zhouqing@example.com，卡 6222021234567890123'
const shown = copy.advisorDisplayText(sample)
for (const secret of [
  '370200199001011234',
  '110101900307123',
  '11010119900307867X',
  '13800000741',
  'zhouqing@example.com',
  '6222021234567890123',
]) {
  check(!shown.includes(secret), `小青回显不含原文 ${secret}`)
}
check(shown.includes('370200********1234'), '18 位身份证打码')
check(shown.includes('110101********867X'), '末位 X 的身份证打码')
check(shown.includes('110101*****7123'), '15 位旧身份证打码')
check(shown.includes('138****0741'), '手机号打码')
check(shown.includes('z***@example.com'), '邮箱打码')
check(shown.includes('6222***********0123'), '银行卡打码')

const advisorSource = read('src/pages/assistant/advisorUserCopy.ts')
check(/return maskPii\(text\)/.test(advisorSource), '小青回显调用 maskPii')
check(!/1\\d\{10\}/.test(advisorSource), '小青回显不再自己写手机号规则')

const dialog = read('src/pages/resume/components/resume-deliver/ResumeFactConfirmDialog.tsx')
check(dialog.includes("from '../../../../utils/maskPii'"), '导出核对弹窗引用 maskPii')
check(dialog.includes('maskPii(fact.value)'), '事实原文经 maskPii 后再显示')
check(dialog.includes('maskPii(item)'), '待确认文字经 maskPii 后再显示')
check(dialog.includes('checked[fact.id]'), '勾选仍按事实编号，不改原文')
check(!dialog.includes('{fact.value}'), '弹窗不再直接画出事实原文')

const plan = read('src/pages/ai-plan/AiPlanPage.tsx')
check(plan.includes('const artifactKey = stableJson(navState.artifact)'), '作业页按字符串记住要点')
check(/useMemo\(\(\) => \{[\s\S]*parsePayload\(JSON\.parse\(artifactKey\)\)[\s\S]*\[artifactKey\]/.test(plan), '要点解析只依赖这份字符串')
check(!plan.includes('const bootstrapPayload = parsePayload(navState.artifact)'), '不再每次渲染重新解析要点对象')
check(plan.includes('const READ_LIMIT = 3'), '读取失败最多试有限次')
check(plan.includes('attempt < READ_LIMIT'), '超过次数就停止重发')
check(plan.includes('重新读取'), '失败后给出重新读取')

const source = read('src/pages/resume/ResumeSourcePage.tsx')
const panel = read('src/pages/upload/components/UploadSessionQrPanel.tsx')
check(source.includes('busyWhen="received"'), '简历来源页等人扫时不把整页标成忙')
check(source.includes('const sourceBusy = uploading || phoneBusy || usbBusy'), '三条来源仍共用一把忙锁')
check(/busyWhen === 'received' \? received : active \|\| loading \|\| confirming/.test(panel), '收到文件或确认中才向简历来源页报忙')
check(panel.includes("status?.status === 'uploaded' || confirming"), '报忙看的是已收到文件或正在确认')

const unit = spawnSync(process.execPath, ['--test', 'scripts/tests/mask-pii.test.mjs'], {
  cwd: kioskRoot,
  encoding: 'utf8',
})
check(unit.status === 0, 'maskPii 单元测试通过')
if (unit.status !== 0) {
  console.error(unit.stdout)
  console.error(unit.stderr)
}

if (failures.length > 0) {
  console.error(`\n${failures.length} 项没通过`)
  process.exit(1)
}
console.log('\nverify-public-screen-mask passed')
