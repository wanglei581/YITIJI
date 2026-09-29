/**
 * 不含 AI 的提审版：页面 data 里的入口、tab 下标、生成后再还原逐字节相同。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { instantiate, loadPageDefinition } from './page-sandbox.mjs'

const require = createRequire(import.meta.url)
const MINIAPP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const { selectedIndex } = require('../../utils/tab-bar-index.js')

const noAi = { VARIANT: 'no-ai', AI_ENABLED: false }
const wx = {}

function page(rel) {
  return instantiate(loadPageDefinition(rel, { wx, modules: { 'build-variant': noAi } }))
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
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'miniapp-variant-test-'))
  const keys = [
    'app.json',
    'project.config.json',
    'custom-tab-bar/index.js',
    'scripts/privacy-api-inventory.json',
    'utils/voice-recorder.js',
    'utils/build-variant.js',
  ]
  try {
    fs.cpSync(MINIAPP, tmp, {
      recursive: true,
      filter: (src) => {
        const base = path.basename(src)
        return base !== 'node_modules' && base !== '.git' && base !== '.claude' && base !== 'miniprogram_npm'
      },
    })
    const before = keys.map((rel) => fs.readFileSync(path.join(tmp, rel)))
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
    const app = JSON.parse(fs.readFileSync(path.join(tmp, 'app.json'), 'utf8'))
    assert.equal(app.pages.includes('pages/ai/ai'), false)
    assert.equal((app.tabBar.list || []).length, 3)
    const back = run('full')
    assert.equal(back.status, 0, back.stderr || back.stdout)
    keys.forEach((rel, index) => {
      assert.equal(before[index].equals(fs.readFileSync(path.join(tmp, rel))), true, rel)
    })
    assert.equal(fs.existsSync(path.join(tmp, 'review-variants/stash')), false)
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})
