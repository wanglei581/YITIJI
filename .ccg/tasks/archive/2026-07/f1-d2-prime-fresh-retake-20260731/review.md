# D2′ Fresh Retake 准备阶段多模型审查

## 综合结论

- **准备授权包：GO。**
- **立即执行 full drill：NO-GO。** 尚缺针对本轮的新 RFC3339 窗口、精确 evidence 路径与“允许脚本在唯一一次调用中生成新 nonce”的用户明确授权。
- **productionF1：NO-GO。** D3–D6 继续禁止。

## Claude

- 结论：`GO for preparing authorization packet`。
- 确认 PR #448 已关闭三层 XDG 断点：`run.sh` 自派生/校验/export，内层 `env -i` 传递，`drill.mjs` 的 5 个 systemd 查询使用受信环境。
- 要求 Linux/cgroup v2/user systemd/Linger/XDG、工具、端口、production denylist、fresh SHA/build、offline contract、evidence 不存在全部通过。
- 要求 full drill 精确一次；任一 NO-GO/非零退出/窗口过期/清理残留都停止且不重跑。

## Antigravity

- 结论：准备授权包 GO；立即执行与 production/D3–D6 均 NO-GO。
- Critical 0；Warning 1：离线全绿容易被误写成执行授权。
- 确认 PM2 socket 预算、XDG 三层贯穿、transient resource limits、端口和 evidence 路径门禁完整。

## Cursor

- Cursor CLI 本轮 exit 0 但空输出，不计为有效审查；按用户既有授权改用 Cursor 客户端完成只读复核。
- 客户端确认目标 worktree 的 HEAD 精确为 `06c7fe00`、与 `origin/main` 一致；结论同样为“准备 GO、执行 NO-GO”。
- Cursor 将缺少新授权字段列为流程 Critical，而非代码 Critical；其 Warning 均不阻塞授权包准备。

## 交叉校正

1. **不采纳“用户手工提供 32-hex nonce”。** `run.sh:156` 无条件从 `/proc/sys/kernel/random/uuid` 生成 nonce，没有 `D2_NONCE` caller override；正确授权是允许脚本在本轮唯一一次 full drill 中自动生成全新 nonce。
2. **不采纳“caller XDG 必须 unset”为新增硬门禁。** 当前修复的安全设计就是不信任 caller 并在首个 user-systemd 前强制覆盖、校验 exact `/run/user/<uid>`；离线恶意变体已锁定顺序。授权后仍通过净化环境执行，但不把未写入 SSOT 的条件冒充正式门禁。
3. **保留精确 `D2_EVIDENCE_OUT`。** 本轮需要一个事先授权、确定且不存在的证据路径；固定文件名不含外部输入或敏感值，满足 `run.sh:282-285`。
4. **不采用宽泛人工清理命令。** 若出现残留，只允许脚本已有的 nonce/owner/identity 精确清理；不得用 `systemctl stop f1-d2-*`、宽泛 `pkill` 或 glob 删除。

## 本地验证

- `pnpm install --frozen-lockfile`：PASS。
- Bash/Node 语法：PASS。
- `verify:d2-same-host-contract`：PASS，输出 `D2_PRIME_CONTRACT_ALL_PASS`。
- API typecheck：PASS。
- API lint：PASS。
- API build：PASS。
- `colima status`：现有 Colima 为 stopped；未启动、未连接 guest、未生成 nonce/evidence。

## 授权后路径预检修正

- 授权窗口内启动了既有 `default` Colima，没有创建新 profile。
- 只读环境门禁通过；一次版本输出误触发默认 `~/.pm2` daemon，输出证明为本轮新派生，已立即用精确 `PM2_HOME` 有界 `pm2 kill`，确认进程残留为 0；未删除目录，full drill 计数仍为 0。
- 原授权 clone 路径直属 `/var/lib`，guest 用户无创建权限；`git clone` 在创建目录前返回 Permission denied，目标保持不存在，未生成 nonce/evidence。
- 既有 `/var/lib/d2-prime-prep` 为 UID 501 当前用户所有、mode 0750、非 symlink、realpath 精确且可写；新候选子目录 `fresh-retake-20260731-06c7fe00` 不存在。因精确路径属于授权字段，必须取得用户修正授权后才能继续。

## 修正授权后的唯一一次执行结果

- 用户明确授权把 guest fresh clone 修正为 `/var/lib/d2-prime-prep/fresh-retake-20260731-06c7fe00`；commit、窗口、脚本自动生成 nonce、full drill 最多一次和 `productionF1=NO-GO` 边界不变。
- fresh clone 的 `HEAD` / `origin/main` 均精确为 `06c7fe00357533fbcd91928a3abf2ed8c2933dec`，detached、干净、无真实 `.env`、mode 0700；frozen install、API fresh build 和 offline contract 全部通过。
- `2026-07-31T10:26:54+08:00` 最终 pre-nonce gate：evidence 不存在，`3010/3011/18080` 空闲，D2 units、runtime roots、进程和 production denylist 命中均为 0，full drill 计数为 0。
- 本窗口精确执行一次 full drill；它在输出 `baseline_p50_ms=0.59`、`baseline_p95_ms=2.89`、`load_p50_ms=0.23`、`load_p95_ms=0.55` 后返回 `D2_PRIME_NO_GO D2_PRIME_DRILL_FAILED` / `D2_PRIME_NO_GO D2_PRIME_RUNTIME_FAILURE`，exit 2。本窗口未重跑。
- evidence 存在、owner 为当前 guest 用户、mode 0600、size 3237，SHA-256 为 `9ec390733185016981ddc46a03dcf0893e224e8fd21ba39329afdf7c2488f7b3`；它是脱敏的安全失败占位证据，verdict 为 `D2_PRIME_NO_GO`、`productionF1=NO-GO`，`recordedAt=2026-07-31T02:27:25.687Z`。
- 独立 verifier 先复算 offline contract 全过，再输出 `D2_PRIME_EVIDENCE_NO_GO`、`evidenceVerdict=D2_PRIME_NO_GO`、`productionF1=NO-GO`，exit 2。
- cleanup audit：三个端口、D2/preflight units、runtime roots、相关进程、socket/pidfile 和 `.work` entries 全部为 0；systemd managed unit 正常结束，无 journal error；Colima 随后停止。

## 失败法证结论

- 可证明失败发生在 `drill.mjs` 输出 latency 之后、成功 evidence 写入之前，即当前源码约第 371–454 行的阶段。
- 可排除该范围内所有通过 `fail('CODE')` 或 `ReleaseProvenanceError` 抛出的显式失败分支：这些错误会保留 `D2_PRIME_*` / `RELEASE_PROVENANCE_*` code，而本轮被顶层 catch 泛化为 `D2_PRIME_DRILL_FAILED`。
- 当前证据不能证明具体根因。候选包括原生 assertion、文件系统异常或未分类的 HTTP 错误，但 cleanup 删除了 runDir 日志，安全失败 evidence 又没有保存 phase/error class；禁止把任一候选写成事实。
- Antigravity 将顶层 catch 的诊断泛化列为 Critical，要求另立代码修复任务，用显式 phase/code 替换原生断言并安全分类非预期异常；在本任务或本窗口内不得修复后重跑。
- PR #448 的 XDG 修复位于更早阶段；本轮已越过该门禁，只能说明它暴露了后续潜在故障与诊断缺口，不能据此宣称 XDG 修复发生回归。

## 三模型法证复审综合

### Claude

- 结论：证据链和 exit 映射自洽，cleanup 正常；Critical 为 `drill.mjs:485-490` 的诊断黑洞，实际根因不可证。
- 进一步指出可能的高风险边界包括陈旧 `managedAppPidBeforeRollback` 的 `/proc/<pid>/cgroup` 读取/断言，以及未包裹的 `observeTargets` / `httpJson` reject；这些均只是假设，不能写成根因。
- 建议独立代码任务增加编译期 phase 枚举和白名单分类，仅允许输出 `AssertionError` / `Error` 等 kind 与 `ENOENT` / `ETIMEDOUT` 等 errno 短码；禁止输出 message、stack、路径、PID、nonce、主机名或 evidence 内容。

### Antigravity

- 结论与 Claude 一致：可证明范围为 latency 后至 evidence 写入前；显式 `fail()` 分支可排除，具体触发点不可证明。
- 将错误泛化列为 Critical，并建议把原生断言改成显式失败 code、补安全诊断分类；本窗口不得修复后 retake。

### Cursor

- 有效结论：`D2_PRIME_DRILL_FAILED` 证明异常没有经过 `fail()` / `ReleaseProvenanceError`；必须独立修复 catch-all 和 failure-evidence 自身失败的可观测性，本窗口禁止 retake。
- Cursor 把 line 381/391/394/395/402 等列为候选边界，但同样承认无法唯一确定。
- **不采纳两项误读**：本轮 evidence 实际存在并由 verifier 判为合法 NO-GO，不是 absent；nonce 由 `run.sh` 在唯一调用中自动生成，不是用户手工签发。由此不采纳 Cursor 基于 evidence absent 推出的 372–449 收窄结论，保留有证据支持的约 371–454 范围。
- **不采纳输出 `stack_first` 的建议**：stack 首行可能包含本机或 guest 路径，违反本任务脱敏约束；只允许白名单 kind/errno/phase。

## 最终审查结论

- Critical 1：post-latency 非受控异常被统一折叠为 `D2_PRIME_DRILL_FAILED`，导致本轮根因不可证。
- Warning 2：陈旧 PID `/proc` 边界、未包裹 HTTP/target observation 边界均需在独立修复任务中用 RED 测试验证，不能直接按猜测修改。
- 本 fresh retake 结论永久锁定为 **NO-GO**；当前任务只记录事实与下一步，不改应用代码、不重跑、不连接 production。

## 最终文档差异复审

- Claude：Critical 0、Warning 0，确认 execution/evidence/verifier/cleanup、根因不可证明、`productionF1=NO-GO` 与无敏感信息五项全部一致，`APPROVE`。
- Antigravity：首次最终 diff 调用因 quota/resource limit 无有效报告；缩短提示后重试成功，确认四份记录一致、无敏感信息泄露，`APPROVE`。
- Cursor：在纠正其初次误读的工作目录后，对精确 worktree 提出一项修改——`current-progress.md` 应直接写明 nonce 由脚本自动生成；已按要求补充且不记录真实 nonce，同时补齐 plan evidence SHA-256 与 Task 7 状态。Cursor 复验 Critical 0，`APPROVE`。
- 最终本地门禁：`git diff --check` PASS；`verify:d2-same-host-contract` 输出 `D2_PRIME_CONTRACT_ALL_PASS`；正式文档提交 `9934a210` 已推送，PR #450 已创建，未合并。
