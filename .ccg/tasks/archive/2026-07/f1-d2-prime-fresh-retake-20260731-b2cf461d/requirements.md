# D2′ fresh retake 范围声明

## 目标

基于 `origin/main@b2cf461dcd6ea4f70adef3bb210f2fbc5572c0a5`，在本机既有非生产 Colima 的全新 detached clone 中执行一次新的 D2′ full drill，验证 #451 的安全诊断增强后能形成可独立复核的 PASS 或有界 NO-GO 证据。

## 精确授权包

- 环境：本机既有 `default` Colima；不创建第二 profile，不连接生产。
- guest fresh clone：`/var/lib/d2-prime-prep/fresh-retake-20260731-b2cf461d`。
- evidence：`/var/lib/d2-prime-prep/fresh-retake-20260731-b2cf461d/services/api/scripts/d2-same-host/.evidence/d2-prime-evidence-20260731T052000Z.json`。
- 窗口：`2026-07-31T13:20:00+08:00` 至 `2026-07-31T14:50:00+08:00`。
- nonce：由 `run.sh` 在唯一一次 full drill 中自动生成全新 32-hex，不预生成、不注入、不复用。
- 调用上限：`drill:d2-same-host` 精确一次；非零、NO-GO 或 evidence 异常后本窗口不重跑。

## 允许范围

- 启动和停止既有 `default` Colima。
- 创建上述 fresh clone，执行 frozen install、API build、离线合同与只读 pre-nonce 门禁。
- 在全部门禁通过后唯一执行一次 D2′ full drill，并独立运行 evidence verifier。
- 保留脱敏 evidence；精确审计端口、unit、PM2/Nginx、runtime root 与 `.work` 残留。
- 同步任务与正式进度文档，完成 Claude、Antigravity、Cursor/Codex 只读复核。

## 禁止范围

- 不连接或修改生产服务器、生产 PM2/Nginx、数据库、Redis、对象存储、密钥或 Windows Terminal Agent。
- 不执行 D3–D6，不切流，不把 D2′ 结果写成 production F1 已通过。
- 不设置 skip/mock/partial-pass，不覆盖旧 evidence，不复用旧 clone/workspace/nonce。
- 不允许并行代理触碰 Colima；full drill 必须由主执行者串行执行。

## 硬停止条件

SHA、fresh clone、evidence、窗口、环境、XDG/user-systemd/cgroup、工具、端口、production denylist 或 cleanup 任一不满足即停止；full drill 一旦被调用，无论结果均不得在本窗口第二次调用。
