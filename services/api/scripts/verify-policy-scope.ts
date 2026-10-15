import assert from 'node:assert/strict'
import { PolicyScopeService } from '../src/policies/policy-scope.service'
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
assert.notEqual(
  communityFeedCacheKey('closed', { mode: 'org', orgId: 'org-a', state: 'bound' }, undefined, 20),
  communityFeedCacheKey('closed', { mode: 'org', orgId: 'org-b', state: 'bound' }, undefined, 20),
)
process.env['POLICY_SCOPE'] = 'all'
assert.equal(policyScopeMode(), 'all')
process.env['POLICY_SCOPE'] = 'org'
assert.equal(policyScopeMode(), 'org')
delete process.env['POLICY_SCOPE']
console.log('verify:policy-scope passed (A/B isolation, unbound empty, all default)')
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
