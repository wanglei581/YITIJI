# CI 门禁豁免清理待办清单（2026-09-02）

> **执行授权声明**
> 本清单全部条目落在 `apps/kiosk/`、`apps/admin/`、`services/api/`、根 `scripts/` 以及豁免表
> `scripts/ci-gate-exemptions.json` 本身，**均不在小程序（`apps/miniapp/**`）lane 内**。
> 小程序 lane 无权改动其中任何一个文件。**本清单需要产品负责人指派或授权后才能执行。**
>
> 本文档记录的**全部是尚未执行的待办**。文中不存在"已修复 / 已完成"的条目；
> 每条的"当前状态"描述的是 2026-09-02 复核时刻的仓库事实，不代表已被处理。

---

## 0. 复核范围与取证方法

### 0.1 豁免声明在哪里

从 `scripts/verify-ci-gate-coverage.mjs` 反查，CI 门禁豁免声明在**唯一一个文件**里：

| 项 | 值 |
| --- | --- |
| 豁免表文件 | `scripts/ci-gate-exemptions.json`（89 行） |
| 读取方 | `scripts/verify-ci-gate-coverage.mjs:46`（`exemptionsPath`）、`:311`（`readFileSync` 解析） |
| 校验元门禁 | 根包 `verify:ci-gate-coverage`（`package.json:26`） |
| 在 CI 的挂载点 | `.github/workflows/ci.yml:78-82`，步骤名 `Repository integrity gate` |

该表分**两节**，由元门禁的不同段落分别守护：

| 节 | JSON 键 | 守的是什么 | 元门禁段落 | 棘轮上限 |
| --- | --- | --- | --- | --- |
| 豁免表 | `exemptions`（6 条） | 已在 `package.json` 声明脚本名、但不进 CI 的门禁 | B 段（`verify-ci-gate-coverage.mjs:87-388`） | `MAX_PENDING = 1`（`:309`），当前 pending **0** 条 |
| 未接线脚本表 | `unwiredScripts`（3 条） | `scripts/` 下有门禁脚本文件、却没有任何 `package.json` 脚本名指向它 | C 段（`verify-ci-gate-coverage.mjs:390-484`） | `MAX_UNWIRED = 3`（`:431`），当前 **3** 条，**已满格** |

合计 **9 条豁免条目**，本次逐条复核。

### 0.2 复核时的仓库状态

```
$ node scripts/verify-ci-gate-coverage.mjs
OK: 16 deterministic CI gates are directly executed; 371/377 verify/ui 门禁在 CI 执行闭包内，
6 条已登记豁免（其中 0 条待接线，上限 1）；169 个门禁脚本文件中 3 个无脚本名（全部已登记，上限 3）
```

元门禁本身当前**是绿的**。因此下列全部问题都是**潜伏欠账**，不是正在红的构建 ——
这也意味着不会有人被 CI 逼着去看它们，只能靠本清单主动排期。

### 0.3 分类口径

| 类 | 含义 |
| --- | --- |
| **A** | 豁免理由与事实不符 —— 理由描述的原因不成立，会把接手人送去修错的东西 |
| **B** | 理由当初成立但已过期 —— 阻塞条件已消失，现在可以取消豁免 |
| **C** | 理由成立且仍然成立 —— 不用动，但要写清"为什么现在还不能取消" |
| **D** | 门禁本身有 bug —— 在跑但断言不到东西（假绿） |

---

## 1. 结论速览

| 类别 | 条数 | 条目 |
| --- | --- | --- |
| **A 类｜理由与事实不符** | **2** | A-1 `verify-jobfairs-terminal-priority.mjs`（kiosk）<br/>A-2 `verify-self-assessment-r3-pick.mjs`（根 scripts） |
| **B 类｜理由已过期** | **2** | B-1 `ENFORCED_PREFIXES` 阻塞条件已解除（根 scripts，豁免机制本身）<br/>B-2 `packages/refresh` 从未进 CI typecheck（根 ci.yml） |
| **C 类｜仍然成立** | **6** | C-1 ~ C-5：`services/api` 的 5 条 live-credentials / running-server 豁免<br/>C-6 `verify-partner-account-delete-ui.mjs`（admin，结论成立但**理由有两处事实偏差**，见 §4.6） |
| **D 类｜门禁假绿** | **0 条已确认** | 项目图谱标出的 3 个"断言了不存在的路径"逐个查证后**均不构成假绿**，见 §5 |

> **A 类 2 条全部落在 `unwiredScripts` 节**，且**两条的 `category` 都被登记成 `broken-pending-fix`（"功能确实没实现"）**，
> 而实测两条对应的功能**都已实现并合入 `main`**。这不是巧合，是同一个误判模式重复了两次：
> **把"门禁跑红"直接当成"功能没做"，没有反向核实门禁自身是否过期。**

---

## 2. A 类｜理由与事实不符（最高优先，2 条）

### A-1　`verify-jobfairs-terminal-priority.mjs`：豁免理由把因果**写反了**

| 项 | 值 |
| --- | --- |
| **归属** | `apps/kiosk/`（门禁脚本） + 根 `scripts/`（豁免表条目） |
| **豁免条目** | `scripts/ci-gate-exemptions.json:78-82` |
| **登记类别** | `broken-pending-fix`（`:80`） |
| **门禁脚本** | `apps/kiosk/scripts/verify-jobfairs-terminal-priority.mjs`（53 行） |
| **被断言的页面** | `apps/kiosk/src/pages/job-fairs/JobFairsPage.tsx` |

#### 豁免表当前写的（`scripts/ci-gate-exemptions.json:81`）

> "实跑 4 条断言中 3 PASS 1 FAIL：第 3 条「getJobFairs 未按 terminalId 透传参数」不成立 ——
> **页面读了 terminalId 却没把它传进请求。这是真实的功能缺口，不是门禁写错。**
> 接线前须先补上透传，否则 CI 直接红。"

#### 实测事实：**功能是完整的，坏的是门禁的正则**

页面**确实把 terminalId 传进了请求**，而且端到端一路通到数据库排序：

| 环节 | 文件:行 | 实际代码 |
| --- | --- | --- |
| ① 页面读取 | `apps/kiosk/src/pages/job-fairs/JobFairsPage.tsx:210` | `const terminalId = getTerminalId()` |
| ② 页面透传 | `apps/kiosk/src/pages/job-fairs/JobFairsPage.tsx:212-213` | `getJobFairs({`<br/>`  ...(terminalId ? { terminalId } : {}),` |
| ③ adapter 落到 query | `apps/kiosk/src/services/api/httpAdapter.ts:250` | `if (params?.terminalId) query.terminalId = params.terminalId` |
| ④ 后端接参 | `services/api/src/jobs/jobs.controller.ts:151,156` | `@Query('terminalId') terminalId?: string` → `getPublishedFairs({ ..., terminalId })` |
| ⑤ 后端本校优先排序 | `services/api/src/jobs/jobs-kiosk.service.ts:143`、`:145-150` | `const preferredOrgId = await this.resolveCampusPreferredOrgId(params?.terminalId)`<br/>→ `buildPublishedFairGroups({ ..., preferredOrgId })` |

**门禁失败的真正原因**：断言 3 的正则（`verify-jobfairs-terminal-priority.mjs:36`）要求的是一个**逐字字面形式**：

```js
if (/getJobFairs\(\s*terminalId\s*\?\s*\{\s*terminalId\s*\}\s*:\s*undefined\s*\)/.test(src)) {
```

即只接受 `getJobFairs(terminalId ? { terminalId } : undefined)` 这一种写法。

而 `JobFairsPage.tsx` 在提交 **`6210efa07`**（`fix(api): 招聘会列表结构性缺陷 —— 筛选下推 / 服务端检索 / 默认排序 (#652)`）
里被重构，为了同时下推 `status` / `keyword` / `pageSize`，调用形态从"单参三元表达式"改成了"对象字面量 + 展开"：

```js
getJobFairs({
  ...(terminalId ? { terminalId } : {}),
  ...(statusFilter === '全部' ? {} : { status: STATUS_FILTER_MAP[statusFilter] }),
  ...(debouncedQuery ? { keyword: debouncedQuery } : {}),
  pageSize: 100,
})
```

**门禁写于 `069283040`（`fix: prioritize local school fairs on kiosk list`，2026-06-21），
重构发生在其后，门禁正则没跟着改。** 这是典型的正则过期，不是功能缺口。

#### 三条独立旁证

1. **同一份代码里保留着门禁期待的旧写法**——说明旧写法不是"错的"，只是 `JobFairsPage` 换了形态：
   - `apps/kiosk/src/pages/campus/CampusPage.tsx:175`：`getJobFairs(terminalId ? { terminalId } : undefined)`
   - `apps/kiosk/src/pages/home/hooks/useHomeJobFairHighlight.ts:42`：同上
2. **项目自己的进度文档写着这条已交付**——`docs/progress/next-tasks.md:719`
   ("`JobFairsPage` 调用 `getTerminalId()` 并透传 …… 新增 `verify-jobfairs-terminal-priority` 防回退脚本")。
3. **另外 3 条断言全 PASS**，其中断言 1（引入 `getTerminalId`）和断言 2（请求前读取 `terminalId`）
   已经证明页面拿到了 terminalId——若真是"读了没传"，断言 3 的 FAIL 才有意义；
   但实际代码第 213 行就在第 210 行下面三行，肉眼可见传了。

#### 危害

这条**会直接把接手人送去"修一个没坏的东西"**：按豁免表的指引，
接手人会去 `JobFairsPage.tsx` 找"读了却没传"的 bug，而那个 bug 不存在。
在找不到之后，最可能的错误动作是**把已经工作的展开式调用改回旧的三元式写法**去迎合正则——
那会把 `#652` 的筛选下推能力（status / keyword / pageSize）一起改坏，
制造一个真实的功能回退。**这是本清单里唯一一条"照做会引入新缺陷"的条目。**

#### 修复步骤（可直接照做）

**Step 1 — 修门禁正则**（文件：`apps/kiosk/scripts/verify-jobfairs-terminal-priority.mjs`，第 36 行）

把：

```js
if (/getJobFairs\(\s*terminalId\s*\?\s*\{\s*terminalId\s*\}\s*:\s*undefined\s*\)/.test(src)) {
```

改为（同时接受"三元式"和"对象展开式"两种透传形态）：

```js
if (
  /getJobFairs\(\s*(?:terminalId\s*\?\s*\{\s*terminalId\s*\}\s*:\s*undefined|\{[\s\S]*?\.\.\.\(\s*terminalId\s*\?\s*\{\s*terminalId\s*\}\s*:\s*\{\}\s*\))/.test(src)
) {
```

> 该替换正则已实测：对 `JobFairsPage.tsx` / `CampusPage.tsx` / `useHomeJobFairHighlight.ts` 三处真实调用点全部 MATCH；
> 对反例 `getJobFairs()` 和 `getJobFairs({ pageSize: 100 })`（无 terminalId）全部 NOMATCH，未放宽成恒真。
> 第 42 行的断言 4（`/getJobFairs\(\s*\)/` 必须不匹配）保持不变，当前已 PASS。

**Step 2 — 验证门禁转绿**

```bash
node apps/kiosk/scripts/verify-jobfairs-terminal-priority.mjs
# 期望：4 条断言全 PASS，输出 "=== ALL PASS ==="，exit 0
```

**Step 3 — 起脚本名并接进 CI**（这条门禁从写完那天起就没跑过）

- `apps/kiosk/package.json` 的 `scripts` 加一行：
  ```json
  "verify:jobfairs-terminal-priority": "node scripts/verify-jobfairs-terminal-priority.mjs"
  ```
- `.github/workflows/ci.yml` 在已有 kiosk 门禁批次里加一行：
  ```
  pnpm --filter @ai-job-print/kiosk verify:jobfairs-terminal-priority
  ```
  （纯静态读文件门禁，**无 Prisma 依赖**，不受 `verify-ci-gate-coverage.mjs:512-514` 提示的
  "必须排在 Prepare fresh SQLite db 之后"约束，位置自由。）

**Step 4 — 从 `unwiredScripts` 摘掉这条并降棘轮**（文件：`scripts/ci-gate-exemptions.json`）

- 删除 `:78-82` 整条条目（不删会被元门禁 `verify-ci-gate-coverage.mjs:471-476` 判为
  "条目已陈旧（该脚本已有 package.json 脚本名，请删除本条）"而报红）。
- 把 `MAX_UNWIRED` 从 `3` 降到 `2`（`scripts/verify-ci-gate-coverage.mjs:431`）——
  该上限**只允许调低**（`:429-430` 明写），还掉一条就降一格。

**Step 5 — 重跑元门禁与图谱**

```bash
node scripts/verify-ci-gate-coverage.mjs   # 期望 OK，"3 个无脚本名" 变为 "2 个"
pnpm graph                                  # 门禁 / 孤儿清单是自动产物，需重算
```

---

### A-2　`verify-self-assessment-r3-pick.mjs`：类别与理由都写错，且**结构上不可能接线**

| 项 | 值 |
| --- | --- |
| **归属** | 根 `scripts/` |
| **豁免条目** | `scripts/ci-gate-exemptions.json:83-87` |
| **登记类别** | `broken-pending-fix`（`:85`）——"门禁断言的功能确实没实现" |
| **门禁脚本** | `scripts/verify-self-assessment-r3-pick.mjs`（76 行） |

#### 豁免表当前写的（`scripts/ci-gate-exemptions.json:86`）

> "职业测评 R3 选题门禁。实跑直接抛 ERR_ASSERTION 退出，断言未通过。……
> **接线前须先查清断言与当前实现的差异。**"

#### 实测事实：三处不符

**① 类别 `broken-pending-fix`（"功能确实没实现"）不成立——功能已实现并合入 `main`。**

该脚本断言的对象是 PR **#486** 的自评修复。实测：

```
$ git merge-base --is-ancestor 03c30bdcd origin/main  → YES
$ git log --oneline -1 03c30bdcd
03c30bdcd fix(self-assessment): v1 三模型审查收尾 — 7 项 Critical 修复 (#486)
```

它断言必须被改动的文件也都在 `main` 里（抽查 4 个，全部 `IN MAIN`）：
`services/api/src/ai/resume/self-assessment.service.ts`、
`services/api/src/ai/resume/career-plan.service.ts`、
`services/api/src/files/file-validation.ts`、
`docs/reviews/2026-08-02-self-assessment-v1-three-model-review.md`。

**② 它不是功能门禁，是 PR #486 的一次性"分支历史守卫"。** 脚本自己的文件头写得很清楚
（`scripts/verify-self-assessment-r3-pick.mjs:3-9`）：

> "Verify self-assessment-staged-cleanup-r3 实质 commit 还在 cherry-pick 链路上。……
> 用于 **PR #486 CI 漂移时本地兜底**"

它不读任何业务源码，只跑 `git log`——断言的是"当前分支相对 `main` 的增量提交里有某个 commit"。

**③ 它在结构上永远无法进 CI。** 核心逻辑（`:31-36`）：

```js
const MERGE_BASE = git(['merge-base', 'HEAD', 'origin/main'])
const log = git(['log', '--pretty=format:%H|%s', `${MERGE_BASE}..HEAD`])
```

在 `main` 上跑时 `merge-base(HEAD, origin/main) == HEAD`，该 range **恒为空**，
第 50 行的 `assert(fixInHistory, ...)` 必然抛 `ERR_ASSERTION`。
在任意一条**新**特性分支上跑也一样会红——因为新分支的增量提交里当然没有 #486 的 commit。
换句话说：**它只在 PR #486 那条分支上、那一天，才可能是绿的。**

补充：它硬编码的 commit `30018b7964a5cab2fe018e587eaa7db2a85a465c`（`:44`）**不是 `origin/main` 的祖先**——
该 PR 是以 squash 形式作为 `03c30bdcd` 落地的。脚本的 OR 兜底条件是
`c.subject.includes('修 7 项 Critical')`（`:48`），而落地 commit 的 subject 是
"…… 7 项 Critical 修复 (#486)"，**不含 `修 7 项 Critical` 这个连续子串**，兜底也不会命中。

#### 危害

豁免表的指引"**接线前须先查清断言与当前实现的差异**"会让接手人去
`services/api/src/ai/resume/` 一层层比对自评实现——**而那里没有差异可查**。
差异不在实现侧，在"这个脚本的生命周期在 #486 合入那天就结束了"。
浪费的是一整块 AI 服务链路的阅读时间，且结论是空的。

#### 修复步骤（可直接照做）

**Step 1 — 删除该脚本**

```bash
git rm scripts/verify-self-assessment-r3-pick.mjs
```

理由留痕：一次性 cherry-pick 守卫，服务对象 PR #486 已合入 `main`（`03c30bdcd`），
其守护的 7 个 service 文件与 2 份评审文档均已在 `main`；脚本按 `merge-base..HEAD` 取增量提交，
在 `main` 与任意新分支上都恒为空、恒抛断言，无法也不应接线。

> **不要**改成 `broken-pending-deletion` 后继续留在表里当长期欠账——
> `broken-pending-deletion` 的定义（`ci-gate-exemptions.json:66`、`verify-ci-gate-coverage.mjs:423`）
> 是"该删的是门禁本身"，登记只是**排期用的中转站**，不是终点。
> 若本轮无法立刻删，则**至少必须**把 `:85` 的 `category` 从 `broken-pending-fix` 改成
> `broken-pending-deletion`，并把 `:86` 的 reason 换成上面这段事实，
> 否则误导仍然存在。

**Step 2 — 从 `unwiredScripts` 摘掉条目并降棘轮**（文件：`scripts/ci-gate-exemptions.json`）

- 删除 `:83-87` 整条（不删会被元门禁 `verify-ci-gate-coverage.mjs:467-469` 判为
  "条目已陈旧（脚本文件已不存在，请删除本条）"而报红）。
- `MAX_UNWIRED`（`scripts/verify-ci-gate-coverage.mjs:431`）再降一格。
  与 A-1 同批执行时：`3 → 1`。

**Step 3 — 验证**

```bash
node scripts/verify-ci-gate-coverage.mjs   # 期望 OK
pnpm graph                                  # 重算 docs/graph/orphans.md 与 gates.md
```

---

## 3. B 类｜理由当初成立、现已过期（2 条）

### B-1　`ENFORCED_PREFIXES` 的解锁条件已满足，但前缀表没跟着放开

| 项 | 值 |
| --- | --- |
| **归属** | 根 `scripts/`（豁免机制本身） + 根 `.github/workflows/ci.yml` |
| **位置** | `scripts/verify-ci-gate-coverage.mjs:112-132` |

#### 当前写的

`scripts/verify-ci-gate-coverage.mjs:130` 把强制纳管的脚本前缀硬编码成两个：

```js
const ENFORCED_PREFIXES = ['verify', 'ui']
```

第 114-129 行的注释解释了为什么暂时不收 `test:`，并列了当时"已知未纳管"的 7 条脚本，
末尾写明解锁条件：

> "后续动作：**等 test:browser:truth 接线落地后，把 'test' 加进本表**，
> 再按同样规则给剩下几条登记豁免或接线。改这里请一并更新上面这段清单。"

#### 实测事实：解锁条件**已经满足**

`test:browser:truth` 已接进 CI：`.github/workflows/ci.yml:982`

```
pnpm --filter @ai-job-print/kiosk test:browser:truth
```

（`:979` 还留着当时的说明注释："test:browser:truth 此前在 apps/kiosk/package.json 里有定义，却没有任何 CI job"。）

也就是说：**注释里写的"等 …… 落地后"这个前置已经落地，但 `ENFORCED_PREFIXES` 没动，
第 118-129 行那份"已知未纳管"清单也没更新。**

#### 逐条复核那 7 条（2026-09-02 实测）

| 脚本 | 仍存在 | 在 `ci.yml` | 现状判定 |
| --- | --- | --- | --- |
| `@ai-job-print/kiosk::test:browser:truth` | ✅ | ✅ `ci.yml:982` | **已接线**，清单该条已过期 |
| `@ai-job-print/kiosk::test:browser:fusion` | ✅ | ❌ | 纯聚合别名，body = `smoke && w1..w6`，**7 个子项全部已在 `ci.yml:967-973`** → 适用 `redundant-alias` |
| `@ai-job-print/kiosk::test:browser` | ✅ | ❌ | body = `playwright test`（跑全量 spec），与已分片接线的 `:smoke/:w1..:w6/...` 重叠 |
| `@ai-job-print/kiosk::test:browser:p1-evidence` | ✅ | ❌ | body = `playwright test --config=playwright.p1-evidence.config.ts`，真未纳管 |
| `@ai-job-print/kiosk::test:visual` | ✅ | ❌ | body = `playwright test visual`，真未纳管 |
| `@ai-job-print/api::audit:cloud-upload-capability-usage` | ✅ | ❌ | 真未纳管（`audit:` 前缀也不在表内） |
| `(root)::typecheck:refresh` | ✅ | ❌ | 真未纳管，见 B-2 |

#### 危害（属"会漏检"，低于 A 类）

这一栏是元门禁**自己声明的盲区**，写得很诚实，所以不会误导人；
但它让 6 条脚本长期处于"写了没人跑"的状态，而这正是本元门禁 B 段/C 段存在的理由
（`verify-ci-gate-coverage.mjs:12-21`、`:398-400`：**"门禁存在 ≠ 门禁在跑"在本仓库的实测命中率是 100%**）。
盲区越久不收，越可能再长出新的未纳管脚本。

#### 修复步骤（可直接照做）

**Step 1 — 先按 `verify:` 的同一套规则给剩下 6 条定性**（不改代码，只出结论）

- `test:browser:fusion` → `redundant-alias`（7 个子项全在 CI，可由元门禁 B-5 段 `:358-382` 机器复核）
- `test:browser` / `test:visual` / `test:browser:p1-evidence` → 判"接线"或"`manual-acceptance`"（需 Playwright 环境评估）
- `audit:cloud-upload-capability-usage` → 判"接线"或登记豁免
- `typecheck:refresh` → 见 B-2，建议直接接线

**Step 2 — 放开前缀表**（文件：`scripts/verify-ci-gate-coverage.mjs:130`）

```js
const ENFORCED_PREFIXES = ['verify', 'ui', 'test']
```

> ⚠ **必须与 Step 1 同批提交**。单独改这一行会让上面 6 条立刻变成
> "门禁未被任何 CI job 执行，且未登记豁免原因"（`:385-388`）而**直接把 CI 打红**。

**Step 3 — 同步更新注释**（`scripts/verify-ci-gate-coverage.mjs:114-129`）
第 129 行明写"改这里请一并更新上面这段清单"——把已解锁的 `test:browser:truth` 从清单里划掉，
并按 Step 1 的结论重写剩余项。

**Step 4 — 验证**

```bash
node scripts/verify-ci-gate-coverage.mjs
pnpm verify:repository-integrity      # 改了 ci.yml 的话，推之前必跑（CLAUDE.md §14）
```

---

### B-2　`packages/refresh` 的 TypeScript 源码从未进过 CI typecheck

| 项 | 值 |
| --- | --- |
| **归属** | 根 `.github/workflows/ci.yml` |
| **位置** | `.github/workflows/ci.yml:221-226` |

#### 实测事实

CI 的 typecheck 批次逐包点名，共 6 个包（`.github/workflows/ci.yml:221-226`）：

```
pnpm --filter @ai-job-print/shared typecheck
pnpm --filter @ai-job-print/api typecheck
pnpm --filter @ai-job-print/kiosk typecheck
pnpm --filter @ai-job-print/admin typecheck
pnpm --filter @ai-job-print/partner typecheck
pnpm --filter terminal-agent typecheck
```

`@ai-job-print/refresh`（`packages/refresh`）**不在其中**，而它确实有 typecheck 脚本：

```json
{ "typecheck": "tsc --noEmit", "verify:runtime": "node scripts/verify-refresh-runtime.mjs" }
```

根包为它包了一层别名 `typecheck:refresh`（`package.json:19`，body = `pnpm --filter @ai-job-print/refresh typecheck`），
但该别名也不在 `ci.yml` 里（`grep 'typecheck:refresh' .github/workflows/ci.yml` → 0 命中）。

该包的 `verify:runtime` **是**在 CI 里的（`.github/workflows/ci.yml:138`），
所以运行期契约有守，**但类型错误无人拦**。

元门禁抓不到它，因为 `typecheck:` 前缀不在 `ENFORCED_PREFIXES`（见 B-1）——
这是 B-1 那个盲区最具体的一个受害者。

#### 危害（会漏检）

`packages/refresh` 是共享包，`apps/admin` 与 `apps/partner` 都有依赖它的门禁
（`ci.yml:105` `verify:refresh-safe`、`:110` `verify:partner-refresh-safe`）。
它的类型回退只会在下游包 typecheck 时以间接形式暴露，或者根本不暴露。

#### 修复步骤（可直接照做）

**Step 1 —** 在 `.github/workflows/ci.yml:226` 之后补一行：

```
pnpm --filter @ai-job-print/refresh typecheck
```

**Step 2 — 本地先跑一遍确认它是绿的**（若红则先修类型再接线，不要带红接线）：

```bash
pnpm --filter @ai-job-print/refresh typecheck
```

**Step 3 — 改了 workflow，推前必跑**（CLAUDE.md §14 第 0 条）：

```bash
pnpm verify:repository-integrity
```

---

## 4. C 类｜理由成立且仍然成立（6 条，不用动）

以下 6 条**本轮无需任何操作**，但记录"为什么现在还不能取消"，避免下一轮复核重复调查。

### C-1　`@ai-job-print/api::verify:cos:live`

- **归属**：`services/api/` ｜ **条目**：`scripts/ci-gate-exemptions.json:25-29`，类别 `live-credentials`
- **理由复核：成立。** `services/api/scripts/verify-cos-live.ts:23-25` 确认：无 `TENCENT_COS_*` 凭证时
  打印 `SKIPPED: 未配置 TENCENT_COS_* 凭证…` 并 `process.exit(0)`。
- **为什么现在不能取消**：放进 CI 只会恒定打印 SKIPPED 并绿——**一条恒绿的门禁比没有门禁更危险**，
  因为它会在覆盖率统计里冒充"已守护"。取消豁免的前提是 CI 里具备真实 COS 凭证，
  而那与"CI 不放真实凭证"的既有安全口径冲突。

### C-2　`@ai-job-print/api::verify:ocr-baidu-live`

- **归属**：`services/api/` ｜ **条目**：`scripts/ci-gate-exemptions.json:30-34`，类别 `live-credentials`
- **理由复核：成立，且它自述的附带缺陷也属实。**
  `services/api/scripts/verify-ocr-baidu-live.ts:53-54` 确认：缺 `BAIDU_OCR_API_KEY / BAIDU_OCR_SECRET_KEY` 时
  `console.error('SKIP: …')` 后 **`process.exit(1)`**——与 C-1 的 `exit 0` 语义相反。
- **为什么现在不能取消**：需真实百度智能云密钥并消耗约 3 次真实调用额度。
- **附带待办（低优先，非阻塞）**：`exit 1` 这个"SKIP 却报错"的语义不一致，
  是个会绊倒下一个尝试接线的人的小陷阱——他会以为门禁真的挂了。
  建议对齐成 `process.exit(0)`（与 `verify-cos-live.ts:25` 一致）。
  **注意：改了之后它仍然不该接线**，理由与 C-1 相同（会变成恒绿 SKIP 打印机），
  改的目的只是消除误导，不是为接线做准备。

### C-3　`@ai-job-print/api::verify:llm-connectivity`

- **归属**：`services/api/` ｜ **条目**：`scripts/ci-gate-exemptions.json:35-39`，类别 `live-credentials`
- **理由复核：成立。** `.github/workflows/ci.yml:40` 与 `:718` 均设 `AI_PROVIDER: mock`；
  脚本在 feature 未启用时返回 `FEATURE_DISABLED`（`services/api/scripts/verify-llm-connectivity.ts:158`）。
- **为什么现在不能取消**：需真实厂商密钥且要求对应 feature 已在库中启用；CI 的 mock provider 下必然 `FEATURE_DISABLED`。

### C-4　`@ai-job-print/api::verify:field-mapping:http`

- **归属**：`services/api/` ｜ **条目**：`scripts/ci-gate-exemptions.json:40-44`，类别 `running-server`
- **理由复核：成立，且其声称的"等价覆盖"已核实。**
  - 前置属实：`services/api/scripts/q1-http-e2e-field-mapping.ts:8`（文件头注明"API 已在 http://localhost:3010 运行；dev.db 已 seed"）、`:15`（`const BASE = process.env['Q1_BASE'] ?? 'http://localhost:3010/api/v1'`）。
  - 替代覆盖属实：service 层等价门禁 `verify:field-mapping`（body = `node -r @swc-node/register scripts/verify-field-mapping-rule.ts`）**确实在 CI 里**，位置 `.github/workflows/ci.yml:652`。
- **为什么现在不能取消**：CI 无常驻 API 服务；HTTP 层若要接线需先引入起服务 + seed 的步骤，成本远高于其边际覆盖。

### C-5　`@ai-job-print/api::verify:upload-sessions:http`

- **归属**：`services/api/` ｜ **条目**：`scripts/ci-gate-exemptions.json:45-49`，类别 `running-server`
- **理由复核：成立。** `services/api/scripts/verify-upload-sessions-http.ts:27`
  （`UPLOAD_SESSION_HTTP_BASE ?? 'http://localhost:3010/api/v1'`）、`:141-142`（强制 base 指向 localhost）、
  `:148`（读取 `FILE_STORAGE_DRIVER`）三处均与 reason 描述一致。
- **为什么现在不能取消**：同 C-4，需常驻 API 服务与显式 `FILE_STORAGE_DRIVER=local`。

### C-6　`@ai-job-print/api::verify:member-login-data-closure`

- **归属**：`services/api/` ｜ **条目**：`scripts/ci-gate-exemptions.json:50-54`，类别 `redundant-alias`
- **理由复核：成立，且"17 条子门禁"计数准确**（实数 17 条：`verify:resume-extraction`、`verify:cos:files`、
  `verify:mock-interview`、`verify:ai-result-ownership`、`verify:resume-optimize`、`verify:job-fit`、
  `verify:career-plan`、`verify:ocr-baidu`、`verify:production-runtime-gates`、`verify:trust-proxy`、
  `verify:member-sms-provider-errors`、`verify:member-auth`、`verify:member-assets-c2d`、
  `verify:member-favorites-benefits`、`verify:activity-logs`、`verify:member-print-orders`、
  `verify:member-data-retention`）。
- **为什么现在不能取消——并且不需要人来盯**：这条豁免的前提由元门禁 B-5 段
  （`scripts/verify-ci-gate-coverage.mjs:358-382`）**机器复核**：脚本解析别名 body，把每个子门禁
  拿去和 CI 执行闭包比对，只要有一条掉出闭包，豁免立刻失效并让 CI 红。
  **这是本表设计得最好的一条**——它把"会过期的结论"变成了"由机器持续验证的断言"。
  建议把这个模式作为其它 `redundant-alias` 条目（如 B-1 里的 `test:browser:fusion`）的样板。

### C-7（附）　`apps/admin/scripts/verify-partner-account-delete-ui.mjs`：**结论成立，但理由有两处事实偏差**

| 项 | 值 |
| --- | --- |
| **归属** | `apps/admin/` |
| **条目** | `scripts/ci-gate-exemptions.json:73-77`，类别 `broken-pending-deletion` |

**结论部分成立、可直接执行**：豁免表说的核心矛盾属实——

- 本门禁 `apps/admin/scripts/verify-partner-account-delete-ui.mjs:29-30` 断言
  `src/routes/partners/PartnerAccountDeletionDialog.tsx` 必须含 `role="alertdialog"` 与 `删除后不可直接恢复`；
- 同目录 `apps/admin/scripts/verify-partner-account-action-ui.mjs:104` 断言的恰恰是
  `expect(!existsSync(resolve(root, 'src/routes/partners/PartnerAccountDeletionDialog.tsx')), '旧删除弹窗必须移除')`；
- 该文件**确已删除**（`ls apps/admin/src/routes/partners/` 里只有替代品 `PartnerAccountActionDialog.tsx`）；
- 只有 `verify-partner-account-action-ui` 被接线（`apps/admin/package.json:27`），本门禁没有脚本名；
- 实跑 `exit 1`。

**处置建议不变：删除本门禁文件**（`git rm apps/admin/scripts/verify-partner-account-delete-ui.mjs`），
同步删除 `scripts/ci-gate-exemptions.json:73-77` 并把 `MAX_UNWIRED` 再降一格。

**但 reason（`:76`）里有两处描述与实测不符，须一并更正，否则会让执行者误判**：

| # | reason 写的 | 实测 | 影响 |
| --- | --- | --- | --- |
| ① | "本门禁**实跑 4 条断言全 FAIL**" | 该门禁共 **8 条**断言（`verify-partner-account-delete-ui.mjs:23-33`），实跑 **4 FAIL / 4 PASS** | 让人以为门禁整体已完全失效；实际有一半断言仍成立，若日后决定"改造而非删除"，这半边是可用的 |
| ② | 4 条 FAIL 被整体归因于"被删除的弹窗" | 只有 **2 条**（`:29`、`:30`）源于弹窗被删；另 **2 条**（`:24` adapter 端点、`:27` 服务契约）是 `apps/admin/src/services/api/orgsAdmin.ts` 的**签名漂移**——`deleteAccount` 现为 4 参（`orgsAdmin.ts:177`：`deleteAccount(orgId, accountId, actionTicket, signal?)`），并且请求体多了 `X-Account-Action-Ticket` 头（`orgsAdmin.ts:282-286`），而门禁断言的是旧的 2 参形态与无额外参数的 `req(...)` 调用 | **与 A-1 是同一种病**：把"正则过期"当成了"东西坏了"。这里因为弹窗矛盾足以支撑"删除"结论，所以没造成误导性行动；但归因写错会让下一个人以为 `orgsAdmin.ts` 也出了问题 |

**为什么仍归 C 而不是 A**：豁免理由的**核心事实（两条门禁互相矛盾、该删的是门禁本身）成立**，
**处置动作（删除、不要接线）正确且不变**。偏差只影响对成因与工作量的判断，不会把人送去做错误的修改。

---

## 5. D 类｜门禁在跑但断言不到东西（假绿）：**0 条已确认**

本轮没有发现已确认的假绿门禁。以下是排查过程，记录下来是为了让下一轮不必重跑。

### 5.1 排查线索来源

项目图谱 `docs/graph/gates.md:47-55` 有一栏 **"断言了不存在的路径（3）"**，
栏目说明写的是"这类断言往往已经**恒真或恒假**，需要人确认"——正好是 D 类的候选池：

| 门禁脚本 | 图谱标出的不存在路径 |
| --- | --- |
| `apps/admin/scripts/verify-partner-account-delete-ui.mjs` | `src/routes/partners/PartnerAccountDeletionDialog.tsx` |
| `apps/kiosk/scripts/verify-fusion-w4.mjs` | `services/api/prisma/postgres/migrations/20260802120000_add_wx_open_id_to_end_user/migration.sql` |
| `apps/kiosk/scripts/verify-profile-commercial-first-batch.mjs` | `apps/kiosk/scripts/verify-lightflow-4188-layout-parity.mjs` |

### 5.2 逐条查证结论

| 门禁 | 查证 | 结论 |
| --- | --- | --- |
| `verify-partner-account-delete-ui.mjs` | 该路径出现在 `:19` 的 `read()` 里，缺失时返回空串，导致 `:29`/`:30` 断言 **FAIL**（恒假，不是恒真）；且该门禁**根本没在跑**（无脚本名） | **非假绿**。已在 §4 C-7 处理 |
| `verify-fusion-w4.mjs:87` | 该路径落在 `W6_INTEGRATION_FILES` 这个 `new Set([...])` **允许改动清单**里（声明见 `verify-fusion-w4.mjs:77`，与 `:118` 的 `ALLOWED_PRODUCTION_PATHS`、`:125` 的 `OTHER_WAVE_PATHS` 同属 scope 守卫机制），**不是"该文件必须存在"的断言** | **非假绿**。陈旧条目的唯一效果是"多允许一个已不存在的文件被改动"，不放宽任何真实断言。属整洁类，可择期清理 |
| `verify-profile-commercial-first-batch.mjs:246` | 同上：该路径落在 `USER_CENTER_WAVE0_CHANGED`（声明见 `verify-profile-commercial-first-batch.mjs:237`）这个**已改动文件集合**里，同为 scope 守卫用途 | **非假绿**。同上，属整洁类 |

### 5.3 附：图谱同栏的一个误报，记录以免下轮重查

`docs/graph/gates.md:33-44` 的 **"有脚本名但不在 CI 执行闭包里（3）"** 列出了
`scripts/verify-deploy-authorization-gate.mjs`（脚本名 `verify:deploy-authorization-gate`）。
实测它**在 CI 里**：`.github/workflows/ci.yml:86` 以 `node scripts/verify-deploy-authorization-gate.mjs`
直接执行命令体（不经脚本名），并且被 `verify-ci-gate-coverage.mjs:54` 的 `REQUIRED_COMMANDS` 逐字钉住。
元门禁 `:267-283` 专门处理了这种"直接跑命令体"的情形，因此判定为已覆盖。
图谱那一栏自己标注了"这一栏是**尽力而为的推断**，权威是 `verify:ci-gate-coverage`"，
故此项**不是缺陷，无需处理**。

---

## 6. 优先级排序

### 6.1 判断依据

采用的口径（由任务方给定）：

> **"会误导人的" > "会漏检的" > "只是不整洁的"**

理由：**假绿至少还有别的门禁兜底**（本仓库 377 条 verify/ui 门禁中 371 条在 CI 闭包内，
关键路径普遍有多条门禁交叉覆盖）；而**错误的诊断会直接消耗人的调查时间，且不可回收**——
它不但浪费一整块时间，还可能引导出错误的代码改动，把一个原本正确的实现改坏。

在"会误导人"内部，再按**误导后果的严重度**二次排序：

1. 照着做**会引入新缺陷**的（最坏）
2. 照着做**只是白费时间**的
3. **归因写错但动作正确**的（最轻）

### 6.2 排序结果

| 排名 | 条目 | 类 | 归属 | 为什么排这个位置 |
| --- | --- | --- | --- | --- |
| **1** | **A-1 `verify-jobfairs-terminal-priority` 豁免理由方向写反** | A | `apps/kiosk` + 根 `scripts` | **本清单唯一一条"照着做会引入新缺陷"的条目。** 它断言"功能没做"，实际功能端到端完整（页面→adapter→controller→service 五环已逐一取证）。接手人找不到那个不存在的 bug 后，最可能的动作是把已工作的展开式调用改回旧三元式去迎合正则——那会连带毁掉 `#652` 的 status/keyword/pageSize 筛选下推。**修复成本极低**（改一行正则），**误导成本极高**，收益比最悬殊 |
| **2** | **A-2 `verify-self-assessment-r3-pick` 类别与理由都写错** | A | 根 `scripts` | 同为 A 类误导，但后果止于**白费时间**：它把人送去 `services/api/src/ai/resume/` 比对"断言与实现的差异"，而差异不存在（功能已随 `03c30bdcd` 合入 `main`）。不会诱发错误改动，因为该脚本不读业务源码。排第 2 而非第 1，另因脚本文件头 `:3-9` 自述了"用于 PR #486 兜底"，接手人有较快的逃生通道 |
| **3** | **C-7 `verify-partner-account-delete-ui` 理由的两处事实偏差** | C（含误导） | `apps/admin` | 仍属"会误导"，故排在全部 B 类之前。但**处置动作（删除）不变且正确**，误导只影响对成因与工作量的判断（把 `orgsAdmin.ts` 的签名漂移错误归因给了被删弹窗）。是 A-1 同一种病的轻症版本，建议与 A-1 同批修，顺手统一口径 |
| **4** | **B-1 `ENFORCED_PREFIXES` 解锁条件已满足** | B | 根 `scripts` + 根 `ci.yml` | 进入"会漏检"档。它是元门禁**自己诚实声明的盲区**（注释写得很清楚，不误导人），但让 6 条 `test:`/`audit:`/`typecheck:` 脚本长期无人跑。修复需要先给 6 条定性再放开前缀，**必须整批提交**，工作量明显大于前三条 |
| **5** | **B-2 `packages/refresh` 未进 CI typecheck** | B | 根 `ci.yml` | 同为漏检，且是 B-1 盲区的具体受害者。排在 B-1 之后是因为它是子集；但**它可以独立先修**（加一行 `ci.yml`），不必等 B-1 的整批治理，适合作为低风险的先行项 |
| **6** | C-2 附带待办：`verify-ocr-baidu-live` 的 SKIP-却-`exit 1` 语义不一致 | C（附） | `services/api` | 不整洁 + 轻微误导（会让尝试接线的人误以为门禁真挂了）。一行改动，可随手带上 |
| **7** | §5.2 两处 scope 允许清单里的陈旧路径 | 整洁 | `apps/kiosk` | 纯整洁。已查证不构成假绿、不放宽任何真实断言。**不建议单独排期**，等相关门禁下次因别的原因被改时顺手清 |

### 6.3 执行建议

- **第 1 批（建议合并为一个 PR）**：排名 1、2、3、6。
  共同点是都只动**门禁脚本与豁免表**，不碰任何业务代码，风险最低；
  且都需要同步维护 `MAX_UNWIRED` 棘轮（`scripts/verify-ci-gate-coverage.mjs:431`，
  `3 → 1`：A-1 接线还一条、A-2 删除还一条；C-7 若同批删则 `→ 0`），一次改完最省事。
  完成后 `unwiredScripts` 表可清空或仅剩 1 条。
- **第 2 批**：排名 5（`ci.yml` 加一行 typecheck），独立、低风险。
- **第 3 批**：排名 4（前缀表治理），需要先对 6 条脚本逐个定性，工作量最大，单独排期。

### 6.4 执行时的两个硬约束（照做前务必知道）

1. **`MAX_UNWIRED` / `MAX_PENDING` 只允许调低。**
   `scripts/verify-ci-gate-coverage.mjs:429-430`（`MAX_UNWIRED = 3`）与 `:300-308`（`MAX_PENDING = 1`）
   都明写"该上限只允许调低，不允许调高：想加新的，先还掉一条旧的"。
   还掉一条就降一格，**不要为了省事保持原值**——那会重新给欠账留出空位。
   顺带记录当前状态：**`unwiredScripts` 已 3/3 满格**，在还掉任何一条之前，
   仓库里再出现一个未接线门禁脚本就会**直接把 CI 打红**。
2. **改了 `.github/workflows/**` 的，推之前必须跑 `pnpm verify:repository-integrity`。**
   见 CLAUDE.md §14 第 0 条与 `docs/reviews/verification-antipatterns-2026-08-17.md` §三：
   坏 YAML 进 `main` 会让 GitHub 无法解析该文件（dispatch 一律 422），
   并使 `Repository integrity gate` 转红、**连带所有在跑的 PR 全部失败**。
   本清单的 A-1 Step 3、B-1 Step 2、B-2 Step 1 都会改 `ci.yml`。

---

## 7. 未查证 / 已知边界

| 项 | 卡在哪 |
| --- | --- |
| B-1 中 `test:browser` / `test:visual` / `test:browser:p1-evidence` 三条的**正确归宿**（接线 vs `manual-acceptance`） | 需要评估 Playwright 在 CI runner 上的可用性、耗时与稳定性，以及它们与已分片接线的 `test:browser:smoke/:w1..:w6`（`ci.yml:967-973`）之间的覆盖重叠程度。本轮只做了静态取证（脚本 body + `ci.yml` 命中），**未实跑**，故不给结论 |
| B-1 中 `audit:cloud-upload-capability-usage` 的归宿 | 未阅读 `services/api/scripts/audit-cloud-upload-capability-usage.ts` 的断言内容与运行前置，无法判断它是"审计报告"还是"可门禁化的断言"。**未查证** |
| A-1 修复后该门禁**在真实 CI 环境**是否稳定绿 | 本地实测已验证正则替换后 4/4 PASS，但未在 CI runner 上跑过。属常规接线风险，非未知问题 |
| `docs/graph/` 下的图谱产物是否需要随本清单的改动重算 | 需要。`docs/graph/orphans.md:251-254`、`docs/graph/gates.md:27-29` 都列着这 3 个未接线脚本，删除/接线后必须 `pnpm graph` 重跑。**注意：图谱是自动产物，禁止手改 `docs/graph/` 里的文件**（CLAUDE.md §14），手改会在下次生成时被覆盖 |
