/**
 * 「凭据真的落进本机登记了吗」的**行为**测试（不是文本断言）。
 *
 * ## 它守的是什么
 *
 * `saveScanWorkbenchSession` 把 `setItem` 的异常吞掉了，而更糟的一种是**根本不抛**：
 * 隐私模式、配额写满、被扩展或夹具改写过的 sessionStorage 都可能静默什么也不做。
 * 两种情况下调用方拿到的都是「看起来写成功了」。
 *
 * 调用方据此去 ACK，服务端那条任务就变得可投递，而本机整页重载之后再也找不回它 ——
 * 一个可投递却没有任何界面在看着的收件箱，正是 ACK 那道闸要消灭的东西。
 * 所以 `patchScanWorkbenchSessionWithDurableLive` 的放行判据是「读回来还是同一串字节」。
 *
 * 每个 case 新装一份模块（模块级代次是被测对象的一部分），断言的是函数返回值和
 * 真实写进存储的字节，不是源码文本。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')

function transpile(relativePath) {
  const source = readFileSync(join(root, relativePath), 'utf8')
  return ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName: relativePath,
  }).outputText
}

function toDataUrl(code) {
  return `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
}

/** lucide 图标只在 scanWorkbench 的选项表里当值用，测试里不需要真的渲染。 */
const LUCIDE_STUB = toDataUrl(
  ['CloudIcon', 'CreditCardIcon', 'FileTextIcon', 'FolderIcon', 'MonitorIcon', 'ScanLineIcon']
    .map((name) => `export const ${name} = () => null`)
    .join('\n'),
)

let instanceSeed = 0
async function loadSessionModule() {
  instanceSeed += 1
  const workbench = toDataUrl(transpile('src/pages/scan/scanWorkbench.ts').replaceAll("'lucide-react'", `'${LUCIDE_STUB}'`))
  const model = toDataUrl(transpile('src/pages/scan/scanWorkbenchModel.ts'))
  const session = transpile('src/pages/scan/scanWorkbenchSession.ts')
    .replaceAll("'./scanWorkbench'", `'${workbench}'`)
    .replaceAll("'./scanWorkbenchModel'", `'${model}'`)
  return import(toDataUrl(`${session}\n// instance ${instanceSeed}\n`))
}

/**
 * 撑起一个可以按需「坏掉」的 sessionStorage。
 *
 * @param onWrite 返回 `'drop'` 静默丢弃这次写入（最难的一种：不抛异常），
 *   `'throw'` 抛 SecurityError，返回字符串则写入被改写过的字节，其余照写。
 */
function installStorage(onWrite = () => undefined) {
  const store = new Map()
  globalThis.window = {
    sessionStorage: {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => {
        const verdict = onWrite(key, String(value))
        if (verdict === 'drop') return
        if (verdict === 'throw') throw new Error('SecurityError: storage blocked')
        store.set(key, typeof verdict === 'string' ? verdict : String(value))
      },
      removeItem: (key) => { store.delete(key) },
    },
  }
  return store
}

const LIVE = {
  scanTaskId: 'scan-live-001',
  controlToken: 'live-control-token-plaintext',
  instructions: ['服务端指引：第一步', '服务端指引：第二步'],
  expiresAt: '2099-01-01T00:00:00.000Z',
}

const patch = (mod) => mod.patchScanWorkbenchSessionWithDurableLive({
  stage: 'settings',
  scanType: 'resume',
  live: LIVE,
})

test('a live session that really lands in storage reads back true', async () => {
  const store = installStorage()
  const mod = await loadSessionModule()

  assert.equal(patch(mod), true)
  const persisted = JSON.parse(store.get(mod.SCAN_WORKBENCH_SESSION_KEY))
  assert.deepEqual(persisted.live, LIVE, '写进去的就是服务端回的那四样，一样都不少')
  assert.deepEqual(mod.readScanWorkbenchSession()?.live, LIVE)
})

test('a silently dropped write is caught by the read-back, not by try/catch', async () => {
  const store = installStorage((key, value) => (value.includes('"live"') ? 'drop' : undefined))
  const mod = await loadSessionModule()

  // 阳性对照：不带 live 的写照样成功，所以 false 不是「这份 storage 整个坏了」。
  mod.patchScanWorkbenchSession({ stage: 'settings', scanType: 'resume' })
  assert.equal(mod.readScanWorkbenchSession()?.scanType, 'resume')

  assert.equal(patch(mod), false, '静默丢弃必须判 false —— setItem 没抛，try/catch 一个字都读不到')
  assert.equal(mod.readScanWorkbenchSession()?.live, undefined, '存储里确实没有 live：结论不是误报')
  assert.equal(store.get(mod.SCAN_WORKBENCH_SESSION_KEY).includes(LIVE.controlToken), false)
})

test('a write that throws is also caught (saveScanWorkbenchSession swallows it)', async () => {
  installStorage((key, value) => (value.includes('"live"') ? 'throw' : undefined))
  const mod = await loadSessionModule()

  assert.equal(patch(mod), false)
  assert.equal(mod.readScanWorkbenchSession()?.live, undefined)
})

test('storage that alters the credentials is rejected byte for byte', async () => {
  installStorage()
  const mod = await loadSessionModule()
  // 写得进去，但 controlToken 被改了一个字节：对这一场来说凭据已经不是它自己的了，
  // 拿它去 ACK / 撤销只会 403，而页面会把那条 403 读成「服务端不认这一场」。
  installStorage((key, value) => (value.includes('"live"')
    ? value.replace(LIVE.controlToken, `${LIVE.controlToken}-tampered`)
    : undefined))
  assert.equal(patch(mod), false, 'controlToken 对不上必须判 false')

  installStorage((key, value) => (value.includes('"live"')
    ? value.replace(LIVE.scanTaskId, 'some-other-task')
    : undefined))
  assert.equal(patch(mod), false, 'scanTaskId 对不上必须判 false')

  installStorage((key, value) => (value.includes('"live"')
    ? value.replace(JSON.stringify(LIVE.instructions), JSON.stringify([LIVE.instructions[0]]))
    : undefined))
  assert.equal(patch(mod), false, '指引被截短必须判 false：屏上会少一步，用户照着做不完')

  installStorage((key, value) => (value.includes('"live"')
    ? value.replace(LIVE.expiresAt, '2098-01-01T00:00:00.000Z')
    : undefined))
  assert.equal(patch(mod), false, 'expiresAt 对不上必须判 false：倒计时与过期撤销都按它走')
})

test('the durable write still advances nothing it should not: a plain patch keeps working', async () => {
  installStorage()
  const mod = await loadSessionModule()
  // 成功路径不许改变既有语义：它就是 patchScanWorkbenchSession 加一次读回核对。
  assert.equal(patch(mod), true)
  assert.equal(mod.readScanWorkbenchSession()?.stage, 'settings')
  assert.equal(mod.readScanWorkbenchSession()?.scanType, 'resume')
})
