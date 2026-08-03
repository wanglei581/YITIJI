# D2′ 调用审计：事件 B

## 审计目的

本文件只记录事件 B 与前序事件 A 的调用关系，用于纠正“唯一一次 / 本包 fresh clone”的错误口径。它不授权任何新演练、修复、清理或外部动作。

## 时间线

1. `2026-08-01 00:55+08:00`：事件 A 建立 `/var/lib/d2-prime-prep/fresh-retake-20260801-5b251e5f`。
2. `2026-08-01 00:59+08:00`：事件 A 在该 clone 发起第一次调用；调用在生成 nonce 前以 `PRE-NONCE NO-GO` fail-closed。
3. `2026-08-01 01:32+08:00`：事件 B 对同一 clone 路径发起第二次调用；该 clone 不是事件 B 执行包新建的 fresh clone。
4. 事件 B 生成 nonce `7a00c137bbdc4bbda8a73f7c285d7c1e`，随后在 `CGROUP_CONSISTENCY` 阶段 fail-closed。
5. 事件 B evidence SHA-256 为 `71933100cca77ea37764d4d09839b3f49824e1a1ed86b6b28f225895438a7812`，独立 verifier 返回 NO-GO、exit `2`，`productionF1=NO-GO`。

## 计数口径

- `run.sh` 调用总数：2。
- 事件 A：第 1 次调用，PRE-NONCE 停止，无 nonce。
- 事件 B：第 2 次调用，生成 1 个 nonce 并形成 1 份 NO-GO evidence。
- 没有第三次调用，没有失败后的原地 retake。

因此可以说事件 B 只有一个 nonce 与一份 evidence，但不能说跨事件只有一次调用，也不能说事件 B 使用了“本包 fresh clone”。

## 治理偏差

- clone 复用：事件 B 使用事件 A 建立且已用于第一次调用的 clone。
- 授权口径：事件 B 材料未充分披露第一次调用与 clone 来源，导致“唯一一次 / 本包 fresh clone”叙述失真。
- 归档身份：事件 A、B 原先共用 task ID，容易覆盖事件边界；现以 `precedingTaskId` 保留关联，并将事件 B 迁至独立 task ID。

这些偏差不改变两次调用均 fail-closed 的安全事实，也不把事件 B 的 NO-GO 降级为不确定结果。

## 清理与副作用

- 事件 B 后活动 unit、D2/PM2/Nginx 进程及端口 `3010/3011/18080` 已清除。
- 严格 cleanup 因无法证明完整成功而 fail-closed；nonce workspace 与 `/run/user/501/d2p-7a00c137bbdc4bbda8a73f7c285d7c1e` control root 保留用于法证，不应手工删除。
- Cursor 复核中的 `pm2 ls` 临时启动默认 PM2 daemon 后已关闭，并更新 `~/.pm2/pm2.log` mtime；这不是新的 D2 调用，未改写 evidence，未改变 `productionF1=NO-GO`。

## 不可越过的结论

- 两次调用均 fail-closed。
- `D2_PRIME_NO_GO`。
- `productionF1=NO-GO`。
- 无 D3–D6，无生产部署或生产接触。
