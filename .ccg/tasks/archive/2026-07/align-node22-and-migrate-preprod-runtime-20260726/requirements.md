# 需求与执行边界

## 目标

1. 将仓库 Node.js 运行时契约收敛到已验证的 Node 22 LTS 线，并以失败测试先证明当前契约过宽。
2. 从干净候选建立独立 Node 22 release，验证 frozen install、构建、Prisma 生成物、原生依赖和只读数据库迁移状态。
3. 在回滚点、健康门禁和候选范围全部通过后，保持预生产当前 API 代码、脚本路径和 cwd 不变，仅将 `ai-job-print-api` 的解释器显式迁移为 `/usr/local/bin/node`，并执行一次经用户授权的重启。

## 功能归位与文件预算

- 根工具链契约：`package.json`、既有依赖安全/工具链 verify（优先复用，不新增平行门禁）。
- CI：仅在现有 Node 22 配置不能表达仓库契约时修改 `.github/workflows/ci.yml`。
- 文档：`docs/progress/current-progress.md`、`docs/progress/next-tasks.md`。
- CCG：本任务目录及归档记录。
- 预生产：仅独立 release 候选、PM2 应用 runtime、必要的可回滚备份和健康检查。
- 不涉及前端页面、业务 API、数据库写入、Redis/COS/短信、账号或打印任务。

## 禁止事项

- 不在 `/srv/ai-job-print` 原地执行 `pnpm install/update` 或覆盖当前 `node_modules`。
- 不部署超出 Node 22/依赖修复范围的业务变化。
- 不运行 migration deploy、seed 或业务数据写入；数据库检查仅允许只读 status。
- 不输出 `.env`、PM2 完整环境、连接串、Token、密钥或真实用户数据。
- 不 push、不创建 PR；除非用户另行明确授权。
- 不使用“新 release 脚本 + 旧部署 cwd”的裂脑路径；本次不启用仍被正式进度标记为 production F1 NO-GO 的 Genesis，不把 Node 迁移扩大为首次流量治理切换。

## 验收门禁

- 新增/增强的工具链契约测试先 RED、实现后 GREEN。
- Node 22 + pnpm 11.2.2 frozen clean install、相关 verify、typecheck/build 通过。
- 候选相对线上来源的文件差异已审计且无业务扩张。
- 独立 release 可加载实际两套 Prisma client 与关键原生模块；数据库迁移状态只读检查通过。
- PM2 切换前建立明确回滚点；切换后解释器为 Node 22，进程稳定、restart 仅增加预期次数、local/public health 与三端 HTTP 门禁通过。
- `pm2 save` 后仅脱敏读取目标进程条目，确认绝对 Node 22 解释器、原脚本与原 cwd 已持久化；不为证明 reboot 额外执行第二次业务中断。
- 双模型分析和终审按可用性如实记录；无 Critical 未处理项。
