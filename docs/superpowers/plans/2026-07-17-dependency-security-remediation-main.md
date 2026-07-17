# Dependency Security Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在最新主线关闭 `pnpm audit --audit-level=high` 的 1 个 critical / 3 个 high，并实际拒绝所有上传入口的嵌套 multipart 字段。

**Architecture:** `shell-quote`、`hono`、`vite` 通过最小 manifest / override / lockfile 升级收敛。`multer` 除升级到 2.2.0 外，所有 10 个 `FileInterceptor` 显式配置 `limits.fieldNestingDepth: 0`；因为 API 的 multipart DTO 均为平坦字段或无 body，零深度是可兼容的最小业务边界。新增本地 HTTP middleware 验证同时证明平坦字段继续通过、一个 bracket 字段被拒，并静态锁定 10 个入口，接入现有 SQLite CI verify 段。

**Tech Stack:** pnpm lockfile v9、Node 22 native `fetch` / `FormData`、Multer 2.2.0、NestJS 11 `FileInterceptor`、GitHub Actions。

---

## 固定事实与范围

- 基线：最初在 `origin/main@f69bf1b7` 复现审计问题；实施前已快进到 `origin/main@30d168ce`，并重新确认 `shell-quote@1.8.3`、`hono@4.12.23`、`multer@2.1.1`、`vite@6.4.2` 仍受影响。
- 补丁最低版本：`shell-quote@1.8.4`、`hono@4.12.25`、`multer@2.2.0`、`vite@6.4.3`。
- `@nestjs/platform-express@11.1.24` 精确依赖 `multer@2.1.1`，所以 `multer` 必须同时作为 direct dependency 和 pnpm override 收敛到 `2.2.0`。
- Multer 2.2.0 仅在 `limits` 显式有 `fieldNestingDepth` 时拒绝嵌套字段；Nest 的 local `limits` 会浅覆盖 global `limits`，因此不使用全局兜底或混合策略。
- 不改 API 请求字段、数据库、业务服务、终端或生产配置；不部署。

### Task 1: 安装基线并写入可失败的专项 verify

**Files:**

- Create: `services/api/scripts/verify-multipart-field-nesting.ts`
- Modify: `services/api/package.json`

- [x] **Step 1: 安装锁定的基线依赖。**

Run: `pnpm install --frozen-lockfile`

Expected: exit 0，`git status --short` 不出现 tracked 文件改动。

- [x] **Step 2: 先新增 failing verify。**

在 `services/api/package.json` 的 scripts 中加入：

```json
"verify:multipart-field-nesting": "node -r @swc-node/register scripts/verify-multipart-field-nesting.ts"
```

脚本以 TypeScript Compiler API 扫描 `services/api/src/**/*.ts`，全局计数必须恰为 10，并按下列路径计数；对每个实际 `FileInterceptor` 调用，第二参数、直接 `limits` 属性和直接数值 `fieldNestingDepth: 0` 都必须存在。该 AST 校验允许括号与 `as` 等表达式包装，但不接受注释、字符串或嵌套对象的同名字段，避免正则误报：

```ts
const CONTROLLERS = [
  ['../src/ai/ai.controller.ts', 1],
  ['../src/content/content.controller.ts', 1],
  ['../src/mock-interview/mock-interview.controller.ts', 1],
  ['../src/scan-tasks/scan-tasks.controller.ts', 1],
  ['../src/files/files.controller.ts', 2],
  ['../src/upload-sessions/upload-sessions.controller.ts', 1],
  ['../src/jobs/admin-fairs.controller.ts', 1],
  ['../src/jobs/jobs.controller.ts', 2],
] as const

for (const [relativePath, expectedCount] of CONTROLLERS) {
  assert.equal(fileInterceptorCallsInAst(relativePath).length, expectedCount, `${relativePath}: interceptor count drifted`)
  assert.ok(allCallsHaveDirectFieldNestingDepthZero(relativePath), `${relativePath}: every FileInterceptor must reject nested fields`)
}
```

同一脚本在 loopback `http.createServer` 上以 `multer({ limits: { fieldNestingDepth: 0 } }).single('file')` 建立临时 middleware：附一个小 PDF Blob 的平坦 `uploadToken` form 必须返回 204；同一文件加 `meta[nested]` 必须令 middleware 产出 `LIMIT_FIELD_NESTING` 并返回 400。服务器用 `listen(0, '127.0.0.1')`，`finally` 中关闭。

- [x] **Step 3: 运行 RED。**

Run: `pnpm --filter @ai-job-print/api verify:multipart-field-nesting`

Expected: 当前所有 controller 均未含 `fieldNestingDepth: 0`，脚本因静态边界断言失败；这证明应用配置尚未关闭漏洞。

### Task 2: 在全部上传入口实施最小限深

**Files:**

- Modify: `services/api/src/ai/ai.controller.ts:306`
- Modify: `services/api/src/content/content.controller.ts:75`
- Modify: `services/api/src/mock-interview/mock-interview.controller.ts:142`
- Modify: `services/api/src/scan-tasks/scan-tasks.controller.ts:74`
- Modify: `services/api/src/files/files.controller.ts:105,131`
- Modify: `services/api/src/upload-sessions/upload-sessions.controller.ts:65`
- Modify: `services/api/src/jobs/admin-fairs.controller.ts:162`
- Modify: `services/api/src/jobs/jobs.controller.ts:490,501`

- [x] **Step 1: 保留每个既有 fileSize，并在同一个 limits object 中加 `fieldNestingDepth: 0`。**

例如：

```ts
@UseInterceptors(FileInterceptor('file', { limits: { fileSize: UPLOAD_HARD_LIMIT, fieldNestingDepth: 0 } }))
```

`ai` / `mock-interview` / `scan-tasks` / `upload-sessions` / `admin-fairs` 同型。不得改变 field name、Throttle、guard、file filter 或业务 DTO。

- [x] **Step 2: 为原来无 options 的 4 个入口只加入该限深。**

```ts
@UseInterceptors(FileInterceptor('file', { limits: { fieldNestingDepth: 0 } }))
```

适用 `files.controller.ts` 两处与 `jobs.controller.ts` 两处。不得顺手添加 fileSize：该 OOM 风险另立任务，避免不经产品文件上限确认而改变业务行为。

- [x] **Step 3: 再跑专项 verify，记录第二个 RED。**

Run: `pnpm --filter @ai-job-print/api verify:multipart-field-nesting`

Expected: 静态 10 处断言转绿，但仍解析旧 `multer@2.1.1`，嵌套字段会错误返回 204；这证明代码配置本身不足、必须升级解析库。

### Task 3: 收敛四个 advisory 的 manifest 与 lockfile

**Files:**

- Modify: `package.json`
- Modify: `pnpm-workspace.yaml`
- Modify: `apps/admin/package.json`
- Modify: `apps/kiosk/package.json`
- Modify: `apps/partner/package.json`
- Modify: `services/api/package.json`
- Modify: `pnpm-lock.yaml`

- [x] **Step 1: 同步两个 pnpm override 镜像。**

保留 `qs`、`@hono/node-server`、`uuid`，并在两处加入精确值：

```json
"shell-quote": "1.8.4",
"hono": "4.12.25",
"multer": "2.2.0"
```

```yaml
shell-quote: 1.8.4
hono: 4.12.25
multer: 2.2.0
```

- [x] **Step 2: 提高 direct dependency 下限。**

```json
// apps/admin, apps/kiosk, apps/partner
"vite": "^6.4.3"

// services/api
"multer": "^2.2.0"
```

- [x] **Step 3: 使用 pnpm 重解并验证 lockfile。**

Run:

```bash
pnpm install
pnpm install --offline --frozen-lockfile
pnpm why shell-quote hono multer vite --depth 8
pnpm audit --audit-level=high
```

Expected: 每个目标包只解析到修复版本；audit exit 0，若出现任何新的 high/critical 则停止并重新审查。`pnpm-lock.yaml` 不得再含 `shell-quote@1.8.3`、`hono@4.12.23`、`multer@2.1.1` 或 `vite@6.4.2`。

### Task 4: 让 RED 用例转 GREEN 并接入现有 CI

**Files:**

- Modify: `services/api/scripts/verify-multipart-field-nesting.ts`
- Modify: `.github/workflows/ci.yml`

- [x] **Step 1: 运行专项 verify。**

Run: `pnpm --filter @ai-job-print/api verify:multipart-field-nesting`

Expected: 平坦 form 204；`meta[nested]` 400 且 middleware code 为 `LIMIT_FIELD_NESTING`；静态检查恰好锁定 10 个 `FileInterceptor`。

- [x] **Step 2: 将它加入 SQLite `Verify suites`。**

在 `.github/workflows/ci.yml` 的 `build-and-verify` -> `Verify suites` 中、现有 `verify:upload-sessions` 前加入：

```yaml
pnpm --filter @ai-job-print/api verify:multipart-field-nesting
```

该 verifier 不连接数据库、Redis、外部服务或生产，故不加到 PostgreSQL job。

- [x] **Step 3: 检查脚本不会泄漏为生产行为。**

Run: `git diff --check && rg -n "fieldNestingDepth|verify:multipart-field-nesting" services/api .github/workflows/ci.yml`

Expected: 仅安全限深与 verify/CI 接线变化，无凭据、生产 URL 或真实用户数据。

### Task 5: 回归、复审与交付

**Files:**

- Modify: `docs/progress/current-progress.md`
- Modify: `docs/progress/next-tasks.md`
- Modify: `.ccg/tasks/dependency-security-remediation-main-20260716/*`

- [ ] **Step 1: 跑受影响面回归。**

Run:

```bash
pnpm --filter @ai-job-print/api typecheck
pnpm --filter @ai-job-print/api lint
pnpm --filter @ai-job-print/api verify:upload-sessions
pnpm --filter @ai-job-print/api verify:kiosk-upload-print-contract
pnpm --filter @ai-job-print/api verify:print-jobs
VITE_API_MODE=http VITE_API_BASE_URL=/api/v1 VITE_USE_TRTC_CALL=true VITE_TERMINAL_ID=KSK-001 pnpm build:kiosk:production
VITE_API_MODE=http VITE_API_BASE_URL=/api/v1 pnpm --filter @ai-job-print/admin build
VITE_API_MODE=http VITE_API_BASE_URL=/api/v1 pnpm --filter @ai-job-print/partner build
```

Expected: 全部 exit 0；不启动持久服务、不连接生产、不发送短信。

执行记录：除 `verify:print-jobs` 外均已本地通过。该脚本需要由 Prisma 为临时 SQLite 建 schema；在本机 macOS 上，API workspace 的 Prisma 7.8.0 Schema Engine 对一个已正确加载的全新临时 datasource 持续只返回通用 `Schema engine error`，这是本补丁前已记录的本地环境限制，未进入验证脚本，也未产生生产/真实打印副作用。不得以变更 schema、迁移或生产数据库绕过；保留此项由 PR 的 Linux SQLite CI（其先 `prisma db push`）执行。

- [ ] **Step 2: 双模型终审实际 diff。**

要求 Antigravity Opus 4.6 与 Claude 同时审查：override 双写、锁文件漂移、Multer 10 处全覆盖、flat form 正常、nested form 拒绝、CI 仅增加专项守卫、无 API/生产副作用。Critical 必须为 0；任何 Warning 必须评估或修复后重审。

- [ ] **Step 3: 同步进度、归档任务并提交。**

仅在 audit 和相关回归通过后，明确记录“依赖审计 P0 已清零但未部署”，归档 CCG task，并限定 staged 文件为计划列出的依赖、上传入口、verify、CI、进度与归档。提交信息：

```bash
git commit -m "fix: close dependency audit and multipart nesting guard"
```

## 计划自审

- 覆盖 4 个 advisory 的依赖路径、版本下限、锁解析和最终 audit。
- 关闭 10 个真实上传入口的 Multer 运行时 DoS，并以平坦/嵌套两类 multipart 证明行为。
- 不改数据库、业务 API、Nest/Prisma 主版本、终端或生产；CI 仅加入本次独立 verify。
- 无未定项或占位步骤；每次写代码前先使专项 verify 在当前状态失败。
