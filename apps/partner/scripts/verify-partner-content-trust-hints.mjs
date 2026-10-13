/**
 * 机构没被标成「内容可信」时，后台要照实说清楚（P11、P06）。
 *
 * 1. 两个后台的错误文案表都有 ORG_CONTENT_TRUST_REQUIRED。
 *    用带英文接口路径的中文原文去查时，返回表里那句，不含 PATCH、/api/v1、contentTrustStatus。
 *    表里没有的错误码加带中文的原文，仍原样返回（查表顺序：先按码，查不到才看原文）。
 * 2. 渠道区块只在不可发布时含那句提示；资料页把 publishable 传进去。
 * 3. 政策页合规提示末尾有「现场没有工作人员」那句，前半句已改成「此类内容本机构审核时请不予通过」（政策由机构自审）。
 *
 * Run: pnpm --filter @ai-job-print/partner verify:partner-content-trust-hints
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import ts from 'typescript'
import vm from 'node:vm'

const partnerRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = join(partnerRoot, '..', '..')

const PARTNER_ERRORS = 'apps/partner/src/services/api/userErrorMessage.ts'
const ADMIN_ERRORS = 'apps/admin/src/services/api/userErrorMessage.ts'
const PROFILE = 'apps/partner/src/routes/profile/index.tsx'
const CHANNELS = 'apps/partner/src/routes/profile/OfficialChannelsSection.tsx'
const POLICY = 'apps/partner/src/routes/policy/index.tsx'

const PARTNER_COPY = '本机构还没有通过平台的内容可信核验，暂时不能发布。请联系平台运营完成核验后再发布。'
const ADMIN_COPY = '该机构还没有被标记为内容可信，不能发布。请先在「合作机构」里完成内容可信核验。'
const CHANNEL_HINT = '本机构还没有通过平台的内容可信核验，下面的渠道暂时不会在一体机上显示。'
const CHANNEL_HINT_ARCHIVED = '本机构已归档，下面的渠道暂时不会在一体机上显示。'
const POLICY_SENTENCE = '一体机现场没有工作人员,正文里请不要写"找现场工作人员""叫工作人员看机器"这类话;需要到线下办理的,请写清本机构的办理地址、时间或电话。'
const POLICY_FIRST_HALF = '此类内容本机构审核时请不予通过。'
const BACKEND_RAW = '来源机构「演示机构」(org-demo) 未通过内容信任核验：当前 contentTrustStatus=pending，发布要求 active 且未归档。请先完成来源授权核验，再由管理员 PATCH /api/v1/admin/orgs/:id/content-trust 把该机构标成内容可信，然后重试发布。'
const UNLISTED_RAW = '这个错误码没有登记，这句中文应原样返回。'

function read(rel) {
  return readFileSync(join(repoRoot, rel), 'utf8')
}

function loadUserMessage(rel) {
  const source = read(rel)
  const out = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: rel,
  })
  const module = { exports: {} }
  vm.runInNewContext(out.outputText, {
    module,
    exports: module.exports,
    require(specifier) {
      throw new Error(`${rel} 不应再依赖 ${specifier}`)
    },
  }, { filename: rel })
  assert.equal(typeof module.exports.userMessageOf, 'function', `${rel} 要导出 userMessageOf`)
  return module.exports.userMessageOf
}

function httpError(code, message, status = 400) {
  const error = new Error(message)
  error.name = 'ApiHttpError'
  return Object.assign(error, { code, status })
}

function hidesBackendPath(shown, who) {
  assert.equal(shown.includes('PATCH'), false, `${who} 不应再出现 PATCH`)
  assert.equal(shown.includes('/api/v1'), false, `${who} 不应再出现 /api/v1`)
  assert.equal(shown.includes('contentTrustStatus'), false, `${who} 不应再出现 contentTrustStatus`)
}

const partnerOf = loadUserMessage(PARTNER_ERRORS)
const adminOf = loadUserMessage(ADMIN_ERRORS)

assert.ok(read(PARTNER_ERRORS).includes(`ORG_CONTENT_TRUST_REQUIRED: '${PARTNER_COPY}'`), '机构后台码表缺少 ORG_CONTENT_TRUST_REQUIRED')
assert.ok(read(ADMIN_ERRORS).includes(`ORG_CONTENT_TRUST_REQUIRED: '${ADMIN_COPY}'`), '管理员后台码表缺少 ORG_CONTENT_TRUST_REQUIRED')

const partnerShown = partnerOf(httpError('ORG_CONTENT_TRUST_REQUIRED', BACKEND_RAW), '发布失败，请稍后重试')
const adminShown = adminOf(httpError('ORG_CONTENT_TRUST_REQUIRED', BACKEND_RAW), '发布失败，请稍后重试')
assert.equal(partnerShown, PARTNER_COPY, '机构后台应返回码表那句，而不是后端原文')
assert.equal(adminShown, ADMIN_COPY, '管理员后台应返回码表那句，而不是后端原文')
hidesBackendPath(partnerShown, '机构后台')
hidesBackendPath(adminShown, '管理员后台')

assert.equal(
  partnerOf(httpError('NOT_IN_EITHER_TABLE', UNLISTED_RAW), '兜底句'),
  UNLISTED_RAW,
  '机构后台：表里没有的码，带中文的原文仍原样返回',
)
assert.equal(
  adminOf(httpError('NOT_IN_EITHER_TABLE', UNLISTED_RAW), '兜底句'),
  UNLISTED_RAW,
  '管理员后台：表里没有的码，带中文的原文仍原样返回',
)
console.log('PASS 1 两个后台的 ORG_CONTENT_TRUST_REQUIRED 盖住带接口路径的原文，未登记码仍原样返回')

const profile = read(PROFILE)
const channels = read(CHANNELS)
const call = profile.match(/<OfficialChannelsSection\b[^>]*>/)
assert.ok(call, '资料页要渲染官方渠道区块')
assert.match(call[0], /publishable=\{publishable\}/, '资料页要把已算好的 publishable 传给渠道区块')
assert.match(call[0], /archived=\{archived\}/, '资料页要把归档状态传给渠道区块（归档和没核验是两种原因，分开说）')
assert.equal(channels.split(CHANNEL_HINT).length - 1, 1, '渠道提示句应只出现一次')
assert.equal(channels.split(CHANNEL_HINT_ARCHIVED).length - 1, 1, '归档提示句应只出现一次')
assert.ok(!channels.includes('自动恢复显示'), '不承诺「核验通过后自动恢复显示」：渠道自己的启用、域名、紧急下架也会让它不显示')
const gated = channels.match(/\{!publishable && \([\s\S]*?\)\}/)
assert.ok(gated, '渠道提示必须包在 !publishable 条件里')
assert.ok(/archived \? CHANNEL_HINT_ARCHIVED : CHANNEL_HINT_UNTRUSTED/.test(gated[0]), '不可发布时按是否归档分开说原因')
const expr = gated[0].match(/^\{(!publishable) && \(/)
assert.ok(expr, '渠道提示的条件必须是 !publishable')
const show = new Function('publishable', `return (${expr[1]})`)
assert.equal(show(false), true, '不可发布时要显示渠道提示')
assert.equal(show(true), false, '可发布时不含渠道提示')
assert.ok(channels.includes('并且要本机构通过平台内容可信核验后才会显示'), '区块说明要照实写：通过内容可信核验后才在一体机上显示')
assert.ok(channels.includes('本机构通过平台内容可信核验后，二维码会出现在本机构自己的一体机上'), '空列表那句不能无条件承诺会出现在一体机上')
assert.ok(!channels.includes('「添加渠道」，二维码会出现在本机构自己的一体机上'), '旧的无条件说法应已改掉')
console.log('PASS 2 渠道区块只在不可发布时显示提示，且接了 publishable；说明和空列表照实写了核验前提')

const policy = read(POLICY)
assert.ok(policy.includes(POLICY_SENTENCE), '政策页合规提示末尾缺少「现场没有工作人员」那句')
assert.ok(!policy.includes('此类内容审核将不予通过'), '旧说法「此类内容审核将不予通过」读着像平台在审，应已改掉')
assert.ok(policy.includes(`${POLICY_FIRST_HALF}${POLICY_SENTENCE}`), '「此类内容本机构审核时请不予通过」（产品负责人 10/13 17:05 点头，合规十原文）必须在新句前面')
console.log('PASS 3 政策页合规提示含新句，前半句已改成「本机构审核时请不予通过」')

console.log('verify:partner-content-trust-hints passed')
