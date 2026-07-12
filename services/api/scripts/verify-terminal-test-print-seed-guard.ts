/**
 * 终端测试打印任务 seed 启动门禁验证。
 *
 * 直接调用真实 TerminalsService.onModuleInit()，以最小 Prisma stub 记录
 * printTask.upsert，确保测试打印任务仅由本地开发者显式开启。
 *
 * 运行：pnpm --filter @ai-job-print/api verify:terminal-test-print-seed-guard
 */
import 'dotenv/config'
import type { PrismaService } from '../src/prisma/prisma.service'

const TEST_ENV_KEYS = ['NODE_ENV', 'ENABLE_TEST_PRINT_TASK_SEED'] as const
const BOOTSTRAP_ENV_KEYS = ['TERMINAL_ADMIN_SECRET', 'TERMINAL_ACTION_TOKEN_SECRET'] as const

type TestEnvKey = (typeof TEST_ENV_KEYS)[number]
type BootstrapEnvKey = (typeof BOOTSTRAP_ENV_KEYS)[number]
type EnvSnapshot<Key extends string> = Map<Key, string | undefined>
type SeedUpsertInput = {
  where?: { id?: string }
  update?: { status?: string }
  create?: { id?: string; status?: string }
}

let failures = 0

function pass(message: string): void {
  console.log(`  PASS ${message}`)
}

function fail(message: string): void {
  console.error(`  FAIL ${message}`)
  failures++
}

function snapshotEnv<Key extends string>(keys: readonly Key[]): EnvSnapshot<Key> {
  return new Map(keys.map((key) => [key, process.env[key]]))
}

function restoreEnv<Key extends string>(snapshot: EnvSnapshot<Key>): void {
  for (const [key, value] of snapshot) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}

async function withEnv(
  values: Partial<Record<TestEnvKey, string>>,
  run: () => Promise<void>,
): Promise<void> {
  const before = snapshotEnv(TEST_ENV_KEYS)
  try {
    for (const key of TEST_ENV_KEYS) {
      const value = values[key]
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    await run()
  } finally {
    restoreEnv(before)
  }
}

function assertEqual(actual: unknown, expected: unknown, label: string): void {
  if (actual === expected) pass(label)
  else fail(`${label} — expected ${String(expected)}, received ${String(actual)}`)
}

async function main(): Promise<void> {
  const bootstrapBefore = snapshotEnv(BOOTSTRAP_ENV_KEYS)
  process.env['TERMINAL_ADMIN_SECRET'] ||= 'verify-terminal-seed-admin-secret-0123456789'
  process.env['TERMINAL_ACTION_TOKEN_SECRET'] ||= 'verify-terminal-seed-action-secret-0123456789'

  try {
    // 这两个常量在模块加载期读取；先补齐只供本 verify 使用的安全占位值。
    const { TerminalsService } = await import('../src/terminals/terminals.service')

    async function seedCallCount(env: Partial<Record<TestEnvKey, string>>): Promise<{
      upserts: SeedUpsertInput[]
    }> {
      const upserts: SeedUpsertInput[] = []
      await withEnv(env, async () => {
        const prisma = {
          printTask: {
            upsert: async (input: SeedUpsertInput) => {
              upserts.push(input)
              return input
            },
          },
        } as unknown as PrismaService

        await new TerminalsService(prisma, null as never, null as never).onModuleInit()
      })
      return { upserts }
    }

    console.log('\n=== terminal test-print seed guard verification ===')

    const cases: Array<{
      label: string
      env: Partial<Record<TestEnvKey, string>>
      expectedUpserts: number
    }> = [
      {
        label: 'staging + true 不创建测试打印任务',
        env: { NODE_ENV: 'staging', ENABLE_TEST_PRINT_TASK_SEED: 'true' },
        expectedUpserts: 0,
      },
      {
        label: 'production + true 不创建测试打印任务',
        env: { NODE_ENV: 'production', ENABLE_TEST_PRINT_TASK_SEED: 'true' },
        expectedUpserts: 0,
      },
      {
        label: 'development + 缺失开关不创建测试打印任务',
        env: { NODE_ENV: 'development' },
        expectedUpserts: 0,
      },
      {
        label: 'development + false 不创建测试打印任务',
        env: { NODE_ENV: 'development', ENABLE_TEST_PRINT_TASK_SEED: 'false' },
        expectedUpserts: 0,
      },
      {
        label: 'development + true 仅创建一次测试打印任务',
        env: { NODE_ENV: 'development', ENABLE_TEST_PRINT_TASK_SEED: 'true' },
        expectedUpserts: 1,
      },
    ]

    let developmentEnabledUpsert: SeedUpsertInput | undefined
    for (const testCase of cases) {
      const { upserts } = await seedCallCount(testCase.env)
      assertEqual(upserts.length, testCase.expectedUpserts, testCase.label)
      if (testCase.expectedUpserts === 1) developmentEnabledUpsert = upserts[0]
    }

    assertEqual(
      developmentEnabledUpsert?.where?.id,
      'ptask_seed_001',
      'development + true 保留 ptask_seed_001 的 seed 标识',
    )
    assertEqual(
      developmentEnabledUpsert?.update?.status,
      'pending',
      'development + true 保留 update 的 pending 状态',
    )
    assertEqual(
      developmentEnabledUpsert?.create?.status,
      'pending',
      'development + true 保留 create 的 pending 状态',
    )
  } finally {
    restoreEnv(bootstrapBefore)
  }

  if (failures > 0) {
    throw new Error(`terminal test-print seed guard verification failed: ${failures} assertion(s)`)
  }

  console.log('\nALL PASS')
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
