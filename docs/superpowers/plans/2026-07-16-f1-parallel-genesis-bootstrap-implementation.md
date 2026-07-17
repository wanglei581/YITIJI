# F1 平行 Genesis Bootstrap 本地实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不触碰历史 F1、生产主机、PM2、负载层或业务流量的前提下，新增一次性、不可重入的平行 Genesis 原语和离线 RED→GREEN 门禁：它只建立零流量 managed `r1`；之后复用既有 `activateRelease` 验证 `r1 → r2` 的 managed previous/rollback 语义。

**Architecture:** Genesis 只使用独立 managed current、独立 PM2 名称和 deployment-control root；它永不接收 legacy/previous 输入。失败仅停止本调用创建的 PM2 并移除本调用创建的 managed current，同时留下不可覆盖的脱敏 failure 记录。`activateRelease` 仍是唯一的稳态切换算子。离线 fixture 使用 fake PM2、fake health 和临时目录，不连接任何服务。

**Tech Stack:** Node.js / TypeScript；现有 release provenance verifier、stable launcher、PM2 CLI 包装；Node 临时目录 fixture；pnpm；GitHub Actions。

---

## 0. 边界、文件预算与关键结论

本计划承接已确认的 [Genesis 设计规格](../specs/2026-07-16-f1-parallel-genesis-bootstrap-design.md)，只定义 D1 本地实现与 D2 镜像演练的前置，不授权 D3–D6 的操作。

**允许改动：**

- Create `services/api/src/release-provenance/release-runtime-contract.ts`
- Create `services/api/src/release-provenance/release-genesis.ts`
- Create `services/api/src/release-provenance/release-genesis-cli.ts`
- Modify `services/api/src/release-provenance/release-activation.ts`
- Create `services/api/scripts/release-provenance-fixture.ts`
- Modify `services/api/scripts/verify-release-provenance.ts`
- Create `services/api/scripts/verify-release-genesis.ts`
- Modify `services/api/package.json`
- Modify `.github/workflows/ci.yml`
- Modify `docs/progress/current-progress.md` and `docs/progress/next-tasks.md`

**明确不改：** `release-current-launcher.ts`、`release-guard.ts` 的执行语义；Prisma/schema/migration、数据库、Redis、Agent、Kiosk、Admin、打印、文件、生产配置；历史 F1 root、历史 PM2 `main.js`、现有 `current`、旧端点与负载均衡。

当前 `assertHealthUrl` 只接受 loopback `:3010`。D1 不扩大该白名单，D2/D4 的 parallel plane 必须是独立主机或等价隔离实例，使 managed process 独占该主机 `:3010`；不得在历史主机私自新增第二端口。任何同主机双端口需求都要单独改设计并复审。

代码可以用 `wx` 写入不可覆盖的 intent/success/failure record，并对现存、残缺或冲突 record fail closed；它不能识别拥有控制根删除权限的人把所有证据删除后的历史。D3 前必须由独立账户/保留机制把 deployment-control root 设置为长期保留、不可由 Genesis 执行者清除。无法证明该边界时 D4/D5 一律 `NO-GO`；D1/D2 不得把本地临时文件的可删除性误写为生产保证。

## 1. 固定接口与数据契约

### 1.1 Genesis 输入和 CLI

`release-genesis.ts` 只接受下面对象；不存在 `legacyRoot`、`previousRoot`、动态 script、动态 args、端口或环境变量取值字段：

```ts
export type ReleaseGenesisOptions = {
  candidateRoot: string
  managedCurrentLink: string
  artifactRoot: string
  deploymentControlRoot: string
  pm2Name: string
  healthUrl: string
  launcherCwd: string
  launcherPath: string
  launcherSha256: string
  runtimeEnvContractPath: string
  runtimeEnvContractSha256: string
  runner?: GenesisRunner
  healthProbe?: HealthProbe
}

export type GenesisResult = {
  status: 'parallel-serving-r1'
  releaseId: string
}
```

CLI 必须精确接受 11 组 flag（22 个参数）：`--candidate-root`、`--managed-current-link`、`--artifact-root`、`--deployment-control-root`、`--pm2-name`、`--health-url`、`--launcher-cwd`、`--launcher-path`、`--launcher-sha256`、`--runtime-env-contract`、`--runtime-env-contract-sha256`。每个 flag 只能一次。成功只写 `RELEASE_PROVENANCE_GENESIS_READY <releaseId>`；失败只写 provenance error code，永不输出 path、环境变量值、PM2 原始输出或业务数据。

### 1.2 受限运行环境合约

运行环境合约是经 SHA-256 固定的非链接普通 JSON 文件，最大 64 KiB，只记录名称和用途、不记录值：

```ts
type RuntimeEnvironmentContract = {
  schemaVersion: 1
  variables: readonly { name: string; purpose: string }[]
}
```

`name` 必须匹配 `^[A-Z][A-Z0-9_]{0,127}$`、无重复；`purpose` 长度为 1–160 且无控制字符。`PATH` 和运行 PM2 所需的任何目录变量都必须显式列出。`loadApprovedRuntimeEnvironment()` 只按合约中的名称从本进程读取值；缺少任一值即 `RELEASE_PROVENANCE_RUNTIME_ENV_VALUE_MISSING`，不枚举 `process.env`、不读 `.env`、不记录或输出值。Genesis 的 `start` 和 activation 的 `reload` 只接收此精确副本，不能退回为完整 `process.env`。

### 1.3 脱敏部署控制记录

deployment-control root 只归这一次 Genesis 使用，固定文件为：

- `GENESIS_INTENT.json`：`PREPARING`，在首次 provenance 校验前以 `wx` 建立。
- `GENESIS_SUCCESS.json`：`PARALLEL_SERVING_R1`，health 成功后以 `wx` 建立。
- `GENESIS_FAILURE.json`：`FAILED_CLOSED`，任一 Genesis 失败后以 `wx` 建立。
- `GENESIS.lock`：独占执行锁，只有创建者能按 token/readback 校验后释放。

记录只含 schema version、状态、时间戳、release ID、PM2 名称、launcher SHA-256、各 path 的 SHA-256 标识、runtime-env-contract SHA-256、health 布尔结果和 failure code；不得存真实 path、环境变量值、用户数据、日志或网络地址。正常成功终态合法地同时含 `INTENT + SUCCESS`，其重入固定返回 `RELEASE_PROVENANCE_GENESIS_ALREADY_INITIALIZED`；正常失败终态为 `INTENT + FAILURE`，bare intent、bare failure、未知内容、`SUCCESS + FAILURE`、任一记录格式不合法均为 `RELEASE_PROVENANCE_GENESIS_CONTROL_STATE_INVALID`。任何现存 managed current（即使不是链接）或同名 PM2 都在启动前拒绝。只有 `runner.start()` 已成功返回的调用允许 `runner.stop()`。

## 2. Task 1：拆分现有 fixture，先证明 activation 行为未变

**Files:** Create `services/api/scripts/release-provenance-fixture.ts`; Modify `services/api/scripts/verify-release-provenance.ts`.

- [ ] 先运行 `pnpm --filter @ai-job-print/api verify:release-provenance`，记录基线全绿；不运行 release CLI 或 PM2。
- [ ] 从 553 行脚本抽取纯临时目录 helpers：`Fixture`、`writeFixtureFile`、`createFixture`、`createManifest`、`replaceManifestCopies`、`withFixture`。fixture 内容、manifest 固定时间与清理行为逐字等价。
- [ ] 原脚本只改 import，保留 guard、launcher、activation 的 19 个既有场景及 error code。
- [ ] 运行：

```bash
pnpm --filter @ai-job-print/api verify:release-provenance
```

Expected: `=== ALL PASS ===`，无网络、数据库、Redis、真实 PM2 或 health。

- [ ] Commit: `refactor: share release provenance fixtures`。

## 3. Task 2：共享 runtime / 环境契约，activation 先 RED→GREEN

**Files:** Create `services/api/src/release-provenance/release-runtime-contract.ts`; Modify `services/api/src/release-provenance/release-activation.ts`, `services/api/scripts/release-provenance-fixture.ts`, `services/api/scripts/verify-release-provenance.ts`.

- [ ] 先在 existing verify 写 RED：activation 拒绝缺失、摘要错误、链接、未知字段、重复变量、缺少所列变量值的环境合约；每种错误都不能 reload 或切换 current。
- [ ] activation fixture 创建最小 `runtime-env-contract.json`，传入其 path/SHA；fake runner 断言收到的 environment 仅含 contract key，且测试绝不输出值。
- [ ] 新建下列 shared exports：

```ts
export type Pm2ProcessSnapshot = { name: string; status: string; cwd: string; execPath: string; scriptArgs: string }
export type StableLauncher = { cwd: string; path: string; sha256: string }
export type HealthProbe = (healthUrl: string) => Promise<boolean>
export type ApprovedRuntimeEnvironment = Readonly<Record<string, string>>

export function assertPm2ArgumentPath(value: string, code: string): void
export function assertLocalHealthUrl(value: string): void
export function assertPm2Name(value: string): void
export function assertApprovedLauncher(cwd: string, path: string, sha256: string): StableLauncher
export function assertPm2Snapshot(snapshot: Pm2ProcessSnapshot, pm2Name: string, launcher: StableLauncher, currentLink: string, artifactRoot: string): void
export function readCurrentRelease(currentLink: string): string
export function loadApprovedRuntimeEnvironment(path: string, sha256: string): ApprovedRuntimeEnvironment
```

- [ ] `loadApprovedRuntimeEnvironment()` 完整验证 file type、path、SHA、exact-key set、schema、变量名、用途、重复项、缺失值；失败码为 `RELEASE_PROVENANCE_RUNTIME_ENV_CONTRACT_INVALID`、`RELEASE_PROVENANCE_RUNTIME_ENV_CONTRACT_MISMATCH`、`RELEASE_PROVENANCE_RUNTIME_ENV_VALUE_MISSING`，不拼接任何敏感信息。
- [ ] activation 的 launcher/PM2/health/current helper 改为 import shared contract，保留 lock、candidate/previous verifier、原子切换、rollback 和现有 public error code。`ReleaseActivationOptions` 与 CLI 新增 `runtimeEnvContractPath`/`runtimeEnvContractSha256`，其 CLI 参数总数从 16 严格增至 20；`CommandRunner.reload(pm2Name, environment)` 与 `CommandRunner.inspect(pm2Name, environment)` 都接收 narrowed environment。
- [ ] 将这项 CLI 契约变更记录为 future-only：当前 F1 没有获授权的 live `release:activate` 调用方，D1 不声称兼容任何未盘点的外部部署脚本；D3 必须只读确认后续受管发布调用方已带 contract path/SHA，缺失即 `NO-GO`。
- [ ] `runPm2()` 的 reload 与 describe 都用该 environment 调用 `spawnSync`，不继承完整环境。`inspect()` 只能把 PM2 的精确“目标进程不存在”结果映射为 `null`；任何 exit/output 解析异常必须是 `RELEASE_PROVENANCE_PM2_COMMAND_FAILED` 或 `RELEASE_PROVENANCE_PM2_INSPECT_INVALID`，不能把不明错误误当成不存在。fake runner 不执行 system PM2。
- [ ] 运行：

```bash
pnpm --filter @ai-job-print/api verify:release-provenance
pnpm --filter @ai-job-print/api typecheck
pnpm --filter @ai-job-print/api lint
```

Expected: 旧矩阵全绿，环境合约负例均在 reload/link switch 前失败。

- [ ] Commit: `feat: constrain release runtime environment`。

## 4. Task 3：先写 Genesis 离线 RED 矩阵

**Files:** Create `services/api/scripts/verify-release-genesis.ts`; Modify `services/api/package.json`.

- [ ] 使用共享 helpers 创建 `r1`、`r2`、artifact、独立 launcher、managed current、control root。legacy 只是测试 sentinel，不得是 `ReleaseGenesisOptions` 的字段。
- [ ] 建立 `FakeGenesisRunner`（记录 `inspect/start/stop` 和唯一 `ManagedProcessStart`）、fake health probe、内存 traffic controller、脱敏 output writer。traffic controller 只属于 verification script：Genesis module/CLI 不得 import、定义或调用任何 traffic 接口、`PARALLEL_SERVING_R2` 令牌或负载层操作；所有 fake 都不调用系统 PM2、网络或负载层。
- [ ] 在模块不存在时先写下列 RED 场景：

  1. `r1` manifest/tree/archive/entrypoint/artifact 任一篡改：既有 provenance error、`start=0`、`stop=0`、managed current 不存在、legacy spy 为 0；只留下无 path/无秘密的 failure record。
  2. success/failure/intent/未知 record、预存 lock、现存 managed current 或同名 PM2：fail closed，不删除旧文件，除必要 inspect 外不调 start/stop。
  3. launcher SHA、PM2 snapshot 或 health 不匹配：若 start 已返回，只 stop 一次、只删除本调用且仍解析为 `r1` 的 managed current、写 `FAILED_CLOSED`；legacy spy 为 0。
  4. current 被替换、stop 失败、failure-record 写入失败：返回 `RELEASE_PROVENANCE_GENESIS_CLEANUP_UNVERIFIED`，保留证据而不猜测性清理。
  5. 成功时 current 为 `r1`、PM2 cwd/script/fixed args 与 launcher 精确匹配、health 为真、success 为 `PARALLEL_SERVING_R1`；第二次调用必为 already-initialized。
  6. 成功 Genesis 后篡改 `r1` 再调 `activateRelease(r2)`：必须在 reload 前因 previous provenance 失败；正常 `r1 → r2` 后模拟 `r2` post-switch health 失败，只恢复 `r1`、绝不引用 legacy。
  7. CLI 缺/重/未知 flag、relative/含空白 path、legacy/previous 伪 flag、合约摘要错：拒绝；成功输出精确 ready marker。
  8. 静态负例扫描 Genesis module/CLI：拒绝 `.env`、`DATABASE_URL`、`Prisma`、`Redis`、业务文件目录、日志目录、环境枚举和 legacy/previous input flag；只有 shared loader 能按已验证名称读取 value。
  9. traffic fake：`PARALLEL_SERVING_R1` 不得请求切流，`r1 → r2` failure 保留 legacy target，只有测试侧显式构造的 `PARALLEL_SERVING_R2` 才能形成 managed-target 请求；该断言证明 D1 runtime 从不发起切流。

- [ ] 注册：

```json
"verify:release-genesis": "node -r @swc-node/register scripts/verify-release-genesis.ts"
```

- [ ] 运行 `pnpm --filter @ai-job-print/api verify:release-genesis` 并确认 RED；不可借真实 PM2 偶然通过。
- [ ] Commit: `test: define release genesis fail-closed contract`。

## 5. Task 4：实现 Genesis 状态机，令 RED 全部转绿

**Files:** Create `services/api/src/release-provenance/release-genesis.ts`; Modify `services/api/scripts/verify-release-genesis.ts`.

- [ ] 实现受限 runner：

```ts
export type ManagedProcessStart = {
  pm2Name: string
  launcher: StableLauncher
  managedCurrentLink: string
  artifactRoot: string
  environment: ApprovedRuntimeEnvironment
}

export type GenesisRunner = {
  inspect(pm2Name: string, environment: ApprovedRuntimeEnvironment): Pm2ProcessSnapshot | null
  start(options: ManagedProcessStart): void
  stop(pm2Name: string): void
}
```

- [ ] system runner 只能以固定 launcher、`--current-link`、`--artifact-root`、`--launcher-sha256`、narrowed environment 构造 PM2 调用；不接收 shell string、附加 script/args、端口、legacy 或 previous。`inspect()` 用同一 narrowed environment；无该进程时返回 null，其余错误 fail closed；`stop()` 只能由 `startedByThisCall === true` cleanup 分支调用。
- [ ] 先用 `lstat`/`realpath` 验证 control root 是既存绝对非链接目录，取得 token lock，加载环境合约，再拒绝 control record、managed current、同名 PM2；随后以 `wx` 写 `GENESIS_INTENT.json`，再用既有 `verifyReleaseProvenance` 验证 `r1`，不复制 verifier。此顺序与 §1.3 一致：校验失败也必须可留下脱敏 `FAILED_CLOSED` 终态。
- [ ] `createManagedCurrent()` 直接 `symlinkSync(r1, managedCurrentLink)`，只允许目标不存在时创建；不得复用 activation replace/rename，不得覆盖任何 path；创建后 `readCurrentRelease()` 必须等于 canonical `r1`。
- [ ] 固定顺序为：写 intent → 建 current → `start` → snapshot → health → 以 `wx` 写 success。返回 `{ status: 'parallel-serving-r1', releaseId }`。
- [ ] 单一 cleanup：仅在路径仍为本调用 `r1` 时删除 current；仅 stop 已启动 PM2；最后 `wx` 写 failure。cleanup 或写 failure 任一失败均升级 `RELEASE_PROVENANCE_GENESIS_CLEANUP_UNVERIFIED`；只在 token/readback 匹配时释放自己的 lock。没有“清除、恢复、重试、切流、legacy fallback”函数。
- [ ] 运行：

```bash
pnpm --filter @ai-job-print/api verify:release-genesis
pnpm --filter @ai-job-print/api verify:release-provenance
pnpm --filter @ai-job-print/api typecheck
pnpm --filter @ai-job-print/api lint
```

Expected: 两套矩阵全绿，所有 PM2/health 均为 fake，输出无环境值。

- [ ] Commit: `feat: add one-time parallel release genesis`。

## 6. Task 5：增加窄 CLI，不能将其视作 D4 授权

**Files:** Create `services/api/src/release-provenance/release-genesis-cli.ts`; Modify `services/api/scripts/verify-release-genesis.ts`, `services/api/package.json`.

- [ ] `parseGenesisArgs(args)` 必须长度 22、flag 集正好等于 §1.1、无重复/空 value；只传结构化选项给 `runReleaseGenesis()`。
- [ ] `runReleaseGenesisCli(args, output, dependencies?)` 在 fixture 注入 fake runner/probe，直接执行时才用 system runner。成功只输出 ready marker；失败只输出 `ReleaseProvenanceError.code`，默认 `RELEASE_PROVENANCE_GENESIS_FAILED`。
- [ ] 注册：

```json
"release:genesis": "node dist/release-provenance/release-genesis-cli.js"
```

- [ ] fixture 覆盖成功 marker、stderr marker、参数负例、zero-system-PM2。D1 不运行 `release:genesis`，更不连接任何实例。
- [ ] 运行：

```bash
pnpm --filter @ai-job-print/api verify:release-genesis
pnpm --filter @ai-job-print/api build
node services/api/dist/release-provenance/release-genesis-cli.js
```

Expected: 前两项通过；最后一项只以 `RELEASE_PROVENANCE_GENESIS_ARGUMENT_INVALID` 结束，绝不创建目录、PM2 或网络请求。

- [ ] Commit: `feat: expose constrained release genesis cli`。

## 7. Task 6：接入 CI、完成本地交付验证与审查

**Files:** Modify `.github/workflows/ci.yml`, `docs/progress/current-progress.md`, `docs/progress/next-tasks.md`.

- [ ] 在 `Release provenance fixture` 后新增 `Release Genesis fixture`，只运行 `pnpm --filter @ai-job-print/api verify:release-genesis`；注释标明它只使用临时目录、fake PM2、fake health、fake traffic controller，禁止连接网络、数据库、Redis、实例或真实 PM2。
- [ ] progress 只记录已完成的代码/离线验证/CI 事实和 production 仍为 `NO-GO`；绝不把 `release:genesis` 的存在描述为 D4 或切流完成。
- [ ] next tasks 保留 D2 镜像演练、D3 只读预检、D4 零流量 Genesis、D5 切流、D6 稳态发布的独立授权。D5 的硬前置必须写为：镜像拓扑已完整演练 `r2` post-switch health failure → verified `r1` rollback 并留有脱敏证据；生产禁止故意制造健康故障。
- [ ] 完整本地验证：

```bash
pnpm --filter @ai-job-print/api verify:release-provenance
pnpm --filter @ai-job-print/api verify:release-genesis
pnpm --filter @ai-job-print/api typecheck
pnpm --filter @ai-job-print/api lint
pnpm --filter @ai-job-print/api build
git diff --check
git status --short
```

Expected: 两个 fixture 均 `ALL PASS`，typecheck/lint/build 通过，diff 无空白错误，状态仅含计划范围文件和 CCG 忽略元数据。

- [ ] 双模型终审：Claude 聚焦 provenance/状态机/环境契约/rollback；Antigravity 聚焦 CLI、fixture、CI 边界。任一 Critical 或未关闭 Warning 都要补 RED、修复、重跑完整验证、重新双审。
- [ ] Commit: `feat: add parallel release genesis guard`。

## 8. D2 以后才可提出的授权门槛

本节不是命令，也不授权任何环境变化。

- [ ] **D2 镜像演练：** 在与 legacy 独立的非生产主机，从空 control root 建 `r1`，完成零流量 `r1 → r2`，受控证明一次 `r2` post-switch health failure 只回 `r1`。还必须证明收窄 environment 对 `pm2 reload --update-env` 与 `pm2 describe` 生效，并验证“目标进程不存在”的精确识别不会掩盖其他 PM2 错误。legacy endpoint 始终保留原 target，证据只保留 release ID、摘要、状态码、结果。
- [ ] **D3 只读预检：** 独立确认主机/端点、PM2 名称/current/control root、control root 长期保留边界、launcher/env-contract 摘要、无流量条件、权限分离，以及对残留 `GENESIS.lock` 的人工恢复授权/证据流程；有一项缺失即不进 D4。
- [ ] **D4 零流量 Genesis：** 仅在具名、限时授权下建 production managed `r1` 后执行 managed `r1 → r2`；不允许切流、legacy reload、环境值输出、凭据读取或故障注入。
- [ ] **D5 一次性切流：** 仅当 D2 rollback 演练、D3 预检、D4 `PARALLEL_SERVING_R2` 证据齐全，且负载层能证明“完整切 managed 或保持完整 legacy”的原子结果时单独申请。切流后绝不把 legacy 作为 fallback。
- [ ] **D6 稳态发布：** 仅允许带 runtime-env contract 的 `activateRelease` 在 managed previous 间发布；Genesis、历史 F1 root、legacy PM2 永远不是回退来源。

## 9. 完成定义

D1 只有在文件职责清晰、Genesis/activation 两套离线 fixture 全绿、API typecheck/lint/build 与 CI 接线完成、双模型终审无 Critical 或未关闭 Warning、两份 progress SSOT 只陈述已验证本地事实时才算完成。

即使 D1 完成，也不表示 production provenance 已闭合、Genesis 已在任何机器运行、负载层可切流、历史 F1 被追认或 D2–D6 自动获批。任何真实执行都必须取得对应阶段的独立授权。
