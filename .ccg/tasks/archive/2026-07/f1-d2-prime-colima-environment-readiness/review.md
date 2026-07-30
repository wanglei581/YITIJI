# F1 D2′ Colima PREP 多模型复核

## 结论

继续执行 PREP-only，但将工具安装明确视为 D2′ runbook 之前的一次性受控 bootstrap。
本轮不执行 full drill，不连接 production，不生成 D2′ PASS evidence。

## Claude

- 结论：GO（仅限 PREP）。
- guest 代码必须是 guest 本地文件系统上的独立 clone，不能使用 host bind mount。
- `pnpm install`、Prisma engines 与 build 需要网络；只有 contract verifier 本身可称为 offline。
- Node 发布包必须校验发布签名与 SHA-256；pnpm 使用仓库声明的 `11.2.2`。
- 先检查磁盘与 4 GiB 内存约束，build 使用受控 Node heap。

## Antigravity

- 按用户要求重新调用。
- CLI 仍因配额/资源限制失败，没有产生模型结论；不计为有效审查，也不以失败结果替代审查。

## Cursor 客户端

- 结论：REJECT 原表述。
- 采纳：把安装与 D2′ runbook 分离为 bootstrap；先 `dpkg` 审计，再刷新 APT 索引并重新读取 Nginx
  精确候选版本；GPG 校验失败立即 NO-GO；guest 内 fresh install/build；不得回退到其他软件源。
- 不采纳：要求把 PM2 写入仓库依赖。PM2 是 runbook 要求预置在 `PATH` 的主机工具，不是应用依赖；
  仓库已有 `services/api/scripts/d2-docker/run.sh` 使用 `npm install -g pm2@6` 的环境准备证据。
- 不采纳：把旧设计 worktree 与当前演练 worktree 判定为“未声明重命名”。它们是不同阶段、不同用途的
  worktree，当前目标 worktree 已单独验证为 `313d358d`。

## 安全恢复顺序

1. `dpkg --audit` 与已安装状态检查；不盲目执行修复。
2. 使用现有 Ubuntu 官方源运行 `apt-get update`，重新读取真实 Nginx candidate 后精确安装。
3. 从 Node 官方源下载 `v22.23.1` ARM64，使用官方 release keyring 验证签名与 SHA-256。
4. 通过 Corepack 激活 `pnpm@11.2.2`；安装主机工具 `pm2@6.0.13` 并验证隔离 `PM2_HOME`。
5. guest 本地独立 clone `origin/main@313d358d`，执行 frozen install、API build 与 offline contract。
6. 到此停止；full drill 留给单独授权的下一任务。

任务已按该边界完成并归档。
