# CCG 最终审查

## 审查身份与范围

- Reviewer：Codex CCG reviewer。
- 披露：本 reviewer 参与过治理 core 的候选对照和机械移植，不是完全独立于实现的盲审；本轮重新从
  `origin/main@e4334c5191998e6be58f00b065829f92cc3c9dfb` 检查完整集成 diff。
- 审查实现基线：`2367d7e97ee6ff8aa4ceffeb2d0b9a7c1a81ed1e`；最终复核 HEAD：
  `e12500ed`（含 `796b089b` 建链恢复、fail-closed / 静态合同收口、porcelain v2 对齐，以及
  provenance 顺序游标和重复锚点 mutation 的最终收紧）。
- 范围：正确性、安全、回归、测试和文档；未运行真实 `run.sh` / drill / reserve / invoke、Colima、
  systemd、远程、生产或硬件操作。

## 结论

**APPROVE**

- Critical：0
- Warning：0
- Info：6

运行时治理内核、主干保留语义、离线门禁和文档 SSOT 均满足 reconciliation 要求。本轮终审发现的
fresh clone 来源/创建链回退已在终审过程中修复并加入 fail-closed 静态回归合同；无剩余阻塞发现。

## Critical

无。

## Warning

无。

## 终审中已关闭的发现

### R1 — fresh/independent clone 可复算建链已恢复并锁定

终审首次对照发现 runbook 曾只保留“独立 clean clone”的文字前提，遗漏基线已有的可执行建链。整改后
§3 已恢复并强化为同一授权 shell 内：

approved source exact baseline / tracked+untracked clean preflight → 绝对且尚不存在目标的物理复算 →
`git clone --no-local` → fresh branch → standalone `.git` / physical top-level / HEAD / symbolic branch /
index / tracked+untracked clean 复核 → build + governance gate + old contract → reserve → canonical invoke。

首版整改又被发现命令块缺少错误短路；最终加入 `set -euo pipefail` 并明确禁止 reserve 前新开 shell、
`set +e` 或忽略任一步骤非零退出。旧 contract 新增 ordered + exact-occurrence mutation guard，锁定
physical target 定义、post-clone top-level/HEAD、standalone `.git`、full clean、build、两个 gate、
reserve 和唯一 invoke 顺序；source/clone clean 均与治理实现统一使用 porcelain v2。该 finding 已新鲜
复跑 contract 后关闭。最终增量 `e12500ed` 又将顺序游标推进到完整 fragment 末尾，并逐一 mutation
每个重复 provenance 锚点；Claude 提出的两条静态合同 tightening 均已关闭。

## Info

### I1 — 单一 governance 入口成立

- 旧 `invocation-governance.mjs` 与 `verify-invocation-governance.mjs` 已删除。
- `run.sh` 的 live source 仅有一次 `governance.mjs invoke`；旧 `--consume`、raw task/baseline/
  branch/clone/archive env 不再是运行输入。
- package 与 CI 将治理测试作为独立 gate；旧 D2 contract 继续独立覆盖 cleanup/evidence/drill 合同。
- 历史 #463 计划已增加 superseded banner，不再冒充当前执行真值。

### I2 — 核心安全语义成立

- reservation intent、六个 facet tombstone、manifest、invocation tombstone 与 event 均使用
  `O_CREAT|O_EXCL|O_NOFOLLOW` 或同强度 exclusive helper。
- leaf 强制 owner、`0600`、`nlink=1`，写入后执行 file fsync、directory fsync、重新打开回读，
  并复核 inode/size/mtime/ctime；state loader 拒绝未知布局、非 canonical JSON 和跨记录关系漂移。
- manifest 使用 exact schema 和 canonical SHA-256 facet hash；reservation/invocation 的部分持久前缀
  不回滚，invocation tombstone 落盘后 event 或 fd 写失败仍永久消费。
- evidence 只由 manifest 经私有 fd 3 输出两行；Node stdout 被丢弃，Bash 对状态、sentinel、行数、
  绝对路径和换行严格 fail closed；`D2_EVIDENCE_DIR` / caller `D2_EVIDENCE_OUT` /
  `D2_WORK_DIR` 不再形成第二真值。
- Git identity 拒绝 symlink ancestor、gitfile、`.git` file/symlink、hardlink CLI bridge、dirty/detached
  clone，并绑定 realpath/dev/ino/branch/full HEAD/tree/clean；invoke 前复核 manifest snapshot，
  `run.sh` 再做三阶段当前 clone drift 检查。
- 未发现新增硬编码凭据、任意 shell 拼接、错误详情或原始 identity/path 写入 event 的泄漏。

### I3 — invoke 顺序正确

`run.sh` 在 approved PATH、Linux/cgroup 文件存在性和只读 toolchain 探测后执行唯一 invoke；invoke
完成且 invocation tombstone 已持久化后，才进入 production-env、systemd/cgroup、port、workspace、
nonce、PM2/Nginx 和 drill 等可变前置。wiring contract 以 prefix/block digest、29 个 mutation 和
6 个 marker-only Bash harness 锁定该顺序与 fd 3 fail-closed 行为。

### I4 — 最新主干语义保留

相对 `origin/main@e4334c51`：

- `drill.mjs`、`verify-cleanup-contract.mjs`、`diagnostics.mjs`、`pnpm-lock.yaml` 均为零差异。
- `stop_user_unit_and_prove_inactive`、`early_cleanup`、`cleanup` 三个生产函数源码 SHA-256
  分别与基线精确一致：
  - `47a8e13060d7ac5963e7c73f83b9462a2af39c7b38ecbd69777299381e6376f3`
  - `930f4a03a65850714dd996f44c288275a0e4782d8de6bd2970e014098c11cc32`
  - `12efb9e45e3272619603b291b83e68ce512619d7706f169eabdb26949c04066b`
- rollback 后 `managedAppPid` 静态锚仍由旧 contract 校验。
- cleanup 仍只接受 `loaded+inactive` 或 `not-found+inactive`；缺失、重复、空、矛盾或未知属性
  fail closed；cleanup 失败时不删除 `RUN_DIR` / `PM2_CONTROL_ROOT`，保留 forensic evidence；
  PASS 仍位于独立 evidence verify、解除 EXIT trap、显式 cleanup 成功之后。
- systemd 精确版本的“已观测但仓库不可复算”边界和剩余真机语义缺口仍被文档保留，没有被本 PR
  虚构为已完成。

### I5 — 既有非本次阻塞保持显式

- 主干已记录的四处 cleanup 存活/有界性缺口未被本任务关闭，仍阻止把未来 fresh retake 的 PASS
  当成可信完成；这是基线既有、范围外且文档已披露的阻塞，不是本 diff 新增 finding。
- 最终 `pnpm audit` 的 3 low / 1 moderate / 3 high 来自未改依赖的 react-router、brace-expansion、
  valibot、esbuild、`@babel/core` 与 body-parser 公告；`pnpm-lock.yaml` 零差异，本任务没有扩大依赖风险，
  也不把这些范围外既有项误写成 audit 通过。
- 本 PR、离线测试或本审查都不构成 D2′ PASS，不授权 fresh retake、production 或 D3–D6。

### I6 — 文档事实与执行边界一致

- runbook 明确是未来另行授权模板，不记录当前授权值，不宣称已 reserve、invoke 或演练。
- progress 继续标记候选待 PR、未演练、未部署、`productionF1=NO-GO`，并保留四处 cleanup 阻塞。
- #463 旧 JSONL / 全局锁计划以 superseded banner 保留历史证据，不再与当前 runbook 竞争执行真值。

## 审查证据

| 检查 | 结果 |
| --- | --- |
| 完整 diff | 治理 core、wiring/contract、CI/package、runbook/progress 与任务审计文件；范围与 reconciliation 计划一致 |
| 保护文件 | 四项相对 `e4334c51` 均零差异 |
| 单入口扫描 | live runtime 仅一次 `governance.mjs invoke`；旧引擎只剩 superseded 文档/负向测试文本 |
| Governance gate | reviewer 新鲜复跑 exit 0；完整记录为 60/60，coverage lines 97.94%、branches 89.87%、functions 97.79%，29 mutations + 6 harness |
| 旧 contract | 在 `e12500ed` 新鲜复跑 `D2_PRIME_CONTRACT_ALL_PASS`；含 cleanup helper、stale-PID/drill wiring、完整 fragment 顺序游标与重复 provenance 锚点逐一 mutation |
| 语法 | `bash -n run.sh` 与全部新增/修改 MJS 的 `node --check` 通过 |
| API lint | `pnpm --filter @ai-job-print/api lint` exit 0 |
| API typecheck | `pnpm --filter @ai-job-print/api typecheck` exit 0 |
| API build | `pnpm --filter @ai-job-print/api build` exit 0 |
| whitespace | `git diff --check origin/main..HEAD` 通过 |
| 禁止动作 | 未运行真实 run.sh/drill/reserve/invoke、Colima、systemd、远程、生产或硬件操作 |

## 外部模型结论

- Claude：`APPROVE`；提出的两条 tightening 已由 `e12500ed` 关闭。
- Antigravity：100/100，`APPROVE`，Critical 0 / Warning 0。
- Cursor：总体 `APPROVE`。W1 的保护文件疑问已由 Git 零差异复算关闭；W2 的旧计划误导已由
  `2367d7e9` superseded banner 关闭；W3 为有意的独立 gate 分层。
- 本 CCG reviewer 额外发现的 fresh-clone runbook 链及 fail-closed/回归锁定缺口已在终审中修复并复验。
  最终结论与外部模型一致：Critical 0 / Warning 0，**APPROVE**。
