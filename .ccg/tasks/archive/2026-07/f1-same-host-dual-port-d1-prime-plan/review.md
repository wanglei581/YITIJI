# F1 D1′ + D2′ 实施计划多模型审查

## 结论

- Codex：APPROVE
- Claude：APPROVE；Critical 0
- Antigravity：APPROVE；Critical 0
- Cursor：首轮 REQUEST_CHANGES，修订后 APPROVE；最终 Critical 0
- 收口后开放 Critical：0
- 收口后开放 Warning：0

## 已关闭问题

### Cursor 首轮 Critical

1. 双 PM2 daemon 编排未闭合：计划现已显式固定 legacy/managed `HOME`、`PM2_HOME`、`PATH`，定义 legacy 对称启动序、managed systemd keeper ready 后再 Genesis，并要求 release runtime contract 显式包含相同 managed `PM2_HOME`。
2. synthetic release 构建路径不明确：计划现已新增共享 `d2-release-fixture.mjs`，要求从旧 D2 等价抽取合规 builder，旧 D2 与 D2′ 共用同一 source tree/manifest/artifact/guard/launcher/runtime-contract 模式。

### Claude Warning

1. evidence 自证风险：`validateEvidence()` 必须从 namespace inode、PM2/cgroup membership、systemd effective limits、`nr_throttled` 前后值和 Nginx observed target tags 重新推导所有硬布尔值，并拒绝 raw/boolean 不一致。
2. RED 阶段真实 HTTP 风险：Genesis/activation `3010` 负例必须显式注入 fake runner 和计数型 fake probe，禁止默认 system runner/probe。
3. Genesis RED 信号间接：两套 verifier 均增加直接 exact-equality contract table。
4. 中间 commit CI 断裂：RED verifier 保持未接线；只有 `contract.mjs` GREEN 后才一次性修改 package/CI，任一 commit 均保持通用 CI 可运行。

### Antigravity / Cursor 最终 Warning

1. headless systemd user manager：计划增加 user bus/Linger 只读探针；失败 NO-GO，禁止脚本自行 enable-linger。
2. cwd 与绝对路径：`run.sh` 固定从 `BASH_SOURCE[0]` 解析 `SCRIPT_DIR`/`API_DIR`/`ROOT`/evidence/work roots，systemd 使用绝对 working directory/script。
3. Genesis 只读顺序描述：修正为 invalid health 在 control-root/launcher/candidate realpath 之前失败。
4. keeper 握手未定义：增加 nonce-scoped ready/stop marker 的 exact keys、`wx`、15 秒超时、PID/nonce/home 校验和 fail-closed cleanup。
5. builder 抽取可选：改为强制共享 `d2-release-fixture.mjs` 并规定旧 D2 回归命令。
6. full evidence 独立复核：drill 在 PASS 前内部校验，随后 `verify-contract.mjs --evidence <absolute-path>` 从磁盘二次校验。

## 新鲜验证

- `pnpm --filter @ai-job-print/api verify:release-provenance`：PASS / `=== ALL PASS ===`
- `pnpm --filter @ai-job-print/api verify:release-genesis`：PASS / `=== ALL PASS ===`
- `pnpm --filter @ai-job-print/api typecheck`：PASS
- Prettier：plan/current-progress/next-tasks 已格式化
- `git diff --check`：PASS

## 边界

本任务只完成实施计划、进度 SSOT 和 CCG 证据；没有修改运行时代码、fixture、CI 或 runbook，没有执行 D2′、PM2、Nginx、systemd、Docker、SSH 或任何生产动作。D1′、D2′、production F1、D3–D6 仍未完成/未授权。
