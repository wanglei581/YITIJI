# D1′ 批次审查记录

审查范围：`698f91da^..61ac7480`，并包含 Claude Info 后续修正 `90020533`。

## 结论

- Claude：`APPROVE`；Critical 0，Warning 0。
- Antigravity：`APPROVE`；Critical 0，Warning 0。
- Cursor：`APPROVE`；Critical 0，Warning 3，均已关闭或有明确边界。
- Codex：相关 verifier、typecheck、lint、build 与 shared fixture offline provenance smoke 通过；旧 Docker D2 因 daemon 未启动返回 `D2_DOCKER_DAEMON_DOWN`，不计 PASS。

## 已确认

- managed health 只接受精确 `http://127.0.0.1:3011/api/v1/health`。
- Genesis/activation 在 runner、current、health、lock、control side effect 前拒绝 legacy `3010`。
- 两条负例路径显式注入 fake runner/probe，不会请求本机 `3010` 或调用真实 PM2。
- shared builder 保留 manifest/tree/archive/guard/launcher/runtime contract 语义，且离线 provenance 验证通过。
- RED commit `698f91da` 仍保留 runtime `3010`，两个 `3011` 正例真实失败；GREEN commit `49d78ff2` 才翻转 shared constant。

## Cursor Warning 关闭说明

1. 两个 verifier 各自保留同一拒绝矩阵是批准计划 Task 2 的独立一阶契约要求，避免一个 verifier 的 helper 漂移让两条门禁同时误绿；D2′ 不再复制该表。
2. `verify-release-genesis.ts` 当前 797 行，未越过 800 行硬阈值；本任务不再向该文件增加 D2′ 逻辑，后续新增验证必须独立文件。
3. `assertLocalHealthUrl()` 已在所有 filesystem mutation、lock、runner/current/health side effect 前执行；此前的纯字符串/path/PM2 name 校验无副作用，符合设计与测试目标。

## Claude Info 修正

Claude 指出 shared fixture 顶层曾返回非 canonical `artifactRoot`，而 build 结果返回 canonical root。旧 D2 未使用该字段；`90020533` 已删除含糊的顶层字段，复跑 `D2_RELEASE_FIXTURE_REVIEW_SMOKE_PASS`。

其余 Info（Genesis 控制文件名为测试字面量、D2′ runtime contract 必须包含 `PATH`/`HOME`/`PM2_HOME`）纳入后续实现检查，不构成 D1′ 阻塞。

# D2′ 离线合同批次审查记录

审查范围：`bdcb731e` 的 RED 测试，以及当前 GREEN 实现 `contract.mjs`、`verify-contract.mjs`、package/CI 接线与局部 `.gitignore`。

## 结论

- Claude：`APPROVE`；Critical 0，Warning 0，Info 1。
- Antigravity：`APPROVE`；Critical 0，Warning 0。
- Cursor：`APPROVE`；Critical 0，Warning 2。
- Codex：离线合同、package script、语法检查和 `git diff --check` 全部通过。

## 已确认

- 合同模块仅依赖 `node:path`，测试仅依赖 `node:assert/strict`；CI 不启动 PM2、Nginx、systemd，不发网络请求。
- Nginx renderer 只能生成单一 legacy `127.0.0.1:3010` 或 managed `127.0.0.1:3011` 目标，并拒绝 mixed/unsafe 输入。
- 切换确认后只能回到 managed previous release，状态机不存在回旧 legacy 的转换。
- evidence 采用精确字段白名单；validator 从 raw measurement 重算所有派生布尔值和 verdict，拒绝字段注入与布尔伪造。
- `productionF1` 无论演练结果均固定为 `NO-GO`。

## Info / Warning 关闭说明

1. `drill:d2-same-host` 暂时指向尚未创建的 `run.sh`，属于批准计划 Task 7 的下一步产物；它未接入 CI，本批次不误报 D2′ PASS。Task 7 补齐后再验证入口。
2. Cursor 提到显式 sibling-boolean spoof 表只列四项；现有测试已对其余每个 raw field 从 PASS evidence 单独篡改且保留原派生布尔为 true，因此已经覆盖同类伪造，validator 的 `booleansMatch` 也逐字段重算，不再增加重复用例。
3. `.gitignore` 仅忽略该演练器将产生的 repo-local `.work/` 与 `.evidence/`，不扩大到项目其他目录。

# D2′ Linux 候选演练器批次审查记录

审查范围：`653ea4c5`，以及该提交前完成的 TDD 修正。

## 结论

- Claude：最终 `APPROVE`；Critical 0，Warning 0。
- Cursor 客户端：最终 `APPROVE`；Critical 0，Warning 0。
- Antigravity CLI：最后一份有效报告为 `APPROVE`，其指出的 PM2 PID 就绪竞争已修复；修正后的最终复核连续三次因 quota/resource limit 失败，未产生报告，因此不把失败调用计为批准。
- Codex：语法、release provenance、Genesis、D2′ offline contract、typecheck、lint、build 与 failure evidence 定点测试通过；macOS full drill 按设计返回 `D2_PRIME_NO_GO_ENVIRONMENT` / exit 2，且未留下 `.work` / `.evidence`。

## 审查驱动修正

1. 将 systemd/cgroup 演练限值固定为 `MemoryMax=256MiB`、`CPUQuota=25%`、`TasksMax=64`、`LimitNOFILE=256`，并由 evidence validator 重算。
2. 生产环境变量拒绝从“非空值”收紧为“只要变量已定义（包括空串）即拒绝”。
3. managed keeper 增加 PM2 daemon PID 就绪等待，再写 ready marker，避免 PID 文件短暂缺失造成误失败。
4. failure evidence 不再复用可能已形成 PASS 的实时 measurements；先用 RED 测试证明漏洞，再以固定脱敏 failure measurements 生成并强制验证 `D2_PRIME_NO_GO`。
5. cleanup 对演练 Nginx、两套 PM2、transient unit 与 nonce workspace 使用精确 PID/name；残留时保留 workspace 并 exit 2。

## 状态边界

- 候选实现和离线合同已通过本地门禁，不等于 D2′ PASS。
- 当前没有合格非生产 Linux+cgroup v2+user systemd delegation/linger+真实 Nginx 的 fresh evidence，D2′ 继续 `NO-GO / 未完成`。
- production F1 与 D3–D6 继续 `NO-GO`；未 SSH、未操作线上服务器、未新增云主机。

# 文档与 SSOT 终审记录

审查范围：同机双端口 D2′ runbook、旧 Docker D2 runbook、production deployment runbook、D3 inputs/approval package、历史计划 supersession 与 progress 文档。

## 结论

- Cursor 客户端：`APPROVE`；9 项口径检查无矛盾，无 Critical/Warning。
- Claude：首轮 `REQUEST_CHANGES`，准确指出旧 Docker D2 已改为 managed `3011` 而 runbook 仍写 `3010`；两处修正后复核 `APPROVE`，Critical 0，Warning 0。
- Antigravity CLI：本轮调用因 quota/resource limit 失败，无有效报告，不计为批准。

## 已关闭问题

- 旧 Docker D2 的 health 与单 managed 端口统一为 `3011`，同时明确它不能替代同 namespace 双端口 D2′。
- D2′ runbook 分别列明 full drill 的 `D2_PRIME_PASS` / `productionF1=NO-GO` 与独立 verifier 的三行输出。
- override 路径约束不再错误宣称必须 repo-local；保留绝对路径、owner、权限、端口和独立 evidence 目录约束。
- SSOT 统一为同一现有 production host 上 legacy `3010` + managed `3011`；不要求新增云主机；D5 确认前 100% legacy，确认后 managed-only；D2′、production F1、D3–D6 均保持 NO-GO。

# 最终验证

- `pnpm --filter @ai-job-print/api typecheck`：PASS。
- `pnpm --filter @ai-job-print/api lint`：PASS。
- `pnpm --filter @ai-job-print/api build`：PASS。
- `pnpm --filter @ai-job-print/api verify:release-provenance`：ALL PASS。
- `pnpm --filter @ai-job-print/api verify:release-genesis`：ALL PASS。
- `pnpm --filter @ai-job-print/api verify:d2-same-host-contract`：`D2_PRIME_CONTRACT_ALL_PASS`。
- `bash -n` 与两个候选 `.mjs` 的 `node --check`：PASS。
- macOS `drill:d2-same-host`：按设计 `D2_PRIME_NO_GO_ENVIRONMENT` / exit 2；无 `.work` / `.evidence` 残留。
- Docker daemon 未运行，旧 Docker D2 未获得 fresh PASS；不影响 D1′/offline contract，但不得把旧 D2 写成 D2′ PASS。
- `git diff --check` / `git diff --cached --check`：PASS。

本任务完成的是 D1′、D2′ offline contract、Linux 候选演练器与 SSOT 收口；D2′ full drill 明确作为后续独立环境任务保持 NO-GO，不虚报完成。
