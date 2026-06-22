# 预生产服务器与 Windows 裸机真机验收执行计划

## 背景

- 域名审核尚未通过，腾讯云短信仍在审核。
- 一体机外壳尚未制作，但 Windows 一体机所需设备已采购到位。
- 当前部署基线从 `origin/main@c31e0b1` 的干净 worktree 创建。
- 本轮用户确认合入 `codex/guard-kiosk-trtc-assistant@6b055d6b`，并同意先走预生产。

## 目标

1. 合入 Kiosk `/assistant` TRTC 数字人生产构建防回退守卫。
2. 建立可回滚的预生产部署候选分支。
3. 按 `docs/device/production-deployment-and-windows-host-checklist.md` 推进服务器预生产和 Windows 裸机技术验收。
4. 明确域名、短信、正式 HTTPS、外壳装配为待补验项目，不冒充生产完成。

## 非目标

- 不新增业务功能。
- 不重做 UI/UX。
- 不开发平台内投递、企业筛简历、面试邀约、Offer 管理等招聘闭环。
- 不把 HTTP IP 验收冒充为正式域名/HTTPS 验收。
- 不把外壳装配、散热、线缆应力、防拆验收混入本轮软件和裸机技术验收。

## 允许修改或操作范围

- 允许合入：`codex/guard-kiosk-trtc-assistant`。
- 允许新增/更新：`.ccg/tasks/preprod-deployment-acceptance/` 任务记录。
- 允许执行：本地 typecheck/lint/build/verify、只读 GitHub CI 查询。
- 服务器和 Windows 真机操作必须在执行前列出目标、验证方式、回滚方式和停止条件。
- 禁止使用 `git add .`；如需暂存，必须显式列路径。

## 验证方式

### 本地合入验证

- `git merge --ff-only codex/guard-kiosk-trtc-assistant`
- `pnpm --filter @ai-job-print/kiosk verify:assistant-trtc-guard`
- `VITE_API_MODE=http VITE_API_BASE_URL=/api/v1 VITE_USE_TRTC_CALL=true pnpm --filter @ai-job-print/kiosk build`
- 必要时运行根 CI 子集：typecheck/lint/build 相关命令。

### 预生产服务器验证

- `pnpm install --frozen-lockfile`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm build`
- PostgreSQL：`db:pg:deploy`、`db:pg:sync:check`、seed、备份恢复。
- API health 必须返回 PostgreSQL，而不是 SQLite。
- COS/OCR/AI/TRTC 按启用范围 live 冒烟。
- 普通 HTTP IP 只能作为基础链路验证；涉及真实简历、麦克风、TRTC 时必须使用临时 HTTPS/hosts 映射或加密链路。
- 预生产/生产 Kiosk 构建变量必须确认 `VITE_ALLOW_TEXT_ONLY_ASSISTANT` 未设置；除非本轮明确选择纯文字助手部署，否则不得打开该逃生口。

### Windows 裸机验证

- 先验本地设备：Windows 版本、奔图驱动识别名、系统测试页、扫描驱动、触屏/扫码器/U 盘。
- 服务器 API 可用后再验集成：Agent 注册、心跳、Admin 在线、Kiosk 发起打印、真实出纸、状态回传、断网/重启恢复、日志告警。

## 回滚方式

- Git：保留 `origin/main@c31e0b1` 作为回退基线。
- 服务端：保留上一版构建产物/PM2 进程配置/nginx 配置备份。
- 数据库：迁移前做 `pg_dump -F c` 快照；破坏性迁移前先验证恢复。
- Windows：Agent 可卸载，服务可停止，配置和日志保留用于诊断。

## 停止条件

- 部署包混入脏工作区或非确认分支。
- 发现平台内投递、企业筛简历、面试邀约、Offer 管理等合规越界。
- 生产运行时门禁被绕过或回退。
- 数据库迁移存在数据丢失风险且无可验证备份。
- 真实打印链路失败且无法定位到软件、驱动、网络或硬件层。
- 密钥或真实用户材料进入日志、仓库或聊天。

## 推荐执行顺序

1. 合入 `codex/guard-kiosk-trtc-assistant` 并完成本地验证。
2. 查询/记录部署候选 CI 状态。
3. 准备预生产服务器执行清单：环境、密钥、PG/Redis/COS、临时 HTTPS/hosts、nginx、PM2、回滚。
4. 执行服务器预生产部署与核心验收。
5. 执行 Windows 裸机本地设备验收。
6. 服务器可用后执行 Windows + Agent 端到端集成验收。
7. 域名审核通过后补正式域名 HTTPS 复验。
8. 腾讯短信审核通过后补真实手机号登录 E2E。
9. 进入 1 台终端 + 1 台打印机小范围试运营。
