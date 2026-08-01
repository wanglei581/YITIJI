# 审查范围

## 目标

从 `main@9905be23` 只读核对目标 Linux/systemd 版本能否被现有部署资料证明，并评估 helper 分支离线演算与最小真实 Linux 验证的下一步范围。

## 允许

- 读取正式进度、部署清单、D2 runbook、`run.sh` 与离线 verifier。
- 运行不启动服务、不产生演练资源的只读/离线检查。
- 写入本任务的 CCG 审查记录。

## 禁止

- 修改运行代码、测试、正式进度或部署文档。
- 启动 Colima/systemd/PM2/Nginx/API，执行 reserve/consume/full drill。
- SSH、连接 production、部署、切流或进入 D3–D6。
