# F1 同机双端口 D1′ / D2′ 实施范围

## 真实上线阻塞

future-only managed Genesis / activation 当前仍复用 legacy `127.0.0.1:3010` health，无法在用户唯一一台 Linux 服务器上安全证明 legacy `3010` 与 managed `3011` 同时运行、独立 PM2 控制面、真实 Nginx 原子切流和 managed-only rollback。

## 允许范围

- `services/api/src/release-provenance/release-runtime-contract.ts`
- `services/api/scripts/verify-release-provenance.ts`
- `services/api/scripts/verify-release-genesis.ts`
- `services/api/scripts/d2-docker-drill.mjs`
- `services/api/scripts/d2-release-fixture.mjs`
- `services/api/scripts/d2-same-host/**`
- `services/api/package.json`
- `.github/workflows/ci.yml`
- 已批准计划列出的 F1 device/runbook/progress 文档
- 本任务 `.ccg/tasks/**` 元数据

## 禁止范围

- 不修改普通 API `PORT=3010` 默认行为、Genesis/activation 执行语义或 CLI 参数契约。
- 不修改 Prisma、migration、seed、worker、业务 API、前端或 Terminal Agent。
- 不 SSH、不连接生产、不操作线上 PM2/Nginx/数据库/Redis/对象存储，不执行 D3–D6。
- 不新增云主机、业务入口、依赖或第二套项目标准。

## 验收

- D1′：两个 verifier 先 RED 后 GREEN；managed health 仅精确接受 `3011`，legacy `3010` 在 runner/current/health side effect 前失败。
- D2′ offline：纯 contract/evidence validator 全绿且进入 CI，不调用 PM2/Nginx/systemd/network。
- D2′ full：只有合格非生产 Linux+cgroup v2+systemd delegation+真实 Nginx 环境中的 fresh evidence 才可标记 PASS；当前 macOS 或前置不足必须 NO-GO。
- 运行 typecheck、lint、build、相关 verifier、`git diff --check`，并完成 Claude、Antigravity、Cursor 交叉审查。

## 已读取规范

- `.ccg/spec/guides/index.md`
- `docs/superpowers/specs/2026-07-30-f1-same-host-dual-port-managed-topology-design.md`
- `docs/superpowers/plans/2026-07-30-f1-same-host-dual-port-d1-prime-implementation.md`
