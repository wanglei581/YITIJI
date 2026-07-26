# 执行前审查与只读预检结论

## 结论

**BLOCKED / 未执行升级。** 预生产默认 Node 为 `v20.20.2`，目标 `pnpm@11.2.2` 发布包的官方 `engines.node` 为 `>=22.13`。当前 pnpm 由 `/usr/bin/corepack` 管理，默认版本为 `9.15.4`，服务器未发现可用的并列 Node 22 安装。直接激活目标版本会使默认 pnpm 落入不兼容运行时，因此命中双模型审查预先规定的停止条件。

## 双模型审查

- Antigravity：要求识别唯一安装来源、沿同一机制升级、记录应用与 PM2 基线；Node 不满足目标版本要求时停止。
- Claude：同样将 Node engine 不兼容列为 Critical 停止条件，明确不得在本任务中顺手升级 Node、Corepack 或引入第二套 pnpm 来源。

## 只读证据摘要

- Node：`v20.20.2`，唯一解析路径为系统 Node。
- pnpm：`9.15.4`，Corepack shim；npm global 未安装独立 pnpm。
- 目标包：registry metadata 与发布 tarball 内 `package.json` 均确认 `pnpm@11.2.2`、`engines.node >=22.13`。
- 应用：`package.json`、`pnpm-lock.yaml`、`DEPLOY_SOURCE.txt` SHA-256 与 mtime 前后完全一致；`node_modules` 顶层 mtime 未变。
- PM2：`ai-job-print-api` 前后均为同一 PID、restart count `25`、`online`、`unstable_restarts=0`。
- 健康：本机 API、公网 API、Kiosk、Admin、Partner 前后均 HTTP 200。
- 未运行 Corepack 激活、npm 全局安装、pnpm install/update、构建、部署、迁移、seed、服务重启或业务写操作。

## 下一步

必须另开高风险工具链任务，先制定并获得用户对 Node `>=22.13` 升级或受控并列运行方案的明确授权；方案须包含 Node 20 回滚、Corepack 兼容性验证、PM2 不重启约束和新 SSH 会话验证。该授权完成前不得切换 pnpm。

## 文档终审

- Claude：`APPROVE`，Critical 0、Warning 0；确认事实、阻塞状态、授权边界和无秘密记录一致。
- Antigravity：已按双模型模板调用，但因账号/资格服务异常未返回有效模型报告；不得记为双模型终审通过。执行前 Antigravity 分析报告已成功返回，并同样把 Node 不兼容列为停止条件。

## 后续解除阻塞

用户随后明确授权独立的 Node 22 工具链升级任务。该任务以不替换 `/usr/bin/node` 的 `/opt` 并列安装、PM2 Node 20 PATH 固定和 Corepack 单轨切换完成目标；新 SSH 默认 pnpm 已为 `11.2.2`，本任务原始阻塞已解除。详细执行与验证证据见同日 `upgrade-preprod-node22-toolchain-20260726` 任务。
