import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const workflowPath = join(repoRoot, '.github/workflows/ci.yml')
const workflowLines = new Set(
  readFileSync(workflowPath, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^run:\s*/, ''))
)

const requiredCommands = [
  'node scripts/verify-deploy-authorization-gate.mjs',
  'pnpm --filter @ai-job-print/miniapp verify:static',
  'pnpm run verify:task-runner-wake',
  'pnpm --filter @ai-job-print/kiosk verify:service-entry-readiness',
  // 扫码输入安全（FIX-SCAN-SAFETY）：付款码不落屏 + 非授权页吞掉 HID 突发。
  // 钉进这里是因为本文件只做「不许被悄悄摘掉」的钉子，不会自动发现新门禁。
  'pnpm --filter @ai-job-print/kiosk verify:scan-input-safety',
  'pnpm --filter @ai-job-print/admin verify:refresh-safe',
  'pnpm --filter @ai-job-print/admin verify:admin-job-materials-ui',
  'pnpm --filter @ai-job-print/admin verify:toolbox-review-ui',
  'pnpm --filter @ai-job-print/admin verify:admin-terminal-bind-code-ui',
  'pnpm --filter @ai-job-print/admin verify:admin-account-settings-ui',
  'pnpm --filter @ai-job-print/partner verify:partner-refresh-safe',
  'pnpm --filter @ai-job-print/api verify:terminal-status-idempotency',
  // 硬件真实性门禁：这两条自身也会检查「我在不在 ci.yml 里」，但那个自查
  // 只在它们被 CI 执行时才跑 —— 一旦有人删掉 CI 里那行，自查就跟着消失。
  // 在这里登记以打破该循环：本门禁在 Repository integrity gate 步骤中执行。
  'pnpm --filter @ai-job-print/kiosk verify:mic-capability-truth',
  'pnpm run verify:image-scale-truth',
]

const missing = requiredCommands.filter((command) => !workflowLines.has(command))
if (missing.length > 0) {
  console.error('ERROR: required deterministic CI gates are not directly executed:')
  for (const command of missing) console.error(`  ${command}`)
  process.exit(1)
}

console.log(`OK: ${requiredCommands.length} deterministic CI gates are directly executed`)
