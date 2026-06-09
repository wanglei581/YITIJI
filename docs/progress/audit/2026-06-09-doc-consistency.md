# 文档一致性核对（2026-06-09）

> 审计员：general（branch session `mvs_554a47a5a89b4573abf403481817472d`）
> 工作区：`/Users/wanglei/AI求职打印服务终端`
> 审计方式：只读 diff（git log / git branch / 文件 Read），不动代码、不动 git、不动 CLAUDE.md / next-tasks.md
> 必读入口：CLAUDE.md §15–§18、docs/progress/next-tasks.md、docs/progress/current-progress.md、docs/progress/project-state-audit-2026-06-06.md、docs/compliance/compliance-boundary.md
> 必跑命令结果：见各段"实际状态"列

## 摘要

经核对，CLAUDE.md §15 / §16 / §18 与 docs/progress/next-tasks.md / current-progress.md 出现 **多处明显文档滞后**（P0 已实际合入仍标 P0、过期 commit / 分支名引用、Phase 编号冲突、日期未更新）。建议优先按本报告末尾"必须修正的 5 条"按序修。

---

## 一、CLAUDE.md §16 / §18 与现实的偏差

| 位置 | 文件:行 | 现状描述 | 实际状态 | 建议动作 |
|------|---------|----------|----------|----------|
| P0 第 1 条 | CLAUDE.md §16, L686 | "Excel 字段映射 service 层接入（FieldMappingRule / ImportBatch / ImportRecord 已在 partner adapter re-export，Sources 页 4 步向导 mock 已存在，**下一步是把 mock 切到 service 调用 + 后端落 ImportBatch**）" | T1 已完成并合入 main：merge commit `fa99803 Merge branch 'claude/t1-excel-field-mapping' into main` + 子 commit `868e574 feat: T1 接入 Excel 字段映射规则持久化与复用`；Q1 复核 2026-06-04 跑通 `pnpm verify:field-mapping:http` ALL PASS（见 next-tasks.md §T1 + current-progress.md §〇·Q1） | 把该条从 P0 移出，挪到「已完成（保留作为基线）」段，注明 T1 完成 + merge `fa99803`；§18 `[ ] Excel 导入 + 字段映射 UI` 也需重新评估是否还成立 |
| P0 第 2 条 | CLAUDE.md §16, L687 | "BullMQ API 拉取 worker（W3 后端 JobSource 已有 endpoint/encryptedCredential，待 worker 周期性拉取）" | T2 已验证：merge commit `cef7650 Merge branch 'claude/t2-api-pull-worker' into main` + 71b0f09 `docs: T2 verify BullMQ API pull worker`；`pnpm verify:job-sync` ALL PASS（Redis + BullMQ 走真队列，jobId 用 `${sourceId}_manual` 避免冒号） | 移出 P0；剩余真源 API 联调 / REDIS_URL 生产必配 留 P1 段，与 next-tasks §T2「[待办]」对齐 |
| P0 第 3 条 | CLAUDE.md §16, L688 | "Phase 9 UI Polish + AI 数字人引导员（Phase 8 封板后启动）" | 9.1 / 9.2 / 9.3 全部 ✅：9.1 (PR #16–19)、9.2 (PR 已合 `f79b4d8`)、9.3 (PR #29 之后)；AI 数字人已走 TRTC 真人「小青」+ 文字对话路线（current-progress.md §〇·B）；CLI/AGENTS.md 2026-06-07 描述为「AI 数字人已完成」 | 把该项从 P0 移除，挪到「已完成」段并改为「Phase 9.1–9.3 已完成；9.4+ 视觉收口 + AI 模拟面试官（编号冲突待解）属 P1」 |
| §18 优先级末 2 条 | CLAUDE.md §18, L781–L783 | `[ ] Excel 导入 + 字段映射 UI（Phase 6 P1）` 与 `[ ] 字段映射引擎（服务端）` 都还勾空 | T1 已落地字段映射引擎（`getMappingRule` / `confirmExcelImport` 走 `FieldMappingRule`），仅 UI 接入 4 步向导 mock→service 是剩余项；需把这两条更新为：引擎 ✅ / UI 接入 ⏳ | §18 优先级列表勾选状态同步：引擎标 `[x]`、UI 接入改为 `[ ] UI service 调用切真（mock→service）` 并注 T1 已完成 |
| §15 日期 | CLAUDE.md §15, L672 | "当前阶段（**2026-06-01**…）" 段落标题和内容描述停留在 2026-06-01 | main 已推进到 PR #39 `bfd26f4 feat(api,kiosk): add member print orders readonly list` (2026-06-08)，current-progress.md 自身最后更新 2026-06-08；最近 7 天的 PR #28–#39 均未在 §15 反映 | 把 §15 顶部日期改为 2026-06-08，并在「当前阶段」段补 7 天增量摘要（C-1 / C-2A / C-2B / C-2C / C-2C follow-up / 招聘模块重构 Phase 1+2 / 会员打印订单） |

## 二、next-tasks.md 中"已 FF 合入"但仍标 P0 的项

| 位置 | 文件:行 | 现状描述 | 实际状态 | 建议动作 |
|------|---------|----------|----------|----------|
| P0 #1 "未提交的 TRTC/LLM 新功能定批" | next-tasks.md L535 | 仍把 `services/api/src/trtc/*`、`services/api/src/ai/llm/*`、`apps/admin/src/routes/ai-config/*` 列为"未跟踪新功能，必须与依赖文件同批提交" | 这些目录早已合入 main：`0f41dd1 fix(build): commit TRTC backend + LLM integration deps`、PR #9 `e354108 llm-role-guard-clean`、PR #12 `e293810 trtc-stop-billing-guard-clean`、4c9cbe9 / 5da76ce 专家审查阶段 A；AssistantPage 已接 TRTC + 文字对话（current-progress §〇·B） | 从 P0 中删除；改为指向 next-tasks §历史已完成状态（Phase 9.3）"待 FF merge" → 实际已 merge，移到历史已完成状态段 |
| P0 #2 "feat/phase9-assistant-actions FF 合入 main" | next-tasks.md L536 | 仍把该分支列为 P0 | PR #28 / #29 之后，current-progress 写「C-1 完成后 C-2A 紧接着开工」；phase9-assistant-actions 在 9.3 段标 ✅（next-tasks §历史已完成状态（Phase 9.3）） | 移出 P0；与 CLAUDE.md §16 P0 #3 同步更新 |
| P0 #3 "Excel 字段映射 service 层接入" | next-tasks.md L537 | 仍标 P0 | T1 完成（merge `fa99803`、868e574）+ Q1 复核 ALL PASS，next-tasks 自己 §T1 段也写「✅ [已完成 2026-06-04]」 | 移出 P0；剩余"mock→service 调用" 留 P1 段并指向 T1 已完成段 |
| P0 #4 "BullMQ API 拉取 worker 验证" | next-tasks.md L538 | 仍标 P0 | T2 完成（merge `cef7650`、71b0f09、real Redis + BullMQ 走真队列） | 移出 P0；剩余 REDIS_URL 生产必配 + 真源 API 联调 留 P1 段 |
| 重复 H2 标题 | next-tasks.md L508、L528 | 同一文件出现两个 `## 🔜 下一步优先级` H2（分别对应 W7 段落尾 + 总 P0 入口），目录锚点冲突 | 实际是历史遗留：上面那段是 W7 收尾后的「下一步」，下面那段是更早的 P0 总入口；阅读时易混淆 | 把上面 L508 改为 `## 🔜 W7 之后下一步（历史）` 或合并到下面 H2，删除冗余标题 |

## 三、未维护 / 已废弃的引用

| 位置 | 文件:行 | 现状描述 | 实际状态 | 建议动作 |
|------|---------|----------|----------|----------|
| 旧分支名 `fix/expert-audit-stage-b-clean` | project-state-audit-2026-06-06.md L41 | "ahead 1 / behind 33…不建议继续开发；如仍需该修复，应基于最新 main 重放" | 当前 `git branch -a` 已无 `fix/expert-audit-stage-b-clean` 与 `fix/expert-audit-stage-b`（仅 `origin/fix/expert-audit-stage-a` 存在，已合入 main via PR #6 `f7e0812`） | 在审计正文加注「已由 PR #6 `f7e0812 fix/expert-audit-stage-b` 合入，stage-b 分支已清理」；避免后续协作者把 stage-b-clean 当活分支 |
| T2 干净基线 `fc0018a` | next-tasks.md L307 | "claude/t2-api-pull-worker，基于干净 main `fc0018a`" | 实际 `fc0018a fix: make AI result cleanup deletion predicate-based` 是历史 commit；T2 已 merge 到当前 main (`cef7650`)，但文档的"基于干净 main fc0018a"描述常被误读为"还停留在 fc0018a 之上" | 改写为"基于 main `fc0018a` 时期开发，已 FF 合入当前 main（merge `cef7650`）" |
| "feature/screensaver-external-video-v2" 描述 | next-tasks.md L176 | "（基于 `6ac1ac4`，+1 commit `99c3711`）…FF 合入 main" | 该 PR 实际已合入：merge commit `adc47e5 Merge pull request #25 from wanglei581/feature/screensaver-external-video-v2` | 标注"已合入"状态 + 实际 merge commit `adc47e5` |
| "5ee38f0 PR #34" 等历史 PR 引用 | next-tasks.md 多处 | 文档将 `5ee38f0` 标为「PR #34」时与 git first-parent 顺序对得上，但当前 first-parent 看到的是 PR #37 / #38 / #39；旧 PR 编号只对历史窗口正确 | 当前 main first-parent 末位 PR #39 (`bfd26f4`)，次位 PR #38 (`273e804`)，再次 #37 (`197579f`)；引用旧 PR 号本身没错，但不要让"下一步"段落停留在 PR #25 视角 | 与本审计"四"段"日期口径" 同步处理：每个"待 FF 合入 main"句子都加 merge commit hash |
| 6ac1ac4 作为"干净基线" | next-tasks.md L166、L182 | "main（`6ac1ac4`）已确认为可开新功能的干净基线" | 6ac1ac4 是 2026-06-06 PR #24，当前 main 已远在其后（PR #39） | 替换为当前 main head（如 `197579f` 或新合入 commit），否则后续协作者按 6ac1ac4 起基线会错过 7 天增量 |

## 四、多个文档说同一件事但口径不一致

| 位置 | 文件:行 | 现状描述 | 实际状态 | 建议动作 |
|------|---------|----------|----------|----------|
| 「最后更新」日期 | CLAUDE.md §15 L672 (2026-06-01) / current-progress.md L3 (2026-06-08) / next-tasks.md L3 (2026-06-08) / compliance-boundary.md L3 (2026-06-07) | 同一时间窗内，CLAUDE.md §15 顶部日期比 current-progress / next-tasks 晚 7 天，比 compliance 晚 6 天 | CLAUDE.md 顶部未声明"最后更新"日期，但 §15 内文日期明显落后 | 在 CLAUDE.md 顶部加 "最后更新：2026-06-09" 字段，并要求每次合入 PR 时由合入者同步更新 |
| Phase 9.5 编号冲突 | next-tasks.md L1078 "Phase 9.5 AI模拟面试官（编号与 current-progress.md 已完成的「Phase 9.5 AI数字人语音通话修复」冲突）" vs current-progress.md §〇·B（2026-06-04 校正） | 同一编号 "Phase 9.5" 在两个文档指向两件不同事 | next-tasks.md 自己也已警告"编号与 current-progress.md 已完成的「Phase 9.5 AI数字人语音通话修复」冲突，后续需重命名/重新编号" | 二选一：以 current-progress.md §〇·B 为准，next-tasks.md 把"AI 模拟面试官"重命名为 Phase 9.5.1 或 Phase 9.6 |
| 「下一步候选」 vs 「下一步优先级」 | next-tasks.md §🧭 下一步候选（L162–186）vs §🔜 下一步优先级（L508–568） | §下一步候选 是 2026-06-06 阶段收口后视角（A 宣传屏真机手验 / B 外部视频直链 / C 新功能开发），§下一步优先级 是 2026-06-04 视角（T1/T2/T3 FF 合入 + TRTC/LLM） | 两段在文档内并列存在，但视角差 2 天；§下一步优先级 段 T1/T2 已合入 main 后未同步更新 | 合并两个段：以 §下一步候选（更新基线为 197579f）为最新视角，§下一步优先级 段标注「（2026-06-04 视角，已被下文 §下一步候选 取代）」 |
| CLAUDE.md §18 优先级 vs next-tasks §T1 | CLAUDE.md §18 L781 `[ ] Excel 导入 + 字段映射 UI` + `[ ] 字段映射引擎（服务端）` vs next-tasks.md §T1 L299「**澄清事实差异**：CLAUDE.md §16 / §18 把…列为 P0 待办，**实际已由 W4 完成**」 | next-tasks 自己的 §T1 段已经把 CLAUDE.md §16/§18 描述为「过时」，但没人去改 CLAUDE.md | T1 合并后未同步刷新 CLAUDE.md §16/§18 状态 | 合并修：在 CLAUDE.md §16 P0 移出 3 条 + §18 勾选状态刷新 + 在 next-tasks §T1 段加 ✅ 标注「[2026-06-09] CLAUDE.md §16/§18 已同步更新」 |
| `feature/fair-detail-5tab` 当前状态 | `git log feature/fair-detail-5tab ^main` 4 个 commit（925007f / 91fb6ee / cf2c9e2 / b30e60e） vs current-progress.md / next-tasks.md 没有任何条目 | 4 个 commit 都是「招聘会模块重构 / 详情页对齐参考图 / 地区筛选升级为全国省/市/区」，属 Kiosk 招聘会的实质性视觉+数据重构（Phase 1+2） | current-progress.md §顶部最新段是 Phase C-2C follow-up（2026-06-07），未收录招聘会重构 | 在 current-progress.md 顶部新加「招聘会模块重构 Phase 1+2（2026-06-XX，`feature/fair-detail-5tab`，未合入）」段，与 current-progress.md §顶部「Kiosk 首页结构重构」并列 |
| 智慧校园模块在 feature/smart-campus-mvp 上 WIP，未合入 main | git log 显示 `e8f18af feat(smart-campus): 智慧校园按终端开关 Phase 1 MVP（kiosk+api+admin 端到端）` 等多个 smart-campus commit，但 main first-parent 不含 | 6 个 smart-campus 相关 commit 都在 `feature/smart-campus-mvp` 上；`docs/smart-campus-planning` 也是单独分支 | current-progress.md / next-tasks.md 都未登记 smart-campus 模块的"分支未合入"状态 | 在 current-progress.md 加一行「⚠️ 智慧校园模块在 feature/smart-campus-mvp 上 WIP，未合入 main」，避免读者从 main 看不到时误以为已废 |

---

## 五、必须修正的 5 条（按优先级排序）

> 这 5 条按"读者最易踩坑"+"修起来最便宜"+"只动文档不动代码"三维度排序。

### 1. 立即修：CLAUDE.md §16 P0 三条已实际合入，移出 P0 段（高优先级 / 单文件 1 处）

**位置：** `CLAUDE.md §16` L686–L688。
**动作：**
- L686「Excel 字段映射 service 层接入」整条删除或移至「✅ 已完成（保留作为基线）」段，附 merge `fa99803`、commit `868e574`、Q1 复核脚本 `pnpm verify:field-mapping:http`。
- L687「BullMQ API 拉取 worker」同上，附 merge `cef7650`、71b0f09、real Redis 验证通过。
- L688「Phase 9 UI Polish + AI 数字人引导员」改为「9.1–9.3 ✅；9.4 视觉收口 + 9.5 面试官（编号待重）属 P1」。
**理由：** 读者从 CLAUDE.md 顶部进 §16 看到 P0 第一条就是"下一步做 Excel service 接入"，但代码早已合入 5 天；这条误导 PM 排期。
**风险：** 0。纯文档。

### 2. 立即修：CLAUDE.md §18 优先级勾选状态同步（中优先级 / 单文件 1 处）

**位置：** `CLAUDE.md §18` L777–L783。
**动作：**
- L781 `[ ] Excel 导入 + 字段映射 UI（Phase 6 P1）` 改为 `[x] 字段映射引擎（FieldMappingRule，2026-06-04 T1）` 并新增 `[ ] 4 步向导 mock → service 调用切真`（与 next-tasks §T1 文案对齐）。
- L782 `[ ] 字段映射引擎（服务端）` 删除（与上一行合并）。
- L783 `[ ] 管理员后台审核页面` 保留（属 Admin 路线，与本审计无关）。
**理由：** 同一节内勾选与正文互相打架，§18 是模型/Agent 启动后第一份要读的合规基线。
**风险：** 0。

### 3. 立即修：next-tasks.md §🔜 下一步优先级 四条 P0 全部移出（高优先级 / 单文件 1 处）

**位置：** `docs/progress/next-tasks.md` L528–L538 整段。
**动作：**
- 4 条 P0 全部移到「📌 已完成（2026-06-04 视角合并入此）」段或直接删除（内容已在 §T1 / §T2 / §历史已完成状态 段）。
- 把上方 L508 的「🔜 下一步优先级（W7 收尾）」改为「🔜 W7 之后下一步（历史）」，与下方 L528 区分。
**理由：** 当前 4 条 P0 与 §下一步候选（L162–186，2026-06-06 视角）口径冲突；L528 段是 4 天前快照。
**风险：** 0。

### 4. 修：CLAUDE.md §15 顶部日期 + 「当前阶段」段补 7 天增量（中优先级 / 单文件 1 处）

**位置：** `CLAUDE.md §15` L672 整段。
**动作：**
- 顶部加 `> 最后更新：2026-06-09` 字段（与 current-progress.md / next-tasks.md 同步格式）。
- 段尾追加：「**2026-06-02 ~ 2026-06-08 增量**：Phase C-1 会员登录安全收口 / Phase C-2A 匿名 AI accessToken / Phase C-2B 会员个人资产中心 MVP / Phase C-2C 收藏+权益底座 / C-2C follow-up 岗位收藏服务端化 / 会员「我的打印订单」只读 / Kiosk 首页结构重构（PR #37）/ 招聘会模块重构 Phase 1+2（在 `feature/fair-detail-5tab`，未合入） / 智慧校园 WIP（在 `feature/smart-campus-mvp`，未合入） / 招聘 external-video v2（PR #25） / 9.1–9.3 视觉收口 + AI 数字人 TRTC『小青』。」
**理由：** §15 是切换模型/启动新窗口的第一份现状基线，7 天空窗期会让新模型误判优先级。
**风险：** 0。

### 5. 修：current-progress.md 顶部新加 3 段「未合入 main 的活跃分支登记」（中优先级 / 单文件）

**位置：** `docs/progress/current-progress.md` L8 之前新加「⚠️ 活跃未合入 main 分支」一节。
**动作：**
- 列出 `feature/fair-detail-5tab`（4 commit，招聘会重构 Phase 1+2，最新 925007f）。
- 列出 `feature/smart-campus-mvp`（6 commit，智慧校园 Phase 1 MVP，最新 68445c2 / aa80c47「parked for jobfair-revamp」）。
- 列出 `docs/smart-campus-planning`（4 commit，对接设计 §〇 / §十三 / 原型 / 价值话术单页，最新 dc39136）。
- 每条注明：分支名、最新 commit、相对 main 的 ahead/behind、状态（WIP / parked / 规划中）。
**理由：** 现状是两个最实质的 Kiosk 改动（招聘会重构 + 智慧校园）都在 main 之外，文档里看不到，PM 误以为还没开工。
**风险：** 0。

---

## 附：本审计未触及的 3 个"已知 OK"事项（防止其他审稿人误报）

1. **Phase 8 全部封板（2026-05-29）**：next-tasks §✅ Phase 8 全部封板 描述与 main first-parent 一致（`860d7a4` PR #20、PR #21 `f807b75 codex/ai-materials-phase-a`、PR #22 `7bafc92`、PR #23 `3dfeb5d`、PR #24 `6ac1ac4` 全部按顺序合入）。
2. **Phase 9.1 / 9.2 / 9.3 完成状态**：PR #15–#19 顺序合入 + `f79b4d8` 9.2 数字人 SVG + `b60fd8f` 9.1 UI polish + 9.3 AssistantPage 7 快捷入口，current-progress 描述与 first-parent 一致。
3. **C-1 / C-2A / C-2B / C-2C / C-2C follow-up**：PR #28 / #30 / #32 / #33 / #34 / #36 / #37 / #38 / #39 全部顺序合入 current-progress 描述对应段；无错位。

