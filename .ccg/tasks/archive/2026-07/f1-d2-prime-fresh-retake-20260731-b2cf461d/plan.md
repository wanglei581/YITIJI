# F1 D2′ Fresh Retake Execution Plan

## Task 1：固定基线与执行包

- [x] `origin/main` 固定为 `b2cf461dcd6ea4f70adef3bb210f2fbc5572c0a5`。
- [x] 创建独立治理 worktree，未触碰主工作区未提交改动。
- [x] 固定 guest fresh clone、evidence 与 RFC3339 窗口。

## Task 2：执行前多模型只读复核

- [x] Claude 审查 runbook、脚本、授权包与硬停止条件；复核后更正为 `NO-GO`。
- [x] Antigravity 同范围独立审查；复核后更正为 `NO-GO / REQUEST_CHANGES`。
- [x] Cursor CLI 返回空输出，按用户授权改用客户端；更正后结论为 `NO-GO`。
- [x] 独立 Codex reviewer 复现 cleanup EXIT trap 假通过，并判定 `NO-GO`。
- [x] 多模型一致确认存在 Critical，按硬停止条件终止执行准备。

## Task 3：fresh guest 准备与门禁

- [ ] 启动既有 `default` Colima，不创建新 profile。
- [ ] 确认目标 clone/evidence 不存在，并创建 mode 0700 detached fresh clone。
- [ ] 确认 HEAD/remote SHA、工作树、真实 `.env`、生产变量 denylist。
- [ ] frozen install、API build、offline contract 与语法门禁通过。
- [ ] XDG/user-systemd/cgroup、工具、端口、runtime/evidence/work 路径及 full-drill-count=0 全部通过。

## Task 4：唯一一次 full drill

- [ ] 再次确认仍在授权窗口且 evidence 不存在。
- [ ] 使用精确 `D2_EVIDENCE_OUT` 唯一调用一次 `drill:d2-same-host`。
- [ ] 记录退出码和固定诊断 token，不记录 raw message/stack/path/nonce。
- [ ] 独立 verifier 精确运行一次并记录 evidence SHA-256。

## Task 5：cleanup、复核与闭环

- [x] 未创建任何执行资源，端口/unit/PM2/Nginx/runtime/socket/pidfile/`.work` cleanup audit 不适用。
- [x] Colima 从未启动，无需停止；evidence 从未生成。
- [x] Claude、Antigravity、Cursor/Codex 已完成只读复核结果与边界。
- [x] 已更新 progress 文档与 review；离线合同、Shell/Node 语法和 diff 门禁通过；CCG 任务随本提交归档。
- [x] `productionF1=NO-GO` 保持不变；D3–D6 仍未获授权。

## Pre-start 结果

- 结论：`NO-GO / PRE-START HARD STOP`，本执行包作废，不代表 D2′ 已执行。
- 未启动 Colima，未创建 guest fresh clone，未安装依赖，未生成 nonce/evidence，未调用 full drill；调用计数保持 `0`。
- `services/api/scripts/d2-same-host/run.sh` 的 EXIT trap 在 cleanup 返回非零时不会覆盖原成功退出码，可能出现 `D2_PRIME_PASS` 且进程退出 `0` 的假通过。
- user systemd stop/reset-failed 被 `|| true` 吞掉，且 cleanup 没有重新证明 unit 已 inactive。
- production secret denylist 与项目真实变量命名/范围不一致，不能支撑“调用环境无生产凭据”的强断言。
- 后续必须另立 TDD 代码修复任务；修复审查、合入主干后，再重新确定新的 baseline、clone、evidence 与 RFC3339 窗口并单独授权。当前固定窗口和路径不得复用。
