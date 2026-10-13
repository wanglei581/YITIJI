/**
 * 小青页固定安全提示（pages/assistant）：真跑页面，api / auth 是替身。
 *
 * 钉住的是第 33 条小程序这半：
 *   - 后端 fixedNotice 严格等于 true 时，最后一条记下这个标记，正文照原文，不挂「AI 服务不可用」那句；
 *   - 没有这个字段，或值是字符串 'true'、数字 1，就和原来一样；
 *   - 模板只在不是加载中、且 fixedNotice 为真时，于正文上方标「安全提示」四个字；
 *   - 这条样式只用页面里已经在用的麦色变量，不新写颜色。
 *
 * voice-recorder、ai-access 不替：本页 _send 用不到它们，跟 page-lifecycle 里
 * 「小青回复失败」那条一样，require 走真实模块。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { flush, instantiate, loadPageDefinition } from './page-sandbox.mjs'

const MINIAPP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const PAGE = 'pages/assistant/assistant.js'

/** 小程序版固定原文。测试只跟这一句对，不读后端文件。 */
const FIXED_REPLY = '一体机卡纸、缺纸、打不出来或有其它故障时，请不要自己打开机器、拉扯纸张、按机身上的按键或拔插电源。机器暂时用不了的话，请稍后再来；需要帮助可以在「意见反馈」里告诉我们。如果看到冒烟、闻到焦味或听到异常响声，请立刻离开机器；有明火或人身危险请拨打 119。'

const FALLBACK = '本条不是模型生成的回答，是系统预置话术（AI 服务当前不可用）。'

function createWx() {
  return {
    getStorageSync: () => '',
    setStorageSync() {},
    removeStorageSync() {},
    navigateTo() {},
    navigateBack(opts) { if (opts && opts.fail) opts.fail({ errMsg: 'no page' }) },
    switchTab() {},
    showToast() {},
    showModal() {},
    getWindowInfo: () => ({ statusBarHeight: 20 }),
    getSystemInfoSync: () => ({ statusBarHeight: 20 }),
  }
}

function createAuth() {
  return {
    isLoggedIn: () => true,
    getUser: () => ({ id: 'A' }),
    getToken: () => 'tok-A',
    sessionGeneration: () => 1,
  }
}

function loadAssistant(reply, source) {
  const api = {
    assistantChat: () => Promise.resolve(reply),
    getAssistantVoiceCapability: () => Promise.resolve({ asrEnabled: false }),
  }
  const def = loadPageDefinition(PAGE, {
    wx: createWx(),
    modules: { api, auth: createAuth() },
    source,
  })
  return instantiate(def)
}

async function send(reply, source) {
  const page = loadAssistant(reply, source)
  await page._send('打印机卡纸了怎么办')
  await flush()
  const messages = page.data.messages
  const last = messages[messages.length - 1]
  return { page, last }
}

test('a. fixedNotice 为 true 时记下标记，正文照原文，不挂预置话术说明', async () => {
  const { page, last } = await send({
    fixedNotice: true,
    aiGenerated: true,
    actions: [],
    reply: FIXED_REPLY,
  })
  assert.equal(last.fixedNotice, true)
  assert.equal(last.text, FIXED_REPLY)
  assert.equal(last.fallbackNote, '')
  assert.equal(last.cards.length, 0)
  assert.equal(page.data.sending, false)
})

test('b. fixedNotice 为 true 且没走模型时，也不挂预置话术说明', async () => {
  const { last } = await send({
    fixedNotice: true,
    aiGenerated: false,
    actions: [],
    reply: FIXED_REPLY,
  })
  assert.equal(last.fixedNotice, true)
  assert.equal(last.fallbackNote, '')
})

test('c. 没有 fixedNotice、又没走模型时，仍是原来那句预置话术说明', async () => {
  const { last } = await send({
    aiGenerated: false,
    actions: [],
    reply: '系统预置的一句',
  })
  assert.equal(last.fixedNotice, false)
  assert.equal(last.fallbackNote, FALLBACK)
})

test('d. 没有 fixedNotice 的真实模型回答，不挂说明', async () => {
  const { last } = await send({
    aiGenerated: true,
    actions: [],
    reply: '可以先从项目经历改起。',
  })
  assert.equal(last.fixedNotice, false)
  assert.equal(last.fallbackNote, '')
})

test('e. 字符串 true 和数字 1 都不算固定安全提示', async () => {
  for (const fixedNotice of ['true', 1]) {
    for (const aiGenerated of [true, false]) {
      const { last } = await send({
        fixedNotice,
        aiGenerated,
        actions: [],
        reply: '普通回答',
      })
      assert.equal(last.fixedNotice, false, `fixedNotice=${JSON.stringify(fixedNotice)} 不得当成固定安全提示`)
      assert.equal(
        last.fallbackNote,
        aiGenerated ? '' : FALLBACK,
        `fixedNotice=${JSON.stringify(fixedNotice)}、aiGenerated=${aiGenerated} 时说明应按原来的规则`,
      )
    }
  }
})

function readPage(rel) {
  return fs.readFileSync(path.join(MINIAPP, rel), 'utf8')
}

function viewTags(src) {
  const tags = []
  const re = /<\/?view\b[^>]*>/g
  let m
  while ((m = re.exec(src))) {
    tags.push({ index: m.index, end: re.lastIndex, raw: m[0], close: m[0].startsWith('</') })
  }
  return tags
}

test('f. 模板只在非加载中的固定提示上方标「安全提示」，不打断加载与正文的配对', () => {
  const wxml = readPage('pages/assistant/assistant.wxml')
  assert.equal(wxml.split('安全提示').length - 1, 1, '「安全提示」全文应恰好出现一次')

  const tag = wxml.match(/<view\s+wx:if="([^"]+)"\s+class="msg-notice-tag">安全提示<\/view>/)
  assert.ok(tag, '「安全提示」应写在 class 为 msg-notice-tag 的 view 上')
  assert.equal(tag[1].includes('item.fixedNotice'), true, '小标的 wx:if 里要有 item.fixedNotice')
  assert.equal(tag[1].includes('!item.loading'), true, '小标的 wx:if 里要有 !item.loading')

  const aiAt = wxml.indexOf("item.role === 'ai'")
  const userAt = wxml.indexOf("item.role === 'user'")
  const noticeAt = wxml.indexOf('安全提示')
  const textAt = wxml.indexOf('{{item.text}}')
  assert.equal(aiAt >= 0 && noticeAt > aiAt && userAt > noticeAt, true, '小标要在 AI 消息那一块里')
  assert.equal(textAt > noticeAt, true, '小标要在正文 {{item.text}} 之前')

  const tags = viewTags(wxml)
  const open = tags.find((t) => !t.close && t.raw.includes('wx:if="{{item.loading}}"'))
  assert.ok(open, '找不到加载中的 wx:if')
  let depth = 0
  let close = null
  for (const t of tags) {
    if (t.index < open.index) continue
    if (!t.close) depth += 1
    else {
      depth -= 1
      if (depth === 0) { close = t; break }
    }
  }
  assert.ok(close, '加载中那个 view 没有闭合')
  const sib = tags.find((t) => !t.close && t.index >= close.end)
  assert.ok(sib, '加载中那个 view 后面没有兄弟')
  const between = wxml.slice(close.end, sib.index)
  assert.equal(/^\s*$/.test(between), true, '加载中那个 view 与下一个兄弟之间夹了别的元素')
  assert.equal(sib.raw.includes('wx:else'), true, '紧跟的兄弟仍应是 wx:else')
  const sibClose = tags.find((t) => t.close && t.index >= sib.end)
  assert.ok(sibClose, 'wx:else 那个 view 没有闭合')
  assert.equal(wxml.slice(sib.end, sibClose.index).includes('{{item.text}}'), true, 'wx:else 的正文仍是 {{item.text}}')
})

test('g. 小标样式只用已有的麦色变量，且只有一条规则', () => {
  const wxss = readPage('pages/assistant/assistant.wxss')
  const rules = [...wxss.matchAll(/\.msg-notice-tag\s*\{([^}]*)\}/g)]
  assert.equal(rules.length, 1, '.msg-notice-tag 规则应恰好一条')
  const body = rules[0][1]
  assert.equal(body.includes('#'), false, '规则体里不写 #')
  assert.equal(/rgb/i.test(body), false, '规则体里不写 rgb')
  assert.equal(/hsl/i.test(body), false, '规则体里不写 hsl')
  const allowed = ['--wheat-wash', '--wheat-soft', '--warn', '--fs-xs', '--r-xs', '--r-sm']
  const vars = [...body.matchAll(/var\(\s*(--[a-z0-9-]+)\s*\)/g)].map((m) => m[1])
  assert.equal(vars.length > 0, true, '规则体应使用已有变量')
  for (const name of vars) {
    assert.equal(allowed.includes(name), true, `不许新用 var(${name})`)
  }
})
