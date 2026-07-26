# 发布前分析结论

## 事实核验

- `origin/main=e53c1d1e`；线上 provenance 顶层 deploy 为 `83f2117f`，但完整 API 来源明确记录为 `full_api_commit=1812ba54`。
- `1812ba54..origin/main` 没有 `services/api/src` 业务源码变化；运行相关变化仅依赖安全补丁/门禁与 PostgreSQL foundation migration 历史补齐。
- 当前 PM2 直接启动 `/srv/ai-job-print/services/api/dist/main.js`，Node `20.20.2`，尚未进入仓库既有 release-provenance launcher/current 模式。

## 双模型意见与处置

- Antigravity：原“新脚本路径 + 旧 cwd”会违反 `assertPm2Snapshot`，结论 NO-GO；要求使用稳定 launcher、受校验 current、manifest 与 runtime env contract。
- Claude：认可 `>=22.13 <23`，但要求核清 root `engineStrict` 对 Windows 构建的影响、逐项加载原生模块、审计相对路径、将 migration status 作为硬门禁并验证 PM2 持久化。
- 处置：废弃裂脑 cwd 方案。真实 release 在 Node 22 fresh frozen install，逐项加载 custom Prisma/native modules，migration 只读 status 通过，manifest 创建时移除 9 个仅用于 workspace 聚合、不会被 API 解析的根链接后验证成功。由于正式进度仍明确 Genesis 仅完成离线 D1、production F1 为 NO-GO，本次不擅自把运行时升级扩大为首次治理切流；候选留作下一次正式发布输入，PM2 仅在原脚本/原 cwd 上改用绝对 Node 22 解释器。Terminal Agent 运行包仍可遵守自身 Node `>=18`，但从 monorepo 根安装/构建统一要求 Node 22。
