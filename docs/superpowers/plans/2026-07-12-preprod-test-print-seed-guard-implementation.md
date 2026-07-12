# 预生产测试打印任务 Seed 守卫 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 使 API 只在本地开发环境明确启用时创建测试打印任务，确保预生产/生产重启不会把 `ptask_seed_001` 变成可领取任务。

**Architecture:** 保留既有 `seedPrintTask()` 的构造逻辑，只收紧它在 `onModuleInit()` 的调用入口。模块级纯谓词同时检查 `NODE_ENV === 'development'` 与 `ENABLE_TEST_PRINT_TASK_SEED === 'true'`；独立 verify 通过最小 Prisma stub 调用真实 `TerminalsService.onModuleInit()`，验证 seed 是否实际发生。CI 在 SQLite 与 PostgreSQL job 运行该 verify。

**Tech Stack:** NestJS、TypeScript、Prisma service stub、pnpm verify scripts、GitHub Actions。

---

## 文件范围

| 文件 | 责任 |
|---|---|
| `services/api/src/terminals/terminals.service.ts` | 收紧启动期测试任务 seed 入口，不改变 seed 内容或终端状态机。 |
| `services/api/scripts/verify-terminal-test-print-seed-guard.ts` | 以真实 service 生命周期验证不同环境下的 `PrintTask.upsert` 调用。 |
| `services/api/package.json` | 声明新的 verify 命令。 |
| `.github/workflows/ci.yml` | 在 SQLite 与 PostgreSQL verification job 执行新 verify。 |
| `services/api/.env.example` | 记录显式本地开发开关及 fail-closed 默认。 |
| `docs/progress/current-progress.md` | 只记录已合入/已部署的事实，禁止提前宣称。 |
| `docs/progress/next-tasks.md` | 将预生产重启 seed 风险列为部署后验收，不提前关闭。 |

不修改 Prisma schema/migration、HTTP 路由、支付/核销、打印领取/超时恢复、Terminal Agent 或任何前端。

### Task 1: 写出 seed 入口的 RED 验证

**Files:**

- Create: `services/api/scripts/verify-terminal-test-print-seed-guard.ts`
- Modify: `services/api/package.json`

- [ ] **Step 1: 新增会失败的真实生命周期 verify**

在 verify 中构造只实现 `printTask.upsert` 的 Prisma stub，并把每次调用参数压入 `upserts`。使用真实 `TerminalsService`：

```ts
import { TerminalsService } from '../src/terminals/terminals.service'
import type { PrismaService } from '../src/prisma/prisma.service'

const envKeys = ['NODE_ENV', 'ENABLE_TEST_PRINT_TASK_SEED'] as const

async function withEnv(
  values: Partial<Record<(typeof envKeys)[number], string>>,
  run: () => Promise<void>,
): Promise<void> {
  const before = new Map(envKeys.map((key) => [key, process.env[key]]))
  try {
    for (const key of envKeys) {
      const value = values[key]
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    await run()
  } finally {
    for (const key of envKeys) {
      const value = before.get(key)
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

async function seedCallCount(values: Parameters<typeof withEnv>[0]): Promise<number> {
  const upserts: unknown[] = []
  await withEnv(values, async () => {
    const prisma = {
      printTask: {
        upsert: async (input: unknown) => {
          upserts.push(input)
          return input
        },
      },
    } as unknown as PrismaService
    await new TerminalsService(prisma, null as never, null as never).onModuleInit()
  })
  return upserts.length
}
```

断言以下矩阵：staging/production（即使开关为 true）均为 0；development 中开关缺失或 false 为 0；仅 development + true 为 1，且 seed 输入仍包含 `id: 'ptask_seed_001'` 与 `status: 'pending'`。

- [ ] **Step 2: 注册命令并确认 RED**

在 API `package.json` 的 verify scripts 区新增：

```json
"verify:terminal-test-print-seed-guard": "node -r @swc-node/register scripts/verify-terminal-test-print-seed-guard.ts"
```

运行：

```bash
pnpm --filter @ai-job-print/api verify:terminal-test-print-seed-guard
```

预期：当前实现把 staging 视为 non-production，脚本应在“staging + true 不调用 seed”断言失败；这证明验证覆盖真实缺陷，而非只检查文本。

### Task 2: 最小实现双门禁

**Files:**

- Modify: `services/api/src/terminals/terminals.service.ts`
- Modify: `services/api/.env.example`

- [ ] **Step 1: 在 `onModuleInit()` 前定义 fail-closed 判断**

添加不导出、无副作用的模块级函数：

```ts
function shouldSeedTestPrintTask(env: NodeJS.ProcessEnv): boolean {
  return env['NODE_ENV'] === 'development' && env['ENABLE_TEST_PRINT_TASK_SEED'] === 'true'
}
```

将既有 `NODE_ENV !== 'production'` 判断替换为：

```ts
if (shouldSeedTestPrintTask(process.env)) {
  await this.seedPrintTask()
}
```

更新邻近注释，明确 staging/production 从不 seed；不得修改 `seedPrintTask()`、`resetExpiredClaims()`、领取查询或取消终态逻辑。

- [ ] **Step 2: 记录环境变量而不启用默认 seed**

在 `services/api/.env.example` 的 Terminal Agent 区增加：

```dotenv
# 仅本地开发测试打印链路使用；只有 NODE_ENV=development 且此值严格为 true 才会创建/重置 ptask_seed_001。
# staging / production 始终忽略此开关，默认不生成可领取测试打印任务。
ENABLE_TEST_PRINT_TASK_SEED=false
```

不得向预生产 `.env` 写入此变量，也不得把 `NODE_ENV` 改为 production 作为替代方案；后者会错误改变 staging 运行时门禁。

- [ ] **Step 3: 确认 GREEN**

运行：

```bash
pnpm --filter @ai-job-print/api verify:terminal-test-print-seed-guard
```

预期：五个环境 case 的断言全部通过。再次运行同一命令，确认环境变量恢复且结果稳定。

### Task 3: 接入 CI 并验证既有打印安全不回归

**Files:**

- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: 将新 verify 放入两个既有 verification job**

在 `build-and-verify` 的 API verify 列表中，紧邻既有 `verify:print-scan-first-release` 添加；在 `postgres-readiness` 的现有打印/扫描 verify 列表中紧邻 `verify:print-jobs` 添加：

```yaml
pnpm --filter @ai-job-print/api verify:terminal-test-print-seed-guard
```

不要新建 workflow、不要并行化现有会写临时数据库的 verify，也不要修改 CI 环境变量。

- [ ] **Step 2: 运行最小回归集**

运行：

```bash
pnpm --filter @ai-job-print/api verify:terminal-test-print-seed-guard
pnpm --filter @ai-job-print/api verify:legacy-pending-print-task-disposition
pnpm --filter @ai-job-print/api verify:print-scan-first-release
pnpm --filter @ai-job-print/api typecheck
pnpm --filter @ai-job-print/api lint
pnpm --filter @ai-job-print/api build
pnpm --filter @ai-job-print/api db:pg:sync:check
git diff --check
```

预期：新守卫、历史关闭幂等、取消终态保护、打印扫描门禁、API 编译/lint/build、PostgreSQL schema 同步全部通过；不产生 migration。

### Task 4: 复审、文档与交付边界

**Files:**

- Modify: `docs/progress/current-progress.md`
- Modify: `docs/progress/next-tasks.md`

- [ ] **Step 1: 先审查未提交 diff**

核对仅有 Task 1–3 声明的文件，检查：

- staging 与 production 都无法通过环境变量误配调用 seed；
- development 需要双门禁；
- 未新增 HTTP 接口、数据库写路径或硬件命令；
- 现有 seed 内容与终端状态机未改。

按项目规则调用 Claude 与前端模型对 diff 做独立审查。任何 Critical 必须修复并重新运行相关验证。

- [ ] **Step 2: 写入诚实进度**

本地验证完成后，`current-progress.md` 只能写“候选已验证、尚未合入/部署”；`next-tasks.md` 保留“预生产受控 reload 后确认不重建测试任务”的现场验收项。合入和部署事实必须在对应操作完成并有证据后才更新。

- [ ] **Step 3: 提交并等待发布授权**

使用显式路径暂存：

```bash
git add services/api/src/terminals/terminals.service.ts \
  services/api/scripts/verify-terminal-test-print-seed-guard.ts \
  services/api/package.json \
  services/api/.env.example \
  .github/workflows/ci.yml \
  docs/progress/current-progress.md \
  docs/progress/next-tasks.md
git commit -m "fix(print): prevent staging test task reseed"
```

随后创建 PR、等待两个 CI job 成功。预生产受控 reload、数据库零活跃任务复核和物理打印机观察属于外部状态改变，必须在获得单独部署授权后执行。

## Plan 自检

- 范围覆盖：运行时入口、环境样板、真实行为验证、CI、进度口径和发布后验收均有对应任务。
- 不含占位语：每个步骤均给出文件、命令与预期结果。
- 类型一致：verify 使用 `TerminalsService.onModuleInit()` 和 `PrismaService` 断言，不新增 API 或 schema 类型。
- 最小性：不触碰 seed 内容、支付、订单、打印领取、终端 Agent、数据库结构或 UI。
