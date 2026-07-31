# D2′ fresh retake（5b251e5f）PRE-START 合并审查

## 结论

`PRE_START_GO`

- Claude：`PRE_START_GO`，无 Critical；node-only contract 8 组全部 PASS。
- Antigravity：`PRE_START_GO`，无 Critical / Warning。
- Cursor：CLI 返回空文本后按用户授权切换客户端；客户端给出 `PRE_START_GO`，无 Critical，3 项非阻断提示。
- Codex 本地复验：`D2_PRIME_CONTRACT_ALL_PASS`；`HEAD == origin/main == 5b251e5f7085e4a1d2e12b1ea150eb6fd3cf3df9`；tracked tree 干净；Colima 未运行；fresh clone 与 evidence 均不存在。

新精确包可以提交用户再次授权，但当前结论不等于演练授权，不得据此启动 Colima 或 full drill。

## Critical

无。

## Warning

### W1：必须显式固定 evidence 路径

`run.sh:314-317` 的默认路径带当前 UTC 时间戳；文件存在门禁只能阻止同一路径重跑。因此“full drill 最多一次”必须由执行包显式传入：

`D2_EVIDENCE_OUT=/var/lib/d2-prime-prep/fresh-retake-20260801-5b251e5f/services/api/scripts/d2-same-host/.evidence/d2-prime-evidence-20260731T173000Z.json`

首次 full drill 无论 PASS 或 NO-GO 都消耗唯一机会；不得换路径重跑。

## Info

- `contract.mjs:142-168,338-399` 从原始测量派生 verdict，并重新派生校验，无法通过篡改单一布尔值制造 PASS。
- `diagnostics.mjs:188-263` 只输出白名单 phase/class/code/step；`verify-contract.mjs:635-783` 覆盖秘密、路径、nonce、hostname、pid、异常 getter 与 revoked proxy，不输出原始错误内容。
- `drill.mjs:479-495` 在失败时写 schema 化 NO-GO evidence；若 evidence 已存在或写入失败则显式标记 failure-evidence write failure，不静默覆盖。
- `diagnostics.mjs:201,224-237` 强制 MEASURE 与非 NONE step 的双向不变量；非 MEASURE phase 会把 step 归一化为 NONE。
- `verify-contract.mjs:137-188` 锁定 cleanup、严格 inactive 证明与 `verify → trap disarm → cleanup → PASS` 顺序，并以负向 mutation 防止放宽。
- Cursor 提示 `.env.example` 相对位置、延迟指标 stdout 与 PATH/version 调用。复核后均不构成当前阻断：缺失 `.env.example` 会使同步读取直接失败；延迟输出只有数值；PATH 在版本探测前已锁定。保留为未来重构/采集日志时的复核点。

## 精确执行边界

- 基线：`5b251e5f7085e4a1d2e12b1ea150eb6fd3cf3df9`
- 窗口：`2026-08-01T01:30:00+08:00` 至 `2026-08-01T03:30:00+08:00`
- clone：`/var/lib/d2-prime-prep/fresh-retake-20260801-5b251e5f`
- evidence：`/var/lib/d2-prime-prep/fresh-retake-20260801-5b251e5f/services/api/scripts/d2-same-host/.evidence/d2-prime-evidence-20260731T173000Z.json`
- nonce：由 `run.sh` 新生成。
- full drill：最多一次。
- 永久结论边界：`productionF1=NO-GO`；不进入 D3–D6；不触碰生产。

---

# POST-RUN 合并审查

## 结论

本次 D2′ 结果为明确 `NO-GO`；执行后处理与 evidence 可复验、保持 fail-closed，没有假 PASS。三模型标签口径不同但事实一致：

- Antigravity：`POST_RUN_REVIEW_NO_GO`，以 D2′ 业务结果为判定对象；确认 evidence、清理保留和禁止重跑边界可信。
- Claude：`POST_RUN_REVIEW_GO`，明确 GO 只评价执行后处理可信，不代表 D2′ 或 production GO。
- Cursor：`POST_RUN_REVIEW_GO`，同样只评价复核流程可信；独立复跑 8 组 offline contract 与 evidence verifier，确认 exit `2`、`productionF1=NO-GO`。

综合判定：`POST_RUN_HANDLING_GO`；`D2_PRIME_NO_GO`；`productionF1=NO-GO`。

## 证据

- 唯一 full-drill nonce：`7a00c137bbdc4bbda8a73f7c285d7c1e`。
- unit：`f1-d2-managed-7a00c137bbdc4bbda8a7.service`。
- diagnostic：`D2_PRIME_NO_GO phase=MEASURE class=SYSTEM code=D2_PRIME_DRILL_FAILED step=CGROUP_CONSISTENCY`。
- evidence：mode `0600`，3237 bytes，SHA-256 `71933100cca77ea37764d4d09839b3f49824e1a1ed86b6b28f225895438a7812`。
- independent verifier：8 组 offline contract PASS；`D2_PRIME_EVIDENCE_NO_GO`；`productionF1=NO-GO`；exit `2`。
- 活动状态：unit `not-found/inactive/dead`；端口 `3010/3011/18080` 空闲；无 D2、PM2、Nginx 进程。
- 法证保留：nonce workspace 与 `/run/user/501/d2p-7a00c137bbdc4bbda8a73f7c285d7c1e` control root 仍存在。

## Critical

无执行后处理 Critical；本次演练本身按证据必须保持 NO-GO。

## Warning

### W1：回滚前 PID 在回滚后被再次读取

`drill.mjs` 在回滚前保存 `managedAppPidBeforeRollback`，随后在 `CGROUP_CONSISTENCY` 阶段重新读取 `/proc/<旧PID>/cgroup`。保留 PM2 日志证明旧 managed app 在该时段被停止并最终 SIGKILL；`class=SYSTEM` 与原生文件系统 errno 分类一致。因此 stale PID 是高置信根因。由于安全诊断有意不保留原始 errno，不能仅凭 evidence 声称已直接观测到 ENOENT；精确修复必须在新 TDD 任务中复现。

### W2：cleanup 正确 fail-closed，但未证明完整成功

活动 unit、进程和端口已清除；journal 同时记录 `Failed to kill control group ... Invalid argument`。cleanup 因 unit 已被 systemd 收集为 `not-found` 而没有获得其要求的严格成功证明，故保留 workspace/control root。该保留符合现有 fail-closed 合同，不应在本任务手工删除。

### W3：Cursor 复核产生并恢复了额外本机态

Cursor 客户端误用 `pm2 ls`，临时启动 `/home/wanglei.guest/.pm2` 默认 daemon，随后立即关闭；最终进程核验无 PM2 残留，但 `~/.pm2/pm2.log` 的 mtime 更新为 `2026-08-01 01:44:33+08:00`。该副作用不改写 D2 evidence、不增加 full-drill 次数，也不影响 NO-GO 结论；已如实写入正式进度。

## Info

- failure evidence 使用 `createFailureMeasurements()` 的安全哨兵值，有意不保存故障瞬间的部分真实测量；这些哨兵不能被解释为性能或隔离测量结果。
- 新的修复任务应同时覆盖 stale-PID/cgroup 生命周期不变量，以及 unit 已被收集时 cleanup 成功与法证保留的契约。
- 任意后续 retake 必须先完成代码修复、测试、三模型审查与新提交，再申请新的 baseline、fresh clone、nonce、evidence 路径和 RFC3339 窗口授权。本任务禁止重跑。
- 最终两份正式进度文档的精确 diff 已获 Antigravity `APPROVE`（Critical 0、Warning 0），Cursor 客户端也读取并确认一致。Claude 的 post-run 事实审查已为 `POST_RUN_REVIEW_GO`；随后追加的精确文档复审因开始越界搜索本机临时目录而被 Codex 主动中止，不把该次未完成调用伪造成批准。
