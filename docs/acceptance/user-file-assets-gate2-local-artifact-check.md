# 用户文件与简历资产 Gate 2 本地候选包预检

> 状态：LOCAL CHECK ONLY，尚未执行预生产远端操作。
> 候选 commit：`9146fa1c`。
> 本地执行时间：2026-06-22。
> 口径：本文件只证明本地候选包生成、归档范围和敏感扫描已预检；不代表 Gate 2、Gate 3/Gate 4、正式生产、试运营或 Windows 真机验收完成。

## 一、本地检查结论

本地预检发现：原计划使用完整 `git archive` 会把 `docs/`、`.ccg/`、历史任务记录和项目文档一起打进预生产候选包。这些内容不是密钥，但包含历史预生产 IP、示例连接串、测试手机号和大量非运行时资料；对部署包没有必要。

因此 Gate 2 计划已改为“裁剪运行时归档”：

- 包含：`package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml`、`tsconfig.base.json`、`apps/`、`services/`、`packages/`。
- 排除：`docs/`、`.ccg/`、`.github/`、`.claude/`、README/AGENTS/CLAUDE、`.env.example`、`.env`、`node_modules`、`dist`、日志、数据库备份、截图和密钥文件。
- 使用 `gzip -n -9` 生成可复现 gzip，避免 gzip header 时间戳导致 sha256 每次变化。

## 二、完整归档预检结果

命令：

```bash
git archive --format=tar --prefix=ai-job-print/ 9146fa1c | gzip -n -9 > /tmp/yitiji-preprod-9146fa1c.tar.gz
```

结果：

| 项目 | 结果 |
| --- | --- |
| 文件 | `/tmp/yitiji-preprod-9146fa1c.tar.gz` |
| 大小 | 4.5M |
| sha256 | `69d1cf0fd148c39f32e2bf7b501e1120cdde1a9c822c115f595a08c857998b2e` |
| entries | 1244 |
| 可复现性 | 使用 `gzip -n -9` 二次生成字节完全一致 |
| 不应包含项 | 未发现 `.env`、`node_modules`、`dist`、`.git`、日志、数据库备份或密钥文件 |
| 正常静态资源 | 命中 `apps/kiosk/public/assets/*.png`，为 Kiosk 构建所需图片资源 |

完整归档风险：

- 包含 `docs/` 和 `.ccg/`。
- 候选文本扫描命中文档中的历史预生产 IP、示例连接串、环境变量名和测试手机号。
- 这些命中不是生产密钥，但不应作为部署包的必要内容上传。
- 后续正式 Gate 2 上传和执行记录只应使用第三节的裁剪运行时归档 sha256，不应使用本节完整归档 sha256。

## 三、裁剪运行时归档预检结果

命令：

```bash
git archive --format=tar --prefix=ai-job-print/ 9146fa1c -- \
  package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json \
  apps services packages \
  ':(exclude)**/.env.example' \
  | gzip -n -9 > /tmp/yitiji-preprod-9146fa1c-runtime.tar.gz
```

结果：

| 项目 | 结果 |
| --- | --- |
| 文件 | `/tmp/yitiji-preprod-9146fa1c-runtime.tar.gz` |
| 大小 | 3.8M |
| sha256 | `950a025e33ad9a18d97120194c1df32e852b049d5c676a1ddf7d670e2a220cd2` |
| entries | 954 |
| 必要 workspace 文件 | `package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml`、`tsconfig.base.json` 均存在 |
| 必要服务/应用文件 | `services/api/package.json`、PostgreSQL Prisma schema、Kiosk/Admin package、shared/ui package 均存在 |
| 已排除 | `docs/`、`.ccg/`、`.github/`、`.claude/`、`.env.example`、`.env`、`node_modules`、`dist`、日志、数据库备份、密钥文件 |

裁剪不会影响远端 install/build：当前候选的 API build 只依赖 Prisma generate、PostgreSQL Prisma generate 和 TypeScript 编译；Kiosk/Admin build 只依赖 `tsc -b` 与 Vite build，且各 app `tsconfig.json` 均继承已打包的 `tsconfig.base.json`。被排除的根级 lint/format/文档/任务文件不参与 `pnpm install --frozen-lockfile` 或 API/Kiosk/Admin build。

裁剪范围文本扫描：

- 未命中真实公网 IP。
- 未命中真实密钥、token、数据库连接串或私钥。
- 命中项属于代码注释、环境变量名称、COS/TRTC 签名实现、测试 fixture 手机号和示例占位连接串注释；不包含真实 secret 值。

## 四、Gate 2 计划修正

Gate 2 执行计划已修正：

- 本地候选包生成使用裁剪路径清单，而不是完整仓库归档。
- 本地和远端候选包仍使用 `/tmp/yitiji-preprod-9146fa1c.tar.gz`、`/srv/yitiji-preprod-9146fa1c.tar.gz` 的既定文件名，避免后续执行脚本额外分叉。
- 归档生成使用 `gzip -n -9`，确保 sha256 可复现。
- 审批包新增说明：候选包为裁剪运行时归档，不包含 `docs/`、`.ccg/`、示例 env 文件或本地工具状态。

## 五、仍未执行的事项

本地候选包预检不代表以下事项已完成：

- 未上传到预生产 `/srv`。
- 未执行远端 `sha256sum -c`。
- 未展开候选目录。
- 未复制远端 env。
- 未安装依赖、生成 Prisma client 或构建 API/Kiosk/Admin。
- 未备份 PostgreSQL 或执行 migration。
- 未切换 `/srv/ai-job-print`。
- 未重启 PM2。
- 未执行 Gate 3/Gate 4。

下一步仍需用户按 Gate 2 审批包确认后，才能执行任何远端变更。
