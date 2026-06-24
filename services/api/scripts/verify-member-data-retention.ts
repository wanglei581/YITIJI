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
const roleBoundary = read('docs/product/role-boundary.md')
const dataFlowMatrix = read('docs/product/user-data-flow-matrix.md')
const resumeAssetsReview = read('docs/reviews/ai-resume-assets-closure-planning.md')
const memberAuth = read('services/api/src/member-auth/member-auth.service.ts')
const activity = read('services/api/src/activity/activity.service.ts')
const files = read('services/api/src/files/file.types.ts')
const retentionPolicy = read('services/api/src/files/retention-policy.ts')
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
assert(retentionPolicy.includes("'months_3'") && retentionPolicy.includes('90 * DAY_MS'), '会员文件保存策略代码覆盖 90 天')
assert(retentionPolicy.includes("'months_6'") && retentionPolicy.includes('180 * DAY_MS'), '会员文件保存策略代码覆盖 180 天')
assert(retentionPolicy.includes("'long_term'") && retentionPolicy.includes('return null'), '会员长期保存代码使用 expiresAt=null')
assert(retentionPolicy.includes("return ['months_3', 'months_6']"), '原始会员文件代码侧仅允许 90 天 / 180 天')
assert(storage.includes('const MAX_SIGN_TTL_SECONDS = 30 * 60'), '签名 URL 代码硬上限为 30 分钟')
assert(doc.includes('签名 URL') && doc.includes('30 分钟'), '文档声明签名 URL 不超过 30 分钟')
assert(doc.includes('登录会员原始简历') && doc.includes('90 天'), '文档声明登录会员原始简历默认 90 天')
assert(doc.includes('180 天') && doc.includes('长期保存'), '文档声明会员延长保存至 180 天 / 长期保存边界')
assert(doc.includes('未登录') && doc.includes('高敏文件') && doc.includes('1 小时'), '文档声明未登录/高敏/system_short 文件短期保存')
assert(!doc.includes('我的简历 / 文档文件 | 私有对象存储 + `FileObject` | normal 24 小时、sensitive 6 小时、高敏文件 1 小时'), '文档不得把会员简历统一写成 24h/6h/1h')
assert(!roleBoundary.includes('简历自动 1h 清理') && !roleBoundary.includes('1 小时自动删除'), '角色边界不得保留会员简历 1h 旧口径')
assert(roleBoundary.includes('登录会员简历') && roleBoundary.includes('90 天') && roleBoundary.includes('180 天'), '角色边界声明会员简历保存期限口径')
assert(!dataFlowMatrix.includes('`resume_upload` 1h TTL'), '用户数据流矩阵不得保留 resume_upload 1h 旧口径')
assert(dataFlowMatrix.includes('登录会员默认 90 天') && dataFlowMatrix.includes('优化后成果物可按规则长期保存'), '用户数据流矩阵声明当前文件保存期限策略')
assert(!resumeAssetsReview.includes('`resume_upload` 1h TTL'), '当前 AI 简历资产审查文档不得保留 resume_upload 1h 旧口径')
assert(resumeAssetsReview.includes('默认保存 90 天') && resumeAssetsReview.includes('延长至 180 天'), '当前 AI 简历资产审查文档声明会员文件保存期限策略')

assert(ai.includes('AI_RESUME_RESULT_TTL_HOURS') && ai.includes('raw : 24'), 'AI 简历结果默认 TTL 代码为 24 小时')
assert(doc.includes('AI 简历结果') && doc.includes('24 小时'), '文档声明 AI 简历结果默认 24 小时')

assert(interview.includes('const MEMBER_TTL_MS = 7 * 24 * 60 * 60 * 1000'), '会员模拟面试记录 TTL 代码为 7 天')
assert(doc.includes('模拟面试') && doc.includes('7 天'), '文档声明会员模拟面试记录 7 天')

assert(doc.includes('本人可删除') && doc.includes('不记录投递结果'), '文档声明本人删除能力和招聘合规边界')

console.log('\nALL PASS')
