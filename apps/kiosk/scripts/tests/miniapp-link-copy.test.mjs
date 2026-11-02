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

test('手机侧页头品牌与小程序同名，不随一体机贴牌换；中转页从常量取、不写字面量', () => {
  assert.equal(copy.PLATFORM_BRAND_NAME, copy.MINIAPP_DISPLAY_NAME)
  const entry = readFileSync(join(kioskRoot, 'src/pages/upload/KioskCodeEntryPage.tsx'), 'utf8')
  const code = entry.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  assert.doesNotMatch(code, /职易达/, '中转页页头品牌要从 PLATFORM_BRAND_NAME 取')
  assert.match(code, /\{PLATFORM_BRAND_NAME\}/)
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

test('文件来源那一行：三种来源各一句，小程序名来自常量；读不到或不认得就是空串', () => {
  assert.equal(copy.uploadedFileSourceLine('miniapp_documents'), '来自职易达小程序「我的文档」')
  assert.equal(copy.uploadedFileSourceLine('miniapp'), '来自职易达小程序')
  assert.equal(copy.uploadedFileSourceLine('web'), '来自手机网页')
  for (const unknown of [undefined, null, '', 'kiosk', 'MINIAPP', 1, {}]) {
    assert.equal(copy.uploadedFileSourceLine(unknown), '', `不认得的来源 ${JSON.stringify(unknown)} 要是空串`)
  }
  for (const source of ['miniapp_documents', 'miniapp']) {
    assert.ok(copy.uploadedFileSourceLine(source).includes(`${copy.MINIAPP_DISPLAY_NAME}小程序`), `${source} 要带小程序名`)
  }
})

test('来源那一行是事实陈述，不跟着小程序发布开关走；「不是你传的文件」那句叫人点取消再扫', () => {
  // 未发布时（只有体验成员能从小程序传）文件真从小程序来，也照实说。
  assert.equal(copy.uploadedFileSourceLine('miniapp'), '来自职易达小程序')
  const hint = copy.notYourFileHint()
  assert.equal(hint, '不是你传的文件？请点「取消」，再重新扫码。')
  assert.ok(hint.includes('「取消」'))
})

test('来源与提醒两句同样不含无人值守禁用说法，也不写价格、岗位一类字眼', () => {
  const lines = [
    copy.uploadedFileSourceLine('miniapp_documents'),
    copy.uploadedFileSourceLine('miniapp'),
    copy.uploadedFileSourceLine('web'),
    copy.notYourFileHint(),
  ]
  for (const sentence of lines) {
    for (const phrase of unattended.UNATTENDED_FORBIDDEN_PHRASES) {
      assert.ok(!sentence.includes(phrase), `「${sentence}」含禁用说法「${phrase}」`)
    }
    assert.equal(unattended.containsStaffHandoff(sentence), false, sentence)
    assert.doesNotMatch(sentence, /工作人员|服务台|到店|值守|现场处理/, sentence)
    assert.doesNotMatch(sentence, /价格|收费|付费|购买|充值|优惠|元\/|￥|¥/, sentence)
    assert.doesNotMatch(sentence, /岗位|招聘|企业|投递/, sentence)
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

/*
 * 触屏版接线（#1519 留给第三、四、五包）：面板只调用文案函数，不手写小程序的话；页头品牌三页都从常量取。
 * 转译不了页面，所以读真源码（去掉注释）逐处钉调用点。
 */
const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
const readCode = (rel) => stripComments(readFileSync(join(kioskRoot, rel), 'utf8'))

test('接线：手机上传面板（第四包）码旁说明、来源与提醒都取自文案函数，联系方式用 useSupportContact', () => {
  const panel = readCode('src/pages/upload/components/UploadSessionQrPanel.tsx')
  assert.match(panel, /from '\.\.\/\.\.\/\.\.\/copy\/miniappLinkCopy'/)
  assert.match(panel, /const supportContact = useSupportContact\(\)/)
  assert.match(panel, /const scanHint = phoneUploadScanHint\(supportContact\)/)
  assert.match(panel, /\(scanHint \|\| '请用手机微信或浏览器扫码'\)/, '空串要保持原句')
  assert.match(panel, /const sourceLine = uploadedFileSourceLine\(uploadedFile\?\.source\)/)
  assert.match(panel, /\{uploaded && sourceLine \? <p[^>]*>\{sourceLine\}<\/p> : null\}/, '读不到来源就不写那一行')
  assert.match(panel, /\{uploaded \? <p[^>]*>\{notYourFileHint\(\)\}<\/p> : null\}/)
  assert.doesNotMatch(panel, /小程序|不是你传的|来自/, '面板里不手写小程序、来源与提醒的句子')
})

test('接线：选文件页手机上传（第三包）文件行取来源句、读不到保持原字，待确认屏加提醒', () => {
  const hook = readCode('src/pages/upload/hooks/useUploadSession.ts')
  assert.match(hook, /pendingSource: string \| null/)
  assert.match(hook, /pendingSource: status\?\.file\?\.source \?\? null/)
  const model = readCode('src/pages/print/file-source/fileSourceModel.ts')
  assert.match(model, /pendingSource: string \| null/)
  const phone = readCode('src/pages/print/file-source/FileSourcePhone.tsx')
  assert.match(phone, /uploadedFileSourceLine\(phone\.pendingSource\) \|\| '手机扫码上传'/)
  assert.match(phone, /screen === 'phone-uploaded' \? \(\s*<QxTouchCallout kind="remind" icon="alert">\{notYourFileHint\(\)\}<\/QxTouchCallout>/)
  assert.doesNotMatch(phone, /来自|小程序|不是你传的/, '文件行与待确认屏不手写来源和提醒的句子')
  const view = readCode('src/pages/print/file-source/FileSourceView.tsx')
  assert.match(view, /uploadedFileSourceLine\(phone\.pendingSource\) \|\| '手机扫码上传'/, '确认失败屏里的文件行同样取来源句')
})

test('接线：扫码登录面板（第五包）第 2 步取 qrLoginScanHint、空串保持原句', () => {
  const login = readCode('src/pages/auth/ScanQrLoginPanel.tsx')
  assert.match(login, /const supportContact = useSupportContact\(\)/)
  assert.match(login, /\{qrLoginScanHint\(supportContact\) \|\| '用手机相机或微信扫左边的二维码，在手机上完成手机号验证并确认。'\}/)
  assert.doesNotMatch(login, /职易达小程序/, '面板不手写小程序名')
})

test('接线：手机上传页、手机确认登录页页头品牌从 PLATFORM_BRAND_NAME 取，不写字面量', () => {
  for (const rel of ['src/pages/upload/PhoneUploadPage.tsx', 'src/pages/auth/MobileQrLoginPage.tsx']) {
    const code = readCode(rel)
    assert.match(code, /import \{ PLATFORM_BRAND_NAME \} from '\.\.\/\.\.\/copy\/miniappLinkCopy'/, rel)
    assert.match(code, /<strong>\{PLATFORM_BRAND_NAME\}<\/strong>/, `${rel} 页头品牌取常量`)
    assert.match(code, /aria-hidden="true">\{PLATFORM_BRAND_NAME\.slice\(0, 1\)\}<\/span>/, `${rel} 印章字取常量的首字`)
    assert.doesNotMatch(code, /职易达/, `${rel} 不写品牌字面量`)
    assert.doesNotMatch(code, /aria-hidden="true">职<\/span>/, `${rel} 印章字不写字面量`)
  }
})
