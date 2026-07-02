# 任务开卡:X1 + N2/N4 —— Admin 前端共享原子去重 + 路由拆分

> 开卡日期:2026-07-02
> 分支:`codex/normalize-structure-closure` @ 最新 `origin/main d057850c`
> 依据:`docs/reviews/engineering-scale-normalization-backlog.md`(X1 / N2 / N4);`.ccg/spec/guides/index.md §一/§二/§三/§六`;CLAUDE.md §8.1
> 就绪状态(2026-07-02 已验证):无在途冲突;基线已 rebase 对齐;`pnpm install` exit 0;Admin `typecheck` EXIT=0 / 0 error。

## 1. 真实闭环 / 目标

把 Admin 两个超阈值路由文件降回阈值内,并消除二者重复定义的共享 UI 原子,**行为与视觉零变化**:

- `apps/admin/src/routes/fairs/index.tsx`(1349)→ 拆大组件后主文件回到编排级(目标 < 300 行)。
- `apps/admin/src/routes/companies/index.tsx`(1116)→ 同上。
- 两文件重复的 `Field / PrimaryButton / GhostButton / DangerDeleteButton / InlineError`(companies 另有 `Switch / InlineSuccess`)→ 抽到 Admin 内共享一份。

对应 guides §二(阈值治理)+ §三(反堆砌去重)。

## 2. 功能归位声明

- 前端:`apps/admin`(仅 fairs / companies 两个路由 + 新增 Admin 内共享组件目录)。
- 后端 `services/api`:**不涉及**(这两个页面调用的 API 不变)。
- 终端 `apps/terminal-agent`:**不涉及**。
- 共享类型 `packages/shared`:**不涉及**。
- 共享 UI `packages/ui`:**本任务不涉及**——共享原子先放 `apps/admin` 内部,缩小范围;是否上提 `packages/ui`(供三端复用)留作后续独立评估,避免一次触碰三端。
- 文档 `docs/`:完成后同步进度 + 回勾 backlog。

## 3. 允许修改 / 新增 文件

新增:
- `apps/admin/src/components/form/`(共享原子:`Field` `PrimaryButton` `GhostButton` `DangerDeleteButton` `InlineError` `InlineSuccess` `Switch`)
- `apps/admin/src/routes/fairs/components/`(`EditFairDrawer` `CompaniesTab` `ZonesTab` `MaterialsTab` `StatsTab`)
- `apps/admin/src/routes/companies/components/`(`CompanyFormFields` `ReviewPublishSection` `LinkedJobsSection` `CompanyDetailDrawer` `CreateCompanyDrawer`)

改动(仅保留 Page 编排 + import,删掉被抽走的实现):
- `apps/admin/src/routes/fairs/index.tsx`
- `apps/admin/src/routes/companies/index.tsx`

## 4. 禁止修改

- 任何 `services/**`、`apps/kiosk/**`、`apps/partner/**`、`apps/terminal-agent/**`、`packages/**`。
- 其它 Admin 路由(orders / files / terminals / screensaver / partners / job-sources …)。
- 组件的 props 语义、行为、文案、视觉样式(className / 结构)——**只搬移,不重写**。
- 在途任务(toolbox / terminal-device / job-master)的任何文件。

## 5. 触碰面

- 不碰岗位 / 招聘会 / 企业 **数据模型 / API**(纯前端组件搬移,调用不变)。
- 不碰简历 / 文件 / 打印 / 生产配置 / 数据库 / 密钥 / 硬件链路。
- 不碰合规文案(按钮 / 免责声明原样保留)。

## 6. 验证清单(交付前必须通过)

- [ ] `pnpm --filter @ai-job-print/admin typecheck`(EXIT=0)
- [ ] `pnpm --filter @ai-job-print/admin build`(`tsc -b && vite build` 成功)
- [ ] `pnpm --filter @ai-job-print/admin lint`
- [ ] 桌面视口浏览器走查(Admin 横屏后台):`/fairs` 编辑抽屉 / 公司 / 展区 / 物料 / 统计四 Tab,`/companies` 详情抽屉 / 新建 / 审核发布 / 关联岗位——逐一确认渲染与交互与拆分前一致。
- [ ] `git diff --stat` 确认仅 `apps/admin/**` 改动,无越界。
- [ ] 双模型 review(Claude + antigravity 前端)复核拆分零行为变化。

> 注:fairs/companies 无专门行为 verify 脚本,回归靠上述 typecheck/build/lint + 人工走查,拆分须逐组件对照。

## 7. 需同步文档

- 回勾 `docs/reviews/engineering-scale-normalization-backlog.md` 的 X1 / N2 / N4。
- `docs/progress/current-progress.md` 治理表 + `next-tasks.md` 勾选。

## 8. 执行顺序(每步 typecheck 绿 + 独立 commit,禁止 `git add .`)

1. **X1**:抽共享原子到 `apps/admin/src/components/form/`,先让 fairs、companies 都改为 import 该共享原子(删除本地重复定义)。typecheck 绿 → commit。
2. **N2**:把 fairs 的 5 个大组件逐个搬到 `fairs/components/`,`index.tsx` 只留 `FairsPage` 编排。typecheck 绿 → commit。
3. **N4**:把 companies 的段落 / 抽屉组件搬到 `companies/components/`,`index.tsx` 只留 `CompaniesPage` 编排。typecheck 绿 → commit。
4. 全量验证清单 → 双模型 review → 文档同步。
