# Claude 执行指令：找企业真实数据联动改版

你是 Claude Code，负责在隔离 worktree 中实现「岗位信息 / 找企业 / 企业详情」真实数据联动改版。

## 绝对目标

把当前「找企业」从看起来像少量演示数据的筛选页，改成用户可以正常使用的「来源企业导览」功能板块。必须前后端真实联动，不允许 mock，不允许假数据，不允许只改 UI。

## 双模型分析后的执行约束

这不是从零新建模块。现有 `CompanyProfile`、公开 `/companies*`、Admin `/admin/companies*`、Partner `/partner/companies*`、activity browse/jump 与 `verify:companies` 已经形成基础真实链路。你的任务是**在绿色基线之上做增量修复和体验升级**，不是推倒重写。

执行顺序必须是：

1. 先跑现有 `verify:companies` 与相关 typecheck/build，记录基线。
2. 再做最小增量改动。
3. 每个改动后复跑聚焦验证。

关键决策已经由用户明确：地区必须支持完整省 / 市 / 区选择。允许引入或复用真实行政区划基础字典；这类地理字典不是业务 mock。筛选结果仍必须由后端真实查询返回；选择无企业地区时展示真实空态，不允许造企业。

不要新增会永久空结果且没有后端语义支撑的招聘类型。企业类型、行业、来源类型可以扩展为更完整字典，但每个新增值必须前后端同步，并能被 Admin/Partner 正常保存、后端正常校验、Kiosk 正常展示。

不要破坏现有发布状态机、机构隔离、禁词扫描、mock 诚实失败设计。

## 必读文件

1. `AGENTS.md`
2. `docs/product/feature-scope.md`
3. `docs/product/user-data-flow-matrix.md`
4. `docs/compliance/compliance-boundary.md`
5. `docs/progress/current-progress.md`
6. `.ccg/tasks/control-claude-company-real-redesign/requirements.md`

## 范围

允许修改：
- `apps/kiosk/src/pages/jobs/*`
- `apps/kiosk/src/pages/companies/*`
- `apps/kiosk/src/services/api/companies.ts`
- `apps/kiosk/src/services/api/activity.ts`（仅必要时）
- `apps/admin/src/routes/companies/*`
- `apps/admin/src/services/api/companiesAdmin.ts`
- `apps/partner/src/routes/companies/*`
- `apps/partner/src/services/api/companiesPartner.ts` 或同等企业资料 service
- `packages/shared/src/types/company.ts`
- `services/api/src/companies/*`
- `services/api/src/jobs/*`（仅企业/岗位关联必要范围）
- `services/api/prisma/schema.prisma`
- `services/api/prisma/postgres/schema.prisma`
- `services/api/prisma/migrations/*`
- `services/api/prisma/postgres/migrations/*`
- `services/api/scripts/verify-companies*`
- `docs/progress/current-progress.md`
- `.ccg/tasks/control-claude-company-real-redesign/*`

禁止修改：
- `legacy-miaoda/`
- 与本任务无关的首页、AI助手、招聘会、打印扫描、智慧校园功能文件
- 无关 package 或全局样式大改

如果必须改范围外文件，先在任务记录中说明原因，并保持最小改动。

## 实施要求

### 1. 数据字典和筛选

- 地区筛选必须支持完整省 / 市 / 区，而不是只显示当前已有企业的部分地区。
- 企业类型、行业、招聘类型、来源类型要形成统一字典或后端统一接口。
- 前端不能只硬编码三五个演示选项。
- 后端查询必须真实过滤返回结果。

### 2. Kiosk `/companies`

- 页面标题建议：「来源企业导览」或「找企业 · 来源企业导览」。
- 首屏应展示真实企业卡片，不能只铺满筛选项。
- 企业卡片展示：logo、企业名、地区、行业、企业类型、来源机构、更新时间、来源岗位数、代表岗位。
- 统计必须来自后端真实聚合。
- 按钮：`查看企业风采`、`查看来源岗位`。

### 3. Kiosk `/companies/:id`

- 删除正式体验里的「演示」字样。
- 无真实封面/宣传片时不展示该模块。
- 来源岗位必须来自该企业真实关联的已发布岗位。
- 岗位按钮必须是 `查看岗位` 和 `扫码前往来源平台投递` 或 `去来源平台投递`。
- 来源页按钮为 `去来源平台查看`。
- 继续记录企业浏览和外部跳转。

### 4. Admin / Partner

- Admin 企业管理必须仍能 CRUD、审核、发布、下架、关联岗位、控制指标显示。
- Partner 企业资料必须仍能导入、编辑、下架，并保持机构隔离与审核状态机。
- 后台变更后前台数据应立即反映。

### 5. 禁止 mock

- 不得新增 mock 企业、mock 岗位、mock 统计。
- 不得用假企业填页面。
- 没有真实数据就展示空态。

### 6. 合规

严格遵守 `docs/compliance/compliance-boundary.md`。

禁止出现：
- 一键投递
- 立即投递
- 平台投递
- 企业收简历
- 候选人管理
- 面试邀约
- Offer 管理
- 录用概率 / 匹配百分比

## 验证要求

至少运行：

```bash
pnpm --filter ./apps/kiosk typecheck
pnpm --filter ./apps/kiosk build
pnpm --filter ./apps/admin typecheck
pnpm --filter ./apps/partner typecheck
pnpm --filter ./services/api typecheck
pnpm --filter ./services/api verify:companies
```

如果实际脚本名不同，先查看 `package.json` 并使用对应脚本。若 `verify:companies` 覆盖不足，请扩展它，至少覆盖：

- 完整筛选字典存在
- 后端筛选查询有效
- 企业详情未发布返回 404
- 企业详情岗位只返回本企业已发布岗位
- Admin 发布/下架影响 Kiosk
- Partner 跨机构不可修改
- 浏览记录和外部跳转记录可落库
- 禁词扫描无红线文案
- 正式前端页面无「演示」字样

## 输出要求

完成后请输出：

1. 修改文件清单
2. 前后端模块对应关系
3. 真实数据流说明
4. 验证命令与结果
5. 风险点和未完成项

不要提交远程，不要 push，不要创建 PR。
