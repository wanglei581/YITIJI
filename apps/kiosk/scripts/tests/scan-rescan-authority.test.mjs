/**
 * 一次性安全重扫授权的**行为**测试（不是文本断言）。
 *
 * ## 它守的是什么
 *
 * 服务端对「取过件但没建档成功」的同一份字节做 2 小时去重
 * （`SCAN_FILE_PREVIOUSLY_ATTEMPTED`）。用户在结果页点「重试扫描」，如果发的是一个
 * 普通新会话，他把同一张纸再放进去，文件回来会被那条去重原样拒掉 —— 任务停在
 * waiting 直到过期，用户白等十分钟，全程没有任何提示。所以「重试扫描」必须带上
 * 服务端铸的那枚一次性授权。
 *
 * 这枚授权是**凭证**（含上一场任务的 controlToken 明文），所以它只能活在内存里，
 * 且必须在换人 / 清场 / 离开的那一刻消失。下面逐条把这些性质真的跑一遍：
 * 每个 case 都新装一份模块（模块级状态必须隔离），用 Map 撑起 sessionStorage，
 * 断言的是函数返回值和真实写进存储的字节，不是源码文本。
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

/**
 * 新装一份 scanWorkbenchSession。
 *
 * 每次都要是**全新**的：模块级的代次与授权槽是被测对象本身，跨 case 复用会让
 * 上一条的残留决定下一条的结论。用一行独有注释撑开 data URL，绕过 import 缓存。
 */
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

/** 撑起一个真的能读写的 sessionStorage，测试据此断言「到底写进去了什么字节」。 */
function installStorage() {
  const store = new Map()
  globalThis.window = {
    sessionStorage: {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => { store.set(key, String(value)) },
      removeItem: (key) => { store.delete(key) },
    },
  }
  return store
}

const PRIOR = {
  priorScanTaskId: 'scan-prior-001',
  priorControlToken: 'prior-control-token-plaintext',
  scanType: 'resume',
}

test('armed authority is handed to the next session as a paired body id + header token', async () => {
  installStorage()
  const mod = await loadSessionModule()

  assert.equal(mod.armScanRescanAuthority(PRIOR), true)
  assert.equal(mod.hasScanRescanAuthority('resume'), true)

  assert.equal(mod.beginScanRescan({ scanType: 'resume' }), true, '「重试扫描」必须把授权移交给下一场')
  const taken = mod.takeScanRescanAuthority('resume')
  assert.deepEqual(taken, {
    retryOfScanTaskId: PRIOR.priorScanTaskId,
    priorControlToken: PRIOR.priorControlToken,
  })
})

test('the authority is one-shot: a second take returns null', async () => {
  installStorage()
  const mod = await loadSessionModule()
  mod.armScanRescanAuthority(PRIOR)
  mod.beginScanRescan({ scanType: 'resume' })

  assert.notEqual(mod.takeScanRescanAuthority('resume'), null)
  assert.equal(mod.takeScanRescanAuthority('resume'), null, '取过就没了：服务端那枚授权也只消费一次')
  assert.equal(mod.hasScanRescanAuthority('resume'), false)
})

test('the token never reaches session storage', async () => {
  const store = installStorage()
  const mod = await loadSessionModule()
  mod.armScanRescanAuthority(PRIOR)
  mod.beginScanRescan({ scanType: 'resume', extras: { source: 'feeder' } })
  // 写回确实发生了（stage 换到 settings），但凭证一个字节都不许在里面。
  const persisted = store.get(mod.SCAN_WORKBENCH_SESSION_KEY)
  assert.ok(persisted, '「重试扫描」要把阶段写回登记')
  assert.equal(persisted.includes(PRIOR.priorControlToken), false, 'controlToken 明文不得落存储')
  assert.equal(persisted.includes(PRIOR.priorScanTaskId), false, '上一场任务 id 也不落存储')
  assert.match(persisted, /"stage":"settings"/)
})

test('a privacy clear drops the authority so the next user cannot inherit it', async () => {
  installStorage()
  const mod = await loadSessionModule()
  mod.armScanRescanAuthority(PRIOR)
  assert.equal(mod.hasScanRescanAuthority('resume'), true)

  // 清场（隐私空闲 / 退出 / 屏保 / 换人）走的就是这一个入口。
  mod.clearScanWorkbenchSession()
  assert.equal(mod.hasScanRescanAuthority('resume'), false)
  assert.equal(mod.takeScanRescanAuthority('resume'), null)
})

test('an explicit give-up (live: undefined) drops the authority', async () => {
  installStorage()
  const mod = await loadSessionModule()
  mod.armScanRescanAuthority(PRIOR)

  // 「安全返回扫描首页」/「返回（取消任务）」/ 进度页放弃，都是这一句。
  mod.patchScanWorkbenchSession({ stage: 'start', live: undefined, result: undefined })
  assert.equal(mod.hasScanRescanAuthority('resume'), false)
})

test('a generation bump between arming and taking invalidates the authority', async () => {
  installStorage()
  const mod = await loadSessionModule()
  mod.armScanRescanAuthority(PRIOR)
  const before = mod.scanLifecycleGeneration()

  // 用户点了「重试扫描」，但在设置页取用之前发生了一次清场。
  mod.beginScanRescan({ scanType: 'resume' })
  mod.clearScanWorkbenchSession()

  assert.ok(mod.scanLifecycleGeneration() > before)
  assert.equal(mod.takeScanRescanAuthority('resume'), null)
})

test('the authority is bound to one scan type', async () => {
  installStorage()
  const mod = await loadSessionModule()
  mod.armScanRescanAuthority(PRIOR)
  mod.beginScanRescan({ scanType: 'resume' })

  // 服务端要求 prior.scanType === dto.scanType，本机先按同一条判据挡掉。
  assert.equal(mod.hasScanRescanAuthority('id'), false)
  assert.equal(mod.takeScanRescanAuthority('id'), null)
})

test('an unusable authority is evicted from the slot anyway', async () => {
  installStorage()
  const mod = await loadSessionModule()
  mod.armScanRescanAuthority(PRIOR)
  mod.beginScanRescan({ scanType: 'resume' })

  // 取用时槽位必须**无条件**清空。这一次取的是别的扫描类型（服务端也会按
  // prior.scanType === dto.scanType 拒），所以拿回 null —— 但那份 resume 授权不能
  // 因此留在内存里：它含上一位用户的 controlToken 明文，而这台机器是公共设备，
  // 下一次凑巧又是 resume 就会被取出来用。
  assert.equal(mod.takeScanRescanAuthority('id'), null)
  assert.equal(
    mod.takeScanRescanAuthority('resume'),
    null,
    '一次取用（哪怕取不到）就把槽位清空；只在命中时才清，等于把凭证留给下一位',
  )
  assert.equal(mod.hasScanRescanAuthority('resume'), false)
})

test('re-arming the same prior session does not restart the local clock', async () => {
  installStorage()
  const mod = await loadSessionModule()
  const realNow = Date.now
  try {
    mod.armScanRescanAuthority(PRIOR)
    // 结果页每次挂载都会再登记一遍（React 重渲染、阶段来回切、看门狗重载后复水）。
    Date.now = () => realNow() + mod.SCAN_RESCAN_AUTHORITY_TTL_MS - 60_000
    assert.equal(mod.armScanRescanAuthority(PRIOR), true)
    // 服务端那枚授权是从铸出来那一刻开始算的 15 分钟。本机窗口不能因为
    // 「刚才又登记了一次」而续期，否则回一次结果页就能无限续下去。
    Date.now = () => realNow() + mod.SCAN_RESCAN_AUTHORITY_TTL_MS + 1
    assert.equal(mod.hasScanRescanAuthority('resume'), false)
    assert.equal(mod.takeScanRescanAuthority('resume'), null)
  } finally {
    Date.now = realNow
  }
})

test('arming a different prior session does start its own clock', async () => {
  installStorage()
  const mod = await loadSessionModule()
  const realNow = Date.now
  try {
    mod.armScanRescanAuthority(PRIOR)
    // 上一条那个幂等只对**同一场**成立。换了一场（重扫又失败了，这是新的一场），
    // 授权就是新铸的，必须按它自己的时刻计时 —— 否则新授权会继承旧时刻，
    // 在服务端还认的时候被本机判成过期，用户被静默降级成普通重扫。
    Date.now = () => realNow() + mod.SCAN_RESCAN_AUTHORITY_TTL_MS - 60_000
    assert.equal(
      mod.armScanRescanAuthority({ ...PRIOR, priorScanTaskId: 'scan-prior-002' }),
      true,
    )
    Date.now = () => realNow() + mod.SCAN_RESCAN_AUTHORITY_TTL_MS + 60_000
    assert.deepEqual(mod.takeScanRescanAuthority('resume'), {
      retryOfScanTaskId: 'scan-prior-002',
      priorControlToken: PRIOR.priorControlToken,
    })
  } finally {
    Date.now = realNow
  }
})

test('a stale authority past the local TTL is not taken', async () => {
  installStorage()
  const mod = await loadSessionModule()
  const realNow = Date.now
  try {
    mod.armScanRescanAuthority(PRIOR)
    mod.beginScanRescan({ scanType: 'resume' })
    Date.now = () => realNow() + mod.SCAN_RESCAN_AUTHORITY_TTL_MS + 1
    assert.equal(mod.hasScanRescanAuthority('resume'), false)
    assert.equal(mod.takeScanRescanAuthority('resume'), null)
  } finally {
    Date.now = realNow
  }
})

test('handing off does not restart the clock', async () => {
  installStorage()
  const mod = await loadSessionModule()
  const realNow = Date.now
  try {
    mod.armScanRescanAuthority(PRIOR)
    // 用户在结果页停了 14 分钟才点「重试扫描」。
    Date.now = () => realNow() + mod.SCAN_RESCAN_AUTHORITY_TTL_MS - 60_000
    assert.equal(mod.beginScanRescan({ scanType: 'resume' }), true)
    // 再过 2 分钟 —— 已经超出服务端那 15 分钟，本机也必须认它过期，
    // 而不是因为「刚刚移交过」重新计时（那样点几次就能无限续期）。
    Date.now = () => realNow() + mod.SCAN_RESCAN_AUTHORITY_TTL_MS + 60_000
    assert.equal(mod.takeScanRescanAuthority('resume'), null)
  } finally {
    Date.now = realNow
  }
})

/** 一场「已经结束、但凭证还在登记里」的扫描 —— 结果页那一刻的真实登记形状。 */
function seedFinishedScan(mod, store) {
  mod.patchScanWorkbenchSession({
    stage: 'result',
    scanType: 'resume',
    live: {
      scanTaskId: PRIOR.priorScanTaskId,
      controlToken: PRIOR.priorControlToken,
      instructions: ['放好原件'],
      expiresAt: '2099-01-01T00:00:00.000Z',
    },
    result: { outcome: 'failed', success: false, reason: '扫描文件处理失败' },
  })
  return store.get(mod.SCAN_WORKBENCH_SESSION_KEY)
}

test('beginScanRescan without an armed authority changes nothing at all', async () => {
  const store = installStorage()
  const mod = await loadSessionModule()
  const before = seedFinishedScan(mod, store)
  const generationBefore = mod.scanLifecycleGeneration()

  // 上一场根本没走到取件（服务端不会铸授权），或者整页重载把内存清了。
  assert.equal(mod.beginScanRescan({ scanType: 'resume' }), false)
  assert.equal(mod.takeScanRescanAuthority('resume'), null, '拿不到就是拿不到，不许本机造一份')

  /* 旧实现在这条路径上先 patch（live: undefined）再返回 false：本机唯一那份
   * scanTaskId + controlToken 连同结果快照一起被销毁，调用方就算看返回值也没有
   * 东西可退回 —— 用户连那张失败回执都看不到，服务端那个任务也再没人能撤。
   * 所以这里断言的是**逐字节没动**，而不是「大致还在」。 */
  assert.equal(store.get(mod.SCAN_WORKBENCH_SESSION_KEY), before, '一个字节都不许改')
  assert.equal(mod.scanLifecycleGeneration(), generationBefore, '代次也不许推进')
  const stored = mod.readScanWorkbenchSession()
  assert.equal(stored.stage, 'result')
  assert.equal(stored.live.controlToken, PRIOR.priorControlToken)
  assert.equal(stored.result.outcome, 'failed')
})

test('an expired authority is refused without destroying the session', async () => {
  const store = installStorage()
  const mod = await loadSessionModule()
  const realNow = Date.now
  try {
    seedFinishedScan(mod, store)
    mod.armScanRescanAuthority(PRIOR)
    const before = store.get(mod.SCAN_WORKBENCH_SESSION_KEY)

    // 用户在结果页上停了超过 15 分钟才抬手点「重试扫描（同一份材料）」。
    Date.now = () => realNow() + mod.SCAN_RESCAN_AUTHORITY_TTL_MS + 1
    assert.equal(mod.beginScanRescan({ scanType: 'resume' }), false, '超过本地有效期就不许移交')
    assert.equal(store.get(mod.SCAN_WORKBENCH_SESSION_KEY), before, '被拒也不许动登记')
  } finally {
    Date.now = realNow
  }
})

test('the explicit plain restart is the only thing that ends the session without an authority', async () => {
  const store = installStorage()
  const mod = await loadSessionModule()
  seedFinishedScan(mod, store)
  mod.armScanRescanAuthority(PRIOR)

  // 用户看完「没有安全重扫凭据」的说明，自己按下「重新开始一次扫描」。
  mod.beginPlainScanRestart({ scanType: 'resume', extras: { source: 'feeder' } })

  const stored = mod.readScanWorkbenchSession()
  assert.equal(stored.stage, 'settings')
  assert.equal(stored.live, undefined, '上一场的凭证必须跟着这一步消失')
  assert.equal(stored.result, undefined)
  assert.equal(stored.rescanIntent, undefined, '普通会话不许带着安全重扫意图进设置页')
  assert.deepEqual(stored.extras, { source: 'feeder' }, '扫描参数照旧带过去')
  assert.equal(
    mod.takeScanRescanAuthority('resume'),
    null,
    '显式普通重开必须把槽位里的授权也扔掉：它声明的就是「这一次不是安全重扫」',
  )
  const persisted = store.get(mod.SCAN_WORKBENCH_SESSION_KEY)
  assert.equal(persisted.includes(PRIOR.priorControlToken), false)
})

test('the rescan intent marker lives exactly as long as its own session', async () => {
  const store = installStorage()
  const mod = await loadSessionModule()
  seedFinishedScan(mod, store)
  mod.armScanRescanAuthority(PRIOR)

  assert.equal(mod.beginScanRescan({ scanType: 'resume' }), true)
  assert.equal(mod.readScanWorkbenchSession().rescanIntent, true, '意图要写进登记（它是重载之后唯一的线索）')
  // 布尔而已：凭证一个字节都不在里面。
  const persisted = store.get(mod.SCAN_WORKBENCH_SESSION_KEY)
  assert.equal(persisted.includes(PRIOR.priorControlToken), false)
  assert.equal(persisted.includes(PRIOR.priorScanTaskId), false)

  // 会话建成（写 live）不动它：那一刻页面还在同一场里。
  mod.patchScanWorkbenchSession({
    stage: 'settings',
    live: { scanTaskId: 'scan-new-1', controlToken: 'new-token', instructions: [], expiresAt: '2099-01-01T00:00:00.000Z' },
  })
  assert.equal(mod.readScanWorkbenchSession().rescanIntent, true)

  /* 而「安全返回扫描首页」（live: undefined）必须把它一起抹掉。少了这一句，
   * 用户随后重新选类型开的那场**普通**扫描会继承一个过期意图，被设置页
   * fail-closed 锁死 —— 防线错杀正常路径，比没有防线更糟。 */
  mod.patchScanWorkbenchSession({ stage: 'start', live: undefined, result: undefined })
  assert.equal(mod.readScanWorkbenchSession().rescanIntent, undefined)
})

test('a privacy clear takes the intent marker with it', async () => {
  const store = installStorage()
  const mod = await loadSessionModule()
  seedFinishedScan(mod, store)
  mod.armScanRescanAuthority(PRIOR)
  mod.beginScanRescan({ scanType: 'resume' })

  mod.clearScanWorkbenchSession()
  assert.equal(mod.readScanWorkbenchSession(), null)
  assert.equal(store.get(mod.SCAN_WORKBENCH_SESSION_KEY), undefined)
})

test('only a literal true in storage counts as a rescan intent', async () => {
  const store = installStorage()
  const mod = await loadSessionModule()
  store.set(mod.SCAN_WORKBENCH_SESSION_KEY, JSON.stringify({
    stage: 'settings',
    scanType: 'resume',
    rescanIntent: 'true',
  }))
  assert.equal(
    mod.readScanWorkbenchSession().rescanIntent,
    undefined,
    '被人手改过的字节不足以把一场扫描锁进 fail-closed',
  )
})

test('the fail-closed predicate fires only on a reload that lost the credentials', async () => {
  installStorage()
  const mod = await loadSessionModule()
  const live = { scanTaskId: 'scan-live-1', controlToken: 'live-token', instructions: [], expiresAt: '2099-01-01T00:00:00.000Z' }

  // 没有意图 = 普通会话，照常创建。
  assert.equal(
    mod.scanRescanCredentialsLost({ session: { stage: 'settings', scanType: 'resume' }, scanType: 'resume', restoredLive: null }),
    false,
  )
  // 有意图、凭据也还在内存里 = 这一帧就是点完「重试扫描」跳过来的，照常创建（带两半）。
  mod.armScanRescanAuthority(PRIOR)
  assert.equal(
    mod.scanRescanCredentialsLost({
      session: { stage: 'settings', scanType: 'resume', rescanIntent: true },
      scanType: 'resume',
      restoredLive: null,
    }),
    false,
  )
  // 有意图、会话已经建成（复水到 live）= 这一笔意图早就兑现了，本页根本不会再创建。
  mod.clearScanRescanAuthority()
  assert.equal(
    mod.scanRescanCredentialsLost({
      session: { stage: 'settings', scanType: 'resume', rescanIntent: true },
      scanType: 'resume',
      restoredLive: live,
    }),
    false,
  )
  // 有意图、没有 live、内存里也没有凭据 = 整页重载把凭据抹掉了 → fail-closed。
  assert.equal(
    mod.scanRescanCredentialsLost({
      session: { stage: 'settings', scanType: 'resume', rescanIntent: true },
      scanType: 'resume',
      restoredLive: null,
    }),
    true,
  )
})

test('a cold module can still arm and hand off on the click itself', async () => {
  installStorage()
  const mod = await loadSessionModule()

  /* 首屏那一帧：结果页的 useEffect 还没跑，模块内存里什么都没有，而按钮已经能点了。
   * 点击那一刻先幂等登记再移交 —— 这就是「快点两下也不会变成普通建单」靠的那一步。 */
  assert.equal(mod.hasScanRescanAuthority('resume'), false)
  assert.equal(mod.armScanRescanAuthority(PRIOR), true)
  assert.equal(mod.beginScanRescan({ scanType: 'resume' }), true)
  assert.deepEqual(mod.takeScanRescanAuthority('resume'), {
    retryOfScanTaskId: PRIOR.priorScanTaskId,
    priorControlToken: PRIOR.priorControlToken,
  })
})

test('incomplete credentials are refused at arming time', async () => {
  installStorage()
  const mod = await loadSessionModule()
  assert.equal(
    mod.armScanRescanAuthority({ ...PRIOR, priorControlToken: '   ' }),
    false,
    '半对凭据不许登记：它只会在下一步被服务端 400/403 顶回来',
  )
  assert.equal(mod.armScanRescanAuthority({ ...PRIOR, priorScanTaskId: '' }), false)
  assert.equal(mod.hasScanRescanAuthority('resume'), false)
})
