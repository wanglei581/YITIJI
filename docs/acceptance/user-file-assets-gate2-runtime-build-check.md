# 用户文件与简历资产 Gate 2 裁剪包本地构建预检

> 状态：LOCAL BUILD CHECK ONLY，尚未执行预生产远端操作。
> 候选 commit：`2187f6a7`。
> 本地执行时间：2026-06-22。
> 口径：本文件只证明裁剪候选包在本地 `/tmp` 解压目录可安装和构建；不代表 Gate 2、Gate 3/Gate 4、正式生产、试运营或 Windows 真机验收完成。

## 一、结论

裁剪运行时归档可以在干净 `/tmp` 解压目录中完成依赖安装、Prisma client 生成、API build、Kiosk production build 和 Admin build。本轮将后续 Gate 2 建议候选从 `9a702981` 刷新为 `2187f6a7`，原因是 `2187f6a7` 包含后续 Gate 2/Gate 3/Gate 0 本地门禁与证据口径修正；API dist hash 与 `9146fa1c` / `9a702981` 预检保持一致，说明后续提交未改变 API 运行时构建产物。

部署候选冻结：本地构建预检固定证明 `2187f6a7`；后续纯治理、文档、本地静态门禁或任务归档提交不自动刷新部署候选，治理提交不刷新部署候选。只有运行时代码、数据库 schema、构建输入、归档范围、生产构建变量或 Gate 2 执行命令变化，才需要重新生成裁剪包并重跑本地构建预检。

预检同时确认 Gate 2 计划中的构建变量要求仍然成立：

- 原计划 Kiosk build 只设置 `VITE_USE_TRTC_CALL=true`。
- 实际 Kiosk production build 守卫还要求 `VITE_API_MODE=http`，否则拒绝构建，防止 mock 数据进入线上产物。
- Gate 2 计划已修正为：
  - Kiosk：`VITE_API_MODE=http VITE_API_BASE_URL=/api/v1 VITE_USE_TRTC_CALL=true pnpm --filter @ai-job-print/kiosk build`
  - Admin：`VITE_API_MODE=http VITE_API_BASE_URL=/api/v1 pnpm --filter @ai-job-print/admin build`

说明：代码层面硬失败的是 `VITE_API_MODE` 不是 `http`；`VITE_API_BASE_URL` 缺失时构建会 warning 并回落到 `/api/v1`。本 Gate 2 仍要求显式设置 `VITE_API_BASE_URL=/api/v1`，这是执行策略收紧，用于避免非同源或未来配置变化时发生静默回落。

## 二、本地解压和安装

本地裁剪包：

| 项目 | 结果 |
| --- | --- |
| 文件 | `/tmp/yitiji-preprod-2187f6a7.tar.gz` |
| sha256 | `6019de34f837850b22eb7ab12f9b0d25ea6fa14bac3fcfc827441803123e4b07` |
| 解压目录 | `/tmp/yitiji-gate2-runtime-build-check-2187f6a7/ai-job-print` |
| root entries | 7 |

命令：

```bash
tar -xzf /tmp/yitiji-preprod-2187f6a7.tar.gz -C /tmp/yitiji-gate2-runtime-build-check-2187f6a7
cd /tmp/yitiji-gate2-runtime-build-check-2187f6a7/ai-job-print
pnpm install --frozen-lockfile
```

结果：

- `pnpm install --frozen-lockfile` 通过。
- workspace 识别为 9 个项目。
- lockfile up to date，resolution step skipped。
- 安装未依赖被裁剪掉的 `docs/`、`.ccg/`、根级 lint/format 文档或任务文件。
- 解压后根目录为 `apps`、`package.json`、`packages`、`pnpm-lock.yaml`、`pnpm-workspace.yaml`、`services`、`tsconfig.base.json`。
- 根目录不包含 `docs/` 或 `.ccg/`；归档内未发现 `.env.example`。

## 三、Prisma 与 API build

命令：

```bash
pnpm --filter @ai-job-print/api exec prisma generate
pnpm --filter @ai-job-print/api db:pg:generate
pnpm --filter @ai-job-print/api build
```

结果：

- SQLite Prisma client 生成通过。
- PostgreSQL Prisma client 生成通过。
- API build 通过。
- `services/api/dist/main.js` 存在。
- `services/api/dist/main.js` sha256：`d309c660b685680409ddf441f8ec5401d4810d61ad2162bc666bf7ab7e27b5b8`

历史对照：`9a702981` 是上一代 Gate 2 建议候选；`9146fa1c` 裁剪包 sha256 为 `950a025e33ad9a18d97120194c1df32e852b049d5c676a1ddf7d670e2a220cd2`；三者的 `services/api/dist/main.js` sha256 均为 `d309c660b685680409ddf441f8ec5401d4810d61ad2162bc666bf7ab7e27b5b8`。该对照证明 `9146fa1c` 之后的候选刷新没有改变 API 运行时构建产物。

## 四、Kiosk production build

首次按旧计划命令执行：

```bash
VITE_USE_TRTC_CALL=true pnpm --filter @ai-job-print/kiosk build
```

结果：失败，Kiosk production build 守卫拒绝构建：

```text
[kiosk] 生产构建被拒绝：VITE_API_MODE 必须为 "http"（当前 "未设置"）。
```

修正后命令：

```bash
VITE_API_MODE=http VITE_API_BASE_URL=/api/v1 VITE_USE_TRTC_CALL=true pnpm --filter @ai-job-print/kiosk build
```

结果：

- Kiosk production build 通过。
- dist 文件数：8。
- 产物包含 `AiAdvisorCall` chunk。
- 产物包含 `trtc` chunk。
- Vite 大 chunk warning 存在，但构建退出码为 0；该 warning 已是前端体积提示，不阻塞 Gate 2。

## 五、Admin production build

命令：

```bash
VITE_API_MODE=http VITE_API_BASE_URL=/api/v1 pnpm --filter @ai-job-print/admin build
```

结果：

- Admin production build 通过。
- dist 文件数：3。
- Vite 大 chunk warning 存在，但构建退出码为 0；该 warning 不阻塞 Gate 2。

## 六、Gate 2 计划修正

Gate 2 计划已修正：

- Kiosk build 必须显式设置 `VITE_API_MODE=http`、`VITE_API_BASE_URL=/api/v1`、`VITE_USE_TRTC_CALL=true`。
- Admin build 必须显式设置 `VITE_API_MODE=http`、`VITE_API_BASE_URL=/api/v1`。
- 停止条件同步扩展：如果 Kiosk/Admin 生产构建未使用 http API 模式，或 Kiosk 未启用 TRTC call 且无审定的纯文字例外，必须停止 Gate 2。
- `VITE_API_BASE_URL=/api/v1` 属 Gate 2 操作策略要求，不应依赖构建脚本的默认回落行为。

## 七、仍未执行的事项

本地构建预检不代表以下事项已完成：

- 未上传候选包到预生产 `/srv`。
- 未执行远端 `sha256sum -c`。
- 未复制预生产 env 文件。
- 未在预生产安装依赖或构建。
- 未备份 PostgreSQL 或执行 migration。
- 未切换 `/srv/ai-job-print`。
- 未重启 PM2。
- 未执行 Gate 3/Gate 4。

下一步仍需用户按 Gate 2 审批包确认后，才能执行任何预生产远端变更。
