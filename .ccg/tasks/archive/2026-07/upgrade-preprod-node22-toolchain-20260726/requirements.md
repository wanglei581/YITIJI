# 需求与边界

## 授权目标

用户已明确授权在预生产受控升级 Node 22 工具链，然后激活 `pnpm@11.2.2`。目标版本使用 Node.js 官方当前 Node 22 LTS `v22.23.1`；仅在官方制品、SHA-256、系统兼容性和回滚条件均验证通过后执行。

## 允许

- 只读盘点 OS、架构、glibc、Node/npm/Corepack/pnpm 安装来源、PATH、PM2 与 health。
- 从 Node.js 官方 HTTPS 地址获取精确版本二进制和官方 SHASUMS，并验证 SHA-256。
- 采用不替换系统 `/usr/bin/node` 的并列 `/opt` 安装，通过 `/usr/local/bin` 精确软链把新 SSH 默认工具链切到 Node 22；保留现有 Node 20 软件包作为即时回滚。
- 在切换默认 PATH 前，为 `pm2-root.service` 增加仅固定其 PATH 优先 `/usr/bin` 的 systemd drop-in，并执行不重启服务的 `systemctl daemon-reload`；防止未来 reboot / daemon 自恢复把现有应用运行时静默迁移到 Node 22。该 drop-in 不修改 ExecStart、不重启或 reload PM2。
- 使用 Node 22 自带 Corepack，只激活 `pnpm@11.2.2`；激活前备份 Corepack `lastKnownGood.json`，回滚时恢复旧 `pnpm@9.15.4` 默认值。
- 在全新 SSH 会话验证工具链、PM2 安全字段、应用关键文件与本机/公网 health。

## 禁止

- 不运行 `pnpm install`、`pnpm update`、构建、migration、seed 或业务 verify。
- 不修改 `/srv/ai-job-print` 源码、lockfile、`node_modules`、`.env`、数据库、Redis、COS、短信或账号。
- 不重启、reload 或重建 PM2、nginx、PostgreSQL、Redis、Terminal Agent；允许 `systemctl daemon-reload` 仅加载上述 PATH 防漂移 drop-in，但不得触发任何 unit restart；不执行应用部署。
- 不删除或覆盖系统 `/usr/bin/node`、现有 Node 20 软件包或 `/usr/bin` Corepack shim。
- 不输出环境变量值、连接串、token、SSH 私钥或完整 PM2 环境。

## 停止条件

- 主机不是受支持的 Linux x64/glibc 环境，官方制品 SHA-256 不匹配，或 Node 22/其 Corepack 隔离执行失败。
- `/opt` 目标目录或计划使用的 `/usr/local/bin` 路径已存在且来源不明。
- 无法保留 Node 20 和旧 pnpm 的可复现回滚，或检测到其他人在同时修改应用/PM2。
- 任一应用关键文件变化、PM2 PID/restart/status 变化，或本机/公网 health 非 200。

## 验收

- 新 SSH 会话 `node --version` 为 `v22.23.1`，来源是受控 `/opt` 安装；`/usr/bin/node --version` 仍为原 Node 20。
- 新 SSH 会话 `pnpm --version` 精确为 `11.2.2`，其 shim 使用 Node 22 Corepack；旧系统工具链可按记录恢复。
- PM2 目标进程 PID、restart count、状态与执行前一致。
- 应用关键文件哈希/mtime、`node_modules` 顶层 mtime不变；本机与公网 health、三端入口均保持 HTTP 200。
- 未发生应用依赖安装、部署、服务重启或任何业务数据写入。
