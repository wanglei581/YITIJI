# 用户文件与简历资产预生产 Gate 1 只读预检

## 目标

- 基于 `codex/file-assets-preprod-execution` 已审查通过的计划，执行 Gate 1 预生产只读预检。
- 确认当前预生产主机、部署目录、部署 commit、工作区状态、PM2 API 进程和 health 状态。
- 将结果脱敏记录到 `docs/acceptance/user-file-assets-preprod-execution-record.md`。
- 若预生产实际 commit 不是 `9146fa1c`，只记录差异并停止，不执行部署刷新。

## 非目标

- 不部署、不拉取、不 checkout、不重启 PM2。
- 不运行 `migrate deploy`、seed、`verify:cos:live` 或任何可能写 DB/COS 的脚本。
- 不读取或输出 `.env`、密钥、token、完整签名 URL、真实手机号或简历正文。
- 不创建测试账号、不上传文件、不修改保存期限、不删除文件。
- 不验收 Windows 真机、Terminal Agent、奔图打印或扫描。

## 目标来源

- 当前预生产主机以仓库部署记录为准；本任务记录统一写作 `<PREPROD_HOST>`。
- 当前预生产部署目录以既有文档为准：`/srv/ai-job-print`。
- 旧上下文中的其它主机地址不作为本轮目标。

## 允许修改文件

- `.ccg/tasks/file-assets-preprod-gate1-readonly/*`
- `docs/acceptance/user-file-assets-preprod-execution-record.md`
- `docs/progress/current-progress.md`
- `docs/progress/next-tasks.md`

## 只读命令范围

允许执行：

```bash
ssh -o BatchMode=yes -o ConnectTimeout=8 root@<PREPROD_HOST> 'hostname && date && cd /srv/ai-job-print && git rev-parse --short HEAD && git status --short --branch'
ssh -o BatchMode=yes -o ConnectTimeout=8 root@<PREPROD_HOST> 'pm2 status ai-job-print-api || true'
ssh -o BatchMode=yes -o ConnectTimeout=8 root@<PREPROD_HOST> 'curl -fsS http://127.0.0.1:3010/api/v1/health'
curl -fsS --max-time 8 http://<PREPROD_HOST>/api/v1/health
```

禁止执行：

```bash
git pull
git fetch
git checkout
git reset
pnpm install
pnpm build
pm2 restart
prisma migrate deploy
verify:cos:live
```

## 停止条件

- SSH 无法登录或超时。
- 预生产目录不存在或不是 Git 仓库。
- 预生产工作区存在不明改动。
- health 未返回 PostgreSQL。
- 实际部署 commit 不是目标候选 `9146fa1c`。
- 命令输出中出现密钥、token、签名 URL 查询串、真实手机号或简历正文。

## 验证

- `pnpm --filter @ai-job-print/api verify:file-assets-trial-acceptance`
- `git diff --check`
- Claude + Antigravity 双模型审查本轮记录，无 Critical 后提交。
