# 实施范围

## 目标

落实已归档的 `f1-d2-systemd-target-version-review-20260801` 双模型审查结论，对账 systemd 版本事实链与 helper 离线覆盖状态。

## 允许修改

- `docs/progress/current-progress.md`
- `docs/progress/next-tasks.md`
- 本任务 CCG 记录

## 禁止修改或执行

- 不修改 `run.sh`、verifier、evidence schema、PASS/GO 或 invocation governance。
- 不启动 Colima/systemd/PM2/Nginx/API。
- 不执行 reserve/consume/full drill，不生成 nonce/evidence。
- 不连接 production、不部署、不进入 D3–D6。

## 验收

- helper 的 4 成功 + 10 失败离线覆盖标记为已完成。
- 精确 guest systemd package revision 保持未知，并明确真机捕获需单独授权。
- v256 标明为历史引用锚；Ubuntu 24.04 的 255.4 基线不得被扩大为 guest 已安装版本。
- `productionF1` 保持 `NO-GO`。
