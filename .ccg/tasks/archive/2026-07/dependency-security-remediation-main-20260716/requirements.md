# 最新主线依赖安全修复需求

## 目标

在最新 `origin/main` 上重新验证并清除 `pnpm audit --audit-level=high` 的 critical/high 部署阻塞，同时保持应用行为、API 上传链路、三端构建与 Prisma/Nest 主版本不变。

## 允许范围

- 根依赖声明与锁文件：`package.json`、`pnpm-workspace.yaml`、`pnpm-lock.yaml`。
- 仅在审计证明仍必要时调整：`apps/admin/package.json`、`apps/kiosk/package.json`、`apps/partner/package.json`、`services/api/package.json`。
- 为关闭 Multer 已验证的运行时 DoS，允许修改 8 个已有 API 上传 controller、增加一个本地 `verify:multipart-field-nesting` 脚本，并把该脚本接入现有 SQLite CI verify 阶段。
- 任务记录、正式进度与本次实施计划的事实更新。

## 禁止范围

- 不修改应用业务语义、API 契约、Prisma schema/migration、Terminal Agent、生产配置或密钥；CI 只允许新增本次专项 verify 的一行调用。
- 不部署、不重启服务、不连接生产数据库，不执行真实短信/手机号转移。
- 不直接复活落后主线 116 个提交的旧分支；旧提交 `334c9614` 仅作为候选素材逐项复核。

## 安全与兼容不变量

- 锁文件中不得再解析到受目标 critical/high advisory 影响的版本。
- 保持 Nest/Prisma 主版本与现有业务 manifest 范围；仅采用当前 advisory 要求的最小安全版本或必要 override。
- 上传、打印任务、三端 production build、类型检查和 frozen-lockfile 安装必须继续通过。
- 最终重新运行 `pnpm audit --audit-level=high`；若仍有 critical/high，任务不得标记 fixed。
