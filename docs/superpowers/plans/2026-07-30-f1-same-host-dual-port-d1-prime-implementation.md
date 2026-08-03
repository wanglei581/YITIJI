# F1 D1′ + D2′ Same-Host Dual-Port Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan.

**Goal:** 在不连接或修改生产环境的前提下，把 future-only managed Genesis / activation 的唯一健康检查端点从 legacy `127.0.0.1:3010` 收紧到 managed `127.0.0.1:3011`，同步 CI 与正式 SSOT，并在合格的非生产 Linux 环境完成同一网络命名空间双端口、双 PM2 daemon、真实 Nginx、managed cgroup 资源抑制和切流后 managed-only rollback 演练。

**Architecture:** legacy 链继续占用 `127.0.0.1:3010`；future-only managed 链固定占用 `127.0.0.1:3011`。`assertLocalHealthUrl()` 继续做单一字符串全等判断，且在 Genesis/activation 的 PM2、current、health、Nginx 动作前 fail closed。D2′ 在非生产 Linux 上证明 legacy、managed 与 Nginx 位于同一个 network namespace，同时运行独立 legacy/managed `PM2_HOME` 与 daemon；managed daemon 及其后代进入独立 cgroup v2/systemd scope，Nginx 先 100% 指向 legacy，候选配置只有在真实 `nginx -t` 成功后才 reload，`CUTOVER_CONFIRMED` 后失败只能回到 verified managed previous。

**Tech Stack:** TypeScript / Node.js、现有 release provenance / Genesis / activation 原语、PM2 6、Nginx、Linux cgroup v2 + systemd transient unit、pnpm、GitHub Actions、JSON 脱敏证据。

---

## 0. 执行边界、依赖与文件预算

本计划承接已批准的 [F1 同机双端口 Managed 发布拓扑设计](../specs/2026-07-30-f1-same-host-dual-port-managed-topology-design.md)。只授权后续实现者执行 D1′ 本地代码/文档修订和 D2′ 非生产演练；不授权 D3 production SSH、D4 Genesis、D5 production Nginx 切流、D6 activation，production F1 始终保持 **NO-GO**。

### 0.1 必须保持的不变量

- 唯一合法 managed health URL 是 `http://127.0.0.1:3011/api/v1/health`。
- 继续使用精确字符串全等；禁止 URL parser、双白名单、端口范围、运行时模板或可配置 health target。
- `3010` 是 legacy 端口，必须成为 future-only Genesis 和 activation 的负例。
- URL 契约失败必须发生在任何 PM2 `inspect/start/reload/stop`、current 创建/切换、health 请求或 Nginx reload 之前。
- D2′ 只使用 synthetic release、stub health 和空白数据环境；禁止 production PostgreSQL/Redis/COS 凭据，禁止 migration、DDL、seed、第二 worker、cron、scheduler 或 queue consumer。
- PM2 `max_memory_restart` 只算重启守卫，不算资源隔离。D2′ 缺 Linux cgroup v2、systemd delegation 或经批准的内核级等价机制时必须 `D2_PRIME_NO_GO`。
- D2′ 的 Nginx 必须是真实二进制和真实 `nginx -t`/reload；字符串解析或 fake controller 只能用于离线契约测试，不能形成 D2′ PASS。
- `CUTOVER_CONFIRMED` 前失败可保持或恢复已验证 legacy Nginx 配置；确认后 legacy 永远不是 previous、fallback 或 rollback target。
- D2′ PASS 只证明非生产机制，不证明生产容量、HA 或 D3–D6 已获授权。

### 0.2 结构影响结论

CodeGraph / codebase-memory 显示 `assertLocalHealthUrl()` 的直接关键调用点为：

- `runReleaseGenesis()`：在 control root、runner、lock、current 和 PM2 动作之前调用；
- `activateRelease()`：在 launcher、environment、activation lock、current 切换和 PM2 reload 之前调用；
- 间接 CLI 调用点为 `runReleaseGenesisCli()` 与 `runReleaseActivationCli()`。

因此 D1′ 不应修改 `release-genesis.ts`、`release-activation.ts` 或两个 CLI 的执行语义；只改变共享常量和验证矩阵即可覆盖两条生产候选路径。

### 0.3 允许修改

**D1′ existing files：**

- Modify `services/api/src/release-provenance/release-runtime-contract.ts`
- Modify `services/api/scripts/verify-release-provenance.ts`
- Modify `services/api/scripts/verify-release-genesis.ts`
- Modify `services/api/scripts/d2-docker-drill.mjs`
- Modify `services/api/package.json`
- Modify `.github/workflows/ci.yml`
- Modify `docs/device/production-deployment-runbook.md`
- Modify `docs/device/f1-d3-managed-topology-inputs.md`
- Modify `docs/device/f1-d3-managed-topology-approval-package.md`
- Modify `docs/device/f1-d2-docker-isolation-runbook.md`
- Modify `docs/superpowers/plans/2026-07-16-f1-parallel-genesis-bootstrap-implementation.md` only to add a supersession notice; do not rewrite historical steps
- Modify `docs/progress/current-progress.md`
- Modify `docs/progress/next-tasks.md`

**D2′ new files：**

- Create `services/api/scripts/d2-release-fixture.mjs`
- Create `services/api/scripts/d2-same-host/contract.mjs`
- Create `services/api/scripts/d2-same-host/verify-contract.mjs`
- Create `services/api/scripts/d2-same-host/drill.mjs`
- Create `services/api/scripts/d2-same-host/managed-scope.mjs`
- Create `services/api/scripts/d2-same-host/run.sh`
- Create `services/api/scripts/d2-same-host/.gitignore`
- Create `docs/device/f1-d2-same-host-dual-port-runbook.md`

Target budget: 13 existing files + 8 new files；代码/脚本净增不超过约 1,400 行，单个新脚本目标小于 400 行。若 `drill.mjs` 将超过 500 行，先把 Nginx renderer/runner 或 evidence collector 拆到同目录的 focused module，再继续实现；不得形成 800+ 行脚本。

### 0.4 禁止修改

- `services/api/src/main.ts` 的普通开发/legacy 默认 `PORT=3010`
- `services/api/src/release-provenance/release-genesis.ts`
- `services/api/src/release-provenance/release-activation.ts`
- `services/api/src/release-provenance/release-genesis-cli.ts`
- Prisma schema、migration、seed、数据库同步脚本
- `services/worker/**`、所有业务 API 模块、Kiosk/Admin/Partner、Terminal Agent
- production `.env`、PM2 ecosystem/dump、Nginx 配置、服务器文件和凭据
- 历史 acceptance/review 快照；需要新结论时写新的 progress/runbook，不 retroedit 证据快照

---

## Task 1：冻结最新基线并证明现有门禁为绿

**Files:** No product file changes; update only the active CCG task metadata after verification.

- [ ] 从本 worktree 确认工作区只含计划任务允许的改动；实施开始前先把本分支安全 rebase 到最新 `origin/main`，不得丢弃设计提交。

```bash
git status --short --branch
git fetch origin main
git rebase origin/main
git status --short --branch
```

Expected: rebase 无冲突；分支保留已批准设计与本计划提交，工作区 clean。

- [ ] 读取 `.ccg/spec/backend/index.md`、`.ccg/spec/guides/index.md`（存在即必须遵守），再重新确认文件预算。

```bash
ls .ccg/spec
sed -n '1,240p' .ccg/spec/backend/index.md 2>/dev/null || true
sed -n '1,260p' .ccg/spec/guides/index.md
```

Expected: 实施记录写明实际读取的 spec；不得新增第二套项目标准。

- [ ] 跑 D1′ 基线门禁，不调用 release CLI 的 system runner，也不运行 PM2/Nginx。

```bash
pnpm --filter @ai-job-print/api verify:release-provenance
pnpm --filter @ai-job-print/api verify:release-genesis
pnpm --filter @ai-job-print/api typecheck
```

Expected: 两个 verifier 全绿，typecheck exit 0；当前 fixture 仍以 `3010` 通过，作为 RED 前基线事实记录。

- [ ] 记录当前残留字面量，但不要把所有 `3010` 一律替换；普通 legacy/preproduction 文档中的 `3010` 可能仍然正确。

```bash
rg -n 'http://127\.0\.0\.1:3010/api/v1/health|listen\(3010|:3010 health' \
  services/api/src/release-provenance \
  services/api/scripts/verify-release-provenance.ts \
  services/api/scripts/verify-release-genesis.ts \
  services/api/scripts/d2-docker-drill.mjs \
  docs/device docs/superpowers/plans/2026-07-16-f1-parallel-genesis-bootstrap-implementation.md
```

Expected: 结果至少包含 shared contract、两个 verifier、旧 D2、D3 inputs、production runbook 和旧 F1 plan；实施者逐项分类为 managed 待改、legacy 正确保留或历史加 supersession note。

- [ ] Commit: no commit for baseline-only checks.

---

## Task 2：D1′ RED——定义 managed `3011` 精确契约与前置失败矩阵

**Files:** Modify `services/api/scripts/verify-release-provenance.ts`, `services/api/scripts/verify-release-genesis.ts`.

- [ ] 在两个 verifier 中从 shared runtime contract 导入 `assertLocalHealthUrl`；定义唯一正例与拒绝表。负例用于证明全等契约，不得为它们增加分类 parser。

```ts
const MANAGED_HEALTH_URL = 'http://127.0.0.1:3011/api/v1/health'

const REJECTED_HEALTH_URLS = [
  'http://127.0.0.1:3010/api/v1/health',
  'http://127.0.0.1:3012/api/v1/health',
  'http://localhost:3011/api/v1/health',
  'http://0.0.0.0:3011/api/v1/health',
  'http://[::1]:3011/api/v1/health',
  'http://api.local:3011/api/v1/health',
  'https://127.0.0.1:3011/api/v1/health',
  'http://127.0.0.1:3011/health',
  'http://127.0.0.1:3011/api/v1/health/',
  'http://user:pass@127.0.0.1:3011/api/v1/health',
  'http://127.0.0.1:3011/api/v1/health?probe=1',
  'http://127.0.0.1:3011/api/v1/health#probe',
  'http://169.254.169.254/latest/meta-data/',
] as const
```

- [ ] 在 `verify-release-provenance.ts` 和 `verify-release-genesis.ts` 都添加直接 contract table test：`3011` 不抛错；每个负例抛 `ReleaseProvenanceError` 且 `code === 'RELEASE_PROVENANCE_HEALTH_URL_INVALID'`。两套 verifier 都必须以一阶契约断言得到清晰 RED，不能只靠后续 side-effect counter 间接失败。

```ts
function verifyManagedHealthUrlContract(): void {
  assert.doesNotThrow(() => assertLocalHealthUrl(MANAGED_HEALTH_URL))
  for (const value of REJECTED_HEALTH_URLS) {
    assert.throws(
      () => assertLocalHealthUrl(value),
      (error: unknown) =>
        error instanceof ReleaseProvenanceError &&
        error.code === 'RELEASE_PROVENANCE_HEALTH_URL_INVALID'
    )
  }
}
```

- [ ] 添加 activation 路径负例：用完整有效 fixture，仅把 `healthUrl` 覆盖为 legacy `3010`，并**显式注入** fake runner 与计数型 fake health probe；断言 current 仍指向 previous、fake runner 的 `reload`/`inspect` 计数未增加、health probe 为 0，且无 activation lock 残留。Task 2 shared constant 仍接受 `3010`，若测试写错会继续执行；因此绝不能依赖默认 `systemHealthProbe`，避免真实请求本机 `3010`。

- [ ] 在 `verify-release-genesis.ts` 添加 Genesis 路径负例：用完整有效 fixture，仅把 `healthUrl` 覆盖为 legacy `3010`，并**显式注入** fake runner 与计数型 fake health probe；断言 URL 在 control-root/launcher/candidate realpath 校验之前 fail closed，Genesis lock/control record 不存在，`runner.inspect/start/stop`、health probe 均为 0，managed current 不存在。默认 system runner/probe 在 RED test 中一律禁止。

- [ ] 运行 RED。两个 verifier 都必须因为 shared constant 尚为 `3010` 而失败；如果意外全绿，说明测试没有覆盖真实 shared contract，立即停止修正测试。

```bash
pnpm --filter @ai-job-print/api verify:release-provenance
pnpm --filter @ai-job-print/api verify:release-genesis
```

Expected: exit non-zero；失败明确来自 `3011` 正例被拒或 `3010` 未被拒。不得出现真实网络、PM2 或 Nginx 调用。

- [ ] Commit RED tests.

```bash
git add services/api/scripts/verify-release-provenance.ts services/api/scripts/verify-release-genesis.ts
git commit -m "test: define managed 3011 health contract"
```

---

## Task 3：D1′ GREEN——翻转 shared contract 并对齐现有 fixtures

**Files:** Modify `services/api/src/release-provenance/release-runtime-contract.ts`, `services/api/scripts/verify-release-provenance.ts`, `services/api/scripts/verify-release-genesis.ts`.

- [ ] 只修改 shared constant；保持函数体为单一 `!==` 判断。

```ts
const LOCAL_HEALTH_URL = 'http://127.0.0.1:3011/api/v1/health'

export function assertLocalHealthUrl(value: string): void {
  if (value !== LOCAL_HEALTH_URL) fail('RELEASE_PROVENANCE_HEALTH_URL_INVALID')
}
```

- [ ] 把 activation fixture、Genesis `HEALTH_URL` 和 CLI 正例全部切到 `MANAGED_HEALTH_URL`；legacy `3010` 只允许保留在明确命名的 negative table/test 中。

- [ ] 证明两条调用路径的前置顺序未被改动：本 Task 不修改 Genesis/activation runtime files；使用 Task 2 的 counters 证明 `3010` 在任何 runner/current/health 动作前 fail closed。

- [ ] 运行 GREEN 和静态收口。

```bash
pnpm --filter @ai-job-print/api verify:release-provenance
pnpm --filter @ai-job-print/api verify:release-genesis
pnpm --filter @ai-job-print/api typecheck
pnpm --filter @ai-job-print/api lint
pnpm --filter @ai-job-print/api build
rg -n '127\.0\.0\.1:3010/api/v1/health' \
  services/api/src/release-provenance \
  services/api/scripts/verify-release-provenance.ts \
  services/api/scripts/verify-release-genesis.ts
```

Expected: verifier/typecheck/lint/build 全绿；`3010` 搜索只命中拒绝矩阵或明确的 negative-path 调用，不命中 runtime constant、fixture happy path 或 CLI happy path。

- [ ] Commit GREEN implementation.

```bash
git add services/api/src/release-provenance/release-runtime-contract.ts \
  services/api/scripts/verify-release-provenance.ts \
  services/api/scripts/verify-release-genesis.ts
git commit -m "fix: pin managed release health to port 3011"
```

---

## Task 4：保持旧 D2 基线可运行，并把 CI 接到新增离线契约

**Files:** Modify `services/api/scripts/d2-docker-drill.mjs`; Create `services/api/scripts/d2-release-fixture.mjs`. Package/CI wiring remains deferred to Task 6.

- [ ] 把旧 D2 Docker drill 的 managed stub、health 和私有 `__d2/env` probe 一致切到 `3011`。此修改只保证旧 D2 与新 shared contract 兼容；不得把旧 D2 verdict 改名为 D2′ PASS。

- [ ] 把旧 D2 中已经验证的 synthetic provenance release builder 等价抽取为 `services/api/scripts/d2-release-fixture.mjs`；旧 D2 和新 D2′ 都只能 import 这一份 builder。helper 负责完整 source tree、manifest/tree/archive/entrypoint artifact、guard、launcher/runtime-contract 输入，不启动 PM2/Nginx/network。抽取前后旧 D2 release bytes、manifest 语义和 error code 必须等价。

Required replacements:

```js
const HEALTH_URL = 'http://127.0.0.1:3011/api/v1/health'
// healthy/unhealthy managed stub .listen(3011, '127.0.0.1')
// __d2/env probe uses http://127.0.0.1:3011/__d2/env
```

- [ ] 运行旧 D2；它可作为 provenance/rollback 回归，但输出必须继续说明 `productionF1: NO-GO`。

```bash
pnpm --filter @ai-job-print/api drill:d2-docker
```

Expected: qualifying Docker/Colima 环境输出既有 `D2_PASS_ISOLATION`；证据 health URL 为 `3011`。没有 Docker 时记录 `D2_DOCKER_MISSING`/daemon down，不能因此跳过后续 D2′。

Task 6 GREEN 后再一次性接入以下 package/CI 配置；本 Task 不提前修改它们：

```json
"verify:d2-same-host-contract": "node scripts/d2-same-host/verify-contract.mjs",
"drill:d2-same-host": "bash scripts/d2-same-host/run.sh"
```

CI 的目标位置是 Release Genesis fixture 之后；注释必须说明它只验证 renderer/state/evidence schema，不调用 PM2、Nginx、systemd、网络或 production 数据平面。full `drill:d2-same-host` 是 Linux 非生产人工门禁，不在通用 CI 假装执行。

```yaml
- name: D2 prime offline contract fixture
  # Pure renderer/state/evidence checks only; no PM2, Nginx, systemd, network, or production data plane.
  run: pnpm --filter @ai-job-print/api verify:d2-same-host-contract
```

- [ ] 本 Task 先只提交旧 D2 对齐；package/CI 必须等 Task 6 的 `contract.mjs` 已 GREEN 后再接线，任何 commit 都不得让 CI 指向不存在文件。

```bash
git add services/api/scripts/d2-docker-drill.mjs services/api/scripts/d2-release-fixture.mjs
git commit -m "fix: align isolated D2 drill with managed port 3011"
```

---

## Task 5：D2′ RED——先定义离线 topology/cutover/evidence 契约

**Files:** Create `services/api/scripts/d2-same-host/verify-contract.mjs` only. Do not wire package/CI while the imported contract module is absent.

- [ ] 创建 `verify-contract.mjs`，先从尚不存在的 `./contract.mjs` 导入下列接口，并写 RED assertions：

```js
import {
  buildEvidence,
  renderNginxConfig,
  transitionCutover,
  validateEvidence,
} from './contract.mjs'
```

- [ ] Nginx renderer tests 必须覆盖：
  1. `legacy` 配置只有 `127.0.0.1:3010`；
  2. `managed` 配置只有 `127.0.0.1:3011`；
  3. 不存在 weighted/mixed upstream；
  4. 非 `legacy|managed` target fail closed；
  5. 生成的测试 listener 只使用传入的非特权 loopback 端口，不触碰 `/etc/nginx`。

- [ ] cutover state tests 必须覆盖下列纯状态机，不允许 `CUTOVER_CONFIRMED` 后产生 legacy target：

```text
LEGACY_ACTIVE
  --candidate_validated--> MANAGED_CANDIDATE_VALIDATED
  --reload_succeeded-----> MANAGED_RELOADED_UNCONFIRMED
  --confirm--------------> CUTOVER_CONFIRMED

MANAGED_CANDIDATE_VALIDATED --validation/reload failed--> LEGACY_ACTIVE
MANAGED_RELOADED_UNCONFIRMED --external check failed-----> LEGACY_ACTIVE
CUTOVER_CONFIRMED --bad managed release---------------> MANAGED_PREVIOUS_ONLY
```

- [ ] evidence validator tests 必须拒绝：端口不对、namespace 不同、任一 PM2/path 复用、`legacyHealthProbeCountByReleaseTools > 0`、Nginx 未真实执行、cgroup v2 未生效、仅 PM2 memory limit、任一数据副作用 true、post-confirm legacy fallback、原始秘密/path/log 字段以及 `productionF1 !== 'NO-GO'`。

- [ ] 运行 RED。

```bash
node services/api/scripts/d2-same-host/verify-contract.mjs
```

Expected: `ERR_MODULE_NOT_FOUND` 或明确的 missing-contract failure；不得误绿。

- [ ] Commit only the unwired RED verifier. 通用 CI 与现有 package scripts 在此 commit 必须继续全绿；本文件通过显式 `node` 命令人工得到 RED。

```bash
git add services/api/scripts/d2-same-host/verify-contract.mjs
git commit -m "test: define same-host D2 prime contract"
```

---

## Task 6：D2′ GREEN——实现纯 contract、全等 schema 与脱敏输出

**Files:** Create `services/api/scripts/d2-same-host/contract.mjs`, `services/api/scripts/d2-same-host/.gitignore`; Modify `services/api/scripts/d2-same-host/verify-contract.mjs` only when a test is demonstrably wrong; Modify `services/api/package.json`, `.github/workflows/ci.yml` after GREEN.

- [ ] 实现 total/pure functions，不 import `child_process`、网络或 filesystem mutation API：

```js
export function renderNginxConfig({ target, listenPort, pidPath, accessLogPath, errorLogPath })
export function transitionCutover(state, event)
export function buildEvidence(input)
export function validateEvidence(evidence)
```

- [ ] `renderNginxConfig()` 只接受枚举 target；配置必须是单 upstream、单 `proxy_pass`，不得同时出现两端口。路径只来自临时 workspace 的 canonical inputs；contract 层不接受 shell fragment。

- [ ] `transitionCutover()` 必须用显式枚举表；未知 state/event fail closed。`CUTOVER_CONFIRMED` 不存在到 `LEGACY_ACTIVE` 的 transition。

- [ ] `buildEvidence()` 只允许以下白名单字段，真实 path 只保存 role label/basename/SHA-256，不保存环境值、PM2 dump、日志正文、header、用户数据或 PID command line：

```js
{
  schemaVersion: 1,
  plane: 'd2-prime-same-host-dual-port',
  verdict: 'D2_PRIME_PASS' | 'D2_PRIME_NO_GO',
  productionF1: 'NO-GO',
  topology: {
    legacyEndpoint: '127.0.0.1:3010',
    managedEndpoint: '127.0.0.1:3011',
    legacyNetNamespaceInode,
    managedNetNamespaceInode,
    nginxNetNamespaceInode,
    sameNetworkNamespace: true,
  },
  controlIsolation: {
    legacyPm2HomeId,
    managedPm2HomeId,
    homesDistinct: true,
    daemonPidsDistinct: true,
    namesDistinct: true,
    releasePathsDistinct: true,
    logPathsDistinct: true,
  },
  healthContract: {
    managedHealthUrl: 'http://127.0.0.1:3011/api/v1/health',
    legacyHealthProbeCountByReleaseTools: 0,
  },
  nginx: {
    binaryVersion,
    invalidCandidateTestExitCode,
    invalidCandidateReloadAttempted: false,
    observedTargetsAfterInvalidCandidate: ['legacy'],
    targetAfterInvalidCandidate: 'legacy',
    validCandidateTestExitCode: 0,
    observedTargetsAfterValidReload: ['managed'],
    targetAfterReload: 'managed',
    allOrNoneObserved: true,
  },
  releaseChain: {
    genesisStatus: 'PARALLEL_SERVING_R1',
    activatedReleaseId,
    failedReleaseError: 'RELEASE_PROVENANCE_ACTIVATION_ROLLED_BACK',
    currentAfterRollback,
    rollbackTarget: 'managed-previous-only',
    legacyFallbackAttempted: false,
  },
  resourceIsolation: {
    cgroupVersion: 'v2',
    engine: 'systemd',
    managedControlGroupId,
    managedDaemonControlGroupId,
    managedAppControlGroupId,
    effectiveMemoryMaxBytes,
    effectiveCpuQuotaPerSecUSec,
    effectiveTasksMax,
    effectiveLimitNOFILE,
    nrThrottledBefore,
    nrThrottledAfter,
    memoryMaxApplied: true,
    cpuQuotaApplied: true,
    tasksMaxApplied: true,
    nofileLimitApplied: true,
    pm2MemoryLimitOnlyRejected: true,
    cpuThrottlingObserved: true,
    legacyProbeFailuresUnderLoad: 0,
  },
  dataSafety: {
    productionCredentialsPresent: false,
    migrationExecuted: false,
    ddlExecuted: false,
    seedExecuted: false,
    secondWorkerStarted: false,
    cronOrSchedulerStarted: false,
    queueConsumerStarted: false,
  },
  recordedAt,
}
```

- [ ] `validateEvidence()` 必须从原始测量重新推导所有硬布尔值，再计算 verdict；caller 不可通过传入 `verdict: PASS` 或 sibling boolean 绕过失败字段。至少执行：

```text
sameNetworkNamespace := legacyInode === managedInode === nginxInode
homesDistinct := legacyPm2HomeId !== managedPm2HomeId
managedMembership := daemonControlGroupId === appControlGroupId === managedControlGroupId
memory/cpu/tasks/nofileApplied := effective kernel/systemd values are finite and equal approved drill values
cpuThrottlingObserved := nrThrottledAfter > nrThrottledBefore
allOrNoneObserved := observed response tags contain exactly one target before and exactly one target after reload
```

Evidence 中的布尔字段与原始测量推导不一致时必须拒绝，任一硬门槛失败时只允许 `D2_PRIME_NO_GO`。离线 verifier 要为每个“raw 值失败但 boolean 伪造为 true”的场景补负例。

- [ ] `.gitignore` 只忽略同目录 `.evidence/` 和 `.work/`；不得忽略脚本、schema 或 runbook。

```gitignore
/.evidence/
/.work/
```

- [ ] 运行 GREEN。

```bash
node services/api/scripts/d2-same-host/verify-contract.mjs
node --check services/api/scripts/d2-same-host/contract.mjs
node --check services/api/scripts/d2-same-host/verify-contract.mjs
```

Expected: 输出 `D2_PRIME_CONTRACT_ALL_PASS`；无 PM2/Nginx/systemd/network 调用。

- [ ] 只有上一步 GREEN 后，才在 `services/api/package.json` 注册 `verify:d2-same-host-contract` / `drill:d2-same-host`，并把 offline contract step 加入 CI；再次运行 package script，证明接线 commit 本身为绿。

```bash
pnpm --filter @ai-job-print/api verify:d2-same-host-contract
```

Expected: `D2_PRIME_CONTRACT_ALL_PASS`，CI 不引用缺失模块；full drill 仍不进入通用 CI。

- [ ] Commit.

```bash
git add services/api/scripts/d2-same-host/contract.mjs \
  services/api/scripts/d2-same-host/verify-contract.mjs \
  services/api/scripts/d2-same-host/.gitignore \
  services/api/package.json .github/workflows/ci.yml
git commit -m "feat: add D2 prime offline contract"
```

---

## Task 7：D2′ GREEN——实现 Linux preflight、双 PM2、真实 Nginx 与 managed cgroup 演练

**Files:** Create `services/api/scripts/d2-same-host/run.sh`, `services/api/scripts/d2-same-host/managed-scope.mjs`, `services/api/scripts/d2-same-host/drill.mjs`.

### 7.1 Linux wrapper 与硬前置

- [ ] `run.sh` 使用 `set -euo pipefail`，创建 repo-local ignored work/evidence 目录；任何缺失都写 `D2_PRIME_NO_GO <CODE>` 并 exit 2：
  - `uname -s` 必须为 `Linux`；
  - `/sys/fs/cgroup/cgroup.controllers` 存在；
  - `systemd-run --user` 或批准的非 root transient-unit path 可用且具备 delegation；
  - `nginx`、`node`、`pnpm`、`pm2` 可用；
  - `3010`、`3011` 与测试 Nginx listener 未被占用；
  - 不存在 `DATABASE_URL`、Redis/COS/OSS/云存储凭据等 production 数据变量；
  - 当前 Git tree 与 build 输入可识别，但脚本不得 push、SSH 或连接外部网络。

- [ ] `run.sh` 开头固定从自身绝对位置解析路径；后续不得依赖调用者 cwd：

```bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
ROOT="$(cd "$API_DIR/../.." && pwd)"
EVIDENCE_DIR="${D2_EVIDENCE_DIR:-$SCRIPT_DIR/.evidence}"
WORK_DIR="${D2_WORK_DIR:-$SCRIPT_DIR/.work}"
```

所有传给 Node/systemd/Nginx 的脚本、cwd、evidence 和 work 路径都从这些 canonical roots 构造。

- [ ] wrapper 用 `env -i` 构造最小环境，只传 `PATH`、隔离 `HOME`、证据/工作目录 ID 和明确的 drill flags；禁止把宿主完整 `process.env` 传给两套 PM2 daemon。

- [ ] runbook 和 wrapper 必须提供可复制的最低资格探针，并在任何进程启动前执行；不得在探针失败后自动 sudo、安装软件或修改宿主设置：

```bash
test "$(uname -s)" = Linux
test -r /sys/fs/cgroup/cgroup.controllers
systemctl --user show-environment >/dev/null
loginctl show-user "$(id -un)" -p Linger
systemd-run --user --wait --pipe --collect \
  --property MemoryMax=64M \
  --property CPUQuota=25% \
  --property TasksMax=16 \
  --property LimitNOFILE=256 \
  /usr/bin/true
nginx -v
pm2 -v
```

Expected: user bus 可达；headless 环境须由既有运维配置提供 `Linger=yes`，interactive 环境则须证明执行窗口内 user manager 持续有效；transient unit exit 0，且 `systemctl --user show` 能读取 effective `ControlGroup`/limit。任何一项失败均为 `D2_PRIME_NO_GO_ENVIRONMENT`；脚本不得自行执行 `loginctl enable-linger`。本地 VM/Colima 只有满足这些条件才可作为 D2′ 非生产 Linux 环境；不需要新云主机。

### 7.2 两套 PM2 环境与 managed systemd scope keeper

- [ ] 先固定两个不重叠的 canonical 目录和最小环境；release runtime contract 必须显式列出 `PATH`、`HOME`、`PM2_HOME`，不能只依赖 PM2 默认从 `HOME/.pm2` 推导：

```text
legacy CLI env:  HOME=<LEGACY_HOME>,  PM2_HOME=<LEGACY_PM2_HOME>,  PATH=<APPROVED_PATH>
managed CLI env: HOME=<MANAGED_HOME>, PM2_HOME=<MANAGED_PM2_HOME>, PATH=<APPROVED_PATH>
```

`drill.mjs` 自身用 managed 最小环境启动，使 `loadApprovedRuntimeEnvironment()` 为 Genesis/activation 加载的 `PM2_HOME` 与 keeper 完全一致；legacy 的 PM2 CLI 只能通过显式 `spawn` env override 使用 legacy 三项值。禁止在步骤间 mutation 全局 `process.env` 来切 daemon。

- [ ] legacy 启动顺序必须对称且明确：创建 legacy home/log workspace → 用 legacy explicit env 执行 `pm2 ping` → 用同一 env 启动 legacy `r0` stub/name → 读取 legacy daemon/app PID。managed 启动顺序为：创建 managed home/log workspace → transient unit 启动 keeper → keeper 用 managed explicit env 执行 `pm2 ping` → 写包含 daemon PID 摘要的 ready marker → orchestrator 才可调用 Genesis。

- [ ] `managed-scope.mjs` 只负责在 transient unit 内以 managed `HOME`/`PM2_HOME` 启动 PM2 daemon、写 ready marker、等待 stop marker，并在 finally 中用同一 explicit env 执行 `pm2 kill`。它不得启动 legacy、Nginx、数据库或 worker。

- [ ] keeper/orchestrator 握手固定为 nonce-scoped protocol：`<WORK_DIR>/<NONCE>/managed-ready.json` 由 keeper 以 `wx` 写入 `{schemaVersion:1, nonce, pm2HomeId, daemonPid}`；orchestrator 最多等待 15 秒，只接受 owned、非 symlink、普通文件、exact keys、nonce/home ID 匹配且 daemon PID 活跃。停止时 orchestrator 以 `wx` 创建 `<WORK_DIR>/<NONCE>/managed-stop`；keeper 最多在 15 秒内退出并 kill 自己的 daemon。超时、残留、字段错、PID 不活跃或 marker 已存在均为 NO-GO，禁止删除后重试掩盖事实。

- [ ] `run.sh` 以 transient unit 启动 keeper，并固定内核限制；具体数值属于非生产演练参数，必须在 runbook 中显式记录且不得冒充生产容量：

```bash
systemd-run --user \
  --unit "f1-d2-managed-${STAMP}" \
  --working-directory "${API_DIR}" \
  --setenv "HOME=${MANAGED_HOME}" \
  --setenv "PM2_HOME=${MANAGED_PM2_HOME}" \
  --setenv "PATH=${APPROVED_PATH}" \
  --property MemoryMax=<D2_MANAGED_MEMORY_MAX> \
  --property CPUQuota=<D2_MANAGED_CPU_QUOTA> \
  --property TasksMax=<D2_MANAGED_TASKS_MAX> \
  --property LimitNOFILE=<D2_MANAGED_NOFILE> \
  --collect \
  node "${API_DIR}/scripts/d2-same-host/managed-scope.mjs"
```

Expected: `systemctl --user show` 返回非空 `ControlGroup`，四项限制不是 infinity；managed PM2 daemon/app PID 均位于该 cgroup。若 user delegation 不可用，不得自动 sudo 或改宿主配置，直接 NO-GO。

### 7.3 同一 network namespace、合规 synthetic releases 与两套真实 PM2 daemon

- [ ] `drill.mjs` 必须 import Task 4 的 `../d2-release-fixture.mjs`，不得复制或自造 builder。每个 managed `r1/r2/r3` 都通过该 helper 生成完整 source tree、manifest/tree/archive/entrypoint artifact、release guard、stable launcher 副本和 SHA-256、runtime-env contract；真实 Genesis/activation 仍走现有 provenance verifier。旧 D2 抽取回归命令固定为 `pnpm --filter @ai-job-print/api drill:d2-docker`。

- [ ] legacy `r0` 是独立 synthetic PM2 app，health stub 固定 `.listen(3010, '127.0.0.1')`；managed `r1/r2/r3` 的 synthetic `main.js` 全部固定 `.listen(3011, '127.0.0.1')`。`r1/r2` 返回现有 `success/status/db=postgres` 合约，`r3` 返回明确不健康结果；这些 stub 不 import NestJS、Prisma、Redis、BullMQ 或任何业务模块。

- [ ] legacy 必须由独立 `LEGACY_PM2_HOME`/daemon/name/log path 启动；managed release tools 的 runtime-env contract 明确包含同一个 `MANAGED_PM2_HOME`，因此其 system runner 只连接 keeper 已启动的 managed daemon。断言两套 daemon PID、home ID、name、current/artifact/control/launcher/contract/log role 均不同。

- [ ] 用 `/proc/<pid>/ns/net` inode 证明 legacy、managed 与 Nginx 位于同一 network namespace；只保存 inode 数值，不保存 command line 或真实路径。

- [ ] 执行真实 `runReleaseGenesis()` 建立 managed `r1`，再真实 `activateRelease()` 到健康 `r2`。legacy stub 统计 header/tagged probe；release tools 对 `3010` 的 health 调用必须为 0。

### 7.4 真实 Nginx 全量不切/全切

- [ ] 用临时 prefix 启动真实 Nginx，初始配置 100% proxy 到 legacy `3010`；不读写 `/etc/nginx`，不绑定 80/443。

- [ ] 生成语法错误候选并运行真实 `nginx -t`。断言 exit non-zero、reload 调用计数为 0、通过测试 listener 的连续请求仍全部返回 legacy tag。

- [ ] 生成合法 managed-only 候选，真实 `nginx -t` exit 0 后原子替换 active config 并 reload。连续请求必须全部返回 managed tag；任何混合 tag、502 或目标不确定都 NO-GO。

- [ ] 写入 drill-local `CUTOVER_CONFIRMED` 状态后激活不健康 `r3`；真实 activation 必须返回 `RELEASE_PROVENANCE_ACTIVATION_ROLLED_BACK`，managed current 回到 `r2`，Nginx 仍指向 `3011`，legacy request count 不增加。

### 7.5 内核级资源争抢证明

- [ ] 在 managed cgroup 内启动 bounded CPU load，并采集 `cpu.stat` 前后差值；必须观察 `nr_throttled` 增加，证明 CPUQuota 实际执行。内存、TasksMax、NOFILE 通过 systemd/cgroup effective values 与子进程 membership 证明，不故意触发 OOM 或影响宿主。

- [ ] load 期间对 legacy Nginx path 执行固定次数、固定 timeout 的健康请求；硬判定为 0 failure/timeout。记录 baseline/load p50/p95 仅作证据，不写未经测量的生产 SLA，也不把非生产延迟阈值冒充 D3 容量结论。

- [ ] finally 必须只清理由本次 nonce 创建的 Nginx、两套 PM2 daemon、transient unit 与临时 workspace；不使用宽泛 glob，不触碰 production 或其他本地 PM2 home。证据 JSON 在 cleanup 前以 `wx` 写入，失败也输出 NO-GO 证据。

- [ ] `drill.mjs` 在打印 `D2_PRIME_PASS` 前必须把刚构造的 evidence 重新交给 `validateEvidence()`；validation failure 只能写 NO-GO evidence 并 exit 2。`verify-contract.mjs` 还必须支持 `--evidence <absolute-json-path>`，从磁盘独立读取、拒绝未知/缺失字段并再次调用同一 validator，防止 stdout verdict 自证。

- [ ] 在合格的 Linux 非生产环境运行 full drill。

```bash
pnpm --filter @ai-job-print/api build
D2_EVIDENCE_OUT="$(pwd)/services/api/scripts/d2-same-host/.evidence/review.json" \
  pnpm --filter @ai-job-print/api drill:d2-same-host
node services/api/scripts/d2-same-host/verify-contract.mjs \
  --evidence "$(pwd)/services/api/scripts/d2-same-host/.evidence/review.json"
```

Expected PASS evidence:

```text
D2_PRIME_PASS
productionF1=NO-GO
```

且 `.evidence/d2-prime-evidence-<UTC>.json` 通过 `validateEvidence()`。在 macOS、缺 systemd delegation、缺 Nginx 或只有 PM2 memory limit 的环境中，唯一合法结果是 `D2_PRIME_NO_GO`/exit 2；不得提供 skip-to-pass 开关。

- [ ] Commit scripts only after both offline contract and qualifying Linux full drill pass. If qualifying Linux is unavailable, commit candidate code may be reviewed, but Task 7 and D2′ status remain incomplete/NO-GO.

```bash
git add services/api/scripts/d2-same-host/run.sh \
  services/api/scripts/d2-same-host/managed-scope.mjs \
  services/api/scripts/d2-same-host/drill.mjs
git commit -m "feat: add same-host dual-port D2 prime drill"
```

---

## Task 8：修订正式 SSOT 与旧计划关系

**Files:** Modify `docs/device/production-deployment-runbook.md`, `docs/device/f1-d3-managed-topology-inputs.md`, `docs/device/f1-d3-managed-topology-approval-package.md`, `docs/device/f1-d2-docker-isolation-runbook.md`, `docs/superpowers/plans/2026-07-16-f1-parallel-genesis-bootstrap-implementation.md`; Create `docs/device/f1-d2-same-host-dual-port-runbook.md`.

- [ ] 新 D2′ runbook 写明：允许/禁止矩阵、Linux/cgroup/systemd/Nginx 前置、最小环境、精确命令、PASS/NO-GO 字段、证据白名单、cleanup、旧 D2 不可替代、无 production Docker/新云主机要求。

- [ ] 旧 D2 runbook 顶部增加关系说明：它仍是 provenance/rollback 基线，但没有同 namespace 双端口、双 PM2 daemon、真实 Nginx 和 managed cgroup 证据，不能形成 D2′ PASS。

- [ ] `production-deployment-runbook.md` §6.2 更新 future-only placeholder：
  - `<MANAGED_HOST_ID>` 改为同一 production host 的 managed 角色标识，不暗示新增主机；
  - legacy `3010` 与 managed `3011` 并列说明；
  - `--health-url` 只为 `http://127.0.0.1:3011/api/v1/health`；
  - 独立 Linux account、`PM2_HOME`/daemon/name/log/current/artifact/control/launcher/contract；
  - D5 前 100% legacy，D3 固定 approved legacy Nginx config SHA 作为未确认切流恢复目标；
  - D5 确认后 managed-only rollback；
  - 不提供或执行真实 production 值。

- [ ] `f1-d3-managed-topology-inputs.md` 保持 B1–B9 为唯一 SSOT，并修订/新增字段：
  - B1 title 改为“同机 managed 角色与固定双端口”；B1.1 `<UNSET>` 表示同一 host 的 managed role；B1.2 固定 `3011`；B1.3 要求 `3010/3011` 同机并存、loopback-only、D2′ evidence ref；
  - B2 新增 managed `PM2_HOME`/daemon/dump/log isolation evidence；
  - B8 新增 D5 前 100% legacy、approved legacy Nginx config SHA、shared data side-effect/connection budget、host capacity/cgroup plan 的只读字段；
  - B9 明确 legacy/deploy/managed runtime 账户边界；
  - 总体判定仍全部 `NO-GO / UNSET`，D1′/D2′ 不得填猜测的生产值。

- [ ] approval package 只更新签批范围和同机措辞，不复制 B1–B9 技术值：B1–B4 由运维/安全联合复核同机隔离；B8 签批覆盖 Nginx pre-cutover SHA、数据副作用/连接预算和资源门禁。

- [ ] 在旧 2026-07-16 implementation plan 标题下加入 supersession note，指向新设计和本计划；正文保留历史，不逐段改写。

- [ ] 文档静态验证要按语义分类，不能要求仓库全局零 `3010`，因为 legacy 和历史 preproduction 文档仍合法。

```bash
rg -n 'managed.*3010|3010.*managed|独立 managed 主机|禁止同机第二端口|私增第二端口' \
  docs/device/production-deployment-runbook.md \
  docs/device/f1-d3-managed-topology-inputs.md \
  docs/device/f1-d3-managed-topology-approval-package.md \
  docs/device/f1-d2-docker-isolation-runbook.md \
  docs/device/f1-d2-same-host-dual-port-runbook.md \
  docs/superpowers/plans/2026-07-16-f1-parallel-genesis-bootstrap-implementation.md
```

Expected: 不再存在未标记为 superseded 的 managed `3010`/独立主机要求；legacy `3010` 与“旧 D2 不替代 D2′”说明可保留。

- [ ] Commit docs.

```bash
git add docs/device/production-deployment-runbook.md \
  docs/device/f1-d3-managed-topology-inputs.md \
  docs/device/f1-d3-managed-topology-approval-package.md \
  docs/device/f1-d2-docker-isolation-runbook.md \
  docs/device/f1-d2-same-host-dual-port-runbook.md \
  docs/superpowers/plans/2026-07-16-f1-parallel-genesis-bootstrap-implementation.md
git commit -m "docs: revise F1 runbooks for same-host dual-port"
```

---

## Task 9：进度、全量验证、三模型审查与 Loop 收口

**Files:** Modify `docs/progress/current-progress.md`, `docs/progress/next-tasks.md`; create/update active `.ccg/tasks/<task>/review.md` and archive metadata per CCG.

- [ ] progress 只记录已实际完成并有 fresh evidence 的事实：
  - 若 D1′ 代码/fixtures/CI/docs 全绿，可记录 D1′ PASS；
  - 只有 qualifying Linux full drill evidence 通过，才记录 D2′ PASS；
  - 若 full drill 未运行或环境前置缺失，必须记录 D2′ NO-GO/blocked，不能写“代码已具备所以完成”；
  - 无论 D1′/D2′ 结果如何，production F1、D3–D6 继续 NO-GO/未授权。

- [ ] 运行 fresh local verification。

```bash
pnpm --filter @ai-job-print/api verify:release-provenance
pnpm --filter @ai-job-print/api verify:release-genesis
pnpm --filter @ai-job-print/api verify:d2-same-host-contract
pnpm --filter @ai-job-print/api typecheck
pnpm --filter @ai-job-print/api lint
pnpm --filter @ai-job-print/api build
git diff --check
git status --short
```

Expected: 全部 exit 0；status 只含计划文件和 CCG ignored metadata。若本机具备 Docker/Colima，再复跑 `drill:d2-docker`；它不是 D2′ 替代品。

- [ ] 在 qualifying Linux 非生产环境重新运行 full drill，并用显式证据路径独立复核，而不是复用旧 stdout。

```bash
D2_EVIDENCE_OUT="$(pwd)/services/api/scripts/d2-same-host/.evidence/final-review.json" \
  pnpm --filter @ai-job-print/api drill:d2-same-host
node services/api/scripts/d2-same-host/verify-contract.mjs \
  --evidence "$(pwd)/services/api/scripts/d2-same-host/.evidence/final-review.json"
```

Expected: fresh `D2_PRIME_PASS` JSON；Nginx/cgroup/namespace/PM2/dataSafety/releaseChain 硬字段全满足。否则记录 `D2_PRIME_NO_GO` 并停止进入 D3。

- [ ] 先做 Codex 本地 diff 审查，再并行请求 Claude + Antigravity review，随后请 Cursor 独立 review。三者至少分别聚焦：
  - Claude：fail-closed ordering、provenance/Genesis/activation、managed-only rollback、evidence spoofing；
  - Antigravity：Linux/systemd/cgroup、双 PM2、真实 Nginx all-or-none、cleanup/resource contention；
  - Cursor：file budget、fixture/CI/runbook SSOT、残留 `3010` 语义、实现可维护性。

- [ ] 合并去重写入 `.ccg/tasks/<task>/review.md`。任一 Critical/High 或未关闭 Warning：回到对应 Task 补 RED、修复、重跑全部 fresh checks、重新三模型 review；不得仅写“已知问题”。

- [ ] 检查是否有值得沉淀到 `.ccg/spec/backend/index.md` 或 `.ccg/spec/guides/index.md` 的非显而易见规则；只有确有新规则才追加，避免重复本计划。

- [ ] 更新 CCG task 为 completed，归档到 `.ccg/tasks/archive/YYYY-MM/`，force-add ignored task metadata，并完成最终 commits。

```bash
git add docs/progress/current-progress.md docs/progress/next-tasks.md
git commit -m "docs: record F1 D1 prime and D2 prime status"

mkdir -p .ccg/tasks/archive/$(date +%Y-%m)
mv .ccg/tasks/<task> .ccg/tasks/archive/$(date +%Y-%m)/
git add -f .ccg/tasks/archive/$(date +%Y-%m)/<task>
git commit -m "chore: archive ccg task <task>"
```

Expected final state: working tree clean；D1′/D2′ 的真实状态、证据和 NO-GO 边界一致；没有 push、PR、merge 或 production action，除非用户另行明确授权。

---

## 10. D2′ 硬 NO-GO 清单

出现任一项即停止本 Loop，不进入 D3：

1. runtime/fixture/SSOT 仍把 managed health 指向 `3010`，或接受 `3010/3011` 双值；
2. Genesis/activation 的 URL 拒绝发生在 PM2/current/health 动作之后；
3. D2′ 没有同一 network namespace 内同时在线的 legacy `3010` 和 managed `3011`；
4. 两链复用 `PM2_HOME`、daemon、name、current、artifact、control、launcher、contract 或 logs；
5. Nginx 只做字符串/fake 验证，未执行真实 `nginx -t` 和 reload；
6. invalid candidate 后发生 reload，或有效切流出现 mixed/partial target；
7. `CUTOVER_CONFIRMED` 后出现任何 legacy fallback/previous/rollback；
8. 缺 cgroup v2/systemd delegation，或仅凭 PM2 memory restart/容器总内存声称隔离；
9. managed load 未观察到内核 throttling，或 legacy probe 在 load 期间失败；
10. 演练携带 production DB/Redis/COS 凭据，执行 migration/DDL/seed，或启动第二 worker/cron/consumer；
11. evidence 含真实秘密、环境值、完整 path、PM2 dump、日志正文、header、用户或业务数据；
12. 把旧 D2、macOS skip、CI offline contract 或代码 review 当成 full D2′ PASS；
13. 为让演练通过而停止、改端口、reload 或重命名真实 legacy；
14. 任何步骤需要 SSH、production PM2/Nginx、生产数据平面或 D3–D6 动作。
