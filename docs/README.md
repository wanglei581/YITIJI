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
| 历史协作摘要（不能替代当前进度） | [progress/today-claude.md](progress/today-claude.md) |
| 功能边界（能做 / 不能做） | [product/feature-scope.md](product/feature-scope.md) |
| 合规红线 | [compliance/](compliance/) 全部 |
| 目录职责 | [project-structure.md](project-structure.md) |

**当前事实只由 `current-progress.md`、`next-tasks.md`、`feature-scope.md`、合规边界和实际代码/生产证据共同裁决。`today-claude.md` 只是历史协作日志。**

---

## 二、原型：哪一份是真值

**Kiosk 前台**：`design/kiosk-ai-os-v3-2026-08/` 是当前 V6 原型（活跃维护）。
首页真值是 **`01-home-v6.html`** —— 它是全仓唯一被代码/CI 引用的首页原型（5 处）。
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

**禁止清理**：`design/kiosk-redesign-2026-08/` 是产品负责人指定保留的一体机新原型整目录，不得删除、归档或当作垃圾。当前是 **工作区 untracked、有意未入库**（负责人未点名提交）；`git ls-tree origin/main` 看不到 ≠ 可删。旁路脚本 `apps/kiosk/scripts/design-shot.mjs` 同样未入库。禁止 `git add -A` 把这两处顺手带进提交。

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

| 目录 | 数量 | 说明 |
|---|---|---|
| `superpowers/plans/`、`superpowers/specs/` | 146 | 6–8 月的一次性任务单与设计草案。**其中 130 份未被任何代码或 CI 引用**，结论已合入主干 |
| `reviews/` | 动态增长 | 一次性评审；数量会变化，结论可能已被后续基线覆盖 |
| `patent/`、`business/` | 11 | 专利交底与大赛申报材料，**不是产品功能范围**，易被误读 |

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
- 删除文档前用全路径确认 `docs/` 之外零引用；`docs/` 内部有引用的，先修链接再删。
