import 'reflect-metadata'
import assert from 'node:assert/strict'
import { MODULE_METADATA } from '@nestjs/common/constants'
import { PoliciesModule } from '../src/policies/policies.module'
import { CommunityModule } from '../src/community/community.module'
import { MemberFavoritesModule } from '../src/member-favorites/member-favorites.module'
import { ActivityModule } from '../src/activity/activity.module'
import { PolicyScopeService, resolvePolicyScope } from '../src/policies/policy-scope.service'
import { publicPolicyWhere, policyScopeMode } from '../src/policies/policy-public-visibility'
import { communityFeedCacheKey } from '../src/community/community.service'

async function main() {
const held = [] as string[]
const a = publicPolicyWhere({ id: 'policy-a' }, held, { mode: 'org', orgId: 'org-a', state: 'bound' })
const b = publicPolicyWhere({ id: 'policy-a' }, held, { mode: 'org', orgId: 'org-b', state: 'bound' })
assert.match(JSON.stringify(a), /org-a/)
assert.doesNotMatch(JSON.stringify(a), /org-b/)
assert.match(JSON.stringify(b), /org-b/)
const unbound = publicPolicyWhere({ id: 'policy-a' }, held, { mode: 'org', orgId: null, state: 'unbound' })
assert.match(JSON.stringify(unbound), /no_public_terminal/)
const fakeTerminalSessions = { validate: async (terminalId: string, token: string) => {
  if (!((terminalId === 'terminal-a' && token === 'valid-a') || (terminalId === 'terminal-b' && token === 'valid-b'))) throw new Error('invalid')
} }
const fakePrisma = { terminal: { findUnique: async ({ where }: { where: { id: string } }) => ({ orgId: where.id === 'terminal-a' ? 'org-a' : null }) } }
process.env['POLICY_SCOPE'] = 'org'
const resolver = new PolicyScopeService(fakeTerminalSessions as never, fakePrisma as never)
assert.deepEqual(await resolver.resolve({ headers: { 'x-terminal-id': 'terminal-a', 'x-terminal-session-token': 'valid-a' } }), { mode: 'org', orgId: 'org-a', state: 'bound' })
assert.deepEqual(await resolver.resolve({ headers: { 'x-terminal-id': 'terminal-b', 'x-terminal-session-token': 'valid-b' } }), { mode: 'org', orgId: null, state: 'unbound' })
assert.deepEqual(await resolver.resolve({ headers: {} }), { mode: 'org', orgId: null, state: 'missing' })
assert.deepEqual(await resolver.resolve({ headers: { 'x-terminal-id': 'terminal-a', 'x-terminal-session-token': 'forged' } }), { mode: 'org', orgId: null, state: 'missing' }, '终端会话令牌验不过要判缺失，不能按终端编号直接取机构')
// 四个控制器上 PolicyScopeService 是可选注入（方便门禁手动构造）；生产装配必须真的提供它，
// 否则 POLICY_SCOPE=org 会被悄悄当成 all。读 Nest 模块元数据核对，不搜源码字符串。
for (const [label, mod] of [['PoliciesModule', PoliciesModule], ['CommunityModule', CommunityModule], ['MemberFavoritesModule', MemberFavoritesModule], ['ActivityModule', ActivityModule]] as const) {
  const providers = (Reflect.getMetadata(MODULE_METADATA.PROVIDERS, mod) ?? []) as unknown[]
  assert.ok(providers.includes(PolicyScopeService), `${label} 必须提供 PolicyScopeService`)
}
assert.notEqual(
  communityFeedCacheKey('closed', { mode: 'org', orgId: 'org-a', state: 'bound' }, undefined, 20),
  communityFeedCacheKey('closed', { mode: 'org', orgId: 'org-b', state: 'bound' }, undefined, 20),
)
delete process.env['POLICY_SCOPE']
assert.equal(policyScopeMode(), 'all', 'POLICY_SCOPE 缺省必须是 all（今天的行为）')
assert.equal(JSON.stringify(publicPolicyWhere({ id: 'policy-a' }, held)), JSON.stringify(publicPolicyWhere({ id: 'policy-a' }, held, { mode: 'all' })), '缺省范围的查询条件与 all 一致')
assert.doesNotMatch(JSON.stringify(publicPolicyWhere({ id: 'policy-a' }, held)), /sourceOrgId/, '缺省范围不加机构过滤')
assert.deepEqual(await resolvePolicyScope(undefined, { headers: {} }), { mode: 'all' }, '控制器没拿到服务时按 all')
process.env['POLICY_SCOPE'] = 'all'
assert.equal(policyScopeMode(), 'all')
process.env['POLICY_SCOPE'] = 'org'
assert.equal(policyScopeMode(), 'org')
delete process.env['POLICY_SCOPE']
console.log('verify:policy-scope passed (A/B isolation, unbound empty, all default)')
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
