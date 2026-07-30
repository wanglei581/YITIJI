# 审查记录

## 候选与范围

- 基线：`origin/main@7b33447d38f16c9e251802052d2c95e9fe6df0d9`
- 本地分支：`codex/f1-d2-prime-main-integration-20260731`
- 仅修改 D2 same-host 四脚本、四份治理文档和正式计划；未触碰业务代码、数据库、生产配置、密钥或远端资源。
- 未运行 full drill、PM2、systemd、Nginx、SSH 或任何生产操作。

## 分析与实施

- Antigravity 与 Claude 分析均推荐方案 A：精确移植 `166fe9dc3f612d8b6780951261d23540568a456b` 的运行时内容，在最新主线上手工协调文档，不 cherry-pick 旧文档提交。
- 初始四文件 blob 与 `166fe9dc` 对齐后，只在已审范围内按 RED→GREEN 增加安全修复与合同。
- 规格审查最终 PASS：Critical 0 / Warning 0 / Info 0。
- 质量审查先发现 user-systemd CLI、transient unit ambient environment 与 systemd 参数展开风险；均按 RED→GREEN 修复并复审至 Critical 0 / Warning 0。
- 第一轮外部最终审查：Antigravity APPROVE（0/0）；Claude APPROVE，但提示 preflight 版本门禁延迟和 ExecStart 环境未净化两个非阻塞 Warning。
- 两项 preflight Warning 随后按 TDD 关闭：preflight 同样使用 `--expand-environment=no`，捕获并校验绝对 `SLEEP_BIN`，实际命令通过绝对 `ENV_BIN -i` 仅显式传入 `PATH`。
- 最终外部复审：Antigravity APPROVE（Critical 0 / Warning 0）；Claude APPROVE（Critical 0 / Warning 0）。Claude Info 仅提醒提交时必须包含 `procfs.mjs`，以及旧 systemd 会在 preflight fail-closed。

## TDD 与验证

- user-systemd / managed transient unit 合同：RED exit 2，修复后 GREEN。
- `--expand-environment=no` 参数顺序合同：RED exit 2，修复后 GREEN。
- preflight 最小环境合同：RED exit 2，修复后 GREEN。
- `bash -n services/api/scripts/d2-same-host/run.sh`：PASS。
- `node --check`（`drill.mjs`、`procfs.mjs`、`verify-contract.mjs`）：PASS。
- `pnpm --filter @ai-job-print/api verify:d2-same-host-contract`：PASS，输出 `D2_PRIME_CONTRACT_ALL_PASS`。
- API `typecheck`、`build`、`lint`：串行 PASS。曾将 build 与 lint 并行运行时触发 Prisma generated tree 读写竞态；改为串行后通过，未修改代码掩盖该环境竞态。
- 历史 Lima evidence 只读兼容验证：`evidenceVerdict=D2_PRIME_PASS`、`productionF1=NO-GO`、`D2_PRIME_EVIDENCE_PASS`。该结果只证明历史 evidence 格式与验证器兼容，不证明当前候选运行通过。
- `git diff --check`、文件白名单与差异 secret 扫描：PASS。

## 最终事实边界

- 历史 Colima NO-GO 和历史 `166fe9dc` Lima PASS 均保留。
- 当前精确加固候选没有自己的 fresh full-drill evidence，因此其 D2′ 状态为 **NO-GO / 待验证**。
- `productionF1` 始终 **NO-GO**；D3 未授权。
- 后续必须依次取得：推送授权、精确 commit/CI、新非生产 retake 独立授权与 fresh PASS、D3 独立授权。

## Spec 回馈

本次安全约束已完整固化在 D2 专用 runbook 与离线合同中；未发现需要扩展到全项目通用规范且不重复的内容，因此未修改 `.ccg/spec/`。
