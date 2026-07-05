/**
 * Print rollout safety static guard.
 *
 * This script reads source files as text only. It must not connect to DB,
 * import runtime services, or mutate state.
 *
 * Run: pnpm --filter @ai-job-print/api verify:print-rollout-config
 */
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const apiRoot = resolve(__dirname, '..')
const repoRoot = resolve(apiRoot, '../..')

let failures = 0

function pass(message: string): void {
  console.log(`  PASS ${message}`)
}

function fail(message: string): void {
  failures += 1
  console.error(`  FAIL ${message}`)
}

function check(condition: unknown, passMessage: string, failMessage = passMessage): void {
  if (condition) pass(passMessage)
  else fail(failMessage)
}

function readSource(label: string, absolutePath: string): string {
  try {
    return readFileSync(absolutePath, 'utf8')
  } catch (error) {
    fail(`${label}: 无法读取 ${absolutePath} (${(error as Error).message})`)
    return ''
  }
}

function section(source: string, start: string, end: string, label: string): string {
  const startIndex = source.indexOf(start)
  if (startIndex < 0) {
    fail(`${label}: 无法定位起点 ${start}`)
    return ''
  }
  const endIndex = source.indexOf(end, startIndex + start.length)
  if (endIndex < 0) {
    fail(`${label}: 无法定位终点 ${end}`)
    return ''
  }
  return source.slice(startIndex, endIndex)
}

function main(): void {
  console.log('\n=== Print rollout safety static guard ===')

  const terminals = readSource(
    'TerminalsService',
    join(apiRoot, 'src/terminals/terminals.service.ts'),
  )
  const paymentProviderFactory = readSource(
    'PaymentProviderFactory',
    join(apiRoot, 'src/payment/payment-provider.factory.ts'),
  )
  const productionRuntimeGates = readSource(
    'ProductionRuntimeGates',
    join(apiRoot, 'src/config/production-runtime-gates.ts'),
  )
  const kioskCashier = readSource(
    'PrintCashierPage',
    join(repoRoot, 'apps/kiosk/src/pages/print/PrintCashierPage.tsx'),
  )

  check(
    /(?:process\.env\[['"]PRINT_REQUIRE_PAID_BEFORE_CLAIM['"]\]|process\.env\.PRINT_REQUIRE_PAID_BEFORE_CLAIM)\s*===\s*['"]true['"]/.test(terminals),
    'PRINT_REQUIRE_PAID_BEFORE_CLAIM uses strict explicit true opt-in',
    'PRINT_REQUIRE_PAID_BEFORE_CLAIM must be checked with === "true"',
  )

  const claimGate = section(
    terminals,
    'const paidGate = requirePaidBeforeClaim()',
    'return results',
    'TerminalsService claim gate query',
  )
  check(
    /payStatus\s*:\s*['"]paid['"]/.test(claimGate),
    'claim gate keeps payStatus=paid requirement',
    'claim gate must include payStatus: "paid"',
  )
  check(
    /order\s*:\s*(?:null|\{\s*is\s*:\s*null\s*\})/.test(claimGate),
    'claim gate keeps null-order legacy/seed allowance',
    'claim gate must include order:null or Prisma order:{is:null} allowance',
  )
  check(
    /findFirst\s*\(\s*\{[\s\S]{0,800}where\s*:\s*claimableWhere/.test(claimGate),
    'claim query uses claimableWhere for task selection',
    'claim query must pass claimableWhere into printTask.findFirst()',
  )

  const sandboxProviderBranch = section(
    paymentProviderFactory,
    "raw === 'sandbox'",
    'return new SandboxPaymentProvider',
    'PaymentProviderFactory sandbox branch',
  )
  check(
    /NODE_ENV/.test(sandboxProviderBranch)
      && /production/.test(sandboxProviderBranch)
      && /throw new Error/.test(sandboxProviderBranch)
      && /PAYMENT_PROVIDER_SANDBOX_FORBIDDEN/.test(sandboxProviderBranch),
    'payment provider factory rejects sandbox when NODE_ENV=production',
    'payment provider factory must throw for sandbox payment in production',
  )

  check(
    /nodeEnv\s*!==\s*['"]production['"]\)\s*return/.test(productionRuntimeGates)
      && /PAYMENT_PROVIDER/.test(productionRuntimeGates)
      && /paymentProvider\s*===\s*['"]sandbox['"]/.test(productionRuntimeGates)
      && /PRODUCTION_PAYMENT_PROVIDER_SANDBOX_FORBIDDEN/.test(productionRuntimeGates)
      && /throw new Error/.test(productionRuntimeGates),
    'production runtime gates reject PAYMENT_PROVIDER=sandbox in production',
    'production runtime gates must reject PAYMENT_PROVIDER=sandbox under NODE_ENV=production',
  )

  check(
    kioskCashier.includes('simulateSandboxPayment'),
    'Kiosk cashier still imports/calls simulateSandboxPayment',
    'PrintCashierPage must retain simulateSandboxPayment source reference',
  )
  check(
    /import\.meta\.env\.DEV[\s\S]{0,1200}devSimulate\(/.test(kioskCashier),
    'Kiosk sandbox simulate action remains import.meta.env.DEV gated',
    'PrintCashierPage must gate sandbox simulate controls behind import.meta.env.DEV',
  )

  if (failures > 0) {
    console.error(`\nFAIL verify-print-rollout-config (${failures} failed checks)`)
    process.exit(1)
  }

  console.log('\nALL PASS verify-print-rollout-config')
}

main()
