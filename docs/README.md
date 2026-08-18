# docs/ 导航索引

> **这份文件只做导航，不产出任何结论。** 需要结论时按下面的指向去读正式文档。
>
> 存在的理由：`docs/` 有 879 个文件、四代原型并存、130 份未被任何代码引用的历史任务单。
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
| 合规红线 | [compliance/](compliance/) 全部 |
| 目录职责 | [project-structure.md](project-structure.md) |

**这六处之外的任何文档，都不是当前口径。**

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

**双后台**：`design/console-ai-os-2026-08/`。

**小程序**：`design/miniapp-os-prototype-2026-08/`。

### 只读历史目录 —— 不得从中提取业务口径

这些目录仍被自动化测试或截图工具引用，**不能删**，但它们描述的是过去：

| 目录 | 性质 | 谁在用 |
|---|---|---|
| `design/kiosk-proto-2026-07/` | 7 月单体原型（Gen 1） | 回归测试基线 |
| `design/kiosk-proto-2026-07-fusion/sources/` | 合流前两份完整快照 | 融合验证证据链 |
| `design/kiosk-visual-directions-2026-08/` | 8 月视觉方案比选（a/b/c/d） | `apps/kiosk/capture-dir.mjs` |
| `design/mini-proto-2026-07/`、`mini-proto-v2-2026-07/` | 小程序 Gen 1 / Gen 2 | `.claude/launch.json` |

⚠️ **`kiosk-proto-2026-07/01-home.html` 与 V6 首页是两份互相冲突的设计。**
前者仍在被引用，读它会导致 UI 布局倒退。它只是测试基线，不是设计口径。

---

## 三、过程材料 —— 有历史价值，无当前效力

| 目录 | 数量 | 说明 |
|---|---|---|
| `superpowers/plans/`、`superpowers/specs/` | 146 | 6–8 月的一次性任务单与设计草案。**其中 130 份未被任何代码或 CI 引用**，结论已合入主干 |
| `reviews/` | 69 | 一次性评审。约 50 份的结论已被后续基线覆盖 |
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
