# 文件归属 / 协作规约(Claude × Mavis)

> **本文档是 Claude 与 Mavis 协同开发 P0 4 周冲刺的硬合同**。
> **任何一方在编辑文件前必须 Read 本文档,确认归属,违规直接 revert**。
> 起草:2026-05-30,有效期:P0 冲刺至少 4 周。期间如需修改,**双方在 PR 里达成共识后再改**。

---

## 0. 一句话原则

- **Claude 负责**:架构演进 / 合规关键代码 / 复杂算法 / 共享基础设施(packages/ui / packages/shared / Prisma schema / API 中间件 / 认证 / 文件 / 审计 / AI 网关)
- **Mavis 负责**:标准 CRUD UI / 现有页面修补 / 数据 seed / 既有 API 的前端联调
- **共享目录**:改之前在 `today-{name}.md` 标记意图,等对方读到后再动

---

## 1. Claude 独占目录(Mavis 禁止编辑,除非 handoff)

```
services/api/prisma/schema.prisma           — 数据模型,顺序敏感
services/api/prisma/migrations/             — 迁移历史,顺序敏感
packages/shared/                            — 共享类型契约(Mavis 只 import 不修改)
packages/ui/                                — 组件库(Mavis 只消费不新增)
services/api/src/auth/                      — JWT / 登录 / 限流
services/api/src/files/                     — 文件通道 + HMAC 签名 URL + 清理 cron(新建)
services/api/src/audit/                     — 审计日志写库(新建)
services/api/src/ai/                        — AI 服务网关 / prompt 管理
services/api/src/main.ts                    — 全局 pipeline / CORS / ValidationPipe
services/api/src/app.module.ts              — 模块注册 / Throttler / RequestId
services/api/src/common/                    — 守卫 / 装饰器 / 中间件 / DTO 基类
apps/kiosk/src/pages/resume/                — AI 简历核心(合规高敏)
```

**违规后果**:Mavis 不慎编辑这些文件时,Claude 有权直接 `git revert` 该 commit,Mavis 不得反对。Mavis 需求改这里 → 写到 `docs/progress/handoff-to-claude.md`,Claude 在 24h 内处理。

---

## 2. Mavis 独占目录(Claude 不动)

```
apps/admin/src/routes/dashboard/            — Admin 工作台
apps/admin/src/routes/job-sources/          — 岗位信息源 + 合规横幅(文案 Claude 一次性审)
apps/admin/src/routes/files/                — 文件管理 UI(消费 Claude 的 BE-1 API)
apps/admin/src/routes/audit/                — 审计 UI(消费 Claude 的 BE-2 API)
apps/admin/src/routes/orders/               — 订单(W4 兜底)
apps/admin/src/routes/users/                — 用户管理(W4 可选)
apps/admin/src/routes/alerts/               — 告警中心(W4 可选)
apps/admin/src/routes/partners/             — 合作机构(W4 可选)
apps/admin/src/routes/fair-sources/         — 招聘会信息源
apps/partner/src/routes/dashboard/          — Partner 工作台 D 方案
apps/partner/src/routes/jobs/               — 外部岗位管理(W3 加数据表现列)
apps/partner/src/routes/fairs/              — 招聘会管理
apps/partner/src/routes/sync-logs/          — 同步日志
apps/partner/src/routes/stats/              — 数据统计
apps/partner/src/routes/policy/             — 政策公告
apps/partner/src/routes/account/            — 账号权限
apps/kiosk/src/pages/home/                  — Kiosk 首页卡片墙
apps/kiosk/src/pages/jobs/                  — 招聘列表(W1 加合规横幅)
apps/kiosk/src/pages/job-fairs/             — 招聘会 + 校企合作主题变体
services/api/prisma/seed.ts                 — 数据 seed
```

**违规后果**:Claude 不慎编辑这些 → Mavis 有权 revert,Claude 不得反对。

---

## 3. 共享目录(任何一方改动前必须先在 today-{name}.md 标记意图)

```
⚠️ services/api/src/jobs/                    — Claude W3 加 JobFair API,Mavis W3 联调
⚠️ services/api/src/jobs/jobs.controller.ts — 新增 fair 路由时,先在 today-{name}.md 说
⚠️ apps/admin/src/components/Admin*Layout*  — 布局影响所有 admin 页
⚠️ apps/admin/src/services/api/             — HttpAdapter,Mavis 主要消费,Claude 偶尔扩展拦截器
⚠️ apps/partner/src/components/Partner*Layout* — 同上
⚠️ apps/partner/src/services/api/           — 同上
⚠️ apps/kiosk/src/components/               — Kiosk 公共组件
⚠️ docs/progress/current-progress.md        — 双方各加自己的 H2 段,绝不修改对方段
⚠️ docs/progress/next-tasks.md              — 同上
```

**协议**:
1. 改前必须 read 对方的 `today-{name}.md`
2. 若目标文件在对方"将编辑"清单 → 选另一文件 / 等对方完成
3. 改完立刻 commit + 在 `today-{name}.md` 标记 "✅ 已完成"

---

## 4. 配置文件(双方都要谨慎)

```
🚨 package.json (根)                         — pnpm workspace 配置,改动需 PR 评审
🚨 pnpm-lock.yaml                            — 安装依赖时自动改,但同时安装会冲突 → 串行
🚨 turbo.json / vite.config.ts (各 app)       — 构建配置,改动需 PR 评审
🚨 tsconfig.*.json                           — TS 配置,改动需 PR 评审
🚨 .env.example                              — 环境变量样板,新增 var 必须双方知会
🚨 services/api/package.json                  — 依赖,串行安装
🚨 apps/{kiosk,admin,partner}/package.json    — 依赖,串行安装
```

**安装新依赖协议**:
1. 先在 `today-{name}.md` 写明"将 pnpm add X 到 Y"
2. 对方 ack 后再装
3. 装完立刻 commit 并通知

---

## 5. 每日同步流程

### 每天开工前(必做)

```bash
# 在仓库根
git pull origin main
cat docs/progress/today-claude.md     # 看 Claude 今天动什么
cat docs/progress/today-mavis.md      # 看 Mavis 今天动什么
```

### 每天开工时(必做)

**编辑/创建/覆盖** `docs/progress/today-{你的名字}.md`:

```markdown
# YYYY-MM-DD <Claude/Mavis> 今日动手清单

## 将编辑/新建的文件
- path/to/file1
- path/to/file2

## 将新增/修改的共享类型契约(packages/shared)
- 新增 FileUploadResponse 类型
- (若无:写"无")

## 将安装的依赖
- pnpm add recharts -F @ai-job-print/kiosk
- (若无:写"无")

## 阻塞对方的事项
- "Mavis 今天不要碰 packages/shared/src/types/file.ts,我加新字段"
- (若无:写"无")

## 预计完成时间
EOD UTC+8

## 完成清单(下班前更新)
- [x] 文件1 done @ commit abc1234
- [ ] 文件2 in progress
```

### 每天下班前(必做)

- 把 `today-{name}.md` 的"完成清单"勾上 + commit hash
- 若有未完成项,在 `handoff-to-{对方}.md` 写一行交接

---

## 6. 分支策略

```
main                            — 受保护,只接 PR(双方都不直推)
feat/p0-w1-<owner>-<topic>      — 周 + 负责人 + 主题
  例:feat/p0-w1-claude-foundation
       feat/p0-w1-mavis-kiosk-banner
       feat/p0-w2-mavis-admin-files-ui
```

- 一个 PR 只动**一个 owner 范围**内的文件(不跨 Claude/Mavis 独占目录)
- PR 标题必须含 `[claude]` 或 `[mavis]` 前缀,方便审计
- PR 描述必须包含:
  - 涉及文件列表
  - 是否触碰共享目录(若是,引用对方的 ack)
  - 验收方式(本地命令 / 截图 / 视频)

---

## 7. 红线(任何一方违反 → 立即停工对齐)

1. **直推 main**(只能 PR)
2. **编辑对方独占目录**(必须 handoff)
3. **改 Prisma schema 不写 migration**(必须 `pnpm prisma migrate dev --name xxx`)
4. **改 packages/shared 不通知**(对方代码会同时挂)
5. **改 packages/ui 已有组件签名**(对方页面会挂)
6. **改 main.ts / app.module.ts 不让对方知道**(全局副作用)
7. **删除任何 docs/progress/* 文件**
8. **跳过 lint / typecheck**(P0 期间 hooks 不能 `--no-verify`)

---

## 8. handoff 文件位置

```
docs/progress/handoff-to-claude.md       — Mavis 要 Claude 做的事(代办清单)
docs/progress/handoff-to-mavis.md        — Claude 要 Mavis 做的事
docs/progress/today-claude.md            — Claude 今日意图(每天覆盖)
docs/progress/today-mavis.md             — Mavis 今日意图(每天覆盖)
docs/progress/current-progress.md        — 总进度(双方各加自己段,不动对方段)
docs/progress/p0-sprint-plan.md          — 架构师产出的 4 周计划(只读参考)
docs/progress/p0-frontend-estimate.md    — 前端 Lead 工作量评估(只读参考)
```

---

## 9. 任务分配(P0 4 周冲刺,基于 catalog + 专家分析)

### Claude(我)负责的模块

| Week | 模块 | 文件范围 | 预估 |
|---|---|---|---|
| W1 | packages/ui 4 组件:ComplianceBanner / Stepper / Drawer / Pagination | packages/ui/src/components/ | 8h |
| W1 | 图表组件 4 个:ResumeRadarChart / TrendLineChart / FunnelCard / MetricGrid | packages/ui/src/charts/ | 4h |
| W1 | 装依赖 recharts / react-diff-viewer-continued | 三端 package.json | 2h |
| W1 | BE-1 文件通道 + HMAC + cron 清理 | services/api/src/files/ + schema.prisma | 20h |
| W2 | BE-2 AuditLog(同步写)+ 拦截器 | services/api/src/audit/ + common/interceptors | 8h |
| W2 | K2 AI 简历四步流(上传 / 解析 / 诊断)| apps/kiosk/src/pages/resume/ + services/api/src/ai/ | 16h |
| W3 | K2d 语义 diff(简化版,前后对比)| apps/kiosk/src/pages/resume/ResumeOptimizePage.tsx + AI 网关 prompt | 14h |
| W3 | BE-7 JobFair / FairCompany / FairZone Prisma 模型 + 迁移 | schema.prisma + migrations | 6h |
| W4 | Admin 工作台聚合 API(后端)| services/api/src/admin-dashboard/ | 4h |
| W4 | 修 bug / 兜底 / 文档同步 | - | 6h |

**Claude 工时合计 ≈ 88h(约 11 天单人,4 周内可消化)**

### Mavis 负责的模块

| Week | 模块 | 文件范围 | 预估 |
|---|---|---|---|
| W1 | K1 Kiosk 首页卡片墙重做 | apps/kiosk/src/pages/home/ | 8h |
| W1 | K3 Kiosk 招聘列表 + 合规横幅(等 Claude ComplianceBanner)| apps/kiosk/src/pages/jobs/JobsPage.tsx | 6h |
| W1 | A4 Admin 岗位信息源(合规声明蓝色横幅)| apps/admin/src/routes/job-sources/ | 6h |
| W1 | P1 Partner 工作台 D 方案(8 卡 + 趋势)| apps/partner/src/routes/dashboard/ | 8h |
| W2 | A3 Admin 文件管理 UI(消费 BE-1)| apps/admin/src/routes/files/ | 12h |
| W2 | Kiosk 上传页隐私文案前置(1 段顶部声明)| apps/kiosk/src/pages/resume/ResumeSourcePage.tsx | 1h(此模块归 Claude,Mavis 只加文案段,需 handoff)|
| W3 | Partner 外部岗位管理(数据表现列 + 批量导入 UI 简版)| apps/partner/src/routes/jobs/ | 10h |
| W3 | Kiosk fair 7 页接真 API(消费 BE-7)| apps/kiosk/src/pages/job-fairs/ | 8h |
| W3 | Kiosk 校企合作主题变体(banner + 现场服务四卡)| apps/kiosk/src/pages/job-fairs/JobFairDetailPage.tsx | 4h |
| W3 | Partner 招聘会管理 + Admin 审核 UI | partner/fairs + admin/fair-sources | 8h |
| W4 | A5 Admin 审计日志列表 UI(消费 BE-2)| apps/admin/src/routes/audit/ | 6h |
| W4 | Admin 工作台前端 8 卡 + 趋势(消费 Claude 聚合 API)| apps/admin/src/routes/dashboard/ | 6h |
| W4 | demo seed 数据 | prisma/seed.ts | 6h |

**Mavis 工时合计 ≈ 89h(约 11 天单人,4 周内可消化)**

---

## 10. 验收节点

| 时点 | 谁验 | 验什么 |
|---|---|---|
| W1 EOD | Claude | packages/ui 4 组件 + BE-1 文件 API 可调通 |
| W2 EOD | Claude | 文件清理可演 / Kiosk 简历上传 → 诊断闭环 / 隐私文案在上传页可见 |
| W3 EOD | 双方 + 用户 | Kiosk 招聘会 + 校企合作端到端 / 第 1 版 demo 视频 |
| W4 EOD | 用户 | 学校就业指导中心 1.5h 完整 demo / 最终视频 |

---

## 11. 文档更新责任

- `current-progress.md`:Claude 与 Mavis 各自每完成一个模块写一段,**不动对方写的段**
- `next-tasks.md`:同上
- `owners.md`(本文档):改动须双方 PR 评审通过
- 新增 `docs/product/*` 文档:双方各管自己负责的模块,不互相覆盖

---

## 起草人

- Claude(Opus 4.7)— 2026-05-30
