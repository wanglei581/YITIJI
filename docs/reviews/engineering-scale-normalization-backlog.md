# 工程规模规范化 Backlog / 拆分清单

> 生成日期:2026-07-02
> 基线:`origin/main` @ `298e5410`(feat: complete AI resume diagnosis closure)
> 分支:`codex/normalize-structure-closure`(从干净 `origin/main` 新建,Option C)
> 方法:只读结构审计(`wc -l` + 方法/组件签名抽取),**零代码改动**
> 依据:`.ccg/spec/guides/index.md §二 单文件大小阈值` / `§三 反堆砌` / `§六 审查验收`;CLAUDE.md §8.1;AGENTS.md 标准化执行口径

本清单是 `.ccg/spec/guides/index.md §二` 规定动作的落地:**>1000 行文件「进入重构/拆分清单」**。清单只定方向与排期,不含任何源码改动。后续每一项实拆都必须**单独开卡、单独 worktree、行为保持、verify 门禁、双模型 review**,并排在与之冲突的在途任务落地之后。

## 一、阈值分布总览(干净基线)

| 区间 | 文件数 | 规则(§二) |
|---|---|---|
| >1000 行 | 4 | 进入重构/拆分清单,后续任务不得继续扩大 |
| 800–1000 行 | 4 | 不得继续堆新功能;只能修复/拆分/收口 |
| 500–800 行 | 28 | 新增功能前必须评估拆分(监控区) |
| 合计源码文件 | 688 | — |

**冲突风险图例**:🔴 高(在途任务主战场,先别动)/ 🟡 中(有交叠,排期错峰)/ 🟢 低 / 🧊 冻结(UI 冻结区,不拆,仅记录)

---

## 二、P0 拆分清单(>1000 行,4 个)

### N1 · `services/api/src/jobs/jobs.service.ts` — 2316 行 🔴

单文件承载了 4~5 个独立职责簇 + 约 648 行前置类型定义,是全仓最大的"多职责聚合"。

| 职责簇 | 方法(约行段) | 建议目标模块 |
|---|---|---|
| Kiosk 公开读取(岗位/招聘会) | getPublishedJobs / getPublishedFairs / getPublishedFairDetail / getFairCompanies / getFairZones / getFairMap / getFairStats（670–1010） | `jobs-public.service.ts` + `fairs-public.service.ts` |
| Admin 审核/发布 | getAllJobSources / reviewJobSource / publishJobSource / getAllFairSources / reviewFairSource / publishFairSource（1010–1195） | `jobs-admin-review.service.ts` |
| Partner 数据源 + 导入 | getPartnerDataSources / createPartnerDataSource / importJobs / importJobsFromWebhook / updatePartnerJob / importFairs / getPartnerDashboard / getPartnerSyncLogs / writeSyncLog（1195–1798） | `partner-data-source.service.ts`（约 600 行,可能需二次拆:数据源配置 vs 导入 vs dashboard/synclog） |
| Excel 导入引擎 | parseExcelColumns / loadExcelRows / previewExcelImport / confirmExcelImport / getAdminImportBatches / cancelExcelImport / getMappingRule / saveMappingRule（1798–2316） | `excel-import.service.ts` |
| 前置类型/DTO | 1–648 | `jobs.types.ts` |

- **冲突风险**:🔴 高。toolbox / job-ai 分支正大改岗位链路;`feature/job-master` M1 会**只读**岗位数据。**排期:必须在 toolbox 岗位相关提交合入 main 之后**,否则大面积合并冲突。
- **verify 覆盖**:`verify-job-review` / `verify-job-sync` / `verify-jobfair-review` / `verify-jobfair-campus-priority` / `verify-job-favorites-http` / `verify-public-fair-demo-guard`;⚠️ Excel 导入路径 verify 覆盖需实拆前确认(可能存在缺口)。

### N2 · `apps/admin/src/routes/fairs/index.tsx` — 1349 行 🟡

结构:共享 UI 原子(Field/PrimaryButton/GhostButton/DangerDeleteButton/InlineError,118–196)+ 5 个大组件。

| 组件 | 约行段 | 建议目标文件 |
|---|---|---|
| EditFairDrawer | 196–419 | `fairs/components/EditFairDrawer.tsx` |
| CompaniesTab | 419–683 | `fairs/components/CompaniesTab.tsx` |
| ZonesTab | 683–824 | `fairs/components/ZonesTab.tsx` |
| MaterialsTab | 824–1122 | `fairs/components/MaterialsTab.tsx` |
| StatsTab | 1122–1181 | `fairs/components/StatsTab.tsx` |
| FairsPage(编排) | 1181–1349 | 保留 `index.tsx` |
| 共享 UI 原子 | 118–196 | 见 X1 去重项 |

- **冲突风险**:🟡 中(展会 Admin 有零星在途改动)。这是 Admin 后台,**不在 Kiosk UI 冻结范围**;但仍是前端,拆分须行为/视觉零变化。
- **verify 覆盖**:后端 `verify-admin-fairs` / `verify-fair-*` / `verify-jobfair-venue-guide` 覆盖 API;前端无单测 → 依赖 `typecheck` + `build` + 1080×1920 浏览器走查。

### N3 · `services/api/src/terminals/terminals.service.ts` — 1182 行 🔴

| 职责簇 | 方法 | 建议目标模块 |
|---|---|---|
| Agent 运行时(注册/心跳/任务) | register / heartbeat / claimTasks / patchTaskStatus / resetExpiredClaims / seedPrintTask | `terminals-agent.service.ts` |
| Token/设备校验 | validateTerminalToken / findAndValidate / validateAnyTerminalToken / assertMacAvailable / buildDeviceProfilePatch | `terminals-auth.service.ts`(或并入 agent) |
| Admin 终端管理 | listTerminalsForAdmin / assignTerminalOrg / updateTerminalProfile / getKioskTerminalConfig / listPrintersForAdmin / getTerminalPrinterStatus | `terminals-admin.service.ts` |
| 前置类型 | 1–343 | `terminals.types.ts` |

- **冲突风险**:🔴 **最高**。当前脏分支就是 `codex/terminal-device-profile-closure`,terminal-device / toolbox-config 正是其主战场。**排期:必须等该分支合入 main 后再拆。**
- **verify 覆盖**:⚠️ **仅 `verify-terminal-device-config` 一个**,且 Agent 运行时链路(心跳/claim)是硬件相邻代码。拆分风险高,须补跨机 E2E,不能只靠 typecheck。

### N4 · `apps/admin/src/routes/companies/index.tsx` — 1116 行 🟡

结构:共享 UI 原子(Field/PrimaryButton/GhostButton/Switch/InlineError/InlineSuccess/DangerDeleteButton,109–175)+ 段落/抽屉组件。

| 组件 | 约行段 | 建议目标文件 |
|---|---|---|
| CompanyFormFields | 342–468 | `companies/components/CompanyFormFields.tsx` |
| ReviewPublishSection | 468–567 | `companies/components/ReviewPublishSection.tsx` |
| LinkedJobsSection | 567–729 | `companies/components/LinkedJobsSection.tsx` |
| CompanyDetailDrawer | 729–850 | `companies/components/CompanyDetailDrawer.tsx` |
| CreateCompanyDrawer | 850–955 | `companies/components/CreateCompanyDrawer.tsx` |
| CompaniesPage(编排) | 955–1116 | 保留 `index.tsx` |
| 共享 UI 原子 | 109–175 | 见 X1 去重项 |

- **冲突风险**:🟡 中(CompanyProfile 近期完成,可能有后续微调)。
- **verify 覆盖**:后端 `verify-fair-company-positions` 覆盖部分 API;前端依赖 typecheck+build+浏览器走查。

---

## 三、P1 收口清单(800–1000 行,4 个)

### N5 · `services/api/src/materials/materials.service.ts` — 850 行 🟡

- 职责簇:任务生命周期(createTask/getTask/decidePiiFindings/cleanupExpired)/ 检查处理管线(inspectSourceFile/inspectImageSourceFile/evaluateNormalizeA4/evaluatePiiRedaction)/ 访问控制 guards。
- 建议:抽 `material-inspection.service.ts`(检查/归一/PII 管线),`materials.service.ts` 保留任务生命周期;guards 归入 `material-access.ts`。
- 冲突:🟡 中(print-scan 任务碰 materials)。verify:`verify-materials-processing` / `verify-job-materials` / `verify-upload-sessions*` 覆盖较好。

### N6 · `services/api/src/jobs/admin-fairs.service.ts` — 811 行 🟡

- 职责簇:展会信息 / 展位公司·展区 CRUD / 物料 / 场馆导览(saveVenueGuide 约 98 行)/ 公共 guards+audit。
- 建议:抽 `fair-company-zone.service.ts`(公司·展区 CRUD)+ `fair-material.service.ts`(物料+场馆导览),主 service 保留展会信息+stats;guards/audit 归入 `fair-guards.ts`。
- 冲突:🟡 中。verify:`verify-admin-fairs` / `verify-fair-info-fields` / `verify-jobfair-venue-guide`。

### N7 · `apps/kiosk/src/pages/renshi/RenshiPage.tsx` — 944 行 🧊 冻结

- **政策服务页,UI/UX 已冻结且近期已重设计验证**。**不拆、不动业务 UI**,仅登记为超阈值。若未来解冻,再按 `Page.tsx + components/ + hooks/` 拆。

### N8 · `apps/kiosk/src/pages/print/PrintMaterialCheckPage.tsx` — 828 行 🧊 冻结

- **打印材料检查页,Kiosk UI 冻结区**。同上:仅登记,不动。

---

## 四、跨文件去重项(§三 反堆砌)

### X1 · Admin 共享 UI 原子重复定义 🟡

`apps/admin/src/routes/fairs/index.tsx` 与 `apps/admin/src/routes/companies/index.tsx` **各自重复定义**了 `Field` / `PrimaryButton` / `GhostButton` / `DangerDeleteButton` / `InlineError`(companies 另有 `Switch` / `InlineSuccess`)。

- 建议:抽到 `apps/admin/src/components/form/`(或 `packages/ui` 若三端通用)统一复用。
- 前置依赖:与 N2/N4 拆分同批做更划算(拆组件时顺带替换原子引用),避免两次触碰同一文件。
- 风险:🟡 中(跨多个 route 文件);须逐文件替换 + 视觉零变化验证。

---

## 五、监控区(500–800 行,28 个)—— 暂不拆,新增功能前评估

不是必须拆项,仅在**对其新增功能前**评估。其中含冻结 UI(标 🧊)。

| 行 | 文件 | 备注 |
|---|---|---|
| 739 | apps/kiosk/src/pages/home/HomePage.tsx | 🧊 首页,冻结 |
| 742 | services/api/src/files/files.service.ts | 🟡 文件服务 |
| 707 | apps/kiosk/src/pages/print/PrintPreviewPage.tsx | 🧊 冻结 |
| 693 | apps/terminal-agent/src/agent/task-runner.ts | 🔴 硬件链路,慎动 |
| 677 | apps/kiosk/src/pages/interview/InterviewSessionPage.tsx | 🧊 冻结 |
| 621 | services/api/src/content/content.service.ts | 🟡 |
| 586 | services/api/src/ai/ai.service.ts | 🟡 AI 编排,job-master 会碰 |
| 576 | services/api/src/companies/companies.service.ts | 🟡 |
| 575 | services/api/src/orgs/admin-orgs.service.ts | 🟡 |
| 524 | services/api/src/job-sync/job-sync.service.ts | 🔴 toolbox 交叠 |
| … | 其余 ~18 个(路由页/verify 脚本/服务) | verify 脚本超阈值可接受(测试代码) |

> 说明:多个 `services/api/scripts/verify-*.ts`(如 verify-terminal-device-config 726、verify-file-assets-trial-acceptance 647)超 500 行属**测试/验收脚本**,§二 对生成/快照类放宽;非优先拆分对象。

---

## 六、执行纪律与排期原则(每个实拆任务必须遵守)

1. **一项一卡一分支**:每个 N#/X# 实拆单独开卡(CLAUDE.md §8.1)+ 单独 worktree,不合并多项。
2. **行为保持**:拆分只搬移代码、不改逻辑/接口/视觉;public 方法签名与路由不变。
3. **错峰排期**:🔴 项(N1/N3 及 job-sync)**必须等对应在途任务(toolbox / terminal-device / job-ai)合入 main 后**再拆;🟡 项择在其空窗期。
4. **verify 门禁**:后端拆分跑对应 `verify-*` + `typecheck`/`build` + SQLite 主验证 + PostgreSQL readiness;前端拆分跑 `typecheck`/`build` + 1080×1920 浏览器走查;terminals(N3)须补跨机 E2E。
5. **双模型 review**:每个实拆 diff 走 Claude + 前端/后端外部模型双审(model-router:frontend→antigravity,backend→codex)。
6. **文档同步**:每项完成同步 `docs/progress/current-progress.md` / `next-tasks.md`,并回勾本清单。

## 七、不做什么(红线)

- 不做物理目录迁移(§七 单列,需独立评估)。
- 不改冻结 UI(N7/N8 及监控区 🧊 项)。
- 不删已验证闭环、CI/verify 门禁、合规防线、硬件适配代码。
- 不借"降低行数"之名重写业务逻辑。
- 不 cherry-pick 脏分支(`codex/terminal-device-profile-closure`)的 40 个功能提交进本治理分支——那是 toolbox 任务资产,走其自身 track。

## 八、建议执行顺序

1. **X1 + N2/N4**(Admin 前端,🟡,不撞 Kiosk 冻结):优先做,风险可控、收益直观(去重 + 拆分一并完成)。
2. **N5 / N6**(materials / admin-fairs 后端,🟡,verify 覆盖较好):次之。
3. **N1 / N3**(jobs / terminals,🔴):**等 toolbox / terminal-device 分支合入 main 后**再排,期间保持只读监控。
