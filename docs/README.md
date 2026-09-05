# docs/ 导航索引

> **这份文件只做导航，不产出任何结论。** 需要结论时按下面的指向去读正式文档。
>
> 存在的理由：`docs/` 仍有多代原型和大量历史任务单并存。2026-08-22 已按产品负责人确认删除 7 套废弃原型（见本节「已删除」）。
> 2026-08-17 一天之内发生过 **6 次**「读了过期材料 → 得出错误结论 → 动手改了不该改的东西」，
> 其中两次差点删掉已经合入 main 的能力。这份索引是为了让下一个人不用猜哪份是活的。

---

## 一、当前口径的唯一来源（CLAUDE.md §7 指定）

| 你要找什么 | 去读 |
|---|---|
| 现在做到哪一步、已完成什么 | [progress/current-progress.md](progress/current-progress.md) |
| 下一步做什么 | [progress/next-tasks.md](progress/next-tasks.md) |
| 当日开发摘要与协作收尾 | [progress/today-claude.md](progress/today-claude.md) |
| 功能边界（能做 / 不能做） | [product/feature-scope.md](product/feature-scope.md) |
| 按谁排序、12 个月长什么 / 不长什么（从属于功能边界与合规） | [product/audience-growth-space.md](product/audience-growth-space.md) |
| 合规红线 | [compliance/](compliance/) 全部 |
| 目录职责 | [project-structure.md](project-structure.md) |

**这六处之外的任何文档，都不是当前口径。**

---

## 二、原型：哪一份是真值

**Kiosk 前台**：`design/kiosk-redesign-2026-08/`（青序流光）是**当前上线口径**——2026-09-02 产品负责人明确
「这 51 张 UI 就是我最新做的、前端要上线使用的页面」。它以 51 个宿主页 + 126 个 `?state=` 状态承接运行时
路由，逐页台账见 `kimi-full-coverage-v2/COVERAGE-MATRIX.md`。

> **两处数字已于 2026-09-02 更正，别再引用旧值：**
> 1. **路由总数是 107，不是 106。** 提交 `6d74c2f17` 修好项目图谱解析器（补 `React.lazy()` 路由与单文件多
>    controller 解析）后，kiosk 真实注册路由为 **107**；此前的 86 是解析器漏算的误报，106 是同一轮的中间值。
>    **凡按旧值算过的覆盖率分母都要重算。**
> 2. **「运行时只有 `/` 与 `/print-scan` 是新版」说的是上一代 V6，不是青序流光新稿。** 两者不是同一把尺子，
>    并排读会高估进度。青序流光新稿的落地数是 **1 / 51**（只有 `/print/pickup-claim`），唯一权威登记是
>    `apps/kiosk/src/layouts/KioskRoot.tsx` 的 `QX_MIGRATED_ROUTES` 集合。
>    **不要用 `grep -rl kiosk-redesign-2026-08 apps/kiosk/src` 当证据** —— 它现在命中 5 个文件，其中 4 处只是
>    注释里的视觉真值指针，会随注释增加而虚涨。
>
> 实时进度以 [`progress/next-tasks.md`](progress/next-tasks.md) 顶部「当前主线」为准；
> **「路由已对齐」不等于「页面已按新稿实现」**。

`design/kiosk-ai-os-v3-2026-08/`（旧称 V6）**降级为只读历史参考**，不再是设计真值、不得作为最终宿主继续施工。
其 `01-home-v6.html` 仍被代码/CI 引用（5 处），删不得；但那些引用属于待迁移的历史注释，
不构成「V6 是当前口径」的依据。
同目录下的 `01-home.html` / `-v4` / `-v5` 已于 2026-08-17 删除（零引用的中间稿）。

V6 的**逐页迁移矩阵**（原型页 ↔ 实现文件 ↔ 当前风格 ↔ 拆页判断 ↔ 批次 ↔ 门禁成本）：
[design/kiosk-v6-migration-matrix.md](design/kiosk-v6-migration-matrix.md)。
它是 `reviews/2026-08-12-v6-commercial-product-audit.md` §4/§7 与 `progress/next-tasks.md` 施工队列的可执行化，
不是第三套口径；冲突时以那两处为准。
⚠️ 不要与 `design/kiosk-proto-2026-07-migration-matrix.md` 混淆 —— 后者是 **Gen 1** 的 75 屏矩阵，
仍被 `verify-fusion-baseline.mjs` 当作路由清单门禁的检查对象，**不能删、也不是 V6 口径**。

**双后台（不要漏）**：
- 运行时真源：管理员 `apps/admin/`，合作机构 `apps/partner/`。
- 设计原型：`design/console-ai-os-2026-08/`（`admin/` + `partner/`）。
- 不是招聘企业端。Partner 只做数据与运营，不做候选人筛选 / 收简历 / 面试邀约。
- C0 事实冻结未完成：原型有 Admin `/online-platforms`，`apps/admin/src/routes/index.tsx` 里还没有这条运行时路由。后续施工仍以 `progress/next-tasks.md` 的 C0–C6 为准，不要把原型页当成已经上线的后台。

**小程序**：没有独立原型目录。页面级体验以 `apps/miniapp/` 正式源码为准。

**禁止清理**：`design/kiosk-redesign-2026-08/` 是产品负责人指定保留的一体机新原型整目录，不得删除、归档或当作垃圾。

> **入库状态已于 2026-09-02 变更。** 本段原写「工作区 untracked、有意未入库…… 禁止 `git add -A` 把这两处顺手带进提交」——
> 该状态**已不再成立**：提交 `2d9f73c1b` 已把 51 页原型入库（9.9MB / 53 个 HTML 加被引用资源），
> 关闭交付治理包的硬阻塞 **BL-04**（此前 `git ls-files` = 0，**完全没有版本历史可回滚**）。
> 682MB 截图证据以目录级 `.gitignore` 排除，入库后已从 worktree 位置重渲三页验证相对资源路径正常。
> 「不得删除」这条约束**不变**；变的只是「看不到 ≠ 可删」这个理由不再需要——现在它就在 `main` 上。
> 旁路脚本 `apps/kiosk/scripts/design-shot.mjs` 是否入库请另行按 `git ls-files` 现场核，不要沿用本段旧结论。

### 只读历史目录 —— 不得从中提取业务口径

这些目录仍被自动化测试或截图工具引用，**不能删**，但它们描述的是过去：

| 目录 | 性质 | 谁在用 |
|---|---|---|
| `design/kiosk-proto-2026-07/` | 7 月单体原型（Gen 1） | 回归测试基线 |
| `design/kiosk-proto-2026-07-fusion/sources/` | 合流前两份完整快照 | 融合验证证据链 |

### 已删除（2026-08-22，产品负责人确认）

以下目录已从仓库移除，**不得再当设计输入，也不得从 Git 历史里捡回来当现行口径**：

- `design/mini-proto-2026-07/`
- `design/mini-proto-v2-2026-07/`
- `design/miniapp-os-prototype-2026-08/`
- `design/kiosk-ai-os-prototype-2026-08/`
- `design/kiosk-visual-directions-2026-08/`
- `design/zhiyida-front-2026-08/`
- `design/paper-desk-proto-2026-08/`

⚠️ **`kiosk-proto-2026-07/01-home.html` 与 V6 首页是两份互相冲突的设计。**
前者仍在被引用，读它会导致 UI 布局倒退。它只是测试基线，不是设计口径。

---

## 三、过程材料 —— 有历史价值，无当前效力

> **数字已于 2026-09-02 重算并执行了一轮清理。** 下表是清理**后**的实测值；
> 旧表（superpowers 146 / 其中 130 份未引用、reviews 69）写于 2026-08，两个数都已不准：
> 旧的「130 份未引用」只看代码与 CI，没算 `docs/` 内部互链和 `progress/` 提及，口径偏松；
> `reviews/` 也已从 69 增至 77。**不要再引用旧值。**

| 目录 | 清理前 | 已删 | 现存 | 说明 |
|---|---:|---:|---:|---|
| `superpowers/plans/` | 106 | 35 | **71** | 6–8 月一次性任务单。删的是结论已合入主干且零阻塞引用的；**保留的多数是「活还没干完」的族**（F1 D2′/D3、青序流光、kiosk fusion、支付与出纸履约、扫描真实化、合同审查、公共终端清场） |
| `superpowers/specs/` | 40 | 17 | **23** | 同上，成对随 plans 删 |
| `reviews/`（顶层 `.md`） | 77 | 13 | **65** | 只删了纯时点快照（Phase 0/2/6.5/7 封板前代码审查、4 份 6 月单页实现审查、1 份 7 月 PR/分支盘点）。**审计、治理章程、gap spec、backlog、待拍板提案一份没删** |
| `acceptance/` | 29 | 0 | **29** | 27 份被 verify 脚本直接引用；另 2 份同族记录被引用，拆开会断证据链 |
| `patent/`、`business/` | 11 | 0 | **11** | 专利交底与大赛申报材料，**不是产品功能范围**，易被误读 |

判据、逐份台账、保留理由，以及盘点中发现的「文档说的和代码不符」六条，见
[reviews/doc-cleanup-inventory-2026-09-02.md](reviews/doc-cleanup-inventory-2026-09-02.md)。

**引用它们之前先确认日期**，并和第一节的正式入口交叉验证。

---

## 四、取证规则（今天四次误判的直接产物）

判断「某文件/某功能是否存在、是否已修复」时：

```bash
# ✅ 对的
git ls-tree -r origin/main <path>
git show origin/main:<path>

# ❌ 错的
ls <path>                # 主仓工作区停在别的分支、带大量未提交改动
cat <production>/dist/…  # 生产产物是某个旧 SHA 构建的
git diff <ref> -- <path> # 未跟踪文件会被静默报成「已删除」，产出假 diffstat
```

**同一天里的四次错误分别用了：主仓工作区（两次）、生产 dist（一次）、basename 匹配（一次）。**
basename 那次尤其隐蔽：`grep 01-home.html` 会同时命中 `kiosk-proto-2026-07/` 和
`kiosk-ai-os-v3-2026-08/` 下的两个不同文件 —— **查引用必须用全路径**。

判断文件归属用 `git hash-object` 比对 blob，不要看 diffstat。

---

## 五、维护约定

- 新增文档前先问：它会不会和第一节的六个入口冲突？会就不要新增，去改那六个。
- 一次性的评审 / 计划 / 交接材料写完即归档，不要留在顶层制造第二套口径。
- 删除文档前确认 `docs/` 之外零引用；`docs/` 内部有引用的，先修链接再删。

### 已执行的删除

| 日期 | 范围 | 台账 |
|---|---|---|
| 2026-08-22 | 7 套废弃原型目录（见第二节「已删除」） | `progress/current-progress.md` 当日条目 |
| 2026-09-02 | 65 份过期一次性材料（`superpowers` 52 + `reviews` 13） | [reviews/doc-cleanup-inventory-2026-09-02.md](reviews/doc-cleanup-inventory-2026-09-02.md) |

**2026-09-02 那轮补了一条第四节没写的取证方法，下次照用：**

「查引用必须用全路径」是对的，但**判断「零引用」时全路径反而会漏**——同目录相对链接
（markdown 里写成 `(某文件名.md)`，不带任何目录）、纯文件名提及都不带路径。正确做法是**先证明 basename 唯一**
（`find docs -name '*.md' -exec basename {} \; | sort | uniq -d`，2026-09-02 实测只有 `README.md` 重名），
唯一之后 basename 命中集就是全路径命中集的**超集**，用它判零引用比全路径更严、不会漏。
`README.md` 这类重名文件因此不能进删除候选池。

再把命中按来源分层，只有前三层阻塞删除：**代码与门禁**（`apps/` `services/` `packages/` `scripts/` `.github/`）、
**正式入口**（第一节六处 + `CLAUDE.md` / `AGENTS.md` / 根 `README.md` / 本文件）、**其它保留文档**；
不阻塞的是 `graph/`（自动产物，`pnpm graph` 重跑即刷新）、`progress/archive/`、`.ccg/tasks/archive/`
（已被 `.gitignore` 排除出跟踪）、以及删除清单内部互引。

最后一条容易漏：**删除清单内部互引不阻塞，前提是两份都删**。所以清单敲定后必须再跑一次
「保留侧 → 删除侧」复查——2026-09-02 那轮正是靠这一步捞回 2 份（保留文档正文有指向它们的链接），
删完再复查一次确认无死链。
