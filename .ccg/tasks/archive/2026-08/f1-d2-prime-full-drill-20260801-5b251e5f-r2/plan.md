# D2′ full drill 事件 B 归档计划

## Task 1：拆分事件身份

- [x] 保留事件 A 的 task ID：`f1-d2-prime-fresh-retake-20260801-5b251e5f`。
- [x] 为事件 B 建立独立 task ID：`f1-d2-prime-full-drill-20260801-5b251e5f-r2`。
- [x] 在事件 B 的 `task.json` 中用 `precedingTaskId` 明确关联事件 A。

## Task 2：校正调用与 clone 时间线

- [x] 记录事件 A 在 `00:55` 建立 clone。
- [x] 记录事件 A 在 `00:59` 发起第一次调用并以 `PRE-NONCE NO-GO` fail-closed。
- [x] 记录事件 B 在 `01:32` 复用同一 clone 路径发起第二次调用。
- [x] 撤销“唯一一次 / 本包 fresh clone”的错误表述，并标记 clone 复用和授权治理偏差。

## Task 3：固化事件 B 结果

- [x] 记录 nonce `7a00c137bbdc4bbda8a73f7c285d7c1e`。
- [x] 记录 evidence SHA-256 `71933100cca77ea37764d4d09839b3f49824e1a1ed86b6b28f225895438a7812`。
- [x] 记录 `CGROUP_CONSISTENCY` 阶段的明确 NO-GO。
- [x] 保留 verifier exit `2`、`productionF1=NO-GO`、无 D3–D6 和无生产动作事实。

## Task 4：固化清理与审查事实

- [x] 记录活动 unit、进程和端口已清除。
- [x] 记录严格 cleanup fail-closed 及 nonce workspace/control root 法证保留。
- [x] 记录 Cursor `pm2 ls` 的临时 daemon 与日志 mtime 副作用，以及其未影响 evidence、调用次数和 NO-GO 结论。

## Task 5：归档校验

- [x] 五份文件只使用事件 B 原材料与已确认的事件关系事实。
- [x] 文件之间 task ID、时间线、结果和安全边界一致。
- [x] 未执行演练、Colima、commit、push 或其他外部动作；仅由主代理暂存预期 merge resolution 文件。
