# D2′ full drill 事件 B 归档要求

## 目标

把 PR #454 中原先与事件 A 共用 task ID 的事件 B 独立归档，纠正 clone 来源、调用次数与授权治理口径，同时保留真实执行、安全边界、清理和审查事实。

## 事件关系

- 前序事件 A：`f1-d2-prime-fresh-retake-20260801-5b251e5f`。
- 事件 A 于 `2026-08-01 00:55+08:00` 建立 clone：`/var/lib/d2-prime-prep/fresh-retake-20260801-5b251e5f`。
- 事件 A 于 `2026-08-01 00:59+08:00` 发起第一次调用，结果为 `PRE-NONCE NO-GO`，未生成 nonce。
- 事件 B 于 `2026-08-01 01:32+08:00` 复用事件 A 建立的同一 clone 路径发起第二次调用，并非在本执行包中新建 fresh clone。
- 事件 B nonce：`7a00c137bbdc4bbda8a73f7c285d7c1e`。
- 事件 B evidence SHA-256：`71933100cca77ea37764d4d09839b3f49824e1a1ed86b6b28f225895438a7812`。
- 事件 B 结果：`D2_PRIME_NO_GO phase=MEASURE class=SYSTEM code=D2_PRIME_DRILL_FAILED step=CGROUP_CONSISTENCY`。

此前将事件 B 描述为“唯一一次 full drill”或“本包 fresh clone”的口径不准确：跨事件看，`run.sh` 调用共有两次；事件 B 使用的是事件 A 已建立并使用过的 clone。这构成 clone 复用和授权治理偏差，必须在独立 task ID 下如实归档。

## 安全事实与永久边界

- 两次调用均 fail-closed，没有形成假 PASS。
- 事件 A 在 nonce 前停止；事件 B evidence 可独立复验为 NO-GO，verifier exit `2`。
- `productionF1=NO-GO` 永久保持；未进入 D3–D6，未部署或接触生产。
- 事件 B 清理后活动 unit、进程和端口已清除；严格 cleanup 未能证明完整成功，因此 nonce workspace 与 control root 作为法证目录保留，未手工删除。
- Cursor 复核曾因 `pm2 ls` 临时启动默认 PM2 daemon，随后关闭；其日志 mtime 发生变化，但未改写 evidence、未增加调用次数、未改变 NO-GO 结论。

## 归档边界

- 本任务只重建事件 B 的归档材料，不运行演练、不启动 Colima、不执行任何外部动作。
- 不把事件 A 的首次调用覆盖、吸收或改写为事件 B。
- 不补写新的 secret、原始错误内容或额外敏感路径。
- 不把执行后处理可信解释为 D2′ GO 或 production GO。

## 验收标准

1. 事件 B 使用独立 task ID `f1-d2-prime-full-drill-20260801-5b251e5f-r2`，并关联前序事件 A。
2. 五份归档文件对两次调用、clone 复用、nonce、evidence SHA 与 NO-GO 结果表述一致。
3. fail-closed、`productionF1=NO-GO`、无生产/无 D3–D6、法证保留与 Cursor 副作用均有记录。
4. 不含冲突标记；仅允许主代理在既有 merge 中暂存事件 B 归档与两份正式 progress 文档，禁止其他 index、历史或范围外变更。
