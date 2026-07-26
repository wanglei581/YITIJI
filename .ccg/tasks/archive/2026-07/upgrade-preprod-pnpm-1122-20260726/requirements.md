# 需求与边界

## 目标

仅将预生产服务器的默认 pnpm 工具链从当前 9.x 受控切换为项目固定的 `11.2.2`，为后续候选依赖安装解除 engine 与 patchedDependencies 锁文件不兼容阻塞。

## 允许

- 只读盘点 Node、pnpm、Corepack、PATH、安装来源、磁盘、PM2 与 health。
- 记录当前 pnpm 版本、可执行文件路径与可复现回滚命令。
- 使用主机现有 Node 工具链安装或激活精确版本 `pnpm@11.2.2`。
- 在全新 SSH 会话验证默认 `pnpm --version`、路径和基本 CLI 可执行性。

## 禁止

- 不运行 `pnpm install`、`pnpm update`、构建、migration、seed 或任何业务 verify。
- 不修改 `/srv/ai-job-print` 源码、lockfile、`node_modules`、`.env`、数据库、Redis、COS、短信或账号。
- 不重启/重载 PM2、nginx、PostgreSQL、Redis 或 Terminal Agent。
- 不部署 `main@e53c1d1e` 或任何应用产物。
- 不输出 SSH 私钥、环境变量值、连接串、token 或其他凭据。

## 验收

- 默认新 SSH 会话 `pnpm --version` 精确为 `11.2.2`。
- `command -v pnpm` 与安装机制清晰，旧版本回滚命令可执行且未执行。
- PM2 目标进程 PID、restart count、状态与升级前一致。
- 本机与公网 health 仍为 `ok/postgres`，三端静态入口状态不因工具链切换变化。
- 应用目录关键运行来源标记与 Git/文件状态不变；没有安装依赖或部署。
