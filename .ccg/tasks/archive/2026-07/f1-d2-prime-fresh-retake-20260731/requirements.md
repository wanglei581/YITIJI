# D2′ fresh retake 范围声明

## 目标

基于 `origin/main@06c7fe00357533fbcd91928a3abf2ed8c2933dec`，在既定 D2′ 隔离环境重新执行演练，验证受信任的 `XDG_RUNTIME_DIR` 能完整传入 user-systemd/PM2 调用链，并形成可复核的 `GO / NO-GO` 结论。

## 对应上线阻塞

D2′ 是后续 `productionF1` 的前置证据之一；本任务只处理 D2′ 演练，不等同于生产 provenance 闭环或切流授权。

## 允许范围

- 读取正式进度、规范、runbook 与 D2′ 脚本。
- 在干净隔离工作区运行本地基线和离线契约验证。
- 对既定 D2′ 环境执行只读预检。
- 仅在所有前置门禁通过后，按 runbook 生成全新 nonce 并执行 D2′ fresh retake。
- 记录脱敏证据、结论和必要的进度文档。

## 禁止范围

- 不新增云主机或虚拟电脑。
- 不修改现有生产业务、数据库、密钥、Nginx、负载层或 Windows Terminal Agent。
- 不把 D2′ 结果写成 `productionF1` 已通过。
- 不执行 D3–D6、生产切流或历史 F1 回填。
- 不复用旧 nonce、旧证据或旧工作区状态冒充 fresh retake。

## 验证门禁

- 最新 `main` 来源与工作树清洁性。
- D2′ 离线契约、相关语法检查、API lint/typecheck/build。
- user-systemd/XDG 只读前置契约。
- 演练命令、目标、nonce、证据目录均与 runbook 一致。
- Claude、Antigravity、Cursor/Codex 交叉审查无 Critical。

## 文档同步

完成后同步 `docs/progress/current-progress.md` 与 `docs/progress/next-tasks.md`；若演练失败，必须准确记录阻塞原因并保持 `productionF1 = NO-GO`。
