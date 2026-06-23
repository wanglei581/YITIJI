# Kiosk 页面拆分清单（重构 backlog · 暂缓执行）

> **状态:暂缓(deferred)。** 当前处于上线前收口阶段(CLAUDE.md §15/§16),§8.1 禁止大范围重写。
> 本清单仅作记录,**待上线后或在专门重构分支执行**,不在 `feature/*` 业务分支顺手做。
> 生成日期:2026-06-23 · 范围:**仅 `apps/kiosk`**,不涉及 admin/partner/terminal-agent/packages。
> 基线:`apps/kiosk` `tsc --noEmit` ✅ 通过(记录时为绿)。

## 一、背景与依据

通过本次梳理发现:kiosk **目录结构清晰,但页面内"关注点未分离"**——
UI 子组件、状态逻辑、数据整形全写在单个页面文件里,形成巨石组件。

| 指标 | 数值 |
|------|-----:|
| `pages/` 文件 | 65 |
| `components/` 全局共享组件 | 仅 3 个 |
| `hooks/` / `utils/` | 3 / 1 |
| pages 内**内联定义**的组件/常量 | 263 |
| 单页最大行数 | 956 |

**与项目规则的关系(为何"暂缓"而非"立即做"):**
- CLAUDE.md §8 文件阈值:`300 理想 / 500 评估拆分 / 800 不堆新功能 / 1000 进入重构清单`。
- kiosk 最大文件 956 行,**无任何文件 ≥1000**——尚未触达项目自定的"强制重构线"。
- 因此当前对 P0 文件的**唯一硬义务是「不要再往里加功能」**;主动拆分属优化,留待收口后。

## 二、安全边界(执行时必须遵守 · 已核实)

1. ✅ **跨 app 零引用**:admin/partner/terminal-agent 不 import kiosk;kiosk `private:true`、无 `exports`。
2. ✅ **页面间不互相引用内部子组件**:拆子组件不会断别的页面。
3. ⚠️ **铁律 A**:页面对外契约 = `routes/index.tsx` 里的导出名。重构时**保持 `export const XxxPage` 不变**。
4. ⚠️ **铁律 B**:以下两个跨模块 session 工具,**禁止改路径/导出函数名**(改则需同步 4 处 import):
   - `pages/print/printMaterialSession` ← `auth/useIdleLogout`、`hooks/useScreensaverController`
   - `pages/resume/aiResumeSession` ← 同上
   - (顺带:这两个文件放 `pages/` 下不合适,理想位置 `lib/`;迁移属铁律 B 范畴,需同步 import。)

## 三、拆分约定(统一标准)

```
pages/<域>/XxxPage.tsx            只留布局编排,目标 <300 行,保持原导出名
pages/<域>/components/*.tsx       仅本域用的子组件就近放(参照现有 job-fairs/components 样板)
pages/<域>/useXxx.ts              本页状态/副作用抽成自定义 hook
src/components/*.tsx              ≥2 个页面复用的组件才上提到全局
```
- `services/`(34 个)已分得好,**保持不动**。
- 每拆完一个文件 → `pnpm typecheck` 绿 + `pnpm lint` 无新增,才进下一个(无单测,typecheck 是主要安全网)。

## 四、作业队列(待执行 · 按优先级)

### 🔴 P0 — 超 800 行(优先,内联组件多=机械抽取收益最大)

| # | 文件 | 行数 | 内联组件 | 手法 |
|---|------|-----:|---------:|------|
| 1 | `campus/CampusFairDetailPage.tsx` | 956 | 22 | 抽 22 子组件 → `campus/components/`,页面留编排 |
| 2 | `renshi/RenshiPage.tsx` | 944 | 18 | 抽 18 子组件 + `useRenshi` hook |
| 3 | `job-fairs/JobFairDetailPage.tsx` | 930 | 15 | 抽子组件,复用已有 `job-fairs/components/` |
| 4 | `print/PrintMaterialCheckPage.tsx` | 823 | 6 | 内联组件少→以 hook 抽逻辑为主(注意铁律 B 邻近 printMaterialSession) |

### 🟠 P1 — 500~800 行

| # | 文件 | 行数 | 内联组件 | 手法 |
|---|------|-----:|---------:|------|
| 5 | `print/PrintPreviewPage.tsx` | 702 | 9 | 组件+hook |
| 6 | `interview/InterviewSessionPage.tsx` | 677 | 3 | hook 为主(逻辑密集) |
| 7 | `job-fairs/FairCompanyDetailPage.tsx` | 628 | 10 | 抽子组件 |
| 8 | `auth/LoginPage.tsx` | 625 | 10 | 抽子组件 |
| 9 | `profile/ProfilePage.tsx` | 589 | 12 | 抽子组件 |
| 10 | `home/HomePage.tsx` | 552 | 10 | 抽子组件 |
| 11 | `resume/ResumeSourcePage.tsx` | 539 | 9 | 组件+hook(注意铁律 B 邻近 aiResumeSession) |
| 12 | `jobs/JobsPage.tsx` | 519 | 6 | 组件+hook |

### 🟡 P2 — 300~500 行(收尾批次,视时间推进)

`CampusPage(487)` `ResumeOptimizePage(478)` `InterviewSetupPage(462)` `CompanyDetailPage(448)`
`ResumeGeneratePage(410)` `ResumeReportPage(378)` `PrintProgressPage(374)` `CompaniesPage(372)`
`JobDetailPage(364)` `JobFairsPage(355)` `ResumeGeneratePreviewPage(355)` `AssistantPage(343)`
`JobFitPage(332)` `CareerPlanPage(302)`

## 五、附带可立即处理的小项(与重构解耦,合规收口期亦可做)

- [ ] 命名统一:`pages/renshi`(拼音)与同级 `campus`/`smart-campus`(英文)风格不一致。功能无重叠(renshi=人事政务,campus=校招会,smart-campus=校园服务),仅建议改英文名,**属铁律 A 范畴**(改目录需同步 routes import)。
- [ ] 根目录 `项目源码及需求文档.zip`(9.4M)、`.DS_Store` 建议加入 `.gitignore` 并从版本库移除。

## 六、执行 SOP(将来开干时)

1. 新开**独立重构分支**(勿在 `feature/*` 业务分支上做)。
2. 逐文件:读懂 → 建 `components/` 与(如需)`useXxx.ts` → 迁移 → 页面留编排 → **保持导出名**。
3. `pnpm typecheck` 绿 + `pnpm lint` 无新增 → 进下一个。
4. 完成后:按 §7 把改动记入 `docs/progress/current-progress.md`;可加 ESLint `max-lines`(建议 400 warn)防回归。
