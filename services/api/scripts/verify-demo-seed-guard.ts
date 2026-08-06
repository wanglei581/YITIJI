import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { assertDemoSeedAllowed, DEMO_SEED_CONFIRMATION } from '../prisma/seed-guard'

type GuardEnv = Parameters<typeof assertDemoSeedAllowed>[0]

let failures = 0

function pass(message: string): void {
  console.log(`  PASS ${message}`)
}

function fail(message: string): void {
  console.error(`  FAIL ${message}`)
  failures++
}

function expectAllowed(env: GuardEnv, label: string): void {
  try {
    assertDemoSeedAllowed(env)
    pass(label)
  } catch (error) {
    fail(`${label}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function expectRejected(env: GuardEnv, code: string, label: string): void {
  try {
    assertDemoSeedAllowed(env)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes(code)) pass(label)
    else fail(`${label}: expected ${code}, received ${message}`)
    return
  }
  fail(`${label}: expected rejection`)
}

function verifySeedCallsGuardBeforeClient(filename: string, clientPattern: RegExp): void {
  const source = readFileSync(resolve(__dirname, '..', 'prisma', filename), 'utf8')
  const callIndex = source.search(/^assertDemoSeedAllowed\(process\.env\)$/m)
  const clientIndex = source.search(clientPattern)

  if (callIndex >= 0 && clientIndex >= 0 && callIndex < clientIndex) {
    pass(`${filename} 在 Prisma client 初始化前执行门禁`)
    return
  }
  fail(`${filename} 必须在 Prisma client 初始化前调用 assertDemoSeedAllowed(process.env)`)
}

function main(): void {
  console.log('\n=== demo seed fail-closed guard verification ===')

  expectAllowed(
    { NODE_ENV: 'development', DEMO_SEED_CONFIRM: DEMO_SEED_CONFIRMATION },
    'development + 精确确认短语放行'
  )
  expectAllowed(
    { NODE_ENV: 'test', DEMO_SEED_CONFIRM: DEMO_SEED_CONFIRMATION },
    'test + 精确确认短语放行'
  )

  for (const nodeEnv of ['production', 'staging', 'preview', undefined] as const) {
    expectRejected(
      { NODE_ENV: nodeEnv, DEMO_SEED_CONFIRM: DEMO_SEED_CONFIRMATION },
      'DEMO_SEED_ENV_FORBIDDEN',
      `${nodeEnv ?? '未设置 NODE_ENV'} 即使确认也拒绝`
    )
  }

  for (const confirmation of [
    undefined,
    '',
    'true',
    'i_understand_demo_data_will_be_written',
    ` ${DEMO_SEED_CONFIRMATION}`,
  ] as const) {
    expectRejected(
      { NODE_ENV: 'development', DEMO_SEED_CONFIRM: confirmation },
      'DEMO_SEED_CONFIRMATION_REQUIRED',
      `development 拒绝非精确确认值 ${JSON.stringify(confirmation)}`
    )
  }

  verifySeedCallsGuardBeforeClient('seed.ts', /^const prisma = createPrismaClient\(url\)\.client$/m)
  verifySeedCallsGuardBeforeClient(
    'seed-fairs.ts',
    /^const prisma = createPrismaClient\(url\)\.client$/m
  )
  verifySeedCallsGuardBeforeClient('seed-companies.ts', /^ {2}const prisma = new PrismaService\(\)$/m)
  verifySeedCallsGuardBeforeClient(
    'seed-venue-guide.ts',
    /^const prisma = createPrismaClient\(url\)\.client$/m
  )

  if (failures > 0) {
    throw new Error(`demo seed guard verification failed: ${failures} assertion(s)`)
  }
  console.log('\nALL PASS')
}

main()
