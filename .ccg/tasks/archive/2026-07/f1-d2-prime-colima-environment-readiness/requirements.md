# F1 D2′ Colima 环境准备范围

## 真实阻塞

D2′ 候选脚本已经合入 `main`，但当前没有已装齐 Node.js、pnpm、PM2 与真实 Nginx 的合格非生产
Linux 执行面。现有 Colima guest 已只读证明为 Ubuntu 24.04.4、systemd PID 1、user systemd
running、`Linger=yes`、cgroup v2 且 CPU/memory/pids controller 已下放，因此优先复用，不新增云主机
或第二个本地虚拟机。

## 本轮允许

- 启停本机现有 Colima profile。
- 在 Colima guest 内安装项目要求的 Node 22、pnpm 11.2.2、PM2 与 Ubuntu 官方 Nginx。
- 在 guest 本地文件系统准备来源固定为 `origin/main` 合并提交 `313d358d` 的隔离代码副本。
- 运行只读版本、systemd/cgroup、端口、production-env、offline contract 与 build readiness 检查。
- 更新并归档本任务 `.ccg/tasks/**`。

## 本轮禁止

- 不连接或修改 production，不 SSH，不使用线上数据库、Redis、对象存储或凭据。
- 不执行 D2′ full drill，不制造 CPU throttling、Nginx 切换、PM2 故障或 rollback。
- 不执行 D3–D6，不修改 production F1 状态。
- 不改主仓库脏工作区、其他 worktree、现有 Colima Docker 容器/volume 或端口转发。
- 不新增云主机、第二个虚拟机、业务代码、依赖声明或项目入口。

## 验收

- Colima guest 仍满足 Linux/systemd/linger/cgroup v2 门禁。
- `node` 满足 `>=22.13 <23`，`pnpm` 固定为 `11.2.2`，真实 `pm2` 与 `nginx` 可执行。
- `3010`、`3011` 和候选 Nginx 演练端口未占用。
- 隔离副本 commit 与 `origin/main` 的 PR #444 merge commit 一致，未携带 `.env` 或生产凭据。
- API build 与 `verify:d2-same-host-contract` 通过；不生成 D2′ PASS evidence。

## 完成状态

上述 PREP 验收均已满足；full drill 未执行，须另行授权。
