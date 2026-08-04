import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { test } from 'node:test'
import { MODULE_METADATA } from '@nestjs/common/constants'
import { ContractReviewProcessor } from '../contract-review.processor'
import { ContractReviewProviderService } from '../contract-review-provider.service'

function metadata<T>(key: string, target: object): readonly T[] {
  return (Reflect.getMetadata(key, target) as readonly T[] | undefined) ?? []
}

async function loadContractModule() {
  process.env['TERMINAL_ADMIN_SECRET'] = 'test-terminal-admin-secret-1234567890'
  process.env['TERMINAL_ACTION_TOKEN_SECRET'] = 'test-terminal-action-secret-123456789'
  return import('../contract-review.module')
}

test('default contract module never registers BullMQ processor, controller, or real provider', async () => {
  const { ContractReviewModule } = await loadContractModule()
  const [
    { ContractReviewConsentService },
    { ContractReviewController },
    { ContractReviewHttpModule },
    { ContractReviewLifecycleService },
    { ContractReviewQueueService },
    { ContractReviewService },
    { ContractReviewTaskAccess },
  ] = await Promise.all([
    import('../contract-review-consent.service'),
    import('../contract-review.controller'),
    import('../contract-review-http.module'),
    import('../contract-review-lifecycle.service'),
    import('../contract-review.queue'),
    import('../contract-review.service'),
    import('../contract-review-task-access'),
  ])
  const providers = metadata<unknown>(MODULE_METADATA.PROVIDERS, ContractReviewModule)
  const controllers = metadata<unknown>(MODULE_METADATA.CONTROLLERS, ContractReviewModule)
  const imports = metadata<unknown>(MODULE_METADATA.IMPORTS, ContractReviewModule)

  assert.equal(providers.includes(ContractReviewProcessor), false)
  assert.equal(providers.includes(ContractReviewProviderService), false)
  assert.equal(providers.includes(ContractReviewLifecycleService), true)
  assert.equal(providers.includes(ContractReviewConsentService), true)
  assert.equal(providers.includes(ContractReviewTaskAccess), true)
  assert.equal(controllers.includes(ContractReviewController), false)
  assert.equal(controllers.length, 0)
  assert.equal(imports.includes(ContractReviewHttpModule), false)
  assert.equal(imports.some((value) => {
    if (!value || typeof value !== 'object') return false
    return (value as { module?: { name?: string } }).module?.name === 'BullModule'
  }), false)

  const exports = metadata<unknown>(MODULE_METADATA.EXPORTS, ContractReviewModule)
  assert.equal(exports.includes(ContractReviewLifecycleService), true)
  assert.equal(exports.includes(ContractReviewConsentService), true)
  assert.equal(exports.includes(ContractReviewQueueService), true)
  assert.equal(exports.includes(ContractReviewService), false)
})

test('blocked provider runtime never reads environment or performs a model request', async () => {
  const { CONTRACT_REVIEW_BLOCKED_PROVIDER_RUNTIME } = await loadContractModule()
  const before = { ...process.env }
  await assert.rejects(
    () => CONTRACT_REVIEW_BLOCKED_PROVIDER_RUNTIME.reviewWithIdentity({
      pages: [{ pageNumber: 1, text: '正文' }],
      partyFacts: {
        hasPartyA: false, hasPartyB: false, hasEmployer: false,
        hasWorker: false, hasUscc: false, hasBankAccount: false,
      },
    }),
    /CONTRACT_PROVIDER_NOT_APPROVED/,
  )
  assert.deepEqual({ ...process.env }, before)
})

test('AppModule source imports the same default-closed module for every env combination', async () => {
  const { ContractReviewModule } = await loadContractModule()
  const source = readFileSync(resolve(__dirname, '../../app.module.ts'), 'utf8')
  assert.match(source, /import \{ ContractReviewModule \} from '\.\/contract-review\/contract-review\.module'/u)
  assert.match(source, /\n\s+ContractReviewModule,\n/u)
  assert.doesNotMatch(source, /CONTRACT_REVIEW_ENABLED/u)
  for (const redis of [undefined, 'redis://localhost:6379']) {
    for (const enabled of [undefined, 'true', 'false']) {
      if (redis === undefined) delete process.env['REDIS_URL']; else process.env['REDIS_URL'] = redis
      if (enabled === undefined) delete process.env['CONTRACT_REVIEW_ENABLED']; else process.env['CONTRACT_REVIEW_ENABLED'] = enabled
      const providers = metadata<unknown>(MODULE_METADATA.PROVIDERS, ContractReviewModule)
      assert.equal(providers.includes(ContractReviewProcessor), false)
    }
  }
})
