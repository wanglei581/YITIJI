# 需求与范围

## 真实问题

用户选择推送并创建 PR 后发现：最新 `origin/main@218a33e6` 已通过 PR #463 合入另一套 invocation
governance，并继续合入 #460、#464–#469 的 stale-PID、cleanup 与 systemd 证据修复；旧候选
`d08014bc` 不能直接推送，否则会回退这些主干修复并产生两套治理真值。

本任务从最新主干建立单一治理系统：以旧候选已经通过 60 项离线测试的 `O_EXCL` 分面墓碑、严格
manifest、私有 fd 3 和 Git/clone identity 内核替换 #463 的共享 JSONL / 全局锁 / env 第二真值，
同时保留主干后续 stale-PID、cleanup、systemd 与法证保留合同。

## 功能归位声明

- 后端：只涉及 `services/api/scripts/d2-same-host/` 的离线治理入口、合同与 fixture。
- CI：只增加独立 governance 离线门禁。
- 文档：只更新 D2 runbook 与两份 progress SSOT。
- 不涉及：前端、Terminal Agent、共享类型、数据库、Redis、对象存储、硬件、生产部署。
- 复用：复用旧候选已审查治理模块与主干已审查 cleanup/stale-PID/systemd 合同；不新建第二套入口。

## 硬性边界

- 必须删除旧 `invocation-governance.mjs` 与 `verify-invocation-governance.mjs`，不得双引擎共存。
- `D2_EVIDENCE_DIR`、`D2_EVIDENCE_OUT`、`D2_WORK_DIR` 不得作为 `run.sh` caller env 第二真值；
  evidence 只来自 reservation manifest 经私有 fd 3。
- `drill.mjs`、`verify-cleanup-contract.mjs`、`diagnostics.mjs`、evidence schema、`pnpm-lock.yaml`
  相对 `218a33e6` 必须零变化。
- 保留主干 rollback 后 `managedAppPid`、LoadState+ActiveState 双状态 cleanup、not-found+inactive、
  法证目录保留、evidence verify → disarm trap → cleanup → PASS 顺序。
- 新旧 governance root/schema 不迁移、不复用；不得删除任何既有 ledger。
- 不运行 `run.sh`、full drill、真实 reserve/invoke、Colima、systemd、PM2、Nginx、API 或 production。
- 本任务与 PR 不等于 D2′ PASS，不授权 fresh retake 或 D3–D6。

## 验收

- governance verifier 60/60，production lines/functions/branches coverage 均 ≥80%。
- 旧 D2 contract 与独立 cleanup contract 全部通过。
- Bash/Node 语法、API lint/typecheck/build、`git diff --check` 通过。
- `drill.mjs`、`verify-cleanup-contract.mjs`、`diagnostics.mjs` 相对基线零差异。
- Claude、Antigravity、Cursor 与 CCG reviewer 最终 Critical/Warning 0 后方可推送 PR。
