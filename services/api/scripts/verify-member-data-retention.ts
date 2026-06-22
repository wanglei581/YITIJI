import { existsSync, readFileSync } from 'fs'
import { resolve } from 'path'

const apiRoot = resolve(__dirname, '..')
const repoRoot = resolve(apiRoot, '../..')

function read(path: string): string {
  return readFileSync(resolve(repoRoot, path), 'utf8')
}

function pass(message: string): void {
  console.log(`PASS ${message}`)
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
  pass(message)
}

const docPath = 'docs/compliance/member-personal-data-retention.md'
assert(existsSync(resolve(repoRoot, docPath)), `${docPath} exists`)

const doc = read(docPath)
const memberAuth = read('services/api/src/member-auth/member-auth.service.ts')
const activity = read('services/api/src/activity/activity.service.ts')
const files = read('services/api/src/files/file.types.ts')
const storage = read('services/api/src/storage/storage.service.ts')
const ai = read('services/api/src/ai/ai.service.ts')
const interview = read('services/api/src/mock-interview/mock-interview.service.ts')

assert(memberAuth.includes('const CODE_TTL = 300'), '短信验证码 TTL 代码为 300 秒')
assert(memberAuth.includes('const SESSION_TTL = 1800'), '会员会话 TTL 代码为 1800 秒')
assert(doc.includes('短信验证码') && doc.includes('5 分钟'), '文档声明短信验证码 5 分钟')
assert(doc.includes('会员会话') && doc.includes('30 分钟'), '文档声明会员会话 30 分钟')

assert(activity.includes("process.env['ACTIVITY_LOG_TTL_DAYS'] ?? '30'"), '浏览/跳转记录默认 TTL 代码为 30 天')
assert(doc.includes('浏览记录') && doc.includes('30 天'), '文档声明浏览记录 30 天')
assert(doc.includes('外部跳转记录') && doc.includes('30 天'), '文档声明外部跳转记录 30 天')

assert(files.includes('normal: 24') && files.includes('sensitive: 6') && files.includes('highly_sensitive: 1'), '文件对象默认 TTL 代码覆盖 24h/6h/1h')
assert(storage.includes('const MAX_SIGN_TTL_SECONDS = 30 * 60'), '签名 URL 代码硬上限为 30 分钟')
assert(doc.includes('签名 URL') && doc.includes('30 分钟'), '文档声明签名 URL 不超过 30 分钟')
assert(doc.includes('高敏文件') && doc.includes('1 小时'), '文档声明高敏文件默认 1 小时')

assert(ai.includes('AI_RESUME_RESULT_TTL_HOURS') && ai.includes('raw : 24'), 'AI 简历结果默认 TTL 代码为 24 小时')
assert(doc.includes('AI 简历结果') && doc.includes('24 小时'), '文档声明 AI 简历结果默认 24 小时')

assert(interview.includes('const MEMBER_TTL_MS = 7 * 24 * 60 * 60 * 1000'), '会员模拟面试记录 TTL 代码为 7 天')
assert(doc.includes('模拟面试') && doc.includes('7 天'), '文档声明会员模拟面试记录 7 天')

assert(doc.includes('本人可删除') && doc.includes('不记录投递结果'), '文档声明本人删除能力和招聘合规边界')

console.log('\nALL PASS')
