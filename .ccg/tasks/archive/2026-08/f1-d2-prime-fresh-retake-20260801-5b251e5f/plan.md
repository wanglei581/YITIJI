# D2′ fresh retake（5b251e5f）执行计划

> 当前仅获准准备新的精确执行包。Task 4 及之后必须等待用户再次明确授权。

## Task 1：固定基线与边界

- [x] 确认隔离 worktree 干净且分支为 `main`。
- [x] 使用 `git merge --ff-only origin/main` 更新到 `5b251e5f7085e4a1d2e12b1ea150eb6fd3cf3df9`。
- [x] 确认没有启动 Colima、没有 fresh clone、没有 evidence、full drill 计数为 0。

## Task 2：三模型只读预审

- [x] Claude 审查新基线 D2′ 核心脚本、runbook、清理和 evidence 语义。
- [x] Antigravity 独立审查同一范围。
- [x] Cursor CLI 以 plan 模式独立审查；CLI 空响应后按用户授权改用客户端完成审查。
- [x] 合并去重 Critical / Warning / Info，写入 `review.md`。

## Task 3：向用户提交新精确执行包

- [x] 报告基线、窗口、fresh clone、evidence、nonce 和一次性 full drill 限制。
- [x] 明示永久边界 `productionF1=NO-GO`、无 D3–D6、无生产部署。
- [x] 用户已回复：`明确授权以上 D2′ fresh retake`。

## Task 4：授权后离线准备

- [x] 再次验证 HEAD、origin 和工作区；等待进入执行窗口。
- [x] 仅启动现有默认 Colima profile，进入隔离 Linux guest。
- [x] 采用授权后由本机用户新建且无占用的 fresh clone，确认精确 detached 到 `5b251e5f`、tracked tree 干净、evidence 不存在。
- [x] 显式钉死 `D2_EVIDENCE_OUT` 为本计划绝对路径，禁止使用默认时间戳路径。
- [x] guest build、node-only contract 与 full drill 前置门禁全部通过。

## Task 5：一次性 full drill

- [x] 确认 `run.sh` 将生成新 nonce，且 evidence 目标不存在。
- [x] full drill 已且仅运行一次；结果为 `D2_PRIME_NO_GO phase=MEASURE class=SYSTEM code=D2_PRIME_DRILL_FAILED step=CGROUP_CONSISTENCY`。
- [x] evidence 为 `D2_PRIME_NO_GO`，独立 verifier exit 2，`productionF1=NO-GO`；活动进程、unit 和端口已清除，但 nonce workspace/control root 因严格 cleanup fail-closed 保留。
- [x] 首次失败原始 evidence 与 workspace 已保留，不修复、不 retake。

## Task 6：结果审查与收口

- [x] Claude、Antigravity、Cursor 审查真实 evidence 与清理结果。
- [x] 更新正式进度文档，仅记录实际发生的结果。
- [x] 完成 CCG 归档；未经单独授权不提交、不推送、不部署。
