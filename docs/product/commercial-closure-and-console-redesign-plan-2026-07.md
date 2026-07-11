# 商用级收口 · 双后台墨青纸感换装 · 全功能业务闭环总体执行方案（2026-07）

> **视觉变更说明（2026-07-11）：** 用户已确认未来三端视觉改为蓝白服务台方向；本方案的 G1–G6、C1–C4、S1–S8、真实业务闭环、分批交付和验收留痕继续有效。G7、§三、W1–W5 中的墨青纸感 / fusion-youth 视觉实现与 §九的旧原型对照口径不再用于未来铺开；详细替代口径见待用户全文审阅生效的 [蓝白服务台三端商用 UX 迁移设计规范](../superpowers/specs/2026-07-11-service-desk-commercial-ux-migration-design.md)。
> 生成日期：2026-07-03　分支：`claude/hungry-cori-9f2406`
> 性质：**执行方案**（承接既有规划文档，不另起标准）。上位文档：
> ① [commercial-grade-feature-plan-2026-07.md](./commercial-grade-feature-plan-2026-07.md)（商用级功能完善总体方案）
> ② [page-depth-enhancement-plan-2026-07.md](./page-depth-enhancement-plan-2026-07.md)（逐页深度提升 A/B 档清单）
> ③ [market-research-2026-07.md](./market-research-2026-07.md)（市场竞品调研，含来源）
> ④ 视觉原型（本地 `.workbuddy/prototypes/`，不入库）：`admin-console-inkpaper-v1.html`、`partner-console-inkpaper-v1.html`、`fusion-youth-preview-v5.html`、`login-trio-v1.html`
> 本方案不改变合规红线（`docs/compliance/compliance-boundary.md`）、入口定版口径（`docs/product/user-data-flow-matrix.md`）和上线前 P0 验收清单（`docs/progress/next-tasks.md`）。

---

## 一、需求总述（用户三轮诉求的完整提炼）

### 1.1 目标类诉求

| # | 诉求 | 说明 |
|---|------|------|
| G1 | 逐页体检 | 每个模块、每个页面过一遍，找出半成品、缺失功能、不完整的交互和状态 |
| G2 | UI 风格统一 | 所有页面做成风格统一、视觉完整的商用级界面，带真实交互 |
| G3 | 对标竞品补功能 | 吸收同类产品（人社一体机 / AI 简历 / AI 面试 / 自助打印 / 高校生涯平台）的合规优点 |
| G4 | 状态完整 | 每个功能都有加载 / 空态 / 错误 / 进行中 / 完成 / 失败的完整状态表达 |
| G5 | AI 全面注入 | 每个功能板块都有真正解决问题的 AI 大模型能力，不做装饰性 AI |
| G6 | 业务闭环 | 用户进来 → 用完 → 有结果 → 有记录 → 有下一步，不留断头路 |
| G7 | **双后台整体重做 UI**（本轮新增） | Admin 管理员端 + Partner 机构端全部按「墨青纸感」原型重做新 UI，做到完整、标准、商用级 |

### 1.2 约束类诉求

| # | 约束 | 说明 |
|---|------|------|
| C1 | 零回归 | 已验证的现有功能（打印、简历诊断、招聘会、我的记录等）不能被改坏 |
| C2 | 不干扰并行任务 | 打印扫描首期收口、toolbox 集成、预生产验收等并行工作不受影响 |
| C3 | 三端数据对接可靠 | Kiosk ↔ API ↔ Admin/Partner 的接口、类型、数据传输不出现对不上、传错、丢数据 |
| C4 | 以全链路闭环为验收单位 | 「用户操作 → 后端落库 → 后台可管理 → 记录可追溯」整条链路走通才算完成 |

### 1.3 补充约束（商用级必备，代用户补全）

| # | 约束 | 说明 |
|---|------|------|
| S1 | 诚实性 | 无真实数据 / 接口 / 硬件状态时显示诚实空态，禁止假「已完成 / 已打印 / 设备正常」 |
| S2 | 合规红线 | 竞品的一键投递 / 候选人管理 / 投递进度再好也不抄；排除项清单见深度提升方案 §二 |
| S3 | 付费出口 | 支付域 C-5 是商用闭环最后一环，独立立项（见 §六） |
| S4 | 三端联动 | 每个前台功能背后有 Admin 管理入口和（相关时）Partner 机构入口 |
| S5 | 验收留痕 | 每项补齐都有验证方式（verify 脚本 / 浏览器 / 真机），并同步进度文档 |
| S6 | 灰度开关 | 新能力挂 FeatureGate / Admin 配置开关，默认关闭，验收后打开 |
| S7 | 假数据清零 | 补齐页面时清残留 mock，不做「看起来有数据」的演示态 |
| S8 | P0 验收不动 | 不推翻 next-tasks.md 上线前真实验收清单，只加项不改口径 |

---

## 二、执行机制（回答「怎么做最不出事」）

1. **隔离**：一个任务 = 一个从干净 `main` 新开的 feature 分支 = 一份开工前声明的允许修改文件清单。开工前盘点活跃分支 / worktree，其占用模块列为本轮禁区。
2. **竖切闭环**：不做「所有页面一次换完」或「所有接口一次重写」的横切大爆炸；每片 = 一个功能的前台 + 后端 + 后台完整闭环，做完验完再下一片，任何时刻项目可运行、可回退。
3. **契约先行 + additive-only**：跨端数据结构以 `packages/shared` 类型为唯一真源；API 与数据库迁移只增不改（可加字段 / 端点 / 表列，不改已有字段名、类型、含义），旧功能与并行任务引用的接口永不受影响。
4. **三道门禁**：① typecheck + lint + build 三端全过；② 模块对应 `verify:*` + SQLite 主 CI + `postgres-readiness` 双 CI 全绿；③ 浏览器实点闭环（前台操作 → 落库 → 后台可见）。开工先跑全量 verify 记录基线，每片对比基线，变红即停。
5. **UI 换装纯样式 commit**：换装提交只含样式改动，不夹带业务逻辑，出问题回滚不伤功能。
6. **文档同步**：每片完成更新 `docs/progress/current-progress.md`，多窗口 / 多模型接手不拿过时状态。

---

## 三、双后台墨青纸感换装方案（G7 主体）

### 3.1 设计规范（来自 admin-console-inkpaper-v1.html 定稿原型）

**设计 token（换装第一步落进 `packages/ui/src/styles/tokens.css`）**：

| 类别 | Token | 值 |
|------|-------|-----|
| 纸色底 | `--paper` / `--paper-2` | `#f4f1e8` / `#efeadd` |
| 表面 | `--surface` / `--surface-2` | `#fffdf8` / `#f7f4ec` |
| 墨色 | `--ink` / `--ink-2` / `--muted` | `#10302b` / `#2c4a43` / `#5d6b63` |
| 主色 | `--teal` / `--teal-deep` / `--teal-soft` | `#1f9e86` / `#157a67` / `#e2f2ec` |
| 辅色 | `--clay`(陶) / `--wheat`(麦) / `--slate`(石青) / `--red` | `#b8683c` / `#a9781f` / `#3f68b0` / `#c14a34`（各配 soft 底色） |
| 描线 | `--line` / `--line-2` | `rgba(16,48,43,0.10)` / `0.06` |
| 标题字 | `--serif` | Noto Serif SC / Songti SC 宋体系（页标题、卡片标题用衬线，正文系统黑体） |
| 阴影 | `--shadow-sm` / `--shadow` | 低饱和墨绿投影 |

**框架规范**：墨绿（`--ink`）深色侧栏 232px + 分组导航 + 底部用户区；顶栏 60px（面包屑 + ⌘K 搜索框 + 环境徽章 + 通知）；页头宋体 24px 标题 + 副说明 + 主/次操作按钮。

**通用组件规范（原型已定稿，换装时组件化）**：KPI 卡（tabular-nums 大数字）、数据表格（hover 行 + 行内状态徽章 + 迷你进度条）、右侧详情抽屉、表单控件、筛选条（搜索框 + chip 组）、Tab（下划线式 + 计数）、分页、五态状态徽章（ok/doing/warn/err/off 圆点式）、Toast。

### 3.2 现状与换装路径

现状：三端 Layout 与 token 已收敛在 `packages/ui`（`layouts/AdminLayout.tsx`、`PartnerLayout.tsx`、`styles/tokens.css`），Tailwind v4 CSS 配置。换装自上而下三层推进：

```
第 1 层 token：tokens.css 注入墨青纸感变量（Admin/Partner 作用域），一次性改变全局底色/主色/圆角/阴影
第 2 层 框架与组件：AdminLayout / PartnerLayout 侧栏顶栏换装；packages/ui 通用组件（表格/抽屉/徽章/筛选/Tab/分页/Toast/空态）对齐原型规范
第 3 层 逐页：按批次清单换装页面内部布局，只动样式与展示结构，不动数据流与业务逻辑
```

### 3.3 页面清单与分批（Admin 29 模块 + Partner 13 模块）

**Admin 批次**（按使用频率与风险排序）：

| 批 | 页面 | 说明 |
|----|------|------|
| A-1 框架 | AdminLayout 侧栏/顶栏/页头 + 通用组件 | 原型第一批已含框架 + 高频 5 页规范 |
| A-2 高频运营 | dashboard、orders、terminals、printers、alerts | 原型已有对应页，照稿实现 |
| A-3 内容审核 | job-sources、fair-sources、policy-sources、sync-sources、import-batches、fairs、companies | 审核流页面，样式统一 + 状态徽章对齐 |
| A-4 用户与资产 | users、partners、files、ai-services、ai-config、member-benefits、member-feedback、member-notifications、benefit-activities | |
| A-5 系统 | devices、peripherals、permissions、audit、screensaver、smart-campus、toolbox、job-materials、login | login 参照 login-trio-v1.html |

**Partner 批次**：

| 批 | 页面 | 说明 |
|----|------|------|
| P-1 框架 | PartnerLayout + 复用 A-1 组件 | 参照 partner-console-inkpaper-v1.html |
| P-2 核心 | dashboard、jobs、fairs、sources、sync-logs | 数据源三轨入口页保持既有交互 |
| P-3 其余 | policy、companies、stats、terminals、profile、account、smart-campus、login | |

### 3.4 换装验收标准（每批必过）

- 视觉与原型对照：token 色值、字体层级、组件形态一致（截图对照留档）；
- 功能零回归：该批页面全部交互（筛选、分页、抽屉、审核动作、表单提交）实点通过，接口调用与换装前一致；
- 状态完整（G4）：每页 loading / 空态 / 错误态 / 权限态齐备且诚实；
- 响应式：1440 主设计位 + 1280 最小宽不破版；
- 可访问性：对比度达标（纸底墨字天然高对比）、焦点可见、按钮可点面积 ≥ 32px（后台鼠标场景）；
- 三道门禁（§二-4）全过。

### 3.5 Kiosk 前台换装（并行轨，不在本方案批次内）

Kiosk 按已定版 fusion-youth v4（青绿米纸 + 宋体标题）另行分批换装，口径同 §3.2 三层法；本方案先收双后台，避免三端同时开膛。

---

## 四、功能补齐（G1/G3/G4/G6，引用既有清单不重列)

- **A 档（现有骨架内补齐，随换装批次顺带或紧随其后）**：按深度提升方案 §四逐页清单执行——明细页补摘要字段 / 缩略图 / 排序筛选 / 批量操作、完成态页补「下一步」引导、列表补组织手段、真实数据可视化。
- **B 档（新增内容区块，逐项经用户确认后执行)**：「与我相关」推荐、相似岗位、AI 逛展攻略、历史对比等。
- **排除项**：深度提升方案 §二的合规 / 诚实性排除清单继续有效，防止误拾竞品功能。

## 五、AI 注入点位（G5，按总体方案既定点位，不新造）

已有链路持续深化：简历诊断 / 优化 / 生成、模拟面试 + 语音、岗位匹配三档参考、职业规划、AI 助手小青、OCR 进诊断闭环；待落地点位按总体方案 Phase 2 AI 线：AI 文件体检（打印前检查）、AI 逛展攻略（B 档）、材料包 AI 组合建议。原则：每个 AI 点位必须有输入真源、失败兜底、结果落库进「我的记录」，不做无后端的假 AI 按钮。

## 六、支付域 C-5（S3，独立立项）

商用闭环最后一环：微信 / 支付宝屏上动态码扫码支付 → 打印计费（黑白 / 彩色 / 双面）+ AI 增值单次包 → 订单 / 退款 / 对账 / 核销。**独立分支、独立方案评审、独立验收**，绝不混入换装或补齐切片；边界遵守 compliance §8.4/§8.5（只卖工具与打印服务，不卖录用结果）。订单底座（`codex/order-model-foundation` 已合入）为其基础。

---

## 七、总排期（波次间可暂停、可验收、可回退）

| 波 | 内容 | 依赖 | 产出与门禁 |
|----|------|------|-----------|
| W0 | 基线盘点：活跃分支 / worktree 禁区清单、全量 verify 基线绿记录、本轮文件预算 | 无 | 禁区清单 + 基线报告 |
| W1 | 换装第 1-2 层：tokens.css + AdminLayout/PartnerLayout + packages/ui 通用组件 | W0 | 纯样式 PR；三道门禁 |
| W2 | Admin A-2 高频 5 页换装 + 对应 A 档补齐 | W1 | 每页截图对照 + 实点验收 |
| W3 | Admin A-3/A-4/A-5 分批换装 + A 档补齐 | W2 | 同上，每批一 PR |
| W4 | Partner P-1/P-2/P-3 换装 + A 档补齐（含 Partner 统计页接真） | W1 | 同上 |
| W5 | Kiosk fusion-youth 换装（并行轨，可与 W3/W4 交错） | W1 经验复用 | 同上 + 触控验收（56px 主按钮） |
| W6 | 支付域 C-5（独立分支独立评审） | 订单底座 | 独立验收包 |
| W7 | B 档增强逐项确认执行 + 商用级终验 | W2-W6 | 全链路闭环验收 + 文档收口 |

每波完成同步 `docs/progress/current-progress.md`；波内每片有独立回滚点。

## 八、风险与禁区

| 风险 | 对策 |
|------|------|
| 换装夹带逻辑改动引发回归 | 纯样式 commit 纪律 + PR diff 审查只许样式文件 |
| 与打印扫描首期收口 / toolbox 集成抢文件 | W0 禁区清单；打印扫描相关页面（/print-scan 等）换装排到其收口合入后 |
| 三端类型漂移 | 只从 `packages/shared` 取类型；接口 additive-only |
| 原型与真实数据结构不符 | 换装前先核对该页真实 API 字段，原型仅定样式不定数据 |
| 29+13 页体量失控 | 严格分批、每批一 PR、单文件 300/500/800 行阈值继续生效 |
| 预生产环境被半成品污染 | FeatureGate 默认关；预生产部署只取整波验收通过的 tag |

## 九、商用级终验标准（G 全项对账）

1. 三端每页：UI 与定稿原型一致、五态齐备、无 mock 残留、无断头路（每个完成态有下一步）；
2. 每个功能：Kiosk 可用 → API 落库 → Admin 可管 →（相关时）Partner 可见，记录进「我的」对应口径；
3. 每个 AI 点位：真源输入、真实调用、失败兜底、结果落库；
4. 计费项：价格上屏明示、支付 / 退款 / 对账走通（W6 后）；
5. 全量 verify + 双 CI 绿、预生产冒烟通过、进度文档与代码一致；
6. 合规红线复查：按钮文案白名单、无投递闭环、来源标注齐全。
