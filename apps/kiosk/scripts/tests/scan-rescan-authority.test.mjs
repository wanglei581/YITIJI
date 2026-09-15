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

/* ══ 取走之后的裁决：这一次失败到底用没用掉那枚授权 ═══════════════════════════
 *
 * 取用必须排在请求发出**之前**（并发双击、effect 重跑都得撞空槽位），所以失败回来时
 * 本机那一份已经不在槽位里了。而服务端那一半的消费（`retryConsumedAt` 的 CAS）在
 * `scan-tasks.service.ts` 的 `$transaction` **内部**，限流（12 次/分）与终端态检查更在
 * 事务之前就抛 —— 429 / `SCAN_TERMINAL_BUSY` / 断网 / 5xx 回来时，服务端那枚授权
 * 原封没动，只有本机把它自己扔了。
 *
 * 扔掉不是「少一个便利功能」：授权只在任务 matched 之后才铸，而 matched 同时写下
 * `lastAttemptHash` —— 那正是两小时同字节去重的键。两个条件必然同时成立，所以只要
 * 曾经有过授权，同一张纸走普通会话就**必定**撞 `SCAN_FILE_PREVIOUSLY_ATTEMPTED`。
 *
 * 下面把那条二选一、以及它绝不许放宽的三个边界逐条跑一遍。
 */

test('a failure that cannot prove server consumption puts the authority back', async () => {
  installStorage()
  const mod = await loadSessionModule()
  mod.armScanRescanAuthority(PRIOR)
  mod.beginScanRescan({ scanType: 'resume' })

  // 设置页发请求前取走 → 槽位空。
  assert.notEqual(mod.takeScanRescanAuthority('resume'), null)
  assert.equal(mod.hasScanRescanAuthority('resume'), false)

  // 429 / 断网 / 5xx 回来：服务端那枚没动，本机原样放回。
  assert.equal(mod.restoreScanRescanAuthority('resume'), true)
  assert.equal(mod.hasScanRescanAuthority('resume'), true)

  // 再点一次「再试一次安全重扫」，取到的仍是**同一对**凭据 —— 不是无签名的普通创建。
  assert.deepEqual(mod.takeScanRescanAuthority('resume'), {
    retryOfScanTaskId: PRIOR.priorScanTaskId,
    priorControlToken: PRIOR.priorControlToken,
  })
})

test('restoring never extends the TTL: it still expires on the original armedAtMs', async () => {
  installStorage()
  const mod = await loadSessionModule()
  const realNow = Date.now
  try {
    mod.armScanRescanAuthority(PRIOR)
    mod.beginScanRescan({ scanType: 'resume' })

    // 14 分钟后第一次创建失败（限流），凭据放回。
    Date.now = () => realNow() + mod.SCAN_RESCAN_AUTHORITY_TTL_MS - 60_000
    assert.notEqual(mod.takeScanRescanAuthority('resume'), null)
    assert.equal(mod.restoreScanRescanAuthority('resume'), true, '还在窗口内，放回后仍可用')

    /* 关键断言：如果恢复走的是 armScanRescanAuthority（按 Date.now 重新起算），
     * 这一刻窗口会被续到「第 14 分钟 + 15 分钟」，下面这条就会是 true。
     * 有效期必须始终从上一场铸出来那一刻算起 —— 失败几次都不延长。 */
    Date.now = () => realNow() + mod.SCAN_RESCAN_AUTHORITY_TTL_MS + 1
    assert.equal(mod.hasScanRescanAuthority('resume'), false, '恢复不许续期：原 armedAtMs 一到点就作废')
    assert.equal(mod.takeScanRescanAuthority('resume'), null)
  } finally {
    Date.now = realNow
  }
})

test('an already-expired authority is put back but reported unusable', async () => {
  installStorage()
  const mod = await loadSessionModule()
  const realNow = Date.now
  try {
    mod.armScanRescanAuthority(PRIOR)
    mod.beginScanRescan({ scanType: 'resume' })
    assert.notEqual(mod.takeScanRescanAuthority('resume'), null)

    // 请求在飞的这段时间里本地窗口走完了。放回去不算错，但绝不能报「可以重试」——
    // 页面据此改说「凭据已经不在本机」，而不是挂一句已经不成立的承诺。
    Date.now = () => realNow() + mod.SCAN_RESCAN_AUTHORITY_TTL_MS + 1
    assert.equal(mod.restoreScanRescanAuthority('resume'), false)
    assert.equal(mod.hasScanRescanAuthority('resume'), false)
  } finally {
    Date.now = realNow
  }
})

test('an explicit server refusal is never restored', async () => {
  installStorage()
  const mod = await loadSessionModule()
  mod.armScanRescanAuthority(PRIOR)
  mod.beginScanRescan({ scanType: 'resume' })
  assert.notEqual(mod.takeScanRescanAuthority('resume'), null)

  // 403 已被消费 / 已过期 / 血缘被占，或 400 半对凭据：服务端说不认，永久丢弃。
  mod.discardTakenScanRescanAuthority()
  assert.equal(mod.restoreScanRescanAuthority('resume'), false, '丢弃之后再想恢复也没有东西可恢复')
  assert.equal(mod.hasScanRescanAuthority('resume'), false)
  assert.equal(mod.takeScanRescanAuthority('resume'), null)
})

/* 下面两条证明的是**结果**（离开 / 清场之后恢复不回来），不是「代次比对那一行在起作用」：
 * 推进代次的 endScanLifecycle() 会在同一步清空寄存格，所以实际拦下它们的是那一句，
 * 走到代次比对时 pending 已经是 null。代次那一行今天是纵深，它的检测器是
 * verify:scan-session-truth 的形状断言（实测：只删那一行，本文件 33 条全绿、门禁红）。
 * 不要因为这两条绿了就以为代次比对被行为覆盖了。 */
test('leaving the flow between the take and the failure kills the restore', async () => {
  installStorage()
  const mod = await loadSessionModule()
  mod.armScanRescanAuthority(PRIOR)
  mod.beginScanRescan({ scanType: 'resume' })
  assert.notEqual(mod.takeScanRescanAuthority('resume'), null)

  // 「安全返回扫描首页」——创建请求还在飞。
  mod.patchScanWorkbenchSession({ stage: 'start', live: undefined, result: undefined })

  assert.equal(mod.restoreScanRescanAuthority('resume'), false, '这一场已经结束，凭证不许复活')
  assert.equal(mod.hasScanRescanAuthority('resume'), false)
})

test('a privacy clear between the take and the failure kills the restore', async () => {
  installStorage()
  const mod = await loadSessionModule()
  mod.armScanRescanAuthority(PRIOR)
  mod.beginScanRescan({ scanType: 'resume' })
  assert.notEqual(mod.takeScanRescanAuthority('resume'), null)

  // 隐私空闲 / 屏保 / 退出 / 换人，全走这一个入口。下一位用户绝不能继承上一位的凭证。
  mod.clearScanWorkbenchSession()

  assert.equal(mod.restoreScanRescanAuthority('resume'), false)
  assert.equal(mod.hasScanRescanAuthority('resume'), false)
})

test('the restore is one-shot and never resurrects a second time', async () => {
  installStorage()
  const mod = await loadSessionModule()
  mod.armScanRescanAuthority(PRIOR)
  mod.beginScanRescan({ scanType: 'resume' })
  assert.notEqual(mod.takeScanRescanAuthority('resume'), null)

  assert.equal(mod.restoreScanRescanAuthority('resume'), true)
  /* 同一个已经 settle 的 promise 上，后续每一轮 effect 都会再挂一次 catch，于是
   * restore 会被连着调用好几遍。**中间没有新的 take**，所以第二遍必须是空操作 ——
   * 页面正是靠这一点才敢「只在恢复成功时点亮按钮、从不写回 false」。
   * 如果第二遍还返回 true，就说明寄存格没被取空，一份授权能被恢复两次。 */
  assert.equal(mod.restoreScanRescanAuthority('resume'), false, '寄存格取完即空')
  assert.equal(mod.hasScanRescanAuthority('resume'), true, '第一次恢复的成果不受影响')
})

test('a resolved create consumes the parked authority for good', async () => {
  installStorage()
  const mod = await loadSessionModule()
  mod.armScanRescanAuthority(PRIOR)
  mod.beginScanRescan({ scanType: 'resume' })
  assert.notEqual(mod.takeScanRescanAuthority('resume'), null)

  /* 服务端回了 2xx，说明它真的跑过 handler：事务里的 CAS 已经把那枚授权消费掉。
   * 设置页在 .then 的第一句就丢弃寄存的那一份，之后谁都恢复不回来。 */
  mod.discardTakenScanRescanAuthority()
  assert.equal(mod.restoreScanRescanAuthority('resume'), false)
  assert.equal(mod.hasScanRescanAuthority('resume'), false)
})

test('a restore never overwrites an authority that already has an owner', async () => {
  installStorage()
  const mod = await loadSessionModule()
  mod.armScanRescanAuthority(PRIOR)
  mod.beginScanRescan({ scanType: 'resume' })
  assert.notEqual(mod.takeScanRescanAuthority('resume'), null)

  // 期间用户回到结果页，为**另一场**重新登记过一份。那一份才是当前这一场的。
  const NEWER = { ...PRIOR, priorScanTaskId: 'scan-prior-002', priorControlToken: 'newer-token' }
  assert.equal(mod.armScanRescanAuthority(NEWER), true)

  assert.equal(mod.restoreScanRescanAuthority('resume'), false, '槽位已经有主，寄存的那一份必须让路')
  assert.deepEqual(mod.takeScanRescanAuthority('resume'), {
    retryOfScanTaskId: NEWER.priorScanTaskId,
    priorControlToken: NEWER.priorControlToken,
  })
})

test('the restore is bound to one scan type', async () => {
  installStorage()
  const mod = await loadSessionModule()
  mod.armScanRescanAuthority(PRIOR)
  mod.beginScanRescan({ scanType: 'resume' })
  assert.notEqual(mod.takeScanRescanAuthority('resume'), null)

  assert.equal(mod.restoreScanRescanAuthority('id'), false, '换了扫描类型就不是同一份材料')
  assert.equal(mod.hasScanRescanAuthority('resume'), false)
  assert.equal(mod.hasScanRescanAuthority('id'), false)
})

test('a plain create leaves nothing to restore', async () => {
  installStorage()
  const mod = await loadSessionModule()

  // 用户从头新开一场（没有 arm 过）。取用返回 null，寄存格里也该是空的 ——
  // 否则一次普通创建失败也会点亮「再试一次安全重扫」，那是句假话。
  assert.equal(mod.takeScanRescanAuthority('resume'), null)
  assert.equal(mod.restoreScanRescanAuthority('resume'), false)
  assert.equal(mod.hasScanRescanAuthority('resume'), false)
})

test('the restored token still never reaches any browser storage', async () => {
  const store = installStorage()
  const mod = await loadSessionModule()
  mod.armScanRescanAuthority(PRIOR)
  mod.beginScanRescan({ scanType: 'resume' })
  mod.takeScanRescanAuthority('resume')
  mod.restoreScanRescanAuthority('resume')

  const bytes = JSON.stringify([...store.entries()])
  assert.equal(bytes.includes(PRIOR.priorControlToken), false, '恢复路径同样不许把明文凭证落盘')
  assert.equal(bytes.includes(PRIOR.priorScanTaskId), false)
})
