/**
 * 不含 AI 的提审版：页面 data 里的入口、tab 下标、生成后再还原逐字节相同。
 * 往返认起点：手头已经是不含 AI 版时，还原到 stash 里的完整版原件，再生成回来必须回到起点。
 * 这条往返在完整版目录里也用子进程真跑一遍（手改要红），不靠目录当前停在哪个版本。
 * 注入版本时开关和路由表成套给（variantModules），测的就是真实发布的组合。
 * 停放页只随完整版发布，沙箱要让它拿到 stash 里的完整版路由表；在包里的页拿到不含 AI 的真实模块。
 * 不含 AI 版的整条 verify:static 链在临时副本里再跑一遍，完整版目录的普通测试就能走到停放页的 stash 分支。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { instantiate, loadPageDefinition, variantModules } from './page-sandbox.mjs'

const require = createRequire(import.meta.url)
const MINIAPP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const REPO = path.resolve(MINIAPP, '../..')
const { selectedIndex } = require('../../utils/tab-bar-index.js')

const wx = {}

// 防递归，不是跳过检查。verify:static 会跑到本文件；子进程带 MINIAPP_NOAI_CHAIN_INNER=1 时，
// 下面几个「拷临时副本」的重用例直接返回，避免再套一层。别的用例照常跑。真正的检查在外层那一遍。
const CHAIN_INNER = process.env.MINIAPP_NOAI_CHAIN_INNER === '1'

function page(rel) {
  return instantiate(loadPageDefinition(rel, { wx, modules: variantModules('no-ai') }))
}

function joinField(list, key) {
  const out = []
  for (let i = 0; i < list.length; i += 1) out.push(list[i][key])
  return out.join(',')
}

test('tab 下标按当前 tab 列表里的路径算', () => {
  const full = [
    { pagePath: '/pages/home/home' },
    { pagePath: '/pages/ai/ai' },
    { pagePath: '/pages/print/print' },
    { pagePath: '/pages/me/me' },
  ]
  assert.equal(selectedIndex(full, '/pages/home/home'), 0)
  assert.equal(selectedIndex(full, '/pages/ai/ai'), 1)
  assert.equal(selectedIndex(full, '/pages/print/print'), 2)
  assert.equal(selectedIndex(full, '/pages/me/me'), 3)
  assert.equal(selectedIndex(full, 'pages/print/print'), 2)
  const compact = [full[0], full[2], full[3]]
  assert.equal(selectedIndex(compact, '/pages/home/home'), 0)
  assert.equal(selectedIndex(compact, '/pages/print/print'), 1)
  assert.equal(selectedIndex(compact, '/pages/me/me'), 2)
})

test('AI_ENABLED=false 时首页、我的、关于、反馈、隐私不带 AI 入口', () => {
  const home = page('pages/home/home.js')
  assert.equal(home.data.aiEnabled, false)
  assert.equal(home.data.primaryServices.length, 0)

  const me = page('pages/me/me.js')
  assert.equal(joinField(me.data.entries, 'id'), 'docs,orders,feedback,settings')
  assert.equal(joinField(me.data.stats, 'key'), 'docs,order')

  const about = page('pages/about/about.js')
  assert.equal(joinField(about.data.links2, 'id'), 'operator')
  assert.equal(about.data.links2.length, 1)

  const feedback = page('pages/feedback/feedback.js')
  assert.equal(joinField(feedback.data.categories, 'value').includes('ai_content'), false)
  feedback.onLoad({ category: 'ai_content' })
  assert.equal(feedback.data.category, 'general')

  const privacy = page('pages/privacy/privacy.js')
  assert.equal(privacy.data.aiEnabled, false)
  assert.equal(String(privacy.data.consentGroupLabel).includes('AI'), false)
  assert.equal(String(privacy.data.selfHelpLine).includes('AI'), false)
  assert.equal(String(privacy.data.selfHelpLine).includes('简历'), false)
})

test('full → no-ai → full 关键文件逐字节还原', () => {
  if (CHAIN_INNER) return // 防递归，不是跳过检查
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'miniapp-variant-test-'))
  const keys = [
    'app.json',
    'project.config.json',
    'custom-tab-bar/index.js',
    'scripts/privacy-api-inventory.json',
    'utils/voice-recorder.js',
    'utils/build-variant.js',
    'utils/ai-entries.js',
  ]
  try {
    fs.cpSync(MINIAPP, tmp, {
      recursive: true,
      filter: (src) => {
        const base = path.basename(src)
        return base !== 'node_modules' && base !== '.git' && base !== '.claude' && base !== 'miniprogram_npm'
      },
    })
    const startText = fs.readFileSync(path.join(tmp, 'utils/build-variant.js'), 'utf8')
    const start = (startText.match(/VARIANT:\s*'([^']+)'/) || [])[1] || ''
    const before = keys.map((rel) => fs.readFileSync(path.join(tmp, rel)))
    const stashDir = path.join(tmp, 'review-variants/stash')
    const stashBefore = start === 'no-ai'
      ? keys.map((rel) => {
          const file = path.join(stashDir, rel)
          assert.equal(fs.existsSync(file), true, `起点 stash 缺少 ${rel}`)
          return fs.readFileSync(file)
        })
      : null
    const run = (variant) => spawnSync(process.execPath, ['scripts/make-review-variant.mjs', '--variant', variant], {
      cwd: tmp,
      encoding: 'utf8',
    })
    const toNoAi = run('no-ai')
    assert.equal(toNoAi.status, 0, toNoAi.stderr || toNoAi.stdout)
    const again = run('no-ai')
    assert.equal(again.status, 0, again.stderr || again.stdout)
    const switched = fs.readFileSync(path.join(tmp, 'utils/build-variant.js'), 'utf8')
    assert.match(switched, /VARIANT:\s*'no-ai'/)
    assert.match(switched, /AI_ENABLED:\s*false/)
    const emptied = fs.readFileSync(path.join(tmp, 'utils/ai-entries.js'), 'utf8')
    assert.equal(emptied.includes('/pages/'), false)
    assertGeneratedEmptyMatches(path.join(tmp, 'utils/ai-entries.js'))
    const grep = spawnSync('grep', [
      '-rn',
      '--exclude-dir=scripts',
      '--exclude-dir=review-variants',
      '--exclude-dir=node_modules',
      '--exclude-dir=.git',
      '--include=*.js',
      '--include=*.wxml',
      '/pages/\\(ai\\|assistant\\|resume-\\|interview-\\|career-plan\\|self-explore\\|job-fit\\|ai-records\\|resumes\\|daily-report\\)',
      '.',
    ], { cwd: tmp, encoding: 'utf8' })
    assert.equal(grep.stdout, '')
    assert.equal(grep.status, 1)
    const app = JSON.parse(fs.readFileSync(path.join(tmp, 'app.json'), 'utf8'))
    assert.equal(app.pages.includes('pages/ai/ai'), false)
    assert.equal((app.tabBar.list || []).length, 3)
    const back = run('full')
    assert.equal(back.status, 0, back.stderr || back.stdout)
    if (start === 'no-ai') {
      keys.forEach((rel, index) => {
        assert.equal(stashBefore[index].equals(fs.readFileSync(path.join(tmp, rel))), true, `还原完整版后 ${rel} 应等于起点 stash 原件`)
      })
      assert.equal(fs.existsSync(stashDir), false, '还原完整版后 stash 应删掉')
      const regenerated = run('no-ai')
      assert.equal(regenerated.status, 0, regenerated.stderr || regenerated.stdout)
      keys.forEach((rel, index) => {
        assert.equal(before[index].equals(fs.readFileSync(path.join(tmp, rel))), true, `再生成不含 AI 后 ${rel} 应等于起点`)
        assert.equal(stashBefore[index].equals(fs.readFileSync(path.join(stashDir, rel))), true, `再生成不含 AI 后 stash ${rel} 应等于起点原件`)
      })
    } else {
      keys.forEach((rel, index) => {
        assert.equal(before[index].equals(fs.readFileSync(path.join(tmp, rel))), true, rel)
      })
      assert.equal(fs.existsSync(path.join(tmp, 'review-variants/stash')), false)
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})

test('不含 AI 版里，停放页用完整版路由表，在包里的页用不含 AI 的真实模块', () => {
  if (CHAIN_INNER) return // 防递归，不是跳过检查
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'miniapp-variant-route-'))
  const runner = path.join(os.tmpdir(), `miniapp-route-runner-${process.pid}-${Date.now()}.mjs`)
  const out = path.join(os.tmpdir(), `miniapp-route-out-${process.pid}-${Date.now()}.json`)
  try {
    fs.cpSync(MINIAPP, tmp, {
      recursive: true,
      filter: (src) => {
        const base = path.basename(src)
        return base !== 'node_modules' && base !== '.git' && base !== '.claude' && base !== 'miniprogram_npm'
      },
    })
    const generated = spawnSync(process.execPath, ['scripts/make-review-variant.mjs', '--variant', 'no-ai'], {
      cwd: tmp,
      encoding: 'utf8',
    })
    assert.equal(generated.status, 0, generated.stderr || generated.stdout)
    const sandboxUrl = pathToFileURL(path.join(tmp, 'scripts/tests/page-sandbox.mjs')).href
    fs.writeFileSync(runner, `
import { instantiate, loadPageDefinition } from ${JSON.stringify(sandboxUrl)}
const parkedNav = []
const parkedWx = { navigateTo(o) { parkedNav.push(o.url) } }
const parked = instantiate(loadPageDefinition('pages/ai/ai.js', { wx: parkedWx, modules: {} }))
parked.tapEntry({ currentTarget: { dataset: { id: 'diagnose' } } })
parked.tapEntry({ currentTarget: { dataset: { id: 'explore' } } })
parked.tapChat()
const home = instantiate(loadPageDefinition('pages/home/home.js', { wx: {}, modules: {} }))
const me = instantiate(loadPageDefinition('pages/me/me.js', { wx: {}, modules: {} }))
const fs = await import('node:fs')
fs.writeFileSync(process.argv[2], JSON.stringify({
  parked: parkedNav,
  homeAiEnabled: home.data.aiEnabled,
  homePrimaryServices: home.data.primaryServices.length,
  meStats: me.data.stats.map((item) => item.key),
}))
`)
    const ran = spawnSync(process.execPath, [runner, out], { cwd: tmp, encoding: 'utf8' })
    assert.equal(ran.status, 0, `${ran.stdout || ''}\n${ran.stderr || ''}`)
    const got = JSON.parse(fs.readFileSync(out, 'utf8'))
    assert.deepEqual(got.parked, [
      '/pages/resume-diagnose/resume-diagnose',
      '/pages/self-explore/self-explore',
      '/pages/assistant/assistant',
    ])
    assert.equal(got.homeAiEnabled, false)
    assert.equal(got.homePrimaryServices, 0)
    assert.deepEqual(got.meStats, ['docs', 'order'])
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
    fs.rmSync(runner, { force: true })
    fs.rmSync(out, { force: true })
  }
})

function copyMiniappTo(dest) {
  fs.cpSync(MINIAPP, dest, {
    recursive: true,
    filter: (src) => {
      const base = path.basename(src)
      return base !== 'node_modules' && base !== '.git' && base !== '.claude' && base !== 'miniprogram_npm'
    },
  })
}

// 不带内层模式的环境变量，让门禁走完整流程（含从不含 AI 起点出发的往返）。
function runVerifyFull(cwd) {
  const env = { ...process.env }
  delete env.MINIAPP_REVIEW_VARIANT_INNER
  return spawnSync(process.execPath, ['scripts/verify-review-variant.mjs'], {
    cwd,
    env,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  })
}

function outputOf(result) {
  return `${result.stdout || ''}\n${result.stderr || ''}`
}

// 干净通过由下面「整条 verify:static 链」覆盖。这里只留两条反向，避免再跑一遍门禁。
test('不含 AI 起点的往返检查能发现手改：加空行失败，把 aiPage 注册回去失败', { timeout: 600000 }, () => {
  if (CHAIN_INNER) return // 防递归，不是跳过检查
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'miniapp-variant-gate-'))
  const started = Date.now()
  try {
    copyMiniappTo(tmp)
    const generated = spawnSync(process.execPath, ['scripts/make-review-variant.mjs', '--variant', 'no-ai'], {
      cwd: tmp,
      encoding: 'utf8',
    })
    assert.equal(generated.status, 0, generated.stderr || generated.stdout)

    const entriesPath = path.join(tmp, 'utils/ai-entries.js')
    const entriesBefore = fs.readFileSync(entriesPath)
    fs.appendFileSync(entriesPath, '\n')
    const drifted = runVerifyFull(tmp)
    const driftedOut = outputOf(drifted)
    assert.match(driftedOut, /关键文件与起点不一致/)
    assert.notEqual(drifted.status, 0)

    fs.writeFileSync(entriesPath, entriesBefore)
    const appPath = path.join(tmp, 'app.json')
    const app = JSON.parse(fs.readFileSync(appPath, 'utf8'))
    assert.equal(app.pages.includes('pages/ai/ai'), false)
    app.pages.push('pages/ai/ai')
    fs.writeFileSync(appPath, `${JSON.stringify(app, null, 2)}\n`)
    const reregistered = runVerifyFull(tmp)
    const reregisteredOut = outputOf(reregistered)
    assert.notEqual(reregistered.status, 0, reregisteredOut.split('\n').slice(-20).join('\n'))
    assert.match(reregisteredOut, /仍注册/)
  } finally {
    console.log(`不含 AI 起点手改检查耗时 ${Date.now() - started} ms`)
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})

/** 生成脚本写出的空路由表，必须和 variantModules('no-ai') 派生的那份是同一套。 */
function assertGeneratedEmptyMatches(generatedFile) {
  const generated = createRequire(generatedFile)(generatedFile)
  const derived = variantModules('no-ai')['ai-entries']
  const generatedKeys = Object.keys(generated).sort()
  const derivedKeys = Object.keys(derived).sort()
  assert.deepEqual(generatedKeys, derivedKeys, `键集合不同\n生成：${generatedKeys.join(',')}\n派生：${derivedKeys.join(',')}`)
  const calls = [
    [],
    ['/pages/assistant/assistant'],
    ['/pages/assistant/assistant', 'from=me'],
  ]
  for (const key of generatedKeys) {
    const left = generated[key]
    const right = derived[key]
    if (typeof left === 'function' || typeof right === 'function') {
      assert.equal(typeof left, 'function', `${key} 生成侧应为函数`)
      assert.equal(typeof right, 'function', `${key} 派生侧应为函数`)
      for (const args of calls) {
        assert.equal(left(...args), right(...args), `${key}(${args.join(',')})`)
      }
    } else {
      assert.deepEqual(left, right, key)
    }
  }
}

/** 与 run-static.py 一样：pnpm run X 递归换成脚本正文，再按 && 拆开。 */
function expandScript(scripts, cmd) {
  const out = []
  for (const part of cmd.split('&&').map((item) => item.trim()).filter(Boolean)) {
    if (part.startsWith('pnpm run ')) {
      const name = part.slice('pnpm run '.length).trim()
      if (!Object.prototype.hasOwnProperty.call(scripts, name)) {
        throw new Error(`package.json 没有脚本 ${name}`)
      }
      out.push(...expandScript(scripts, scripts[name]))
    } else {
      out.push(part)
    }
  }
  return out
}

function lastLines(result) {
  return `${result.stdout || ''}\n${result.stderr || ''}`.trim().split('\n').slice(-20).join('\n')
}

// 本用例自己跑在 node:test 里。子进程若继承 NODE_TEST_CONTEXT，嵌套的 `node --test`
// 会被运行时当成递归，直接跳过文件且退出码仍是 0。去掉它，链上的测试才会真跑。
function chainEnv() {
  const env = { ...process.env, MINIAPP_NOAI_CHAIN_INNER: '1' }
  delete env.NODE_TEST_CONTEXT
  return env
}

test('不含 AI 版：整条 verify:static 链在临时副本里 0 失败', { timeout: 600000 }, () => {
  if (CHAIN_INNER) return // 防递归，不是跳过检查
  const apiSrc = path.join(REPO, 'services/api/src')
  assert.equal(
    fs.existsSync(apiSrc),
    true,
    `仓库里没有 services/api/src（从 apps/miniapp 往上两级是 ${REPO}），整条链要读后端源码，不能跳过`,
  )
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'miniapp-noai-chain-'))
  const servicesLink = path.join(tempRoot, 'services')
  const copyRoot = path.join(tempRoot, 'apps/miniapp')
  const started = Date.now()
  const timings = []
  let linkGone = true
  try {
    fs.mkdirSync(path.dirname(copyRoot), { recursive: true })
    copyMiniappTo(copyRoot)
    // 只读仓库的 services。目前整条链出 apps/miniapp 只读这一处；再发现别的目录同样做链接。
    fs.symlinkSync(path.join(REPO, 'services'), servicesLink, 'junction')
    const generated = spawnSync(process.execPath, ['scripts/make-review-variant.mjs', '--variant', 'no-ai'], {
      cwd: copyRoot,
      encoding: 'utf8',
    })
    assert.equal(generated.status, 0, generated.stderr || generated.stdout)
    // 副本必须真的切到了不含 AI 版：生成脚本要是悄悄什么都没做，下面这条链就是在完整版上空跑。
    assert.match(fs.readFileSync(path.join(copyRoot, 'utils/build-variant.js'), 'utf8'), /VARIANT:\s*'no-ai'/)
    assert.equal(fs.existsSync(path.join(copyRoot, 'review-variants/stash')), true, '不含 AI 版应留有 stash 原件')
    const pkg = JSON.parse(fs.readFileSync(path.join(copyRoot, 'package.json'), 'utf8'))
    const commands = expandScript(pkg.scripts, pkg.scripts['verify:static'])
    assert.ok(commands.length > 0, 'verify:static 展开后没有命令')
    for (const cmd of commands) {
      const parts = cmd.split(/\s+/).filter(Boolean)
      assert.equal(parts[0], 'node', `不是 node 开头的命令：${cmd}`)
      const t0 = Date.now()
      const result = spawnSync(process.execPath, parts.slice(1), {
        cwd: copyRoot,
        env: chainEnv(),
        encoding: 'utf8',
        maxBuffer: 32 * 1024 * 1024,
      })
      timings.push({ cmd, ms: Date.now() - t0, status: result.status })
      if (result.status !== 0) {
        const reason = result.error ? result.error.message : ''
        assert.equal(result.status, 0, `命令失败：${cmd}\n${reason}\n${lastLines(result)}`)
      }
    }
  } finally {
    const total = Date.now() - started
    console.log(`不含 AI 整条 verify:static 链耗时 ${total} ms`)
    const slow = timings.slice().sort((a, b) => b.ms - a.ms).slice(0, 8)
    for (const item of slow) console.log(`  ${item.ms} ms status=${item.status} ${item.cmd}`)
    try {
      if (fs.lstatSync(servicesLink).isSymbolicLink()) fs.unlinkSync(servicesLink)
    } catch (err) {
      if (!err || err.code !== 'ENOENT') linkGone = false
    }
    // 链接还在就不动临时目录，避免 rm 顺着链接删进仓库的 services。
    if (linkGone) fs.rmSync(tempRoot, { recursive: true, force: true })
    else console.error(`没有删除 ${tempRoot}：services 链接还在`)
  }
})
