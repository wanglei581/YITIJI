# 双模型终审

## 结论

Antigravity 与 Claude 均为 `APPROVE`，Critical 0、Warning 0。

## 核对结果

- `docs/progress/current-progress.md` 顶部新真值准确说明 PR #466 已把 helper 统一到 `stop_user_unit_and_prove_inactive`，并完成 fake `systemctl` 的 4 成功 + 10 失败分支覆盖。
- `docs/progress/next-tasks.md` 已把原混合待办拆为：helper 离线演算 `[x]`；精确 systemd package revision 与最小真实 Linux 验证 `[ ]`。
- Ubuntu 24.04 / systemd 255.4 只作为发行版与上游基线；guest 精确 `255.4-1ubuntu8.x` 修订继续标为未知，v256 只作为 PR #464 历史源码引用锚。
- PR #464 历史条目保留当时真实存在的 `user_unit_collected_absent`，顶部新真值明确其后由 PR #466 统一，不构成误导。
- 变更只有两份 `docs/progress/` 文档；无 runtime、测试、evidence schema、PASS/GO 或 invocation governance 变更。
- 未启动 Colima，未 reserve/consume/full drill，未生成 nonce/evidence，未连接 production；`productionF1` 保持 `NO-GO`。

## 新鲜验证

- `git diff --check`：exit 0
- `bash -n services/api/scripts/d2-same-host/run.sh`：exit 0
- `node --check services/api/scripts/d2-same-host/verify-cleanup-contract.mjs`：exit 0
- `node services/api/scripts/d2-same-host/verify-contract.mjs`：11/11 PASS，`D2_PRIME_CONTRACT_ALL_PASS`

## 非阻塞 Info

后续单独授权真机验证时，应同时记录 guest 精确 package revision 及其对应 Ubuntu source package/patch set 引用，闭合 v255.4 源码锚。本项不允许据此提前启动 Colima 或改动 PASS/GO。
