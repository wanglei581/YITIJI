# D2′ fresh retake 新基线执行包要求

## 目标

基于已快进并保持干净的 `main@5b251e5f7085e4a1d2e12b1ea150eb6fd3cf3df9`，重新确认 D2′ 同机隔离演练脚本的可执行性与安全边界，形成一份需要用户再次精确授权的执行包。

## 功能归位声明

- 真实闭环：上线前 F1 D2′ 同机双实例、PM2 控制面隔离、nginx 切换/回滚与资源隔离演练。
- 涉及层：`services/api/scripts/d2-same-host/`、`docs/device/f1-d2-docker-isolation-runbook.md` 与本任务 CCG 记录。
- 不涉及：Kiosk/Admin/Partner、数据库、Redis、对象存储、Windows Terminal Agent、生产部署和生产密钥。
- 复用确认：只使用仓库既有 D2′ 脚本和 runbook，不新建第二套演练实现。

## 精确执行参数

- 审查基线：`5b251e5f7085e4a1d2e12b1ea150eb6fd3cf3df9`
- 计划窗口：`2026-08-01T01:30:00+08:00` 至 `2026-08-01T03:30:00+08:00`
- fresh clone：`/var/lib/d2-prime-prep/fresh-retake-20260801-5b251e5f`
- evidence：`/var/lib/d2-prime-prep/fresh-retake-20260801-5b251e5f/services/api/scripts/d2-same-host/.evidence/d2-prime-evidence-20260731T173000Z.json`
- 执行时必须把上述绝对路径显式作为 `D2_EVIDENCE_OUT` 传给 `run.sh`，不得使用自动时间戳默认值。
- nonce：由 `run.sh` 自动生成，禁止复用。
- full drill：最多执行一次。
- 永久边界：即使 `D2_PRIME_PASS`，`productionF1=NO-GO`；不进入 D3–D6，不部署生产。

## 本任务允许修改

- `.ccg/tasks/f1-d2-prime-fresh-retake-20260801-5b251e5f/**`
- 仅在真实演练完成并形成结论后，按事实更新 `docs/progress/current-progress.md` 与 `docs/progress/next-tasks.md`。

## 本任务禁止

- 在用户再次确认新基线精确包之前启动 Colima 或 full drill。
- 新建云主机、虚拟机或第二个 Colima profile。
- 接触生产主机、生产服务、生产数据库、Redis、对象存储或密钥。
- 在第一次 full drill 失败后原地修复并重跑。
- 将旧基线 `6c1adb02` 的预审结论迁移为新基线的批准。

## 验收标准

1. 三模型均对新基线和新参数给出明确 `PRE_START_GO`，且无 Critical。（已满足）
2. 用户以指定短语再次精确授权后，才可进入准备/执行。
3. 演练严格输出可校验 evidence，清理通过，且保留 `productionF1=NO-GO`。
4. 任一门禁失败立即 NO-GO，不扩大执行范围。
