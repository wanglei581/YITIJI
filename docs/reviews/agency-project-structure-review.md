# Agency 项目结构与功能体检报告

> 日期：2026-05-24  
> 方法：Agency Agents 组合审查（Code Reviewer + Product Manager + UX Architect）  
> 范围：目录结构、三端功能骨架、共享包、设计/技术规范、合规边界、Mavis 协作区

---

## 一、结论

当前项目方向没有跑偏，核心定位仍然清晰：

- 产品仍是「AI求职打印服务终端」，不是自营招聘平台。
- 企业招聘端没有被重新引入。
- 岗位/招聘会仍按第三方或官方来源入口处理。
- 三端 monorepo 已经可运行，Phase 2 已被部分推进。

但当前也存在几个需要尽快收口的问题：

- Phase 2 代码已经开始做，但进度文档还没有完全同步。
- Admin / Partner 菜单只覆盖了核心子集，尚未覆盖功能范围文档里的完整后台模块。
- Mavis 工作区与正式 docs 存在“双文档源”风险，需要明确草稿和正式文档的边界。
- 技术规范与实际代码存在轻微不一致，如 React Router 版本表述、CSS `@source` 要求、shadcn/ui 表述。

建议：可以继续推进 Phase 2，但先做一次“小封板”：同步文档、补齐三端菜单占位、把正式规范统一指向 `docs/`。

---

## 二、验证结果

| 检查项 | 结果 |
|--------|------|
| `pnpm lint` | 通过 |
| `pnpm typecheck` | 通过 |
| `pnpm build` | 通过 |
| `pnpm audit --prod` | No known vulnerabilities found |
| 禁用招聘闭环文案扫描 | 未在业务代码中发现违规，仅出现在合规/审查文档中 |
| 构建产物/zip/.DS_Store 跟踪状态 | 未被 Git 跟踪 |

---

## 三、主要发现

### Blocker

暂无阻塞继续开发的工程问题。

### Suggestions

#### S-1：Phase 2 已经开始，但项目进度文档还停留在“待执行”

`apps/kiosk` 已经接入 `createBrowserRouter`，并有首页、AI助手、我的、简历上传、打印上传、岗位、招聘会页面骨架。  
`apps/admin` 和 `apps/partner` 也已经有后台布局和部分路由。

但是 `docs/progress/current-progress.md` 仍显示第 2 阶段未开始。

影响：
- Claude Code / Codex / Mavis 后续容易重复做同一批路由骨架。
- 项目管理上会误判当前阶段。

建议：
- 将 Phase 2 标记为“进行中”。
- 在更新记录里补一条：Phase 2 路由骨架已部分完成，待补齐菜单和页面占位。

#### S-2：Admin 后台菜单明显少于功能范围文档定义

功能范围文档中 Admin 后台包含：

- 工作台
- 终端管理
- 打印机管理
- 外设管理
- 订单管理
- 文件管理
- AI服务管理
- 岗位信息源
- 招聘会信息源
- 合作机构管理
- 用户管理
- 告警中心
- 权限管理
- 日志审计

当前实际菜单只有：

- 工作台
- 终端管理
- 打印机管理
- 订单管理
- 告警中心
- 系统设置

影响：
- 后续 Phase 5 管理员后台开发会缺少导航入口。
- “系统设置”过于笼统，容易把权限、日志、配置混在一起。

建议：
- Phase 2 先补齐所有 Admin 模块的路由占位页。
- `系统设置` 拆为 `权限管理` 与 `日志审计`，配置类内容后置。

#### S-3：Partner 后台菜单也少于功能范围文档定义

功能范围文档中 Partner 后台包含：

- 工作台
- 机构资料
- 岗位信息管理
- 招聘会信息管理
- 政策公告管理
- 终端数据
- 数据统计
- 数据源管理
- 同步日志
- 账号权限

当前实际菜单只有：

- 工作台
- 岗位信息管理
- 招聘会管理
- 政策公告
- 数据源管理
- 数据统计

影响：
- 合作机构后台的信息架构还不完整。
- 后续权限、同步日志、机构资料这些关键运营能力容易被遗漏。

建议：
- Phase 2 先补齐所有 Partner 模块占位。
- 保持合作机构后台边界：只做数据与运营，不出现候选人、简历筛选、面试邀约。

#### S-4：Mavis 工作区和正式 docs 的职责需要再明确

`mavis-workspace/MAVIS.md` 写明 Mavis 只在自己的目录内操作，不参与主 Git。  
但视觉规范已经被同步为正式文档：`docs/design/visual-design-spec.md`。

影响：
- 如果后续 Claude Code 读取 `mavis-workspace/plan/design-spec.md`，而 Codex 读取 `docs/design/visual-design-spec.md`，两个文件可能逐渐分叉。

建议：
- Mavis 草稿区继续保留。
- 正式执行文档只引用 `docs/design/visual-design-spec.md`。
- `mavis-workspace/plan/for-claude-code.md` 应改为指向正式 docs 路径。

#### S-5：技术规范与实际工程有轻微不一致

发现几处小偏差：

- 技术规范写 “React Router v6”，实际依赖是 `react-router-dom ^7.15.1`。
- 技术规范要求三端 `index.css` 同时 `@source packages/ui` 和 `packages/shared`，当前实际只扫描 `packages/ui`。
- 技术规范写 `packages/ui` 是 shadcn/ui 封装，但当前更准确地说是自建 cva + Tailwind v4 组件基建，尚未真正初始化 shadcn/ui。

影响：
- 不是运行问题，但会让后续智能体按错误版本/错误前提实现。

建议：
- 将 tech-spec 改为“React Router v7（Data Router API）”。
- 如果 `shared` 不包含样式类，就不要强制 `@source packages/shared`。
- 将 “shadcn/ui 封装” 改为 “兼容 shadcn 思路的自建 UI 基建，后续按需引入 shadcn 组件”。

#### S-6：Kiosk 首页已有政策服务入口，但没有路由

Kiosk 首页有“政策服务”按钮，但当前按钮没有 `onClick`，也没有 `/policy` 路由。

影响：
- 用户点击无反馈，属于明显的交互断点。

建议：
- Phase 2 先加 `/policy` 占位页。
- 或者在 Phase 2 暂时移除该入口，等 Phase 4/政策模块开发时再放回。

### Nits

#### N-1：页面中仍有不少 `text-gray-*` / `bg-gray-*`

这和当前设计规范不冲突，因为规范允许中性色。但长期建议逐步抽象为语义 token，尤其是 Kiosk 主流程页面。

#### N-2：`apps/*/src/App.tsx` 职责不一致

Kiosk 的 `App.tsx` 已空置，入口转到 routes；Admin/Partner 仍在 `App.tsx` 内定义 router。  
短期可接受，Phase 2 收口时建议统一成 `src/routes/index.tsx`。

---

## 四、功能覆盖评估

### Kiosk

状态：已进入 Phase 2/3 雏形。

已具备：
- 首页
- AI助手
- 我的
- 简历上传占位
- 打印/扫描占位
- 岗位信息占位
- 招聘会占位
- 底部三导航联动

不足：
- 政策服务无路由
- 岗位/招聘会没有详情页占位
- 打印流程还只有上传入口，没有预览/参数/确认/进度页面
- AI简历服务还只有上传入口，没有解析/诊断/优化/打印路径

### Admin

状态：基础可运行，但模块覆盖不足。

已具备：
- 工作台
- 终端管理
- 打印机管理
- 订单管理
- 告警中心
- 系统设置

不足：
- 缺外设管理、文件管理、AI服务管理、岗位信息源、招聘会信息源、合作机构管理、用户管理、权限管理、日志审计

### Partner

状态：基础可运行，但轻量后台未完整。

已具备：
- 工作台
- 岗位信息管理
- 招聘会管理
- 政策公告
- 数据源管理
- 数据统计

不足：
- 缺机构资料、终端数据、同步日志、账号权限

---

## 五、合规检查

当前未发现业务代码触碰以下红线：

- 平台内一键投递
- 平台内收取简历给企业
- 候选人筛选
- 面试邀约
- Offer 管理
- 企业招聘端闭环

当前岗位/招聘会页面文案仍是“查看岗位”“查看招聘会”“来源：第三方平台 · 官方机构”，方向正确。

后续注意：
- 岗位详情按钮必须使用“去来源平台投递”或“扫码投递”。
- 招聘会详情按钮必须使用“去来源平台预约”或“扫码预约”。
- 系统只记录浏览和外部跳转，不记录投递结果。

---

## 六、建议下一步

### 立即做：Phase 2 收口

1. 更新 `current-progress.md`：Phase 2 改为进行中。
2. 补齐 Admin 全量模块占位路由。
3. 补齐 Partner 全量模块占位路由。
4. 给 Kiosk 加 `/policy` 占位页，或暂时移除首页政策入口。
5. 将 Admin/Partner 路由从 `App.tsx` 拆到 `src/routes/index.tsx`，与 Kiosk 统一。
6. 修改 Mavis 的 `for-claude-code.md`，让 Claude Code 读取正式 docs 路径。
7. 更新 `tech-spec.md`，修正 React Router v7、shadcn/ui、`@source` 说明。

### 然后做：Phase 3 Kiosk MVP

优先顺序：

1. 首页服务入口真实可点
2. 打印上传 → 预览 → 参数 → 确认 → 完成
3. 简历上传 → AI解析占位 → 诊断占位 → 打印
4. 我的记录：简历、打印订单、AI服务记录

### 再做：Phase 4 信息入口

1. 岗位列表与详情
2. 招聘会列表与详情
3. 外部跳转/二维码占位
4. 浏览与跳转事件 mock 记录

---

## 七、给 Claude Code 的下一条建议指令

```text
进入 Phase 2 收口任务。请不要新增业务闭环，只做路由、导航、页面占位和文档同步。

要求：
1. 将 Admin 后台菜单补齐为 feature-scope.md 定义的 14 个模块。
2. 将 Partner 后台菜单补齐为 feature-scope.md 定义的 10 个模块。
3. Kiosk 首页“政策服务”必须有 /policy 占位页，或临时移除入口，避免无响应按钮。
4. 将 Admin/Partner 路由从 App.tsx 拆到 src/routes/index.tsx，和 Kiosk 保持一致。
5. 不允许新增一键投递、收简历、候选人管理、面试邀约、企业招聘端。
6. 更新 current-progress.md 和 next-tasks.md。
7. 完成后运行 pnpm lint、pnpm typecheck、pnpm build。
```

