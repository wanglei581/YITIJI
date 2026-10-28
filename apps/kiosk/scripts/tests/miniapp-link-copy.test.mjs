/**
 * 一体机屏上说到小程序的两句扫码说明（src/copy/miniappLinkCopy.ts）。
 * 照 unattended-copy.test.mjs 的写法转译真源码来跑，不另抄一份句子。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const kioskRoot = join(dirname(fileURLToPath(import.meta.url)), '../..')
const sourcePath = join(kioskRoot, 'src/copy/miniappLinkCopy.ts')
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

const unattendedUrl = transpile(join(kioskRoot, 'src/copy/unattendedCopy.ts'))
const unattended = await import(unattendedUrl)
const copy = await import(transpile(sourcePath, { './unattendedCopy': unattendedUrl }))

const unpublished = {
  servicePhone: '18369161921',
  serviceHours: '工作日 9:00–18:00',
  otherOnlineTerminalNearby: true,
  miniappPublished: false,
}
const published = { ...unpublished, miniappPublished: true }

const UPLOAD_HINT = '用手机微信扫码：打开的是职易达小程序，就在里面选文件；打开的是网页，也能照常上传。'
const LOGIN_HINT = '用手机微信扫码：打开的是职易达小程序，已登录的直接确认；打开的是网页，用短信验证。'
const hints = [
  ['phoneUploadScanHint', UPLOAD_HINT],
  ['qrLoginScanHint', LOGIN_HINT],
]

test('小程序的名字是常量「职易达」', () => {
  assert.equal(copy.MINIAPP_DISPLAY_NAME, '职易达')
})

test('小程序未发布、null、省略参数（会话缓存为空）、字段缺失或非布尔：两句都是空串', () => {
  for (const [name] of hints) {
    assert.equal(copy[name](unpublished), '', `${name} 未发布`)
    assert.equal(copy[name](null), '', `${name} null`)
    assert.equal(copy[name](undefined), '', `${name} undefined`)
    assert.equal(copy[name](), '', `${name} 省略参数`)
    assert.equal(copy[name]({ servicePhone: null, serviceHours: null, otherOnlineTerminalNearby: false }), '', `${name} 发布字段缺失`)
    assert.equal(copy[name]({ ...published, miniappPublished: 'true' }), '', `${name} 发布字段不是布尔`)
  }
})

test('小程序已发布：给出原句，句中的小程序名来自常量', () => {
  for (const [name, sentence] of hints) {
    const line = copy[name](published)
    assert.equal(line, sentence, name)
    assert.ok(line.includes(`${copy.MINIAPP_DISPLAY_NAME}小程序`), `${name} 要带小程序名`)
  }
})

test('两句都不含无人值守禁用说法，也不写价格、购买、岗位、招聘会、企业', () => {
  assert.ok(unattended.UNATTENDED_FORBIDDEN_PHRASES.length > 0, '禁用词表不能是空的')
  for (const [name] of hints) {
    // 查的是源码真正给出的句子，不是本文件里抄的那份。
    const sentence = copy[name](published)
    assert.ok(sentence.length > 0, `${name} 已发布时应有句子`)
    for (const phrase of unattended.UNATTENDED_FORBIDDEN_PHRASES) {
      assert.ok(!sentence.includes(phrase), `${name} 含禁用说法「${phrase}」`)
    }
    assert.equal(unattended.containsStaffHandoff(sentence), false, name)
    assert.doesNotMatch(sentence, /工作人员|服务台|到店|值守|现场处理/, name)
    assert.doesNotMatch(sentence, /价格|收费|付费|购买|充值|优惠|元\/|￥|¥/, name)
    assert.doesNotMatch(sentence, /岗位|招聘|企业|投递/, name)
  }
})

test('是否已发布只经 whenMiniapp 判断，本文件不发请求', () => {
  const source = readFileSync(sourcePath, 'utf8')
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  assert.equal((code.match(/\bwhenMiniapp\(/g) ?? []).length, 2, '两句都要经 whenMiniapp')
  assert.doesNotMatch(code, /miniappPublished|resolveSupportContact|peekSupportContact/, '不要绕开 whenMiniapp 自己读发布字段')
  assert.doesNotMatch(code, /\bfetch\(|services\//, '本文件不发请求、不引接口模块')
  const imports = [...code.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1])
  assert.deepEqual(imports, ['./unattendedCopy'])
  assert.equal((code.match(/职易达/g) ?? []).length, 1, '小程序名只在常量里写一次')
})
