import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath) => readFileSync(join(root, relativePath), 'utf8')
const entries = read('src/pages/profile/profileEntries.ts')
const login = read('src/pages/auth/LoginPage.tsx')
const settings = read('src/pages/profile/me/MySettingsPage.tsx')

for (const forbidden of [
  '招聘会扫码凭证',
  '招聘会权益活动',
  '求职打印套餐',
  'AI服务套餐',
  "label: '身份切换'",
  "type LoginTab = 'phone' | 'scan' | 'email'",
  'EmailReservedPane',
  '邮箱登录暂未开放',
  '/activities?source=fair',
]) {
  assert.equal(`${entries}\n${login}`.includes(forbidden), false, `禁止残留：${forbidden}`)
}

assert.equal((entries.match(/label: '权益活动'/g) ?? []).length, 1, '权益活动只保留一个真实入口')
assert.equal((entries.match(/label: '/g) ?? []).length, 22, 'Profile 只保留 22 个已接真目的地')
assert.match(entries, /label: '权益活动'[\s\S]{0,120}route: '\/activities'/)
assert.match(entries, /label: '我的权益'[\s\S]{0,100}desc: '券与活动权益'/)
assert.doesNotMatch(entries, /套餐、券、活动/)
assert.doesNotMatch(settings, /身份切换/)
assert.match(settings, /手机号换绑、账号注销和数据导出尚未开放/)
assert.doesNotMatch(`${entries}\n${login}`, /一键投递|立即投递|平台投递|投递简历/)

console.log('verify-user-center-wave0: ok')
