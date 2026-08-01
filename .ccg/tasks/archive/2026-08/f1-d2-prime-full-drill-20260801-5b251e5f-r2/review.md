# D2′ full drill 事件 B 归档审查

## 结论

`ARCHIVE_FACTS_CONSISTENT`；事件 B 的执行结果仍为 `D2_PRIME_NO_GO`；`productionF1=NO-GO`。

本归档只纠正事件身份与治理口径，不改变 evidence 判定，也不把执行后处理可信解释为 D2′ GO。两次调用均 fail-closed，没有假 PASS。

## 调用与授权治理复核

| 事件 | 时间（+08:00） | clone 关系 | 调用结果 |
|---|---:|---|---|
| A | `00:55` 建立 clone；`00:59` 第一次调用 | 建立 `/var/lib/d2-prime-prep/fresh-retake-20260801-5b251e5f` | `PRE-NONCE NO-GO` |
| B | `01:32` 第二次调用 | 复用事件 A 的同一 clone，不是本包 fresh clone | `CGROUP_CONSISTENCY NO-GO` |

因此，事件 B 原材料中的“唯一一次 full drill”和“本包 fresh clone”不能作为跨事件事实。正确口径是：共有两次 `run.sh` 调用；第一次在 nonce 前停止，第二次生成 nonce 并进入测量阶段。复用已被前序调用使用过的 clone，且未在事件拆分与授权口径中充分披露，构成 clone 复用和授权治理偏差。

## 事件 B 证据

- nonce：`7a00c137bbdc4bbda8a73f7c285d7c1e`。
- unit：`f1-d2-managed-7a00c137bbdc4bbda8a7.service`。
- diagnostic：`D2_PRIME_NO_GO phase=MEASURE class=SYSTEM code=D2_PRIME_DRILL_FAILED step=CGROUP_CONSISTENCY`。
- evidence：mode `0600`，3237 bytes，SHA-256 `71933100cca77ea37764d4d09839b3f49824e1a1ed86b6b28f225895438a7812`。
- independent verifier：8 组 offline contract PASS；`D2_PRIME_EVIDENCE_NO_GO`；`productionF1=NO-GO`；exit `2`。
- 活动状态：unit `not-found/inactive/dead`；端口 `3010/3011/18080` 空闲；无 D2、PM2、Nginx 进程。

## Critical

无归档一致性 Critical。事件 B 演练本身必须依 evidence 保持 NO-GO。

## Warning

### W1：clone 复用与授权治理偏差

事件 B 没有获得“本包新建 fresh clone”；它在事件 A 建立且已用于第一次调用的同一路径上发起第二次调用。此前“唯一一次 / 本包 fresh clone”的口径掩盖了跨事件调用历史，现已通过独立 task ID 与 invocation audit 校正。

### W2：stale PID / cgroup consistency

事件 B 在回滚前保存 managed app PID，随后在 `CGROUP_CONSISTENCY` 阶段重新读取旧 PID 的 cgroup。PM2 日志支持旧 managed app 已停止并最终 SIGKILL，stale PID 是高置信根因；由于安全诊断不保留原始 errno，不能把 ENOENT 写成已直接观测事实。修复与 retake 必须另立任务并重新授权。

### W3：cleanup fail-closed 与法证保留

活动 unit、进程和端口已清除，但 unit 已被 systemd 收集为 `not-found`，严格 cleanup 未取得完整成功证明。nonce workspace 与 `/run/user/501/d2p-7a00c137bbdc4bbda8a73f7c285d7c1e` control root 因而保留；不应在归档任务中手工删除。

### W4：Cursor 复核副作用

Cursor 客户端误用 `pm2 ls`，临时启动 `/home/wanglei.guest/.pm2` 默认 daemon 后又关闭，`~/.pm2/pm2.log` 的 mtime 更新为 `2026-08-01 01:44:33+08:00`。该副作用未改写 D2 evidence、未形成第三次调用，也未改变 NO-GO 结论。

## 永久边界

- `productionF1=NO-GO`。
- 不进入 D3–D6。
- 未触碰或部署生产。
- 本事件不得原地修复或重跑；任何 retake 都需要新修复、新基线、新 clone、新 nonce、新 evidence 路径、新窗口与新授权。
